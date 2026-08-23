import { TRPCError } from "@trpc/server";
import {
  and,
  asc,
  count,
  desc,
  eq,
  getTableColumns,
  inArray,
  isNotNull,
  isNull,
  like,
  or,
  sql,
  sum,
} from "drizzle-orm";
import { z } from "zod";
import { submissionOwnerInGoodStanding } from "../lib/banPurge";
import { db } from "../lib/db";
import {
  minViewDisplayFilter,
  minViewDisplayFilterAllCampaigns,
} from "../lib/campaignDisplayRules";
import {
  balance_entries,
  balances,
  banned_users,
  campaign_cpm_group_members,
  campaign_cpm_groups,
  campaign_geo_rules,
  campaign_levels,
  campaign_view_rewards,
  campaigncategories,
  campaigns,
  demographics_verification_v2,
  snapshot_submission_count,
  snapshot_submission_views,
  submissions,
  user_clerk,
  verified_users,
} from "../lib/schema";
import {
  campaignsEditorRoleProcedure,
  protectedProcedure,
  publicProcedure,
  router,
} from "../lib/trpc";
import {
  hashExternalPassword,
  verifyExternalPasswordHash,
} from "../lib/externalPassword";
import {
  countrySchema,
  geoRuleInputSchema,
} from "../lib/zod-schemas/demographic";
import { CampaignYoutubeSlashMetadata } from "../lib/zod-schemas/balanceMetadata";
import { readAudienceCountries, selectBestRule } from "../lib/geo-rules";
import { currentCycleStart } from "../lib/demographic-cycles";
import { parseCampaignPlatforms } from "../lib/campaignPlatforms";
import { settleUserCampaignViewRewards } from "./rewards/createCampaignViewRewards";

// Rate-group mutations only make sense on campaigns that actually pay:
// paused/ended campaigns are skipped by the payout cron, so the mandatory
// settle-at-old-rate step would pay money the system is designed never to
// pay (including an ended campaign's post-end view growth).
const assertLiveCampaignForCpmGroups = async (campaignId: string) => {
  const [campaign] = await db
    .select({
      id: campaigns.id,
      active: campaigns.active,
      ended: campaigns.ended,
    })
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);

  if (!campaign) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Campaign not found" });
  }
  if (!campaign.active || campaign.ended) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "This campaign is paused or ended — reactivate it before changing rate groups",
    });
  }
};

const resolveYoutubeReductionRate = (youtubeShare: number) => {
  if (!Number.isFinite(youtubeShare)) {
    return 0;
  }

  if (youtubeShare >= 0.90) {
    return 0.45;
  }

  return 0;
};

// Shared by getAll (public, teaser-sanitized) and getAllAdmin (full data).
const fetchAllCampaignsWithMetrics = async () => {
  // submissionCount = TOTAL campaign clips + TOTAL non-campaign clips per
  // campaign (any status: pending + approved + rejected, both kinds).
  // The admin /admin/submissions dropdown reads this; per-status counts in
  // the table below stay independent and filter via the status pill.
  // Computed via correlated subqueries so we can keep the existing LEFT
  // JOIN on approved submissions for submissionRewards without double-
  // counting.
  const campaignsData = await db
      .select({
        ...getTableColumns(campaigns),
        submissionCount: sql<number>`(
          (SELECT COUNT(*) FROM submissions
            WHERE submissions.campaign_id = ${campaigns.id})
          +
          (SELECT COUNT(*) FROM non_campaign_clips
            WHERE non_campaign_clips.campaign_id = ${campaigns.id})
        )`,
        submissionRewards: sum(submissions.reward),
        // Manual adjustments flagged "counts toward campaign" (sign kept) —
        // same money the finalize cron folds into campaigns.achieved.
        manualAdjustments: sql<number>`(
          SELECT COALESCE(SUM(amount), 0) FROM balance_entries
           WHERE balance_entries.campaign_id = ${campaigns.id}
             AND balance_entries.type = 'manual_adjustment'
             AND balance_entries.counts_toward_campaign = 1
        )`,
      })
      .from(campaigns)
      // submissionOwnerInGoodStanding keeps this DERIVED progress in step with
      // the STORED campaigns.achieved / campaigns.views, which the crons now
      // compute with the same ban filter. Without it the same card showed
      // ban-filtered views next to an unfiltered "achieved %", so banning a
      // clipper dropped the view count while the percentage never moved.
      .leftJoin(submissions, and(eq(submissions.campaign_id, campaigns.id), eq(submissions.status, "approved"), isNull(submissions.deleted_at), submissionOwnerInGoodStanding, minViewDisplayFilterAllCampaigns()))
      // Hide soft-deleted campaign cards from all listings. The campaign and
      // its data are untouched — only the card is hidden until recovered.
      .where(isNull(campaigns.card_deleted_at))
      .groupBy(campaigns.id)
      .orderBy(desc(campaigns.created_at));

  const campaignIds = campaignsData.map((campaign) => campaign.id);
  let levelsByCampaign = new Map<
    string,
    (typeof campaign_levels.$inferSelect)[]
  >();

  if (campaignIds.length > 0) {
    const levels = await db
      .select()
      .from(campaign_levels)
      .where(inArray(campaign_levels.campaign_id, campaignIds))
      .orderBy(asc(campaign_levels.level_threshold));

    levelsByCampaign = levels.reduce((acc, level) => {
      const list = acc.get(level.campaign_id) ?? [];
      list.push(level);
      acc.set(level.campaign_id, list);
      return acc;
    }, new Map<string, (typeof campaign_levels.$inferSelect)[]>());
  }

  return campaignsData.map((campaign) => {
    const totalRewards =
      (Number(campaign.submissionRewards) || 0) +
      (Number(campaign.manualAdjustments) || 0);
    return {
      ...campaign,
      achievementPercentage: (Number(totalRewards) / campaign.budget) * 100,
      levels: levelsByCampaign.get(campaign.id) ?? [],
    };
  });
};

type CampaignWithMetrics = Awaited<
  ReturnType<typeof fetchAllCampaignsWithMetrics>
>[number];

// getAll is public, so the private-campaign teaser strip happens here for
// everyone. Approved clippers get the hidden values back through
// privateCampaigns.getApplicationState; admin panels use getAllAdmin.
const sanitizePrivateCampaign = (
  campaign: CampaignWithMetrics
): CampaignWithMetrics => {
  // The password hash is only ever checked server-side
  // (verifyExternalPassword) — never send it, public campaigns included.
  const sanitized = { ...campaign, external_password: null };
  if (campaign.visibility !== "private") return sanitized;
  // Internal tracking + the client's Discord deanonymize the campaign the
  // teaser is hiding; no clipper-facing consumer reads them. channel_id is
  // the per-campaign channel — its name reveals the real client.
  sanitized.private_discord_guild_id = null;
  sanitized.sheet_id = null;
  sanitized.excel_link = null;
  sanitized.channel_id = ""; // notNull column — empty, not null
  // Teaser identity: unapproved clippers see the cover name/image (e.g.
  // "Secret Campaign #1") instead of the real ones. Approved clippers get
  // the real identity via privateCampaigns.getApplicationState.
  if (campaign.private_teaser_title) {
    sanitized.title = campaign.private_teaser_title;
  }
  if (campaign.private_teaser_image_url) {
    sanitized.imageUrl = campaign.private_teaser_image_url;
  }
  if (!campaign.private_show_budget) {
    sanitized.budget = 0;
    sanitized.external_budget = 0;
    sanitized.submissionRewards = null;
    sanitized.achievementPercentage = 0;
    // Cron-maintained real payout total — with raw views it reconstructs
    // the real CPM, so it hides with the budget.
    sanitized.achieved = 0;
  }
  if (!campaign.private_show_rates) {
    sanitized.cpm = 0;
    sanitized.insta_per_1000 = 0;
    sanitized.x_per_1000 = 0;
    sanitized.youtube_per_1000 = 0;
    sanitized.tiktok_per_1000 = 0;
    sanitized.max_payout = null;
    sanitized.is_hot_streak_enabled = false;
    sanitized.levels = [];
    // View requirements have their own toggle: a campaign can hide its CPM
    // rates but still tell applicants how many views are needed.
    if (!campaign.private_show_min_views) {
      sanitized.min_payout = 0;
      sanitized.youtube_min_views = 0;
      sanitized.insta_min_views = 0;
      sanitized.x_min_views = 0;
      sanitized.tiktok_min_views = 0;
    }
  }
  // Teaser details: when set, unapproved clippers see the teaser text instead
  // of the real description (which stays hidden regardless of the toggle).
  if (campaign.private_teaser_description) {
    sanitized.description = campaign.private_teaser_description;
    sanitized.clips = null;
  } else if (!campaign.private_show_description) {
    sanitized.description = null;
    sanitized.clips = null;
  }
  // The SOP is the client's playbook — locked for private campaigns no
  // matter what the description toggle says. Approved clippers get it via
  // privateCampaigns.getApplicationState (unlocked).
  sanitized.sopEmbedUrl = null;
  return sanitized;
};

const campaignByIdInput = z.object({
  id: z.string(),
  category: z.string().optional(),
});

