import { router, protectedProcedure } from "../lib/trpc";
import { TRPCError } from "@trpc/server";
import { google, youtube_v3, youtubeAnalytics_v2 } from "googleapis";
import {
  createYoutubeOAuthSession,
  getYoutubeOAuthClient,
} from "../lib/youtubeOAuth";
import { z } from "zod";
import { db } from "../lib/db";
import { campaigns, demographics_verification_v2 } from "../lib/schema";
import { and, eq } from "drizzle-orm";
import {
  fanOutDemographicToSiblings,
  recomputeCampaignDemographics,
} from "./demographicsVerification";
import { parseYouTubeCountryCode } from "../lib/youtubeCountryCodeConverter";
import {
  DemographicData,
  demographicSchema,
} from "../lib/zod-schemas/demographic";

export const youtubeOAuthRouter = router({
  createSession: protectedProcedure.mutation(({ ctx }) => {
    const userId = ctx.user?.id;
    if (!userId) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }

    const { url, state } = createYoutubeOAuthSession(userId);
    return {
      authorizationUrl: url,
      state,
    };
  }),
  getAudienceReport: protectedProcedure
    .input(
      z.object({
        accessToken: z.string().min(1),
        refreshToken: z.string().optional(),
        handle: z.string(),
        demographicsVerificationId: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const authClient = getYoutubeOAuthClient();
      authClient.setCredentials({
        access_token: input.accessToken,
        refresh_token: input.refreshToken,
      });

      const youtube = google.youtube({ version: "v3", auth: authClient });

      const { matchedChannel, channels } = await getChannelFromYoutubeByHandle(
        youtube,
        input.handle
      );

      if (!matchedChannel) {
        return {
          success: false,
          message:
            `Couldn't find channel @${
              input.handle
            } on your account. Found channels: ${channels
              ?.map((channel) => `@${channel.handle}`)
              .join(", ")}` || "None.",
        };
      }

      const [demographicsVerification] = await db
        .select({
          campaignCreatedAt: campaigns.created_at,
          recordingPeriodDays: campaigns.demographics_recording_period_days,
        })
        .from(demographics_verification_v2)
        .leftJoin(
          campaigns,
          eq(demographics_verification_v2.campaign_id, campaigns.id)
        )
        .where(
          eq(demographics_verification_v2.id, input.demographicsVerificationId)
        );

      const campaignCreatedAt = demographicsVerification?.campaignCreatedAt;
      if (!campaignCreatedAt) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Campaign creation date not found",
        });
      }

      const analytics = google.youtubeAnalytics({
        version: "v2",
        auth: authClient,
      });

      // Honor the campaign's recording window: the API pulls the last N days
      // so the auto-approved numbers match what the clipper would screen-record
      // (7/28/90). No window set → fall back to the campaign lifetime.
      const endDate = new Date();
      const recordingPeriodDays = demographicsVerification?.recordingPeriodDays;
      // Subtract N-1 so the inclusive [startDate, endDate] span is exactly N
      // calendar days (endDate is today), matching "last N days".
      const startDate = recordingPeriodDays
        ? new Date(
            endDate.getTime() - (recordingPeriodDays - 1) * 24 * 60 * 60 * 1000
          )
        : campaignCreatedAt;

      const demographics = await getAudienceDemographics({
        analytics,
        channelId: matchedChannel.id,
        startDate,
        endDate,
      });

      if (!demographics) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Unable to extract demographics data",
        });
      }

      // console.log("demographics", demographics);

      await updateDemographicsVerification(
        input.demographicsVerificationId,
        demographics
      );

      return {
        success: true,
      };
    }),
});

