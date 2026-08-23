import { and, eq, isNull, or } from "drizzle-orm";
import { db } from "./db";
import { deleted_clip_reserves, submissions } from "./schema";
import { reverseClawback } from "./reverseClawback";

// Feature 1 "Restore" — the manual undo for a clip flagged deleted. Clears the
// deletion flags so the clip re-enters the view cron, then reverses the
// clawback exactly (re-credits net of any prior restores + reinstates reward).
export async function restoreDeletedSubmission(submissionId: string) {
  const [sub] = await db
    .select({ id: submissions.id })
    .from(submissions)
    .where(eq(submissions.id, submissionId))
    .limit(1);
  if (!sub) throw new Error("Submission not found");

  await db
    .update(submissions)
    .set({
      deleted_at: null,
      unavailable_strikes: 0,
      unavailable_since: null,
      deleted_clawed_back: false,
    })
    .where(eq(submissions.id, submissionId));

  const { restored } = await reverseClawback({
    submissionId,
    clawbackSourceType: "clip_deletion",
    reverseSourceType: "clip_restore",
    memo: "Clip restored — deletion clawback reversed",
    reinstateReward: true,
  });

  // Void any outstanding deferred reserve for this clip: the clip is back, so
  // the clipper no longer owes the un-clawed shortfall. reverseClawback above
  // already re-credited whatever was actually taken; the reserve only tracked
  // the part that was never taken, so it just closes with nothing to collect.
  // Void ONLY the DELETION reserve (reason clip_deletion, or legacy null).
  // A clip can also carry a rejection/uncover reserve; restoring the deletion
  // must not cancel that still-owed, unrelated debt — those are voided by
  // their own re-approval / re-cover paths.
  await db
    .update(deleted_clip_reserves)
    .set({ status: "voided" })
    .where(
      and(
        eq(deleted_clip_reserves.submission_id, submissionId),
        eq(deleted_clip_reserves.status, "outstanding"),
        or(
          eq(deleted_clip_reserves.reason, "clip_deletion"),
          isNull(deleted_clip_reserves.reason)
        )
      )
    );

  return { submissionId, restoredAmount: restored };
}
