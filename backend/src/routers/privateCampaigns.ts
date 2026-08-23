import { TRPCError } from "@trpc/server";
import { and, count, desc, eq, inArray, isNull, sql, sum } from "drizzle-orm";
import { z } from "zod";
import { submissionOwnerInGoodStanding } from "../lib/banPurge";
import { db } from "../lib/db";
import { minViewDisplaySqlPredicate } from "../lib/campaignDisplayRules";
import {
  banned_social_media_users,
  banned_users,
  campaign_application_accounts,
  campaign_applications,
  campaign_suspensions,
  campaigns,
  non_campaign_clips,
  notifications,
  submissions,
  user_clerk,
  verified_users,
} from "../lib/schema";
import { protectedProcedure, reviewerRoleProcedure, router } from "../lib/trpc";
import {
  buildDiscordAuthorizeUrl,
  createDiscordJoinState,
  hasDiscordJoinGrant,
  isDiscordJoinConfigured,
  joinGuildViaGrant,
} from "../lib/discordJoin";

const APPLICATION_STATUSES = ["pending", "approved", "rejected"] as const;

// Public profile URL for a connected account, so a reviewing mod can open
// the real page in one click. Null for platforms without a stable URL shape.
function socialProfileUrl(platform: string, handle: string): string | null {
  const h = handle.trim().replace(/^@/, "");
  if (!h) return null;
  switch (platform.toLowerCase()) {
    case "youtube":
      return `https://www.youtube.com/@${h}`;
    case "instagram":
      return `https://www.instagram.com/${h}/`;
    case "tiktok":
      return `https://www.tiktok.com/@${h}`;
    case "x":
    case "twitter":
      return `https://x.com/${h}`;
    default:
      return null;
  }
}

// Attach each application's selected accounts (platform + handle).
async function accountsByApplication(applicationIds: string[]) {
  const map = new Map<
    string,
    { verifiedUserId: string; platform: string; handle: string }[]
  >();
  if (applicationIds.length === 0) return map;
  const rows = await db
    .select({
      applicationId: campaign_application_accounts.application_id,
      verifiedUserId: campaign_application_accounts.verified_user_id,
      platform: verified_users.platform,
      handle: verified_users.handle,
    })
    .from(campaign_application_accounts)
    .innerJoin(
      verified_users,
      eq(verified_users.id, campaign_application_accounts.verified_user_id)
    )
    .where(
      inArray(campaign_application_accounts.application_id, applicationIds)
    );
  for (const row of rows) {
    const list = map.get(row.applicationId) ?? [];
    list.push({
      verifiedUserId: row.verifiedUserId,
      platform: row.platform,
      handle: row.handle,
    });
    map.set(row.applicationId, list);
  }
  return map;
}

