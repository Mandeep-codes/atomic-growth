import { trpc } from "@/lib/trpc";

export const usePlatformBreakdown = (campaignId: string, category?: string) => {
  return trpc.submissions.getPlatformBreakdown.useQuery(
    {
      campaignId,
      category,
    },
    {
      enabled: !!campaignId,
    }
  );
};