// Shared by getById (public, teaser-stripped) and getByIdAdmin (full row).
const fetchCampaignByIdWithMetrics = async (input: {
  id: string;
  category?: string;
}) => {
  const campaignData = await db
    .select({
      ...getTableColumns(campaigns),
      submissionCount: count(submissions.id),
      submissionRewards: sum(submissions.reward),
      submissionViews: sum(submissions.views),
      manualAdjustments: sql<number>`(
        SELECT COALESCE(SUM(amount), 0) FROM balance_entries
         WHERE balance_entries.campaign_id = ${campaigns.id}
           AND balance_entries.type = 'manual_adjustment'
           AND balance_entries.counts_toward_campaign = 1
      )`,
    })
    .from(campaigns)
    .leftJoin(
      submissions,
      input.category
        ? and(
          eq(submissions.campaign_id, campaigns.id),
          eq(submissions.status, "approved"),
          eq(submissions.category, input.category),
          // Deleted clips drop out of campaign progress + delivered views.
          isNull(submissions.deleted_at),
          // Banned clippers too — matches the stored achieved/views.
          submissionOwnerInGoodStanding,
          // Campaigns with a display threshold count only qualifying clips.
          minViewDisplayFilter(input.id)
        )
        : and(
          eq(submissions.campaign_id, campaigns.id),
          eq(submissions.status, "approved"),
          isNull(submissions.deleted_at),
          submissionOwnerInGoodStanding,
          minViewDisplayFilter(input.id)
        )
    )
    .where(eq(campaigns.id, input.id))
    .limit(1);

  const campaign = campaignData[0];
  if (!campaign) {
    throw new Error("Campaign not found");
  }
  return campaign;
};

type CampaignByIdRow = Awaited<ReturnType<typeof fetchCampaignByIdWithMetrics>>;

// getById is public, so private-campaign hidden values are stripped here —
// BEFORE the derived math below, so nothing leaks through totals/ratios.
// Approved clippers get the real values back through
// privateCampaigns.getApplicationState; admin pages use getByIdAdmin.
const stripPrivateCampaignRow = (campaign: CampaignByIdRow): CampaignByIdRow => {
  // The password hash is only ever checked server-side
  // (verifyExternalPassword) — no public consumer reads it, so never send it.
  const stripped: CampaignByIdRow = { ...campaign, external_password: null };
  if (campaign.visibility !== "private") return stripped;
  stripped.private_discord_guild_id = null;
  stripped.sheet_id = null;
  stripped.excel_link = null;
  stripped.channel_id = ""; // notNull column — empty, not null
  if (campaign.private_teaser_title) {
    stripped.title = campaign.private_teaser_title;
  }
  if (campaign.private_teaser_image_url) {
    stripped.imageUrl = campaign.private_teaser_image_url;
  }
  if (!campaign.private_show_budget) {
    stripped.budget = 0;
    stripped.external_budget = 0;
    stripped.submissionRewards = null;
    // Cron-maintained real payout total — with raw views it reconstructs
    // the real CPM, so it hides with the budget.
    stripped.achieved = 0;
  }
  if (!campaign.private_show_rates) {
    stripped.cpm = 0;
    stripped.insta_per_1000 = 0;
    stripped.x_per_1000 = 0;
    stripped.youtube_per_1000 = 0;
    stripped.tiktok_per_1000 = 0;
    stripped.max_payout = null;
    stripped.is_hot_streak_enabled = false;
    // View requirements have their own toggle (see sanitizePrivateCampaign).
    if (!campaign.private_show_min_views) {
      stripped.min_payout = 0;
      stripped.youtube_min_views = 0;
      stripped.insta_min_views = 0;
      stripped.x_min_views = 0;
      stripped.tiktok_min_views = 0;
    }
  }
  // Teaser details replace the real description for unapproved clippers.
  if (campaign.private_teaser_description) {
    stripped.description = campaign.private_teaser_description;
    stripped.clips = null;
  } else if (!campaign.private_show_description) {
    stripped.description = null;
    stripped.clips = null;
  }
  // The SOP is the client's playbook — locked for private campaigns no
  // matter what the description toggle says. Approved clippers get it via
  // privateCampaigns.getApplicationState (unlocked).
  stripped.sopEmbedUrl = null;
  return stripped;
};

const buildCampaignByIdResponse = (campaign: CampaignByIdRow) => {
  // // Use category-specific values if available, otherwise use campaign defaults
  const externalBudget = campaign.external_budget ?? 0;
  const cpm = campaign.cpm ?? 0;
  const deliveredViews = Number(campaign.submissionViews) ?? 0;
  const totalRewards = Number(campaign.submissionRewards) ?? 0;

  // Calculate promised views using inputted CPM
  const promisedViews = cpm > 0 ? externalBudget / (cpm / 1000) : 0;

  // // Calculate monetary progress using simple CPM calculation
  const monetaryProgress =
    Math.round(Number(deliveredViews) * (Number(cpm) / 1000) * 10) / 10;

  // // Calculate progress percentage: (value delivered) / external budget (can exceed 100%)
  // Guarded: a hidden (stripped) or unset budget is 0, not Infinity%.
  const progressPercentage =
    campaign.budget > 0 ? (totalRewards / campaign.budget) * 100 : 0;

  return {
    campaign: {
      ...campaign,
      insta_per_1000: campaign.insta_per_1000,
      tiktok_per_1000: campaign.tiktok_per_1000,
      youtube_per_1000: campaign.youtube_per_1000,
      x_per_1000: campaign.x_per_1000,
    },
    totalBounty: externalBudget,
    promisedViews,
    deliveredViews,
    externalCPM: cpm,
    progressPercentage,
    monetaryProgress,
    submissionsCount: campaign.submissionCount,
  };
};

