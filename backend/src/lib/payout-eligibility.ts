import { and, eq, inArray } from "drizzle-orm";
import { db } from "./db";
import {
  demographics_verification_v2,
  submissions,
  verified_users,
} from "./schema";
import { currentCycleStart } from "./demographic-cycles";

// ─────────────────────────────────────────────────────────────────────────────
// WEEKLY PAYOUT LOCK
//
// Payouts run weekly, and each cycle a clipper must submit fresh audience
// demographics for every connected account they earn from — and have them
// APPROVED — before they can claim. Without this, geo bonuses would keep paying
// on a stale audience report indefinitely.
//
// The gate is per CYCLE, so it re-arms every week automatically: last week's
// approval does not unlock this week's claim.
//
// Enforced in TWO places on purpose — this helper backs the read-only endpoint
// the UI uses to explain itself, and the withdrawal mutation calls it again
// before moving money. The UI check is a courtesy; the mutation check is the
// actual control.
// ─────────────────────────────────────────────────────────────────────────────

export type AccountDemographicState = {
  verifiedUserId: string;
  handle: string | null;
  platform: string | null;
  // "approved" unlocks. "pending"/"created"/"needs-human-review" mean submitted
  // but awaiting a moderator. "rejected" must be re-submitted. "missing" means
  // nothing has been submitted for this cycle at all.
  status: string;
  submitted: boolean;
};

// Statuses that mean the CLIPPER actually filed a report this cycle. Everything
// else — missing, created, active, rejected, cancelled — means there is nothing
// for a moderator to act on, so the clipper still has work to do.
const SUBMITTED_STATUSES = new Set(["needs-human-review", "pending", "approved"]);

export type PayoutEligibility = {
  eligible: boolean;
  cycleStart: string;
  accounts: AccountDemographicState[];
  missingCount: number;
  awaitingReviewCount: number;
};

export async function getPayoutEligibility(
  userId: string
): Promise<PayoutEligibility> {
  const cycleStart = currentCycleStart();

  // Only accounts the clipper actually earns from need a report. An account
  // with no approved clips can't be holding up a payout.
  const earningAccounts = await db
    .selectDistinct({
      verifiedUserId: verified_users.id,
      handle: verified_users.handle,
      platform: verified_users.platform,
    })
    .from(submissions)
    .innerJoin(
      verified_users,
      eq(submissions.verified_user_id, verified_users.id)
    )
    .where(
      and(eq(submissions.user_id, userId), eq(submissions.status, "approved"))
    );

  if (earningAccounts.length === 0) {
    // Nothing earned from a connected account — nothing to verify, so the
    // lock must not strand them.
    return {
      eligible: true,
      cycleStart,
      accounts: [],
      missingCount: 0,
      awaitingReviewCount: 0,
    };
  }

  const ids = earningAccounts.map((a) => a.verifiedUserId);
  const reports = await db
    .select({
      verifiedUserId: demographics_verification_v2.verified_user_id,
      status: demographics_verification_v2.status,
    })
    .from(demographics_verification_v2)
    .where(
      and(
        eq(demographics_verification_v2.user_id, userId),
        eq(demographics_verification_v2.cycle_start, cycleStart),
        inArray(demographics_verification_v2.verified_user_id, ids)
      )
    );

  // One account can appear on several campaigns in a cycle; a single approval
  // is enough to clear that account for the week.
  const bestByAccount = new Map<string, string>();
  for (const report of reports) {
    const current = bestByAccount.get(report.verifiedUserId);
    if (current === "approved") continue;
    bestByAccount.set(report.verifiedUserId, report.status);
  }

  const accounts: AccountDemographicState[] = earningAccounts.map((account) => {
    const status = bestByAccount.get(account.verifiedUserId) ?? "missing";
    return {
      verifiedUserId: account.verifiedUserId,
      handle: account.handle,
      platform: account.platform,
      status,
      // Whitelist, not a blacklist. "created" and "active" rows are placeholders
      // the payout batch opens on the clipper's behalf — the clipper has not
      // actually filed anything. Counting those as submitted told the clipper
      // their report was "under review" when nothing had been sent, so they'd
      // wait forever for a moderator who could see nothing to review.
      submitted: SUBMITTED_STATUSES.has(status),
    };
  });

  const missingCount = accounts.filter((a) => !a.submitted).length;
  const awaitingReviewCount = accounts.filter(
    (a) => a.submitted && a.status !== "approved"
  ).length;

  return {
    eligible: accounts.every((a) => a.status === "approved"),
    cycleStart,
    accounts,
    missingCount,
    awaitingReviewCount,
  };
}
