import { trpc } from "@/lib/trpc";

export const ALL_TIME_LEADERBOARD_ID = "all-time";

export const useSubmissionsData = (
  campaignId: string,
  category?: string,
  limit?: number,
  platform?: string
) => {
  const isAllTime = campaignId === ALL_TIME_LEADERBOARD_ID;
  const normalizedPlatform = platform?.toLowerCase().trim();

  const campaignLeaderboardQuery = trpc.submissions.getAll.useQuery(
    {
      campaignId,
      category,
      platform: normalizedPlatform && normalizedPlatform !== "all" ? normalizedPlatform : undefined,
      viewsThreshold: 1000,
      status: "approved",
      limit,
    },
    {
      enabled: !!campaignId && !isAllTime,
    }
  );

  const allTimeQuery = trpc.submissions.getAllTimeLeaderboard.useQuery(
    normalizedPlatform && normalizedPlatform !== "all"
      ? { platform: normalizedPlatform }
      : undefined,
    {
      enabled: isAllTime,
    }
  );

  return isAllTime ? allTimeQuery : campaignLeaderboardQuery;
};