const getAudienceDemographics = async ({
  analytics,
  channelId,
  startDate,
  endDate,
}: {
  analytics: youtubeAnalytics_v2.Youtubeanalytics;
  channelId: string;
  startDate: Date;
  endDate: Date;
}) => {
  const startDateString = startDate.toISOString().split("T")[0];
  const endDateString = endDate.toISOString().split("T")[0];

  // https://developers.google.com/youtube/analytics/reference/reports/query
  const report = await analytics.reports.query({
    ids: `channel==${channelId}`,
    startDate: startDateString,
    endDate: endDateString,
    metrics: "views",
    dimensions: "country",
  });

  // Testing data
  // const report = {
  //   data: {
  //     kind: "youtubeAnalytics#resultTable",
  //     columnHeaders: [
  //       { name: "country", columnType: "DIMENSION", dataType: "STRING" },
  //       { name: "views", columnType: "METRIC", dataType: "INTEGER" },
  //     ],
  //     rows: [
  //       ["US", 12340],
  //       ["IN", 8300],
  //       ["BR", 4521],
  //       ["GB", 2132],
  //     ],
  //   },
  // };

  if (!report.data.rows) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "No data returned from YouTube Analytics",
    });
  }

  const totalViews = report.data.rows.reduce(
    (acc, row) => acc + Number(row[1]),
    0
  );
  const parsedReport = report.data.rows.map((row) => {
    if (typeof row[0] !== "string") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Invalid country code",
      });
    }

    return {
      country: parseYouTubeCountryCode(row[0]),
      percentage: Math.round((Number(row[1]) / totalViews) * 100),
    };
  });

  const parsedReportData = demographicSchema.safeParse({
    version: "v1",
    countries: parsedReport,
  });

  if (!parsedReportData.success) {
    return null;
  }

  return parsedReportData.data;
};

const getChannelFromYoutubeByHandle = async (
  youtube: youtube_v3.Youtube,
  handle: string
) => {
  const channelResponse = await youtube.channels.list({
    part: ["id", "snippet"],
    maxResults: 50,
    mine: true,
  });

  const channels = channelResponse.data.items
    ?.map((item) => ({
      id: item.id ?? "",
      title: item.snippet?.title ?? "Untitled channel",
      handle: item.snippet?.customUrl?.replace(/^@/, "") ?? "",
      description: item.snippet?.description ?? "",
      publishedAt: item.snippet?.publishedAt ?? null,
    }))
    .filter((channel) => channel.id);

  // console.log("channels", channels);

  const inputHandle = handle.replace(/^@/, "");
  const matchedChannel = channels?.find(
    (channel) => channel.handle === inputHandle
  );

  return {
    matchedChannel,
    channels,
  };
};

const updateDemographicsVerification = async (
  demographicsVerificationId: string,
  demographicsData: DemographicData
) => {
  const approvedSet = {
    parsed_data: demographicsData,
    status: "approved" as const,
    approval_method: "api" as const,
  };

  const [row] = await db
    .select({
      userId: demographics_verification_v2.user_id,
      verifiedUserId: demographics_verification_v2.verified_user_id,
    })
    .from(demographics_verification_v2)
    .where(eq(demographics_verification_v2.id, demographicsVerificationId))
    .limit(1);

  await db
    .update(demographics_verification_v2)
    .set(approvedSet)
    .where(eq(demographics_verification_v2.id, demographicsVerificationId));

  // The connected account's audience is the same in every campaign it runs
  // in, so this API approval covers all of them.
  if (row) {
    await fanOutDemographicToSiblings({
      verifiedUserId: row.verifiedUserId,
      userId: row.userId,
      excludeId: demographicsVerificationId,
      set: approvedSet,
    });

    // Refresh the cached demographics_json of every campaign this approval now
    // contributes to (mirrors the mod-approve path). Best-effort — a stale
    // cache is recoverable and must not fail the OAuth flow.
    try {
      const affected = await db
        .selectDistinct({
          campaignId: demographics_verification_v2.campaign_id,
        })
        .from(demographics_verification_v2)
        .where(
          and(
            eq(
              demographics_verification_v2.verified_user_id,
              row.verifiedUserId
            ),
            eq(demographics_verification_v2.user_id, row.userId)
          )
        );
      await Promise.all(
        affected.map((r) => recomputeCampaignDemographics(r.campaignId))
      );
    } catch (recomputeError) {
      console.error(
        "demographics recompute after YouTube approve failed",
        recomputeError
      );
    }
  }
};
