import { and, eq, gt, inArray, isNull, isNotNull, or, sql } from "drizzle-orm";
import { db } from "./db";
import {
  balance_entries,
  balances,
  banned_social_media_users,
  campaign_view_rewards,
  campaigns,
  demographics_reset_requests,
  demographics_verification_v2,
  submissions,
  verified_users,
  user_clerk,
} from "./schema";
import { currentCycleStart } from "./demographic-cycles";

// ─────────────────────────────────────────────────────────────────────────────
// CAMPAIGN-SCOPED DEMOGRAPHICS
//
// The ask, and the money it holds back, are both scoped to ONE campaign.
//
// A moderator opens a reset request against a campaign. From that moment the
// clipper is asked for fresh demographics for exactly the accounts that posted
// to THAT campaign and generated views — not every account they have ever
// connected — and exactly that campaign's earnings are held back until those
// accounts are approved. Money earned on any other campaign stays claimable.
//
// Why hold the money per campaign rather than blocking the whole wallet: a
// clipper who earned $50 on the campaign being reviewed and $5 elsewhere should
// be able to take the $5 out. Blocking everything punishes them for a review
// they are not part of, and the old global gate did exactly that.
//
// Nothing here decides whether an account MEETS a campaign's geo criteria. That
// stays in geo-rules.ts / geo-payout.ts and is untouched: this module only
// decides who is asked, and what is claimable while they have not answered.
// ─────────────────────────────────────────────────────────────────────────────

// ── Every paying campaign asks, without waiting for a moderator ──
//
// The hold used to engage ONLY for a campaign a moderator had opened a round
// on. No cron opens those rounds, and production had never had a single one —
// so getCampaignAsksForUser returned [] for everybody, getClaimableBreakdown
// took its "nothing is being asked" shortcut, and the entire demographics gate
// was dormant: any clipper could withdraw their whole balance having verified
// nothing.
//
// It also made the reported bug possible in the other direction. With exactly
// one round open, satisfying it emptied `unsatisfied`, which unlocked the WHOLE
// wallet — including money earned on campaigns that had never asked at all.
//
// So a live campaign now asks on its own as soon as the clipper has earnings on
// it. Moderator rounds still work and still take precedence; this only fills in
// the campaigns nobody opened a round for.
//
// KILL-SWITCH. Set false to fall back to moderator-opened rounds only — the
// behaviour before this change — without reverting anything.
export const AUTO_CAMPAIGN_DEMOGRAPHICS_ASK = true;

/** Statuses that mean the clipper has actually filed a report. */
const SUBMITTED_STATUSES = ["needs-human-review", "pending", "approved"] as const;

// ── An account WE banned is not asked for demographics ──
//
// The pairing already existed for the platform's side: an account flagged
// account_deleted_at (terminated / gone from YouTube, Instagram, …) is excluded
// below, with the comment "a removed or banned account can never be verified,
// so it must not be able to hold a clipper's money hostage either". Only half of
// that was wired — our OWN handle bans were never checked, so 169 accounts we
// had banned were still being asked to file a report, and still holding their
// campaign's money against one that will never be filed.
//
// Their money is not being released early by this: banHandle already purges a
// banned handle's rewards. This only stops us demanding a report from an account
// nobody is allowed to use.
//
// NO LOWER() on the handle comparison — same reasoning, and the same measured
// cost, as submissionOwnerInGoodStanding in banPurge.ts: both columns are
// utf8mb4_0900_ai_ci so `=` is already case-insensitive, while wrapping the
// indexed column makes banned_social_media_users_platform_handle_idx unusable.
const accountNotBannedByUs = sql`NOT EXISTS (
  SELECT 1 FROM ${banned_social_media_users} AS bsu_ask
  WHERE bsu_ask.platform = ${verified_users.platform}
    AND bsu_ask.handle = ${verified_users.handle}
)`;

export type ParticipatingAccount = {
  verifiedUserId: string;
  handle: string | null;
  platform: string | null;
  /** Views this account generated on the campaign — why it is being asked. */
  views: number;
  status: string;
  submitted: boolean;
  approved: boolean;
  /** Filed as an exemption — verified for the cycle, but no geo bonus. */
  exempt: boolean;
};

