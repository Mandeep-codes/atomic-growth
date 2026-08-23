import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, gt, isNull, inArray, sql } from "drizzle-orm";

import { db } from "../lib/db";
import {
  submissions,
  campaigns,
  campaign_activity_graces,
  campaign_suspensions,
  balances,
  balance_entries,
  deleted_clip_reserves,
  user_clerk,
  notifications,
} from "../lib/schema";
import { demographicsReviewerRoleProcedure, router } from "../lib/trpc";
import { sendDiscordDm } from "../lib/discord";

// --- week helpers (Mon–Sun, server-local) ---
function mondayOf(input: Date): Date {
  const d = new Date(input);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0 = Sun … 6 = Sat
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function weekLabel(start: Date): string {
  const end = addDays(start, 6);
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${fmt(start)} – ${fmt(end)}`;
}

const RECENT_WEEKS = 6;

// The final warning the bot DMs a clipper when a mod grants a grace week
// instead of suspending them. Fixed copy signed by the team rather than the
// individual mod who clicked, so every clipper gets the identical notice.
// Graces are strictly per-campaign and clippers routinely run several
// campaigns at once, so the notice must name WHICH campaign it's about —
// same interpolation the in-app notification already does.
const graceWarningDm = (campaignTitle: string) =>
  [
    `**⚠️ Activity Warning Notice — ${campaignTitle}**`,
    ``,
    `We have noticed that you have not been active during the past week and did not submit any clips for the **${campaignTitle}** campaign.`,
    ``,
    `As a result, you have been granted a **one-week grace period** as a final opportunity to remain in this campaign.`,
    ``,
    `**To continue, you must submit at least one clip to ${campaignTitle} within the one-week grace period.**`,
    ``,
    `Failure to meet this requirement will result in your **suspension from the ${campaignTitle} campaign**.`,
    ``,
    `**Issued by:**`,
    `**Atomik Clips Moderation Team**`,
  ].join("\n");

// Campaigns can opt out of weekly activity tracking entirely — they don't
// appear in the panel and can't accrue NEW suspensions or graces. Reads
// (getActivity) and unsuspend stay open so a campaign disabled while it
// still has suspensions on the books remains viewable and un-suspendable.
// (Existing suspensions also stop blocking submissions; see
// createSubmission.)
async function assertClipperActivityEnabled(campaignId: string) {
  const [campaign] = await db
    .select({ enabled: campaigns.clipper_activity_enabled })
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);
  if (!campaign) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Campaign not found" });
  }
  if (!campaign.enabled) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Clipper activity tracking is turned off for this campaign. Enable it on the campaign edit page first.",
    });
  }
}

export const clipperActivityRouter = router({
  // Active campaigns for the panel's campaign selector — only those with
  // activity tracking turned on.
  listActiveCampaigns: demographicsReviewerRoleProcedure.query(async () => {
    const rows = await db
      .select({ id: campaigns.id, title: campaigns.title })
      .from(campaigns)
      .where(
        and(
          eq(campaigns.active, true),
          eq(campaigns.ended, false),
          eq(campaigns.clipper_activity_enabled, true)
        )
      );
    return rows.map((r) => ({ id: r.id, title: r.title ?? "Untitled campaign" }));
  }),

  // Weekly activity for every clipper who has ever posted in a campaign,
  // plus the list of clippers who are suspendable (inactive a full week).
  getActivity: demographicsReviewerRoleProcedure
    .input(z.object({ campaignId: z.string().min(1) }))
    .query(async ({ input }) => {
      const now = new Date();
      const currentMonday = mondayOf(now);
      const lastCompletedWeekStart = addDays(currentMonday, -7);
      const lastCompletedWeekEnd = currentMonday; // exclusive

      // Recent week buckets (oldest → newest).
      const weeks = Array.from({ length: RECENT_WEEKS }, (_, i) => {
        const start = addDays(currentMonday, -7 * (RECENT_WEEKS - 1 - i));
        return {
          weekStart: start.toISOString(),
          weekEnd: addDays(start, 6).toISOString(),
          label: weekLabel(start),
          isCurrent: start.getTime() === currentMonday.getTime(),
        };
      });

      // All submissions for the campaign.
      const subs = await db
        .select({
          userId: submissions.user_id,
          createdAt: submissions.created_at,
          status: submissions.status,
        })
        .from(submissions)
        .where(eq(submissions.campaign_id, input.campaignId));

      type Agg = {
        userId: string;
        total: number;
        byWeek: Record<string, number>;
        firstAt: Date;
        lastAt: Date;
        lastCompletedWeekCount: number;
        currentWeekCount: number;
      };
      const byUser = new Map<string, Agg>();
      for (const s of subs) {
        const created = new Date(s.createdAt as unknown as string);
        const wkStart = mondayOf(created).toISOString();
        let a = byUser.get(s.userId);
        if (!a) {
          a = {
            userId: s.userId,
            total: 0,
            byWeek: {},
            firstAt: created,
            lastAt: created,
            lastCompletedWeekCount: 0,
            currentWeekCount: 0,
          };
          byUser.set(s.userId, a);
        }
        a.total += 1;
        a.byWeek[wkStart] = (a.byWeek[wkStart] ?? 0) + 1;
        if (created < a.firstAt) a.firstAt = created;
        if (created > a.lastAt) a.lastAt = created;
        if (created >= lastCompletedWeekStart && created < lastCompletedWeekEnd)
          a.lastCompletedWeekCount += 1;
        if (created >= currentMonday) a.currentWeekCount += 1;
      }

      const userIds = [...byUser.keys()];
      if (userIds.length === 0) {
        return {
          weeks,
          lastCompletedWeek: {
            weekStart: lastCompletedWeekStart.toISOString(),
            weekEnd: addDays(lastCompletedWeekStart, 6).toISOString(),
            label: weekLabel(lastCompletedWeekStart),
          },
          clippers: [],
        };
      }

      // Profile lookups + active suspensions.
      const profiles = await db
        .select({
          discordId: user_clerk.discord_id,
          username: user_clerk.discord_username,
          email: user_clerk.email,
          firstName: user_clerk.first_name,
          lastName: user_clerk.last_name,
        })
        .from(user_clerk)
        .where(inArray(user_clerk.discord_id, userIds));
      const profileById = new Map(profiles.map((p) => [p.discordId, p]));

      const activeSuspensions = await db
        .select({
          userId: campaign_suspensions.user_id,
          reason: campaign_suspensions.reason,
          createdAt: campaign_suspensions.created_at,
        })
        .from(campaign_suspensions)
        .where(
          and(
            eq(campaign_suspensions.campaign_id, input.campaignId),
            isNull(campaign_suspensions.unsuspended_at)
          )
        );
      const suspendedById = new Map(
        activeSuspensions.map((s) => [s.userId, s])
      );

      // Active grace windows: the mod chose "one more week" instead of
      // suspending. While a grace is live the clipper isn't suspendable.
      const activeGraces = await db
        .select({
          userId: campaign_activity_graces.user_id,
          expiresAt: campaign_activity_graces.expires_at,
        })
        .from(campaign_activity_graces)
        .where(
          and(
            eq(campaign_activity_graces.campaign_id, input.campaignId),
            gt(campaign_activity_graces.expires_at, now)
          )
        );
      const graceById = new Map(activeGraces.map((g) => [g.userId, g]));

      const clippers = [...byUser.values()]
        .map((a) => {
          const p = profileById.get(a.userId);
          const suspension = suspendedById.get(a.userId);
          const isSuspended = Boolean(suspension);
          const grace = graceById.get(a.userId);
          const isOnGrace = Boolean(grace) && !isSuspended;
          // Suspendable: was a participant for the entire last completed week
          // (enrolled before it started) and posted nothing in it — unless a
          // mod granted a grace week that hasn't expired yet.
          const isInactive =
            !isSuspended &&
            !isOnGrace &&
            a.firstAt < lastCompletedWeekStart &&
            a.lastCompletedWeekCount === 0;
          return {
            userId: a.userId,
            username: p?.username ?? null,
            email: p?.email ?? null,
            name:
              [p?.firstName, p?.lastName].filter(Boolean).join(" ").trim() ||
              null,
            totalClips: a.total,
            clipsByWeek: a.byWeek,
            currentWeekCount: a.currentWeekCount,
            lastCompletedWeekCount: a.lastCompletedWeekCount,
            firstClipAt: a.firstAt.toISOString(),
            lastClipAt: a.lastAt.toISOString(),
            isSuspended,
            suspensionReason: suspension?.reason ?? null,
            isInactive,
            isOnGrace,
            graceExpiresAt: grace?.expiresAt.toISOString() ?? null,
          };
        })
        .sort((x, y) => y.totalClips - x.totalClips);

      return {
        weeks,
        lastCompletedWeek: {
          weekStart: lastCompletedWeekStart.toISOString(),
          weekEnd: addDays(lastCompletedWeekStart, 6).toISOString(),
          label: weekLabel(lastCompletedWeekStart),
        },
        clippers,
      };
    }),

  // Suspend a clipper from a single campaign + notify them.
  suspend: demographicsReviewerRoleProcedure
    .input(
      z.object({
        campaignId: z.string().min(1),
        userId: z.string().min(1),
        reason: z.string().trim().max(500).optional(),
        inactiveWeekStart: z.coerce.date().optional(),
        inactiveWeekEnd: z.coerce.date().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      await assertClipperActivityEnabled(input.campaignId);
      // No duplicate active suspension.
      const [existing] = await db
        .select({ id: campaign_suspensions.id })
        .from(campaign_suspensions)
        .where(
          and(
            eq(campaign_suspensions.campaign_id, input.campaignId),
            eq(campaign_suspensions.user_id, input.userId),
            isNull(campaign_suspensions.unsuspended_at)
          )
        )
        .limit(1);
      if (existing) return { alreadySuspended: true };

      const [campaign] = await db
        .select({ title: campaigns.title })
        .from(campaigns)
        .where(eq(campaigns.id, input.campaignId))
        .limit(1);
      const campaignTitle = campaign?.title ?? "this campaign";

      await db.insert(campaign_suspensions).values({
        campaign_id: input.campaignId,
        user_id: input.userId,
        reason: input.reason ?? "Inactivity — no clips posted for a full week",
        inactive_week_start: input.inactiveWeekStart ?? null,
        inactive_week_end: input.inactiveWeekEnd ?? null,
        suspended_by: ctx.user.id,
      });

      await db.insert(notifications).values({
        user_id: input.userId,
        title: "Suspended from campaign",
        description: `You've been suspended from "${campaignTitle}" for not posting any clips for a full week (inactivity). You can no longer submit clips to this campaign until a moderator reinstates you.`,
        expires_minutes: 14 * 24 * 60,
        metadata: {
          type: "campaign-suspension",
          alertType: "warning",
          campaignId: input.campaignId,
        },
      });

      return { alreadySuspended: false };
    }),

  // Instead of suspending an inactive clipper, give them the current week as
  // a last chance. They drop out of the "eligible to suspend" list until the
  // grace expires (start of next week) and get a final-warning notification;
  // mods deliver the same warning on Discord. If they still post nothing,
  // they show up as suspendable again next week.
  grantGrace: demographicsReviewerRoleProcedure
    .input(
      z.object({
        campaignId: z.string().min(1),
        userId: z.string().min(1),
        note: z.string().trim().max(500).optional(),
        inactiveWeekStart: z.coerce.date().optional(),
        inactiveWeekEnd: z.coerce.date().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      await assertClipperActivityEnabled(input.campaignId);
      const now = new Date();

      // Suspended clippers need a reinstate, not a grace.
      const [activeSuspension] = await db
        .select({ id: campaign_suspensions.id })
        .from(campaign_suspensions)
        .where(
          and(
            eq(campaign_suspensions.campaign_id, input.campaignId),
            eq(campaign_suspensions.user_id, input.userId),
            isNull(campaign_suspensions.unsuspended_at)
          )
        )
        .limit(1);
      if (activeSuspension) {
        return {
          granted: false,
          reason: "already-suspended" as const,
          dmSent: false,
        };
      }

      const [activeGrace] = await db
        .select({ id: campaign_activity_graces.id })
        .from(campaign_activity_graces)
        .where(
          and(
            eq(campaign_activity_graces.campaign_id, input.campaignId),
            eq(campaign_activity_graces.user_id, input.userId),
            gt(campaign_activity_graces.expires_at, now)
          )
        )
        .limit(1);
      if (activeGrace) {
        return {
          granted: false,
          reason: "already-on-grace" as const,
          dmSent: false,
        };
      }

      // Grace runs to the start of next week: the clipper gets the rest of
      // the current Mon–Sun week to post. Next Monday, this week becomes the
      // "last completed week" — if they still posted nothing, they're
      // suspendable again.
      const expiresAt = addDays(mondayOf(now), 7);

      const [campaign] = await db
        .select({ title: campaigns.title })
        .from(campaigns)
        .where(eq(campaigns.id, input.campaignId))
        .limit(1);
      const campaignTitle = campaign?.title ?? "this campaign";

      await db.insert(campaign_activity_graces).values({
        campaign_id: input.campaignId,
        user_id: input.userId,
        inactive_week_start: input.inactiveWeekStart ?? null,
        inactive_week_end: input.inactiveWeekEnd ?? null,
        expires_at: expiresAt,
        granted_by: ctx.user.id,
        note: input.note ?? null,
      });

      const deadline = expiresAt.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });
      await db.insert(notifications).values({
        user_id: input.userId,
        title: "Final warning — inactivity grace week",
        description: `You went a full week without posting a clip in "${campaignTitle}". A moderator has given you one more week: post at least one clip before ${deadline} or you'll be suspended from this campaign. This is your last warning.`,
        expires_minutes: 14 * 24 * 60,
        metadata: {
          type: "campaign-activity-grace",
          alertType: "warning",
          campaignId: input.campaignId,
        },
      });

      // Same warning on Discord, where clippers actually see it. user_id IS
      // the clipper's Discord id, so no lookup is needed. Best-effort by
      // design: the grace and the in-app notification are already committed,
      // and a clipper with DMs closed must not cause the mod's click to fail.
      // dmSent tells the panel whether to ask the mod to follow up manually.
      const dm = await sendDiscordDm(input.userId, graceWarningDm(campaignTitle));
      if (!dm.sent) {
        console.error(
          `[clipperActivity] grace DM failed — user ${input.userId}, campaign ${input.campaignId}: ${dm.detail}`
        );
      }

      return {
        granted: true,
        reason: null,
        expiresAt: expiresAt.toISOString(),
        dmSent: dm.sent,
      };
    }),

  unsuspend: demographicsReviewerRoleProcedure
    .input(z.object({ campaignId: z.string().min(1), userId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      await db
        .update(campaign_suspensions)
        .set({ unsuspended_at: new Date(), unsuspended_by: ctx.user.id })
        .where(
          and(
            eq(campaign_suspensions.campaign_id, input.campaignId),
            eq(campaign_suspensions.user_id, input.userId),
            isNull(campaign_suspensions.unsuspended_at)
          )
        );
      return { ok: true };
    }),

  // ── Deleted-clip reserves (deferred clawback debt) ──

  // Every reserve, with the clipper's profile and CURRENT wallet balance so a
  // mod can see at a glance how much is collectable right now. Defaults to the
  // outstanding ones; pass status:"all" to include recovered/voided history.
  listDeletedClipReserves: demographicsReviewerRoleProcedure
    .input(
      z
        .object({ status: z.enum(["outstanding", "all"]).default("outstanding") })
        .optional()
    )
    .query(async ({ input }) => {
      const onlyOutstanding = (input?.status ?? "outstanding") === "outstanding";
      const rows = await db
        .select({
          id: deleted_clip_reserves.id,
          submissionId: deleted_clip_reserves.submission_id,
          userId: deleted_clip_reserves.user_id,
          campaignId: deleted_clip_reserves.campaign_id,
          campaignTitle: campaigns.title,
          url: deleted_clip_reserves.url,
          platform: deleted_clip_reserves.platform,
          views: deleted_clip_reserves.views,
          totalOwed: deleted_clip_reserves.total_owed,
          clawedAmount: deleted_clip_reserves.clawed_amount,
          status: deleted_clip_reserves.status,
          createdAt: deleted_clip_reserves.created_at,
          username: user_clerk.discord_username,
          firstName: user_clerk.first_name,
          lastName: user_clerk.last_name,
          balance: balances.balance,
        })
        .from(deleted_clip_reserves)
        .leftJoin(campaigns, eq(campaigns.id, deleted_clip_reserves.campaign_id))
        .leftJoin(user_clerk, eq(user_clerk.discord_id, deleted_clip_reserves.user_id))
        .leftJoin(balances, eq(balances.user_id, deleted_clip_reserves.user_id))
        .where(
          onlyOutstanding
            ? eq(deleted_clip_reserves.status, "outstanding")
            : undefined
        )
        .orderBy(desc(deleted_clip_reserves.created_at));

      return rows.map((r) => {
        const owed = Number(r.totalOwed ?? 0);
        const clawed = Number(r.clawedAmount ?? 0);
        const remaining = Number((owed - clawed).toFixed(4));
        const wallet = Math.max(0, Number(r.balance ?? 0));
        return {
          ...r,
          totalOwed: owed,
          clawedAmount: clawed,
          remaining,
          walletBalance: wallet,
          // How much a mod can take right now: capped by both the debt and
          // what's actually in the wallet (so a collection can't go negative).
          collectableNow: Number(Math.min(remaining, wallet).toFixed(4)),
          name:
            [r.firstName, r.lastName].filter(Boolean).join(" ").trim() || null,
        };
      });
    }),

  // Collect part or all of an outstanding reserve. The amount is the mod's
  // choice (0..remaining), but the actual take is additionally capped at the
  // clipper's current wallet so it never drives the balance negative — the
  // whole point of the reserve. Locked + guarded so double-clicks and
  // concurrent collections can never over-collect.
  collectDeletedClipReserve: demographicsReviewerRoleProcedure
    .input(
      z.object({
        reserveId: z.string().min(1),
        amount: z.number().positive(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      return db.transaction(async (tx) => {
        // Lock the reserve row, then the clipper's balance row.
        await tx.execute(
          sql`select 1 from ${deleted_clip_reserves} where ${deleted_clip_reserves.id} = ${input.reserveId} for update`
        );
        const [reserve] = await tx
          .select()
          .from(deleted_clip_reserves)
          .where(eq(deleted_clip_reserves.id, input.reserveId))
          .limit(1);
        if (!reserve) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Reserve not found" });
        }
        if (reserve.status !== "outstanding") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `This reserve is already ${reserve.status}.`,
          });
        }

        await tx.execute(
          sql`select 1 from ${balances} where ${balances.user_id} = ${reserve.user_id} for update`
        );
        const [balanceRow] = await tx
          .select({ balance: balances.balance })
          .from(balances)
          .where(eq(balances.user_id, reserve.user_id))
          .limit(1);

        const owed = Number(reserve.total_owed);
        const clawed = Number(reserve.clawed_amount);
        const remaining = Number((owed - clawed).toFixed(4));
        const available = Math.max(0, Number(balanceRow?.balance ?? 0));
        // Never take more than what's owed, and never more than the wallet
        // holds (this is the never-negative guarantee).
        const take = Number(
          Math.min(input.amount, remaining, available).toFixed(4)
        );
        if (take <= 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              available <= 0
                ? "The clipper's wallet is empty — nothing to collect yet."
                : "Nothing left to collect on this reserve.",
          });
        }

        // Debit the wallet + audit line naming the deleted reel.
        await tx.insert(balance_entries).values({
          user_id: reserve.user_id,
          amount: -take,
          type: "manual_adjustment",
          memo: `-$${take.toFixed(2)} collected toward deleted-reel debt ($${remaining.toFixed(2)} was outstanding of $${owed.toFixed(2)}) on ${reserve.platform ?? "platform"}: ${reserve.url ?? ""}`,
          // Same source_type as the ORIGINAL clawback (deletion / rejection /
          // uncover — carried on the reserve.reason) so that if the clip is
          // ever restored/re-approved/re-covered, reverseClawback re-credits
          // the collected amounts too (it sums by source_type + source_id).
          // Legacy reserves have reason=null → deletion. metadata.reason +
          // memo still distinguish a collection from the original debit.
          source_type: reserve.reason ?? "clip_deletion",
          source_id: reserve.submission_id,
          metadata: {
            version: "v1",
            type: "manual_adjustment",
            reason: "Deleted-clip reserve collection",
            reserveId: reserve.id,
            collectedBy: ctx.user.id,
            views: reserve.views,
          },
        });
        await tx
          .update(balances)
          .set({
            balance: sql`${balances.balance} - ${take}`,
            totalEarned: sql`${balances.totalEarned} - ${take}`,
          })
          .where(eq(balances.user_id, reserve.user_id));

        const newClawed = Number((clawed + take).toFixed(4));
        const fullyRecovered = newClawed >= owed;
        await tx
          .update(deleted_clip_reserves)
          .set({
            clawed_amount: newClawed,
            status: fullyRecovered ? "recovered" : "outstanding",
          })
          .where(eq(deleted_clip_reserves.id, reserve.id));

        return {
          collected: take,
          clawedAmount: newClawed,
          remaining: Number((owed - newClawed).toFixed(4)),
          fullyRecovered,
        };
      });
    }),
});
