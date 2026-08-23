import { and, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { balance_entries, balances, submissions } from "./schema";

// Generic reversal of a prior clawback on a submission. Re-credits the NET
// amount still owed back (sum of clawbacks of `clawbackSourceType`, minus any
// prior reversals of `reverseSourceType`) — so repeated
// clawback→reverse→clawback cycles can never double-credit. Optionally
// reinstates submissions.reward so the campaign dashboard total recovers too.
//
// Used by both the deleted-clip "Restore" button and non-campaign-clip
// re-coverage (when a fresh non-campaign clip re-covers a campaign clip whose
// reward was deducted because the previous cover was rejected/deleted).
//
// Concurrency: the two SUMs and the re-credit all run INSIDE the transaction
// after taking a FOR UPDATE lock on the user's balance row. This serializes
// restore against (a) a concurrent deleted-clip reserve collection (which
// also locks that balance row and inserts a `clip_deletion` debit) and (b) a
// second concurrent/double-clicked restore. Without the lock, the SUM could
// be read before a concurrent collection's debit committed, re-crediting a
// stale total and shorting or double-paying the clipper.
export async function reverseClawback(opts: {
  submissionId: string;
  clawbackSourceType: string;
  reverseSourceType: string;
  memo: string;
  reinstateReward?: boolean;
}): Promise<{ restored: number }> {
  const {
    submissionId,
    clawbackSourceType,
    reverseSourceType,
    memo,
    reinstateReward = true,
  } = opts;

  const [sub] = await db
    .select({ user_id: submissions.user_id })
    .from(submissions)
    .where(eq(submissions.id, submissionId))
    .limit(1);
  if (!sub) return { restored: 0 };

  return db.transaction(async (tx) => {
    // Serialize against concurrent collections/restores on this user's wallet.
    await tx.execute(
      sql`select 1 from ${balances} where ${balances.user_id} = ${sub.user_id} for update`
    );

    const sumOf = async (sourceType: string) => {
      const [row] = await tx
        .select({
          total: sql<number>`COALESCE(SUM(${balance_entries.amount}), 0)`,
        })
        .from(balance_entries)
        .where(
          and(
            eq(balance_entries.source_id, submissionId),
            eq(balance_entries.source_type, sourceType)
          )
        );
      return Number(row?.total ?? 0);
    };

    const clawed = await sumOf(clawbackSourceType); // negative
    const reversed = await sumOf(reverseSourceType); // positive
    const amount = Math.max(0, Number((-clawed - reversed).toFixed(4)));
    if (amount <= 0) return { restored: 0 };

    if (reinstateReward) {
      // ADD, don't SET: under delta-based scoreboard pricing a clip can keep
      // accruing reward while its clawback is outstanding (e.g. an uncovered
      // campaign clip stays approved and in the view cron). Overwriting with
      // the old clawed amount would silently discard that accrual.
      await tx
        .update(submissions)
        .set({ reward: sql`${submissions.reward} + ${amount}` })
        .where(eq(submissions.id, submissionId));
    }
    await tx.insert(balance_entries).values({
      user_id: sub.user_id,
      amount,
      type: "manual_adjustment",
      memo,
      source_type: reverseSourceType,
      source_id: submissionId,
      metadata: { version: "v1", type: "manual_adjustment", reason: memo },
    });
    await tx
      .insert(balances)
      .values({ user_id: sub.user_id, balance: amount, totalEarned: amount })
      .onDuplicateKeyUpdate({
        set: {
          balance: sql`${balances.balance} + ${amount}`,
          totalEarned: sql`${balances.totalEarned} + ${amount}`,
        },
      });

    return { restored: amount };
  });
}