export type CampaignAsk = {
  /**
   * The moderator round this ask belongs to, or null when the campaign is
   * asking on its own because the clipper has money riding on it (see
   * AUTO_CAMPAIGN_DEMOGRAPHICS_ASK).
   */
  requestId: string | null;
  campaignId: string;
  campaignTitle: string | null;
  cycleStart: string;
  note: string | null;
  requestedAt: Date;
  accounts: ParticipatingAccount[];
  /** True once every participating account is APPROVED for this request. */
  satisfied: boolean;
};

/**
 * The accounts that must report for one campaign: the clipper's connected
 * accounts that have approved, live clips on it which actually generated views.
 *
 * `views > 0` is the line the client drew — an account that joined a campaign
 * but produced nothing has no audience worth verifying, and asking about it is
 * the noise this whole change exists to remove.
 */
// OPT-IN, per person: always report on EVERY connected account, whether or not
// it has ever run a clip on the campaign. Set on user_clerk, off by default.
//
// This one flag has to cover BOTH sides or it strands the person it is meant
// to help: getCampaignAsksForUser decides who is ASKED, and submitForCampaign
// decides what may be FILED. Relaxing only the ask would show requests that
// the submit endpoint then refuses ("that account didn't generate any views on
// this campaign"), leaving the money held against a report they are not
// allowed to send. Both read this helper, so both move together.
export async function alwaysRequestsDemographics(
  userId: string
): Promise<boolean> {
  const [row] = await db
    .select({ flag: user_clerk.always_request_demographics })
    .from(user_clerk)
    .where(eq(user_clerk.discord_id, userId))
    .limit(1);
  return row?.flag === true;
}

export async function getParticipatingAccounts(
  campaignId: string,
  userId: string
): Promise<{ verifiedUserId: string; handle: string | null; platform: string | null; views: number }[]> {
  if (await alwaysRequestsDemographics(userId)) {
    // Every live connected account, with its real view total on this campaign
    // (0 for one that has never run here). Dead accounts stay excluded — an
    // account that no longer exists can never be verified, so asking about it
    // could only freeze money against something impossible to satisfy.
    const rows = await db
      .select({
        verifiedUserId: verified_users.id,
        handle: verified_users.handle,
        platform: verified_users.platform,
        // Written longhand with an alias and FULLY QUALIFIED names. Letting
        // drizzle interpolate the columns produced
        // `WHERE verified_user_id = id` — unqualified, so inside
        // `FROM submissions` the `id` bound to submissions.id instead of
        // verified_users.id, and the correlation silently matched nothing.
        // Caught by printing the generated SQL.
        views: sql<number>`COALESCE((
          SELECT SUM(s_pa.views) FROM ${submissions} AS s_pa
           WHERE s_pa.verified_user_id = \`verified_users\`.\`id\`
             AND s_pa.campaign_id = ${campaignId}
             AND s_pa.status = 'approved'
             AND s_pa.deleted_at IS NULL
        ), 0)`,
      })
      .from(verified_users)
      .where(
        and(
          eq(verified_users.discord_id, userId),
          isNull(verified_users.deleted_at),
          isNull(verified_users.account_deleted_at),
          accountNotBannedByUs
        )
      );
    return rows.map((row) => ({ ...row, views: Number(row.views) }));
  }

  const rows = await db
    .select({
      verifiedUserId: verified_users.id,
      handle: verified_users.handle,
      platform: verified_users.platform,
      views: sql<number>`COALESCE(SUM(${submissions.views}), 0)`,
    })
    .from(submissions)
    .innerJoin(
      verified_users,
      eq(submissions.verified_user_id, verified_users.id)
    )
    .where(
      and(
        eq(submissions.campaign_id, campaignId),
        eq(submissions.user_id, userId),
        eq(submissions.status, "approved"),
        isNull(submissions.deleted_at),
        // A removed or banned account can never be verified, so it must not be
        // able to hold a clipper's money hostage either. Both senses of
        // "banned": gone from the platform, and banned by us.
        isNull(verified_users.account_deleted_at),
        accountNotBannedByUs
      )
    )
    .groupBy(verified_users.id, verified_users.handle, verified_users.platform)
    .having(sql`COALESCE(SUM(${submissions.views}), 0) > 0`);

  return rows.map((row) => ({ ...row, views: Number(row.views) }));
}

