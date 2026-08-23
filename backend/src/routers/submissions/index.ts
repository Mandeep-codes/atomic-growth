import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  like,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { db } from "../../lib/db";
import { env } from "../../lib/env";
import { minViewDisplayFilter } from "../../lib/campaignDisplayRules";
import {
  banned_social_media_users,
  banned_users,
  campaigns,
  campaign_applications,
  campaign_cpm_group_members,
  campaign_cpm_groups,
  campaign_suspensions,
  campaign_view_rewards,
  non_campaign_clips,
  submissions,
  verified_users,
  user_clerk,
  notifications,
  snapshot_nc_views,
  snapshot_nc_count,
} from "../../lib/schema";
import {
  protectedProcedure,
  publicProcedure,
  router,
  reviewerRoleProcedure,
  rewardsModeratorRoleProcedure,
  submissionViewCapRoleProcedure,
  ROLES,
} from "../../lib/trpc";
import {
  revokeSubmissionReward,
  voidOutstandingReserve,
} from "../../lib/revokeSubmissionReward";
import {
  computeFrozenSnapshotViews,
  payableViews,
} from "../rewards/createCampaignViewRewards";
import { restoreDeletedSubmission } from "../../lib/restoreDeletedSubmission";
import { uncoverAndClawbackNonCampaignClip } from "../../lib/noncampaignCascade";
import { ncRedemptionApplies, isNcExemptClipper } from "../../lib/ncExemptClippers";
import { reverseClawback } from "../../lib/reverseClawback";
import {
  extractVideoIdFromUrl,
  getPlatformAndHandleFromUrl,
  getPlatfromFromUrl,
} from "./helpers";
import { getPlatformMetadata } from "./platformMetadata";
import {
  cancelNonCampaignClip,
  consumeCredit,
  countUnredeemed,
  findAvailableCredit,
  findUnredeemedToCover,
  getCampaignAccountDashboard,
  getRatio,
  getRedemptionProgressByAccount,
  returnCredit,
} from "./redemptionLedger";
import {
  formatPlatformList,
  parseCampaignPlatforms,
} from "../../lib/campaignPlatforms";
import { NotificationMetadata } from "../../lib/zod-schemas/notifications";

const leaderboardExclusionFilters = ["submission_1775889753318", "submission_1775912680451"].map(
  (submissionId) => ne(submissions.id, submissionId)
);

// Public leaderboards join the campaigns table — private campaigns must show
// their teaser cover name and hide per-clip money there too (reward/views
// reconstructs the real CPM the teaser strip on campaigns.* hides).
const leaderboardCampaignColumns = {
  campaignTitle: campaigns.title,
  campaignVisibility: campaigns.visibility,
  campaignTeaserTitle: campaigns.private_teaser_title,
  campaignShowBudget: campaigns.private_show_budget,
  campaignShowRates: campaigns.private_show_rates,
};

const leaderboardCampaignTitle = (row: {
  campaignTitle: string | null;
  campaignVisibility: string | null;
  campaignTeaserTitle: string | null;
}) =>
  row.campaignVisibility === "private" && row.campaignTeaserTitle
    ? row.campaignTeaserTitle
    : row.campaignTitle;

const leaderboardReward = (
  row: {
    campaignVisibility: string | null;
    campaignShowBudget: boolean | null;
    campaignShowRates: boolean | null;
  },
  reward: number | null
) =>
  row.campaignVisibility === "private" &&
  (!row.campaignShowBudget || !row.campaignShowRates)
    ? 0
    : (reward ?? 0);

// ── ONE-TIME EXCEPTION (2026-07-05, opened to all Replit participants) ────
// ANY approved participant of the Replit private campaign may reuse their OWN
// Replit campaign-clip links as Superblocks NON-campaign clips. Scope, all
// required:
//   - the non-campaign clip targets Superblocks,
//   - the submitter is an APPROVED participant of the Replit private campaign,
//   - every non-rejected campaign submission of that link is the submitter's
//     own AND lives on the Replit private campaign.
// The global same-link-twice-as-non-campaign-clip guard is untouched, so
// each link still works at most ONCE as a non-campaign clip. Remove this
// block when the Replit private campaign ends.
const NC_REUSE_EXCEPTION = {
  sourceCampaignId: "campaign_1783258985456", // Replit Private Campaign
  targetCampaignId: "campaign_1781822345158", // Superblocks x Atomik Growth
};

// MySQL LIKE treats % and _ as wildcards, and YouTube video ids can contain
// '_'. Escape them (and backslash) so `%${videoId}%` matches the id
// literally instead of as a pattern.
const escapeLikePattern = (value: string) =>
  value.replace(/[\\%_]/g, (ch) => `\\${ch}`);

// Evaluated fresh on EVERY attempt (no cache): is this user an APPROVED
// participant of the Replit private campaign right now? Opening the reuse to
// all Replit participants (not just the "Big Boys" group) means the gate is
// simply Replit approval — the same approval that let them clip Replit at all.
async function isReplitReuseEligible(userId: string): Promise<boolean> {
  const [app] = await db
    .select({ id: campaign_applications.id })
    .from(campaign_applications)
    .where(
      and(
        eq(campaign_applications.campaign_id, NC_REUSE_EXCEPTION.sourceCampaignId),
        eq(campaign_applications.user_id, userId),
        eq(campaign_applications.status, "approved")
      )
    )
    .limit(1);
  return Boolean(app);
}

// Direction 1: a Replit campaign clip reused as a Superblocks NON-campaign
// clip.
async function isBigBoysReplitReuse(
  dupSubmissions: { user_id: string; campaign_id: string | null }[],
  ncCampaignId: string,
  userId: string
): Promise<boolean> {
  if (ncCampaignId !== NC_REUSE_EXCEPTION.targetCampaignId) return false;
  const allOwnReplit = dupSubmissions.every(
    (s) =>
      s.user_id === userId &&
      s.campaign_id === NC_REUSE_EXCEPTION.sourceCampaignId
  );
  if (!allOwnReplit) return false;
  return isReplitReuseEligible(userId);
}

// Direction 2 (link pasted on Superblocks FIRST): the same clip later
// submitted to the Replit private campaign as a campaign clip. Mirrored
// trio of conditions — the submission targets Replit, every matching
// non-campaign row is the submitter's own on Superblocks, and the
// submitter is in Big Boys at this moment.
async function isBigBoysNcBackfillToReplit(
  dupNcClips: { user_id: string; campaign_id: string }[],
  submitCampaignId: string,
  userId: string
): Promise<boolean> {
  if (submitCampaignId !== NC_REUSE_EXCEPTION.sourceCampaignId) return false;
  const allOwnSuperblocks = dupNcClips.every(
    (c) =>
      c.user_id === userId &&
      c.campaign_id === NC_REUSE_EXCEPTION.targetCampaignId
  );
  if (!allOwnSuperblocks) return false;
  return isReplitReuseEligible(userId);
}

