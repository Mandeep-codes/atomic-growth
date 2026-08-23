import { TRPCError } from "@trpc/server";
import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { z } from "zod";
import { userNotBanned } from "../lib/banPurge";
import { db } from "../lib/db";
import {
  balance_entries,
  balances,
  demographics_verification_v2,
  notifications,
  user_clerk,
  wise_recipient,
  wise_withdrawals,
} from "../lib/schema";
import {
  payoutsAdminRoleProcedure,
  protectedProcedure,
  router,
} from "../lib/trpc";
import { wiseApi, WiseApiError, WiseBatchGroup, WiseTransfer } from "../lib/wise";
import {
  getCampaignAsksForUser,
  getClaimableBreakdown,
} from "../lib/demographics-reset";
import {
  WithdrawalRefundMetadata,
  WithdrawalCancellationMetadata,
  WithdrawalReturnMetadata,
} from "../lib/zod-schemas/withdrawalMetadata";
import { NotificationMetadata } from "../lib/zod-schemas/notifications";

// The single source of truth for the payout floor. Exported so the client can
// render the same number instead of keeping its own copy — that duplication is
// exactly how the frontend ended up enforcing a rule the server did not.
export const MINIMUM_WITHDRAWAL_AMOUNT = 2;

const createBatchPayoutInput = z.object({
  batchName: z.string().min(1).max(100),
  payouts: z
    .array(
      z.object({
        userId: z.string(),
      })
    )
    .min(1, "At least one payout is required"),
});