/**
 * The combined-views bar a clipper must clear before this campaign asks them
 * for demographics.
 *
 * `demographics_min_views` is an OPTIONAL override. Left at 0 — which is how
 * every campaign in production is actually configured — the bar falls back to
 * the campaign's `min_payout`, the same combined-views figure that already
 * gates earning. That pairing is the point: a clipper below the bar earns
 * nothing here, so asking them to file a demographics report is asking for
 * paperwork against $0, and a clipper at or above it is earning, so their
 * money must be held until they file.
 *
 * Before this, the two numbers drifted apart: mods set `min_payout` to 20,000
 * and never touched `demographics_min_views`, so a 0 bar meant every clipper
 * with a single view was asked (185 of 270 on live campaigns had earned
 * nothing at all), while any mod who did set it HIGHER than `min_payout` would
 * have opened the opposite hole — earnings that no campaign ever asks about
 * and therefore never locks.
 *
 * A mod who deliberately sets a non-zero value still gets exactly that value.
 */
export async function getDemographicsThreshold(
  campaignId: string
): Promise<number> {
  const [row] = await db
    .select({
      threshold: campaigns.demographics_min_views,
      minPayout: campaigns.min_payout,
    })
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);
  return resolveDemographicsThreshold(row?.threshold, row?.minPayout);
}

/**
 * Shared by every caller that has already loaded the two columns, so the
 * fallback rule lives in exactly one place. Callers that read
 * `demographics_min_views` straight off a joined row MUST go through this —
 * a second copy of the rule is how the ask and the payout lock drift apart.
 */
export function resolveDemographicsThreshold(
  demographicsMinViews: number | null | undefined,
  minPayout: number | null | undefined
): number {
  const explicit = Number(demographicsMinViews ?? 0);
  if (explicit > 0) return explicit;
  return Math.max(0, Number(minPayout ?? 0));
}

/**
 * Every clipper who should be ASKED on this campaign: at least one
 * view-generating account, and combined views across those accounts at or above
 * the campaign's threshold.
 *
 * The threshold is applied to the SUM across the clipper's accounts, not to
 * each one. A clipper running three accounts that together clear the bar
 * qualifies, and then reports on all three — which is the whole point of a
 * combined figure.
 */
export async function getCampaignParticipants(
  campaignId: string
): Promise<string[]> {
  const threshold = await getDemographicsThreshold(campaignId);

  const rows = await db
    .select({
      userId: submissions.user_id,
      totalViews: sql<number>`COALESCE(SUM(${submissions.views}), 0)`,
    })
    .from(submissions)
    .innerJoin(
      verified_users,
      eq(submissions.verified_user_id, verified_users.id)
    )
    .where(
      and(
        eq(submissions.campaign_id, campaignId),
        eq(submissions.status, "approved"),
        isNull(submissions.deleted_at),
        isNull(verified_users.account_deleted_at),
        gt(submissions.views, 0)
      )
    )
    .groupBy(submissions.user_id);

  return rows
    .filter((row) => Number(row.totalViews) >= threshold)
    .map((row) => row.userId);
}

/** The open reset request for a campaign, if one exists. */
export async function getOpenRequestFor(campaignId: string) {
  const [row] = await db
    .select()
    .from(demographics_reset_requests)
    .where(
      and(
        eq(demographics_reset_requests.campaign_id, campaignId),
        isNull(demographics_reset_requests.closed_at)
      )
    )
    .limit(1);
  return row ?? null;
}

/**
 * Every campaign currently ASKING this clipper for demographics, with the
 * accounts it is asking about and their current status.
 *
 * Drives the clipper's submission screen. A campaign appears only if it has an
 * open request AND this clipper actually has a view-generating account on it.
 */
