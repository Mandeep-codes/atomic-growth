import { trpc } from "@/lib/trpc";

interface CampaignCategory {
  id: string;
  campaign_id: string;
  category: string;
  platform?: string;
  rate_per_1000?: number;
  budget?: number;
  category_specific_max_payout?: number;
  guild_id?: string;
}

export const useCampaignCategories = (campaignId: string) => {
  return trpc.campaigns.getCampaignCategories.useQuery(
    {
      campaignId,
    },
    {
      enabled: !!campaignId,
    }
  );
};
