import { TRPCError } from "@trpc/server";
import { count, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../lib/db";
import {
  influencer_campaigns,
  influencer_twitter_submission,
  influencer_linkedin_submission,
  user_clerk,
} from "../lib/schema";
import { influencerCampaignEditorRoleProcedure, influencerSubmissionEditorRoleProcedure, router, publicProcedure } from "../lib/trpc";
import { demographicSchema } from "../lib/zod-schemas/demographic";
import {
  hashExternalPassword,
  verifyExternalPasswordHash,
} from "../lib/externalPassword";

const demographicsInput = z.object({
  screenshotUrl: z.string().url("Screenshot URL missing"),
  parsed: demographicSchema,
});

const campaignInput = z.object({
  title: z.string().min(1, "Campaign title is required"),
  endDate: z.string().optional().nullable(),
  password: z.string().optional(),
});

const updateCampaignInput = campaignInput.extend({
  campaignId: z.string().min(1, "Campaign ID is required"),
});

const createSubmissionInput = z.object({
  influencerCampaignId: z.string().min(1, "Choose a campaign"),
  link: z.string().url("Provide a valid URL"),
  platform: z.enum(["x", "twitter", "linkedin"]),
  handle: z.string().min(1, "Detected handle missing"),
  impressions: z.number().int().min(0).optional(),
  demographics: demographicsInput.optional(),
});

const updateDemographicsInput = z.object({
  submissionId: z.string().min(1, "Submission id required"),
  platform: z.enum(["twitter", "linkedin"]),
  demographics: demographicsInput,
});

const deleteSubmissionInput = z.object({
  submissionId: z.string().min(1, "Submission id required"),
  platform: z.enum(["twitter", "linkedin"]),
});

const updateImpressionsInput = z.object({
  submissionId: z.string().min(1, "Submission id required"),
  platform: z.enum(["twitter", "linkedin"]),
  impressions: z.number().int().min(0),
});

export const influencerSubmissionsRouter = router({
  listCampaigns: influencerCampaignEditorRoleProcedure.query(async () => {
    const campaigns = await db
      .select({
        id: influencer_campaigns.id,
        title: influencer_campaigns.title,
        created_at: influencer_campaigns.created_at,
        updated_at: influencer_campaigns.updated_at,
        end_date: influencer_campaigns.end_date,
        demographics: influencer_campaigns.demographics_json,
      })
      .from(influencer_campaigns)
      .orderBy(desc(influencer_campaigns.created_at));

    const [twitterCounts, linkedinCounts] = await Promise.all([
      db
        .select({
          campaignId: influencer_twitter_submission.influencer_campaign_id,
          total: count(influencer_twitter_submission.id),
        })
        .from(influencer_twitter_submission)
        .groupBy(influencer_twitter_submission.influencer_campaign_id),
      db
        .select({
          campaignId: influencer_linkedin_submission.influencer_campaign_id,
          total: count(influencer_linkedin_submission.id),
        })
        .from(influencer_linkedin_submission)
        .groupBy(influencer_linkedin_submission.influencer_campaign_id),
    ]);

    const countMap = new Map<string, number>();
    for (const row of twitterCounts) {
      if (!row.campaignId) continue;
      countMap.set(row.campaignId, (countMap.get(row.campaignId) ?? 0) + Number(row.total));
    }
    for (const row of linkedinCounts) {
      if (!row.campaignId) continue;
      countMap.set(row.campaignId, (countMap.get(row.campaignId) ?? 0) + Number(row.total));
    }

    return campaigns.map((campaign) => ({
      ...campaign,
      submissionCount: countMap.get(campaign.id) ?? 0,
    }));
  }),
  getCampaign: influencerCampaignEditorRoleProcedure
    .input(z.object({ campaignId: z.string().min(1) }))
    .query(async ({ input }) => {
      const campaign = await db
        .select({
          id: influencer_campaigns.id,
          title: influencer_campaigns.title,
          end_date: influencer_campaigns.end_date,
          external_password: influencer_campaigns.external_password,
        })
        .from(influencer_campaigns)
        .where(eq(influencer_campaigns.id, input.campaignId))
        .limit(1)
        .then((rows) => rows[0] ?? null);

      if (!campaign) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Campaign not found",
        });
      }

      const { external_password, ...rest } = campaign;

      return {
        ...rest,
        hasPassword: Boolean(external_password),
      };
    }),
  createCampaign: influencerCampaignEditorRoleProcedure
    .input(campaignInput)
    .mutation(async ({ input }) => {
      const title = input.title.trim();
      if (!title) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Campaign title is required",
        });
      }

      const endDate = parseCampaignEndDate(input.endDate);

      const trimmedPassword = input.password?.trim() ?? "";
      const hashedPassword = trimmedPassword
        ? hashExternalPassword(trimmedPassword)
        : null;

      const [insertion] = await db
        .insert(influencer_campaigns)
        .values({
          title,
          end_date: endDate ?? null,
          external_password: hashedPassword,
        })
        .$returningId();

      if (!insertion) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Unable to create campaign",
        });
      }

      return { id: insertion.id };
    }),
  updateCampaign: influencerCampaignEditorRoleProcedure
    .input(updateCampaignInput)
    .mutation(async ({ input }) => {
      const campaign = await db
        .select({ id: influencer_campaigns.id })
        .from(influencer_campaigns)
        .where(eq(influencer_campaigns.id, input.campaignId))
        .limit(1)
        .then((rows) => rows[0]);

      if (!campaign) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Campaign not found",
        });
      }

      const title = input.title.trim();
      if (!title) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Campaign title is required",
        });
      }

      const endDate = parseCampaignEndDate(input.endDate);

      await db
        .update(influencer_campaigns)
        .set({
          title,
          end_date: endDate ?? null,
          updated_at: new Date(),
          ...(input.password !== undefined
            ? {
              external_password: input.password.trim()
                ? hashExternalPassword(input.password.trim())
                : null,
            }
            : {}),
        })
        .where(eq(influencer_campaigns.id, input.campaignId));

      return { success: true };
    }),
  verifyCampaignPassword: publicProcedure
    .input(
      z.object({
        campaignId: z.string().min(1),
        password: z.string().min(1),
      })
    )
    .mutation(async ({ input }) => {
      const campaign = await db
        .select({ external_password: influencer_campaigns.external_password })
        .from(influencer_campaigns)
        .where(eq(influencer_campaigns.id, input.campaignId))
        .limit(1)
        .then((rows) => rows[0] ?? null);

      if (!campaign) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Campaign not found",
        });
      }

      if (!campaign.external_password) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Campaign is not password protected",
        });
      }

      const isValid = verifyExternalPasswordHash(
        campaign.external_password,
        input.password
      );

      return { valid: isValid };
    }),
  getCampaignDetails: publicProcedure
    .input(z.object({ campaignId: z.string().min(1) }))
    .query(async ({ input }) => {
      const campaign = await db
        .select({
          id: influencer_campaigns.id,
          title: influencer_campaigns.title,
          created_at: influencer_campaigns.created_at,
          updated_at: influencer_campaigns.updated_at,
          end_date: influencer_campaigns.end_date,
        demographics: influencer_campaigns.demographics_json,
        twitter_total_impressions: influencer_campaigns.twitter_total_impressions,
        twitter_total_replies: influencer_campaigns.twitter_total_replies,
        twitter_total_quotes: influencer_campaigns.twitter_total_quotes,
        twitter_total_retweets: influencer_campaigns.twitter_total_retweets,
        twitter_total_bookmarks: influencer_campaigns.twitter_total_bookmarks,
        linkedin_total_impressions: influencer_campaigns.linkedin_total_impressions,
        linkedin_total_likes: influencer_campaigns.linkedin_total_likes,
        linkedin_total_comments: influencer_campaigns.linkedin_total_comments,
        linkedin_total_reposts: influencer_campaigns.linkedin_total_reposts,
        external_password: influencer_campaigns.external_password,
      })
        .from(influencer_campaigns)
        .where(eq(influencer_campaigns.id, input.campaignId))
        .limit(1)
        .then((rows) => rows[0] ?? null);

      if (!campaign) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Campaign not found",
        });
      }

      const [twitter, linkedin] = await Promise.all([
        db
          .select({
            id: influencer_twitter_submission.id,
            link: influencer_twitter_submission.link,
            platform: influencer_twitter_submission.platform,
            handle: influencer_twitter_submission.handle,
            submittedBy: influencer_twitter_submission.submitted_by,
            submittedAt: influencer_twitter_submission.submitted_at,
            demographicsScreenshotUrl:
              influencer_twitter_submission.demographics_screenshot_url,
            demographicsParsed: influencer_twitter_submission.demographics_parsed,
            impressions: influencer_twitter_submission.impressions,
            bookmarkCount: influencer_twitter_submission.bookmarkCount,
            replyCount: influencer_twitter_submission.replyCount,
            quoteCount: influencer_twitter_submission.quoteCount,
            favoriteCount: influencer_twitter_submission.favoriteCount,
            retweetCount: influencer_twitter_submission.retweetCount,
          })
          .from(influencer_twitter_submission)
          .where(
            eq(
              influencer_twitter_submission.influencer_campaign_id,
              input.campaignId
            )
          )
          .orderBy(desc(influencer_twitter_submission.submitted_at)),
        db
          .select({
            id: influencer_linkedin_submission.id,
            link: influencer_linkedin_submission.link,
            platform: influencer_linkedin_submission.platform,
            handle: influencer_linkedin_submission.handle,
            submittedBy: influencer_linkedin_submission.submitted_by,
            submittedAt: influencer_linkedin_submission.submitted_at,
            demographicsScreenshotUrl:
              influencer_linkedin_submission.demographics_screenshot_url,
            demographicsParsed: influencer_linkedin_submission.demographics_parsed,
            impressions: influencer_linkedin_submission.impressions,
            likes: influencer_linkedin_submission.likes,
            comments: influencer_linkedin_submission.comments,
            reposts: influencer_linkedin_submission.reposts,
          })
          .from(influencer_linkedin_submission)
          .where(
            eq(
              influencer_linkedin_submission.influencer_campaign_id,
              input.campaignId
            )
          )
          .orderBy(desc(influencer_linkedin_submission.submitted_at)),
      ]);

      const twitterTotals = {
        impressions: Number(campaign.twitter_total_impressions ?? 0),
        replies: Number(campaign.twitter_total_replies ?? 0),
        quotes: Number(campaign.twitter_total_quotes ?? 0),
        retweets: Number(campaign.twitter_total_retweets ?? 0),
        bookmarks: Number(campaign.twitter_total_bookmarks ?? 0),
      };
      const linkedinTotals = {
        impressions: Number(campaign.linkedin_total_impressions ?? 0),
        likes: Number(campaign.linkedin_total_likes ?? 0),
        comments: Number(campaign.linkedin_total_comments ?? 0),
        reposts: Number(campaign.linkedin_total_reposts ?? 0),
      };

      const { external_password, ...campaignWithoutPassword } = campaign;

      return {
        campaign: {
          ...campaignWithoutPassword,
          hasPassword: Boolean(external_password),
        },
        totals: {
          totalImpressions: twitterTotals.impressions + linkedinTotals.impressions,
          twitter: twitterTotals,
          linkedin: linkedinTotals,
        },
        twitter,
        linkedin,
      };
    }),
  listSubmissions: influencerSubmissionEditorRoleProcedure
    .input(
      z
        .object({
          campaignId: z.string().optional(),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const campaignFilter = input?.campaignId ?? null;

      const twitterQuery = db
        .select({
          id: influencer_twitter_submission.id,
          link: influencer_twitter_submission.link,
          platform: influencer_twitter_submission.platform,
          handle: influencer_twitter_submission.handle,
          submittedBy: influencer_twitter_submission.submitted_by,
          submittedAt: influencer_twitter_submission.submitted_at,
          campaignId: influencer_campaigns.id,
          campaignTitle: influencer_campaigns.title,
          moderatorDiscordId: user_clerk.discord_id,
          moderatorDiscordUsername: user_clerk.discord_username,
          moderatorEmail: user_clerk.email,
          demographicsScreenshotUrl:
            influencer_twitter_submission.demographics_screenshot_url,
          demographicsParsed: influencer_twitter_submission.demographics_parsed,
          impressions: influencer_twitter_submission.impressions,
          bookmarkCount: influencer_twitter_submission.bookmarkCount,
          replyCount: influencer_twitter_submission.replyCount,
          quoteCount: influencer_twitter_submission.quoteCount,
          favoriteCount: influencer_twitter_submission.favoriteCount,
          retweetCount: influencer_twitter_submission.retweetCount,
        })
        .from(influencer_twitter_submission)
        .leftJoin(
          influencer_campaigns,
          eq(
            influencer_twitter_submission.influencer_campaign_id,
            influencer_campaigns.id
          )
        )
        .leftJoin(
          user_clerk,
          eq(user_clerk.discord_id, influencer_twitter_submission.submitted_by)
        )
        .orderBy(desc(influencer_twitter_submission.submitted_at));

      const linkedinQuery = db
        .select({
          id: influencer_linkedin_submission.id,
          link: influencer_linkedin_submission.link,
          platform: influencer_linkedin_submission.platform,
          handle: influencer_linkedin_submission.handle,
          submittedBy: influencer_linkedin_submission.submitted_by,
          submittedAt: influencer_linkedin_submission.submitted_at,
          campaignId: influencer_campaigns.id,
          campaignTitle: influencer_campaigns.title,
          moderatorDiscordId: user_clerk.discord_id,
          moderatorDiscordUsername: user_clerk.discord_username,
          moderatorEmail: user_clerk.email,
          demographicsScreenshotUrl:
            influencer_linkedin_submission.demographics_screenshot_url,
          demographicsParsed: influencer_linkedin_submission.demographics_parsed,
          impressions: influencer_linkedin_submission.impressions,
          likes: influencer_linkedin_submission.likes,
          comments: influencer_linkedin_submission.comments,
          reposts: influencer_linkedin_submission.reposts,
        })
        .from(influencer_linkedin_submission)
        .leftJoin(
          influencer_campaigns,
          eq(
            influencer_linkedin_submission.influencer_campaign_id,
            influencer_campaigns.id
          )
        )
        .leftJoin(
          user_clerk,
          eq(user_clerk.discord_id, influencer_linkedin_submission.submitted_by)
        )
        .orderBy(desc(influencer_linkedin_submission.submitted_at));

      if (campaignFilter) {
        twitterQuery.where(
          eq(
            influencer_twitter_submission.influencer_campaign_id,
            campaignFilter
          )
        );
        linkedinQuery.where(
          eq(
            influencer_linkedin_submission.influencer_campaign_id,
            campaignFilter
          )
        );
      }

      const [twitter, linkedin] = await Promise.all([
        twitterQuery,
        linkedinQuery,
      ]);

      return {
        twitter,
        linkedin,
      };
    }),
  createSubmission: influencerSubmissionEditorRoleProcedure
    .input(createSubmissionInput)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user?.id;
      if (!userId) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Missing moderator identity",
        });
      }

      let normalizedLink: string;
      try {
        const parsed = new URL(input.link);
        normalizedLink = parsed.toString();
      } catch {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Could not parse the provided link",
        });
      }

      const platform = input.platform.toLowerCase();

      if (platform === "x" || platform === "twitter") {
        const [insertion] = await db
          .insert(influencer_twitter_submission)
          .values({
            influencer_campaign_id: input.influencerCampaignId,
            link: normalizedLink,
            platform: "x",
            handle: input.handle,
            submitted_by: userId,
            impressions: input.impressions ?? undefined,
            demographics_screenshot_url: input.demographics?.screenshotUrl ?? null,
            demographics_parsed: input.demographics?.parsed ?? null,
          })
          .$returningId();

        if (!insertion) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Unable to save Twitter submission",
          });
        }

        await refreshInfluencerCampaignDemographics(input.influencerCampaignId);

        return { id: insertion.id };
      }

      if (platform === "linkedin") {
        const [insertion] = await db
          .insert(influencer_linkedin_submission)
          .values({
            influencer_campaign_id: input.influencerCampaignId,
            link: normalizedLink,
            platform: "linkedin",
            handle: input.handle,
            submitted_by: userId,
            impressions: input.impressions ?? undefined,
            demographics_screenshot_url: input.demographics?.screenshotUrl ?? null,
            demographics_parsed: input.demographics?.parsed ?? null,
          })
          .$returningId();

        if (!insertion) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Unable to save LinkedIn submission",
          });
        }

        await refreshInfluencerCampaignDemographics(input.influencerCampaignId);

        return { id: insertion.id };
      }

      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Unsupported platform",
      });
    }),
  updateDemographics: influencerSubmissionEditorRoleProcedure
    .input(updateDemographicsInput)
    .mutation(async ({ input }) => {
      const table =
        input.platform === "twitter"
          ? influencer_twitter_submission
          : influencer_linkedin_submission;

      const submission = await db
        .select({ campaignId: table.influencer_campaign_id })
        .from(table)
        .where(eq(table.id, input.submissionId))
        .limit(1)
        .then((rows) => rows[0]);

      if (!submission) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Submission not found",
        });
      }

      await db
        .update(table)
        .set({
          demographics_screenshot_url: input.demographics.screenshotUrl,
          demographics_parsed: input.demographics.parsed,
          updated_at: new Date(),
        })
        .where(eq(table.id, input.submissionId));

      if (submission.campaignId) {
        await refreshInfluencerCampaignDemographics(submission.campaignId);
      }

      return { success: true };
    }),
  deleteSubmission: influencerSubmissionEditorRoleProcedure
    .input(deleteSubmissionInput)
    .mutation(async ({ input }) => {
      const table =
        input.platform === "twitter"
          ? influencer_twitter_submission
          : influencer_linkedin_submission;

      const submission = await db
        .select({ campaignId: table.influencer_campaign_id })
        .from(table)
        .where(eq(table.id, input.submissionId))
        .limit(1)
        .then((rows) => rows[0]);

      if (!submission) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Submission not found",
        });
      }

      await db.delete(table).where(eq(table.id, input.submissionId));

      if (submission.campaignId) {
        await refreshInfluencerCampaignDemographics(submission.campaignId);
      }

      return { success: true };
    }),
  updateImpressions: influencerSubmissionEditorRoleProcedure
    .input(updateImpressionsInput)
    .mutation(async ({ input }) => {
      const table =
        input.platform === "twitter"
          ? influencer_twitter_submission
          : influencer_linkedin_submission;

      const submission = await db
        .select({ campaignId: table.influencer_campaign_id })
        .from(table)
        .where(eq(table.id, input.submissionId))
        .limit(1)
        .then((rows) => rows[0]);

      if (!submission) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Submission not found",
        });
      }

      await db
        .update(table)
        .set({ impressions: input.impressions, updated_at: new Date() })
        .where(eq(table.id, input.submissionId));

      if (submission.campaignId) {
        await refreshInfluencerCampaignDemographics(submission.campaignId);
      }

      return { success: true };
    }),
});