export async function getCampaignAsksForUser(
  userId: string
): Promise<CampaignAsk[]> {
  const open = await db
    .select({
      requestId: demographics_reset_requests.id,
      campaignId: demographics_reset_requests.campaign_id,
      cycleStart: demographics_reset_requests.cycle_start,
      note: demographics_reset_requests.note,
      requestedAt: demographics_reset_requests.created_at,
      campaignTitle: campaigns.title,
      threshold: campaigns.demographics_min_views,
      minPayout: campaigns.min_payout,
    })
    .from(demographics_reset_requests)
    .leftJoin(campaigns, eq(demographics_reset_requests.campaign_id, campaigns.id))
    .where(isNull(demographics_reset_requests.closed_at));

  type Round = {
    requestId: string | null;
    campaignId: string;
    cycleStart: string;
    note: string | null;
    requestedAt: Date;
    campaignTitle: string | null;
    // Already resolved through resolveDemographicsThreshold — never the raw
    // demographics_min_views column, so the bar cannot differ between the
    // moderator-round rounds and the auto-asked ones below.
    threshold: number;
  };

  const rounds: Round[] = open.map((request) => ({
    requestId: request.requestId,
    campaignId: request.campaignId,
    cycleStart: request.cycleStart,
    note: request.note,
    requestedAt: request.requestedAt,
    campaignTitle: request.campaignTitle,
    threshold: resolveDemographicsThreshold(
      request.threshold,
      request.minPayout
    ),
  }));

  // Live campaigns this clipper has earnings on that no moderator opened a
  // round for. Scoped to live campaigns on purpose: an ended campaign's money
  // was earned under whatever was asked at the time, and freezing it now would
  // strand balances behind a report nobody is going to review. A moderator can
  // still open a round on an ended campaign by hand if they need one.
  if (AUTO_CAMPAIGN_DEMOGRAPHICS_ASK) {
    const alreadyAsking = new Set(rounds.map((round) => round.campaignId));
    const cycleStart = currentCycleStart();
    const earning = await db
      .selectDistinct({
        campaignId: campaign_view_rewards.campaign_id,
        campaignTitle: campaigns.title,
        threshold: campaigns.demographics_min_views,
        minPayout: campaigns.min_payout,
      })
      .from(campaign_view_rewards)
      .innerJoin(campaigns, eq(campaigns.id, campaign_view_rewards.campaign_id))
      .where(
        and(
          eq(campaign_view_rewards.user_id, userId),
          or(
            // Live campaigns ask as they always have.
            and(eq(campaigns.active, true), eq(campaigns.ended, false)),
            // ── An unanswered request survives the campaign ending ──
            //
            // This used to be live-campaigns-only, so the moment a campaign
            // ended its ask vanished, its hold released, and the balance became
            // claimable whether or not the clipper had ever filed. Nyne AI,
            // Airwallex and Superblocks all ended carrying 219, 215 and 76
            // unanswered rows between them, and those clippers were paid
            // without a single approved report.
            //
            // A request that was outstanding when the campaign closed is still
            // outstanding. Ending a campaign is not a decision about anyone's
            // demographics, so it cannot stand in for a moderator's approval.
            //
            // Deliberately NOT "every ended campaign": this only reaches
            // campaigns that had ALREADY asked this clipper and never got an
            // approval. An ended campaign that never asked stays unasked, so
            // no balance is frozen behind a report that was never requested —
            // which is the case the original scoping was protecting against.
            sql`EXISTS (
              SELECT 1 FROM ${demographics_verification_v2} AS dv_open
               WHERE dv_open.user_id = ${userId}
                 AND dv_open.campaign_id = ${campaigns.id}
                 AND dv_open.status NOT IN ('approved', 'cancelled')
            )`
          )
        )
      );

    for (const campaign of earning) {
      if (alreadyAsking.has(campaign.campaignId)) continue;
      rounds.push({
        requestId: null,
        campaignId: campaign.campaignId,
        cycleStart,
        note: null,
        // The Monday this cycle opened — the ask has stood since then, and
        // dating it "now" would make the clipper's screen look like it only
        // just appeared every time the page is loaded.
        requestedAt: new Date(`${cycleStart}T00:00:00.000Z`),
        campaignTitle: campaign.campaignTitle,
        threshold: resolveDemographicsThreshold(
          campaign.threshold,
          campaign.minPayout
        ),
      });
    }
  }

  if (rounds.length === 0) return [];

  const asks: CampaignAsk[] = [];

  for (const request of rounds) {
    const accounts = await getParticipatingAccounts(request.campaignId, userId);
    // Not a participant of this campaign — it is not asking THIS clipper.
    if (accounts.length === 0) continue;

    // ── Combined-views threshold ──
    // Below the bar the campaign does not ask this clipper at all. Because this
    // function is what the hold is derived from, that also means their earnings
    // here are NOT held — which is the right pairing: money must never be
    // frozen pending a report the clipper is not allowed to file.
    //
    // The bar defaults to the campaign's min_payout (see
    // resolveDemographicsThreshold), so "not asked" and "earns nothing here"
    // are now the same condition rather than two numbers a mod has to keep in
    // sync by hand.
    const threshold = request.threshold;
    const totalViews = accounts.reduce((sum, a) => sum + a.views, 0);
    // The always-request flag also clears the view bar: the whole point is to
    // be asked on accounts that have produced nothing yet, and those are
    // exactly the ones a combined-views threshold filters out.
    if (totalViews < threshold && !(await alwaysRequestsDemographics(userId))) {
      continue;
    }

    // ── Which report answers this ask ──
    //
    // A MODERATOR round is cycle-scoped on purpose: opening one is how a mod
    // says "report again", so last cycle's approval must not satisfy it.
    //
    // An AUTO ask must NOT be. It carries currentCycleStart(), which rolls
    // every Monday, so scoping it to the cycle re-asked clippers who had
    // already reported and been paid — the report simply stopped matching.
    // Nobody raised anything; the calendar did. 15 clippers were sitting in
    // that state when this was reported.
    //
    // So an auto ask looks at the clipper's LATEST report for the account,
    // whatever cycle it came from. Once approved, the campaign stops asking
    // until a moderator actually opens a round.
    const isAutoAsk = request.requestId === null;

    const reports = await db
      .select({
        verifiedUserId: demographics_verification_v2.verified_user_id,
        status: demographics_verification_v2.status,
        exemptionReason: demographics_verification_v2.exemption_reason,
        cycleStart: demographics_verification_v2.cycle_start,
        updatedAt: demographics_verification_v2.updated_at,
      })
      .from(demographics_verification_v2)
      .where(
        and(
          eq(demographics_verification_v2.campaign_id, request.campaignId),
          eq(demographics_verification_v2.user_id, userId),
          ...(isAutoAsk
            ? []
            : [
                eq(
                  demographics_verification_v2.cycle_start,
                  request.cycleStart
                ),
              ]),
          inArray(
            demographics_verification_v2.verified_user_id,
            accounts.map((a) => a.verifiedUserId)
          )
        )
      );

    // Newest first, so the map below keeps the most recent report per account.
    // Cycle first (it is the round the report belongs to), updated_at only to
    // break ties within one cycle — a row can be re-reviewed after submission.
    const sortedReports = [...reports].sort((a, b) => {
      const byCycle = String(b.cycleStart ?? "").localeCompare(
        String(a.cycleStart ?? "")
      );
      if (byCycle !== 0) return byCycle;
      return (
        new Date(b.updatedAt ?? 0).getTime() -
        new Date(a.updatedAt ?? 0).getTime()
      );
    });

    const reportByAccount = new Map<string, (typeof sortedReports)[number]>();
    for (const report of sortedReports) {
      if (!reportByAccount.has(report.verifiedUserId)) {
        reportByAccount.set(report.verifiedUserId, report);
      }
    }

    // ── A placeholder must not shadow a moderator's decision ──
    //
    // "Latest report" alone was not enough. 'created' and 'active' are
    // placeholder rows with nothing in them for a moderator to act on, and
    // 'needs-human-review' is a filing nobody has ruled on yet. When the ask
    // was wrongly repeating, clippers who had ALREADY been approved filed
    // again — so the newest row became an unreviewed one, `approved` went
    // false, and the campaign kept asking and kept holding the money. 91
    // accounts across 41 clippers were in exactly that state, which is why
    // the first fix did not clear the reports.
    //
    // So for an auto ask, the newest row a MODERATOR actually ruled on wins
    // (approved or rejected — a rejection must still re-ask). Only when there
    // is no ruling at all does the newest row stand.
    //
    // Moderator rounds are untouched: they are cycle-scoped, so every row in
    // `reports` already belongs to the round being answered.
    if (isAutoAsk) {
      const DECIDED = new Set(["approved", "rejected"]);
      for (const report of sortedReports) {
        if (!DECIDED.has(String(report.status))) continue;
        const current = reportByAccount.get(report.verifiedUserId);
        if (current && !DECIDED.has(String(current.status))) {
          reportByAccount.set(report.verifiedUserId, report);
        }
      }
    }

    const withStatus: ParticipatingAccount[] = accounts.map((account) => {
      const report = reportByAccount.get(account.verifiedUserId);
      const status = report?.status ?? "missing";
      return {
        ...account,
        status,
        submitted: (SUBMITTED_STATUSES as readonly string[]).includes(status),
        approved: status === "approved",
        // An exemption satisfies the ask exactly like a full report — it is a
        // submission a moderator reviews, and approving it releases this
        // campaign's held base pay. It only forgoes the geo bonus.
        exempt: Boolean(report?.exemptionReason),
      };
    });

    const satisfied = withStatus.every((a) => a.approved);

    // ── A satisfied AUTO ask disappears ──
    //
    // Fixing the logic was not enough on its own: the ask was still returned,
    // just with satisfied=true, so the clipper's screen carried on listing the
    // campaign and offering a Submit button. People who had already reported
    // and been paid still saw a request sitting there, which is the thing that
    // was reported — and filing again is what created the placeholder rows
    // that broke this in the first place.
    //
    // Nothing about the money changes: getClaimableBreakdown already ignores
    // satisfied asks, so dropping them here cannot release or hold a cent.
    // submitForCampaign reads this same helper, so the Submit path closes with
    // the screen — the pairing those two have to keep.
    //
    // Only AUTO asks. A moderator round stays visible even once satisfied: a
    // mod opened it deliberately, and it is theirs to close.
    if (isAutoAsk && satisfied) {
      continue;
    }

    asks.push({
      requestId: request.requestId,
      campaignId: request.campaignId,
      campaignTitle: request.campaignTitle ?? null,
      cycleStart: request.cycleStart,
      note: request.note ?? null,
      requestedAt: request.requestedAt,
      accounts: withStatus,
      satisfied,
    });
  }

  return asks;
}