export const privateCampaignsRouter = router({
  // ── Clipper side ──

  // The verified accounts the clipper can pick from when applying.
  myVerifiedAccounts: protectedProcedure.query(async ({ ctx }) => {
    const accounts = await db
      .select({
        id: verified_users.id,
        platform: verified_users.platform,
        handle: verified_users.handle,
      })
      .from(verified_users)
      .where(
        and(
          eq(verified_users.discord_id, ctx.user.id),
          eq(verified_users.verified, true),
          isNull(verified_users.deleted_at),
          isNull(verified_users.account_deleted_at)
        )
      );
    return accounts;
  }),

  // The clipper's application state for one private campaign, plus the
  // fields the teaser hid once they're approved.
  getApplicationState: protectedProcedure
    .input(z.object({ campaignId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const [application] = await db
        .select()
        .from(campaign_applications)
        .where(
          and(
            eq(campaign_applications.campaign_id, input.campaignId),
            eq(campaign_applications.user_id, ctx.user.id)
          )
        )
        .limit(1);

      const accounts = application
        ? ((await accountsByApplication([application.id])).get(
            application.id
          ) ?? [])
        : [];

      // Approved clippers get the real numbers the teaser may have hidden.
      const unlocked =
        application?.status === "approved"
          ? ((
              await db
                .select({
                  title: campaigns.title,
                  imageUrl: campaigns.imageUrl,
                  budget: campaigns.budget,
                  description: campaigns.description,
                  sopEmbedUrl: campaigns.sopEmbedUrl,
                  min_payout: campaigns.min_payout,
                  max_payout: campaigns.max_payout,
                  insta_per_1000: campaigns.insta_per_1000,
                  x_per_1000: campaigns.x_per_1000,
                  youtube_per_1000: campaigns.youtube_per_1000,
                  tiktok_per_1000: campaigns.tiktok_per_1000,
                  youtube_min_views: campaigns.youtube_min_views,
                  insta_min_views: campaigns.insta_min_views,
                  x_min_views: campaigns.x_min_views,
                  tiktok_min_views: campaigns.tiktok_min_views,
                })
                .from(campaigns)
                .where(eq(campaigns.id, input.campaignId))
                .limit(1)
            )[0] ?? null)
          : null;

      return {
        application: application
          ? {
              id: application.id,
              status: application.status,
              rejectedReason: application.rejected_reason,
              discordJoinMethod: application.discord_join_method,
              discordInviteUrl: application.discord_invite_url,
              discordJoinedAt: application.discord_joined_at,
              createdAt: application.created_at,
              accounts,
            }
          : null,
        unlocked,
      };
    }),

  // ── Discord one-click join (Path B) ──
  // Whether the guilds.join flow is available and whether this clipper has
  // already authorized it, so the UI shows "Enable" vs "Join".
  getDiscordJoinStatus: protectedProcedure.query(async ({ ctx }) => ({
    configured: isDiscordJoinConfigured(),
    hasGrant: isDiscordJoinConfigured()
      ? await hasDiscordJoinGrant(ctx.user.id)
      : false,
  })),

  // Start the one-time consent: returns the Discord authorize URL to open in a
  // popup. The callback (/auth/discord/join/callback) stores the grant.
  getDiscordJoinAuthorizeUrl: protectedProcedure.mutation(({ ctx }) => {
    if (!isDiscordJoinConfigured()) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "One-click Discord join isn't configured yet.",
      });
    }
    const state = createDiscordJoinState(ctx.user.id);
    return { authorizeUrl: buildDiscordAuthorizeUrl(state) };
  }),

  // Add the caller's OWN Discord account to a private campaign's server via
  // their stored grant. Idempotent, so it doubles as "re-join". Only for the
  // caller's approved application.
  joinPrivateDiscord: protectedProcedure
    .input(z.object({ campaignId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const [application] = await db
        .select({ status: campaign_applications.status })
        .from(campaign_applications)
        .where(
          and(
            eq(campaign_applications.campaign_id, input.campaignId),
            eq(campaign_applications.user_id, ctx.user.id)
          )
        )
        .limit(1);
      if (!application || application.status !== "approved") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only approved clippers can join the server.",
        });
      }

      const [campaign] = await db
        .select({ guildId: campaigns.private_discord_guild_id })
        .from(campaigns)
        .where(eq(campaigns.id, input.campaignId))
        .limit(1);
      if (!campaign?.guildId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This campaign has no Discord server configured.",
        });
      }

      const join = await joinGuildViaGrant(ctx.user.id, campaign.guildId);
      if (join.added) {
        // Record the direct-add so the dashboard reflects it.
        await db
          .update(campaign_applications)
          .set({
            discord_join_method: "oauth",
            discord_invite_url: null,
            discord_joined_at: new Date(),
          })
          .where(
            and(
              eq(campaign_applications.campaign_id, input.campaignId),
              eq(campaign_applications.user_id, ctx.user.id)
            )
          );
        return { status: "joined" as const };
      }

      // No grant yet → tell the UI to run the one-time consent.
      const hasGrant = await hasDiscordJoinGrant(ctx.user.id);
      if (!hasGrant) return { status: "needs_auth" as const };
      // Grant exists but the add failed (bot missing from server, etc.).
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: `Couldn't add you to the server: ${join.detail}`,
      });
    }),

  // Bulk unlock for the campaign card grid: every private campaign the
  // caller is approved into, with the card fields the getAll teaser strip
  // hid (real title/logo/budget/progress). One fetch per page — the grid
  // overlays these by campaign id instead of calling getApplicationState
  // per card. Exposes nothing getApplicationState doesn't already hand an
  // approved clipper, except achievementPercentage, which derives from the
  // unlocked budget the same way getAll computes it for public campaigns.
  myUnlockedCampaigns: protectedProcedure.query(async ({ ctx }) => {
    const rows = await db
      .select({
        campaignId: campaigns.id,
        title: campaigns.title,
        imageUrl: campaigns.imageUrl,
        budget: campaigns.budget,
        min_payout: campaigns.min_payout,
        max_payout: campaigns.max_payout,
        insta_per_1000: campaigns.insta_per_1000,
        x_per_1000: campaigns.x_per_1000,
        youtube_per_1000: campaigns.youtube_per_1000,
        tiktok_per_1000: campaigns.tiktok_per_1000,
        youtube_min_views: campaigns.youtube_min_views,
        insta_min_views: campaigns.insta_min_views,
        x_min_views: campaigns.x_min_views,
        tiktok_min_views: campaigns.tiktok_min_views,
        // Same money getAll folds into achievementPercentage: approved,
        // non-deleted submission rewards + campaign-tagged manual
        // adjustments the finalize cron counts toward the budget.
        submissionRewards: sql<string | null>`(
          SELECT SUM(reward) FROM submissions
           WHERE submissions.campaign_id = ${campaigns.id}
             AND submissions.status = 'approved'
             AND submissions.deleted_at IS NULL
             AND ${submissionOwnerInGoodStanding}
             AND ${minViewDisplaySqlPredicate()}
        )`,
        manualAdjustments: sql<number>`(
          SELECT COALESCE(SUM(amount), 0) FROM balance_entries
           WHERE balance_entries.campaign_id = ${campaigns.id}
             AND balance_entries.type = 'manual_adjustment'
             AND balance_entries.counts_toward_campaign = 1
        )`,
      })
      .from(campaign_applications)
      .innerJoin(
        campaigns,
        eq(campaigns.id, campaign_applications.campaign_id)
      )
      .where(
        and(
          eq(campaign_applications.user_id, ctx.user.id),
          eq(campaign_applications.status, "approved"),
          // Public campaigns are never teaser-stripped, so an approved
          // application on a campaign that later went public needs no
          // overlay row.
          eq(campaigns.visibility, "private"),
          isNull(campaigns.card_deleted_at)
        )
      );

    return rows.map((row) => {
      const totalRewards =
        (Number(row.submissionRewards) || 0) +
        (Number(row.manualAdjustments) || 0);
      return {
        campaignId: row.campaignId,
        title: row.title,
        imageUrl: row.imageUrl,
        budget: row.budget,
        min_payout: row.min_payout,
        max_payout: row.max_payout,
        insta_per_1000: row.insta_per_1000,
        x_per_1000: row.x_per_1000,
        youtube_per_1000: row.youtube_per_1000,
        tiktok_per_1000: row.tiktok_per_1000,
        youtube_min_views: row.youtube_min_views,
        insta_min_views: row.insta_min_views,
        x_min_views: row.x_min_views,
        tiktok_min_views: row.tiktok_min_views,
        achievementPercentage:
          row.budget > 0 ? (totalRewards / row.budget) * 100 : 0,
      };
    });
  }),

  // Apply to a private campaign. One click — no account selection. Mods judge
  // the clipper on their whole history, and an approved clipper may submit from
  // ANY of their connected accounts, so there's nothing to pick. Re-applying
  // after a rejection resets the same row.
  apply: protectedProcedure
    .input(z.object({ campaignId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const [campaign] = await db
        .select({
          id: campaigns.id,
          visibility: campaigns.visibility,
          ended: campaigns.ended,
          card_deleted_at: campaigns.card_deleted_at,
        })
        .from(campaigns)
        .where(eq(campaigns.id, input.campaignId))
        .limit(1);
      if (!campaign || campaign.card_deleted_at) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Campaign not found" });
      }
      if (campaign.visibility !== "private") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This campaign doesn't require an application",
        });
      }
      if (campaign.ended) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This campaign has ended",
        });
      }

      // Compulsory: at least one verified social account connected to the
      // web-app profile. The reviewing mod judges applicants by their real
      // accounts, so an empty profile is unreviewable.
      // Same filter as myVerifiedAccounts, so the Apply button's enabled
      // state and this rule can never disagree.
      const [connected] = await db
        .select({ n: count() })
        .from(verified_users)
        .where(
          and(
            eq(verified_users.discord_id, ctx.user.id),
            eq(verified_users.verified, true),
            isNull(verified_users.deleted_at),
            isNull(verified_users.account_deleted_at)
          )
        );
      if (!connected || Number(connected.n) === 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Connect at least one social media account to your profile before applying.",
        });
      }

      const [existing] = await db
        .select()
        .from(campaign_applications)
        .where(
          and(
            eq(campaign_applications.campaign_id, input.campaignId),
            eq(campaign_applications.user_id, ctx.user.id)
          )
        )
        .limit(1);

      if (existing && existing.status !== "rejected") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            existing.status === "approved"
              ? "You're already approved for this campaign."
              : "You've already applied — a moderator will review your application.",
        });
      }

      if (existing) {
        // Rejected before — reset to pending, but PRESERVE the previous verdict
        // so the reviewing mod sees this is a re-application and why it was
        // rejected last time.
        await db
          .update(campaign_applications)
          .set({
            status: "pending",
            reviewed_by: null,
            reviewed_at: null,
            rejected_reason: null,
            discord_join_method: null,
            discord_invite_url: null,
            discord_joined_at: null,
            apply_count: sql`${campaign_applications.apply_count} + 1`,
            last_rejected_reason: existing.rejected_reason,
            last_rejected_at: existing.reviewed_at,
          })
          .where(eq(campaign_applications.id, existing.id));
        // Clear any account rows left from before applications stopped
        // collecting accounts (legacy cleanup; new applies store none).
        await db
          .delete(campaign_application_accounts)
          .where(
            eq(campaign_application_accounts.application_id, existing.id)
          );
      } else {
        await db.insert(campaign_applications).values({
          campaign_id: input.campaignId,
          user_id: ctx.user.id,
        });
      }

      return { status: "pending" as const };
    }),

  // ── Moderator side (same role as clip review) ──

  // Private campaigns with application counts, for the panel's selector.
  listPrivateCampaigns: reviewerRoleProcedure.query(async () => {
    const rows = await db
      .select({
        id: campaigns.id,
        title: campaigns.title,
        imageUrl: campaigns.imageUrl,
        active: campaigns.active,
        ended: campaigns.ended,
        pendingCount: sql<number>`(
          SELECT COUNT(*) FROM campaign_applications
          WHERE campaign_applications.campaign_id = ${campaigns.id}
            AND campaign_applications.status = 'pending'
        )`,
        approvedCount: sql<number>`(
          SELECT COUNT(*) FROM campaign_applications
          WHERE campaign_applications.campaign_id = ${campaigns.id}
            AND campaign_applications.status = 'approved'
        )`,
        rejectedCount: sql<number>`(
          SELECT COUNT(*) FROM campaign_applications
          WHERE campaign_applications.campaign_id = ${campaigns.id}
            AND campaign_applications.status = 'rejected'
        )`,
      })
      .from(campaigns)
      .where(
        and(
          eq(campaigns.visibility, "private"),
          isNull(campaigns.card_deleted_at)
        )
      )
      .orderBy(desc(campaigns.created_at));
    return rows;
  }),

  // Applications for one campaign, with applicant profile + chosen accounts.
  listApplications: reviewerRoleProcedure
    .input(
      z.object({
        campaignId: z.string().min(1),
        status: z.enum(APPLICATION_STATUSES).optional(),
      })
    )
    .query(async ({ input }) => {
      const applications = await db
        .select({
          id: campaign_applications.id,
          userId: campaign_applications.user_id,
          status: campaign_applications.status,
          rejectedReason: campaign_applications.rejected_reason,
          reviewedBy: campaign_applications.reviewed_by,
          reviewedAt: campaign_applications.reviewed_at,
          applyCount: campaign_applications.apply_count,
          lastRejectedReason: campaign_applications.last_rejected_reason,
          lastRejectedAt: campaign_applications.last_rejected_at,
          discordJoinMethod: campaign_applications.discord_join_method,
          discordInviteUrl: campaign_applications.discord_invite_url,
          createdAt: campaign_applications.created_at,
          username: user_clerk.discord_username,
          firstName: user_clerk.first_name,
          lastName: user_clerk.last_name,
          email: user_clerk.email,
          imageUrl: user_clerk.image_url,
        })
        .from(campaign_applications)
        .leftJoin(
          user_clerk,
          eq(user_clerk.discord_id, campaign_applications.user_id)
        )
        .where(
          and(
            eq(campaign_applications.campaign_id, input.campaignId),
            input.status
              ? eq(campaign_applications.status, input.status)
              : undefined
          )
        )
        .orderBy(desc(campaign_applications.created_at));

      const accountsMap = await accountsByApplication(
        applications.map((a) => a.id)
      );

      // Every verified account on the applicant's web-app PROFILE (not just
      // accounts attached to the application — one-click apply attaches
      // none), with a clickable URL so the mod can inspect the real profiles.
      const userIds = [...new Set(applications.map((a) => a.userId))];
      const profileRows = userIds.length
        ? await db
            .select({
              discordId: verified_users.discord_id,
              platform: verified_users.platform,
              handle: verified_users.handle,
            })
            .from(verified_users)
            .where(
              and(
                inArray(verified_users.discord_id, userIds),
                eq(verified_users.verified, true),
                isNull(verified_users.deleted_at),
                // Same filter as myVerifiedAccounts + the apply gate: an
                // account the deletion cron flagged gone must not show to
                // mods as a live profile.
                isNull(verified_users.account_deleted_at)
              )
            )
        : [];
      const profileAccountsByUser = new Map<
        string,
        { platform: string; handle: string; url: string | null }[]
      >();
      for (const row of profileRows) {
        const list = profileAccountsByUser.get(row.discordId) ?? [];
        list.push({
          platform: row.platform,
          handle: row.handle,
          url: socialProfileUrl(row.platform, row.handle),
        });
        profileAccountsByUser.set(row.discordId, list);
      }

      return applications.map((application) => ({
        ...application,
        name:
          [application.firstName, application.lastName]
            .filter(Boolean)
            .join(" ")
            .trim() || null,
        accounts: accountsMap.get(application.id) ?? [],
        profileAccounts: profileAccountsByUser.get(application.userId) ?? [],
      }));
    }),

  // Everything a mod needs to judge an applicant: participation history,
  // per-campaign clip counts + views, top clips, averages, and red flags
  // (bans, suspensions, autorejects).
  getApplicantStats: reviewerRoleProcedure
    .input(z.object({ userId: z.string().min(1) }))
    .query(async ({ input }) => {
      // Per-campaign participation (deleted clips excluded from views).
      const perCampaign = await db
        .select({
          campaignId: submissions.campaign_id,
          campaignTitle: campaigns.title,
          campaignImageUrl: campaigns.imageUrl,
          totalClips: count(submissions.id),
          approvedClips: sql<number>`SUM(CASE WHEN ${submissions.status} = 'approved' THEN 1 ELSE 0 END)`,
          rejectedClips: sql<number>`SUM(CASE WHEN ${submissions.status} IN ('rejected', 'autoreject') THEN 1 ELSE 0 END)`,
          pendingClips: sql<number>`SUM(CASE WHEN ${submissions.status} = 'pending' THEN 1 ELSE 0 END)`,
          totalViews: sum(submissions.views),
          totalRewards: sum(submissions.reward),
          firstClipAt: sql<string>`MIN(${submissions.created_at})`,
          lastClipAt: sql<string>`MAX(${submissions.created_at})`,
        })
        .from(submissions)
        .leftJoin(campaigns, eq(campaigns.id, submissions.campaign_id))
        .where(
          and(
            eq(submissions.user_id, input.userId),
            isNull(submissions.deleted_at)
          )
        )
        .groupBy(submissions.campaign_id, campaigns.title, campaigns.imageUrl)
        .orderBy(desc(sum(submissions.views)));

      const totalClips = perCampaign.reduce(
        (acc, c) => acc + Number(c.totalClips ?? 0),
        0
      );
      const totalViews = perCampaign.reduce(
        (acc, c) => acc + Number(c.totalViews ?? 0),
        0
      );

      // Best performing clips across all campaigns.
      const topClips = await db
        .select({
          id: submissions.id,
          url: submissions.url,
          platform: submissions.platform,
          status: submissions.status,
          views: submissions.views,
          reward: submissions.reward,
          createdAt: submissions.created_at,
          campaignTitle: campaigns.title,
        })
        .from(submissions)
        .leftJoin(campaigns, eq(campaigns.id, submissions.campaign_id))
        .where(
          and(
            eq(submissions.user_id, input.userId),
            isNull(submissions.deleted_at)
          )
        )
        .orderBy(desc(submissions.views))
        .limit(5);

      // The applicant's 100 most recent clips — campaign AND non-campaign,
      // newest first, including rejected and deleted ones (a mod judging an
      // application needs the warts, not the highlight reel).
      const recentCampaignClips = await db
        .select({
          id: submissions.id,
          url: submissions.url,
          platform: submissions.platform,
          status: submissions.status,
          rejectedReason: submissions.rejected_reason,
          views: submissions.views,
          createdAt: submissions.created_at,
          deletedAt: submissions.deleted_at,
          campaignTitle: campaigns.title,
        })
        .from(submissions)
        .leftJoin(campaigns, eq(campaigns.id, submissions.campaign_id))
        .where(eq(submissions.user_id, input.userId))
        .orderBy(desc(submissions.created_at))
        .limit(100);
      const recentNonCampaignClips = await db
        .select({
          id: non_campaign_clips.id,
          url: non_campaign_clips.url,
          platform: non_campaign_clips.platform,
          status: non_campaign_clips.status,
          rejectedReason: non_campaign_clips.rejected_reason,
          views: non_campaign_clips.views,
          createdAt: non_campaign_clips.created_at,
          deletedAt: non_campaign_clips.deleted_at,
          campaignTitle: campaigns.title,
        })
        .from(non_campaign_clips)
        .leftJoin(campaigns, eq(campaigns.id, non_campaign_clips.campaign_id))
        .where(eq(non_campaign_clips.user_id, input.userId))
        .orderBy(desc(non_campaign_clips.created_at))
        .limit(100);
      const recentClips = [
        ...recentCampaignClips.map((clip) => ({
          ...clip,
          source: "campaign" as const,
        })),
        ...recentNonCampaignClips.map((clip) => ({
          ...clip,
          source: "non-campaign" as const,
        })),
      ]
        .sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        )
        .slice(0, 100);

      // Rejection profile: rate over REVIEWED clips (pending excluded,
      // deleted excluded to reconcile with the totals above — deleted clips
      // still show in recentClips with their own badge), and the recurring
      // rejection reasons — a clipper who keeps getting the same reason
      // isn't reading feedback. Non-campaign clips count too: their
      // rejections are the same feedback loop.
      const [campaignReviewCounts] = await db
        .select({
          approved: sql<number>`SUM(CASE WHEN ${submissions.status} = 'approved' THEN 1 ELSE 0 END)`,
          rejected: sql<number>`SUM(CASE WHEN ${submissions.status} IN ('rejected', 'autoreject') THEN 1 ELSE 0 END)`,
        })
        .from(submissions)
        .where(
          and(
            eq(submissions.user_id, input.userId),
            isNull(submissions.deleted_at)
          )
        );
      const [ncReviewCounts] = await db
        .select({
          approved: sql<number>`SUM(CASE WHEN ${non_campaign_clips.status} = 'approved' THEN 1 ELSE 0 END)`,
          rejected: sql<number>`SUM(CASE WHEN ${non_campaign_clips.status} = 'rejected' THEN 1 ELSE 0 END)`,
        })
        .from(non_campaign_clips)
        .where(
          and(
            eq(non_campaign_clips.user_id, input.userId),
            isNull(non_campaign_clips.deleted_at)
          )
        );
      const approvedCount =
        Number(campaignReviewCounts?.approved ?? 0) +
        Number(ncReviewCounts?.approved ?? 0);
      const rejectedCount =
        Number(campaignReviewCounts?.rejected ?? 0) +
        Number(ncReviewCounts?.rejected ?? 0);
      const reviewedCount = approvedCount + rejectedCount;

      const campaignRejectionReasons = await db
        .select({
          reason: sql<string>`LOWER(TRIM(${submissions.rejected_reason}))`,
          n: count(submissions.id),
        })
        .from(submissions)
        .where(
          and(
            eq(submissions.user_id, input.userId),
            inArray(submissions.status, ["rejected", "autoreject"]),
            isNull(submissions.deleted_at),
            sql`${submissions.rejected_reason} IS NOT NULL AND TRIM(${submissions.rejected_reason}) != ''`
          )
        )
        .groupBy(sql`LOWER(TRIM(${submissions.rejected_reason}))`);
      const ncRejectionReasons = await db
        .select({
          reason: sql<string>`LOWER(TRIM(${non_campaign_clips.rejected_reason}))`,
          n: count(non_campaign_clips.id),
        })
        .from(non_campaign_clips)
        .where(
          and(
            eq(non_campaign_clips.user_id, input.userId),
            eq(non_campaign_clips.status, "rejected"),
            isNull(non_campaign_clips.deleted_at),
            sql`${non_campaign_clips.rejected_reason} IS NOT NULL AND TRIM(${non_campaign_clips.rejected_reason}) != ''`
          )
        )
        .groupBy(sql`LOWER(TRIM(${non_campaign_clips.rejected_reason}))`);
      const reasonTotals = new Map<string, number>();
      for (const row of [...campaignRejectionReasons, ...ncRejectionReasons]) {
        reasonTotals.set(
          row.reason,
          (reasonTotals.get(row.reason) ?? 0) + Number(row.n)
        );
      }
      const topReasons = [...reasonTotals.entries()]
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

      const rejectionSummary = {
        reviewedClips: reviewedCount,
        rejectedClips: rejectedCount,
        rejectionRatePct:
          reviewedCount > 0
            ? Math.round((rejectedCount / reviewedCount) * 100)
            : null,
        topReasons,
      };

      // ── Red flags ──
      const [ban] = await db
        .select({
          reason: banned_users.reason,
          createdAt: banned_users.created_at,
        })
        .from(banned_users)
        .where(eq(banned_users.user_id, input.userId))
        .limit(1);

      const suspensions = await db
        .select({
          campaignId: campaign_suspensions.campaign_id,
          campaignTitle: campaigns.title,
          reason: campaign_suspensions.reason,
          createdAt: campaign_suspensions.created_at,
          unsuspendedAt: campaign_suspensions.unsuspended_at,
        })
        .from(campaign_suspensions)
        .leftJoin(campaigns, eq(campaigns.id, campaign_suspensions.campaign_id))
        .where(eq(campaign_suspensions.user_id, input.userId))
        .orderBy(desc(campaign_suspensions.created_at));

      const [autorejects] = await db
        .select({ n: count(submissions.id) })
        .from(submissions)
        .where(
          and(
            eq(submissions.user_id, input.userId),
            eq(submissions.status, "autoreject")
          )
        );

      // Banned handles that match any of the applicant's verified handles.
      const applicantAccounts = await db
        .select({
          platform: verified_users.platform,
          handle: verified_users.handle,
        })
        .from(verified_users)
        .where(eq(verified_users.discord_id, input.userId));
      const bannedHandles: { platform: string; handle: string }[] = [];
      if (applicantAccounts.length > 0) {
        const handleRows = await db
          .select({
            platform: banned_social_media_users.platform,
            handle: banned_social_media_users.handle,
          })
          .from(banned_social_media_users)
          .where(
            inArray(
              banned_social_media_users.handle,
              applicantAccounts.map((a) => a.handle)
            )
          );
        for (const row of handleRows) {
          if (
            applicantAccounts.some(
              (a) =>
                a.platform === row.platform &&
                a.handle.toLowerCase() === row.handle.toLowerCase()
            )
          ) {
            bannedHandles.push(row);
          }
        }
      }

      return {
        perCampaign,
        totals: {
          campaigns: perCampaign.length,
          clips: totalClips,
          views: totalViews,
          avgViewsPerClip:
            totalClips > 0 ? Math.round(totalViews / totalClips) : 0,
        },
        topClips,
        recentClips,
        rejectionSummary,
        flags: {
          ban: ban ?? null,
          suspensions,
          autorejectCount: Number(autorejects?.n ?? 0),
          bannedHandles,
        },
      };
    }),

  // Approve or reject an application. Approval also pulls the clipper into
  // the campaign's private Discord server (OAuth add, or single-use invite).
  review: reviewerRoleProcedure
    .input(
      z.object({
        applicationId: z.string().min(1),
        // "pending" lets a mod undo a decision (accepted/rejected by mistake).
        action: z.enum(["approve", "reject", "pending"]),
        rejectedReason: z.string().trim().max(500).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const [application] = await db
        .select()
        .from(campaign_applications)
        .where(eq(campaign_applications.id, input.applicationId))
        .limit(1);
      if (!application) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Application not found",
        });
      }
      // Mods CAN re-decide an already-reviewed application (to fix an
      // accepted/rejected-by-mistake). Access follows the status live: the
      // submission gate + SOP/data unlock both key off status="approved", so
      // reversing to rejected/pending revokes access on the clipper's next
      // action. (Discord server removal on un-approve is handled separately.)
      const targetStatus =
        input.action === "approve"
          ? ("approved" as const)
          : input.action === "reject"
            ? ("rejected" as const)
            : ("pending" as const);
      // Already in the target state — no-op so a double-click can't fire a
      // second Discord invite or a duplicate notification.
      if (application.status === targetStatus) {
        return { status: targetStatus, discord: null };
      }

      const [campaign] = await db
        .select({
          title: campaigns.title,
          private_teaser_title: campaigns.private_teaser_title,
          private_discord_guild_id: campaigns.private_discord_guild_id,
        })
        .from(campaigns)
        .where(eq(campaigns.id, application.campaign_id))
        .limit(1);
      // The real name is only revealed on approval; rejected clippers keep
      // seeing the cover name (if one is set).
      const campaignTitle = campaign?.title ?? "this campaign";
      const teaserTitle =
        campaign?.private_teaser_title ?? campaignTitle;

      // ── Reset to pending ──
      // Undo a decision entirely: back to the review queue, side effects
      // cleared, so the next real decision starts from a clean slate.
      if (input.action === "pending") {
        await db
          .update(campaign_applications)
          .set({
            status: "pending",
            reviewed_by: null,
            reviewed_at: null,
            rejected_reason: null,
            discord_join_method: null,
            discord_invite_url: null,
            discord_joined_at: null,
          })
          .where(eq(campaign_applications.id, application.id));
        return { status: "pending" as const, discord: null };
      }

      if (input.action === "reject") {
        await db
          .update(campaign_applications)
          .set({
            status: "rejected",
            reviewed_by: ctx.user.id,
            reviewed_at: new Date(),
            rejected_reason: input.rejectedReason ?? null,
            // Clear the invite record too when reversing an approval, so no
            // surface can ever read a stale invite as "still in Discord."
            discord_join_method: null,
            discord_invite_url: null,
            discord_joined_at: null,
          })
          .where(eq(campaign_applications.id, application.id));

        await db.insert(notifications).values({
          user_id: application.user_id,
          title: "Private campaign application update",
          description: `Your application to "${teaserTitle}" wasn't approved this time.${input.rejectedReason ? ` Reason: ${input.rejectedReason}` : ""} You can apply again from the campaign card.`,
          expires_minutes: 14 * 24 * 60,
          metadata: {
            type: "private-campaign-application",
            alertType: "warning",
            campaignId: application.campaign_id,
          },
        });
        return { status: "rejected" as const, discord: null };
      }

      // ── Approve ──
      // Discord first (best effort), so the join outcome lands on the same
      // update. A Discord failure never blocks the approval itself.
      // Direct-add ONLY, via the clipper's own guilds.join grant — no invite
      // links, no Clerk fallback. If they already authorized one-click join
      // they're added right here; otherwise they're added the moment they click
      // "Enable one-click Discord join" on the campaign card. Never blocks the
      // approval itself.
      let discordAdded = false;
      if (campaign?.private_discord_guild_id) {
        const grantJoin = await joinGuildViaGrant(
          application.user_id,
          campaign.private_discord_guild_id
        );
        discordAdded = grantJoin.added;
      }

      await db
        .update(campaign_applications)
        .set({
          status: "approved",
          reviewed_by: ctx.user.id,
          reviewed_at: new Date(),
          rejected_reason: null,
          discord_join_method: discordAdded ? "oauth" : null,
          discord_invite_url: null,
          discord_joined_at: discordAdded ? new Date() : null,
        })
        .where(eq(campaign_applications.id, application.id));

      const discordLine = campaign?.private_discord_guild_id
        ? discordAdded
          ? " You've been added to the campaign's private Discord server — find it in your server list."
          : " Open the campaign card and click “Enable one-click Discord join” to get into the private server."
        : "";
      await db.insert(notifications).values({
        user_id: application.user_id,
        title: "You're in! Private campaign application approved",
        description: `Your application to "${campaignTitle}" was approved. You can now submit clips from any of your connected accounts.${discordLine}`,
        expires_minutes: 14 * 24 * 60,
        metadata: {
          type: "private-campaign-application",
          alertType: "success",
          campaignId: application.campaign_id,
        },
      });

      return { status: "approved" as const, discordAdded };
    }),
});