export const wiseRouter = router({
  requestMyWithdrawal: protectedProcedure.mutation(async ({ ctx }) => {
    // Prevent abuse
    const existingWithdrawalCancellations = await db
      .select()
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
    if (existingWithdrawalCancellations.length > 2) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "You have reached the maximum number of withdrawals for today.",
      });
    }

    // Feature 3 (debt): can't withdraw a zero or negative balance. If they're
    // in debt, new earnings pay it down first.
    const [bal] = await db
      .select({ balance: balances.balance })
      .from(balances)
      .where(eq(balances.user_id, ctx.user.id))
      .limit(1);
    if (Number(bal?.balance ?? 0) <= 0) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "You don't have a positive balance to withdraw. If your balance is negative, new earnings will pay it down first.",
      });
    }

    // ── Minimum payout ──
    //
    // The $2 floor lived ONLY in the frontend (MINIMUM_CLAIM_AMOUNT in
    // Earnings.tsx), so it was a disabled button and nothing more. Anything
    // that reached this procedure another way — a direct call, a stale tab, a
    // client bug — went straight through on a positive balance of any size.
    //
    // 41 withdrawals under $2 have already been paid, the smallest for
    // $0.0010. Each one still costs a real transfer, so the floor has to be
    // enforced where the money actually moves.
    if (Number(bal?.balance ?? 0) < MINIMUM_WITHDRAWAL_AMOUNT) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `You need at least $${MINIMUM_WITHDRAWAL_AMOUNT.toFixed(
          2
        )} to withdraw. Your balance is $${Number(bal?.balance ?? 0).toFixed(
          2
        )} — keep clipping and it will unlock.`,
      });
    }

    // Positive balance, but all of it held pending campaign demographics.
    // Told apart from the debt case above on purpose: the fix here is to submit
    // demographics, not to earn more.
    const claim = await getClaimableBreakdown(ctx.user.id);

    // ── An outstanding demographics request blocks the whole withdrawal ──
    //
    // This used to refuse only when claimable hit zero, so a clipper with an
    // unanswered request could still withdraw whatever the hold did not cover —
    // and clippers were doing exactly that, taking money out while a request
    // sat unanswered and, in some cases, never submitting at all.
    //
    // The hold is an estimate of one campaign's share of a pooled balance; it
    // was never a safe basis for deciding whether the REQUEST has been
    // answered. Those are two different questions and only the second one
    // belongs here. Money is released on a moderator's approval, so nothing
    // pays out until every asked account has one.
    //
    // Scoped to getCampaignAsksForUser, which only asks about live campaigns
    // and only about accounts that actually ran in them — not the old
    // listClaims count, which blocked 263 clippers over placeholder rows on
    // campaigns that had already ended.
    const asks = await getCampaignAsksForUser(ctx.user.id);
    const unanswered = asks.filter((ask) => !ask.satisfied);
    if (unanswered.length > 0) {
      const names = unanswered
        .map((ask) => ask.campaignTitle ?? "a campaign")
        .slice(0, 3)
        .join(", ");
      const awaitingReview = unanswered.every((ask) =>
        ask.accounts.every((account) => account.submitted)
      );
      throw new TRPCError({
        code: "FORBIDDEN",
        message: awaitingReview
          ? `Your demographics for ${names} are with a moderator. Your balance is released once they're approved.`
          : `${names} asked you for a fresh audience report. Submit it from the demographics page — your balance is released once a moderator approves it.`,
      });
    }

    if (claim.claimable <= 0) {
      const names = claim.locked
        .map((row) => row.campaignTitle ?? "a campaign")
        .slice(0, 3)
        .join(", ");
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `Your balance is on hold pending demographics${
          names ? ` for ${names}` : ""
        }. Submit them from the demographics page to release it.`,
      });
    }

    await createWithdrawalRequests([ctx.user.id]);
    return { success: true } as const;
  }),

  cancelRequestedWithdrawal: protectedProcedure
    .input(z.object({ withdrawalId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;
      const withdrawal = await db.query.wise_withdrawals.findFirst({
        where: and(
          eq(wise_withdrawals.id, input.withdrawalId),
          eq(wise_withdrawals.user_id, userId)
        ),
      });

      if (!withdrawal) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Withdrawal not found.",
        });
      }

      if (withdrawal.status !== "requested") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Only requested withdrawals can be cancelled.",
        });
      }

      await db.transaction(async (tx) => {
        // Lock the withdrawal row and re-check its status INSIDE the tx. The
        // status check above runs unlocked, so two concurrent cancels (or a
        // cancel racing another writer) could both pass it; without this
        // re-check the second one would delete zero rows but still credit the
        // refund again — a double-credit. Serializing on the row makes the
        // loser see a non-"requested" status and abort before refunding.
        await tx.execute(
          sql`select 1 from ${wise_withdrawals} where ${wise_withdrawals.id} = ${withdrawal.id} for update`
        );
        const [locked] = await tx
          .select({ status: wise_withdrawals.status })
          .from(wise_withdrawals)
          .where(eq(wise_withdrawals.id, withdrawal.id))
          .limit(1);
        if (!locked || locked.status !== "requested") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "This withdrawal can no longer be cancelled — it may already be processing or cancelled.",
          });
        }

        await tx
          .delete(wise_withdrawals)
          .where(eq(wise_withdrawals.id, withdrawal.id));

        const refundMetadata: WithdrawalCancellationMetadata = {
          version: "v1",
          type: "withdrawal_cancellation",
        };

        const memo = "Withdrawal request cancelled";

        const [refundEntry] = await tx
          .insert(balance_entries)
          .values({
            user_id: userId,
            amount: withdrawal.amount,
            currency: withdrawal.currency ?? "USD",
            type: "withdrawal_cancellation",
            memo,
            source_type: "withdrawal_cancellation",
            source_id: withdrawal.id,
            metadata: refundMetadata,
          })
          .$returningId();

        if (!refundEntry) {
          throw new Error("Failed to create refund balance entry");
        }

        await tx
          .insert(balances)
          .values({
            user_id: userId,
            balance: withdrawal.amount,
          })
          .onDuplicateKeyUpdate({
            set: {
              balance: sql`${balances.balance} + ${withdrawal.amount}`,
            },
          });
      });

      return { success: true } as const;
    }),

  // ── Admin "Return to balance" ──
  // Closes a STILL-QUEUED withdrawal (status "requested" — claimed by the
  // clipper, demographics done, visible in the payout candidates list) and
  // credits the full amount back to their platform balance. Hard rules:
  //   - Only "requested" rows. Once a batch payout claims the row (pending)
  //     or a Wise transfer exists, returning is blocked — money that reached
  //     Wise can never be returned from here.
  //   - Status check + flip happen INSIDE a locked transaction, so double
  //     clicks / concurrent requests can never double-credit.
  //   - Keeps the row (status "returned") as the audit trail, writes a
  //     balance_entries line, and notifies the clipper.
  returnWithdrawalToBalance: payoutsAdminRoleProcedure
    .input(
      z.object({
        withdrawalId: z.string().min(1),
        reason: z.string().trim().max(500).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return db.transaction(async (tx) => {
        const [withdrawal] = await tx
          .select()
          .from(wise_withdrawals)
          .where(eq(wise_withdrawals.id, input.withdrawalId))
          .limit(1)
          .for("update");

        if (!withdrawal) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Withdrawal not found.",
          });
        }
        if (withdrawal.status !== "requested") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              withdrawal.status === "returned"
                ? "This withdrawal was already returned to the clipper's balance."
                : `Only queued (requested) withdrawals can be returned — this one is "${withdrawal.status}". Money that has gone to Wise can't be returned from here.`,
          });
        }
        // Defensive: a crashed batch run can leave a "requested" row that
        // already has a Wise transfer attached. Never return those — the
        // money may be on its way out. "Sync Wise transfers" handles them.
        if (withdrawal.external_transfer_id) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "This withdrawal already has a Wise transfer attached (a payout batch touched it). Use 'Sync Wise transfers' instead of returning it.",
          });
        }

        const amount = Number(withdrawal.amount);

        await tx
          .update(wise_withdrawals)
          .set({ status: "returned" })
          .where(eq(wise_withdrawals.id, withdrawal.id));

        const returnMetadata: WithdrawalReturnMetadata = {
          version: "v1",
          type: "withdrawal_return",
          details: {
            returnedBy: ctx.user.id,
            ...(input.reason ? { reason: input.reason } : {}),
          },
        };

        // type "withdrawal_refund" (NOT "withdrawal_cancellation") on
        // purpose: the cancellation type feeds the clipper's 3-cancels-per-
        // day rate limit, and an admin-initiated return must not eat it.
        await tx.insert(balance_entries).values({
          user_id: withdrawal.user_id,
          amount,
          currency: withdrawal.currency ?? "USD",
          type: "withdrawal_refund",
          memo: `Withdrawal returned to balance by an admin${input.reason ? `: ${input.reason}` : ""}`,
          source_type: "withdrawal_return",
          source_id: withdrawal.id,
          metadata: returnMetadata,
        });

        await tx
          .insert(balances)
          .values({
            user_id: withdrawal.user_id,
            balance: amount,
          })
          .onDuplicateKeyUpdate({
            set: {
              balance: sql`${balances.balance} + ${amount}`,
            },
          });

        await tx.insert(notifications).values({
          user_id: withdrawal.user_id,
          title: "Withdrawal returned to your balance",
          description: `Your $${amount.toFixed(2)} withdrawal request was returned to your platform balance by an admin${input.reason ? `. Reason: ${input.reason}` : ""}. The money is back in your wallet and you can claim again anytime.`,
          expires_minutes: 14 * 24 * 60,
          metadata: { type: "withdrawal-returned", alertType: "warning" },
        });

        return {
          success: true as const,
          amount,
          userId: withdrawal.user_id,
        };
      });
    }),

  getPayoutCandidates: payoutsAdminRoleProcedure.query(async () => {
    const withdrawals = await db
      .select({
        withdrawal: wise_withdrawals,
        userEmail: user_clerk.email,
        userFirstName: user_clerk.first_name,
        userLastName: user_clerk.last_name,
        userDiscordUsername: user_clerk.discord_username,
      })
      .from(wise_withdrawals)
      .leftJoin(user_clerk, eq(user_clerk.discord_id, wise_withdrawals.user_id))
      .where(
        and(
          eq(wise_withdrawals.status, "requested"),
          // Never offer a banned clipper for payout. Cancelling their claims
          // at ban time isn't enough on its own: revertClaims below can flip a
          // row back to 'requested' after the ban has already swept, and the
          // frontend's bulk-select auto-ticks anyone with a saved recipient.
          userNotBanned(wise_withdrawals.user_id)
        )
      )
      .orderBy(desc(wise_withdrawals.created_at));

    const recipientIds = Array.from(
      new Set(
        withdrawals
          .map((record) => record.withdrawal.external_recipient_id)
          .filter((id): id is string => Boolean(id))
      )
    );

    const recipientRecords = recipientIds.length
      ? await db
        .select()
        .from(wise_recipient)
        .where(inArray(wise_recipient.recipient_id, recipientIds))
      : [];

    const recipientMap = new Map(
      recipientRecords.map((record) => [record.recipient_id, record])
    );

    const withdrawalsWithRecipients = withdrawals.map((record) => ({
      withdrawal: record.withdrawal,
      wiseRecipient: record.withdrawal.external_recipient_id
        ? recipientMap.get(record.withdrawal.external_recipient_id) ?? null
        : null,
      userEmail: record.userEmail,
      userFirstName: record.userFirstName,
      userLastName: record.userLastName,
      userDiscordUsername: record.userDiscordUsername,
    }));

    const userIds = withdrawals.map(
      (candidate) => candidate.withdrawal.user_id
    );
    const outstandingDemographicsStatuses = [
      "active",
      "pending",
      "needs-human-review",
      "rejected",
    ] as const;
    const outstandingDemographicsSet = new Set<string>();

    if (userIds.length > 0) {
      const outstandingRecords = await db
        .select({ userId: demographics_verification_v2.user_id })
        .from(demographics_verification_v2)
        .where(
          and(
            inArray(demographics_verification_v2.user_id, userIds),
            inArray(
              demographics_verification_v2.status,
              outstandingDemographicsStatuses
            )
          )
        );

      outstandingRecords.forEach((record) => {
        outstandingDemographicsSet.add(record.userId);
      });
    }

    return withdrawalsWithRecipients.map((candidate) => {
      const recipientRecord = candidate.wiseRecipient;
      const withdrawalRecord = candidate.withdrawal;
      const fullName = [candidate.userFirstName, candidate.userLastName]
        .filter((value): value is string => Boolean(value && value.trim()))
        .join(" ")
        .trim();

      return {
        userId: withdrawalRecord.user_id,
        username: candidate.userEmail ?? withdrawalRecord.user_id,
        fullName: fullName.length ? fullName : null,
        discordId: withdrawalRecord.user_id,
        discordUsername: candidate.userDiscordUsername ?? null,
        balance: withdrawalRecord.amount,
        hasRecipient: recipientRecord !== null,
        email: candidate.userEmail ?? null,
        hasOutstandingDemographics: outstandingDemographicsSet.has(
          withdrawalRecord.user_id
        ),
        recipient: recipientRecord
          ? {
            recordId: recipientRecord.id,
            recipientId: recipientRecord.recipient_id,
            summary: null,
          }
          : null,
        withdrawalId: withdrawalRecord.id,
        requestedAt: withdrawalRecord.created_at,
      };
    });
  }),

  createBatchPayout: payoutsAdminRoleProcedure
    .input(createBatchPayoutInput)
    .mutation(async ({ input }) => {
      const sourceCurrency = "USD";

      const uniqueUserIds = Array.from(
        new Set(input.payouts.map((p) => p.userId))
      );

      // ── Claim the rows BEFORE any Wise call ──
      // Flip the selected requested withdrawals to "pending" (in-flight) up
      // front, inside a locked transaction. While the batch spends seconds-to-
      // minutes talking to Wise, these rows are no longer "requested", so a
      // user cancel or an admin "return to balance" can't refund a withdrawal
      // whose money is about to go out the door. Rows that end up skipped or
      // hit an error are reverted to "requested" below.
      const requestedWithdrawals = await db.transaction(async (tx) => {
        const rows = await tx
          .select()
          .from(wise_withdrawals)
          .where(
            and(
              eq(wise_withdrawals.status, "requested"),
              inArray(wise_withdrawals.user_id, uniqueUserIds),
              // Final gate before money leaves. This query selects by user_id
              // rather than withdrawal id, so it sweeps in every requested row
              // of a listed user — including ones the admin never saw.
              userNotBanned(wise_withdrawals.user_id)
            )
          )
          .for("update");
        if (rows.length > 0) {
          await tx
            .update(wise_withdrawals)
            .set({ status: "pending" })
            .where(
              and(
                inArray(
                  wise_withdrawals.id,
                  rows.map((row) => row.id)
                ),
                eq(wise_withdrawals.status, "requested")
              )
            );
        }
        return rows;
      });
      const claimedIds = requestedWithdrawals.map((row) => row.id);
      // Best-effort revert of claimed rows that never got a Wise transfer —
      // used on both the error path and for skipped withdrawals.
      const revertClaims = async (ids: string[]) => {
        if (ids.length === 0) return;
        await db
          .update(wise_withdrawals)
          .set({ status: "requested" })
          .where(
            and(
              inArray(wise_withdrawals.id, ids),
              eq(wise_withdrawals.status, "pending")
            )
          );
      };

      console.debug("--------------------------------");
      console.debug("Requested withdrawals", requestedWithdrawals);
      console.debug("--------------------------------");

      let batchGroup: WiseBatchGroup | null = null;
      const transferResults: Array<{
        withdrawalId: string;
        userId: string;
        amount: number;
        currency: string;
        quoteId: string;
        transferId: number;
        recipientId: string;
        customerTransactionId: string;
        transferStatus: string;
      }> = [];
      const skippedWithdrawals: Array<{
        withdrawalId: string;
        userId: string;
        customerTransactionId: string;
        reason: string;
      }> = [];
      let batchGroupId: string | null = null;
      try {
        batchGroup = await wiseApi.createBatchGroup({
          sourceCurrency,
          name: input.batchName,
        });

        batchGroupId = batchGroup.id;

        console.debug("--------------------------------");
        console.debug("Batch group created", batchGroup);
        console.debug("--------------------------------");

        console.debug("--------------------------------");
        console.debug("Creating transfers");
        console.debug("--------------------------------");
        for (const requestedWithdrawal of requestedWithdrawals) {
          const {
            id: withdrawalId,
            user_id: userId,
            amount,
            currency,
            external_recipient_id: recipientId,
            external_id: customerTransactionId,
          } = requestedWithdrawal;

          // Fetch recipient account to determine the correct currency
          const recipientAccount = await wiseApi.getAccount(recipientId);
          const targetCurrency = typeof recipientAccount.currency === 'string'
            ? recipientAccount.currency
            : "INR";

          const quote = await wiseApi.createQuote({
            sourceCurrency,
            targetCurrency,
            sourceAmount: amount,
          });

          console.debug("--------------------------------");
          console.debug("Quote created", quote);
          console.debug("--------------------------------");

          const quoteId = quote.id || quote.quoteUuid;
          if (!quoteId) {
            throw new Error("Unable to determine Wise quote ID");
          }

          if (!recipientId) {
            throw new Error("Wise recipient not found");
          }

          const transferPayload: Record<string, unknown> = {
            targetAccount: recipientId,
            quoteUuid: quoteId,
            customerTransactionId,
            // sourceAccount: env.WISE_REFUND_SOURCE_ACCOUNT_ID, // Needed?
            details: {
              reference: "auto-payout", // Needed?
              transferPurpose: "verification.transfers.purpose.other",
              sourceOfFunds: "verification.source.of.funds.other", // Needed?
            },
          };

          let transfer;
          try {
            transfer = await wiseApi.createBatchTransfer(
              batchGroup.id as string,
              transferPayload
            );
          } catch (error) {
            if (
              error instanceof WiseApiError &&
              Array.isArray(error.details?.response?.errors) &&
              error.details.response.errors.some(
                (e: { code?: string }) =>
                  e?.code === "validation.failure.group.incompatible.state"
              )
            ) {
              console.warn(
                `Skipping withdrawal ${withdrawalId} - transfer already linked to another batch group or current group completed`,
                JSON.stringify(error.details, null, 2)
              );
              skippedWithdrawals.push({
                withdrawalId,
                userId,
                customerTransactionId,
                reason:
                  "transfer already linked to another batch group or current group completed",
              });
              continue;
            }
            throw error;
          }
          console.debug("--------------------------------");
          console.debug("Transfer created", transfer);
          console.debug("--------------------------------");

          const transferId =
            typeof transfer?.id === "number" ? transfer.id : undefined;

          if (!transferId) {
            throw new Error("Unable to determine Wise transfer ID");
          }

          const transferStatus =
            typeof transfer?.status === "string" ? transfer.status : undefined;

          if (!transferStatus) {
            throw new Error("Unable to determine Wise transfer status");
          }

          transferResults.push({
            withdrawalId,
            userId,
            amount,
            currency: currency ?? "USD",
            quoteId,
            transferId,
            recipientId,
            customerTransactionId,
            transferStatus,
          });
        }

        const latestBatch = await wiseApi.getBatchGroup(
          batchGroup.id as string
        );
        const batchVersion = Number(
          latestBatch.version ?? batchGroup.version ?? 0
        );

        console.debug("--------------------------------");
        console.debug("Latest batch", latestBatch);
        console.debug("--------------------------------");

        const completedBatch = await wiseApi.completeBatchGroup(
          batchGroup.id as string,
          batchVersion
        );
        console.debug("--------------------------------");
        console.debug("Completed batch", completedBatch);
        console.debug("--------------------------------");
      } catch (error) {
        console.error(
          "Error creating batch payout",
          JSON.stringify(error, null, 2)
        );
        // Careful error path: completeBatchGroup can time out client-side
        // AFTER Wise actually completed the group — in which case the
        // transfers WILL pay out and reverting rows to "requested" would let
        // a cancel/return refund money that's in flight (double payout). So:
        //   1. Ask Wise what actually happened to the group.
        //   2. COMPLETED   → persist the transfer ids we created (same as the
        //      happy path) so sync can track them; only revert rows that got
        //      no transfer (nothing can pay them).
        //   3. Not completed → cancel the group (guarded), and only revert
        //      claims once the cancel SUCCEEDED. If Wise's state is unknown
        //      (status fetch or cancel failed), leave rows "pending": frozen
        //      is the only safe state, and syncPendingWithdrawals surfaces
        //      them for manual resolution instead of guessing with money.
        let groupState: "completed" | "not-completed" | "unknown" = "unknown";
        if (batchGroupId) {
          try {
            const group = await wiseApi.getBatchGroup(batchGroupId);
            groupState =
              String(group.status ?? "").toUpperCase() === "COMPLETED"
                ? "completed"
                : "not-completed";
          } catch (statusError) {
            console.error("Could not fetch batch group state", statusError);
          }
        }

        if (groupState === "completed" && batchGroupId) {
          for (const transferResult of transferResults) {
            await db
              .update(wise_withdrawals)
              .set({
                external_id: transferResult.customerTransactionId,
                external_quote_id: transferResult.quoteId,
                external_transfer_id: String(transferResult.transferId),
                external_status: normalizeWiseStatus(
                  transferResult.transferStatus
                ),
                external_batch_id: batchGroupId,
                status: "pending",
              })
              .where(eq(wise_withdrawals.id, transferResult.withdrawalId));
          }
          const transferredIds = new Set(
            transferResults.map((t) => t.withdrawalId)
          );
          await revertClaims(claimedIds.filter((id) => !transferredIds.has(id)));
        } else if (groupState === "not-completed" && batchGroupId) {
          try {
            await wiseApi.cancelBatchGroup(batchGroupId);
            // Group cancelled — none of these transfers will pay out, so the
            // claims can safely go back to "requested".
            await revertClaims(claimedIds);
          } catch (cancelError) {
            console.error(
              "Failed to cancel batch group — leaving claimed rows pending for sync",
              cancelError
            );
          }
        }
        throw error;
      }

      // Skipped withdrawals: Wise refused the transfer because one with this
      // row's customerTransactionId ALREADY exists (from an earlier crashed
      // batch) or the group completed under us. That earlier transfer may pay
      // out, so "requested" (cancellable/returnable/re-payable) is NOT a safe
      // state for these rows. Keep them "pending": frozen from all money
      // actions, and surfaced by syncPendingWithdrawals for manual review.

      for (const transferResult of transferResults) {
        await db
          .update(wise_withdrawals)
          .set({
            user_id: transferResult.userId,
            external_id: transferResult.customerTransactionId,
            external_quote_id: transferResult.quoteId,
            external_transfer_id: String(transferResult.transferId),
            external_status: normalizeWiseStatus(transferResult.transferStatus),
            external_batch_id: batchGroup.id,
            amount: transferResult.amount,
            status: "pending",
          })
          .where(eq(wise_withdrawals.id, transferResult.withdrawalId));
      }

      await createPayoutNotifications(
        transferResults.map((transferResult) => ({
          userId: transferResult.userId,
          amount: transferResult.amount,
          currency: transferResult.currency,
        }))
      );

      return {
        batchGroupId: batchGroup.id,
        transferCount: transferResults.length,
        skippedWithdrawals,
      };
    }),

  getBatchGroup: payoutsAdminRoleProcedure
    .input(z.object({ batchGroupId: z.string().min(1) }))
    .query(async ({ input }) => {
      return wiseApi.getBatchGroup(input.batchGroupId);
    }),

  syncPendingWithdrawals: payoutsAdminRoleProcedure.mutation(async () => {
    const pendingWithdrawals = await db
      .select()
      .from(wise_withdrawals)
      .where(eq(wise_withdrawals.status, "pending"));

    const result = {
      total: pendingWithdrawals.length,
      completed: 0,
      refunded: 0,
      stillPending: 0,
      skipped: 0,
      // Pending rows with NO Wise transfer id: leftovers from a payout batch
      // that was interrupted mid-run (claim-first flips rows to pending
      // before Wise transfers exist). They need manual review — but they must
      // never abort the sync, or one stuck row would block refunds for
      // everyone else.
      missingTransferId: 0,
      missingTransferIdRows: [] as string[],
    };

    for (const withdrawal of pendingWithdrawals) {
      if (!withdrawal.external_transfer_id) {
        console.error(
          `Pending withdrawal ${withdrawal.id} has no Wise transfer id (interrupted batch) — needs manual review`
        );
        result.missingTransferId++;
        result.missingTransferIdRows.push(withdrawal.id);
        continue;
      }

      let transfer: WiseTransfer;
      try {
        transfer = await wiseApi.getTransfer(withdrawal.external_transfer_id);
      } catch (error) {
        console.error(
          `Failed to fetch Wise transfer ${withdrawal.external_transfer_id} for withdrawal ${withdrawal.id}`,
          error
        );
        result.skipped++;
        continue;
      }

      const transferStatus = normalizeWiseStatus(transfer.status);

      // Check if 30 days old and mark as completed
      if (
        transferStatus === "outgoing_payment_sent" &&
        withdrawal.created_at < new Date(Date.now() - 1000 * 60 * 60 * 24 * 30)
      ) {
        await db
          .update(wise_withdrawals)
          .set({
            status: "completed",
            external_status: transferStatus,
          })
          .where(eq(wise_withdrawals.id, withdrawal.id));
        result.completed++;
        continue;
      }

      if (["funds_refunded", "cancelled"].includes(transferStatus)) {
        const didRefund = await db.transaction(async (tx) => {
          // Lock + re-check inside the tx: two concurrent syncs (or a sync
          // racing another status change) could otherwise both see "pending"
          // in the unlocked snapshot above and both credit the refund.
          const [locked] = await tx
            .select({ status: wise_withdrawals.status })
            .from(wise_withdrawals)
            .where(eq(wise_withdrawals.id, withdrawal.id))
            .limit(1)
            .for("update");
          if (!locked || locked.status !== "pending") {
            return false;
          }

          await tx
            .update(wise_withdrawals)
            .set({
              status: "failed",
              external_status: transferStatus,
            })
            .where(eq(wise_withdrawals.id, withdrawal.id));

          const [refundEntry] = await tx
            .insert(balance_entries)
            .values({
              user_id: withdrawal.user_id,
              amount: withdrawal.amount,
              type: "withdrawal_refund",
              memo: `Wise transfer ${withdrawal.external_transfer_id} refunded`,
              source_type: "withdrawal_refund",
              source_id: withdrawal.id,
              metadata: {
                version: "v1",
                type: "withdrawal_refund",
                details: {
                  type: "wise",
                  status: transferStatus,
                  transferId: String(withdrawal.external_transfer_id),
                },
              } satisfies WithdrawalRefundMetadata,
            })
            .$returningId();

          if (!refundEntry) {
            throw new Error("Failed to create withdrawal refund entry");
          }

          await tx
            .insert(balances)
            .values({
              user_id: withdrawal.user_id,
              balance: withdrawal.amount,
            })
            .onDuplicateKeyUpdate({
              set: {
                balance: sql`${balances.balance} + ${withdrawal.amount}`,
              },
            });

          const currency = withdrawal.currency ?? "USD";
          const formattedAmount = formatCurrencyForNotification(
            withdrawal.amount,
            currency
          );
          const refundReason =
            transferStatus === "cancelled"
              ? "Wise cancelled the transfer."
              : "Wise refunded the transfer.";

          await tx.insert(notifications).values({
            user_id: withdrawal.user_id,
            title: "Withdrawal refunded",
            description: `${formattedAmount} was returned to your available balance. ${refundReason}`,
            expires_minutes: 3 * 24 * 60,
            metadata: {
              type: "withdrawal-refunded",
              alertType: "warning",
              amount: withdrawal.amount,
              currency,
            } satisfies NotificationMetadata,
          });
          return true;
        });

        if (didRefund) {
          result.refunded++;
        } else {
          result.skipped++;
        }
        continue;
      }

      result.stillPending++;
    }

    return result;
  }),

  // READ-ONLY twin of syncPendingWithdrawals. Looks up every pending
  // withdrawal's live Wise status and reports what the real sync WOULD do —
  // without touching the database, crediting refunds, or notifying anyone.
  // Lets an admin preview the refund list (and spot double-pay risk for
  // clippers who were already compensated manually) before pressing Sync.
  dryRunSyncPendingWithdrawals: payoutsAdminRoleProcedure.query(async () => {
    const pendingWithdrawals = await db
      .select({
        id: wise_withdrawals.id,
        user_id: wise_withdrawals.user_id,
        amount: wise_withdrawals.amount,
        currency: wise_withdrawals.currency,
        created_at: wise_withdrawals.created_at,
        external_transfer_id: wise_withdrawals.external_transfer_id,
        username: user_clerk.discord_username,
      })
      .from(wise_withdrawals)
      .leftJoin(
        user_clerk,
        eq(user_clerk.discord_id, wise_withdrawals.user_id)
      )
      .where(eq(wise_withdrawals.status, "pending"));

    // Positive manual credits per clipper — a would-be refund for someone
    // who already received manual compensation is a double-pay risk the
    // admin must reconcile by hand before running the real sync.
    const userIds = [...new Set(pendingWithdrawals.map((w) => w.user_id))];
    const compensated = userIds.length
      ? await db
          .select({
            user_id: balance_entries.user_id,
            total: sql<number>`SUM(${balance_entries.amount})`,
          })
          .from(balance_entries)
          .where(
            and(
              inArray(balance_entries.user_id, userIds),
              eq(balance_entries.type, "manual_adjustment"),
              gt(balance_entries.amount, 0)
            )
          )
          .groupBy(balance_entries.user_id)
      : [];
    const compensatedByUser = new Map(
      compensated.map((c) => [c.user_id, Number(c.total)])
    );

    type DryRunOutcome =
      | "refund"
      | "complete"
      | "still-pending"
      | "error-skipped"
      | "manual-review-no-transfer-id";
    const rows: Array<{
      withdrawalId: string;
      userId: string;
      username: string | null;
      amount: number;
      currency: string;
      createdAt: Date;
      wiseStatus: string;
      wouldDo: DryRunOutcome;
      manualCreditsReceived: number;
    }> = [];

    for (const withdrawal of pendingWithdrawals) {
      const base = {
        withdrawalId: withdrawal.id,
        userId: withdrawal.user_id,
        username: withdrawal.username ?? null,
        amount: Number(withdrawal.amount),
        currency: withdrawal.currency ?? "USD",
        createdAt: withdrawal.created_at,
        manualCreditsReceived:
          compensatedByUser.get(withdrawal.user_id) ?? 0,
      };

      if (!withdrawal.external_transfer_id) {
        rows.push({
          ...base,
          wiseStatus: "(no transfer id)",
          wouldDo: "manual-review-no-transfer-id",
        });
        continue;
      }

      let transfer: WiseTransfer;
      try {
        transfer = await wiseApi.getTransfer(withdrawal.external_transfer_id);
      } catch {
        rows.push({
          ...base,
          wiseStatus: "(wise lookup failed)",
          wouldDo: "error-skipped",
        });
        continue;
      }

      // Mirror of the real sync's decision tree, minus every write.
      const transferStatus = normalizeWiseStatus(transfer.status);
      if (
        transferStatus === "outgoing_payment_sent" &&
        withdrawal.created_at <
          new Date(Date.now() - 1000 * 60 * 60 * 24 * 30)
      ) {
        rows.push({ ...base, wiseStatus: transferStatus, wouldDo: "complete" });
      } else if (["funds_refunded", "cancelled"].includes(transferStatus)) {
        rows.push({ ...base, wiseStatus: transferStatus, wouldDo: "refund" });
      } else {
        rows.push({
          ...base,
          wiseStatus: transferStatus,
          wouldDo: "still-pending",
        });
      }
    }

    const refundRows = rows.filter((r) => r.wouldDo === "refund");
    return {
      summary: {
        total: rows.length,
        refund: refundRows.length,
        complete: rows.filter((r) => r.wouldDo === "complete").length,
        stillPending: rows.filter((r) => r.wouldDo === "still-pending").length,
        errorSkipped: rows.filter((r) => r.wouldDo === "error-skipped").length,
        manualReview: rows.filter(
          (r) => r.wouldDo === "manual-review-no-transfer-id"
        ).length,
        totalRefundAmount: Number(
          refundRows.reduce((s, r) => s + r.amount, 0).toFixed(2)
        ),
        refundsToAlreadyCompensated: refundRows.filter(
          (r) => r.manualCreditsReceived > 0
        ).length,
      },
      rows,
    };
  }),
});