async function refreshInfluencerCampaignDemographics(campaignId: string) {
  const [twitterRows, linkedinRows] = await Promise.all([
    db
      .select({
        demographics: influencer_twitter_submission.demographics_parsed,
        impressions: influencer_twitter_submission.impressions,
        bookmarkCount: influencer_twitter_submission.bookmarkCount,
        replyCount: influencer_twitter_submission.replyCount,
        quoteCount: influencer_twitter_submission.quoteCount,
        retweetCount: influencer_twitter_submission.retweetCount,
      })
      .from(influencer_twitter_submission)
      .where(eq(influencer_twitter_submission.influencer_campaign_id, campaignId)),
    db
      .select({
        demographics: influencer_linkedin_submission.demographics_parsed,
        impressions: influencer_linkedin_submission.impressions,
        likes: influencer_linkedin_submission.likes,
        comments: influencer_linkedin_submission.comments,
        reposts: influencer_linkedin_submission.reposts,
      })
      .from(influencer_linkedin_submission)
      .where(eq(influencer_linkedin_submission.influencer_campaign_id, campaignId)),
  ]);

  const countries = new Map<string, number>();
  let totalContribution = 0;

  const twitterTotals = twitterRows.reduce(
    (acc, row) => ({
      impressions: acc.impressions + Number(row.impressions ?? 0),
      replies: acc.replies + Number(row.replyCount ?? 0),
      quotes: acc.quotes + Number(row.quoteCount ?? 0),
      retweets: acc.retweets + Number(row.retweetCount ?? 0),
      bookmarks: acc.bookmarks + Number(row.bookmarkCount ?? 0),
    }),
    { impressions: 0, replies: 0, quotes: 0, retweets: 0, bookmarks: 0 }
  );
  const linkedinTotals = linkedinRows.reduce(
    (acc, row) => ({
      impressions: acc.impressions + Number(row.impressions ?? 0),
      likes: acc.likes + Number(row.likes ?? 0),
      comments: acc.comments + Number(row.comments ?? 0),
      reposts: acc.reposts + Number(row.reposts ?? 0),
    }),
    { impressions: 0, likes: 0, comments: 0, reposts: 0 }
  );
  const accumulate = (
    rows: { demographics: unknown; impressions: number | null }[]
  ) => {
    for (const row of rows) {
      if (!row.demographics) continue;
      const parsed = demographicSchema.safeParse(row.demographics);
      if (!parsed.success) continue;

      if (!row.impressions) continue;


      totalContribution += row.impressions;
      for (const country of parsed.data.countries) {
        const contribution = (country.percentage / 100) * row.impressions;
        countries.set(
          country.country,
          (countries.get(country.country) ?? 0) + contribution
        );
      }
    }
  };

  accumulate(twitterRows);
  accumulate(linkedinRows);

  if (totalContribution === 0 || countries.size === 0) {
    await db
      .update(influencer_campaigns)
      .set({
        demographics_json: null,
        twitter_total_impressions: twitterTotals.impressions,
        twitter_total_replies: twitterTotals.replies,
        twitter_total_quotes: twitterTotals.quotes,
        twitter_total_retweets: twitterTotals.retweets,
        twitter_total_bookmarks: twitterTotals.bookmarks,
        linkedin_total_impressions: linkedinTotals.impressions,
        linkedin_total_likes: linkedinTotals.likes,
        linkedin_total_comments: linkedinTotals.comments,
        linkedin_total_reposts: linkedinTotals.reposts,
      })
      .where(eq(influencer_campaigns.id, campaignId));
    return;
  }

  const normalizedCountries = Array.from(countries.entries())
    .map(([country, contribution]) => ({
      country,
      percentage: Number(((contribution / totalContribution) * 100).toFixed(2)),
    }))
    .sort((a, b) => b.percentage - a.percentage);

  await db
    .update(influencer_campaigns)
    .set({
      demographics_json: {
        version: "v1",
        countries: normalizedCountries,
      },
      twitter_total_impressions: twitterTotals.impressions,
      twitter_total_replies: twitterTotals.replies,
      twitter_total_quotes: twitterTotals.quotes,
      twitter_total_retweets: twitterTotals.retweets,
      twitter_total_bookmarks: twitterTotals.bookmarks,
      linkedin_total_impressions: linkedinTotals.impressions,
      linkedin_total_likes: linkedinTotals.likes,
      linkedin_total_comments: linkedinTotals.comments,
      linkedin_total_reposts: linkedinTotals.reposts,
    })
    .where(eq(influencer_campaigns.id, campaignId));
}

function parseCampaignEndDate(value?: string | null) {
  if (!value) return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Invalid end date",
    });
  }

  return date;
}