/**
 * Net money this clipper actually kept from a set of campaigns: reward rows
 * minus clawbacks, plus restores.
 *
 * Mirrors the cap basis in createReward deliberately. Using the gross reward
 * total would over-state what is locked — a clipper whose clips were later
 * deleted and clawed back would find more money frozen than the campaign ever
 * left them with, and could be unable to withdraw a balance they legitimately
 * hold.
 */
async function netEarnedByCampaign(
  userId: string,
  campaignIds: string[]
): Promise<Map<string, number>> {
  const net = new Map<string, number>();
  if (campaignIds.length === 0) return net;

  const rewards = await db
    .select({
      campaignId: campaign_view_rewards.campaign_id,
      total: sql<string>`COALESCE(SUM(${campaign_view_rewards.amount}), 0)`,
    })
    .from(campaign_view_rewards)
    .where(
      and(
        eq(campaign_view_rewards.user_id, userId),
        inArray(campaign_view_rewards.campaign_id, campaignIds)
      )
    )
    .groupBy(campaign_view_rewards.campaign_id);

  for (const row of rewards) net.set(row.campaignId, Number(row.total ?? 0));

  // Clawbacks are negative entries and restores positive, so summing both nets
  // out to what the clipper kept. Joined through submissions because a balance
  // entry only knows its submission, not its campaign.
  const adjustments = await db
    .select({
      campaignId: submissions.campaign_id,
      total: sql<string>`COALESCE(SUM(${balance_entries.amount}), 0)`,
    })
    .from(balance_entries)
    .innerJoin(submissions, eq(balance_entries.source_id, submissions.id))
    .where(
      and(
        eq(balance_entries.user_id, userId),
        inArray(submissions.campaign_id, campaignIds),
        inArray(balance_entries.source_type, [
          "clip_deletion",
          "submission_rejection",
          "noncampaign_uncovered",
          "handle_ban",
          "clip_restore",
          "noncampaign_recovered",
          "reward_restored_reapproval",
        ])
      )
    )
    .groupBy(submissions.campaign_id);

  for (const row of adjustments) {
    net.set(row.campaignId, (net.get(row.campaignId) ?? 0) + Number(row.total ?? 0));
  }

  // A campaign can net negative if clawbacks exceeded rewards. Locking a
  // negative amount would ADD to what a clipper can withdraw, so floor at zero.
  for (const [campaignId, amount] of net) {
    net.set(campaignId, Math.max(0, amount));
  }

  return net;
}