export const campaignsRouter = router({
  // Get all campaigns with metrics (private campaigns teaser-sanitized)
  getAll: publicProcedure.query(async () => {
    const allCampaigns = await fetchAllCampaignsWithMetrics();
    return allCampaigns.map(sanitizePrivateCampaign);
  }),

  // Unsanitized listing for the admin campaigns panel.
  getAllAdmin: campaignsEditorRoleProcedure.query(() =>
    fetchAllCampaignsWithMetrics()
  ),

  // Get campaign by ID (public — private campaigns teaser-stripped)
  getById: publicProcedure
    .input(campaignByIdInput)
    .query(async ({ input }) => {
      const campaign = await fetchCampaignByIdWithMetrics(input);
      return buildCampaignByIdResponse(stripPrivateCampaignRow(campaign));
    }),

  // Full row for the admin editor/stats pages. The public getById is
  // teaser-stripped, which would feed cover values into the edit form and
  // let a save overwrite the real ones.
  getByIdAdmin: campaignsEditorRoleProcedure
    .input(campaignByIdInput)
    .query(async ({ input }) => {
      const campaign = await fetchCampaignByIdWithMetrics(input);
      return buildCampaignByIdResponse(campaign);
    }),

  // Full row for the password-protected client dashboard. The client holds no
  // role, so getByIdAdmin is closed to them and the public getById is
  // teaser-stripped — which zeroed out Total Bounty, Views Promised, Value
  // Delivered and the progress bar on their OWN private campaign. The password
  // is re-verified server-side on every call (the unlock flag lives in React
  // state, so it can never be the thing that authorizes real numbers). A
  // missing/incorrect password falls back to the stripped row rather than
  // throwing, so the dashboard degrades to the teaser instead of erroring.
  getByIdUnlocked: publicProcedure
    .input(
      campaignByIdInput.extend({
        password: z.string().min(1).optional(),
      })
    )
    .query(async ({ input }) => {
      const { password, ...byId } = input;
      const campaign = await fetchCampaignByIdWithMetrics(byId);

      let unlocked = false;
      if (password && campaign.external_password) {
        unlocked = verifyExternalPasswordHash(
          campaign.external_password,
          password
        );
      }

      return buildCampaignByIdResponse(
        unlocked ? campaign : stripPrivateCampaignRow(campaign)
      );
    }),

  getByIdPublic: publicProcedure
    .input(
      z.object({
        id: z.string(),
      })
    )
    .query(async ({ input }) => {
      const campaignData = await db
        .select({
          id: campaigns.id,
          title: campaigns.title,
          clips: campaigns.clips,
          budget: campaigns.budget,
          imageUrl: campaigns.imageUrl,
          sopEmbedUrl: campaigns.sopEmbedUrl,
          description: campaigns.description,
          platforms: campaigns.platforms,
          allowedVerificationMethods: campaigns.allowed_verification_methods,
          demographicsVisibleCountries: campaigns.demographicsVisibleCountries,
          nonCampaignClipsRequired: campaigns.non_campaign_clips_required,
          nonCampaignClipsPer: campaigns.non_campaign_clips_per,
          submissionsPaused: campaigns.submissions_paused,
          visibility: campaigns.visibility,
          private_show_budget: campaigns.private_show_budget,
          private_show_description: campaigns.private_show_description,
          private_teaser_title: campaigns.private_teaser_title,
          private_teaser_image_url: campaigns.private_teaser_image_url,
          private_teaser_description: campaigns.private_teaser_description,
        })
        .from(campaigns)
        .where(eq(campaigns.id, input.id))
        .limit(1);

      if (campaignData.length === 0 || !campaignData[0]) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Campaign not found",
        });
      }

      const campaign = campaignData[0];
      // Same teaser strip as getAll — this endpoint is public too.
      if (campaign.visibility === "private") {
        if (!campaign.private_show_budget) campaign.budget = 0;
        // Teaser details REPLACE the real description regardless of the
        // show-description toggle — same rule as sanitizePrivateCampaign /
        // stripPrivateCampaignRow, or this public endpoint would leak the
        // real client behind the teaser.
        if (campaign.private_teaser_description) {
          campaign.description = campaign.private_teaser_description;
          campaign.clips = null;
        } else if (!campaign.private_show_description) {
          campaign.description = null;
          campaign.clips = null;
        }
        // The SOP is the client's playbook — locked for private campaigns
        // no matter what the description toggle says. Approved clippers get
        // it via privateCampaigns.getApplicationState (unlocked).
        campaign.sopEmbedUrl = null;
        if (campaign.private_teaser_title) {
          campaign.title = campaign.private_teaser_title;
        }
        if (campaign.private_teaser_image_url) {
          campaign.imageUrl = campaign.private_teaser_image_url;
        }
      }
      return {
        ...campaign,
        allowedPlatforms: parseCampaignPlatforms(campaign.platforms),
      };
    }),

  // Get campaign categories
  getCampaignCategories: publicProcedure
    .input(
      z.object({
        campaignId: z.string(),
      })
    )
    .query(async ({ input }) => {
      const campaignCategoriesData = await db
        .select()
        .from(campaigncategories)
        .where(eq(campaigncategories.campaign_id, input.campaignId))
        .orderBy(campaigncategories.category);

      // Public endpoint: per-category rates/budgets bypass the private-
      // campaign teaser strip on getAll/getById unless hidden here too.
      const [parentCampaign] = await db
        .select({
          visibility: campaigns.visibility,
          private_show_budget: campaigns.private_show_budget,
          private_show_rates: campaigns.private_show_rates,
        })
        .from(campaigns)
        .where(eq(campaigns.id, input.campaignId))
        .limit(1);
      const isPrivate = parentCampaign?.visibility === "private";

      const processedData = campaignCategoriesData.map((cat) => ({
        id: cat.id,
        campaign_id: cat.campaign_id,
        category: cat.category,
        platform: cat.platform,
        rate_per_1000:
          isPrivate && !parentCampaign.private_show_rates
            ? 0
            : cat.rate_per_1000,
        budget:
          isPrivate && !parentCampaign.private_show_budget ? 0 : cat.budget,
        category_specific_max_payout:
          isPrivate && !parentCampaign.private_show_rates
            ? null
            : cat.category_specific_max_payout,
        guild_id: isPrivate ? null : cat.guild_id,
      }));

      // Deduplicate by category name, keeping the first occurrence
      const uniqueCategories = new Map();
      processedData.forEach((cat) => {
        if (!uniqueCategories.has(cat.category)) {
          uniqueCategories.set(cat.category, cat);
        }
      });

      const result = Array.from(uniqueCategories.values());

      return result;
    }),

  getReviewPerformance: campaignsEditorRoleProcedure
    .input(
      z.object({
        campaignId: z.string(),
      })
    )
    .query(async ({ input }) => {
      type ReviewerSummary = {
        reviewerId: string;
        discordUsername: string | null;
        firstName: string | null;
        avatarUrl: string | null;
        totalReviewed: number;
        statusBreakdown: Record<string, number>;
      };

      const reviewRows = await db
        .select({
          reviewerId: submissions.reviewed_by,
          status: submissions.status,
          reviewCount: sql<number>`COUNT(${submissions.id})`,
          discordUsername: user_clerk.discord_username,
          avatarUrl: user_clerk.image_url,
          firstName: user_clerk.first_name,
        })
        .from(submissions)
        .leftJoin(
          user_clerk,
          eq(user_clerk.discord_id, submissions.reviewed_by)
        )
        .where(eq(submissions.campaign_id, input.campaignId))
        .groupBy(
          submissions.reviewed_by,
          submissions.status,
          user_clerk.discord_username,
          user_clerk.image_url,
          user_clerk.first_name
        );

      const reviewerMap = new Map<string, ReviewerSummary>();

      for (const row of reviewRows) {
        const reviewerId = row.reviewerId ?? "unknown";
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

      return Array.from(reviewerMap.values()).sort(
        (a, b) => b.totalReviewed - a.totalReviewed
      );
    }),

  getCampaignImpact: campaignsEditorRoleProcedure
    .input(
      z.object({
        campaignId: z.string(),
      })
    )
    .query(async ({ input }) => {
      const baseWhere = and(
        eq(submissions.campaign_id, input.campaignId),
        eq(submissions.status, "approved"),
        // Deleted clips excluded from impact totals + per-platform breakdown.
        isNull(submissions.deleted_at),
        // Campaigns with a display threshold count only qualifying clips.
        minViewDisplayFilter(input.campaignId)
      );

      const [overallRow] = await db
        .select({
          views: sql<number>`COALESCE(SUM(${submissions.views}), 0)`,
          clips: count(submissions.id),
          clippers: sql<number>`COUNT(DISTINCT ${submissions.user_id})`,
        })
        .from(submissions)
        .where(baseWhere);

      const platformRows = await db
        .select({
          platform: submissions.platform,
          views: sql<number>`COALESCE(SUM(${submissions.views}), 0)`,
          clips: count(submissions.id),
          clippers: sql<number>`COUNT(DISTINCT ${submissions.user_id})`,
        })
        .from(submissions)
        .where(baseWhere)
        .groupBy(submissions.platform)
        .orderBy(desc(sql`COALESCE(SUM(${submissions.views}), 0)`));

      return {
        totals: {
          views: Number(overallRow?.views ?? 0),
          clips: Number(overallRow?.clips ?? 0),
          clippers: Number(overallRow?.clippers ?? 0),
        },
        platforms: platformRows.map((row) => ({
          platform: row.platform ?? "unknown",
          views: Number(row.views ?? 0),
          clips: Number(row.clips ?? 0),
          clippers: Number(row.clippers ?? 0),
        })),
      };
    }),

  getTopClippers: campaignsEditorRoleProcedure
    .input(
      z.object({
        campaignId: z.string(),
        limit: z.number().min(1).max(50).optional(),
      })
    )
    .query(async ({ input }) => {
      const limit = input.limit ?? 10;

      const clipperRows = await db
        .select({
          userId: submissions.user_id,
          viewCount: sql<number>`COALESCE(SUM(${submissions.views}), 0)`,
          clipCount: count(submissions.id),
          discordUsername: user_clerk.discord_username,
          firstName: user_clerk.first_name,
          avatarUrl: user_clerk.image_url,
        })
        .from(submissions)
        .leftJoin(user_clerk, eq(user_clerk.discord_id, submissions.user_id))
        .where(
          and(
            eq(submissions.campaign_id, input.campaignId),
            eq(submissions.status, "approved"),
            // Deleted clips excluded from the top-clippers leaderboard.
            isNull(submissions.deleted_at),
            // Campaigns with a display threshold count only qualifying clips.
            minViewDisplayFilter(input.campaignId)
          )
        )
        .groupBy(
          submissions.user_id,
          user_clerk.discord_username,
          user_clerk.first_name,
          user_clerk.image_url
        );

      const normalized = clipperRows
        .map((row) => ({
          userId: row.userId ?? "unknown",
          viewCount: Number(row.viewCount ?? 0),
          clipCount: Number(row.clipCount ?? 0),
          discordUsername: row.discordUsername ?? null,
          firstName: row.firstName ?? null,
          avatarUrl: row.avatarUrl ?? null,
        }))
        .filter((row) => row.viewCount > 0 || row.clipCount > 0);

      const byViews = [...normalized]
        .sort((a, b) => b.viewCount - a.viewCount)
        .slice(0, limit);

      const byClips = [...normalized]
        .sort((a, b) => b.clipCount - a.clipCount)
        .slice(0, limit);

      return { byViews, byClips };
    }),

  getSubmissionSnapshots: publicProcedure
    .input(
      z.object({
        campaignId: z.string(),
        limit: z.number().min(1).max(500).optional(),
      })
    )
    .query(async ({ input }) => {
      const limit = input.limit ?? 90;

      const [viewRows, submissionRows, allSubmissionCreations] = await Promise.all([
        db
          .select({
            id: snapshot_submission_views.id,
            campaignId: snapshot_submission_views.campaign_id,
            views: snapshot_submission_views.views,
            createdAt: snapshot_submission_views.created_at,
          })
          .from(snapshot_submission_views)
          .where(eq(snapshot_submission_views.campaign_id, input.campaignId))
          .orderBy(desc(snapshot_submission_views.created_at))
          .limit(limit),
        db
          .select({
            id: snapshot_submission_count.id,
            campaignId: snapshot_submission_count.campaign_id,
            submissions: snapshot_submission_count.submission_count,
            createdAt: snapshot_submission_count.created_at,
          })
          .from(snapshot_submission_count)
          .where(eq(snapshot_submission_count.campaign_id, input.campaignId))
          .orderBy(desc(snapshot_submission_count.created_at))
          .limit(limit),
        // For the "total submissions" series we don't snapshot. Instead pull
        // every submission's created_at on this campaign once, then bucket
        // cumulatively against each snapshot timestamp below. Pending +
        // rejected included. Gives historical accuracy without a migration.
        db
          .select({ created_at: submissions.created_at })
          .from(submissions)
          .where(eq(submissions.campaign_id, input.campaignId)),
      ]);

      const normalize = <
        T extends { id: string; campaignId: string; createdAt: Date | null }
      >(
        rows: T[],
        getValue: (row: T) => number
      ) =>
        rows
          .map((row) => ({
            id: row.id,
            campaignId: row.campaignId,
            value: getValue(row),
            capturedAt: row.createdAt
              ? row.createdAt.toISOString()
              : new Date().toISOString(),
          }))
          .reverse();

      // Sort the submission creation times once, then for each snapshot point
      // do an O(log n) upper-bound to get the cumulative count of all
      // submissions (any status) that existed at that moment.
      const submissionCreationTimes = allSubmissionCreations
        .map((row) => (row.created_at ? row.created_at.getTime() : 0))
        .filter((t) => t > 0)
        .sort((a, b) => a - b);
      const countAsOf = (iso: string): number => {
        const ts = new Date(iso).getTime();
        let lo = 0;
        let hi = submissionCreationTimes.length;
        while (lo < hi) {
          const mid = (lo + hi) >>> 1;
          // mid is always in-bounds, but noUncheckedIndexedAccess types the
          // element as number|undefined — read into a local + guard so the
          // strict deploy build (tsc) compiles.
          const midVal = submissionCreationTimes[mid];
          if (midVal !== undefined && midVal <= ts) lo = mid + 1;
          else hi = mid;
        }
        return lo;
      };

      const submissions_ = normalize(submissionRows, (row) =>
        Number(row.submissions ?? 0)
      );

      const totalSubmissions = submissions_.map((point) => ({
        id: `total-${point.id}`,
        campaignId: point.campaignId,
        value: countAsOf(point.capturedAt),
        capturedAt: point.capturedAt,
      }));

      return {
        views: normalize(viewRows, (row) => Number(row.views ?? 0)),
        submissions: submissions_,
        totalSubmissions,
      };
    }),

  // Example authenticated route - create a campaign (admin only)
  createCampaign: campaignsEditorRoleProcedure
    .input(
      z.object({
        title: z.string(),
        budget: z.number().default(0),
        description: z.string().optional(),
        // null/0 = disabled. >0 = clipper must submit N non-campaign clip
        // URLs per campaign clip. See submissions router for enforcement.
        nonCampaignClipsRequired: z
          .number()
          .int()
          .min(0)
          .max(10)
          .nullable()
          .optional(),
      })
    )
    .mutation(async ({ input }) => {
      // Create the campaign
      const campaignId = `campaign_${Date.now()}`;
      await db.insert(campaigns).values({
        id: campaignId,
        title: input.title,
        budget: input.budget,
        external_budget: 0,
        allowed_verification_methods: ["OTP", "login-flow", "manual"],
        cpm: 0,
        clips: input.description || "",
        guild_id: "default_guild",
        channel_id: "default_channel",
        active: false,
        ended: true,
        achieved: 0,
        views: 0,
        max_payout: 0,
        min_payout: 0,
        insta_per_1000: 0,
        x_per_1000: 0,
        youtube_per_1000: 0,
        tiktok_per_1000: 0,
        referalPercentage: 5,
        maxReferalBonus: 50,
        platforms: "",
        verify_demography: "No",
        demographicsVisibleCountries: null,
        demographicsVerificationEnabled: false,
        non_campaign_clips_required:
          input.nonCampaignClipsRequired && input.nonCampaignClipsRequired > 0
            ? input.nonCampaignClipsRequired
            : null,
      });

      return {
        id: campaignId,
      };
    }),

  // Update campaign (admin only)
  updateCampaign: campaignsEditorRoleProcedure
    .input(
      z.object({
        id: z.string(),
        title: z.string().optional(),
        clips: z.string().optional(),
        budget: z.number().optional(),
        external_budget: z.number().optional(),
        cpm: z.number().optional(),
        max_payout: z.number().optional(),
        min_payout: z.number().optional(),
        active: z.boolean().optional(),
        ended: z.boolean().optional(),
        submissionsPaused: z.boolean().optional(),
        insta_per_1000: z.number().optional(),
        x_per_1000: z.number().optional(),
        youtube_per_1000: z.number().optional(),
        tiktok_per_1000: z.number().optional(),
        // Per-clip reward floors (views): a clip below the floor counts as 0
        // views (earns nothing) until it crosses it. 0 = no floor.
        youtube_min_views: z.number().int().min(0).optional(),
        insta_min_views: z.number().int().min(0).optional(),
        x_min_views: z.number().int().min(0).optional(),
        tiktok_min_views: z.number().int().min(0).optional(),
        imageUrl: z.string().optional(),
        sopEmbedUrl: z.string().optional(),
        description: z.string().optional(),
        platforms: z.string().optional(),
        verify_demography: z.string().optional(),
        excel_link: z.string().optional(),
        sheet_id: z.string().optional(),
        referalPercentage: z.number().optional(),
        maxReferalBonus: z.number().optional(),
        externalPassword: z.string().optional(),
        demographicsVerificationEnabled: z.boolean().optional(),
        demographicsVisibleCountries: z.array(countrySchema).optional(),
        // Screen-recording window (days) clippers must show when verifying
        // demographics: 7, 28, or 90 (the buckets every platform offers).
        // null clears it (no specific window). Flows through updateData below.
        demographics_recording_period_days: z
          .union([z.literal(7), z.literal(28), z.literal(90)])
          .nullable()
          .optional(),
        // Combined views (across all of a clipper's accounts on this campaign)
        // required before they are asked for, or allowed to submit,
        // demographics. 0 = no threshold.
        demographics_min_views: z.number().int().min(0).optional(),
        is_hot_streak_enabled: z.boolean().optional(),
        // Pass 0 or null to disable the requirement.
        nonCampaignClipsRequired: z
          .number()
          .int()
          .min(0)
          .max(10)
          .nullable()
          .optional(),
        // Ratio denominator: require `nonCampaignClipsRequired` non-campaign
        // clips per this many campaign clips. Defaults to 1.
        nonCampaignClipsPer: z.number().int().min(1).max(10).optional(),
        // Feature 4: the date this campaign is considered over. After it, the
        // ended-campaigns cron watches this campaign's reels for deletion for
        // 3 months. ISO date string, or null to clear.
        endDate: z.string().nullable().optional(),
        // Weekly clipper-activity tracking. Off = campaign exempt from the
        // Clipper Activity panel and inactivity suspensions.
        clipperActivityEnabled: z.boolean().optional(),
        // ── Private campaigns ──
        visibility: z.enum(["public", "private"]).optional(),
        privateShowBudget: z.boolean().optional(),
        privateShowRates: z.boolean().optional(),
        privateShowDescription: z.boolean().optional(),
        // Cover name/image shown before approval; null to show the real ones.
        privateTeaserTitle: z.string().trim().max(255).nullable().optional(),
        privateTeaserImageUrl: z.string().trim().nullable().optional(),
        // Teaser details shown before approval; null to fall back to the
        // show-description toggle.
        privateTeaserDescription: z.string().trim().nullable().optional(),
        // Show view requirements (min total + per-clip floors) on the locked
        // teaser even when rates are hidden.
        privateShowMinViews: z.boolean().optional(),
        // Payment methods shown on the card (display only).
        payment_methods: z
          .array(z.enum(["bank", "crypto", "paypal"]))
          .optional(),
        // Discord server ID for approved clippers; null to clear.
        privateDiscordGuildId: z.string().trim().nullable().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const {
        id,
        externalPassword,
        demographicsVisibleCountries,
        nonCampaignClipsRequired,
        nonCampaignClipsPer,
        submissionsPaused,
        endDate,
        clipperActivityEnabled,
        visibility,
        privateShowBudget,
        privateShowRates,
        privateShowDescription,
        privateShowMinViews,
        privateTeaserTitle,
        privateTeaserImageUrl,
        privateTeaserDescription,
        privateDiscordGuildId,
        payment_methods,
        ...updateData
      } = input;

      // Check if campaign exists
      const existingCampaign = await db
        .select()
        .from(campaigns)
        .where(eq(campaigns.id, id))
        .limit(1);

      if (existingCampaign.length === 0) {
        throw new Error("Campaign not found");
      }

      // Update the campaign
      const updatePayload: Partial<typeof campaigns.$inferInsert> = {
        ...updateData,
        updated_at: new Date(),
      };

      if (submissionsPaused !== undefined) {
        updatePayload.submissions_paused = submissionsPaused;
      }

      if (demographicsVisibleCountries !== undefined) {
        const uniqueCountries = Array.from(
          new Set(demographicsVisibleCountries)
        );
        updatePayload.demographicsVisibleCountries = uniqueCountries.length
          ? uniqueCountries
          : null;
      }

      if (externalPassword !== undefined) {
        const trimmedPassword = externalPassword.trim();
        updatePayload.external_password = trimmedPassword
          ? hashExternalPassword(trimmedPassword)
          : null;
      }

      if (nonCampaignClipsRequired !== undefined) {
        updatePayload.non_campaign_clips_required =
          nonCampaignClipsRequired && nonCampaignClipsRequired > 0
            ? nonCampaignClipsRequired
            : null;
      }

      if (nonCampaignClipsPer !== undefined) {
        updatePayload.non_campaign_clips_per =
          nonCampaignClipsPer && nonCampaignClipsPer > 0
            ? nonCampaignClipsPer
            : 1;
      }

      if (endDate !== undefined) {
        updatePayload.end_date = endDate ? new Date(endDate) : null;
      }

      if (clipperActivityEnabled !== undefined) {
        updatePayload.clipper_activity_enabled = clipperActivityEnabled;
      }
      if (visibility !== undefined) {
        updatePayload.visibility = visibility;
      }
      if (privateShowBudget !== undefined) {
        updatePayload.private_show_budget = privateShowBudget;
      }
      if (privateShowRates !== undefined) {
        updatePayload.private_show_rates = privateShowRates;
      }
      if (privateShowDescription !== undefined) {
        updatePayload.private_show_description = privateShowDescription;
      }
      if (privateShowMinViews !== undefined) {
        updatePayload.private_show_min_views = privateShowMinViews;
      }
      if (privateTeaserDescription !== undefined) {
        updatePayload.private_teaser_description =
          privateTeaserDescription || null;
      }
      if (payment_methods !== undefined) {
        updatePayload.payment_methods = payment_methods.length
          ? payment_methods
          : null;
      }
      if (privateTeaserTitle !== undefined) {
        updatePayload.private_teaser_title = privateTeaserTitle || null;
      }
      if (privateTeaserImageUrl !== undefined) {
        updatePayload.private_teaser_image_url = privateTeaserImageUrl || null;
      }
      if (privateDiscordGuildId !== undefined) {
        updatePayload.private_discord_guild_id =
          privateDiscordGuildId || null;
      }

      await db.update(campaigns).set(updatePayload).where(eq(campaigns.id, id));

      // Fetch and return the updated campaign
      const updatedCampaign = await db
        .select()
        .from(campaigns)
        .where(eq(campaigns.id, id))
        .limit(1);

      return updatedCampaign[0];
    }),

  // ── Campaign CARD soft-delete (data preserved) ──
  // Hides the campaign card from listings. The campaign row and every
  // submission / reward / clip tied to it remain fully intact. Reversible
  // via recoverCard.
  deleteCard: campaignsEditorRoleProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const [existing] = await db
        .select({ id: campaigns.id, title: campaigns.title })
        .from(campaigns)
        .where(eq(campaigns.id, input.id))
        .limit(1);
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Campaign not found" });
      }
      await db
        .update(campaigns)
        .set({
          card_deleted_at: new Date(),
          card_deleted_by: ctx.user.id,
        })
        .where(eq(campaigns.id, input.id));
      return { id: input.id, title: existing.title };
    }),

  recoverCard: campaignsEditorRoleProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ input }) => {
      await db
        .update(campaigns)
        .set({ card_deleted_at: null, card_deleted_by: null })
        .where(eq(campaigns.id, input.id));
      return { id: input.id };
    }),

  // Lists soft-deleted campaign cards for the "Recover deleted campaign cards"
  // panel.
  getDeletedCards: campaignsEditorRoleProcedure.query(async () => {
    const rows = await db
      .select({
        id: campaigns.id,
        title: campaigns.title,
        imageUrl: campaigns.imageUrl,
        budget: campaigns.budget,
        platforms: campaigns.platforms,
        active: campaigns.active,
        ended: campaigns.ended,
        cardDeletedAt: campaigns.card_deleted_at,
        cardDeletedBy: campaigns.card_deleted_by,
        createdAt: campaigns.created_at,
      })
      .from(campaigns)
      .where(isNotNull(campaigns.card_deleted_at))
      .orderBy(desc(campaigns.card_deleted_at));
    return rows;
  }),

  slashYoutubeHeavyRewards: campaignsEditorRoleProcedure
    .input(
      z.object({
        campaignId: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const [campaign] = await db
        .select({ id: campaigns.id, title: campaigns.title })
        .from(campaigns)
        .where(eq(campaigns.id, input.campaignId))
        .limit(1);

      if (!campaign) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Campaign not found",
        });
      }

      const userPlatformStats = await db
        .select({
          userId: submissions.user_id,
          totalSubmissions: sql<number>`COUNT(*)`,
          youtubeSubmissions: sql<number>`SUM(CASE WHEN LOWER(${submissions.platform}) = 'youtube' THEN 1 ELSE 0 END)`,
        })
        .from(submissions)
        .where(
          and(
            eq(submissions.campaign_id, input.campaignId),
            eq(submissions.status, "approved")
          )
        )
        .groupBy(submissions.user_id);

      if (userPlatformStats.length === 0) {
        return {
          affectedUsers: 0,
          totalSlashed: 0,
          details: [],
        };
      }

      const rewardSums = await db
        .select({
          userId: campaign_view_rewards.user_id,
          totalAmount: sum(campaign_view_rewards.amount).as("totalAmount"),
        })
        .from(campaign_view_rewards)
        .where(eq(campaign_view_rewards.campaign_id, input.campaignId))
        .groupBy(campaign_view_rewards.user_id);

      const rewardAmountByUser = new Map<string, number>();
      for (const reward of rewardSums) {
        const totalAmount = Number(reward.totalAmount ?? 0);
        if (totalAmount > 0) {
          rewardAmountByUser.set(reward.userId, totalAmount);
        }
      }

      if (rewardAmountByUser.size === 0) {
        return {
          affectedUsers: 0,
          totalSlashed: 0,
          details: [],
        };
      }

      const adjustments: {
        userId: string;
        slashAmount: number;
        youtubeShare: number;
        reductionRate: number;
      }[] = [];

      await db.transaction(async (tx) => {
        for (const stat of userPlatformStats) {
          const totalSubmissions = Number(stat.totalSubmissions ?? 0);
          const youtubeSubmissions = Number(stat.youtubeSubmissions ?? 0);

          if (totalSubmissions <= 0) {
            continue;
          }

          const totalReward = rewardAmountByUser.get(stat.userId) ?? 0;
          if (totalReward <= 0) {
            continue;
          }

          const youtubeShare = youtubeSubmissions / totalSubmissions;
          const reductionRate = resolveYoutubeReductionRate(youtubeShare);

          if (reductionRate <= 0) {
            continue;
          }

          const slashAmount = Number(
            (totalReward * reductionRate).toFixed(4)
          );

          if (slashAmount <= 0) {
            continue;
          }

          const metadata: CampaignYoutubeSlashMetadata = {
            version: "v1",
            type: "campaign_youtube_slash",
            campaignId: campaign.id,
            campaignTitle: campaign.title ?? null,
            reductionRate,
            youtubeShare: Number(youtubeShare.toFixed(4)),
            youtubeSubmissions,
            totalSubmissions,
            triggeredBy: ctx.user?.id ?? null,
          };

          await tx.insert(balance_entries).values({
            user_id: stat.userId,
            amount: -slashAmount,
            type: "manual_adjustment",
            memo: `YouTube heavy slash for ${campaign.title ?? campaign.id}`,
            source_type: "campaign_youtube_slash",
            source_id: campaign.id,
            metadata,
          });

          await tx
            .insert(balances)
            .values({
              user_id: stat.userId,
              balance: -slashAmount,
              totalEarned: -slashAmount,
            })
            .onDuplicateKeyUpdate({
              set: {
                balance: sql`${balances.balance} - ${slashAmount}`,
                totalEarned: sql`${balances.totalEarned} - ${slashAmount}`,
              },
            });

          adjustments.push({
            userId: stat.userId,
            slashAmount,
            youtubeShare: Number(youtubeShare.toFixed(4)),
            reductionRate,
          });
        }
      });

      const totalSlashed = adjustments.reduce(
        (sum, entry) => sum + entry.slashAmount,
        0
      );

      return {
        affectedUsers: adjustments.length,
        totalSlashed,
        details: adjustments,
      };
    }),

  getCampaignLevels: campaignsEditorRoleProcedure
    .input(z.object({ campaignId: z.string() }))
    .query(async ({ input }) => {
      const levels = await db
        .select()
        .from(campaign_levels)
        .where(eq(campaign_levels.campaign_id, input.campaignId))
        .orderBy(asc(campaign_levels.level_threshold));

      return levels;
    }),

  createCampaignLevel: campaignsEditorRoleProcedure
    .input(
      z.object({
        campaignId: z.string(),
        levelThreshold: z.number().min(0),
        cpmRate: z.number().positive(),
        additionalRewardsDescription: z.string().max(280).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const {
        campaignId,
        levelThreshold,
        cpmRate,
        additionalRewardsDescription,
      } = input;
      const normalizedThreshold = Math.max(0, Math.floor(levelThreshold));
      const normalizedDescription =
        additionalRewardsDescription?.trim() || null;

      const [campaign] = await db
        .select({ id: campaigns.id })
        .from(campaigns)
        .where(eq(campaigns.id, campaignId))
        .limit(1);

      if (!campaign) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Campaign not found",
        });
      }

      const [inserted] = await db
        .insert(campaign_levels)
        .values({
          campaign_id: campaignId,
          level_threshold: normalizedThreshold,
          cpm_rate: cpmRate,
          additional_rewards_description: normalizedDescription,
        })
        .$returningId();

      if (!inserted) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create campaign level",
        });
      }

      const [createdLevel] = await db
        .select()
        .from(campaign_levels)
        .where(eq(campaign_levels.id, inserted.id))
        .limit(1);

      return createdLevel;
    }),

  updateCampaignLevel: campaignsEditorRoleProcedure
    .input(
      z.object({
        id: z.string(),
        campaignId: z.string(),
        levelThreshold: z.number().min(0),
        cpmRate: z.number().positive(),
        additionalRewardsDescription: z.string().max(280).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const {
        id,
        campaignId,
        levelThreshold,
        cpmRate,
        additionalRewardsDescription,
      } = input;
      const normalizedThreshold = Math.max(0, Math.floor(levelThreshold));
      const normalizedDescription =
        additionalRewardsDescription?.trim() || null;

      const [existingLevel] = await db
        .select({ id: campaign_levels.id })
        .from(campaign_levels)
        .where(
          and(
            eq(campaign_levels.id, id),
            eq(campaign_levels.campaign_id, campaignId)
          )
        )
        .limit(1);

      if (!existingLevel) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Campaign level not found",
        });
      }

      await db
        .update(campaign_levels)
        .set({
          level_threshold: normalizedThreshold,
          cpm_rate: cpmRate,
          additional_rewards_description: normalizedDescription,
          updated_at: new Date(),
        })
        .where(
          and(
            eq(campaign_levels.id, id),
            eq(campaign_levels.campaign_id, campaignId)
          )
        );

      const [updatedLevel] = await db
        .select()
        .from(campaign_levels)
        .where(eq(campaign_levels.id, id))
        .limit(1);

      return updatedLevel;
    }),

  deleteCampaignLevel: campaignsEditorRoleProcedure
    .input(z.object({ id: z.string(), campaignId: z.string() }))
    .mutation(async ({ input }) => {
      const { id, campaignId } = input;

      await db
        .delete(campaign_levels)
        .where(
          and(
            eq(campaign_levels.id, id),
            eq(campaign_levels.campaign_id, campaignId)
          )
        );

      return { success: true };
    }),

  // The logged-in clipper's own boosted rates — feeds the "fiery" campaign
  // card treatment. Returns only the caller's rows: campaign id, their
  // group's rate, and the group name for the explainer dialog.
  getMyCpmGroupRates: protectedProcedure.query(async ({ ctx }) => {
    const rows = await db
      .select({
        campaignId: campaign_cpm_group_members.campaign_id,
        cpmPer1000: campaign_cpm_groups.cpm_per_1000,
        groupName: campaign_cpm_groups.name,
      })
      .from(campaign_cpm_group_members)
      .innerJoin(
        campaign_cpm_groups,
        eq(campaign_cpm_group_members.group_id, campaign_cpm_groups.id)
      )
      .where(eq(campaign_cpm_group_members.user_id, ctx.user.id));

    return rows.map((row) => ({
      campaignId: row.campaignId,
      cpmPer1000: Number(row.cpmPer1000),
      groupName: row.groupName,
    }));
  }),

  // ── CPM rate groups ───────────────────────────────────────────────────
  // Named groups per campaign (e.g. "Big Boys"), each carrying ONE absolute
  // rate; members inherit it. Every rate-affecting mutation settles the
  // affected clippers' pending views at the OLD rate first, so changes are
  // always forward-only (new views only). Live campaigns only — paused/ended
  // campaigns don't pay, so settling there would pay money the payout
  // system is designed never to pay.

  listCpmGroups: campaignsEditorRoleProcedure
    .input(z.object({ campaignId: z.string() }))
    .query(async ({ input }) => {
      const groups = await db
        .select()
        .from(campaign_cpm_groups)
        .where(eq(campaign_cpm_groups.campaign_id, input.campaignId))
        .orderBy(desc(campaign_cpm_groups.created_at));

      const members = await db
        .select({
          id: campaign_cpm_group_members.id,
          groupId: campaign_cpm_group_members.group_id,
          userId: campaign_cpm_group_members.user_id,
          createdAt: campaign_cpm_group_members.created_at,
          discordUsername: user_clerk.discord_username,
          firstName: user_clerk.first_name,
          lastName: user_clerk.last_name,
          imageUrl: user_clerk.image_url,
        })
        .from(campaign_cpm_group_members)
        .leftJoin(
          user_clerk,
          eq(campaign_cpm_group_members.user_id, user_clerk.discord_id)
        )
        .where(eq(campaign_cpm_group_members.campaign_id, input.campaignId));

      return groups.map((group) => ({
        id: group.id,
        name: group.name,
        cpmPer1000: Number(group.cpm_per_1000),
        createdAt: group.created_at,
        updatedAt: group.updated_at,
        members: members.filter((m) => m.groupId === group.id),
      }));
    }),

  // Resolve a clipper by discord id or username BEFORE adding, so the admin
  // confirms the right account (usernames get renamed; money follows the
  // discord id, never the display name).
  lookupClipperForCpm: campaignsEditorRoleProcedure
    .input(z.object({ query: z.string().trim().min(2).max(100) }))
    .query(async ({ input }) => {
      const q = input.query.trim();
      // Escape LIKE wildcards in user input (same pattern as user.listUsers).
      const escaped = q.replace(/[\\%_]/g, (char) => `\\${char}`);
      const candidates = await db
        .select({
          discordId: user_clerk.discord_id,
          discordUsername: user_clerk.discord_username,
          firstName: user_clerk.first_name,
          lastName: user_clerk.last_name,
          imageUrl: user_clerk.image_url,
        })
        .from(user_clerk)
        .where(
          or(
            eq(user_clerk.discord_id, q),
            like(user_clerk.discord_username, `%${escaped}%`)
          )
        )
        .limit(5);

      return candidates;
    }),

  createCpmGroup: campaignsEditorRoleProcedure
    .input(
      z.object({
        campaignId: z.string(),
        name: z.string().trim().min(1).max(60),
        // Absolute dollars per 1000 views for every member. Lower bound is
        // the smallest decimal(8,4) step (no silent $0.0000); upper bound is
        // a fat-finger guard.
        cpmPer1000: z.number().min(0.0001).max(10),
      })
    )
    .mutation(async ({ input, ctx }) => {
      await assertLiveCampaignForCpmGroups(input.campaignId);

      const [inserted] = await db
        .insert(campaign_cpm_groups)
        .values({
          campaign_id: input.campaignId,
          name: input.name.trim(),
          cpm_per_1000: input.cpmPer1000.toFixed(4),
          created_by: ctx.user?.id ?? null,
        })
        .$returningId();

      if (!inserted) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create group",
        });
      }

      return { id: inserted.id, name: input.name.trim(), cpmPer1000: input.cpmPer1000 };
    }),

  updateCpmGroupRate: campaignsEditorRoleProcedure
    .input(
      z.object({
        campaignId: z.string(),
        groupId: z.string(),
        cpmPer1000: z.number().min(0.0001).max(10),
      })
    )
    .mutation(async ({ input }) => {
      await assertLiveCampaignForCpmGroups(input.campaignId);

      const [group] = await db
        .select()
        .from(campaign_cpm_groups)
        .where(
          and(
            eq(campaign_cpm_groups.id, input.groupId),
            eq(campaign_cpm_groups.campaign_id, input.campaignId)
          )
        )
        .limit(1);

      if (!group) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Group not found" });
      }

      if (Number(group.cpm_per_1000) === input.cpmPer1000) {
        return { success: true, settledMembers: 0 };
      }

      // Changing the group rate changes EVERY member's rate: settle each
      // member's pending views at the old rate first. Abort the rate change
      // if anyone can't be settled — partial settles are harmless (those
      // members were simply paid what they were owed; the rate is unchanged).
      const members = await db
        .select({
          userId: campaign_cpm_group_members.user_id,
        })
        .from(campaign_cpm_group_members)
        .where(eq(campaign_cpm_group_members.group_id, input.groupId));

      let settled = 0;
      for (const member of members) {
        try {
          const result = await settleUserCampaignViewRewards({
            campaignId: input.campaignId,
            userId: member.userId,
          });
          if (
            result &&
            result.settled === false &&
            result.reason?.includes("not paying")
          ) {
            // Campaign got paused mid-loop — abort before the rate changes.
            throw new Error("campaign stopped paying mid-operation");
          }
          settled++;
        } catch (error) {
          console.error("Group rate-change settle failed", member.userId, error);
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Could not settle pending views for a member (${member.userId}) at the old rate — group rate NOT changed. ${settled} of ${members.length} members were settled (that money was owed regardless). Fix the blocker and retry.`,
          });
        }
      }

      await db
        .update(campaign_cpm_groups)
        .set({ cpm_per_1000: input.cpmPer1000.toFixed(4), updated_at: new Date() })
        .where(eq(campaign_cpm_groups.id, input.groupId));

      return { success: true, settledMembers: settled };
    }),

  deleteCpmGroup: campaignsEditorRoleProcedure
    .input(z.object({ campaignId: z.string(), groupId: z.string() }))
    .mutation(async ({ input }) => {
      // The group must belong to the campaign in the request — otherwise a
      // stale client could empty ANOTHER campaign's group while "settling"
      // its members against the wrong campaign (a guaranteed no-op).
      const [group] = await db
        .select({ id: campaign_cpm_groups.id })
        .from(campaign_cpm_groups)
        .where(
          and(
            eq(campaign_cpm_groups.id, input.groupId),
            eq(campaign_cpm_groups.campaign_id, input.campaignId)
          )
        )
        .limit(1);
      if (!group) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Group not found" });
      }

      // Paused is NOT ended: a paused campaign resumes paying on
      // reactivation, so removing rates while paused would silently reprice
      // the members' unpaid backlog. Ended campaigns never pay again —
      // deleting there is pure cleanup and needs no settle.
      const [campaignState] = await db
        .select({ active: campaigns.active, ended: campaigns.ended })
        .from(campaigns)
        .where(eq(campaigns.id, input.campaignId))
        .limit(1);
      if (!campaignState) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Campaign not found",
        });
      }
      if (!campaignState.ended && !campaignState.active) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "This campaign is paused — reactivate it (or end it) before deleting a rate group, or its members' pending views would lose the group rate",
        });
      }

      const members = await db
        .select({ userId: campaign_cpm_group_members.user_id })
        .from(campaign_cpm_group_members)
        .where(eq(campaign_cpm_group_members.group_id, input.groupId));

      // Deleting the group drops every member back to base rates — on a
      // LIVE campaign settle each at the group rate first. (Ended: skip —
      // nothing pays there, ever.)
      if (!campaignState.ended) {
        for (const member of members) {
          let result;
          try {
            result = await settleUserCampaignViewRewards({
              campaignId: input.campaignId,
              userId: member.userId,
            });
          } catch (error) {
            console.error("Group delete settle failed", member.userId, error);
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: `Could not settle pending views for a member (${member.userId}) — group NOT deleted. Fix the blocker and retry.`,
            });
          }
          if (
            result &&
            result.settled === false &&
            result.reason?.includes("not paying")
          ) {
            // Campaign got paused mid-loop — stop before repricing anyone.
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message:
                "Campaign stopped paying mid-operation — group NOT deleted. Retry once its state is settled.",
            });
          }
        }
      }

      await db
        .delete(campaign_cpm_group_members)
        .where(eq(campaign_cpm_group_members.group_id, input.groupId));
      await db
        .delete(campaign_cpm_groups)
        .where(
          and(
            eq(campaign_cpm_groups.id, input.groupId),
            eq(campaign_cpm_groups.campaign_id, input.campaignId)
          )
        );

      return { success: true };
    }),

  addCpmGroupMember: campaignsEditorRoleProcedure
    .input(
      z.object({
        campaignId: z.string(),
        groupId: z.string(),
        discordId: z.string().trim().min(1),
      })
    )
    .mutation(async ({ input }) => {
      await assertLiveCampaignForCpmGroups(input.campaignId);

      const [group] = await db
        .select({ id: campaign_cpm_groups.id })
        .from(campaign_cpm_groups)
        .where(
          and(
            eq(campaign_cpm_groups.id, input.groupId),
            eq(campaign_cpm_groups.campaign_id, input.campaignId)
          )
        )
        .limit(1);
      if (!group) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Group not found" });
      }

      const clipper = await db.query.user_clerk.findFirst({
        where: eq(user_clerk.discord_id, input.discordId),
      });
      if (!clipper) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No clipper with that Discord ID has an app account",
        });
      }

      const banned = await db.query.banned_users.findFirst({
        where: eq(banned_users.user_id, input.discordId),
      });
      if (banned) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "This clipper is banned — unban them before adding a rate",
        });
      }

      const [existingMembership] = await db
        .select({ id: campaign_cpm_group_members.id })
        .from(campaign_cpm_group_members)
        .where(
          and(
            eq(campaign_cpm_group_members.campaign_id, input.campaignId),
            eq(campaign_cpm_group_members.user_id, input.discordId)
          )
        )
        .limit(1);
      if (existingMembership) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "This clipper is already in a rate group on this campaign — remove them from it first",
        });
      }

      // Settle-then-boost: pay pending views at the CURRENT rate before the
      // group rate applies, so the new rate provably covers only views that
      // arrive after this moment.
      let settleResult;
      try {
        settleResult = await settleUserCampaignViewRewards({
          campaignId: input.campaignId,
          userId: input.discordId,
        });
      } catch (error) {
        console.error("Pre-add settle failed", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            "Could not settle the clipper's pending views at the old rate — not added. Try again.",
        });
      }
      if (
        settleResult &&
        settleResult.settled === false &&
        settleResult.reason?.includes("not paying")
      ) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Campaign stopped paying mid-operation — clipper NOT added. Retry once its state is settled.",
        });
      }

      try {
        await db.insert(campaign_cpm_group_members).values({
          group_id: input.groupId,
          campaign_id: input.campaignId,
          user_id: input.discordId,
        });
      } catch (error) {
        // Unique (campaign_id, user_id) index — two admins racing to add the
        // same clipper. Friendly error instead of a raw 500.
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "This clipper is already in a rate group on this campaign — remove them from it first",
        });
      }

      // Compensating re-check: banUser can complete between our pre-check
      // and the insert. If it did, undo the write.
      const bannedAfter = await db.query.banned_users.findFirst({
        where: eq(banned_users.user_id, input.discordId),
      });
      if (bannedAfter) {
        await db
          .delete(campaign_cpm_group_members)
          .where(
            and(
              eq(campaign_cpm_group_members.campaign_id, input.campaignId),
              eq(campaign_cpm_group_members.user_id, input.discordId)
            )
          );
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "This clipper is banned — unban them before adding a rate",
        });
      }

      return {
        success: true,
        discordId: input.discordId,
        discordUsername: clipper.discord_username,
      };
    }),

  removeCpmGroupMember: campaignsEditorRoleProcedure
    .input(
      z.object({
        campaignId: z.string(),
        groupId: z.string(),
        memberId: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const [row] = await db
        .select({ userId: campaign_cpm_group_members.user_id })
        .from(campaign_cpm_group_members)
        .where(
          and(
            eq(campaign_cpm_group_members.id, input.memberId),
            eq(campaign_cpm_group_members.group_id, input.groupId),
            eq(campaign_cpm_group_members.campaign_id, input.campaignId)
          )
        )
        .limit(1);

      if (!row) {
        return { success: true }; // already gone
      }

      // Paused is NOT ended (see deleteCpmGroup): block removal while
      // paused, allow as settle-free cleanup once truly ended.
      const [campaignState] = await db
        .select({ active: campaigns.active, ended: campaigns.ended })
        .from(campaigns)
        .where(eq(campaigns.id, input.campaignId))
        .limit(1);
      if (!campaignState) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Campaign not found",
        });
      }
      if (!campaignState.ended && !campaignState.active) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "This campaign is paused — reactivate it (or end it) before removing rate-group members, or their pending views would lose the group rate",
        });
      }

      // Removal is a rate change too (group rate -> base/levels): on a LIVE
      // campaign settle the clipper's pending views at the group rate FIRST.
      if (!campaignState.ended) {
        let result;
        try {
          result = await settleUserCampaignViewRewards({
            campaignId: input.campaignId,
            userId: row.userId,
          });
        } catch (error) {
          console.error("Pre-removal settle failed", error);
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message:
              "Could not settle the clipper's pending views at their current rate — not removed. Try again.",
          });
        }
        if (
          result &&
          result.settled === false &&
          result.reason?.includes("not paying")
        ) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "Campaign stopped paying mid-operation — member NOT removed. Retry once its state is settled.",
          });
        }
      }

      await db
        .delete(campaign_cpm_group_members)
        .where(eq(campaign_cpm_group_members.id, input.memberId));

      return { success: true };
    }),

  verifyExternalPassword: publicProcedure
    .input(
      z.object({
        campaignId: z.string(),
        password: z.string().min(1),
      })
    )
    .mutation(async ({ input }) => {
      const { campaignId, password } = input;

      const [campaign] = await db
        .select({ externalPassword: campaigns.external_password })
        .from(campaigns)
        .where(eq(campaigns.id, campaignId))
        .limit(1);

      if (!campaign) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Campaign not found",
        });
      }

      if (!campaign.externalPassword) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Campaign is not password protected",
        });
      }

      const isValid = verifyExternalPasswordHash(
        campaign.externalPassword,
        password
      );

      return { valid: isValid };
    }),

  // ── Geo payout rules ──
  // CRUD only. NOTHING reads these during payout yet — wiring them into
  // resolveCpm is a later phase, deliberately separated so this can ship while
  // changing nobody's earnings. A campaign with no rows here behaves exactly as
  // it does today.
  listGeoRules: campaignsEditorRoleProcedure
    .input(z.object({ campaignId: z.string() }))
    .query(async ({ input }) => {
      return db
        .select()
        .from(campaign_geo_rules)
        .where(eq(campaign_geo_rules.campaign_id, input.campaignId))
        .orderBy(desc(campaign_geo_rules.bonus_cpm_per_1000));
    }),

  createGeoRule: campaignsEditorRoleProcedure
    .input(z.object({ campaignId: z.string() }).and(geoRuleInputSchema))
    .mutation(async ({ input, ctx }) => {
      await assertCampaignAcceptsGeoRuleChanges(input.campaignId);

      await db.insert(campaign_geo_rules).values({
        campaign_id: input.campaignId,
        name: input.name ?? null,
        match_mode: input.matchMode,
        countries: input.countries.map((entry) => ({
          country: entry.country,
          ...(input.matchMode === "each"
            ? { min_percentage: entry.minPercentage }
            : {}),
        })),
        min_combined_percentage:
          input.matchMode === "combined" ? input.minCombinedPercentage : 0,
        bonus_cpm_per_1000: input.bonusCpmPer1000,
        created_by: ctx.user.id,
      });

      return { created: true };
    }),

  updateGeoRule: campaignsEditorRoleProcedure
    .input(
      z.object({ campaignId: z.string(), ruleId: z.string() }).and(
        geoRuleInputSchema
      )
    )
    .mutation(async ({ input }) => {
      await assertCampaignAcceptsGeoRuleChanges(input.campaignId);
      // Scope the lookup by campaign too, so a rule id from another campaign
      // can't be edited through this campaign's endpoint.
      await assertGeoRuleBelongsToCampaign(input.ruleId, input.campaignId);

      await db
        .update(campaign_geo_rules)
        .set({
          name: input.name ?? null,
          match_mode: input.matchMode,
          countries: input.countries.map((entry) => ({
            country: entry.country,
            ...(input.matchMode === "each"
              ? { min_percentage: entry.minPercentage }
              : {}),
          })),
          min_combined_percentage:
            input.matchMode === "combined" ? input.minCombinedPercentage : 0,
          bonus_cpm_per_1000: input.bonusCpmPer1000,
        })
        .where(eq(campaign_geo_rules.id, input.ruleId));

      return { updated: true };
    }),

  // Live preview: for every connected account on this campaign, which criterion
  // it meets and what it would therefore be paid. Read-only — it prices nothing
  // and writes nothing, so an admin can safely tune thresholds and re-run this
  // until the qualifying set looks right BEFORE any money moves.
  previewGeoQualification: campaignsEditorRoleProcedure
    .input(z.object({ campaignId: z.string() }))
    .query(async ({ input }) => {
      const [campaign] = await db
        .select()
        .from(campaigns)
        .where(eq(campaigns.id, input.campaignId))
        .limit(1);
      if (!campaign) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Campaign not found" });
      }

      const rules = await db
        .select()
        .from(campaign_geo_rules)
        .where(eq(campaign_geo_rules.campaign_id, input.campaignId));

      // Every account that has actually posted on this campaign, with its
      // latest approved audience report.
      const rows = await db
        .selectDistinct({
          verifiedUserId: verified_users.id,
          handle: verified_users.handle,
          platform: verified_users.platform,
          accountDeletedAt: verified_users.account_deleted_at,
          parsedData: demographics_verification_v2.parsed_data,
          reportStatus: demographics_verification_v2.status,
          reportUpdatedAt: demographics_verification_v2.updated_at,
        })
        .from(submissions)
        .innerJoin(
          verified_users,
          eq(submissions.verified_user_id, verified_users.id)
        )
        .leftJoin(
          demographics_verification_v2,
          and(
            eq(
              demographics_verification_v2.verified_user_id,
              verified_users.id
            ),
            eq(demographics_verification_v2.campaign_id, input.campaignId),
            eq(demographics_verification_v2.status, "approved")
          )
        )
        .where(
          and(
            eq(submissions.campaign_id, input.campaignId),
            eq(submissions.status, "approved")
          )
        );

      const baseCpmFor = (platform: string | null) => {
        switch ((platform ?? "").toLowerCase()) {
          case "youtube":
            return campaign.youtube_per_1000;
          case "instagram":
            return campaign.insta_per_1000;
          case "tiktok":
            return campaign.tiktok_per_1000;
          case "x":
          case "twitter":
            return campaign.x_per_1000;
          default:
            return 0;
        }
      };

      // Money actually held / cleared per account on this campaign, so the
      // admin can see the two-step outcome — not just who qualifies, but what
      // was released and what was withheld.
      const moneyRows = await db
        .select({
          verifiedUserId: campaign_view_rewards.verified_user_id,
          state: campaign_view_rewards.clearance_state,
          total: sql<string>`COALESCE(SUM(${campaign_view_rewards.amount}), 0)`,
        })
        .from(campaign_view_rewards)
        .where(eq(campaign_view_rewards.campaign_id, input.campaignId))
        .groupBy(
          campaign_view_rewards.verified_user_id,
          campaign_view_rewards.clearance_state
        );

      const moneyByAccount = new Map<
        string,
        { held: number; cleared: number; cancelled: number }
      >();
      for (const row of moneyRows) {
        if (!row.verifiedUserId) continue;
        const entry = moneyByAccount.get(row.verifiedUserId) ?? {
          held: 0,
          cleared: 0,
          cancelled: 0,
        };
        entry[row.state as "held" | "cleared" | "cancelled"] += Number(
          row.total
        );
        moneyByAccount.set(row.verifiedUserId, entry);
      }

      // This cycle's demographic status per account — the FIRST of the two
      // steps. Distinct from the approved report used for qualification, which
      // may be from an earlier cycle.
      const cycleRows = await db
        .select({
          verifiedUserId: demographics_verification_v2.verified_user_id,
          status: demographics_verification_v2.status,
        })
        .from(demographics_verification_v2)
        .where(
          and(
            eq(demographics_verification_v2.campaign_id, input.campaignId),
            eq(demographics_verification_v2.cycle_start, currentCycleStart())
          )
        );
      const cycleStatusByAccount = new Map(
        cycleRows.map((row) => [row.verifiedUserId, row.status])
      );

      // The PREVIOUS cycle's approved audience per account, so the panel can
      // show who has just dropped out of a criterion. That transition is what
      // makes a geo bonus get withheld at the second check, and an admin
      // fielding "why did my bonus stop?" needs to see it without digging.
      const prevCycle = (() => {
        const d = new Date(currentCycleStart() + "T00:00:00Z");
        d.setUTCDate(d.getUTCDate() - 7);
        return d.toISOString().slice(0, 10);
      })();
      const prevRows = await db
        .select({
          verifiedUserId: demographics_verification_v2.verified_user_id,
          parsedData: demographics_verification_v2.parsed_data,
        })
        .from(demographics_verification_v2)
        .where(
          and(
            eq(demographics_verification_v2.campaign_id, input.campaignId),
            eq(demographics_verification_v2.cycle_start, prevCycle),
            eq(demographics_verification_v2.status, "approved")
          )
        );
      const prevQualifiedByAccount = new Map(
        prevRows.map((row) => [
          row.verifiedUserId,
          Boolean(selectBestRule(rules, readAudienceCountries(row.parsedData))),
        ])
      );

      // Newest approved report per account wins.
      const latest = new Map<string, (typeof rows)[number]>();
      for (const row of rows) {
        const seen = latest.get(row.verifiedUserId);
        if (
          !seen ||
          (row.reportUpdatedAt &&
            seen.reportUpdatedAt &&
            row.reportUpdatedAt > seen.reportUpdatedAt)
        ) {
          latest.set(row.verifiedUserId, row);
        }
      }

      const accounts = [...latest.values()].map((row) => {
        const audience = readAudienceCountries(row.parsedData);
        // A deleted/banned account can never qualify — mirrors the payout path.
        const rule = row.accountDeletedAt
          ? null
          : selectBestRule(rules, audience);
        const baseCpm = baseCpmFor(row.platform);
        const bonus = rule ? Number(rule.bonus_cpm_per_1000) : 0;
        return {
          verifiedUserId: row.verifiedUserId,
          handle: row.handle,
          platform: row.platform,
          hasApprovedReport: Boolean(audience),
          accountDisabled: Boolean(row.accountDeletedAt),
          topCountries: (audience ?? [])
            .slice()
            .sort((a, b) => b.percentage - a.percentage)
            .slice(0, 5),
          qualifiedRuleId: rule?.id ?? null,
          qualifiedRuleName: rule?.name ?? null,
          baseCpm,
          bonusCpm: bonus,
          effectiveCpm: baseCpm + bonus,
          // Step 1 of the two-step: has this account filed THIS week's report?
          thisCycleStatus:
            cycleStatusByAccount.get(row.verifiedUserId) ?? "missing",
          // Qualified last week but not now → its held bonus gets withheld at
          // the second check. The single most-asked admin question.
          qualifiedLastCycle:
            prevQualifiedByAccount.get(row.verifiedUserId) ?? false,
          lostQualification:
            (prevQualifiedByAccount.get(row.verifiedUserId) ?? false) &&
            !rule,
          // Step 2 outcome: what the hold/clearance actually did with the money.
          heldAmount: moneyByAccount.get(row.verifiedUserId)?.held ?? 0,
          clearedAmount: moneyByAccount.get(row.verifiedUserId)?.cleared ?? 0,
          cancelledAmount:
            moneyByAccount.get(row.verifiedUserId)?.cancelled ?? 0,
        };
      });

      return {
        rules,
        accounts: accounts.sort((a, b) => b.bonusCpm - a.bonusCpm),
        qualifiedCount: accounts.filter((a) => a.qualifiedRuleId).length,
        totalCount: accounts.length,
      };
    }),

  deleteGeoRule: campaignsEditorRoleProcedure
    .input(z.object({ campaignId: z.string(), ruleId: z.string() }))
    .mutation(async ({ input }) => {
      await assertCampaignAcceptsGeoRuleChanges(input.campaignId);
      await assertGeoRuleBelongsToCampaign(input.ruleId, input.campaignId);

      await db
        .delete(campaign_geo_rules)
        .where(eq(campaign_geo_rules.id, input.ruleId));

      return { deleted: true };
    }),
});

// An ended campaign's payout history is final, so its geo rules are frozen —
// creating, editing or deleting one could only ever be an attempt to reprice
// settled earnings.
async function assertCampaignAcceptsGeoRuleChanges(campaignId: string) {
  const [campaign] = await db
    .select({ id: campaigns.id, ended: campaigns.ended })
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);

  if (!campaign) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Campaign not found" });
  }

  if (campaign.ended) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "This campaign has ended — its geo payout rules can no longer be changed.",
    });
  }
}

async function assertGeoRuleBelongsToCampaign(
  ruleId: string,
  campaignId: string
) {
  const [rule] = await db
    .select({ id: campaign_geo_rules.id })
    .from(campaign_geo_rules)
    .where(
      and(
        eq(campaign_geo_rules.id, ruleId),
        eq(campaign_geo_rules.campaign_id, campaignId)
      )
    )
    .limit(1);

  if (!rule) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Geo rule not found on this campaign",
    });
  }
}
