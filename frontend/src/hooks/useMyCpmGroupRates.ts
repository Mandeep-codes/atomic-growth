import { useAuth } from "@/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import type { inferRouterOutputs } from "@trpc/server";
import { useMemo } from "react";
import type { AppRouter } from "../../../backend/src/routers";

type RouterOutput = inferRouterOutputs<AppRouter>;
export type MyCpmGroupRate =
  RouterOutput["campaigns"]["getMyCpmGroupRates"][number];

/**
 * The logged-in clipper's per-campaign CPM group rates, keyed by campaign id.
 *
 * Fetch once per page and look cards up by campaign id. The endpoint is
 * protected, so the query only runs when a user is signed in; logged-out
 * views (and errors) simply resolve to an empty map — no effects rendered.
 */
export const useMyCpmGroupRates = () => {
  const { user } = useAuth();
  const { data } = trpc.campaigns.getMyCpmGroupRates.useQuery(undefined, {
    enabled: Boolean(user),
  });

  return useMemo(() => {
    const map = new Map<string, MyCpmGroupRate>();
    for (const rate of data ?? []) {
      map.set(rate.campaignId, rate);
    }
    return map;
  }, [data]);
};
