import { trpc } from "@/lib/trpc";
import { useRole } from "@/hooks/useRole";

type CampaignQueryOptions = Parameters<
  typeof trpc.campaigns.getById.useQuery
>[1];

export const useCampaignData = (
  campaignId: string,
  category?: string,
  options?: CampaignQueryOptions
) => {
  return trpc.campaigns.getById.useQuery(
    {
      id: campaignId,
      category,
    },
    {
      enabled: !!campaignId,
      ...options,
    }
  );
};

// getById teaser-strips private campaigns; admin pages (edit form, stats)
// need the real row — the edit form would otherwise save cover values over
// the real ones. Requires the campaign-editor role.
export const useAdminCampaignData = (
  campaignId: string,
  category?: string,
  options?: CampaignQueryOptions
) => {
  return trpc.campaigns.getByIdAdmin.useQuery(
    {
      id: campaignId,
      category,
    },
    {
      enabled: !!campaignId,
      ...options,
    }
  );
};

// Real row for a client viewing their own password-protected dashboard: they
// hold no role, so getByIdAdmin is closed to them, and plain getById would
// teaser-strip their own campaign down to zeros. The password is re-checked
// server-side on every call.
export const useUnlockedCampaignData = (
  campaignId: string,
  password: string | null,
  category?: string,
  options?: Parameters<typeof trpc.campaigns.getByIdUnlocked.useQuery>[1]
) => {
  return trpc.campaigns.getByIdUnlocked.useQuery(
    {
      id: campaignId,
      category,
      password: password ?? undefined,
    },
    {
      enabled: !!campaignId && !!password,
      ...options,
    }
  );
};

// THE source for the campaign dashboard. Picks whichever endpoint the viewer
// is entitled to — staff by role, the client by campaign password, everyone
// else the teaser — so every part of the page (title, header, metric cards)
// renders one consistent view of the campaign.
//
// Keeping this in one place matters: when only the cards were routed here the
// header kept reading the stripped row, so a private campaign's dashboard
// showed real numbers under its pre-application cover title ("Secret AI Tech
// Campaign" instead of "Nyne AI").
export const useDashboardCampaignData = (
  campaignId: string,
  category?: string,
  unlockPassword?: string | null
) => {
  const { roles } = useRole();
  const isEditor = roles.includes("campaign-editor");
  const useUnlocked = !isEditor && Boolean(unlockPassword);

  const adminQuery = useAdminCampaignData(campaignId, category, {
    enabled: isEditor && Boolean(campaignId),
  });
  const unlockedQuery = useUnlockedCampaignData(
    campaignId,
    useUnlocked ? unlockPassword ?? null : null,
    category
  );
  const publicQuery = useCampaignData(campaignId, category, {
    enabled: !isEditor && !useUnlocked && Boolean(campaignId),
  });

  return isEditor ? adminQuery : useUnlocked ? unlockedQuery : publicQuery;
};