// In the interim, we do this first, but in the future a user should be able to on-demand create a withdrawal request.
async function createWithdrawalRequests(userId: string[]) {
  const userBalances = await db
    .select()
    .from(balances)
    .leftJoin(wise_recipient, eq(wise_recipient.user_id, balances.user_id))
    .where(and(inArray(balances.user_id, userId)));

  for (const userBalance of userBalances) {
    await db.transaction(async (tx) => {
      const userId = userBalance.balances.user_id;

      // Lock the balance row for this user so concurrent requests serialize.
      await tx.execute(
        sql`select 1 from ${balances} where ${balances.user_id} = ${userId} for update`
      );

      const [existingWithdrawal] = await tx
        .select({ id: wise_withdrawals.id })
        .from(wise_withdrawals)
        .where(
          and(
            eq(wise_withdrawals.user_id, userId),
            eq(wise_withdrawals.status, "requested")
          )
        )
        .limit(1);

      if (existingWithdrawal) {
        return;
      }

      if (!userBalance.wise_recipient) {
        throw new Error(`Wise recipient not found for user ${userId}`);
      }

      // Pay out only what is NOT on hold. A campaign with an open demographics
      // request holds back what the clipper earned on it; the rest of the
      // wallet is theirs to take. Capped here rather than in the caller because
      // the admin batch path lands here too, and held money must not leave by
      // that route either.
      const claim = await getClaimableBreakdown(userId);
      const amount = Math.min(
        Number(userBalance.balances.balance),
        claim.claimable
      );

      // Feature 3 (debt): never create a withdrawal for a zero/negative balance.
      // Also covers the case where every campaign the clipper earned from is
      // currently on hold.
      if (amount <= 0) {
        return;
      }

      await tx
        .insert(balances)
        .values({
          user_id: userId,
          balance: -amount,
        })
        .onDuplicateKeyUpdate({
          set: {
            balance: sql`${balances.balance} - ${amount}`,
          },
        });

      const [balanceEntry] = await tx
        .insert(balance_entries)
        .values({
          user_id: userId,
          amount: -amount,
          type: "withdrawal",
          source_type: "wise_withdrawal",
          memo: `Wise withdrawal`,
        })
        .$returningId();

      if (!balanceEntry) {
        throw new Error("Failed to create balance entry for withdrawal");
      }

      const customerTransactionId = randomUUID();

      const [wiseWithdrawal] = await tx
        .insert(wise_withdrawals)
        .values({
          user_id: userId,
          amount: amount,
          status: "requested",
          external_recipient_id: userBalance.wise_recipient.recipient_id,
          external_id: customerTransactionId, // idempotency key for Wise
          balance_entry_id: balanceEntry.id,
        })
        .$returningId();

      if (!wiseWithdrawal) {
        throw new Error("Failed to create Wise withdrawal");
      }

      await tx
        .update(balance_entries)
        .set({
          source_id: wiseWithdrawal.id,
        })
        .where(eq(balance_entries.id, balanceEntry.id));
    });
  }
}

