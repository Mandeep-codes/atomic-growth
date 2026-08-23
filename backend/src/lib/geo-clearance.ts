import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "./db";
import {
  balance_entries,
  balances,
  campaign_view_rewards,
} from "./schema";
import { buildGeoBonusResolver } from "./geo-payout";

// ─────────────────────────────────────────────────────────────────────────────
// WEEKLY HOLD → CLEARANCE
//
// A week's earnings are NOT spendable when they are earned. Both the base and
// any geo bonus land in balances.pending_balance and the reward row is marked
// "held". They only become withdrawable once the NEXT cycle's demographics are
// approved, at which point:
//
//   • the BASE always clears — the clipper did the work and the views are real;
//   • the GEO BONUS clears only if that connected account STILL qualifies
//     under the campaign's criteria on the fresh report. If it no longer
//     qualifies, the bonus is cancelled.
//
// Nothing is ever withdrawn and then reversed, so a balance can never go
// negative and no debt/reserve machinery is needed. Cancelling a bonus removes
// money that was never spendable — which is why this is a hold, not a clawback.
//
// The point is anti-gaming: one good report can't be used to farm a bonus and
// then abandoned. The audience ratio has to still hold the week after.
// ─────────────────────────────────────────────────────────────────────────────

// KILL-SWITCH. While false, createReward credits the spendable balance directly
// exactly as it does today and nothing is ever held. Must stay false in
// production until the per-account odometer cutover has run.
export const WEEKLY_HOLD_ENABLED = false;

const round = (value: number) => Math.round(value * 10000) / 10000;

export type ClearanceResult = {
  clearedAmount: number;
  cancelledAmount: number;
  rowsCleared: number;
  rowsCancelled: number;
};

// mysql2 reports how many rows an UPDATE matched in a metadata payload that
// drizzle passes straight through. Every state flip below is guarded with
// `clearance_state = 'held'`, so this count IS the number of rows that actually
// transitioned — which is the only set of rows we are allowed to pay for.
const affectedRows = (result: unknown): number =>
  (result as [{ affectedRows?: number } | undefined])[0]?.affectedRows ?? 0;

/**
 * Clear this clipper's held earnings, re-checking every held row's account
 * against the campaign's geo criteria using the latest approved demographics.
 *
 * Called after a demographic report is APPROVED. Safe to call repeatedly AND
 * concurrently: the held rows are read inside the transaction after the
 * balances row is locked FOR UPDATE, and every state flip is guarded on the row
 * still being "held". A second caller therefore either waits for the first to
 * commit and then finds nothing held, or — if it somehow raced past the read —
 * flips zero rows and credits zero. Money is only ever credited for rows this
 * call itself moved out of "held".
 */
