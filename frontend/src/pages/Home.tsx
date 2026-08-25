import { ActiveCampaignsSection } from "@/components/ActiveCampaignsSection";
import { AppLayout } from "@/components/AppLayout";
import { CampaignDetailDialog } from "@/components/CampaignDetailDialog";
import { Leaderboard } from "@/components/dashboard/Leaderboard";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Avatar, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AnnouncementsPanel } from "@/components/dashboard/AnnouncementsPanel";
import { ClaimableWidget } from "@/components/dashboard/ClaimableWidget";
import { CreatorStats } from "@/components/dashboard/CreatorStats";
import { TopClipsBoard } from "@/components/dashboard/TopClipsBoard";
import { DashboardSection } from "@/components/dashboard/DashboardSection";
// The /demographics-verification route serves the LIST. DemographicsVerification
// is the :id router and needs a route param, so inlined here it only ever
// rendered "Invalid verification".
import Earnings from "@/pages/Earnings";
import { NotificationsSpotlight } from "@/components/dashboard/notifications/NotificationsSpotlight";
import { useAuth } from "@/hooks/useAuth";
import { useCampaignsData } from "@/hooks/useCampaignsData";
import { ALL_TIME_LEADERBOARD_ID } from "@/hooks/useSubmissionsData";
import { trackEvent } from "@/lib/analytics";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { SignInButton, SignUpButton } from "@clerk/clerk-react";
import type { inferRouterOutputs } from "@trpc/server";
import {
  AlertTriangle,
  ArrowRight,
  Loader2,
  Megaphone,
  Trophy,
  X,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ReactNode, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { AppRouter } from "../../../backend/src/routers";

type BanStatusMetadata = {
  reason: string | null;
  createdAt: string | null;
  createdBy: string | null;
} | null;

const Home = () => {
  const { data: campaigns, isLoading, error } = useCampaignsData();
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(
    null
  );
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const { user, loading: isUserLoading } = useAuth();
  const currentYear = new Date().getFullYear();

  const activeCampaigns = useMemo(
    () => (campaigns ?? []).filter((campaign) => campaign.active),
    [campaigns]
  );

  const [dismissedAnnouncementIds, setDismissedAnnouncementIds] = useState<
    string[]
  >([]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const stored = window.localStorage.getItem("dismissedAnnouncements");
    if (!stored) {
      return;
    }
    try {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        setDismissedAnnouncementIds(
          parsed.filter((value) => typeof value === "string")
        );
      }
    } catch (error) {
      console.warn("Failed to parse dismissed announcements", error);
    }
  }, []);

  const notificationsEnabled = Boolean(user);
  const {
    data: notificationsData = [],
    isLoading: notificationsLoading,
    error: notificationsError,
  } = trpc.notifications.getMyNotifications.useQuery(undefined, {
    enabled: notificationsEnabled,
  });

  const {
    data: announcementsData = [],
    isLoading: announcementsLoading,
    error: announcementsError,
  } = trpc.notifications.getAnnouncements.useQuery(undefined, {
    enabled: notificationsEnabled,
  });

  const notifications = user ? notificationsData.slice(0, 10) : [];
  const banStatus =
    (user?.publicMetadata?.banStatus as BanStatusMetadata) ?? null;
  const banEffectiveDate = banStatus?.createdAt
    ? new Date(banStatus.createdAt)
    : null;

  const dismissedAnnouncements = useMemo(() => {
    return new Set(dismissedAnnouncementIds);
  }, [dismissedAnnouncementIds]);

  const announcement =
    user && !announcementsLoading && !announcementsError
      ? announcementsData.find(
        (entry) => !dismissedAnnouncements.has(entry.id)
      ) ?? null
      : null;

  const handleDismissAnnouncement = (announcementId: string) => {
    setDismissedAnnouncementIds((prev) => {
      if (prev.includes(announcementId)) {
        return prev;
      }
      const next = [...prev, announcementId];
      if (typeof window !== "undefined") {
        window.localStorage.setItem(
          "dismissedAnnouncements",
          JSON.stringify(next)
        );
      }
      return next;
    });
  };

  const wrapWithLayout = (content: ReactNode) => {
    return <AppLayout>{content}</AppLayout>;
  };

  if (error) {
    return wrapWithLayout(
      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex items-center justify-center py-12">
          <p className="text-destructive">Failed to load campaigns</p>
        </div>
      </div>
    );
  }

  if (isUserLoading) {
    return wrapWithLayout(
      <div className="flex items-center justify-center py-12">
        <div className="flex items-center gap-2">
          <Loader2 className="h-6 w-6 animate-spin" />
          <span className="text-muted-foreground">Loading campaigns...</span>
        </div>
      </div>
    );
  }

  return wrapWithLayout(
    <>
      <div className="max-w-6xl mx-auto px-6 py-6 space-y-6">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-2 w-full">
            {/* Heading removed: it filled the entire first screen with a
                greeting and no information. Announcements and stats start at
                the top of the viewport instead. The ban alert below stays -
                it is the one thing that must interrupt. */}
            <div className="space-y-4">
              {banStatus ? (
                <Alert variant="destructive">
                  <AlertTitle>Your account is banned</AlertTitle>
                  <AlertDescription>
                    {banStatus.reason
                      ? banStatus.reason
                      : "You cannot submit clips right now."}
                    {banEffectiveDate ? (
                      <> • Banned on {banEffectiveDate.toLocaleString()}</>
                    ) : null}
                  </AlertDescription>
                </Alert>
              ) : null}
              {/* The dismissible banner that used to sit here showed the newest
                  announcement — the same row the Announcements panel below
                  already leads with. So the top of the dashboard printed the
                  same headline and the same body twice, a few hundred pixels
                  apart, and dismissing one did nothing to the other.
                  The panel is the one that stays: it holds ALL announcements,
                  not just the newest, so nothing is lost by dropping this. */}
              {user &&
                !notificationsLoading &&
                !notificationsError &&
                notifications.length > 0 ? (
                <NotificationsSpotlight notifications={notifications} />
              ) : null}
            </div>
          </div>
          {!user && (
            <div className="flex items-center gap-3">
              <SignUpButton mode="modal">
                <Button variant="outline" size="lg">
                  Sign Up
                </Button>
              </SignUpButton>
              <SignInButton mode="modal">
                <Button size="lg">Sign In</Button>
              </SignInButton>
            </div>
          )}
        </div>
        {/* Announcements get their own section rather than the single
            dismissible banner that used to sit in the header: the old one
            showed one post and hid the rest, so nothing older was reachable. */}
        <AnnouncementsPanel />

        {/* Moved up from the bottom of the page. These four numbers are the
            answer to "how am I doing" — the first thing a clipper looks for —
            and they were sitting below the campaigns, the leaderboard and the
            fold. */}
        <CreatorStats />

        {/* Bento layout from the redesign: campaigns take the wide column,
            and the money — the thing clippers actually open the app for —
            gets a fixed rail beside them instead of living below the fold. */}
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
          <div className="space-y-6 lg:col-span-8">
            <ActiveCampaignsSection
              campaigns={campaigns ?? []}
              onSelectCampaign={(campaign) => {
                setSelectedCampaign(campaign);
                setIsDialogOpen(true);
              }}
              isLoading={isLoading}
            />
          </div>
          <div className="space-y-6 lg:col-span-4">
            <ClaimableWidget />
          </div>
        </div>

        {/* Was three quick-link cards in the right rail — Join Discord, Add
            clips, Earnings. All three only pointed at places already reachable:
            Discord sits in the footer, "Add clips" went to the campaign list
            right beside it, and Earnings is both in the nav and a full section
            further down this same page. So the rail was spending its most
            valuable space on links to things already on screen.

            The leaderboard takes that space instead. It was already on this
            page, just pushed below the stats where nobody scrolled to it, and
            it already carries the campaign filter — All plus one control per
            campaign — so the top clip of any single campaign can be read from
            here. Moved up rather than rebuilt: same component, same procedures,
            same site-setting gate. It renders full width because the clip grid
            and the earners table cannot breathe in the narrow rail. */}
        <TopClipsBoard />

        {/* CreatorStats moved to the top. MyStatsSection is gone entirely: it
            printed Posts / Total views / Total earned, which are the same three
            numbers CreatorStats already shows as Clips submitted / Views
            generated / Revenue earned — the same figures twice on one page,
            under two different headings, inviting the reader to work out
            whether they disagreed. */}
      </div>

      {/* ── Everything else, inline ──
          Clippers have no navigation drawer, so the surfaces that used to be
          separate routes are stacked here as sections. Each is the real page
          component: AppLayout no-ops when nested, so they render bare while
          their own /earnings, /submissions … routes keep working for deep
          links and for anything that redirects to them. */}
      <div className="mx-auto max-w-6xl space-y-4 px-6 pb-10">
        <DashboardSection title="Earnings">
          <Earnings />
        </DashboardSection>
        {/* Social verification, Demographics, Receive payments and Referrals
            were all stacked here as well as living on /profile — the same
            screens twice, so connecting an account or filing a report could be
            started from two places and neither knew about the other. They stay
            on the profile, which is where account-level settings belong; the
            dashboard keeps campaigns, money and stats. */}
      </div>

      <footer className="max-w-6xl mx-auto px-6 pb-8">
        <div className="border-t border-border/60 pt-6 text-xs text-muted-foreground sm:flex sm:items-center sm:justify-between sm:text-sm">
          <div className="flex flex-col">
            <span>© {currentYear} Atomik Clips</span>
            {/* Deploy canary — bump this string in the PR whose deploy you
                want to confirm. Seeing it on https://app.atomikgrowth.com
                proves the new bundle is live (no DevTools required). */}
            <span className="text-[10px] opacity-70">v3.55</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-4 sm:mt-0">
            <Link to="/privacy" className="underline-offset-4 hover:underline">
              Privacy Policy
            </Link>
            <a
              href="https://atomikgrowth.com"
              target="_blank"
              rel="noreferrer"
              className="underline-offset-4 hover:underline"
            >
              Visit atomikgrowth.com
            </a>
          </div>
        </div>
      </footer>

      <CampaignDetailDialog
        open={isDialogOpen}
        campaign={selectedCampaign}
        onOpenChange={(open) => {
          setIsDialogOpen(open);
          if (!open) {
            setSelectedCampaign(null);
          }
        }}
        actionLabel="Add Clip"
      />
    </>
  );
};