// async function fetchWiseSummaries(
//   records: Array<typeof wise_recipient.$inferSelect>
// ): Promise<Map<string, WiseRecipientSummary | null>> {
//   const uniqueRecipientIds = Array.from(
//     new Set(records.map((record) => record.recipient_id))
//   );

//   const entries = await Promise.all(
//     uniqueRecipientIds.map(async (recipientId) => {
//       try {
//         const account = await wiseApi.getAccount(recipientId);
//         return [recipientId, buildWiseRecipientSummary(account)] as const;
//       } catch (error) {
//         if (error instanceof WiseApiError && error.status === 404) {
//           return [recipientId, null] as const;
//         }
//         console.error(
//           `Failed to fetch Wise recipient ${recipientId} details`,
//           error
//         );
//         return [recipientId, null] as const;
//       }
//     })
//   );

//   return new Map(entries);
// }

function normalizeWiseStatus(status: unknown): string {
  return typeof status === "string" ? status.toLowerCase() : "";
}

async function createPayoutNotifications(
  payouts: Array<{ userId: string; amount: number; currency: string }>
) {
  await Promise.all(
    payouts.map((payout) => {
      const currency = payout.currency || "USD";
      const formattedAmount = formatCurrencyForNotification(
        payout.amount,
        currency
      );

      return db.insert(notifications).values({
        user_id: payout.userId,
        title: "Payout on the way",
        description: `${formattedAmount} is headed to your account.`,
        expires_minutes: 3 * 24 * 60,
        metadata: {
          type: "payout-initiated",
          alertType: "success",
          amount: payout.amount,
          currency,
        } satisfies NotificationMetadata,
      });
    })
  );
}

function formatCurrencyForNotification(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}
