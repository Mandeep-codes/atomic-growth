import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "./db";
import {
  campaign_geo_rules,
  demographics_verification_v2,
  verified_users,
} from "./schema";
import { readAudienceCountries, resolveGeoBonus } from "./geo-rules";

// ─────────────────────────────────────────────────────────────────────────────
// GEO BONUS RESOLUTION (per connected account, per campaign)
//
// KILL-SWITCH. While false, nothing here is consulted by the payout path and
// every clipper is paid exactly today's rate. Flip only once the per-account
// odometer cutover has run — before that, campaign_view_rewards still sums all
// of a clipper's accounts into ONE row per platform, so it cannot represent two
// accounts on different rates and a bonus would leak onto non-qualifying
// accounts. Mirrors DELETION_HANDLING_ENABLED in update-views/updateViewCounts.
// ─────────────────────────────────────────────────────────────────────────────
export const GEO_PAYOUT_ENABLED = false;

export type GeoBonusResolver = {
  /** Extra cpm for this connected account on this campaign. 0 = no bonus. */
  bonusFor: (verifiedUserId: string | null | undefined) => number;
  /** True when the campaign has no rules at all — the common case. */
  isNoop: boolean;
};

const NO_BONUS: GeoBonusResolver = { bonusFor: () => 0, isNoop: true };

/**
 * Build a resolver for one campaign, in two queries, reused across every
 * account in the payout run.
 *
 * Qualification uses the LATEST APPROVED demographic report per account. Reports
 * are versioned weekly (cycle_start), so "latest" means the most recent cycle
 * that a moderator actually approved — a pending or rejected report for the
 * current week never changes a rate, and an account that stops qualifying simply
 * stops earning the bonus on FUTURE views.
 *
 * Accounts flagged deleted are excluded outright: a banned or removed account
 * can never qualify, so it falls back to the campaign base rate.
 */
export async function buildGeoBonusResolver(
  campaignId: string
): Promise<GeoBonusResolver> {
  if (!GEO_PAYOUT_ENABLED) return NO_BONUS;

  const rules = await db
    .select()
    .from(campaign_geo_rules)
    .where(eq(campaign_geo_rules.campaign_id, campaignId));

  // A campaign with no geo rules behaves EXACTLY as it does today — this is the
  // backwards-compatibility guarantee, enforced by an early return rather than
  // by every downstream branch remembering to check.
  if (rules.length === 0) return NO_BONUS;

  const reports = await db
    .select({
      verifiedUserId: demographics_verification_v2.verified_user_id,
      parsedData: demographics_verification_v2.parsed_data,
      exemptionReason: demographics_verification_v2.exemption_reason,
    })
    .from(demographics_verification_v2)
    .innerJoin(
      verified_users,
      eq(demographics_verification_v2.verified_user_id, verified_users.id)
    )
    .where(
      and(
        eq(demographics_verification_v2.campaign_id, campaignId),
        eq(demographics_verification_v2.status, "approved"),
        // Rule 4: banned / deleted / disconnected accounts never qualify.
        isNull(verified_users.account_deleted_at)
      )
    )
    // Newest approval first, so the first row seen per account is the one that
    // counts. Ordered by updated_at rather than cycle_start deliberately: it
    // means qualification works identically before and after the weekly-cycle
    // migration lands, and "most recently approved" is the correct notion of
    // latest either way. Once cycles are live, one row per account per week
    // exists and updated_at still orders them correctly.
    .orderBy(desc(demographics_verification_v2.updated_at));

  const bonusByAccount = new Map<string, number>();
  for (const report of reports) {
    // Ordered newest-first, so anything already recorded is more recent.
    if (bonusByAccount.has(report.verifiedUserId)) continue;

    // ── Exemption: base rate only ──
    // The clipper filed an approved submission — the account is verified for
    // the cycle and its held base pay releases — but stated it cannot provide
    // an audience breakdown. With no breakdown there is nothing to score, so
    // the account cannot qualify for a geo bonus on this campaign.
    //
    // Checked EXPLICITLY rather than leaning on parsed_data being null. It
    // would be null today and the bonus would come out 0 either way, but that
    // is an accident of the data, not a rule — anything that later attaches a
    // breakdown to an exempt row (a mod edit, a backfill, an API parse) would
    // silently start paying a bonus the exemption was meant to forgo.
    if (report.exemptionReason) {
      bonusByAccount.set(report.verifiedUserId, 0);
      continue;
    }

    const audience = readAudienceCountries(report.parsedData);
    bonusByAccount.set(
      report.verifiedUserId,
      resolveGeoBonus(rules, audience)
    );
  }

  return {
    isNoop: false,
    bonusFor: (verifiedUserId) => {
      if (!verifiedUserId) return 0;
      return bonusByAccount.get(verifiedUserId) ?? 0;
    },
  };
}
