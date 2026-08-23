import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, protectedProcedure } from "../lib/trpc";
import { createInstagramOAuthSession } from "../lib/instagramOAuth";
import { demographicSchema } from "../lib/zod-schemas/demographic";
import { parseYouTubeCountryCode } from "../lib/youtubeCountryCodeConverter";
import { db } from "../lib/db";
import { campaigns, demographics_verification_v2 } from "../lib/schema";
import { and, eq } from "drizzle-orm";
import {
  fanOutDemographicToSiblings,
  recomputeCampaignDemographics,
} from "./demographicsVerification";

const INSTAGRAM_GRAPH_URL = "https://graph.instagram.com/v24.0";

export const instagramOAuthRouter = router({
  createSession: protectedProcedure.mutation(({ ctx }) => {
    const userId = ctx.user?.id;
    if (!userId) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }

    const { url, state } = createInstagramOAuthSession(userId);
    return {
      authorizationUrl: url,
      state,
    };
  }),
  getAudienceReport: protectedProcedure
    .input(
      z.object({
        accessToken: z.string().min(1),
        handle: z.string().min(1),
        demographicsVerificationId: z.string().min(1),
      })
    )
    .mutation(async ({ input }) => {
      const normalizedHandle = input.handle.replace(/^@/, "").toLowerCase();
      const { accessToken } = input;

      const { username, id: igUserId } = await findInstagramBusinessAccount({
        userAccessToken: accessToken,
      });

      if (username.toLowerCase() !== normalizedHandle) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Instagram handle @${username} does not match the verified handle @${normalizedHandle}.`,
        });
      }

      // Honor the campaign's recording window. Instagram's API can't do exact
      // rolling ranges, so 7 days → this_week and 28/90 (or none) → this_month.
      const [claimCampaign] = await db
        .select({
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
      const timeframe =
        claimCampaign?.recordingPeriodDays === 7 ? "this_week" : "this_month";

      const demographics = await fetchInstagramAudienceDemographics({
        igUserId,
        accessToken,
        timeframe,
      });

      console.debug("demographics parsed", demographics);

      await updateDemographicsVerification(
        input.demographicsVerificationId,
        demographics
      );

      return { success: true };
    }),
});

const findInstagramBusinessAccount = async ({
  userAccessToken,
}: {
  userAccessToken: string;
}) => {
  let url: URL | null = new URL(`${INSTAGRAM_GRAPH_URL}/me`);
  url.searchParams.set("access_token", userAccessToken);
  url.searchParams.set("fields", "username");

  const response = await fetch(url);

  if (!response.ok) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Unable to retrieve Instagram business account.",
    });
  }

  const data = await response.json();

  const parsedData = z
    .object({
      username: z.string(),
      id: z.string(),
    })
    .parse(data);

  return parsedData;
};

const fetchInstagramAudienceDemographics = async ({
  igUserId,
  accessToken,
  timeframe = "this_month",
}: {
  igUserId: string;
  accessToken: string;
  // Instagram's audience-demographics API only accepts fixed timeframes; the
  // 7/28/90 buckets map to this_week (~7d) / this_month (28 & 90 both fall
  // back here, since last_30/last_90 were removed from the API).
  timeframe?: "this_week" | "this_month";
}) => {
  const url = new URL(`${INSTAGRAM_GRAPH_URL}/${igUserId}/insights`);
  url.searchParams.set("metric", "engaged_audience_demographics");
  url.searchParams.set("period", "day");
  url.searchParams.set("access_token", accessToken);
  url.searchParams.set("timeframe", timeframe);

  const response = await fetch(url);
  const data = await response.json();

  if (!response.ok) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        data?.error?.message ??
        "Unable to retrieve Instagram audience demographics.",
    });
  }

  console.debug("response data", data);
  const responseData = data;
  // test data
  // const responseData = {
  //   data: [
  //     {
  //       name: "engaged_audience_demographics",
  //       period: "day",
  //       values: [
  //         {
  //           value: {
  //             // Country ISO code keys with number of engaged users
  //             US: 120,
  //             BR: 85,
  //             IN: 42,
  //             GB: 30,
  //             CA: 25,
  //           },
  //           end_time: "2025-12-23T23:59:59+0000",
  //         },
  //       ],
  //       title: "Engaged Audience Demographics by Country",
  //       description: "Number of engaged users from each country",
  //       id: "25529289866687527/insights/engaged_audience_demographics/day",
  //     },
  //   ],
  //   paging: {
  //     previous:
  //       "https://graph.instagram.com/v24.0/25529289866687527/insights?...",
  //     next: "https://graph.instagram.com/v24.0/25529289866687527/insights?after=...",
  //   },
  // };

  const parsedResponse = z
    .object({
      data: z.array(
        z.object({
          name: z.string(),
          period: z.string(),
          values: z.array(
            z.object({
              value: z.record(z.string(), z.number()),
              end_time: z.string(),
            })
          ),
        })
      ),
    })
    .safeParse(responseData);

  if (!parsedResponse.success) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Unable to parse Instagram audience demographics data.",
    });
  }

  const cleanResponse = parsedResponse.data;

  const values = cleanResponse.data[0]?.values[0]?.value ?? {};
  const total = Object.values(values ?? {}).reduce(
    (sum, value) => sum + Number(value),
    0
  );

  if (total === 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Instagram returned empty audience counts.",
    });
  }

  const parsedCountries = Object.entries(values).map(
    ([countryCode, value]) => ({
      country: parseYouTubeCountryCode(countryCode),
      percentage: Math.round((Number(value) / total) * 100),
    })
  );

  const parsed = demographicSchema.safeParse({
    version: "v1",
    countries: parsedCountries,
  });

  if (!parsed.success) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Unable to parse demographics data",
    });
  }

  return parsed.data;
};

const updateDemographicsVerification = async (
  demographicsVerificationId: string,
  demographicsData: z.infer<typeof demographicSchema>
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
        "demographics recompute after Instagram approve failed",
        recomputeError
      );
    }
  }
};