export type LockedCampaign = {
  campaignId: string;
  campaignTitle: string | null;
  amount: number;
  accountsMissing: number;
  accountsAwaitingReview: number;
};

export type ClaimableBreakdown = {
  balance: number;
  /** What the clipper may withdraw right now. */
  claimable: number;
  /** Held back pending demographics, per campaign. */
  locked: LockedCampaign[];
  lockedTotal: number;
};

/**
 * Split the clipper's spendable balance into what they can take out now and
 * what is held pending a campaign's demographics.
 *
 * Derived by SUBTRACTING locked campaigns from the real balance rather than by
 * summing "unlocked" earnings. The balance also holds referral rewards, manual
 * adjustments and refunds that belong to no campaign, and those must never be
 * frozen by a campaign review — summing upward would silently drop them.
 */
export async function getClaimableBreakdown(
  userId: string
): Promise<ClaimableBreakdown> {
  const [balanceRow] = await db
    .select({ balance: balances.balance })
    .from(balances)
    .where(eq(balances.user_id, userId))
    .limit(1);

  const balance = Number(balanceRow?.balance ?? 0);

  const asks = await getCampaignAsksForUser(userId);
  const unsatisfied = asks.filter((ask) => !ask.satisfied);

  if (unsatisfied.length === 0) {
    return { balance, claimable: balance, locked: [], lockedTotal: 0 };
  }

  const net = await netEarnedByCampaign(
    userId,
    unsatisfied.map((a) => a.campaignId)
  );

  // ── Hold only what is still in the wallet ──
  //
  // netEarnedByCampaign returns LIFETIME earnings on a campaign. The balance is
  // what survives past withdrawals. Holding one against the other meant a
  // clipper who had already cashed out was held against money that is no longer
  // there: on production this froze the entire balance of 53 of 58 clippers
  // with an open ask, $1,460 of the $3,291 held being earnings they had already
  // been paid.
  //
  // It also contradicted what the page promises them — "only these campaigns'
  // earnings are held, the rest of your balance stays claimable" — because once
  // the lifetime figure passed the balance it swallowed earnings from campaigns
  // under no hold at all.
  //
  // Withdrawals come out of one pooled balance and carry no campaign of their
  // own, so what is left of a given campaign can only be apportioned, not
  // looked up: each campaign keeps its share of the balance in proportion to
  // what it contributed. Capped at 1 so this can never inflate a hold above the
  // lifetime figure.
  const [allTimeRow] = await db
    .select({
      total: sql<string>`COALESCE(SUM(${campaign_view_rewards.amount}), 0)`,
    })
    .from(campaign_view_rewards)
    .where(eq(campaign_view_rewards.user_id, userId));

  const lifetimeAll = Number(allTimeRow?.total ?? 0);
  const stillInWallet =
    lifetimeAll > 0 ? Math.min(1, balance / lifetimeAll) : 0;

  const locked: LockedCampaign[] = unsatisfied
    .map((ask) => ({
      campaignId: ask.campaignId,
      campaignTitle: ask.campaignTitle,
      amount:
        Math.round((net.get(ask.campaignId) ?? 0) * stillInWallet * 100) / 100,
      accountsMissing: ask.accounts.filter((a) => !a.submitted).length,
      accountsAwaitingReview: ask.accounts.filter(
        (a) => a.submitted && !a.approved
      ).length,
    }))
    .filter((row) => row.amount > 0);

  // Still clamped to the balance: apportioning gets the shares right, but
  // rounding across several campaigns must never add up to more than the wallet
  // holds, or claimable would go negative and the page would again show a hold
  // larger than the balance it is held against.
  const lockedTotal = Math.min(
    balance,
    Math.round(locked.reduce((sum, row) => sum + row.amount, 0) * 100) / 100
  );

  const claimable = Math.max(0, Math.min(balance, balance - lockedTotal));

  return { balance, claimable, locked, lockedTotal };
}

