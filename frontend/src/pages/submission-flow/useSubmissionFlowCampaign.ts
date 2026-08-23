import { useMemo } from "react";
import { trpc } from "@/lib/trpc";

// getByIdPublic teaser-strips private campaigns for everyone, including
// approved applicants. The real values live behind the protected
// getApplicationState endpoint (its `unlocked` object), so for private
// campaigns this hook merges them back in — otherwise an approved clipper
// gets sopEmbedUrl=null (step-1 silently skips the SOP) and the teaser
// cover title in the flow headers.
export const useSubmissionFlowCampaign = (campaignId?: string) => {
  const campaignQuery = trpc.campaigns.getByIdPublic.useQuery(
    { id: campaignId ?? "" },
    {
      enabled: !!campaignId,
    }
  );

  const isPrivate = campaignQuery.data?.visibility === "private";
  // Same query key as PrivateCampaignGate's — served from the cache.
  const applicationQuery = trpc.privateCampaigns.getApplicationState.useQuery(
    { campaignId: campaignId ?? "" },
    { enabled: !!campaignId && isPrivate }
  );

  const unlocked = applicationQuery.data?.unlocked ?? null;
  const unlockedPending = isPrivate && applicationQuery.isLoading;

  const data = useMemo(() => {
    const campaign = campaignQuery.data;
    if (!campaign || campaign.visibility !== "private") return campaign;
    // Don't hand out the teaser values while the unlock check is in flight —
    // step-1's auto-skip would fire on the stripped sopEmbedUrl.
    if (unlockedPending) return undefined;
    if (!unlocked) return campaign; // not approved — the teaser is correct
    return {
      ...campaign,
      title: unlocked.title,
      imageUrl: unlocked.imageUrl,
      budget: unlocked.budget,
      description: unlocked.description,
      sopEmbedUrl: unlocked.sopEmbedUrl,
    };
  }, [campaignQuery.data, unlocked, unlockedPending]);

  return {
    ...campaignQuery,
    data,
    isLoading: campaignQuery.isLoading || unlockedPending,
  };
};
