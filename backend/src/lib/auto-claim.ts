import { and, eq } from "drizzle-orm";
import { db } from "./db";
import { balances, wise_recipient, wise_withdrawals } from "./schema";
import { getClaimableBreakdown } from "./demographics-reset";
import { MINIMUM_WITHDRAWAL_AMOUNT } from "../routers/wise";

// AUTO-CLAIM AFTER DEMOGRAPHICS APPROVAL
//
// No Claim button. Demographics approval is what releases a hold, so approval
// is the natural moment to raise the withdrawal the clipper would otherwise
// have raised by hand.
//
// WHAT THIS DOES NOT DO: it does not send money. It creates the same
// `requested` withdrawal row that pressing Claim created. An admin still runs
// createBatchPayout to move funds through Wise.
//
// DELIBERATELY BEST-EFFORT. Every reason to skip is a normal state, not a
// failure, and none may break the approval that triggered it - a moderator must
// never see an error because a clipper has not added a bank account yet.
//
//   no payout method  -> skip (createWithdrawalRequests THROWS on a missing
//                        recipient, so this must be checked first)
//   below the $2 floor-> skip (same floor requestMyWithdrawal enforces)
//   already requested -> skip (one outstanding withdrawal at a time)
//   still held        -> skip (another campaign is still asking)
//
// In every skip case the manual path remains available and correct.

export async function autoClaimAfterApproval(
  userId: string
): Promise<{ claimed: true; amount: number } | { claimed: false; reason: string }> {
  try {
    const [row] = await db
      .select()
      .from(balances)
      .leftJoin(wise_recipient, eq(wise_recipient.user_id, balances.user_id))
      .where(eq(balances.user_id, userId))
      .limit(1);

    if (!row) return { claimed: false, reason: "no-balance-row" };

    // Checked BEFORE createWithdrawalRequests, which throws rather than skips
    // when a recipient is missing.
    if (!row.wise_recipient) {
      return { claimed: false, reason: "no-payout-method" };
    }

    const [outstanding] = await db
      .select({ id: wise_withdrawals.id })
      .from(wise_withdrawals)
      .where(
        and(
          eq(wise_withdrawals.user_id, userId),
          eq(wise_withdrawals.status, "requested")
        )
      )
      .limit(1);

    if (outstanding) return { claimed: false, reason: "already-requested" };

    // Only what is genuinely free: another campaign may still hold part of this
    // wallet against its own unanswered request.
    const claim = await getClaimableBreakdown(userId);
    const amount = Math.min(Number(row.balances.balance ?? 0), claim.claimable);

    if (amount < MINIMUM_WITHDRAWAL_AMOUNT) {
      return { claimed: false, reason: "below-minimum" };
    }

    const { createWithdrawalRequestsForUsers } = await import("../routers/wise");
    await createWithdrawalRequestsForUsers([userId]);

    console.info(
      `[auto-claim] raised withdrawal for ${userId} - $${amount.toFixed(2)}`
    );
    return { claimed: true, amount };
  } catch (error) {
    // Never let this break the approval. The moderator's decision must land
    // even if the payout side is unhappy.
    console.error(`[auto-claim] failed for ${userId}`, error);
    return { claimed: false, reason: "error" };
  }
}