export const submissionsRouter = router({
  getAllTimeLeaderboard: publicProcedure
    .input(z.object({ platform: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const submissionsData = await db
        .select({ submission: submissions, ...leaderboardCampaignColumns })
        .from(submissions)
        .leftJoin(campaigns, eq(submissions.campaign_id, campaigns.id))
        .leftJoin(banned_users, eq(banned_users.user_id, submissions.user_id))
        .leftJoin(
          verified_users,
          eq(verified_users.id, submissions.verified_user_id)
        )
        .leftJoin(
          banned_social_media_users,
          and(
            eq(banned_social_media_users.platform, verified_users.platform),
            eq(
              banned_social_media_users.handle,
              sql<string>`LOWER(${verified_users.handle})`
            )
          )
        )
        .where(
          and(
            eq(submissions.status, "approved"),
            // Deleted clips drop off the all-time leaderboard.
            isNull(submissions.deleted_at),
            input?.platform
              ? eq(
                sql<string>`LOWER(${submissions.platform})`,
                input.platform.toLowerCase().trim()
              )
              : undefined,
            isNull(banned_users.id),
            isNull(banned_social_media_users.id),
            ...leaderboardExclusionFilters
          )
        )
        .orderBy(desc(submissions.views))
        .limit(10);

      return submissionsData.map(({ submission, ...campaignRow }, index) => {
        const mockVelocityChange = Math.floor(Math.random() * 20000) - 5000;
        return {
          id: submission.id,
          campaignId: submission.campaign_id,
          campaignTitle:
            leaderboardCampaignTitle(campaignRow) || "Untitled Campaign",
          platform: submission.platform || "Unknown",
          creator: `Creator ${submission.user_id?.slice(-4) || Math.random().toString(36).slice(-4)
            }`,
          clipUrl: submission.url,
          viewCount: submission.views || 0,
          velocityChange: mockVelocityChange,
          isPositiveVelocity: mockVelocityChange > 0,
          rank: index + 1,
          country: submission.country,
          status: submission.status,
          category: submission.category,
          createdAt: submission.created_at,
          reward: leaderboardReward(campaignRow, submission.reward),
        };
      });
    }),
  // Get submissions data for a campaign
  getAll: publicProcedure
    .input(
      z.object({
        campaignId: z.string(),
        category: z.string().optional(),
        platform: z.string().optional(),
        viewsThreshold: z.number().optional(),
        status: z.enum(["pending", "approved", "rejected"]).optional(),
        // Public endpoint — capped so it can't be used to dump the table.
        limit: z.number().int().min(1).max(500).optional(),
      })
    )
    .query(async ({ input }) => {
      const submissionsData = await db
        .select({ submission: submissions, ...leaderboardCampaignColumns })
        .from(submissions)
        .leftJoin(campaigns, eq(submissions.campaign_id, campaigns.id))
        .leftJoin(banned_users, eq(banned_users.user_id, submissions.user_id))
        .leftJoin(
          verified_users,
          eq(verified_users.id, submissions.verified_user_id)
        )
        .leftJoin(
          banned_social_media_users,
          and(
            eq(banned_social_media_users.platform, verified_users.platform),
            eq(
              banned_social_media_users.handle,
              sql<string>`LOWER(${verified_users.handle})`
            )
          )
        )
        .where(
          and(
            eq(submissions.campaign_id, input.campaignId),
            // Deleted clips drop off the per-campaign leaderboard.
            isNull(submissions.deleted_at),
            input.category
              ? eq(submissions.category, input.category)
              : isNull(submissions.category),
            input.platform
              ? eq(
                sql<string>`LOWER(${submissions.platform})`,
                input.platform.toLowerCase().trim()
              )
              : undefined,
            input.viewsThreshold
              ? gte(submissions.views, input.viewsThreshold)
              : undefined,
            // Campaigns with a display threshold count only qualifying clips
            // (enforced regardless of the caller's viewsThreshold).
            minViewDisplayFilter(input.campaignId),
            input.status ? eq(submissions.status, input.status) : undefined,
            isNull(banned_users.id),
            isNull(banned_social_media_users.id),
            ...leaderboardExclusionFilters
          )
        )
        .orderBy(desc(submissions.views))
        .limit(input.limit ?? 10);

      // Transform the data for the leaderboard
      const leaderboardData = submissionsData.map(
        ({ submission, ...campaignRow }, index) => {
          // Generate a mock velocity change (in a real app, you'd track this over time)
          const mockVelocityChange = Math.floor(Math.random() * 20000) - 5000;

          return {
            id: submission.id,
            campaignId: submission.campaign_id,
            campaignTitle:
              leaderboardCampaignTitle(campaignRow) || "Untitled Campaign",
            platform: submission.platform || "Unknown",
            creator: `Creator ${submission.user_id?.slice(-4) ||
              Math.random().toString(36).slice(-4)
              }`,
            clipUrl: submission.url,
            viewCount: submission.views || 0,
            velocityChange: mockVelocityChange,
            isPositiveVelocity: mockVelocityChange > 0,
            rank: index + 1,
            country: submission.country,
            status: submission.status,
            category: submission.category,
            createdAt: submission.created_at,
            reward: leaderboardReward(campaignRow, submission.reward),
          };
        }
      );

      return leaderboardData;
    }),

  // Get user's own submissions
  getMySubmissions: protectedProcedure.query(async ({ ctx }) => {
    // Fetch user's submissions with campaign details
    const userSubmissions = await db
      .select({
        id: submissions.id,
        url: submissions.url,
        platform: submissions.platform,
        status: submissions.status,
        views: submissions.views,
        reward: submissions.reward,
        // Non-null = this clip's reward was clawed back (rejected / lost its
        // non-campaign cover) but its paid views are held frozen in the
        // payout baseline. Surfaced as a "Frozen" badge.
        baselineFrozenViews: submissions.baseline_frozen_views,
        category: submissions.category,
        country: submissions.country,
        rejectedReason: submissions.rejected_reason,
        created_at: submissions.created_at,
        updated_at: submissions.updated_at,
        campaign_id: submissions.campaign_id,
        campaign_title: campaigns.title,
        campaign_active: campaigns.active,
        campaign_ended: campaigns.ended,
        campaign_created_at: campaigns.created_at,
        campaign_updated_at: campaigns.updated_at,
        campaign_platforms: campaigns.platforms,
        campaign_insta_per_1000: campaigns.insta_per_1000,
        campaign_tiktok_per_1000: campaigns.tiktok_per_1000,
        campaign_youtube_per_1000: campaigns.youtube_per_1000,
        campaign_x_per_1000: campaigns.x_per_1000,
        campaign_image_url: campaigns.imageUrl,
      })
      .from(submissions)
      .leftJoin(campaigns, eq(submissions.campaign_id, campaigns.id))
      .where(and(eq(submissions.user_id, ctx.user.id)))
      .orderBy(desc(submissions.created_at));

    return userSubmissions;
  }),

  // ── A clipper's own non-campaign clips ──
  // These carry the same three states as campaign clips (pending / approved /
  // rejected) and a moderator decides them the same way, but until now they
  // existed for the clipper only as a number on a counter — the rows themselves
  // were visible in the admin screens and nowhere else. So a clipper whose
  // non-campaign clip was rejected saw their coverage silently vanish with no
  // row, no reason and no date to point at.
  //
  // Same shape as getMySubmissions where the fields mean the same thing, so the
  // page can render both lists through one set of badges.
  getMyNonCampaignClips: protectedProcedure.query(async ({ ctx }) => {
    return await db
      .select({
        id: non_campaign_clips.id,
        url: non_campaign_clips.url,
        platform: non_campaign_clips.platform,
        status: non_campaign_clips.status,
        views: non_campaign_clips.views,
        rejectedReason: non_campaign_clips.rejected_reason,
        created_at: non_campaign_clips.created_at,
        // When a moderator actually ruled on it. Null while pending — that is
        // the honest answer to "has anyone looked at this yet?".
        reviewed_at: non_campaign_clips.reviewed_at,
        // How many more campaign clips this one still covers. 0 is normal
        // (fully spent), not a problem.
        creditRemaining: non_campaign_clips.credit_remaining,
        // Set when the post itself went missing from the platform, which is a
        // different thing from a moderator rejecting it.
        deleted_at: non_campaign_clips.deleted_at,
        campaign_id: non_campaign_clips.campaign_id,
        campaign_title: campaigns.title,
        campaign_image_url: campaigns.imageUrl,
        handle: verified_users.handle,
      })
      .from(non_campaign_clips)
      .leftJoin(campaigns, eq(campaigns.id, non_campaign_clips.campaign_id))
      .leftJoin(
        verified_users,
        eq(verified_users.id, non_campaign_clips.verified_user_id)
      )
      .where(eq(non_campaign_clips.user_id, ctx.user.id))
      .orderBy(desc(non_campaign_clips.created_at));
  }),

  getMyStats: protectedProcedure.query(async ({ ctx }) => {
    const [result] = await db
      .select({
        posts: count(submissions.id),
      })
      .from(submissions)
      .where(and(eq(submissions.user_id, ctx.user.id)));

    const [rewardedViewsResult] = await db
      .select({
        rewardedViews: sql<number>`COALESCE(SUM(${campaign_view_rewards.view_delta}), 0)`,
      })
      .from(campaign_view_rewards)
      .where(eq(campaign_view_rewards.user_id, ctx.user.id));

    // Deduct FROZEN views so the number matches the wallet. When a paid
    // clip is rejected / uncovered, its views are held in the payout
    // baseline (backend) but the money was clawed back — so "rewarded
    // views" must drop by the frozen amount, or the clipper sees views
    // they think they're still owed for. Clamped at 0.
    const [frozenResult] = await db
      .select({
        frozen: sql<number>`COALESCE(SUM(${submissions.baseline_frozen_views}), 0)`,
      })
      .from(submissions)
      .where(
        and(
          eq(submissions.user_id, ctx.user.id),
          isNotNull(submissions.baseline_frozen_views)
        )
      );

    const posts = Number(result?.posts ?? 0);
    const rawRewardedViews = Number(rewardedViewsResult?.rewardedViews ?? 0);
    const frozenViews = Number(frozenResult?.frozen ?? 0);
    const totalViews = Math.max(0, rawRewardedViews - frozenViews);

    return {
      posts,
      totalViews,
    };
  }),

  // Create submission — single campaign clip per call. The old batch flow
  // (non_campaign_clip_urls + extra_campaign_clip_urls) is gone; non-campaign
  // clips are now submitted separately via submitNonCampaignClip and redeem
  // up to N prior campaign clips at a time. See ./redemptionLedger.ts.
  createSubmission: protectedProcedure
    .input(
      z.object({
        campaign_id: z.string(),
        url: z.string().url("Please enter a valid URL"),
        platform: z.enum(["youtube", "instagram", "tiktok", "x"], {
          errorMap: () => ({ message: "Please select a valid platform" }),
        }),
        category: z.string().optional(),
        country: z.string().optional(),
        is_user_generated_content: z.boolean().optional(),
        // The account the clipper picked on the submit dashboard. The flow
        // already tells them "Submitting on @X — paste a URL from this exact
        // account", but that promise was never sent to the server, so a link
        // from a DIFFERENT account of theirs was accepted and silently filed
        // against that other account instead. Optional so older clients and
        // the other entry points keep working unchanged.
        verified_handle: z.string().trim().min(1).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const isGodMode = ctx.user.roles?.includes(ROLES.GOD_MODE) ?? false;

      // Check if campaign exists and is active
      const campaignData = await db
        .select()
        .from(campaigns)
        .where(eq(campaigns.id, input.campaign_id))
        .limit(1);

      if (campaignData.length === 0 || !campaignData[0]) {
        throw new Error("Campaign not found");
      }

      const campaign = campaignData[0];
      if (!campaign.active) {
        throw new Error("Campaign is not active");
      }
      if (campaign.submissions_paused) {
        throw new Error(
          "This campaign is not accepting new submissions right now."
        );
      }

      // ── Per-campaign suspension (Feature 2) ──
      // A clipper suspended from THIS campaign (weekly inactivity) is blocked
      // from submitting to it — but not from other campaigns. Managed only in
      // the Clipper Activity admin panel. God-mode bypasses. Campaigns with
      // activity tracking turned off don't enforce suspensions at all —
      // turning the toggle off lifts any suspensions already on the books.
      if (!isGodMode && campaign.clipper_activity_enabled) {
        const [activeSuspension] = await db
          .select({ id: campaign_suspensions.id })
          .from(campaign_suspensions)
          .where(
            and(
              eq(campaign_suspensions.campaign_id, input.campaign_id),
              eq(campaign_suspensions.user_id, ctx.user.id),
              isNull(campaign_suspensions.unsuspended_at)
            )
          )
          .limit(1);
        if (activeSuspension) {
          throw new Error(
            "You've been suspended from this campaign for inactivity (no clips posted for a full week). Contact a moderator to be reinstated."
          );
        }
      }

      // ── Private campaign gate ──
      // Private campaigns only accept clips from clippers whose application was
      // approved. An approved clipper may submit from ANY of their connected
      // accounts — there is no per-account restriction. God-mode bypasses.
      if (campaign.visibility === "private" && !isGodMode) {
        const [approvedApplication] = await db
          .select({ id: campaign_applications.id })
          .from(campaign_applications)
          .where(
            and(
              eq(campaign_applications.campaign_id, input.campaign_id),
              eq(campaign_applications.user_id, ctx.user.id),
              eq(campaign_applications.status, "approved")
            )
          )
          .limit(1);
        if (!approvedApplication) {
          throw new Error(
            "This is a private campaign. Apply from the campaign card and wait for a moderator to approve you before submitting clips."
          );
        }
      }

      // The ratio is resolved here but the per-account cap check happens
      // AFTER we've identified which verified account the clipper is
      // posting from — see the block right after verifiedUserId is set.
      // Exempt clippers (ncExemptClippers.ts) never owe a non-campaign clip:
      // ratio 0 means neither the submit gate nor the resubmit gate asks them
      // for coverage, and no redemption credit is consumed.
      const ratioN = isNcExemptClipper(ctx.user.id)
        ? 0
        : getRatio(campaign);
      let claimedCreditId: string | null = null;

      const allowedPlatforms = parseCampaignPlatforms(campaign.platforms);
      if (
        allowedPlatforms.length > 0 &&
        !allowedPlatforms.includes(input.platform) &&
        !isGodMode
      ) {
        throw new Error(
          `This campaign only accepts submissions from: ${formatPlatformList(allowedPlatforms)}.`
        );
      }

      let verifiedUserId: string | null = null;

      // Check if user is verified for this platform
      const verifiedAccounts = await db
        .select()
        .from(verified_users)
        .where(
          and(
            eq(verified_users.discord_id, ctx.user.id),
            eq(verified_users.platform, input.platform),
            eq(verified_users.verified, true),
            isNull(verified_users.deleted_at)
          )
        );

      if (verifiedAccounts.length === 0) {
        throw new Error(
          `You must verify your ${input.platform} account before submitting. Please complete verification first.`
        );
      }

      const verifiedHandles = new Set(
        verifiedAccounts
          .map((account) => account.handle.toLowerCase())
          .filter((handle): handle is string => Boolean(handle))
      );

      // ── Duplicate-URL guard (cheap, no external API) ──
      // Run BEFORE the external handle lookup so a re-pasted URL surfaces
      // the truthful "already submitted" error instead of a confusing
      // "couldn't extract username" message caused by an API hiccup.
      const earlyDup = await extractVideoIdFromUrl(input.url);
      const earlyVideoId = earlyDup.videoId;
      if (!earlyVideoId) {
        throw new Error("Could not extract video ID from URL");
      }

      const existingNcEarly = await db
        .select({
          user_id: non_campaign_clips.user_id,
          campaign_id: non_campaign_clips.campaign_id,
        })
        .from(non_campaign_clips)
        .where(
          and(
            eq(non_campaign_clips.platform, input.platform),
            eq(non_campaign_clips.video_id, earlyVideoId)
          )
        );
      // One-time Big Boys carve-out, reverse direction: a link already used
      // as the submitter's own Superblocks non-campaign clip may still be
      // submitted to the Replit private campaign. See NC_REUSE_EXCEPTION.
      if (
        existingNcEarly.length > 0 &&
        !(await isBigBoysNcBackfillToReplit(
          existingNcEarly,
          input.campaign_id,
          ctx.user.id
        ))
      ) {
        throw new Error(
          "This clip has already been submitted as a non-campaign clip and can't be reused as a campaign clip."
        );
      }

      const [existingSubEarly] = await db
        .select({
          id: submissions.id,
          status: submissions.status,
          user_id: submissions.user_id,
          is_resubmit_prevented: submissions.is_resubmit_prevented,
        })
        .from(submissions)
        .where(
          and(
            like(submissions.url, `%${escapeLikePattern(earlyVideoId)}%`),
            eq(submissions.platform, input.platform)
          )
        )
        .limit(1);
      if (existingSubEarly) {
        if (existingSubEarly.is_resubmit_prevented) {
          throw new Error("Resubmissions for this clip have been disabled.");
        }
        const isOwnRejectedResubmit =
          existingSubEarly.status === "rejected" &&
          existingSubEarly.user_id === ctx.user.id;
        if (!isOwnRejectedResubmit) {
          throw new Error("This clip has already been submitted.");
        }
        // Else fall through — the resubmit branch later needs handle data
        // to flip rejected → pending.
      }

      const previewDataForHandle = await getPlatformMetadata(input.url);
      const detectedHandle = previewDataForHandle.username?.toLowerCase();

      if (!detectedHandle) {
        throw new Error("Could not extract username from the URL");
      }

      const [bannedHandle] = await db
        .select({ id: banned_social_media_users.id })
        .from(banned_social_media_users)
        .where(
          and(
            eq(banned_social_media_users.platform, input.platform),
            eq(banned_social_media_users.handle, detectedHandle)
          )
        )
        .limit(1);

      if (bannedHandle) {
        throw new Error("This handle is banned from submitting");
      }

      const verifiedAccount = verifiedHandles.has(detectedHandle)
        ? verifiedAccounts.find(
          (account) => account.handle.toLowerCase() === detectedHandle
        )
        : null;

      if (
        verifiedAccount?.platform !== input.platform &&
        verifiedAccount?.handle.toLowerCase() !== detectedHandle.toLowerCase()
      ) {
        throw new Error(
          `This link appears to belong to <${detectedHandle}>. Please submit content from a verified handle.`
        );
      }

      // ── The clip must come from the account they actually chose ──
      // Without this the check above only asked "is this ANY of your verified
      // handles?", so a clipper who clicked "Submit campaign clip on @A" could
      // paste a clip from their own @B and it was accepted — then filed under
      // @B. The redemption ledger is scoped per verified account, so the clip
      // landed on a different account's counter than the one they were looking
      // at, and the non-campaign clip they posted from @A never covered it.
      //
      // The error names BOTH accounts and says what to do, because "please
      // submit content from a verified handle" is useless when the handle IS
      // verified — it just isn't the one they picked.
      const chosenHandle = input.verified_handle?.toLowerCase();
      if (chosenHandle && detectedHandle !== chosenHandle && !isGodMode) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `You chose to submit on @${input.verified_handle}, but this link is from @${detectedHandle}. Paste a clip posted by @${input.verified_handle}, or go back and pick @${detectedHandle} to submit it there.`,
        });
      }

      verifiedUserId = verifiedAccount?.id ?? null;

      // ── Per-account redemption ledger ──
      // The ledger is scoped to (user, campaign, verified_user). A clipper
      // with multiple verified accounts (e.g. Instagram pages A, B, C) has
      // a separate balance per account: a non-campaign clip posted from
      // page A can only redeem campaign clips also posted from page A.
      // We only do this check when the campaign opts in AND we have a
      // verifiedUserId to scope by.
      if (ratioN > 0 && verifiedUserId) {
        const credit = await findAvailableCredit(
          ctx.user.id,
          input.campaign_id,
          verifiedUserId
        );
        if (credit) {
          claimedCreditId = credit.id;
        } else {
          const unredeemedNow = await countUnredeemed(
            ctx.user.id,
            input.campaign_id,
            verifiedUserId
          );
          if (unredeemedNow >= ratioN) {
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: `You've submitted ${ratioN} campaign clips from @${verifiedAccount?.handle ?? "this account"} without redeeming. Submit a non-campaign clip from the same account to continue.`,
            });
          }
        }
      }

      // videoId / resolvedUrl already computed by the early-dup guard. Re-use.
      const videoId = earlyVideoId;
      const resolvedUrl = earlyDup.resolvedUrl;

      // We only enter the resubmit branch when the early guard found a row
      // that's the clipper's own rejected submission (it fell through above).
      const existingSubmission = existingSubEarly
        ? (
            await db
              .select()
              .from(submissions)
              .where(eq(submissions.id, existingSubEarly.id))
              .limit(1)
          )[0]
        : null;

      if (existingSubmission) {
        if (
          existingSubmission.status === "rejected" &&
          existingSubmission.user_id === ctx.user.id
        ) {
          // Resubmit path: the submission flips rejected → pending. If the
          // campaign opts into redemption, we need to re-claim a credit
          // for this resurrected campaign clip just like a fresh insert.
          // Scoped per-account: only credit from the same verified account
          // can cover this clip.
          let resubmitClaimedCreditId: string | null = null;
          if (ratioN > 0 && verifiedUserId) {
            const credit = await findAvailableCredit(
              ctx.user.id,
              input.campaign_id,
              verifiedUserId
            );
            if (credit) {
              resubmitClaimedCreditId = credit.id;
              const ok = await consumeCredit(credit.id);
              if (!ok) {
                throw new TRPCError({
                  code: "PRECONDITION_FAILED",
                  message:
                    "Credit was claimed by another submission. Please retry.",
                });
              }
            } else {
              const unredeemedNow = await countUnredeemed(
                ctx.user.id,
                input.campaign_id,
                verifiedUserId
              );
              if (unredeemedNow >= ratioN) {
                throw new TRPCError({
                  code: "PRECONDITION_FAILED",
                  message: `You've submitted ${ratioN} campaign clips from @${verifiedAccount?.handle ?? "this account"} without redeeming. Submit a non-campaign clip from the same account to continue.`,
                });
              }
            }
          }

          await db
            .update(submissions)
            .set({
              status: "pending",
              rejected_reason: null,
              reviewed_by: null,
              is_resubmit_prevented: false,
              is_user_generated_content: Boolean(
                input.is_user_generated_content
              ),
              redeemed_by_non_campaign_clip_id: resubmitClaimedCreditId,
            })
            .where(eq(submissions.id, existingSubmission.id));

          return existingSubmission;
        } else {
          throw new Error("This clip has already been submitted");
        }
      }

      // Fresh-create path: consume the credit (if one was found earlier)
      // and insert the submission row with the redemption pointer set.
      if (claimedCreditId) {
        const ok = await consumeCredit(claimedCreditId);
        if (!ok) {
          // Lost a race: someone else claimed the credit between our
          // findAvailableCredit and now. Tell the clipper to retry.
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "Credit was claimed by another submission. Please retry.",
          });
        }
      }

      const submissionId = `submission_${Date.now()}`;
      await db.insert(submissions).values({
        id: submissionId,
        user_id: ctx.user.id,
        verified_user_id: verifiedUserId,
        campaign_id: input.campaign_id,
        url: resolvedUrl,
        platform: input.platform,
        category: input.category || null,
        country: input.country || null,
        is_user_generated_content: Boolean(input.is_user_generated_content),
        status: "pending",
        views: 0,
        reward: 0,
        active: true,
        redeemed_by_non_campaign_clip_id: claimedCreditId,
      });

      // Fetch and return the created submission
      const newSubmission = await db
        .select()
        .from(submissions)
        .where(eq(submissions.id, submissionId))
        .limit(1);

      return newSubmission[0];
    }),

  // ────────────────────────────────────────────────────────────────────
  // Submit a non-campaign clip — separate flow from the campaign-clip
  // submission. A non-campaign clip is what "unlocks" up to N more
  // campaign clip submissions. It also retroactively redeems up to N
  // unredeemed campaign clips the clipper has already posted (oldest
  // first), so they become eligible for payout.
  // ────────────────────────────────────────────────────────────────────
  submitNonCampaignClip: protectedProcedure
    .input(
      z.object({
        campaign_id: z.string(),
        url: z.string().url("Please enter a valid URL"),
        platform: z.enum(["youtube", "instagram", "tiktok", "x"], {
          errorMap: () => ({ message: "Please select a valid platform" }),
        }),
        // Same account scope createSubmission takes. It matters more here:
        // a non-campaign clip only covers campaign clips from the SAME
        // verified account, so one posted from the wrong account leaves the
        // account they were trying to unblock still sitting at the cap.
        verified_handle: z.string().trim().min(1).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const [campaign] = await db
        .select()
        .from(campaigns)
        .where(eq(campaigns.id, input.campaign_id))
        .limit(1);
      if (!campaign) throw new Error("Campaign not found");

      // ── Private campaign gate ──
      // Non-campaign clips stay fully supported on private campaigns (the
      // ratio/redemption ledger below is untouched), but only for clippers
      // whose application was approved — same rule as campaign clips.
      if (
        campaign.visibility === "private" &&
        !(ctx.user.roles?.includes(ROLES.GOD_MODE) ?? false)
      ) {
        const [approvedApplication] = await db
          .select({ id: campaign_applications.id })
          .from(campaign_applications)
          .where(
            and(
              eq(campaign_applications.campaign_id, input.campaign_id),
              eq(campaign_applications.user_id, ctx.user.id),
              eq(campaign_applications.status, "approved")
            )
          )
          .limit(1);
        if (!approvedApplication) {
          throw new Error(
            "This is a private campaign. Apply from the campaign card and wait for a moderator to approve you before submitting clips."
          );
        }
      }

      const ratioN = getRatio(campaign);
      if (ratioN === 0) {
        throw new Error(
          "This campaign does not require non-campaign clips. Submit a campaign clip instead."
        );
      }

      // Detect platform from the URL itself and reject if it doesn't match
      // what the clipper picked — same-platform enforcement.
      const detectedPlatform = await getPlatfromFromUrl(input.url);
      if (detectedPlatform !== input.platform) {
        throw new Error(
          `This URL looks like ${detectedPlatform ?? "an unrecognized platform"}, not ${input.platform}. Pick the right platform.`
        );
      }

      // ── Same-account enforcement ──
      // The URL's handle MUST match one of the clipper's verified accounts
      // on this platform. Without this check a clipper could submit a
      // non-campaign clip from any random page and use it to redeem
      // campaign clips on a different page they own.
      const verifiedAccounts = await db
        .select()
        .from(verified_users)
        .where(
          and(
            eq(verified_users.discord_id, ctx.user.id),
            eq(verified_users.platform, input.platform),
            eq(verified_users.verified, true),
            isNull(verified_users.deleted_at)
          )
        );
      if (verifiedAccounts.length === 0) {
        throw new Error(
          `You must verify your ${input.platform} account first before submitting a non-campaign clip there.`
        );
      }

      // ── Duplicate-URL guard (cheap, no external API) ──
      // Run BEFORE the external handle lookup so re-pasted URLs surface a
      // truthful "already submitted" error instead of a confusing
      // "couldn't extract handle" failure caused by an API hiccup.
      const { videoId, resolvedUrl } = await extractVideoIdFromUrl(input.url);
      if (!videoId) {
        throw new Error(
          "Could not detect a reel ID in your URL. Make sure it's a full post URL."
        );
      }
      const [dupInNonCampaign] = await db
        .select({
          id: non_campaign_clips.id,
          user_id: non_campaign_clips.user_id,
          status: non_campaign_clips.status,
          deleted_at: non_campaign_clips.deleted_at,
        })
        .from(non_campaign_clips)
        .where(
          and(
            eq(non_campaign_clips.platform, input.platform),
            eq(non_campaign_clips.video_id, videoId)
          )
        )
        .limit(1);
      // A clipper may RESUBMIT their own rejected non-campaign clip: the
      // existing row flips back to 'pending' in place (mirrors the campaign
      // clip resubmit flow), which keeps the (platform, video_id) unique
      // index satisfied without any delete/re-insert dance. Anyone else's
      // row — or a non-rejected one — still hard-blocks.
      let resubmitClipId: string | null = null;
      if (dupInNonCampaign) {
        const isOwnRejected =
          dupInNonCampaign.status === "rejected" &&
          dupInNonCampaign.user_id === ctx.user.id;
        if (!isOwnRejected) {
          throw new Error(
            "This clip has already been submitted as a non-campaign clip and cannot be reused."
          );
        }
        if (dupInNonCampaign.deleted_at) {
          throw new Error(
            "This clip was detected as deleted on its platform and can't be resubmitted. Submit a different clip."
          );
        }
        resubmitClipId = dupInNonCampaign.id;
      }
      const dupInSubmissions = await db
        .select({
          id: submissions.id,
          user_id: submissions.user_id,
          campaign_id: submissions.campaign_id,
        })
        .from(submissions)
        .where(
          and(
            like(submissions.url, `%${escapeLikePattern(videoId)}%`),
            eq(submissions.platform, input.platform),
            ne(submissions.status, "rejected")
          )
        );
      if (
        dupInSubmissions.length > 0 &&
        !(await isBigBoysReplitReuse(
          dupInSubmissions,
          input.campaign_id,
          ctx.user.id
        ))
      ) {
        throw new Error(
          "This clip has already been submitted as a campaign clip and cannot be reused as a non-campaign clip."
        );
      }

      const previewData = await getPlatformMetadata(input.url);
      const detectedHandle = previewData.username?.toLowerCase();
      if (!detectedHandle) {
        throw new Error("Could not extract the handle from your URL.");
      }
      const verifiedAccount = verifiedAccounts.find(
        (acc) => acc.handle.toLowerCase() === detectedHandle
      );
      if (!verifiedAccount) {
        throw new Error(
          `This URL belongs to @${detectedHandle}, which isn't one of your verified accounts on ${input.platform}. Submit a non-campaign clip from one of your verified handles.`
        );
      }

      // Same handle-ban gate createSubmission has. Without it this path was
      // the one way a banned handle could still move money: the login block
      // only checks banned_users, so someone handle-banned but not
      // account-banned signs in normally, posts a non-campaign clip from the
      // banned handle, and the re-cover cascade below re-credits the clawback
      // that the handle ban had just taken off them.
      const [bannedNcHandle] = await db
        .select({ id: banned_social_media_users.id })
        .from(banned_social_media_users)
        .where(
          and(
            eq(banned_social_media_users.platform, input.platform),
            eq(banned_social_media_users.handle, detectedHandle)
          )
        )
        .limit(1);
      if (bannedNcHandle) {
        throw new Error("This handle is banned from submitting");
      }

      // Must come from the account they chose, for the reason in the input
      // schema above: coverage is per verified account, so accepting @B's clip
      // while they were unblocking @A silently banks the credit on @B and
      // leaves @A exactly as stuck as before — with nothing on screen saying
      // why.
      const chosenNcHandle = input.verified_handle?.toLowerCase();
      if (chosenNcHandle && detectedHandle !== chosenNcHandle) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `You chose to post a non-campaign clip for @${input.verified_handle}, but this link is from @${detectedHandle}. A non-campaign clip only covers campaign clips from the same account, so paste one posted by @${input.verified_handle}.`,
        });
      }

      const verifiedUserId = verifiedAccount.id;

      // Find up to N unredeemed campaign clips for this clipper on this
      // campaign AND on this same verified account — these get covered by
      // the new non-campaign clip and become eligible for payout immediately.
      const toCover = await findUnredeemedToCover(
        ctx.user.id,
        input.campaign_id,
        verifiedUserId,
        ratioN
      );
      const creditRemaining = ratioN - toCover.length;

      const nonCampaignClipId =
        resubmitClipId ??
        `nc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      if (resubmitClipId) {
        // Resubmit: revive the clipper's own rejected row in place. Clears
        // every review field so it re-enters the mod queue as a fresh
        // pending clip; unavailability strikes reset so the view cron
        // re-evaluates from scratch.
        await db
          .update(non_campaign_clips)
          .set({
            campaign_id: input.campaign_id,
            verified_user_id: verifiedUserId,
            url: resolvedUrl || input.url,
            credit_remaining: creditRemaining,
            status: "pending",
            rejected_reason: null,
            reviewed_by: null,
            reviewer_assignment_user_id: null,
            reviewed_at: null,
            unavailable_strikes: 0,
            unavailable_since: null,
          })
          .where(eq(non_campaign_clips.id, resubmitClipId));
      } else {
        try {
          await db.insert(non_campaign_clips).values({
            id: nonCampaignClipId,
            submission_id: null,
            campaign_id: input.campaign_id,
            user_id: ctx.user.id,
            verified_user_id: verifiedUserId,
            url: resolvedUrl || input.url,
            video_id: videoId,
            platform: input.platform,
            credit_remaining: creditRemaining,
            // New submissions go to the mod review queue. Legacy backfilled
            // rows stay 'approved' (their schema default) so they don't
            // accidentally un-cover existing campaign clips.
            status: "pending",
          });
        } catch (err: unknown) {
          const isDup =
            err instanceof Error && /duplicate|unique/i.test(err.message);
          throw new Error(
            isDup
              ? "This reel was just submitted by someone else. Try a different one."
              : "Could not save your non-campaign clip. Try again."
          );
        }
      }

      // Wire the redemption pointer on each covered campaign clip. Clearing
      // the frozen-baseline snapshot in the SAME statement hands the clip's
      // payout contribution back to its live views (snapshot -> live is
      // monotone: views only grew while uncovered, and that growth was never
      // paid, so it pays exactly once on the next cron).
      if (toCover.length > 0) {
        await db
          .update(submissions)
          .set({
            redeemed_by_non_campaign_clip_id: nonCampaignClipId,
            baseline_frozen_views: null,
          })
          .where(
            inArray(
              submissions.id,
              toCover.map((s) => s.id)
            )
          );

        // If any of these campaign clips had their reward clawed back because a
        // PREVIOUS non-campaign cover was rejected/deleted, this fresh cover
        // brings that money back (the user-promised "upload a new one and the
        // money returns"). Net-aware, so it never over-credits.
        for (const covered of toCover) {
          await reverseClawback({
            submissionId: covered.id,
            clawbackSourceType: "noncampaign_uncovered",
            reverseSourceType: "noncampaign_recovered",
            memo: `Earnings restored — re-covered by a new non-campaign clip: ${
              resolvedUrl || input.url
            }`,
            reinstateReward: true,
          });
          // Cancel any still-outstanding uncover reserve — this clip is
          // covered and earning again, so the uncollected remainder is void.
          await voidOutstandingReserve(covered.id, "noncampaign_uncovered");
        }
      }

      return {
        id: nonCampaignClipId,
        coveredCount: toCover.length,
        creditRemaining,
        resubmitted: resubmitClipId !== null,
      };
    }),

  // Returns redemption progress PER VERIFIED ACCOUNT for a clipper on a
  // campaign. The clipper UI renders a small per-account table so the
  // clipper knows which of their verified handles (e.g. Instagram pages
  // A, B, C) is at the cap and needs a non-campaign clip.
  //
  // Shape: { enabled, perAccount: [{ verifiedUserId, handle, platform,
  //          unredeemed, cap, mustRedeem, allowedRemaining }] }
  // - enabled=false → the campaign hasn't opted into the flow.
  // - perAccount=[] → enabled but the clipper has no submissions on this
  //   campaign from any verified account yet.
  getRedemptionProgress: protectedProcedure
    .input(z.object({ campaign_id: z.string() }))
    .query(async ({ input, ctx }) => {
      const [campaign] = await db
        .select()
        .from(campaigns)
        .where(eq(campaigns.id, input.campaign_id))
        .limit(1);
      if (!campaign) throw new Error("Campaign not found");
      return getRedemptionProgressByAccount(
        ctx.user.id,
        input.campaign_id,
        campaign
      );
    }),

  // Used by the new /campaign/:id/submit-dashboard page to render a card
  // per verified account the clipper owns on the campaign's allowed
  // platforms — even accounts with 0 activity yet. Unlike
  // getRedemptionProgress (which only returns accounts that have
  // touched the ledger), this one enumerates all eligible accounts so
  // the clipper sees every page they could submit from.
  getCampaignAccountDashboard: protectedProcedure
    .input(z.object({ campaign_id: z.string() }))
    .query(async ({ input, ctx }) => {
      const [campaign] = await db
        .select()
        .from(campaigns)
        .where(eq(campaigns.id, input.campaign_id))
        .limit(1);
      if (!campaign) throw new Error("Campaign not found");
      const allowedPlatforms = parseCampaignPlatforms(campaign.platforms);
      return getCampaignAccountDashboard(
        ctx.user.id,
        input.campaign_id,
        campaign,
        allowedPlatforms
      );
    }),

  deleteSubmission: protectedProcedure
    .input(
      z.object({
        submissionId: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const [submission] = await db
        .select({
          id: submissions.id,
          status: submissions.status,
          userId: submissions.user_id,
        })
        .from(submissions)
        .where(eq(submissions.id, input.submissionId))
        .limit(1);

      if (!submission) {
        throw new Error("Submission not found");
      }

      if (submission.userId !== ctx.user.id) {
        throw new Error("You are not authorized to delete this submission");
      }

      if (submission.status !== "pending") {
        throw new Error("Only pending submissions can be deleted");
      }

      await db
        .delete(submissions)
        .where(eq(submissions.id, input.submissionId));

      return { id: input.submissionId };
    }),

  // Get platform breakdown for a campaign
  getPlatformBreakdown: publicProcedure
    .input(
      z.object({
        campaignId: z.string(),
        category: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      // Fetch submissions with platform and views
      const submissionsData = await db
        .select({
          platform: submissions.platform,
          views: submissions.views,
        })
        .from(submissions)
        .where(
          and(
            eq(submissions.campaign_id, input.campaignId),
            input.category
              ? eq(submissions.category, input.category)
              : isNull(submissions.category),
            // Campaigns with a display threshold count only qualifying clips.
            minViewDisplayFilter(input.campaignId)
          )
        );

      // Fetch campaign data for platform-specific CPM rates
      const campaignData = await db
        .select({
          insta_per_1000: campaigns.insta_per_1000,
          tiktok_per_1000: campaigns.tiktok_per_1000,
          youtube_per_1000: campaigns.youtube_per_1000,
          x_per_1000: campaigns.x_per_1000,
          visibility: campaigns.visibility,
          private_show_rates: campaigns.private_show_rates,
        })
        .from(campaigns)
        .where(eq(campaigns.id, input.campaignId))
        .limit(1);

      const campaign = campaignData[0];

      // Public endpoint: a private campaign with hidden rates must not
      // reveal per-platform CPMs (or valueDelivered, which derives from
      // them) — same strip as campaigns.getById.
      const ratesHidden =
        campaign?.visibility === "private" && !campaign.private_show_rates;

      // Platform CPM mapping helper
      const getPlatformCPM = (platform: string) => {
        if (ratesHidden) return 0;
        const platformMap: Record<string, number> = {
          instagram: campaign?.insta_per_1000 || 0,
          tiktok: campaign?.tiktok_per_1000 || 0,
          youtube: campaign?.youtube_per_1000 || 0,
          x: campaign?.x_per_1000 || 0,
          twitter: campaign?.x_per_1000 || 0,
        };
        return platformMap[platform.toLowerCase()] || 0;
      };

      // Group by platform and calculate totals, excluding unknown platforms
      const platformBreakdown = submissionsData
        .filter((submission) => submission.platform) // Filter out submissions without a platform
        .reduce((acc, submission) => {
          const platform = submission.platform;
          const views = submission.views || 0;
          const platformCPM = getPlatformCPM(platform);
          const valueDelivered = views * (platformCPM / 1000);

          if (!acc[platform]) {
            acc[platform] = {
              platform,
              clips: 0,
              views: 0,
              valueDelivered: 0,
              cpm: platformCPM,
            };
          }

          acc[platform].clips += 1;
          acc[platform].views += views;
          acc[platform].valueDelivered += valueDelivered;

          return acc;
        }, {} as Record<string, { platform: string; clips: number; views: number; valueDelivered: number; cpm: number }>);

      // Convert to array and sort by value delivered descending
      const result = Object.values(platformBreakdown).sort(
        (a, b) => b.valueDelivered - a.valueDelivered
      );

      return result;
    }),
  // protected, not public: each call can cost 2 YouTube quota units, so an
  // unauthenticated endpoint let anyone on the internet drain the project's
  // 10k/day quota. Every real caller (submit flow, admin review) is signed in.
  getPlatformMetadata: protectedProcedure
    .input(
      z.object({
        url: z.string().url("Please provide a valid content URL"),
      })
    )
    .query(async ({ input }) => {
      const preview = await getPlatformMetadata(input.url);
      return preview;
    }),
  getAdminSubmissions: reviewerRoleProcedure
    .input(
      z
        .object({
          status: z.enum(["pending", "approved", "rejected"]).optional(),
          campaignId: z.string().optional(),
          order: z.enum(["asc", "desc"]).optional(),
          sortBy: z.enum(["createdAt", "views"]).optional(),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const statusFilter = input?.status ?? "pending";
      const campaignFilter = input?.campaignId;
      const sortDirection = input?.order ?? "desc";
      const sortBy = input?.sortBy ?? "createdAt";

      const reviewerClerk = alias(user_clerk, "reviewer_clerk");
      const assignmentClerk = alias(user_clerk, "assignment_clerk");

      const baseQuery = db
        .select({
          id: submissions.id,
          userId: submissions.user_id,
          campaignId: submissions.campaign_id,
          // The verified account this submission is from — used by the
          // mod-side panel to look up other non-campaign clips on the
          // SAME verified account for the same user+campaign.
          verifiedUserId: submissions.verified_user_id,
          redeemedByNonCampaignClipId: submissions.redeemed_by_non_campaign_clip_id,
          url: submissions.url,
          platform: submissions.platform,
          status: submissions.status,
          views: submissions.views,
          reward: submissions.reward,
          // Non-null = reward clawed back (rejected / lost NC cover) but the
          // clip's paid views are held frozen in the payout baseline.
          baselineFrozenViews: submissions.baseline_frozen_views,
          maxViewCap: submissions.max_view_cap,
          reviewedBy: submissions.reviewed_by,
          reviewerAssignmentUserId: submissions.reviewer_assignment_user_id,
          createdAt: submissions.created_at,
          updatedAt: submissions.updated_at,
          isUserGeneratedContent: submissions.is_user_generated_content,
          campaignTitle: campaigns.title,
          clerkEmail: user_clerk.email,
          clerkFirstName: user_clerk.first_name,
          clerkLastName: user_clerk.last_name,
          clerkImageUrl: user_clerk.image_url,
          reviewerDiscordId: reviewerClerk.discord_id,
          reviewerClerkEmail: reviewerClerk.email,
          reviewerClerkFirstName: reviewerClerk.first_name,
          reviewerClerkLastName: reviewerClerk.last_name,
          reviewerClerkImageUrl: reviewerClerk.image_url,
          assignmentClerkDiscordId: assignmentClerk.discord_id,
          assignmentClerkEmail: assignmentClerk.email,
          assignmentClerkFirstName: assignmentClerk.first_name,
          assignmentClerkLastName: assignmentClerk.last_name,
          assignmentClerkImageUrl: assignmentClerk.image_url,
          rejectedReason: submissions.rejected_reason,
          campaignNonCampaignClipsRequired:
            campaigns.non_campaign_clips_required,
        })
        .from(submissions)
        .leftJoin(campaigns, eq(submissions.campaign_id, campaigns.id))
        .leftJoin(user_clerk, eq(user_clerk.discord_id, submissions.user_id))
        .leftJoin(
          reviewerClerk,
          eq(reviewerClerk.discord_id, submissions.reviewed_by)
        )
        .leftJoin(
          assignmentClerk,
          eq(
            assignmentClerk.discord_id,
            submissions.reviewer_assignment_user_id
          )
        );

      const whereConditions = [] as any[];

      if (statusFilter) {
        whereConditions.push(eq(submissions.status, statusFilter));
      }

      if (campaignFilter) {
        whereConditions.push(eq(submissions.campaign_id, campaignFilter));
      }

      const sortColumn =
        sortBy === "views" ? submissions.views : submissions.created_at;

      const submissionsData = await baseQuery
        .where(and(...whereConditions))
        .orderBy(sortDirection === "asc" ? asc(sortColumn) : desc(sortColumn))
        .limit(20000);

      // Batch-fetch the non-campaign clips attached to the returned
      // submissions so the mod review UI can show both sets of URLs
      // side by side. One query, then group by submission_id in memory.
      const submissionIds = submissionsData.map((s) => s.id);
      const nonCampaignClipsBySubmission = new Map<
        string,
        { url: string; platform: string; views: number; videoId: string }[]
      >();
      if (submissionIds.length > 0) {
        const ncRows = await db
          .select({
            submission_id: non_campaign_clips.submission_id,
            url: non_campaign_clips.url,
            platform: non_campaign_clips.platform,
            views: non_campaign_clips.views,
            video_id: non_campaign_clips.video_id,
          })
          .from(non_campaign_clips)
          .where(inArray(non_campaign_clips.submission_id, submissionIds));
        for (const row of ncRows) {
          // Under the new redemption flow non_campaign_clips.submission_id
          // is nullable; legacy rows still have it set and bucket correctly.
          if (!row.submission_id) continue;
          const sid = row.submission_id;
          const list = nonCampaignClipsBySubmission.get(sid) ?? [];
          list.push({
            url: row.url,
            platform: row.platform,
            views: row.views ?? 0,
            videoId: row.video_id,
          });
          nonCampaignClipsBySubmission.set(sid, list);
        }
      }

      // Batch-fetch the SPECIFIC non-campaign clip that covered each
      // submission (under the new redemption ledger flow). The mod UI
      // shows this inline as "Redeemed by → @handle (URL)" so mods can
      // verify same-account / same-niche at a glance.
      const redeemingIds = Array.from(
        new Set(
          submissionsData
            .map((s) => s.redeemedByNonCampaignClipId)
            .filter((v): v is string => Boolean(v))
        )
      );
      const redeemingClipById = new Map<
        string,
        { url: string; platform: string; videoId: string; verifiedUserId: string | null }
      >();
      if (redeemingIds.length > 0) {
        const rcRows = await db
          .select({
            id: non_campaign_clips.id,
            url: non_campaign_clips.url,
            platform: non_campaign_clips.platform,
            video_id: non_campaign_clips.video_id,
            verified_user_id: non_campaign_clips.verified_user_id,
          })
          .from(non_campaign_clips)
          .where(inArray(non_campaign_clips.id, redeemingIds));
        for (const r of rcRows) {
          redeemingClipById.set(r.id, {
            url: r.url,
            platform: r.platform,
            videoId: r.video_id,
            verifiedUserId: r.verified_user_id,
          });
        }
      }

      return submissionsData.map((submission) => ({
        ...submission,
        clerkEmail: submission.clerkEmail || null,
        clerkFirstName: submission.clerkFirstName || null,
        clerkLastName: submission.clerkLastName || null,
        clerkImageUrl: submission.clerkImageUrl || null,
        reviewerDiscordId: submission.reviewerDiscordId || null,
        reviewerClerkEmail: submission.reviewerClerkEmail || null,
        reviewerClerkFirstName: submission.reviewerClerkFirstName || null,
        reviewerClerkLastName: submission.reviewerClerkLastName || null,
        reviewerClerkImageUrl: submission.reviewerClerkImageUrl || null,
        reviewerAssignmentUserId: submission.reviewerAssignmentUserId || null,
        assignmentClerkDiscordId: submission.assignmentClerkDiscordId || null,
        assignmentClerkEmail: submission.assignmentClerkEmail || null,
        assignmentClerkFirstName: submission.assignmentClerkFirstName || null,
        assignmentClerkLastName: submission.assignmentClerkLastName || null,
        assignmentClerkImageUrl: submission.assignmentClerkImageUrl || null,
        maxViewCap: submission.maxViewCap ?? null,
        rejectedReason: submission.rejectedReason || null,
        nonCampaignClips: nonCampaignClipsBySubmission.get(submission.id) ?? [],
        // The specific non-campaign clip that redeemed this submission
        // (null if unredeemed). The mod UI surfaces this as a clickable
        // link so reviewers can confirm same-account / same-niche.
        redeemingNonCampaignClip: submission.redeemedByNonCampaignClipId
          ? redeemingClipById.get(submission.redeemedByNonCampaignClipId) ?? null
          : null,
        campaignNonCampaignClipsRequired:
          submission.campaignNonCampaignClipsRequired ?? null,
      }));
    }),

  getNextSubmissionForReview: reviewerRoleProcedure
    .input(
      z
        .object({
          campaignId: z.string().optional(),
        })
        .optional()
    )
    .query(async ({ input, ctx }) => {
      const whereCondition = and(
        eq(submissions.status, "pending"),
        input?.campaignId ? eq(submissions.campaign_id, input.campaignId) : undefined,
        or(
          isNull(submissions.reviewer_assignment_user_id),
          eq(submissions.reviewer_assignment_user_id, ctx.user.id)
        )
      );

      const [countRow] = await db
        .select({ remaining: count(submissions.id) })
        .from(submissions)
        .where(whereCondition);

      const [nextSubmission] = await db
        .select({
          id: submissions.id,
          userId: submissions.user_id,
          campaignId: submissions.campaign_id,
          url: submissions.url,
          platform: submissions.platform,
          views: submissions.views,
          createdAt: submissions.created_at,
          reviewerAssignmentUserId: submissions.reviewer_assignment_user_id,
          isUserGeneratedContent: submissions.is_user_generated_content,
          campaignTitle: campaigns.title,
        })
        .from(submissions)
        .leftJoin(campaigns, eq(submissions.campaign_id, campaigns.id))
        .where(whereCondition)
        .orderBy(asc(submissions.created_at))
        .limit(1);

      return {
        remaining: Number(countRow?.remaining ?? 0),
        submission: nextSubmission
          ? {
            ...nextSubmission,
            platform: nextSubmission.platform || null,
            views: nextSubmission.views ?? 0,
            campaignTitle: nextSubmission.campaignTitle || null,
            reviewerAssignmentUserId: nextSubmission.reviewerAssignmentUserId || null,
          }
          : null,
      };
    }),

  claimReviewBatchV2: reviewerRoleProcedure
    .input(
      z.object({
        batchSize: z.number().min(1).max(25).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const batchSize = input.batchSize ?? 10;

      const activeCampaignRows = await db
        .select({ id: campaigns.id })
        .from(campaigns)
        .where(and(eq(campaigns.active, true), eq(campaigns.ended, false)));

      const activeCampaignIds = activeCampaignRows.map((row) => row.id);

      if (activeCampaignIds.length === 0) {
        return { remaining: 0, submissions: [] };
      }

      const pendingActiveWhere = and(
        eq(submissions.status, "pending"),
        eq(submissions.active, true),
        inArray(submissions.campaign_id, activeCampaignIds)
      );

      const [countRow] = await db
        .select({ remaining: count(submissions.id) })
        .from(submissions)
        .where(pendingActiveWhere);

      const currentlyAssigned = await db
        .select({
          id: submissions.id,
          campaignId: submissions.campaign_id,
          url: submissions.url,
          platform: submissions.platform,
          views: submissions.views,
          createdAt: submissions.created_at,
          campaignTitle: campaigns.title,
        })
        .from(submissions)
        .where(
          and(
            eq(submissions.reviewer_assignment_user_id, ctx.user.id),
            pendingActiveWhere
          )
        )
        .leftJoin(campaigns, eq(submissions.campaign_id, campaigns.id))
        .orderBy(asc(submissions.created_at))
        .limit(batchSize);

      const needed = Math.max(0, batchSize - currentlyAssigned.length);

      if (needed > 0) {
        const candidateLimit = Math.max(needed * 30, 200);
        const candidates = await db
          .select({ id: submissions.id })
          .from(submissions)
          .where(
            and(
              pendingActiveWhere,
              isNull(submissions.reviewer_assignment_user_id)
            )
          )
          .limit(candidateLimit);

        const idsToClaim = candidates
          .sort(() => Math.random() - 0.5)
          .slice(0, needed)
          .map((row) => row.id);

        if (idsToClaim.length > 0) {
          await db
            .update(submissions)
            .set({
              reviewer_assignment_user_id: ctx.user.id,
              updated_at: new Date(),
            })
            .where(
              and(
                inArray(submissions.id, idsToClaim),
                eq(submissions.status, "pending"),
                isNull(submissions.reviewer_assignment_user_id)
              )
            );
        }
      }

      const assignedBatch = await db
        .select({
          id: submissions.id,
          campaignId: submissions.campaign_id,
          url: submissions.url,
          platform: submissions.platform,
          views: submissions.views,
          createdAt: submissions.created_at,
          campaignTitle: campaigns.title,
          campaignNonCampaignClipsRequired:
            campaigns.non_campaign_clips_required,
        })
        .from(submissions)
        .where(
          and(
            eq(submissions.reviewer_assignment_user_id, ctx.user.id),
            pendingActiveWhere
          )
        )
        .leftJoin(campaigns, eq(submissions.campaign_id, campaigns.id))
        .orderBy(asc(submissions.created_at))
        .limit(batchSize);

      // Batch-fetch non-campaign clips so the per-clip review UI can
      // show them inline next to the campaign URL.
      const batchIds = assignedBatch.map((s) => s.id);
      const nonCampaignClipsBySubmission = new Map<
        string,
        { url: string; platform: string; views: number; videoId: string }[]
      >();
      if (batchIds.length > 0) {
        const ncRows = await db
          .select({
            submission_id: non_campaign_clips.submission_id,
            url: non_campaign_clips.url,
            platform: non_campaign_clips.platform,
            views: non_campaign_clips.views,
            video_id: non_campaign_clips.video_id,
          })
          .from(non_campaign_clips)
          .where(inArray(non_campaign_clips.submission_id, batchIds));
        for (const row of ncRows) {
          if (!row.submission_id) continue;
          const sid = row.submission_id;
          const list = nonCampaignClipsBySubmission.get(sid) ?? [];
          list.push({
            url: row.url,
            platform: row.platform,
            views: row.views ?? 0,
            videoId: row.video_id,
          });
          nonCampaignClipsBySubmission.set(sid, list);
        }
      }

      return {
        remaining: Number(countRow?.remaining ?? 0),
        submissions: assignedBatch.map((submission) => ({
          ...submission,
          platform: submission.platform || null,
          views: submission.views ?? 0,
          campaignTitle: submission.campaignTitle || null,
          nonCampaignClips:
            nonCampaignClipsBySubmission.get(submission.id) ?? [],
          campaignNonCampaignClipsRequired:
            submission.campaignNonCampaignClipsRequired ?? null,
        })),
      };
    }),
  assignSubmissions: reviewerRoleProcedure
    .input(
      z.object({
        submissionIds: z
          .array(z.string())
          .min(1, "Select at least one submission"),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (!ctx.user?.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Reviewer identity is required",
        });
      }

      const submissionsToAssign = await db
        .select({
          id: submissions.id,
          reviewerAssignmentUserId: submissions.reviewer_assignment_user_id,
          status: submissions.status,
        })
        .from(submissions)
        .where(inArray(submissions.id, input.submissionIds));

      if (submissionsToAssign.length !== input.submissionIds.length) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "One or more submissions no longer exist",
        });
      }

      const conflicts = submissionsToAssign.filter(
        (submission) =>
          submission.reviewerAssignmentUserId &&
          submission.reviewerAssignmentUserId !== ctx.user.id
      );

      if (conflicts.length) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Some submissions are already assigned to another reviewer",
        });
      }

      const assignableIds = submissionsToAssign
        .filter(
          (submission) =>
            submission.status === "pending" &&
            (!submission.reviewerAssignmentUserId ||
              submission.reviewerAssignmentUserId === ctx.user.id)
        )
        .map((submission) => submission.id);

      if (!assignableIds.length) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Selected submissions cannot be assigned",
        });
      }

      await db
        .update(submissions)
        .set({
          reviewer_assignment_user_id: ctx.user.id,
          updated_at: new Date(),
        })
        .where(
          and(
            inArray(submissions.id, assignableIds),
            eq(submissions.status, "pending")
          )
        );

      return { assignedCount: assignableIds.length };
    }),
  unassignSubmissions: reviewerRoleProcedure
    .input(
      z.object({
        submissionIds: z
          .array(z.string())
          .min(1, "Select at least one submission"),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (!ctx.user?.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Reviewer identity is required",
        });
      }

      const submissionsToUnassign = await db
        .select({
          id: submissions.id,
          reviewerAssignmentUserId: submissions.reviewer_assignment_user_id,
          status: submissions.status,
        })
        .from(submissions)
        .where(inArray(submissions.id, input.submissionIds));

      if (submissionsToUnassign.length !== input.submissionIds.length) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "One or more submissions no longer exist",
        });
      }

      // const conflicts = submissionsToUnassign.filter(
      //   (submission) =>
      //     submission.reviewerAssignmentUserId &&
      //     submission.reviewerAssignmentUserId !== ctx.user.id
      // );

      // if (conflicts.length) {
      //   throw new TRPCError({
      //     code: "FORBIDDEN",
      //     message: "Some submissions are assigned to another reviewer",
      //   });
      // }

      const unassignableIds = submissionsToUnassign
        .filter(
          (submission) =>
            submission.status === "pending" &&
            Boolean(submission.reviewerAssignmentUserId)
        )
        .map((submission) => submission.id);

      if (!unassignableIds.length) {
        return { unassignedCount: 0 };
      }

      await db
        .update(submissions)
        .set({
          reviewer_assignment_user_id: null,
          updated_at: new Date(),
        })
        .where(
          and(
            inArray(submissions.id, unassignableIds),
            eq(submissions.status, "pending")
          )
        );

      return { unassignedCount: unassignableIds.length };
    }),
  unassignSubmission: reviewerRoleProcedure
    .input(z.object({ submissionId: z.string() }))
    .mutation(async ({ input }) => {
      const [submissionToUnassign] = await db
        .select({
          id: submissions.id,
          status: submissions.status,
          reviewerAssignmentUserId: submissions.reviewer_assignment_user_id,
        })
        .from(submissions)
        .where(eq(submissions.id, input.submissionId))
        .limit(1);

      if (!submissionToUnassign) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Submission not found",
        });
      }

      if (submissionToUnassign.status !== "pending") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Only pending submissions can be unassigned",
        });
      }

      if (!submissionToUnassign.reviewerAssignmentUserId) {
        return { success: true };
      }

      await db
        .update(submissions)
        .set({
          reviewer_assignment_user_id: null,
          updated_at: new Date(),
        })
        .where(eq(submissions.id, input.submissionId));

      return { success: true };
    }),
  setSubmissionViewCap: submissionViewCapRoleProcedure
    .input(
      z.object({
        submissionId: z.string(),
        maxViewCap: z.number().int().min(0).nullable(),
      })
    )
    .mutation(async ({ input }) => {
      const [submission] = await db
        .select({
          id: submissions.id,
          views: submissions.views,
        })
        .from(submissions)
        .where(eq(submissions.id, input.submissionId))
        .limit(1);

      if (!submission) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Submission not found",
        });
      }

      const capValue = input.maxViewCap ?? null;

      const updatePayload: Partial<typeof submissions.$inferInsert> = {
        max_view_cap: capValue,
        updated_at: new Date(),
      };

      // Do NOT rewrite stored views down to the cap: the view cron already
      // clamps at read (currentViews) and write (normalizedNewViews), and
      // under delta-based scoreboard pricing lowering stored views without
      // touching the banked reward would make a later cap raise re-price
      // views whose reward is already banked.

      await db
        .update(submissions)
        .set(updatePayload)
        .where(eq(submissions.id, input.submissionId));

      return { success: true, maxViewCap: capValue };
    }),
  getReviewerIdentity: reviewerRoleProcedure.query(({ ctx }) => ({
    reviewerId: ctx.user.id,
    email: ctx.user.email ?? null,
    firstName: ctx.user.firstName ?? null,
    lastName: ctx.user.lastName ?? null,
    discordId: ctx.user.discordId,
    discordUsername: ctx.user.discordUsername ?? null,
  })),
  updateSubmissionStatus: reviewerRoleProcedure
    .input(
      z.object({
        submissionId: z.string(),
        status: z.enum(["approved", "rejected"]),
        rejectedReason: z.string().optional(),
        preventResubmission: z.boolean().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const [existingSubmission] = await db
        .select()
        .from(submissions)
        .where(eq(submissions.id, input.submissionId))
        .limit(1);

      if (!existingSubmission) {
        throw new Error("Submission not found");
      }

      if (
        existingSubmission.reviewer_assignment_user_id &&
        existingSubmission.reviewer_assignment_user_id !== ctx.user.id
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "This submission is assigned to another reviewer",
        });
      }

      if (
        input.status === "rejected" &&
        (!input.rejectedReason || input.rejectedReason.trim() === "")
      ) {
        throw new Error("Rejection reason is required");
      }

      const updatePayload: Partial<typeof submissions.$inferInsert> = {
        status: input.status,
        reviewed_by: ctx.user.id,
        reviewer_assignment_user_id: null,
        rejected_reason:
          input.status === "rejected"
            ? input.rejectedReason?.trim() ?? null
            : null,
        is_resubmit_prevented:
          input.status === "rejected"
            ? Boolean(input.preventResubmission)
            : false,
      };

      if (input.status === "rejected") {
        // Zero the reward but KEEP the views (mirroring the deletion flow).
        // Under delta-based scoreboard pricing the (views, reward) pair is
        // the accrual baseline: zeroing views while re-approval reinstates
        // only the reward would make the next cron re-price the clip's
        // entire history ON TOP of the reinstated amount. Rejected clips
        // are excluded from stats/payouts by status anyway.
        updatePayload.reward = 0;
      }
      // (No manual reward override on approve: neither admin frontend ever
      // passed one, and under delta pricing an explicit value would compound
      // with reverseClawback's reinstatement into a wallet-unbacked baseline.)

      // Legacy repair: clips rejected BEFORE the delta-pricing change had
      // their views zeroed at rejection. Approving one of those must restore
      // the view baseline too, or the reinstated reward double-counts on the
      // next cron tick. Matches ANY transition to approved (not just
      // rejected→approved) because the resubmit flow parks legacy-rejected
      // clips at `pending` first — views_api_response > 0 with views == 0
      // can only mean "previously tracked, then zeroed", never a fresh clip
      // (the cron only tracks approved clips). Clamp to max_view_cap:
      // views_api_response holds the RAW api value, while the zeroed views
      // column held the capped one.
      if (
        input.status === "approved" &&
        (existingSubmission.views ?? 0) === 0 &&
        (existingSubmission.views_api_response ?? 0) > 0
      ) {
        updatePayload.views =
          typeof existingSubmission.max_view_cap === "number"
            ? Math.min(
                existingSubmission.views_api_response,
                existingSubmission.max_view_cap
              )
            : existingSubmission.views_api_response;
      }

      // Capture the redemption pointer BEFORE we update — we need it to know
      // which non-campaign clip's credit to bump back on rejection.
      const redeemedByNonCampaignClipId =
        existingSubmission.redeemed_by_non_campaign_clip_id ?? null;

      // ── Frozen-baseline snapshot maintenance (odometer freeze fix) ──
      // A paid clip leaving 'approved' would vanish from the payout baseline
      // while the paid odometer stays put — freezing the clipper at $0 until
      // NEW views re-climb views whose money the clawback below already
      // takes. The snapshot keeps the clip's contribution frozen in place:
      // nothing vanishes (no freeze), nothing grows (no re-pay).
      //
      // "Was contributing" = the clip's views were actually in the payout
      // baseline (and therefore paid): true off a non-redemption campaign,
      // or when redeemed on a redemption campaign. An UNREDEEMED clip on a
      // redemption campaign was NEVER paid (payableViews returns 0 for it),
      // so it gets neither a snapshot NOR a clawback below — mirroring the
      // deletion path's neverPaid guard (updateViewCounts.ts). This is the
      // fix for the "claw back money never paid" blocker.
      let rejectionWasContributing = false;
      if (
        existingSubmission.status === "approved" &&
        input.status === "rejected"
      ) {
        const [campaignRow] = await db
          .select({ ncRequired: campaigns.non_campaign_clips_required })
          .from(campaigns)
          .where(eq(campaigns.id, existingSubmission.campaign_id))
          .limit(1);
        const redemptionEnabled = ncRedemptionApplies(
          existingSubmission.user_id,
          campaignRow?.ncRequired
        );
        // "Was contributing" = the clip's views were in the payout baseline
        // (and therefore paid). payableViews already encodes this: a clip
        // carrying a frozen snapshot counts (it was paid on a PRIOR
        // rejection), so reject -> re-approve -> reject re-claws instead of
        // leaking the reinstated reward. A genuinely-unredeemed clip with no
        // snapshot returns 0 -> never paid -> no snapshot, no clawback.
        rejectionWasContributing =
          payableViews(existingSubmission, redemptionEnabled) > 0;
        if (
          rejectionWasContributing &&
          existingSubmission.baseline_frozen_views === null
        ) {
          // Clamp to the PAID-THROUGH contribution, not raw live views, so
          // the baseline can never exceed the odometer (the overshoot bug).
          updatePayload.baseline_frozen_views = await computeFrozenSnapshotViews(
            existingSubmission,
            redemptionEnabled
          );
        }
      }
      if (
        existingSubmission.status !== "approved" &&
        input.status === "approved" &&
        existingSubmission.baseline_frozen_views !== null
      ) {
        const [campaignRow] = await db
          .select({ ncRequired: campaigns.non_campaign_clips_required })
          .from(campaigns)
          .where(eq(campaigns.id, existingSubmission.campaign_id))
          .limit(1);
        const redemptionEnabled = ncRedemptionApplies(
          existingSubmission.user_id,
          campaignRow?.ncRequired
        );
        // Approval puts the clip back into live payout, so the snapshot
        // hands over to live views — but ONLY if live views will actually
        // count: always true on non-redemption campaigns, and true on
        // redemption campaigns when the clip is covered (the resubmit flow
        // re-claims a credit before review). A plain re-approval on a
        // redemption campaign leaves the clip UNREDEEMED (rejection
        // returned its NC credit), so the snapshot must stay and hands
        // over at re-cover instead — or the clipper would freeze all over
        // again.
        if (!redemptionEnabled || redeemedByNonCampaignClipId !== null) {
          updatePayload.baseline_frozen_views = null;
        }
      }

      await db
        .update(submissions)
        .set(updatePayload)
        .where(eq(submissions.id, input.submissionId));

      // Redemption-ledger maintenance on rejection:
      // - If this campaign clip was redeemed by a non-campaign clip, bump
      //   that non-campaign clip's credit_remaining by 1 — the freed slot
      //   goes back into the ledger so the clipper can submit a new
      //   campaign clip without needing another non-campaign clip.
      // - We also null out submissions.redeemed_by_non_campaign_clip_id so
      //   the link is broken; if the clipper later resubmits the same reel
      //   (rejected → pending), it'll re-claim a fresh credit at that point.
      // The non_campaign_clips row itself is NEVER deleted on rejection
      // anymore — under the new ledger flow the non-campaign clip is
      // decoupled from any single campaign submission.
      if (input.status === "rejected" && redeemedByNonCampaignClipId) {
        await returnCredit(redeemedByNonCampaignClipId);
        await db
          .update(submissions)
          .set({ redeemed_by_non_campaign_clip_id: null })
          .where(eq(submissions.id, input.submissionId));
      }

      const [updatedSubmission] = await db
        .select({
          id: submissions.id,
          userId: submissions.user_id,
          url: submissions.url,
          status: submissions.status,
          reward: submissions.reward,
          updatedAt: submissions.updated_at,
          rejectedReason: submissions.rejected_reason,
          campignTitle: campaigns.title,
          reviewedBy: user_clerk.first_name,
        })
        .from(submissions)
        .leftJoin(campaigns, eq(submissions.campaign_id, campaigns.id))
        .leftJoin(
          user_clerk,
          eq(user_clerk.discord_id, submissions.reviewed_by)
        )
        .where(eq(submissions.id, input.submissionId))
        .limit(1);

      // Reverse previously awarded rewards if the submission just switched to
      // rejected — but ONLY if the clip was actually paid. An unredeemed clip
      // on a redemption campaign has a scoreboard reward > 0 (the view cron
      // prices it) yet was NEVER paid to the wallet, so clawing it would take
      // OTHER clips' real money / open a phantom reserve. rejectionWasContributing
      // gates this exactly like the deletion path's neverPaid guard.
      const rewardToRevoke = Number(existingSubmission?.reward ?? 0);
      const shouldRevokeReward =
        updatedSubmission &&
        updatedSubmission.status === "rejected" &&
        rewardToRevoke > 0 &&
        rejectionWasContributing;

      if (shouldRevokeReward && updatedSubmission) {
        // Reserve mode — never drives the wallet negative. Before the
        // frozen-baseline fix, a rejection whose clawback the wallet couldn't
        // cover (already withdrawn) was implicitly recovered by the odometer
        // freeze. The snapshot removes that freeze, so the shortfall must be
        // tracked explicitly — but as a collectible reserve (like deletions),
        // NOT a negative balance. A mod collects it from future earnings via
        // the Deleted-clip reserves panel; re-approval below voids it.
        await revokeSubmissionReward({
          submissionId: updatedSubmission.id,
          userId: updatedSubmission.userId,
          rewardAmount: rewardToRevoke,
          memo: `-$${rewardToRevoke.toFixed(2)} removed because this clip was rejected: ${updatedSubmission.url}`,
          reason: "Submission reward removed after rejection",
          sourceType: "submission_rejection",
          reserveOnShortfall: {
            campaignId: existingSubmission.campaign_id,
            url: existingSubmission.url,
            platform: existingSubmission.platform,
            views: existingSubmission.views ?? 0,
          },
        });
      }

      // Side-effects
      if (
        updatedSubmission &&
        updatedSubmission.status === "rejected" &&
        !input.preventResubmission
      ) {
        // fire and forget
        await db.insert(notifications).values({
          user_id: updatedSubmission.userId,
          title: "Heads up—clip needs edits",
          description: `Your clip for ${updatedSubmission.campignTitle} needs a quick tweak before it can go live.`,
          expires_minutes: 3 * 24 * 60, // 3 days
          metadata: {
            type: "submission-rejected",
            alertType: "warning",
            submissionUrl: updatedSubmission.url,
            rejectionReason: updatedSubmission.rejectedReason ?? undefined,
            reviewer: updatedSubmission.reviewedBy ?? undefined,
          } satisfies NotificationMetadata,
        });
      } else if (updatedSubmission && updatedSubmission.status === "approved") {
        // If this clip's reward was clawed back when it was previously
        // rejected, re-approving it must give that money back. Nothing else
        // reverses a `submission_rejection` clawback — reverseClawback is only
        // wired for non-campaign re-cover (`noncampaign_uncovered`) and deleted
        // clips (`clip_deletion`), so rejected→re-approved clips silently lose
        // their reward. This closes that gap.
        //
        // reverseClawback is net-aware: it credits (sum of submission_rejection
        // clawbacks − prior reward_restored_reapproval reversals). Using the
        // same reverse source_type as the June 2026 backfill means anyone
        // already restored nets to zero and is never double-paid.
        await reverseClawback({
          submissionId: updatedSubmission.id,
          clawbackSourceType: "submission_rejection",
          reverseSourceType: "reward_restored_reapproval",
          memo: "Reward restored — clip re-approved after rejection",
          reinstateReward: true,
        });
        // Cancel any still-outstanding rejection reserve — the clip is valid
        // again, so the clipper no longer owes the uncollected remainder.
        await voidOutstandingReserve(
          updatedSubmission.id,
          "submission_rejection"
        );
        // fire and forget
        await db.insert(notifications).values({
          user_id: updatedSubmission.userId,
          title: "Your clip is approved",
          description: "Nice work! Your submission cleared review",
          expires_minutes: 3 * 24 * 60, // 3 days
          metadata: {
            type: "submission-approved",
            alertType: "success",
            submissionUrl: updatedSubmission.url,
          } satisfies NotificationMetadata,
        });
      }

      return updatedSubmission;
    }),

  // Mod approve / reject for a NON-campaign clip (submitted via
  // submitNonCampaignClip, NOT the legacy batch flow). On reject:
  //   1. status → 'rejected', reviewed_by/reviewed_at/rejected_reason stamped
  //   2. credit_remaining zeroed (no future campaign clip can claim from it)
  //   3. EVERY covered campaign clip has its redeemed_by pointer nulled out
  //      → they go back to "unredeemed" and won't pay until the clipper
  //      submits a different non-campaign clip from the same account.
  //   4. (optional) revokeSubmissionReward on each covered clip if they
  //      had already been approved + paid. For pending/rejected ones this
  //      is a no-op.
  // Clipper-facing URL preview. Given a URL the clipper is about to submit,
  // tells the UI what platform/handle was detected, whether it matches one of
  // their verified accounts, and whether it's already been submitted anywhere.
  // Powers the live preview block on the non-campaign submit page so the
  // clipper knows BEFORE hitting submit whether the URL will be accepted
  // and gets a clear "already submitted" hint instead of the misleading
  // "couldn't find your username" API-failure error.
  previewClipUrl: protectedProcedure
    .input(
      z.object({
        url: z.string().min(1),
        campaign_id: z.string().optional(),
      })
    )
    .query(async ({ input, ctx }) => {
      const trimmed = input.url.trim();
      if (!trimmed) {
        return {
          ok: false,
          reason: "empty",
          platform: null,
          videoId: null,
          handle: null,
          matchedVerifiedAccount: null,
          alreadySubmitted: false,
          alreadySubmittedKind: null as null | "campaign" | "non-campaign",
          resubmitOfRejectedNonCampaign: false,
        };
      }

      const { videoId, resolvedUrl } = await extractVideoIdFromUrl(trimmed);
      const platform = await getPlatfromFromUrl(resolvedUrl);

      if (!platform) {
        return {
          ok: false,
          reason: "unknown-platform",
          platform: null,
          videoId,
          handle: null,
          matchedVerifiedAccount: null,
          alreadySubmitted: false,
          alreadySubmittedKind: null,
          resubmitOfRejectedNonCampaign: false,
        };
      }

      // Duplicate check FIRST (before the expensive API-backed handle lookup)
      // so an "already submitted" URL doesn't get a confusing "could not
      // extract username" downstream error.
      // submissions has no video_id column (legacy), so we LIKE-match the
      // URL substring. non_campaign_clips has video_id directly.
      let alreadySubmittedKind: null | "campaign" | "non-campaign" = null;
      let resubmitOfRejectedNonCampaign = false;
      if (videoId) {
        const existingCampaignRows = await db
          .select({
            id: submissions.id,
            user_id: submissions.user_id,
            campaign_id: submissions.campaign_id,
          })
          .from(submissions)
          .where(
            and(
              eq(submissions.platform, platform),
              like(submissions.url, `%${escapeLikePattern(videoId)}%`)
            )
          );
        // Mirror submitNonCampaignClip's one-time Big Boys carve-out —
        // otherwise the page's preview flags the reused Replit link, the
        // submit button greys out, and the mutation's exception is dead code
        // for the very clippers it was written for.
        const excepted =
          existingCampaignRows.length > 0 &&
          Boolean(input.campaign_id) &&
          (await isBigBoysReplitReuse(
            existingCampaignRows,
            input.campaign_id as string,
            ctx.user.id
          ));
        if (existingCampaignRows.length > 0 && !excepted) {
          alreadySubmittedKind = "campaign";
        }
        if (alreadySubmittedKind === null) {
          const [existingNc] = await db
            .select({
              id: non_campaign_clips.id,
              user_id: non_campaign_clips.user_id,
              status: non_campaign_clips.status,
              deleted_at: non_campaign_clips.deleted_at,
            })
            .from(non_campaign_clips)
            .where(
              and(
                eq(non_campaign_clips.platform, platform),
                eq(non_campaign_clips.video_id, videoId)
              )
            )
            .limit(1);
          if (existingNc) {
            // Mirror submitNonCampaignClip: the clipper's OWN rejected
            // (and not platform-deleted) non-campaign clip is resubmittable,
            // so the preview must not grey out the submit button for it.
            const isOwnRejectedResubmit =
              existingNc.status === "rejected" &&
              existingNc.user_id === ctx.user.id &&
              !existingNc.deleted_at;
            if (isOwnRejectedResubmit) {
              resubmitOfRejectedNonCampaign = true;
            } else {
              alreadySubmittedKind = "non-campaign";
            }
          }
        }
      }

      // Now the API-backed handle resolution. May still fail (RapidAPI down,
      // YouTube channel without customUrl), but the preview surfaces that as
      // "handle could not be resolved" rather than confusing the clipper.
      let handle: string | null = null;
      try {
        const detection = await getPlatformAndHandleFromUrl(resolvedUrl);
        handle = detection.handle ?? null;
        if (handle === "(no handle found)") handle = null;
      } catch (_err) {
        handle = null;
      }

      const verifiedRows = await db
        .select({
          id: verified_users.id,
          handle: verified_users.handle,
          platform: verified_users.platform,
        })
        .from(verified_users)
        .where(
          and(
            eq(verified_users.discord_id, ctx.user.id),
            eq(verified_users.verified, true),
            isNull(verified_users.deleted_at),
            eq(verified_users.platform, platform)
          )
        );

      const matched =
        handle !== null
          ? verifiedRows.find(
              (v) => v.handle.toLowerCase() === handle!.toLowerCase()
            )
          : null;

      return {
        ok: true,
        reason: null as null | string,
        platform,
        videoId,
        handle,
        matchedVerifiedAccount: matched
          ? {
              id: matched.id,
              handle: matched.handle,
              platform: matched.platform,
            }
          : null,
        alreadySubmitted: alreadySubmittedKind !== null,
        alreadySubmittedKind,
        resubmitOfRejectedNonCampaign,
      };
    }),

  // Mod-side listing of non-campaign clips awaiting review (or any status).
  // Mirrors the shape of getAdminSubmissions just enough that AdminSubmissions
  // can render NC rows in the same table layout.
  // Stats for non-campaign clips — the NC equivalent of the campaign
  // "View stats" page. Optionally scoped to one campaign. Mirrors
  // campaigns.getCampaignImpact shape so the UI can render the same cards.
  getNonCampaignStats: reviewerRoleProcedure
    .input(
      z
        .object({ campaignId: z.string().optional() })
        .optional()
    )
    .query(async ({ input }) => {
      const campaignId = input?.campaignId;
      const scope = (extra?: any) =>
        campaignId
          ? extra
            ? and(eq(non_campaign_clips.campaign_id, campaignId), extra)
            : eq(non_campaign_clips.campaign_id, campaignId)
          : extra;

      // Totals over APPROVED non-campaign clips (paying / live ones)
      const approvedWhere = scope(eq(non_campaign_clips.status, "approved"));
      const [overall] = await db
        .select({
          views: sql<number>`COALESCE(SUM(${non_campaign_clips.views}), 0)`,
          clips: count(non_campaign_clips.id),
          submitters: sql<number>`COUNT(DISTINCT ${non_campaign_clips.user_id})`,
        })
        .from(non_campaign_clips)
        .where(approvedWhere);

      // By status (review performance)
      const statusRows = await db
        .select({
          status: non_campaign_clips.status,
          clips: count(non_campaign_clips.id),
        })
        .from(non_campaign_clips)
        .where(scope())
        .groupBy(non_campaign_clips.status);

      // By platform (approved)
      const platformRows = await db
        .select({
          platform: non_campaign_clips.platform,
          views: sql<number>`COALESCE(SUM(${non_campaign_clips.views}), 0)`,
          clips: count(non_campaign_clips.id),
        })
        .from(non_campaign_clips)
        .where(approvedWhere)
        .groupBy(non_campaign_clips.platform)
        .orderBy(desc(sql`COALESCE(SUM(${non_campaign_clips.views}), 0)`));

      // Top clippers (approved) — grouped per user, joined to user_clerk for
      // avatar/display name. Mirrors campaigns.getTopClippers so the NC stats
      // dashboard can show the same "by views / by clips" leaderboards.
      const clipperRows = await db
        .select({
          userId: non_campaign_clips.user_id,
          handle: verified_users.handle,
          views: sql<number>`COALESCE(SUM(${non_campaign_clips.views}), 0)`,
          clips: count(non_campaign_clips.id),
          discordUsername: user_clerk.discord_username,
          firstName: user_clerk.first_name,
          avatarUrl: user_clerk.image_url,
        })
        .from(non_campaign_clips)
        .leftJoin(
          verified_users,
          eq(verified_users.id, non_campaign_clips.verified_user_id)
        )
        .leftJoin(
          user_clerk,
          eq(user_clerk.discord_id, non_campaign_clips.user_id)
        )
        .where(approvedWhere)
        .groupBy(
          non_campaign_clips.user_id,
          verified_users.handle,
          user_clerk.discord_username,
          user_clerk.first_name,
          user_clerk.image_url
        );

      const normalizedClippers = clipperRows
        .map((r) => ({
          userId: r.userId ?? "unknown",
          handle: r.handle ?? null,
          viewCount: Number(r.views ?? 0),
          clipCount: Number(r.clips ?? 0),
          discordUsername: r.discordUsername ?? null,
          firstName: r.firstName ?? null,
          avatarUrl: r.avatarUrl ?? null,
        }))
        .filter((r) => r.viewCount > 0 || r.clipCount > 0);

      const byViews = [...normalizedClippers]
        .sort((a, b) => b.viewCount - a.viewCount)
        .slice(0, 10);
      const byClips = [...normalizedClippers]
        .sort((a, b) => b.clipCount - a.clipCount)
        .slice(0, 10);

      // Top individual clips (approved) by views — what Pranav explicitly
      // asked to see in the NC stats.
      const topClipRows = await db
        .select({
          id: non_campaign_clips.id,
          url: non_campaign_clips.url,
          platform: non_campaign_clips.platform,
          views: non_campaign_clips.views,
          handle: verified_users.handle,
          userId: non_campaign_clips.user_id,
          discordUsername: user_clerk.discord_username,
          firstName: user_clerk.first_name,
          avatarUrl: user_clerk.image_url,
        })
        .from(non_campaign_clips)
        .leftJoin(
          verified_users,
          eq(verified_users.id, non_campaign_clips.verified_user_id)
        )
        .leftJoin(
          user_clerk,
          eq(user_clerk.discord_id, non_campaign_clips.user_id)
        )
        .where(approvedWhere)
        .orderBy(desc(non_campaign_clips.views))
        .limit(10);

      // Per-moderator review performance (all statuses). Mirrors
      // campaigns.getReviewPerformance.
      const reviewRows = await db
        .select({
          reviewerId: non_campaign_clips.reviewed_by,
          status: non_campaign_clips.status,
          reviewCount: count(non_campaign_clips.id),
          discordUsername: user_clerk.discord_username,
          firstName: user_clerk.first_name,
          avatarUrl: user_clerk.image_url,
        })
        .from(non_campaign_clips)
        .leftJoin(
          user_clerk,
          eq(user_clerk.discord_id, non_campaign_clips.reviewed_by)
        )
        .where(scope())
        .groupBy(
          non_campaign_clips.reviewed_by,
          non_campaign_clips.status,
          user_clerk.discord_username,
          user_clerk.first_name,
          user_clerk.image_url
        );

      type ReviewerSummary = {
        reviewerId: string;
        discordUsername: string | null;
        firstName: string | null;
        avatarUrl: string | null;
        totalReviewed: number;
        statusBreakdown: Record<string, number>;
      };
      const reviewerMap = new Map<string, ReviewerSummary>();
      for (const row of reviewRows) {
        // A null reviewer means the clip is still pending — exclude it from
        // the moderator leaderboard rather than bucketing under "unknown".
        if (!row.reviewerId) continue;
        const reviewerId = row.reviewerId;
        const statusKey = row.status ?? "unknown";
        const reviewCount = Number(row.reviewCount ?? 0);
        if (!reviewerMap.has(reviewerId)) {
          reviewerMap.set(reviewerId, {
            reviewerId,
            discordUsername: row.discordUsername ?? null,
            firstName: row.firstName ?? null,
            avatarUrl: row.avatarUrl ?? null,
            totalReviewed: 0,
            statusBreakdown: {},
          });
        }
        const summary = reviewerMap.get(reviewerId)!;
        summary.totalReviewed += reviewCount;
        summary.statusBreakdown[statusKey] =
          (summary.statusBreakdown[statusKey] ?? 0) + reviewCount;
      }
      const reviewers = Array.from(reviewerMap.values()).sort(
        (a, b) => b.totalReviewed - a.totalReviewed
      );

      return {
        totals: {
          views: Number(overall?.views ?? 0),
          clips: Number(overall?.clips ?? 0),
          submitters: Number(overall?.submitters ?? 0),
        },
        byStatus: statusRows.map((r) => ({
          status: r.status,
          clips: Number(r.clips ?? 0),
        })),
        platforms: platformRows.map((r) => ({
          platform: r.platform ?? "unknown",
          views: Number(r.views ?? 0),
          clips: Number(r.clips ?? 0),
        })),
        topClippers: { byViews, byClips },
        topClips: topClipRows.map((r) => ({
          id: r.id,
          url: r.url,
          platform: r.platform ?? "unknown",
          views: Number(r.views ?? 0),
          handle: r.handle ?? null,
          userId: r.userId,
          discordUsername: r.discordUsername ?? null,
          firstName: r.firstName ?? null,
          avatarUrl: r.avatarUrl ?? null,
        })),
        reviewers,
      };
    }),

  // NC equivalent of campaigns.getSubmissionSnapshots — drives the NC stats
  // trend chart. Snapshot rows are summed by capture time so this works both
  // per-campaign and globally (all campaigns aggregated at each snapshot run).
  getNonCampaignSnapshots: reviewerRoleProcedure
    .input(
      z
        .object({
          campaignId: z.string().optional(),
          limit: z.number().min(1).max(500).optional(),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const campaignId = input?.campaignId;
      const limit = input?.limit ?? 180;
      const viewScope = campaignId
        ? eq(snapshot_nc_views.campaign_id, campaignId)
        : undefined;
      const countScope = campaignId
        ? eq(snapshot_nc_count.campaign_id, campaignId)
        : undefined;
      const clipScope = campaignId
        ? eq(non_campaign_clips.campaign_id, campaignId)
        : undefined;

      const [viewRows, countRows, allClipCreations] = await Promise.all([
        db
          .select({
            createdAt: snapshot_nc_views.created_at,
            views: sql<number>`COALESCE(SUM(${snapshot_nc_views.views}), 0)`,
          })
          .from(snapshot_nc_views)
          .where(viewScope)
          .groupBy(snapshot_nc_views.created_at)
          .orderBy(desc(snapshot_nc_views.created_at))
          .limit(limit),
        db
          .select({
            createdAt: snapshot_nc_count.created_at,
            clips: sql<number>`COALESCE(SUM(${snapshot_nc_count.clip_count}), 0)`,
          })
          .from(snapshot_nc_count)
          .where(countScope)
          .groupBy(snapshot_nc_count.created_at)
          .orderBy(desc(snapshot_nc_count.created_at))
          .limit(limit),
        // Total NC clips (any status) over time — derived from created_at, no
        // snapshot needed (mirrors the campaign total-submissions line).
        db
          .select({ created_at: non_campaign_clips.created_at })
          .from(non_campaign_clips)
          .where(clipScope),
      ]);

      const toPoint = (
        createdAt: Date | null,
        value: number,
        idx: number
      ) => ({
        id: `nc-${idx}`,
        value,
        capturedAt: createdAt
          ? createdAt.toISOString()
          : new Date().toISOString(),
      });

      const views = viewRows
        .map((r, i) => toPoint(r.createdAt, Number(r.views ?? 0), i))
        .reverse();
      const submissions_ = countRows
        .map((r, i) => toPoint(r.createdAt, Number(r.clips ?? 0), i))
        .reverse();

      const clipCreationTimes = allClipCreations
        .map((row) => (row.created_at ? row.created_at.getTime() : 0))
        .filter((t) => t > 0)
        .sort((a, b) => a - b);
      const countAsOf = (iso: string): number => {
        const ts = new Date(iso).getTime();
        let lo = 0;
        let hi = clipCreationTimes.length;
        while (lo < hi) {
          const mid = (lo + hi) >>> 1;
          const midVal = clipCreationTimes[mid];
          if (midVal !== undefined && midVal <= ts) lo = mid + 1;
          else hi = mid;
        }
        return lo;
      };
      const totalSubmissions = submissions_.map((point, i) => ({
        id: `total-nc-${i}`,
        value: countAsOf(point.capturedAt),
        capturedAt: point.capturedAt,
      }));

      return { views, submissions: submissions_, totalSubmissions };
    }),

  getAdminNonCampaignClips: reviewerRoleProcedure
    .input(
      z
        .object({
          status: z
            .enum(["pending", "approved", "rejected"])
            .optional(),
          campaignId: z.string().optional(),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const statusFilter = input?.status ?? "pending";
      const campaignFilter = input?.campaignId;

      const whereConditions = [
        eq(non_campaign_clips.status, statusFilter),
      ] as any[];
      if (campaignFilter) {
        whereConditions.push(eq(non_campaign_clips.campaign_id, campaignFilter));
      }

      const rows = await db
        .select({
          id: non_campaign_clips.id,
          userId: non_campaign_clips.user_id,
          campaignId: non_campaign_clips.campaign_id,
          verifiedUserId: non_campaign_clips.verified_user_id,
          url: non_campaign_clips.url,
          platform: non_campaign_clips.platform,
          status: non_campaign_clips.status,
          views: non_campaign_clips.views,
          creditRemaining: non_campaign_clips.credit_remaining,
          rejectedReason: non_campaign_clips.rejected_reason,
          createdAt: non_campaign_clips.created_at,
          reviewedAt: non_campaign_clips.reviewed_at,
          campaignTitle: campaigns.title,
          clerkEmail: user_clerk.email,
          clerkFirstName: user_clerk.first_name,
          clerkLastName: user_clerk.last_name,
          clerkImageUrl: user_clerk.image_url,
          verifiedHandle: verified_users.handle,
        })
        .from(non_campaign_clips)
        .leftJoin(campaigns, eq(non_campaign_clips.campaign_id, campaigns.id))
        .leftJoin(
          user_clerk,
          eq(user_clerk.discord_id, non_campaign_clips.user_id)
        )
        .leftJoin(
          verified_users,
          eq(verified_users.id, non_campaign_clips.verified_user_id)
        )
        .where(and(...whereConditions))
        .orderBy(desc(non_campaign_clips.created_at))
        .limit(5000);

      return rows;
    }),

  updateNonCampaignClipStatus: reviewerRoleProcedure
    .input(
      z.object({
        id: z.string(),
        status: z.enum(["approved", "rejected"]),
        rejectedReason: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const [existing] = await db
        .select()
        .from(non_campaign_clips)
        .where(eq(non_campaign_clips.id, input.id))
        .limit(1);
      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Non-campaign clip not found",
        });
      }

      if (
        input.status === "rejected" &&
        (!input.rejectedReason || input.rejectedReason.trim() === "")
      ) {
        throw new Error("Rejection reason is required");
      }

      await db
        .update(non_campaign_clips)
        .set({
          status: input.status,
          reviewed_by: ctx.user.id,
          reviewer_assignment_user_id: null,
          rejected_reason:
            input.status === "rejected"
              ? input.rejectedReason?.trim() ?? null
              : null,
          reviewed_at: new Date(),
        })
        .where(eq(non_campaign_clips.id, input.id));

      let revokedSubmissionIds: string[] = [];
      let recoveredSubmissionIds: string[] = [];
      if (input.status === "rejected") {
        // Un-cover the campaign clips this non-campaign clip was unlocking and
        // claw back their rewards as debt (allowNegative). The memo names this
        // NC reel. The money is added back when a fresh NC clip re-covers them.
        revokedSubmissionIds = await uncoverAndClawbackNonCampaignClip(
          input.id,
          existing.url,
          "rejected"
        );
      } else if (existing.status === "rejected") {
        // Un-reject (rejected -> approved): the reject cascade un-covered
        // this clip's campaign clips, zeroed its credit and clawed back paid
        // rewards. Reverse it exactly the way a fresh non-campaign submission
        // would: re-cover up to N of the clipper's oldest unredeemed campaign
        // clips on the same verified account, restore their clawed-back
        // earnings, and hand the leftover cover slots back as credit.
        // credit_remaining can't be "restored" — the reject cascade zeroes it
        // destructively — so it's recomputed from the campaign ratio.
        const [campaign] = await db
          .select()
          .from(campaigns)
          .where(eq(campaigns.id, existing.campaign_id))
          .limit(1);
        const ratioN = campaign ? getRatio(campaign) : 0;
        const toCover =
          existing.verified_user_id && ratioN > 0
            ? await findUnredeemedToCover(
                existing.user_id,
                existing.campaign_id,
                existing.verified_user_id,
                ratioN
              )
            : [];
        await db
          .update(non_campaign_clips)
          .set({ credit_remaining: Math.max(0, ratioN - toCover.length) })
          .where(eq(non_campaign_clips.id, input.id));
        if (toCover.length > 0) {
          // Same semantics as submitNonCampaignClip: clearing the frozen
          // baseline in the same statement hands the covered clip's payout
          // contribution back to its live views.
          await db
            .update(submissions)
            .set({
              redeemed_by_non_campaign_clip_id: input.id,
              baseline_frozen_views: null,
            })
            .where(
              inArray(
                submissions.id,
                toCover.map((s) => s.id)
              )
            );
          for (const covered of toCover) {
            await reverseClawback({
              submissionId: covered.id,
              clawbackSourceType: "noncampaign_uncovered",
              reverseSourceType: "noncampaign_recovered",
              memo: `Earnings restored — non-campaign clip accepted after rejection: ${existing.url}`,
              reinstateReward: true,
            });
            // Cancel any still-outstanding uncover reserve — this clip is
            // covered and earning again, so the uncollected remainder is void.
            await voidOutstandingReserve(covered.id, "noncampaign_uncovered");
          }
          recoveredSubmissionIds = toCover.map((s) => s.id);
        }
      }

      // Notify the clipper of the review outcome. Reuses the existing
      // submission-approved / submission-rejected notification metadata shapes
      // (same alert styling the in-app bell already renders) — the title +
      // copy make it explicit this is a NON-campaign clip and explain the
      // 24-hour earnings-restoration window the support team communicates.
      const affectedCount = revokedSubmissionIds.length;
      if (input.status === "rejected") {
        await db.insert(notifications).values({
          user_id: existing.user_id,
          title: "Non-campaign clip rejected",
          description:
            affectedCount > 0
              ? `Your non-campaign clip was rejected, so ${affectedCount} of your campaign clip${
                  affectedCount === 1 ? "'s earnings have" : "s' earnings have"
                } been paused. Submit a new non-campaign clip from the same account to restore them.`
              : "Your non-campaign clip was rejected. Submit a new non-campaign clip from the same account to keep your campaign clips eligible for payout.",
          expires_minutes: 7 * 24 * 60, // 7 days
          metadata: {
            type: "submission-rejected",
            alertType: "warning",
            submissionUrl: existing.url,
            rejectionReason: input.rejectedReason?.trim() ?? undefined,
            reviewer: ctx.user.id,
          } satisfies NotificationMetadata,
        });
      } else if (input.status === "approved") {
        await db.insert(notifications).values({
          user_id: existing.user_id,
          title: "Non-campaign clip approved",
          description:
            recoveredSubmissionIds.length > 0
              ? `Your non-campaign clip was accepted after review. ${
                  recoveredSubmissionIds.length
                } of your campaign clip${
                  recoveredSubmissionIds.length === 1 ? "'s" : "s'"
                } paused earnings have been restored.`
              : "Your non-campaign clip cleared review. Any campaign-clip earnings that were paused on this account will be restored within 24 hours.",
          expires_minutes: 7 * 24 * 60, // 7 days
          metadata: {
            type: "submission-approved",
            alertType: "success",
            submissionUrl: existing.url,
          } satisfies NotificationMetadata,
        });
      }

      return {
        id: input.id,
        status: input.status,
        affectedCampaignClipIds: revokedSubmissionIds,
        recoveredCampaignClipIds: recoveredSubmissionIds,
      };
    }),

  // Feature 1 "Restore": undo a deleted-clip flag. Clears the deletion flags
  // (so the clip re-enters the view cron) and reverses the clawback exactly —
  // re-crediting the clipper and reinstating the reward. Gated to rewards
  // moderators since it moves money.
  restoreDeletedSubmission: rewardsModeratorRoleProcedure
    .input(z.object({ submissionId: z.string() }))
    .mutation(async ({ input }) => {
      return restoreDeletedSubmission(input.submissionId);
    }),

  // ────────────────────────────────────────────────────────────────────
  // Clip-type conversion (mod tool). Clippers regularly upload a campaign
  // clip as non-campaign (or vice versa) by mistake; these let a reviewer
  // fix it from the review tables via the row's ⋯ menu. Both insert the
  // clip into the OTHER table as "pending" (so the normal review flow —
  // and all its credit/ledger side-effects — runs properly there) and
  // delete the source row in the same transaction. Money-safety guards
  // block anything that already has earnings or redemption links.
  // ────────────────────────────────────────────────────────────────────
  convertSubmissionToNonCampaign: reviewerRoleProcedure
    .input(z.object({ submissionId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const [sub] = await db
        .select()
        .from(submissions)
        .where(eq(submissions.id, input.submissionId))
        .limit(1);
      if (!sub) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Submission not found" });
      }
      if (sub.deleted_at) {
        throw new Error("This clip is flagged as deleted — restore it first.");
      }
      if (Number(sub.reward ?? 0) > 0) {
        throw new Error(
          "This clip has already earned reward. Reject it first (which claws back the reward), then convert."
        );
      }
      if (sub.baseline_frozen_views !== null) {
        // The snapshot is holding this clip's already-paid views inside the
        // payout baseline; converting would delete the row and rip those
        // views out, freezing the clipper below the paid odometer.
        throw new Error(
          "This clip's paid views are frozen into the payout baseline (its reward was clawed back). Converting it would freeze the clipper's payouts — leave it as a campaign clip."
        );
      }

      const { videoId } = await extractVideoIdFromUrl(sub.url);
      if (!videoId) {
        throw new Error("Could not extract a video ID from this clip's URL.");
      }
      const [ncDup] = await db
        .select({ id: non_campaign_clips.id })
        .from(non_campaign_clips)
        .where(
          and(
            eq(non_campaign_clips.platform, sub.platform),
            eq(non_campaign_clips.video_id, videoId)
          )
        )
        .limit(1);
      if (ncDup) {
        throw new Error("This video already exists as a non-campaign clip.");
      }

      const ncId = `nc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      await db.transaction(async (tx) => {
        await tx.insert(non_campaign_clips).values({
          id: ncId,
          campaign_id: sub.campaign_id,
          user_id: sub.user_id,
          verified_user_id: sub.verified_user_id,
          url: sub.url,
          video_id: videoId,
          platform: sub.platform,
          views: sub.views ?? 0,
          status: "pending", // re-review as NC so credit logic runs properly
          credit_remaining: 0,
          reviewed_by: null,
        });
        await tx.delete(submissions).where(eq(submissions.id, sub.id));
      });

      // If this campaign clip had claimed a redemption credit, return it to
      // the covering non-campaign clip. Done after the transaction commits so
      // a failed conversion never over-credits (matches how the reject path
      // calls returnCredit outside a transaction).
      if (sub.redeemed_by_non_campaign_clip_id) {
        await returnCredit(sub.redeemed_by_non_campaign_clip_id);
      }

      console.log(
        `[convert] campaign->NC by ${ctx.user.id}: submission ${sub.id} -> nc ${ncId}`
      );
      return { newNonCampaignClipId: ncId };
    }),

  convertNonCampaignToCampaign: reviewerRoleProcedure
    .input(z.object({ nonCampaignClipId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const [nc] = await db
        .select()
        .from(non_campaign_clips)
        .where(eq(non_campaign_clips.id, input.nonCampaignClipId))
        .limit(1);
      if (!nc) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Non-campaign clip not found" });
      }
      if (nc.deleted_at) {
        throw new Error("This non-campaign clip is flagged as deleted.");
      }
      // If it already covers campaign clips, converting would orphan their
      // redemption. The mod must resolve those first.
      const [covered] = await db
        .select({ n: count() })
        .from(submissions)
        .where(eq(submissions.redeemed_by_non_campaign_clip_id, nc.id));
      if (Number(covered?.n ?? 0) > 0) {
        throw new Error(
          "This non-campaign clip already covers campaign clips. Reject it instead (which un-covers them), then convert the resubmission."
        );
      }

      const [subDup] = await db
        .select({ id: submissions.id })
        .from(submissions)
        .where(
          and(
            like(submissions.url, `%${nc.video_id}%`),
            eq(submissions.platform, nc.platform)
          )
        )
        .limit(1);
      if (subDup) {
        throw new Error("This video already exists as a campaign clip.");
      }

      const submissionId = `submission_${Date.now()}`;
      await db.transaction(async (tx) => {
        await tx.insert(submissions).values({
          id: submissionId,
          user_id: nc.user_id,
          verified_user_id: nc.verified_user_id,
          campaign_id: nc.campaign_id,
          url: nc.url,
          platform: nc.platform,
          status: "pending", // re-review as a campaign clip
          views: nc.views ?? 0,
          reward: 0,
          active: true,
          redeemed_by_non_campaign_clip_id: null,
        });
        await tx.delete(non_campaign_clips).where(eq(non_campaign_clips.id, nc.id));
      });

      console.log(
        `[convert] NC->campaign by ${ctx.user.id}: nc ${nc.id} -> submission ${submissionId}`
      );
      return { newSubmissionId: submissionId };
    }),
});
