import { TRPCError } from "@trpc/server";
import { getPayoutEligibility } from "../../lib/payout-eligibility";
import { getClaimableBreakdown } from "../../lib/demographics-reset";
import { randomUUID } from "crypto";
import {
  and,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  max,
  sql,
  sum,
} from "drizzle-orm";
import { z } from "zod";
import { db } from "../../lib/db";
import {
  balance_entries,
  balances,
  campaign_view_rewards,
  campaigns,
  submissions,
  user_clerk,
  wise_recipient,
  wise_withdrawals,
} from "../../lib/schema";
import {
  protectedProcedure,
  router,
  userRolesAdminRoleProcedure,
  rewardsModeratorRoleProcedure,
} from "../../lib/trpc";
import { WithdrawalMetadata } from "../../lib/zod-schemas/withdrawalMetadata";
import { createCampaignViewRewards } from "./createCampaignViewRewards";

export const rewardsRouter = router({
  // Read-only: can this clipper claim right now, and if not, why. Drives the
  // Claim button's disabled state and its explanation.
  getPayoutEligibility: protectedProcedure.query(async ({ ctx }) => {
    return getPayoutEligibility(ctx.user.id);
  }),

  getMyTotalEarnings: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.user.id;

    const [balanceRow] = await db
      .select({
        totalEarned: balances.totalEarned,
      })
      .from(balances)
      .where(eq(balances.user_id, userId))
      .limit(1);

    return Number(balanceRow?.totalEarned ?? 0);
  }),

  getMyEarnings: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.user.id;

    const [balanceRow] = await db
      .select({
        balance: balances.balance,
        totalEarned: balances.totalEarned,
      })
      .from(balances)
      .where(eq(balances.user_id, userId))
      .limit(1);

    const currentBalance = Number(balanceRow?.balance ?? 0);
    const totalEarned = Number(balanceRow?.totalEarned ?? 0);

    const entries = await db
      .select({
        id: balance_entries.id,
        amount: balance_entries.amount,
        type: balance_entries.type,
        memo: balance_entries.memo,
        currency: balance_entries.currency,
        createdAt: balance_entries.created_at,
        metadata: balance_entries.metadata,
      })
      .from(balance_entries)
      .where(
        and(
          eq(balance_entries.user_id, userId),
          // Ignore past performance of old campaigns. Campaign rewards run before this date/time are not relevant.
          gt(balance_entries.created_at, new Date("2025-11-17T15:51:00Z"))
        )
      )
      .orderBy(desc(balance_entries.created_at))
      .limit(500);

    // let totalWithdrawn = 0;

    const formattedEntries = entries.map((entry) => {
      const numericAmount = Number(entry.amount ?? 0);

      // if (entry.type === "withdrawal") {
      //   totalWithdrawn += Math.abs(numericAmount);
      // }

      return {
        id: entry.id,
        amount: numericAmount,
        type: entry.type,
        memo: entry.memo ?? null,
        currency: entry.currency ?? "USD",
        createdAt: entry.createdAt,
        metadata: entry.metadata ?? null,
      };
    });

    const [latestOutstandingWithdrawal] = await db
      .select({
        id: wise_withdrawals.id,
        amount: wise_withdrawals.amount,
        status: wise_withdrawals.status,
        createdAt: wise_withdrawals.created_at,
        updatedAt: wise_withdrawals.updated_at,
        externalStatus: wise_withdrawals.external_status,
      })
      .from(wise_withdrawals)
      .where(
        and(
          eq(wise_withdrawals.user_id, userId),
          eq(wise_withdrawals.status, "requested")
        )
      )
      .orderBy(desc(wise_withdrawals.created_at))
      .limit(1);

    const outstandingWithdrawal = latestOutstandingWithdrawal
      ? {
        id: latestOutstandingWithdrawal.id,
        amount: Number(latestOutstandingWithdrawal.amount ?? 0),
        status: latestOutstandingWithdrawal.status,
        createdAt: latestOutstandingWithdrawal.createdAt,
        updatedAt: latestOutstandingWithdrawal.updatedAt,
        externalStatus: latestOutstandingWithdrawal.externalStatus ?? null,
      }
      : null;

    return {
      currentBalance,
      totalEarned,
      // totalWithdrawn,
      entries: formattedEntries,
      outstandingWithdrawal,
    };
  }),

  requestWithdrawal: protectedProcedure
    .input(
      z.object({
        amount: z.number().positive("Amount must be greater than zero"),
        currency: z.enum(["USD"]).default("USD"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;
      const amount = Number(input.amount.toFixed(2));

      if (amount <= 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Amount must be greater than zero",
        });
      }

      // ── Campaign-scoped demographics hold ──
      // Re-checked here, not just in the UI: the client-side check is a
      // courtesy that explains the block, but this is the control that
      // actually stops the money.
      //
      // A campaign with an open demographics request holds back only what the
      // clipper earned ON THAT CAMPAIGN. Everything else — other campaigns,
      // referrals, manual credits — stays claimable. The old gate blocked the
      // whole wallet, which froze money belonging to campaigns nobody was
      // reviewing.
      const claim = await getClaimableBreakdown(userId);
      if (amount > claim.claimable) {
        const worst = [...claim.locked].sort((a, b) => b.amount - a.amount)[0];
        const detail = worst
          ? `$${claim.lockedTotal.toFixed(2)} is on hold pending demographics for ${
              worst.campaignTitle ?? "a campaign"
            }${claim.locked.length > 1 ? ` and ${claim.locked.length - 1} other campaign(s)` : ""}`
          : "some of your balance is on hold";
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `You can claim up to $${claim.claimable.toFixed(
            2
          )} right now — ${detail}. Submit the demographics for those campaigns to release it.`,
        });
      }

      const recipient = await db.query.wise_recipient.findFirst({
        where: eq(wise_recipient.user_id, userId),
      });

      if (!recipient) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Add a bank account before requesting a withdrawal.",
        });
      }

      const result = await db.transaction(async (tx) => {
        // Lock the balance row so concurrent withdrawal requests serialize.
        // Both the "already in progress" dedup check AND the balance read
        // MUST happen inside this lock — otherwise two parallel calls both
        // pass the check and both read the same balance, each creating a
        // full-amount withdrawal and driving the balance negative (double
        // payout). This mirrors createWithdrawalRequests in wise.ts.
        await tx.execute(
          sql`select 1 from ${balances} where ${balances.user_id} = ${userId} for update`
        );

        const [existingWithdrawal] = await tx
          .select({ id: wise_withdrawals.id })
          .from(wise_withdrawals)
          .where(
            and(
              eq(wise_withdrawals.user_id, userId),
              inArray(wise_withdrawals.status, ["requested", "pending"])
            )
          )
          .limit(1);

        if (existingWithdrawal) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "You already have a withdrawal in progress.",
          });
        }

        const [balanceRow] = await tx
          .select({ balance: balances.balance })
          .from(balances)
          .where(eq(balances.user_id, userId))
          .limit(1);

        const currentBalance = Number(balanceRow?.balance ?? 0);
        if (currentBalance < amount) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Insufficient balance to complete this withdrawal.",
          });
        }

        // Re-apply the hold against the balance read UNDER the lock. The check
        // above ran before the transaction, so a payout landing in between
        // would have raised the balance without raising what is claimable —
        // and the held campaign's money would walk out with it.
        if (currentBalance - claim.lockedTotal < amount) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: `You can claim up to $${Math.max(
              0,
              currentBalance - claim.lockedTotal
            ).toFixed(2)} right now — the rest is on hold pending campaign demographics.`,
          });
        }

        const metadata: WithdrawalMetadata = {
          version: "v1",
          type: "withdrawal",
          details: {
            type: "wise",
            status: "requested",
          },
        };

        const [balanceEntry] = await tx
          .insert(balance_entries)
          .values({
            user_id: userId,
            amount: -amount,
            currency: input.currency,
            type: "withdrawal",
            memo: "Wise withdrawal requested",
            source_type: "wise_withdrawal",
            source_id: userId,
            metadata,
          })
          .$returningId();

        const balanceEntryId =
          typeof balanceEntry === "string" ? balanceEntry : balanceEntry?.id;

        if (!balanceEntryId) {
          throw new Error("Failed to create balance entry for withdrawal");
        }

        const withdrawalExternalId = randomUUID();

        const [withdrawal] = await tx
          .insert(wise_withdrawals)
          .values({
            external_recipient_id: recipient.recipient_id,
            external_id: withdrawalExternalId,
            user_id: userId,
            balance_entry_id: balanceEntryId,
            amount,
            currency: input.currency,
            status: "requested",
          } as typeof wise_withdrawals.$inferInsert)
          .$returningId();

        const withdrawalId =
          typeof withdrawal === "string" ? withdrawal : withdrawal?.id;

        if (!withdrawalId) {
          throw new Error("Failed to create withdrawal record");
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

        return {
          withdrawalId,
          balanceEntryId,
          amount,
          currency: input.currency,
        };
      });

      return result;
    }),

  getMyCampaignRewards: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.user.id;

    const rewards = await db
      .select({
        campaignId: campaign_view_rewards.campaign_id,
        platform: campaign_view_rewards.platform,
        totalAmount: sum(campaign_view_rewards.amount).as("total_amount"),
        totalViewDelta: sum(campaign_view_rewards.view_delta).as(
          "total_view_delta"
        ),
        latestViewCount: max(campaign_view_rewards.view_count).as(
          "latest_view_count"
        ),
        lastRewardAt: max(campaign_view_rewards.created_at).as(
          "last_reward_at"
        ),
      })
      .from(campaign_view_rewards)
      .where(eq(campaign_view_rewards.user_id, userId))
      .groupBy(
        campaign_view_rewards.campaign_id,
        campaign_view_rewards.platform
      );

    // Frozen views per (campaign, platform) — subtracted from the shown
    // "Rewarded views" so it matches the wallet after a rejection/uncover
    // clawback (the views are held in the backend payout baseline, but the
    // money was taken back). Clamped at 0.
    const frozenRows = await db
      .select({
        campaignId: submissions.campaign_id,
        platform: submissions.platform,
        frozen: sql<number>`COALESCE(SUM(${submissions.baseline_frozen_views}), 0)`,
      })
      .from(submissions)
      .where(
        and(
          eq(submissions.user_id, userId),
          isNotNull(submissions.baseline_frozen_views)
        )
      )
      .groupBy(submissions.campaign_id, submissions.platform);
    const frozenByKey = new Map(
      frozenRows.map((r) => [`${r.campaignId}:${r.platform}`, Number(r.frozen)])
    );

    return rewards.map((reward) => {
      const rawViewDelta =
        reward.totalViewDelta !== null && reward.totalViewDelta !== undefined
          ? Number(reward.totalViewDelta)
          : 0;
      const frozen =
        frozenByKey.get(`${reward.campaignId}:${reward.platform}`) ?? 0;
      return {
        campaignId: reward.campaignId,
        platform: reward.platform,
        totalAmount: reward.totalAmount ? Number(reward.totalAmount) : 0,
        totalViewDelta: Math.max(0, rawViewDelta - frozen),
        latestViewCount:
          reward.latestViewCount !== null &&
          reward.latestViewCount !== undefined
            ? Number(reward.latestViewCount)
            : 0,
        lastRewardAt: reward.lastRewardAt ?? null,
      };
    });
  }),

  createCampaignViewsRewards: userRolesAdminRoleProcedure
    .input(
      z.object({
        campaignId: z.string(),
        idempotencyKey: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      return await createCampaignViewRewards({
        campaignId: input.campaignId,
        idempotencyKey: input.idempotencyKey,
      });
    }),

  listRewardEligibleUsers: rewardsModeratorRoleProcedure.query(async () => {
    const users = await db
      .select({
        discordId: user_clerk.discord_id,
        email: user_clerk.email,
        firstName: user_clerk.first_name,
        lastName: user_clerk.last_name,
        imageUrl: user_clerk.image_url,
        createdAt: user_clerk.created_at,
      })
      .from(user_clerk)
      .orderBy(desc(user_clerk.created_at));

    return users;
  }),

  createManualReward: rewardsModeratorRoleProcedure
    .input(
      z.object({
        userId: z.string().min(1, "User is required"),
        amount: z
          .number({ required_error: "Amount is required" }),
        currency: z.enum(["USD"]).default("USD"),
        memo: z.string().max(500).optional(),
        metadata: z.record(z.unknown()).optional(),
        // Attribute this adjustment to a campaign. When countsTowardCampaign
        // is true (UI default), the amount (sign preserved) is added to that
        // campaign's achieved/budget meter by the finalize cron.
        campaignId: z.string().optional(),
        countsTowardCampaign: z.boolean().default(true),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const safeMemo = input.memo?.trim() || "Manual reward adjustment";

      const userRecord = await db.query.user_clerk.findFirst({
        where: eq(user_clerk.discord_id, input.userId),
      });

      if (!userRecord) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "User not found. Make sure their Discord account is linked.",
        });
      }

      if (input.campaignId) {
        const campaignRecord = await db.query.campaigns.findFirst({
          where: eq(campaigns.id, input.campaignId),
        });
        if (!campaignRecord) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Campaign not found",
          });
        }
      }

      const amount = Number(input.amount.toFixed(4));

      return await db.transaction(async (tx) => {
        const metadataPayload = {
          version: "v1",
          source: "manual_reward",
          createdBy: ctx.user?.id ?? null,
          createdByEmail: ctx.user?.email ?? null,
          note: safeMemo,
          ...(input.metadata ?? {}),
        } satisfies Record<string, unknown>;

        const [balanceEntry] = await tx
          .insert(balance_entries)
          .values({
            user_id: input.userId,
            amount,
            currency: input.currency,
            type: "manual_adjustment",
            memo: safeMemo,
            source_type: "manual_reward",
            source_id: ctx.user?.id ?? undefined,
            metadata: metadataPayload,
            campaign_id: input.campaignId ?? null,
            // Only meaningful with a campaign attached.
            counts_toward_campaign: Boolean(
              input.campaignId && input.countsTowardCampaign
            ),
          })
          .$returningId();

        const balanceEntryId =
          typeof balanceEntry === "string" ? balanceEntry : balanceEntry?.id;

        if (!balanceEntryId) {
          throw new Error("Failed to create balance entry for manual reward");
        }

        await tx
          .insert(balances)
          .values({
            user_id: input.userId,
            balance: amount,
            totalEarned: amount,
          })
          .onDuplicateKeyUpdate({
            set: {
              balance: sql`${balances.balance} + ${amount}`,
              totalEarned: sql`${balances.totalEarned} + ${amount}`,
            },
          });

        const [updatedBalance] = await tx
          .select({
            balance: balances.balance,
            totalEarned: balances.totalEarned,
          })
          .from(balances)
          .where(eq(balances.user_id, input.userId))
          .limit(1);

        return {
          balanceEntryId,
          newBalance: Number(updatedBalance?.balance ?? 0),
          totalEarned: Number(updatedBalance?.totalEarned ?? 0),
        };
      });
    }),
});