/**
 * Open a reset request for one campaign: close any previous round, clear the
 * reports being re-asked, and return who should be notified.
 *
 * Clearing is scoped to the accounts actually being asked, on the cycle being
 * asked for. The old bulk reset wiped every row on the campaign regardless of
 * whose it was or which week it belonged to.
 */
export async function openResetRequest(opts: {
  campaignId: string;
  requestedBy: string | null;
  note: string | null;
}): Promise<{ requestId: string; cycleStart: string; participants: string[] }> {
  const cycleStart = currentCycleStart();
  const participants = await getCampaignParticipants(opts.campaignId);

  const requestId = await db.transaction(async (tx) => {
    // One open round per campaign. Superseding rather than refusing lets a
    // moderator re-ask after a bad batch without an extra "cancel" step.
    await tx
      .update(demographics_reset_requests)
      .set({ closed_at: new Date() })
      .where(
        and(
          eq(demographics_reset_requests.campaign_id, opts.campaignId),
          isNull(demographics_reset_requests.closed_at)
        )
      );

    const [inserted] = await tx
      .insert(demographics_reset_requests)
      .values({
        campaign_id: opts.campaignId,
        cycle_start: cycleStart,
        requested_by: opts.requestedBy,
        note: opts.note,
        notified_user_count: participants.length,
      })
      .$returningId();

    // Send this cycle's existing reports back to "active" so the clipper is
    // asked again. Scoped to THIS campaign and THIS cycle: a report the clipper
    // filed for another campaign, or for a previous week, is a record of what
    // was true then and must not be erased by a new ask.
    await tx
      .update(demographics_verification_v2)
      .set({
        status: "active",
        approval_method: null,
        screenshot_file_url: null,
        parsed_data: null,
        evidence_video_url: null,
        exemption_reason: null,
      })
      .where(
        and(
          eq(demographics_verification_v2.campaign_id, opts.campaignId),
          eq(demographics_verification_v2.cycle_start, cycleStart)
        )
      );

    return inserted!.id;
  });

  return { requestId, cycleStart, participants };
}

