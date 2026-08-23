import { useMyUnlockedCampaigns } from "@/hooks/useMyUnlockedCampaigns";
import { trpc } from "@/lib/trpc";
import type { inferRouterOutputs } from "@trpc/server";
import { useMemo } from "react";
import type { AppRouter } from "../../../backend/src/routers";

type RouterOutput = inferRouterOutputs<AppRouter>;

/**
 * getAll rows, with the teaser strip undone for private campaigns the
 * caller is approved into. `unlockedForMe` marks the merged rows so cards
 * know to drop the "Apply to see details" treatment — private_show_budget
 * still describes what UNapproved clippers see, so it can't carry that.
 */
export type CampaignWithUnlock =
  RouterOutput["campaigns"]["getAll"][number] & {
    unlockedForMe?: boolean;
  };

export const useCampaignsData = () => {
  const query = trpc.campaigns.getAll.useQuery();
  const unlocked = useMyUnlockedCampaigns();

  const data = useMemo((): CampaignWithUnlock[] | undefined => {
    if (!query.data) return query.data;
    if (unlocked.map.size === 0) return query.data;
    return query.data.map((campaign) => {
      const mine = unlocked.map.get(campaign.id);
      if (!mine) return campaign;
      return {
        ...campaign,
        title: mine.title,
        imageUrl: mine.imageUrl,
        budget: mine.budget,
        min_payout: mine.min_payout,
        max_payout: mine.max_payout,
        insta_per_1000: mine.insta_per_1000,
        x_per_1000: mine.x_per_1000,
        youtube_per_1000: mine.youtube_per_1000,
        tiktok_per_1000: mine.tiktok_per_1000,
        // Per-clip floors ride along with min_payout: without these, an
        // approved clipper on a min-views-hidden campaign sees the sanitized
        // zeros and is told there's no per-clip minimum when there is one.
        youtube_min_views: mine.youtube_min_views,
        insta_min_views: mine.insta_min_views,
        x_min_views: mine.x_min_views,
        tiktok_min_views: mine.tiktok_min_views,
        achievementPercentage: mine.achievementPercentage,
        unlockedForMe: true,
      };
    });
  }, [query.data, unlocked.map]);

  return {
    ...query,
    data,
    // Hold the skeleton while a signed-in user's unlock check is in
    // flight — otherwise approved clippers get a teaser→real flash.
    isLoading: query.isLoading || unlocked.isPending,
  };
};