type NotificationsRouterOutput = inferRouterOutputs<AppRouter>["notifications"];
type Announcement = NotificationsRouterOutput["getAnnouncements"][number];

const announcementTone = {
  announcement: {
    label: "Announcement",
    icon: Megaphone,
    badgeClassName: "bg-primary/10 text-primary",
    iconWrapperClassName: "text-primary",
  },
  "issue-alert": {
    label: "Issue alert",
    icon: AlertTriangle,
    badgeClassName:
      "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200",
    iconWrapperClassName: "text-amber-500 dark:text-amber-200",
  },
} as const;

const AnnouncementBanner = ({
  announcement,
  onDismiss,
}: {
  announcement: Announcement;
  onDismiss: () => void;
}) => {
  const metadata = announcement.metadata;
  const tone =
    announcementTone[metadata.type] ?? announcementTone["announcement"];
  const Icon = tone.icon;
  const publishedLabel = formatDistanceToNow(new Date(announcement.createdAt), {
    addSuffix: true,
  });

  return (
    <Card className="border border-dashed border-border/70 bg-background/80 shadow-none">
      <CardContent className="flex gap-4 p-4">
        <div
          className={cn(
            "flex h-12 w-12 items-center justify-center rounded-2xl bg-muted/80",
            tone.iconWrapperClassName
          )}
        >
          <Icon className="h-5 w-5" />
        </div>
        <div className="flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={tone.badgeClassName}>{tone.label}</Badge>
            <span className="text-xs text-muted-foreground">
              {publishedLabel}
            </span>
          </div>
          <p className="text-base font-semibold text-foreground">
            {announcement.title}
          </p>
          <p className="text-sm text-muted-foreground">
            {announcement.description}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onDismiss}
          aria-label="Dismiss announcement"
          className="text-muted-foreground"
        >
          <X className="h-4 w-4" />
        </Button>
      </CardContent>
    </Card>
  );
};