export async function runClearanceForUser(
  userId: string
): Promise<ClearanceResult> {
  const empty: ClearanceResult = {
    clearedAmount: 0,
    cancelledAmount: 0,
    rowsCleared: 0,
    rowsCancelled: 0,
  };
  if (!WEEKLY_HOLD_ENABLED) return empty;

  // Cheap unlocked pre-check: the overwhelmingly common case is a mod approving
  // a report for a clipper with nothing held, and that case should not open a
  // transaction or take a row lock at all. Purely an optimisation — it is never
  // trusted, the authoritative read happens under the lock below.
  const [anyHeld] = await db
    .select({ id: campaign_view_rewards.id })
    .from(campaign_view_rewards)
    .where(
      and(
        eq(campaign_view_rewards.user_id, userId),
        eq(campaign_view_rewards.clearance_state, "held")
      )
    )
    .limit(1);

  if (!anyHeld) return empty;

  return await db.transaction(async (tx) => {
    // Same lock anchor the payout path uses, so a concurrent payout can't
    // interleave with this move between the two balance columns — and so two
    // concurrent clearances for the same clipper (a mod double-clicking approve,
    // two mods at once, a bulk activate) serialize here rather than both
    // crediting the same held rows. Seed the row first: FOR UPDATE on a missing
    // row takes only a gap lock, which does not serialize. Mirrors createReward.
    await tx
      .insert(balances)
      .values({ user_id: userId, balance: 0, totalEarned: 0 })
      .onDuplicateKeyUpdate({ set: { user_id: sql`${balances.user_id}` } });
    await tx
      .select({ user_id: balances.user_id })
      .from(balances)
      .where(eq(balances.user_id, userId))
      .for("update");

    // Re-read the held rows INSIDE the lock. The pre-check above is stale by
    // construction: a clearance that committed while we queued on the lock has
    // already moved those rows and already paid for them.
    //
    // FOR UPDATE, not a plain read: under REPEATABLE READ a consistent read
    // returns the transaction's snapshot, and relying on that snapshot being
    // taken after the balances lock is a subtlety this code should not depend
    // on. A locking read always sees the latest committed rows, and holds them
    // until commit.
    const held = await tx
      .select({
        id: campaign_view_rewards.id,
        campaignId: campaign_view_rewards.campaign_id,
        verifiedUserId: campaign_view_rewards.verified_user_id,
        amount: campaign_view_rewards.amount,
        viewDelta: campaign_view_rewards.view_delta,
        geoBonusCpm: campaign_view_rewards.geo_bonus_cpm,
        platform: campaign_view_rewards.platform,
      })
      .from(campaign_view_rewards)
      .where(
        and(
          eq(campaign_view_rewards.user_id, userId),
          eq(campaign_view_rewards.clearance_state, "held")
        )
      )
      .for("update");

    if (held.length === 0) return empty;

    // One resolver per campaign, reused across that campaign's held rows. This
    // reads the LATEST approved report, which is the report that was just
    // approved — that is exactly the second check the rule describes.
    const resolvers = new Map<
      string,
      Awaited<ReturnType<typeof buildGeoBonusResolver>>
    >();
    for (const row of held) {
      if (!resolvers.has(row.campaignId)) {
        resolvers.set(
          row.campaignId,
          await buildGeoBonusResolver(row.campaignId)
        );
      }
    }

    const toClear: { id: string; amount: number }[] = [];
    const toCancel: { id: string; base: number; cancelled: number }[] = [];

    for (const row of held) {
      const amount = Number(row.amount);
      // The bonus portion is derivable from what was recorded at payout time, so
      // the split never depends on today's rates or today's criteria.
      const bonusPortion = round(
        (Number(row.viewDelta) * Number(row.geoBonusCpm)) / 1000
      );
      const basePortion = round(amount - bonusPortion);

      const stillQualifies =
        bonusPortion <= 0 ||
        (resolvers.get(row.campaignId)?.bonusFor(row.verifiedUserId) ?? 0) > 0;

      if (stillQualifies) {
        toClear.push({ id: row.id, amount });
      } else {
        // Base still clears; only the bonus is withdrawn.
        toCancel.push({ id: row.id, base: basePortion, cancelled: bonusPortion });
      }
    }

    let clearedAmount = 0;
    let cancelledAmount = 0;
    let rowsCleared = 0;
    let rowsCancelled = 0;

    if (toClear.length > 0) {
      // `clearance_state = 'held'` in the WHERE is what makes the credit safe:
      // a row another clearance already moved does not match, so it is not
      // counted and its money is not added a second time.
      const result = await tx
        .update(campaign_view_rewards)
        .set({ clearance_state: "cleared", cleared_at: new Date() })
        .where(
          and(
            inArray(
              campaign_view_rewards.id,
              toClear.map((row) => row.id)
            ),
            eq(campaign_view_rewards.clearance_state, "held")
          )
        );

      rowsCleared = affectedRows(result);
      if (rowsCleared !== toClear.length) {
        // Under the lock this cannot happen; the rows were read moments ago in
        // this same transaction. If it does, some other writer is moving
        // clearance state outside the lock and we cannot tell WHICH rows
        // transitioned — so we must not credit a total derived from all of
        // them. Roll back and let the next approval retry cleanly.
        throw new Error(
          `clearance raced for user ${userId}: expected to clear ${toClear.length} held rows, flipped ${rowsCleared}`
        );
      }
      clearedAmount = toClear.reduce(
        (sum, row) => round(sum + row.amount),
        clearedAmount
      );
    }

    for (const row of toCancel) {
      const result = await tx
        .update(campaign_view_rewards)
        .set({ clearance_state: "cancelled", cleared_at: new Date() })
        .where(
          and(
            eq(campaign_view_rewards.id, row.id),
            eq(campaign_view_rewards.clearance_state, "held")
          )
        );

      // Same guard, per row: only a row this call moved out of "held" releases
      // its base pay and gets an audit entry.
      if (affectedRows(result) === 0) continue;

      rowsCancelled += 1;
      clearedAmount = round(clearedAmount + row.base);
      cancelledAmount = round(cancelledAmount + row.cancelled);

      // Audit trail for the withdrawn bonus. Recorded as a zero-value note
      // rather than a negative balance movement, because the money never
      // reached the spendable balance — writing it as a debit would understate
      // what the clipper actually earned.
      await tx.insert(balance_entries).values({
        user_id: userId,
        amount: 0,
        type: "manual_adjustment",
        source_type: "geo_bonus_cancelled",
        source_id: row.id,
        memo: `Geo bonus of $${row.cancelled.toFixed(
          2
        )} not released — this account no longer met the campaign's audience criteria on the latest approved demographics. Base pay was released in full.`,
      });
    }

    if (rowsCleared === 0 && rowsCancelled === 0) return empty;

    // Move the whole held amount out of pending; only the cleared part lands in
    // the spendable balance. totalEarned counts confirmed money only, so a
    // cancelled bonus never inflates lifetime earnings.
    const totalHeld = round(clearedAmount + cancelledAmount);

    await tx
      .update(balances)
      .set({
        pending_balance: sql`GREATEST(${balances.pending_balance} - ${totalHeld}, 0)`,
        balance: sql`${balances.balance} + ${clearedAmount}`,
        totalEarned: sql`${balances.totalEarned} + ${clearedAmount}`,
      })
      .where(eq(balances.user_id, userId));

    return { clearedAmount, cancelledAmount, rowsCleared, rowsCancelled };
  });
}
