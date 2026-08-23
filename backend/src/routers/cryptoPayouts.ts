import { TRPCError } from "@trpc/server";
import { and, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { z } from "zod";
import { userNotBanned } from "../lib/banPurge";
import { db } from "../lib/db";
import {
  balance_entries,
  balances,
  crypto_payout_batches,
  crypto_payout_methods,
  crypto_withdrawals,
  banned_users,
  user_clerk,
} from "../lib/schema";
import {
  payoutsAdminRoleProcedure,
  protectedProcedure,
  router,
} from "../lib/trpc";
import {
  CRYPTO_PAYOUT_OPTION_BY_CURRENCY,
  isAllowedCryptoCurrency,
} from "../shared/cryptoPayoutOptions";
import { getClaimableBreakdown } from "../lib/demographics-reset";

// ── Crypto payouts (manual) ─────────────────────────────────────────────────
// Clippers save a crypto destination (currency/network/address) and claim a
// chosen amount, which debits their balance into a "requested" crypto_withdrawals
// row (mirrors the Wise flow). Payment itself is MANUAL: an admin reads the
// destinations off the Crypto Payouts panel, sends the crypto by hand from our
// own wallet, and marks each entry paid. The panel is an organizer — group
// entries into labelled batches (batched entries leave the main list and live
// only inside their folder) and export CSVs.
//
// Row states:
//   requested             → claimed, unpaid, balance debited (returnable)
//   requested + batch_id   → same, but filed into a batch folder
//   paid                   → TERMINAL settlement (money finalized, NOT returnable)
//   returned               → admin sent it back to the clipper's balance
// "paid" is the settlement point in the system: once paid, the claim cannot be
// returned to balance.

const addMethodInput = z.object({
  npCurrency: z.string().min(1),
  address: z.string().trim().min(20, "That address looks too short").max(120),
  memo: z.string().trim().max(120).optional(),
  label: z.string().trim().max(100).optional(),
});

export const cryptoPayoutsRouter = router({
  // ── Clipper side (public: every logged-in clipper) ────────────────────────

  getMyMethods: protectedProcedure.query(async ({ ctx }) => {
    const methods = await db
      .select()
      .from(crypto_payout_methods)
      .where(eq(crypto_payout_methods.user_id, ctx.user.id))
      .orderBy(desc(crypto_payout_methods.created_at));
    return methods.map((m) => ({
      id: m.id,
      npCurrency: m.np_currency,
      address: m.address,
      memo: m.memo,
      label: m.label,
    }));
  }),

  addMethod: protectedProcedure
    .input(addMethodInput)
    .mutation(async ({ ctx, input }) => {
      if (!isAllowedCryptoCurrency(input.npCurrency)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "That currency/network is not supported. We only pay USDT/USDC on low-fee networks (BNB Smart Chain, Solana, Polygon, TON, Base).",
        });
      }
      const [existing] = await db
        .select({ id: crypto_payout_methods.id })
        .from(crypto_payout_methods)
        .where(
          and(
            eq(crypto_payout_methods.user_id, ctx.user.id),
            eq(crypto_payout_methods.np_currency, input.npCurrency),
            eq(crypto_payout_methods.address, input.address)
          )
        )
        .limit(1);
      if (existing) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You already saved this address for this currency.",
        });
      }
      await db.insert(crypto_payout_methods).values({
        user_id: ctx.user.id,
        np_currency: input.npCurrency,
        address: input.address,
        memo: input.memo || null,
        label: input.label || null,
      });
    }),

  deleteMethod: protectedProcedure
    .input(z.object({ methodId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Historical crypto_withdrawals keep their frozen copy of the
      // destination, so deleting the method never orphans an audit trail.
      const [inFlight] = await db
        .select({ id: crypto_withdrawals.id })
        .from(crypto_withdrawals)
        .where(
          and(
            eq(crypto_withdrawals.method_id, input.methodId),
            eq(crypto_withdrawals.status, "requested")
          )
        )
        .limit(1);
      if (inFlight) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "This address has a claim in flight. Wait for it to be paid (or cancel the claim) first.",
        });
      }
      await db
        .delete(crypto_payout_methods)
        .where(
          and(
            eq(crypto_payout_methods.id, input.methodId),
            eq(crypto_payout_methods.user_id, ctx.user.id)
          )
        );
    }),

  getMyOutstandingWithdrawal: protectedProcedure.query(async ({ ctx }) => {
    const [row] = await db
      .select()
      .from(crypto_withdrawals)
      .where(
        and(
          eq(crypto_withdrawals.user_id, ctx.user.id),
          eq(crypto_withdrawals.status, "requested")
        )
      )
      .orderBy(desc(crypto_withdrawals.created_at))
      .limit(1);
    if (!row) return null;
    return {
      id: row.id,
      amount: row.amount,
      npCurrency: row.np_currency,
      address: row.address,
      createdAt: row.created_at,
    };
  }),

  // A chosen amount of the current balance. One queued crypto claim at a time.
  requestMyWithdrawal: protectedProcedure
    .input(
      z.object({
        methodId: z.string(),
        amount: z.number().positive("Enter an amount greater than 0"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const cancellations = await db
        .select({ id: balance_entries.id })
        .from(balance_entries)
        .where(
          and(
            eq(balance_entries.user_id, ctx.user.id),
            eq(balance_entries.type, "withdrawal_cancellation"),
            gt(
              balance_entries.created_at,
              new Date(Date.now() - 1000 * 60 * 60 * 24)
            )
          )
        );
      if (cancellations.length > 2) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You have reached the maximum number of withdrawals for today.",
        });
      }

      const [method] = await db
        .select()
        .from(crypto_payout_methods)
        .where(
          and(
            eq(crypto_payout_methods.id, input.methodId),
            eq(crypto_payout_methods.user_id, ctx.user.id)
          )
        )
        .limit(1);
      if (!method) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Add a crypto address before claiming.",
        });
      }

      // Round DOWN to cents so a claim can never debit more than the balance.
      const amount = Math.floor(input.amount * 100) / 100;
      if (amount <= 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Enter an amount greater than 0.",
        });
      }

      // Resolved before the transaction: it runs several queries of its own and
      // holding the balance lock across them would widen the window every other
      // payout path contends on. Re-applied against the locked balance below.
      const claim = await getClaimableBreakdown(ctx.user.id);

      await db.transaction(async (tx) => {
        await tx.execute(
          sql`select 1 from ${balances} where ${balances.user_id} = ${ctx.user.id} for update`
        );

        const [existing] = await tx
          .select({ id: crypto_withdrawals.id })
          .from(crypto_withdrawals)
          .where(
            and(
              eq(crypto_withdrawals.user_id, ctx.user.id),
              eq(crypto_withdrawals.status, "requested")
            )
          )
          .limit(1);
        if (existing) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "You already have a queued crypto claim. Wait for it to be paid or cancel it before claiming again.",
          });
        }

        const [balanceRow] = await tx
          .select({ balance: balances.balance })
          .from(balances)
          .where(eq(balances.user_id, ctx.user.id))
          .limit(1);
        const balance = Number(balanceRow?.balance ?? 0);
        if (balance <= 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "You need a positive balance to request a payout.",
          });
        }
        if (amount > balance) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `You can only claim up to your available balance ($${balance.toFixed(
              2
            )}).`,
          });
        }

        // ── Campaign-scoped demographics hold ──
        // Only the campaigns with an open request are held, and only by what
        // was earned on them. Applied against the balance read under the lock
        // so a payout landing mid-request can't carry held money out with it.
        const spendable = Math.max(0, balance - claim.lockedTotal);
        if (amount > spendable) {
          const names = claim.locked
            .map((row) => row.campaignTitle ?? "a campaign")
            .slice(0, 3)
            .join(", ");
          throw new TRPCError({
            code: "FORBIDDEN",
            message: `You can claim up to $${spendable.toFixed(2)} right now — $${claim.lockedTotal.toFixed(
              2
            )} is on hold pending demographics${
              names ? ` for ${names}` : ""
            }. Submit them to release it.`,
          });
        }

        await tx
          .update(balances)
          .set({ balance: sql`${balances.balance} - ${amount}` })
          .where(eq(balances.user_id, ctx.user.id));

        const balanceEntryId = randomUUID();
        const withdrawalId = randomUUID();
        await tx.insert(balance_entries).values({
          id: balanceEntryId,
          user_id: ctx.user.id,
          amount: -amount,
          type: "withdrawal",
          source_type: "crypto_withdrawal",
          source_id: withdrawalId,
          memo: `Crypto payout claim (${method.np_currency})`,
        });
        await tx.insert(crypto_withdrawals).values({
          id: withdrawalId,
          user_id: ctx.user.id,
          method_id: method.id,
          np_currency: method.np_currency,
          address: method.address,
          memo: method.memo,
          amount,
          balance_entry_id: balanceEntryId,
          external_id: randomUUID(),
        });
      });
    }),

  cancelMyRequestedWithdrawal: protectedProcedure
    .input(z.object({ withdrawalId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(crypto_withdrawals)
          .where(
            and(
              eq(crypto_withdrawals.id, input.withdrawalId),
              eq(crypto_withdrawals.user_id, ctx.user.id),
              eq(crypto_withdrawals.status, "requested")
            )
          )
          .limit(1)
          .for("update");
        if (!row) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "No queued crypto claim to cancel.",
          });
        }
        // A claim filed into a batch is being processed for payment — the
        // clipper can't yank it back.
        if (row.batch_id) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "This claim is being processed for payment. Contact support if you need it cancelled.",
          });
        }
        await tx.execute(
          sql`select 1 from ${balances} where ${balances.user_id} = ${ctx.user.id} for update`
        );
        await tx
          .update(balances)
          .set({ balance: sql`${balances.balance} + ${row.amount}` })
          .where(eq(balances.user_id, ctx.user.id));
        await tx.insert(balance_entries).values({
          user_id: ctx.user.id,
          amount: row.amount,
          type: "withdrawal_cancellation",
          source_type: "crypto_withdrawal",
          source_id: row.id,
          memo: "Crypto payout claim cancelled",
        });
        await tx
          .delete(crypto_withdrawals)
          .where(eq(crypto_withdrawals.id, row.id));
      });
    }),

  // ── Admin: Crypto Payouts panel ───────────────────────────────────────────

  // Every unbatched crypto claim — the panel's main list. Batched claims drop
  // out of here and show only inside their batch folder (listBatches).
  getPayoutCandidates: payoutsAdminRoleProcedure.query(async () => {
    const rows = await db
      .select({
        withdrawalId: crypto_withdrawals.id,
        userId: crypto_withdrawals.user_id,
        amount: crypto_withdrawals.amount,
        npCurrency: crypto_withdrawals.np_currency,
        address: crypto_withdrawals.address,
        memo: crypto_withdrawals.memo,
        methodId: crypto_withdrawals.method_id,
        status: crypto_withdrawals.status,
        requestedAt: crypto_withdrawals.created_at,
        userEmail: user_clerk.email,
        userDiscordUsername: user_clerk.discord_username,
        userFirstName: user_clerk.first_name,
        userLastName: user_clerk.last_name,
      })
      .from(crypto_withdrawals)
      .leftJoin(
        user_clerk,
        eq(user_clerk.discord_id, crypto_withdrawals.user_id)
      )
      .where(
        and(
          inArray(crypto_withdrawals.status, ["requested", "paid"]),
          isNull(crypto_withdrawals.batch_id),
          // A banned clipper never appears in the payout picker. Banning only
          // cancelled Wise claims, so crypto claims survived a ban intact and
          // could be batched, exported and hand-sent with no ban indicator.
          userNotBanned(crypto_withdrawals.user_id)
        )
      )
      .orderBy(desc(crypto_withdrawals.created_at));
    return rows.map(mapPayoutRow);
  }),

  returnWithdrawalToBalance: payoutsAdminRoleProcedure
    .input(z.object({ withdrawalId: z.string() }))
    .mutation(async ({ input }) => {
      await db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(crypto_withdrawals)
          .where(eq(crypto_withdrawals.id, input.withdrawalId))
          .limit(1)
          .for("update");
        // Only UNPAID claims can be returned. A paid claim is settled.
        if (!row || row.status !== "requested") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Only unpaid claims can be returned to balance.",
          });
        }
        await tx.execute(
          sql`select 1 from ${balances} where ${balances.user_id} = ${row.user_id} for update`
        );
        await tx
          .update(balances)
          .set({ balance: sql`${balances.balance} + ${row.amount}` })
          .where(eq(balances.user_id, row.user_id));
        await tx.insert(balance_entries).values({
          user_id: row.user_id,
          amount: row.amount,
          type: "withdrawal_refund",
          source_type: "crypto_withdrawal_return",
          source_id: row.id,
          memo: "Crypto claim returned to balance by admin",
        });
        await tx
          .update(crypto_withdrawals)
          .set({ status: "returned", batch_id: null })
          .where(eq(crypto_withdrawals.id, row.id));
      });
    }),

  // File selected UNPAID/PAID claims into a new labelled batch. Batched claims
  // leave the main list and show only inside the batch folder.
  createBatch: payoutsAdminRoleProcedure
    .input(
      z.object({
        batchTitle: z.string().trim().min(1).max(100),
        withdrawalIds: z.array(z.string()).min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return await db.transaction(async (tx) => {
        const rows = await tx
          .select({ id: crypto_withdrawals.id })
          .from(crypto_withdrawals)
          .where(
            and(
              inArray(crypto_withdrawals.id, input.withdrawalIds),
              inArray(crypto_withdrawals.status, ["requested", "paid"]),
              isNull(crypto_withdrawals.batch_id),
              // Re-check at batch time, not just in the picker: a ban can
              // land between a mod loading the page and clicking Create.
              userNotBanned(crypto_withdrawals.user_id)
            )
          )
          .for("update");
        if (rows.length === 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "None of the selected claims are available to batch.",
          });
        }
        const [batchRow] = await tx
          .insert(crypto_payout_batches)
          .values({
            title: input.batchTitle,
            status: "open",
            created_by: ctx.user.id,
          })
          .$returningId();
        if (!batchRow) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to create the batch.",
          });
        }
        await tx
          .update(crypto_withdrawals)
          .set({ batch_id: batchRow.id })
          .where(
            inArray(
              crypto_withdrawals.id,
              rows.map((r) => r.id)
            )
          );
        return { batchId: batchRow.id, count: rows.length };
      });
    }),

  // Pull a claim back out of its batch (returns it to the main list).
  removeFromBatch: payoutsAdminRoleProcedure
    .input(z.object({ withdrawalId: z.string() }))
    .mutation(async ({ input }) => {
      await db
        .update(crypto_withdrawals)
        .set({ batch_id: null })
        .where(eq(crypto_withdrawals.id, input.withdrawalId));
    }),

  // Rename / relabel a batch.
  renameBatch: payoutsAdminRoleProcedure
    .input(
      z.object({ batchId: z.string(), title: z.string().trim().min(1).max(100) })
    )
    .mutation(async ({ input }) => {
      await db
        .update(crypto_payout_batches)
        .set({ title: input.title })
        .where(eq(crypto_payout_batches.id, input.batchId));
    }),

  // Delete an (empty) batch. Refuses if it still holds claims.
  deleteBatch: payoutsAdminRoleProcedure
    .input(z.object({ batchId: z.string() }))
    .mutation(async ({ input }) => {
      const [held] = await db
        .select({ id: crypto_withdrawals.id })
        .from(crypto_withdrawals)
        .where(eq(crypto_withdrawals.batch_id, input.batchId))
        .limit(1);
      if (held) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "This batch still has claims in it. Remove or return them first.",
        });
      }
      await db
        .delete(crypto_payout_batches)
        .where(eq(crypto_payout_batches.id, input.batchId));
    }),

  // Mark a claim paid — the TERMINAL settlement (money already left the
  // clipper's balance at claim time; this finalizes it). Works whether or not
  // the claim is in a batch. Idempotent.
  markPaid: payoutsAdminRoleProcedure
    .input(z.object({ withdrawalId: z.string() }))
    .mutation(async ({ input }) => {
      const [row] = await db
        .select({ status: crypto_withdrawals.status, user_id: crypto_withdrawals.user_id })
        .from(crypto_withdrawals)
        .where(eq(crypto_withdrawals.id, input.withdrawalId))
        .limit(1);
      if (!row) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Unknown claim." });
      }
      if (row.status === "returned") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "This claim was returned to balance and can't be marked paid.",
        });
      }
      // markPaid flips the claim to a TERMINAL state that can never be
      // returned, so it must not be reachable for a banned clipper. If the
      // crypto genuinely went out before the ban, lift the ban, settle it,
      // and re-ban — a deliberate two-step beats a silent one-way write.
      const [banned] = await db
        .select({ userId: banned_users.user_id })
        .from(banned_users)
        .where(eq(banned_users.user_id, row.user_id))
        .limit(1);
      if (banned) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "This clipper is banned. Marking their claim paid is blocked — reconcile it manually before settling.",
        });
      }
      await db
        .update(crypto_withdrawals)
        .set({ status: "paid" })
        .where(eq(crypto_withdrawals.id, input.withdrawalId));
    }),

  // Undo a paid mark (only if it was tagged by mistake — before real payment).
  markUnpaid: payoutsAdminRoleProcedure
    .input(z.object({ withdrawalId: z.string() }))
    .mutation(async ({ input }) => {
      await db
        .update(crypto_withdrawals)
        .set({ status: "requested" })
        .where(
          and(
            eq(crypto_withdrawals.id, input.withdrawalId),
            eq(crypto_withdrawals.status, "paid")
          )
        );
    }),

  // Batch folders + their claims.
  listBatches: payoutsAdminRoleProcedure.query(async () => {
    const batches = await db
      .select()
      .from(crypto_payout_batches)
      .orderBy(desc(crypto_payout_batches.created_at))
      .limit(200);
    if (batches.length === 0) return [];
    const items = await db
      .select({
        withdrawalId: crypto_withdrawals.id,
        batchId: crypto_withdrawals.batch_id,
        userId: crypto_withdrawals.user_id,
        amount: crypto_withdrawals.amount,
        npCurrency: crypto_withdrawals.np_currency,
        address: crypto_withdrawals.address,
        memo: crypto_withdrawals.memo,
        methodId: crypto_withdrawals.method_id,
        status: crypto_withdrawals.status,
        requestedAt: crypto_withdrawals.created_at,
        userEmail: user_clerk.email,
        userDiscordUsername: user_clerk.discord_username,
        userFirstName: user_clerk.first_name,
        userLastName: user_clerk.last_name,
        // Flagged, NOT hidden. The picker and createBatch already refuse
        // banned clippers, so the only way one reaches a batch folder is that
        // it was batched BEFORE the ban — meaning the money may already be
        // committed and the row still needs reconciling. Hiding it would make
        // it invisible rather than safe. The panel greys it out and the CSV
        // export drops it, so it can't be hand-sent by accident.
        userBanned: sql<number>`(
          SELECT COUNT(*) FROM ${banned_users}
           WHERE ${banned_users.user_id} = ${crypto_withdrawals.user_id}
        )`,
      })
      .from(crypto_withdrawals)
      .leftJoin(
        user_clerk,
        eq(user_clerk.discord_id, crypto_withdrawals.user_id)
      )
      .where(
        inArray(
          crypto_withdrawals.batch_id,
          batches.map((b) => b.id)
        )
      );
    return batches.map((b) => {
      const members = items
        .filter((i) => i.batchId === b.id)
        .map((i) => ({ ...mapPayoutRow(i), userBanned: Number(i.userBanned) > 0 }));
      const allPaid =
        members.length > 0 && members.every((m) => m.paid);
      return {
        id: b.id,
        title: b.title,
        createdAt: b.created_at,
        count: members.length,
        totalAmount:
          Math.round(members.reduce((s, m) => s + m.amount, 0) * 100) / 100,
        allPaid,
        items: members,
      };
    });
  }),
});

// Shared row → panel shape (adds network/asset + paid flag).
const mapPayoutRow = <
  T extends { npCurrency: string; status: string; amount: unknown }
>(
  r: T
) => ({
  ...r,
  amount: Number(r.amount),
  network:
    CRYPTO_PAYOUT_OPTION_BY_CURRENCY.get(r.npCurrency)?.network ?? r.npCurrency,
  asset:
    CRYPTO_PAYOUT_OPTION_BY_CURRENCY.get(r.npCurrency)?.asset ??
    r.npCurrency.toUpperCase(),
  paid: r.status === "paid",
});