type RouterOutput = inferRouterOutputs<AppRouter>;
type Campaign = RouterOutput["campaigns"]["getAll"][number];
type LeaderboardCampaignOption = {
  id: string;
  title: string;
  imageUrl?: string | null;
  isAllTime?: boolean;
};

const LeaderboardSection = ({
  activeCampaigns,
}: {
  activeCampaigns: Campaign[];
}) => {
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(
    null
  );

  const leaderboardOptions: LeaderboardCampaignOption[] = useMemo(() => {
    const campaignOptions = activeCampaigns.map((campaign) => ({
      id: campaign.id,
      title: campaign.title || "Untitled Campaign",
      imageUrl: campaign.imageUrl,
    }));

    return [
      {
        id: ALL_TIME_LEADERBOARD_ID,
        title: "All Time",
        imageUrl: null,
        isAllTime: true,
      },
      ...campaignOptions,
    ];
  }, [activeCampaigns]);

  useEffect(() => {
    if (!selectedCampaignId && leaderboardOptions.length > 0) {
      setSelectedCampaignId(leaderboardOptions[0]!.id);
      return;
    }

    if (
      selectedCampaignId &&
      !leaderboardOptions.some((campaign) => campaign.id === selectedCampaignId)
    ) {
      setSelectedCampaignId(leaderboardOptions[0]?.id ?? null);
    }
  }, [leaderboardOptions, selectedCampaignId]);

  const handleCampaignSelectForLeaderboard = (
    campaign: LeaderboardCampaignOption
  ) => {
    setSelectedCampaignId(campaign.id);
    trackEvent({
      event: "dashboard_leaderboard_campaign_selected",
      properties: {
        campaignId: campaign.id,
        campaignTitle: campaign.title,
        isAllTime: campaign.isAllTime,
      },
    });
  };

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-foreground">Leaderboard</h2>
        <p className="text-sm text-muted-foreground">
          Select a campaign to see top performers
        </p>
      </div>
      {leaderboardOptions.length > 0 ? (
        <>
          <div className="flex flex-wrap gap-2">
            {leaderboardOptions.map((campaign) => (
              <button
                key={campaign.id}
                type="button"
                onClick={() => handleCampaignSelectForLeaderboard(campaign)}
                className={cn(
                  "rounded-full border px-4 py-2 text-sm font-medium transition-colors",
                  selectedCampaignId === campaign.id
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border/60 bg-muted/60 text-muted-foreground hover:bg-muted"
                )}
              >
                <div className="flex items-center gap-2">
                  {campaign.isAllTime ? (
                    <Avatar className="size-5">
                      <div className="flex h-full w-full items-center justify-center rounded-full bg-primary/10 text-primary">
                        <Trophy className="h-3 w-3" />
                      </div>
                    </Avatar>
                  ) : (
                    <Avatar className="size-5">
                      <AvatarImage src={campaign.imageUrl ?? undefined} />
                    </Avatar>
                  )}
                  {campaign.title}
                </div>
              </button>
            ))}
          </div>

          {selectedCampaignId ? (
            <Leaderboard campaignId={selectedCampaignId} />
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>No campaign selected</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Pick an active campaign to load the leaderboard.
                </p>
              </CardContent>
            </Card>
          )}
        </>
      ) : null}
    </section>
  );
};

export default Home;
