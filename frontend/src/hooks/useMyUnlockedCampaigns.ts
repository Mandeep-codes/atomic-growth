import { useAuth } from "@/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import type { inferRouterOutputs } from "@trpc/server";
import { useMemo } from "react";
import type { AppRouter } from "../../../backend/src/routers";

type RouterOutput = inferRouterOutputs<AppRouter>;
export type MyUnlockedCampaign =
  RouterOutput["privateCampaigns"]["myUnlockedCampaigns"][number];

/**
 * The private campaigns the logged-in clipper is approved into, keyed by
 * campaign id, carrying the real card fields the getAll teaser strip hid.
 *
 * Fetch once per page and overlay by campaign id. The endpoint is
 * protected, so the query only runs when a user is signed in; logged-out
 * views (and errors) resolve to an empty map and the teaser stands.
 *
 * `isPending` is true only while a signed-in user's unlock check is still
 * in flight — consumers hold the grid on its skeleton for that beat so
 * approved clippers never see the teaser flash before the real card.
 */
export const useMyUnlockedCampaigns = () => {
  const { user } = useAuth();
  const query = trpc.privateCampaigns.myUnlockedCampaigns.useQuery(undefined, {
    enabled: Boolean(user),
    // isPending holds the whole grid skeleton, so don't sit through the
    // default 3-retry backoff (~7s) for an auxiliary query — one retry,
    // then degrade to the teaser.
    retry: 1,
  });

  const map = useMemo(() => {
    const result = new Map<string, MyUnlockedCampaign>();
    for (const campaign of query.data ?? []) {
      result.set(campaign.campaignId, campaign);
    }
    return result;
  }, [query.data]);

  // v4 quirk: a disabled query still reports isLoading=true, so gate on
  // isInitialLoading (loading AND actually fetching) for logged-out users.
  return { map, isPending: Boolean(user) && query.isInitialLoading };
};
