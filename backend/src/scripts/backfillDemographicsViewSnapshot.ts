/**
 * BACKFILL: demographics_verifications_v2.views_from_submissions_snapshot
 *
 *   npx tsx src/scripts/backfillDemographicsViewSnapshot.ts          → DRY RUN
 *   npx tsx src/scripts/backfillDemographicsViewSnapshot.ts --apply  → writes
 *
 * ── Why this exists ──
 * The older `submitWeekly` path inserted its rows with
 * `views_from_submissions_snapshot: 0` hardcoded, so every report filed through
 * it recorded no view total. Two things read that column:
 *
 *   1. the moderator's "Views snapshot" column, which showed 0 for those rows;
 *   2. computeDemographicsBreakdown, which WEIGHTS each report by it — so a
 *      0 row contributes nothing to its campaign's country percentages no
 *      matter what audience the clipper reported.
 *
 * The write path is fixed going forward. This repairs the rows already written.
 *
 * ── What it does ──
 * For each affected row, recomputes SUM(submissions.views) over that account's
 * APPROVED, non-deleted clips in that campaign — the same definition
 * getParticipatingAccounts uses, so backfilled rows match freshly-written ones.
 *
 * ── What it deliberately does NOT touch ──
 *   • rows that already carry a non-zero snapshot (never overwrite a real
 *     measurement with a recomputed one — views have moved since);
 *   • rows a moderator has already APPROVED. Those are a settled record, and
 *     re-weighting them would retroactively shift campaign demographics that
 *     may already have been reported to a client. They are counted and listed
 *     at the end so the decision can be made deliberately, not as a side
 *     effect of this script;
 *   • rows whose account genuinely has no approved views — 0 is correct there.
 *
 * Idempotent: a second run finds nothing to do.
 */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../lib/db";
import { demographics_verification_v2, submissions } from "../lib/schema";

const APPLY = process.argv.includes("--apply");

// Everything a moderator has not yet settled. 'approved' is excluded on
// purpose — see the header.
const REPAIRABLE_STATUSES = [
  "created",
  "active",
  "pending",
  "needs-human-review",
  "rejected",
] as const;

async function main() {
  console.log(
    APPLY
      ? "⚠️  APPLY MODE — this will update view snapshots.\n"
      : "DRY RUN — nothing will be written. Re-run with --apply to perform it.\n"
  );

  const candidates = await db
    .select({
      id: demographics_verification_v2.id,
      campaignId: demographics_verification_v2.campaign_id,
      userId: demographics_verification_v2.user_id,
      verifiedUserId: demographics_verification_v2.verified_user_id,
      status: demographics_verification_v2.status,
    })
    .from(demographics_verification_v2)
    .where(
      and(
        eq(demographics_verification_v2.views_from_submissions_snapshot, 0),
        inArray(demographics_verification_v2.status, [...REPAIRABLE_STATUSES])
      )
    );

  console.log(`rows with a 0 snapshot awaiting review: ${candidates.length}`);

  let repaired = 0;
  let genuinelyZero = 0;
  const samples: string[] = [];

  for (const row of candidates) {
    const [totals] = await db
      .select({
        views: sql<number>`COALESCE(SUM(${submissions.views}), 0)`,
      })
      .from(submissions)
      .where(
        and(
          eq(submissions.campaign_id, row.campaignId),
          eq(submissions.user_id, row.userId),
          eq(submissions.verified_user_id, row.verifiedUserId),
          eq(submissions.status, "approved"),
          isNull(submissions.deleted_at)
        )
      );

    const views = Number(totals?.views ?? 0);

    // 0 is the right answer here — leave it alone rather than writing it back.
    if (views <= 0) {
      genuinelyZero += 1;
      continue;
    }

    if (samples.length < 8) {
      samples.push(
        `${row.status.padEnd(19)} ${row.campaignId.slice(0, 16)}… acct ${row.verifiedUserId.slice(0, 8)}… → ${views.toLocaleString()}`
      );
    }

    if (APPLY) {
      await db
        .update(demographics_verification_v2)
        .set({ views_from_submissions_snapshot: views })
        .where(eq(demographics_verification_v2.id, row.id));
    }

    repaired += 1;
  }

  // Reported, never touched — so the call is made deliberately.
  const [approvedZero] = await db
    .select({ n: sql<number>`COUNT(*)` })
    .from(demographics_verification_v2)
    .where(
      and(
        eq(demographics_verification_v2.views_from_submissions_snapshot, 0),
        eq(demographics_verification_v2.status, "approved")
      )
    );

  console.log(`
──────────────── SNAPSHOT BACKFILL ${APPLY ? "APPLIED" : "PLAN"} ────────────────
rows ${APPLY ? "repaired" : "to repair"}        : ${repaired}
left at 0 (no approved views) : ${genuinelyZero}   ← correct, untouched
already-APPROVED rows at 0    : ${Number(approvedZero?.n ?? 0)}   ← NOT touched by design (see header)

sample repairs:
${samples.map((s) => "  " + s).join("\n") || "  (none)"}
${APPLY ? "" : "\nNothing was written. Re-run with --apply when this looks right."}`);

  process.exit(0);
}

main();