/** Close a campaign's open request without opening a new one. */
export async function closeResetRequest(campaignId: string): Promise<number> {
  const open = await getOpenRequestFor(campaignId);
  if (!open) return 0;
  await db
    .update(demographics_reset_requests)
    .set({ closed_at: new Date() })
    .where(eq(demographics_reset_requests.id, open.id));
  return 1;
}

/** Campaigns with an open ask, for the moderator's overview. */
export async function listOpenRequests() {
  return db
    .select({
      requestId: demographics_reset_requests.id,
      campaignId: demographics_reset_requests.campaign_id,
      campaignTitle: campaigns.title,
      cycleStart: demographics_reset_requests.cycle_start,
      note: demographics_reset_requests.note,
      notifiedUserCount: demographics_reset_requests.notified_user_count,
      requestedAt: demographics_reset_requests.created_at,
    })
    .from(demographics_reset_requests)
    .leftJoin(campaigns, eq(demographics_reset_requests.campaign_id, campaigns.id))
    .where(isNull(demographics_reset_requests.closed_at));
}

// Re-exported so callers that only need the "is anything being asked" answer do
// not have to import the whole module surface.
export const hasOpenRequest = async (campaignId: string) =>
  (await getOpenRequestFor(campaignId)) !== null;

// Kept for the admin screens that list historic rounds.
export const listRequestHistory = (campaignId: string) =>
  db
    .select()
    .from(demographics_reset_requests)
    .where(
      and(
        eq(demographics_reset_requests.campaign_id, campaignId),
        isNotNull(demographics_reset_requests.closed_at)
      )
    );
