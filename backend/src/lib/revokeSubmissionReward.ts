import { and, eq, sql } from "drizzle-orm";
import { db } from "./db";
import {
  balance_entries,
  balances,
  deleted_clip_reserves,
  submissions,
} from "./schema";

interface RevokeSubmissionRewardOptions {
  submissionId: string;
  userId: string;
  rewardAmount: number;
  memo: string;
  reason: string;
  sourceType: string;
  // Feature 3 (debt carryover): when true, deduct the FULL amount even if it
  // pushes the balance negative — the clipper then owes it, and future
  // earnings pay it down. Used for deleted-clip clawbacks. Defaults to false
  // (the historical "never go below 0" behaviour) so manual-rejection
  // clawbacks are unchanged.
  allowNegative?: boolean;
  // Deleted-clip RESERVE mode. When set, the clawback NEVER goes negative:
  // it takes only what the wallet holds (down to zero) and records the
  // shortfall as an outstanding reserve tied to this clip, so a mod can
  // collect the rest later from the "Deleted clips" panel. Overrides
  // allowNegative. The snapshot fields describe the reel for that panel.
  reserveOnShortfall?: {
    campaignId: string;
    url: string | null;
    platform: string | null;
    views: number;
  };
}

export async function revokeSubmissionReward({
  submissionId,
  userId,
  rewardAmount,
  memo,
  reason,
  sourceType,
  allowNegative = false,
  reserveOnShortfall,
}: RevokeSubmissionRewardOptions) {
  const rewardToRevoke = Number(rewardAmount ?? 0);

  if (rewardToRevoke <= 0) {
    return { deducted: 0, shortfall: 0, reserved: false };
  }

  // ── Reserve mode: cap at zero, record the shortfall as a reserve ──
  // Used by ALL three clawback types now (deletion, rejection, NC-uncover):
  // never drives the wallet negative — takes only what's there and records
  // the rest as a collectible reserve. reason = the sourceType, so the panel
  // labels it and collections/reversals key off the right source_type.
  if (reserveOnShortfall) {
    const isDeletion = sourceType === "clip_deletion";
    return db.transaction(async (tx) => {
      // Serialize on the submission row (concurrent collections/restores and
      // the other clawback paths also touch this clip).
      await tx.execute(
        sql`select 1 from ${submissions} where ${submissions.id} = ${submissionId} for update`
      );
      // ATOMIC CLAWBACK CLAIM — deletion only. The view cron and the manual
      // clawback check deleted_clawed_back UNLOCKED, so two can both see it
      // false and both reach here; the loser sees the flag set and bails.
      // Rejection/uncover don't use the flag: their callers zero `reward`
      // (rejection sets it before calling; the NC cascade guards on reward>0
      // and !deleted_clawed_back), so a repeat call passes rewardAmount 0 and
      // no-ops at the top of this function — same idempotency, no flag.
      if (isDeletion) {
        const [subRow] = await tx
          .select({ clawed: submissions.deleted_clawed_back })
          .from(submissions)
          .where(eq(submissions.id, submissionId))
          .limit(1);
        if (!subRow || subRow.clawed) {
          return { deducted: 0, shortfall: 0, reserved: false };
        }
      }

      // Lock the balance row so the read-modify-write can't race a concurrent
      // reserve collection or restore (both also lock this row).
      await tx.execute(
        sql`select 1 from ${balances} where ${balances.user_id} = ${userId} for update`
      );

      const [balanceRow] = await tx
        .select({ balance: balances.balance })
        .from(balances)
        .where(eq(balances.user_id, userId))
        .limit(1);

      const available = Math.max(0, Number(balanceRow?.balance ?? 0));
      const deduction = Math.min(rewardToRevoke, available);
      const shortfall = Number((rewardToRevoke - deduction).toFixed(4));

      if (deduction > 0) {
        await tx.insert(balance_entries).values({
          user_id: userId,
          amount: -deduction,
          type: "manual_adjustment",
          memo,
          source_type: sourceType,
          source_id: submissionId,
          metadata: { version: "v1", type: "manual_adjustment", reason },
        });

        await tx
          .insert(balances)
          .values({
            user_id: userId,
            balance: -deduction,
            totalEarned: -deduction,
          })
          .onDuplicateKeyUpdate({
            set: {
              balance: sql`${balances.balance} - ${deduction}`,
              totalEarned: sql`${balances.totalEarned} - ${deduction}`,
            },
          });
      }

      // Zero the scoreboard; set the deletion claim flag only for deletions.
      await tx
        .update(submissions)
        .set(isDeletion ? { reward: 0, deleted_clawed_back: true } : { reward: 0 })
        .where(eq(submissions.id, submissionId));

      // Only open a reserve if money is still owed after emptying the wallet.
      if (shortfall > 0) {
        await tx
          .insert(deleted_clip_reserves)
          .values({
            submission_id: submissionId,
            user_id: userId,
            campaign_id: reserveOnShortfall.campaignId,
            url: reserveOnShortfall.url,
            platform: reserveOnShortfall.platform,
            views: reserveOnShortfall.views,
            total_owed: rewardToRevoke,
            clawed_amount: deduction,
            status: "outstanding",
            reason: sourceType,
          })
          // submission_id is unique. A row can pre-exist from a PRIOR clawback
          // cycle later reversed (which voids the reserve). This is a genuine
          // re-clawback, so reset it to a fresh outstanding one.
          .onDuplicateKeyUpdate({
            set: {
              user_id: userId,
              campaign_id: reserveOnShortfall.campaignId,
              url: reserveOnShortfall.url,
              platform: reserveOnShortfall.platform,
              views: reserveOnShortfall.views,
              total_owed: rewardToRevoke,
              clawed_amount: deduction,
              status: "outstanding",
              reason: sourceType,
              updated_at: new Date(),
            },
          });
      }

      return { deducted: deduction, shortfall, reserved: shortfall > 0 };
    });
  }

  let deductionAmount = rewardToRevoke;

  if (!allowNegative) {
    const [currentBalance] = await db
      .select({ balance: balances.balance })
      .from(balances)
      .where(eq(balances.user_id, userId))
      .limit(1);

    const outstandingBalance = Number(currentBalance?.balance ?? 0);

    if (outstandingBalance <= 0) {
      return { deducted: 0, shortfall: rewardToRevoke, reserved: false };
    }

    deductionAmount = Math.min(rewardToRevoke, outstandingBalance);

    if (deductionAmount <= 0) {
      return { deducted: 0, shortfall: rewardToRevoke, reserved: false };
    }
  }

  await db.transaction(async (tx) => {
    await tx.insert(balance_entries).values({
      user_id: userId,
      amount: -deductionAmount,
      type: "manual_adjustment",
      memo,
      source_type: sourceType,
      source_id: submissionId,
      metadata: {
        version: "v1",
        type: "manual_adjustment",
        reason,
      },
    });

    await tx
      .update(submissions)
      .set({ reward: 0 })
      .where(eq(submissions.id, submissionId));

    await tx
      .insert(balances)
      .values({
        user_id: userId,
        balance: -deductionAmount,
        totalEarned: -deductionAmount,
      })
      .onDuplicateKeyUpdate({
        set: {
          balance: sql`${balances.balance} - ${deductionAmount}`,
          totalEarned: sql`${balances.totalEarned} - ${deductionAmount}`,
        },
      });
  });

  return {
    deducted: deductionAmount,
    shortfall: Number((rewardToRevoke - deductionAmount).toFixed(4)),
    reserved: false,
  };
}

// Void any OUTSTANDING reserve for a clip that has come back into good
// standing (rejection re-approved, or NC-uncovered clip re-covered). The
// clawed money itself is returned by reverseClawback (net-aware, keyed on
// source_type); this cancels the still-uncollected remainder so a mod can't
// keep collecting a debt the clipper no longer owes. Optionally scoped by
// reason so a re-approval doesn't void an unrelated deletion reserve.
export async function voidOutstandingReserve(
  submissionId: string,
  reason?: string
): Promise<void> {
  await db
    .update(deleted_clip_reserves)
    .set({ status: "voided" })
    .where(
      reason
        ? and(
            eq(deleted_clip_reserves.submission_id, submissionId),
            eq(deleted_clip_reserves.status, "outstanding"),
            eq(deleted_clip_reserves.reason, reason)
          )
        : and(
            eq(deleted_clip_reserves.submission_id, submissionId),
            eq(deleted_clip_reserves.status, "outstanding")
          )
    );
}
