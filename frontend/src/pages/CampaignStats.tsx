import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Award, BarChart3, Loader2, Sparkles } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { trpc } from "@/lib/trpc";
import { cn, formatPlatformLabel } from "@/lib/utils";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../backend/src/routers";
import { Demographics } from "@/components/dashboard/Demographics";
import { CampaignGeoRulesManager } from "@/components/CampaignGeoRulesManager";
import { SubmissionTrends } from "@/components/dashboard/SubmissionTrends";

const statusPriority: Record<string, number> = {
  approved: 0,
  rejected: 1,
  pending: 2,
  unknown: 3,
};

const statusBadgeStyles: Record<string, string> = {
  approved:
    "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-100 dark:border-emerald-800/60",
  rejected:
    "bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-900/40 dark:text-rose-100 dark:border-rose-800/60",
  pending:
    "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/40 dark:text-amber-100 dark:border-amber-800/60",
  unknown: "bg-muted text-muted-foreground border-muted-foreground/20",
};

const formatStatusLabel = (status: string) =>
  status.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());

type RouterOutput = inferRouterOutputs<AppRouter>;
type ReviewerPerformance =
  RouterOutput["campaigns"]["getReviewPerformance"][number];
type CampaignImpact = RouterOutput["campaigns"]["getCampaignImpact"];
type TopClippers = RouterOutput["campaigns"]["getTopClippers"];
type ClipperPerformance = TopClippers["byViews"][number];

const getDisplayName = (reviewer: ReviewerPerformance) => {
  if (reviewer.discordUsername) return `@${reviewer.discordUsername}`;
  if (reviewer.firstName) return reviewer.firstName;
  if (reviewer.reviewerId === "unknown") return "Unassigned";
  return reviewer.reviewerId;
};

const getAvatarFallback = (reviewer: ReviewerPerformance) => {
  const source =
    reviewer.discordUsername ||
    reviewer.firstName ||
    (reviewer.reviewerId !== "unknown" ? reviewer.reviewerId : null);
  if (!source) return "?";
  return (
    source
      .replace(/[^a-zA-Z0-9]/g, "")
      .slice(0, 2)
      .toUpperCase() || "?"
  );
};

const getClipperDisplayName = (clipper: ClipperPerformance) => {
  if (clipper.discordUsername) return `@${clipper.discordUsername}`;
  if (clipper.firstName) return clipper.firstName;
  return clipper.userId === "unknown" ? "Unknown clipper" : clipper.userId;
};

const getClipperAvatarFallback = (clipper: ClipperPerformance) => {
  const source = clipper.discordUsername || clipper.firstName || clipper.userId;
  return (
    source
      .replace(/[^a-zA-Z0-9]/g, "")
      .slice(0, 2)
      .toUpperCase() || "?"
  );
};

const CampaignStats = () => {
  const params = useParams<{ campaignId: string }>();
  const campaignId = params.campaignId ?? "";
  const hasCampaignId = Boolean(params.campaignId);

  const {
    data: reviewPerformance,
    isLoading,
    error,
  } = trpc.campaigns.getReviewPerformance.useQuery(
    { campaignId },
    { enabled: hasCampaignId }
  );

  const {
    data: campaignImpact,
    isLoading: isImpactLoading,
    error: impactError,
  } = trpc.campaigns.getCampaignImpact.useQuery(
    { campaignId },
    { enabled: hasCampaignId }
  );

  const {
    data: topClippers,
    isLoading: isTopClippersLoading,
    error: topClippersError,
  } = trpc.campaigns.getTopClippers.useQuery(
    { campaignId },
    { enabled: hasCampaignId }
  );

  const { data: campaignDetails, isLoading: isCampaignDetailsLoading } =
    trpc.campaigns.getByIdAdmin.useQuery(
      { id: campaignId },
      { enabled: hasCampaignId }
    );

  const demographicsData = campaignDetails?.campaign?.demographics_json;
  const demographicsVisibleCountries =
    campaignDetails?.campaign?.demographicsVisibleCountries ?? null;
  const shouldShowDemographicsCard =
    hasCampaignId && (isCampaignDetailsLoading || Boolean(demographicsData));

  const totalReviews = reviewPerformance?.reduce(
    (sum, reviewer) => sum + reviewer.totalReviewed,
    0
  );

  return (
    <AppLayout>
      <div className="mx-auto px-6 py-10 space-y-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
              Internal Insights
            </p>
            <h1 className="text-3xl font-semibold text-foreground">
              Campaign Stats
            </h1>
            <p className="text-sm text-muted-foreground">
              Track moderator throughput and other internal signals for this
              campaign.
            </p>
          </div>
          <Button variant="outline" asChild>
            <Link to={`/campaign/${campaignId}/edit`}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Edit
            </Link>
          </Button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card className="border-dashed">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-muted-foreground" />
                Approved submission impact
              </CardTitle>
              <CardDescription>
                Snapshot of approved clips, delivered views, and unique creators
                across each platform.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!hasCampaignId ? (
                <div className="text-sm text-muted-foreground">
                  Missing campaign identifier. Try reloading the page.
                </div>
              ) : isImpactLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading aggregate stats...
                </div>
              ) : impactError ? (
                <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                  Unable to load stats: {impactError.message}
                </div>
              ) : !campaignImpact || campaignImpact.totals.clips === 0 ? (
                <div className="text-sm text-muted-foreground">
                  No approved submissions yet. As soon as clips are approved,
                  totals and platform breakdowns will be displayed here.
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="grid gap-4 sm:grid-cols-3">
                    <div className="rounded-2xl border border-border/60 bg-background/70 p-4">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">
                        Views delivered
                      </p>
                      <p className="mt-2 text-2xl font-semibold">
                        {campaignImpact.totals.views.toLocaleString()}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-border/60 bg-background/70 p-4">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">
                        Approved clips
                      </p>
                      <p className="mt-2 text-2xl font-semibold">
                        {campaignImpact.totals.clips.toLocaleString()}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-border/60 bg-background/70 p-4">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">
                        Unique clippers
                      </p>
                      <p className="mt-2 text-2xl font-semibold">
                        {campaignImpact.totals.clippers.toLocaleString()}
                      </p>
                    </div>
                  </div>

                  <div>
                    <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
                      Platform contributions
                    </p>
                    {campaignImpact.platforms.length === 0 ? (
                      <p className="mt-3 text-sm text-muted-foreground">
                        We have not recorded platform-specific submissions yet.
                      </p>
                    ) : (
                      <div className="mt-3 space-y-2">
                        {campaignImpact.platforms.map((platform) => (
                          <div
                            key={platform.platform || "unknown"}
                            className="flex flex-col gap-2 rounded-2xl border border-border/60 bg-muted/40 p-4 sm:flex-row sm:items-center sm:justify-between"
                          >
                            <div>
                              <p className="text-sm font-medium">
                                {formatPlatformLabel(platform.platform)}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {platform.clips.toLocaleString()} clips ·{" "}
                                {platform.clippers.toLocaleString()} clippers
                              </p>
                            </div>
                            <div className="text-sm font-semibold">
                              {platform.views.toLocaleString()} views
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <SubmissionTrends campaignId={campaignId} />

          <Card className="border-dashed">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Award className="h-5 w-5 text-muted-foreground" />
                Top performing clippers
              </CardTitle>
              <CardDescription>
                Recognize the creators delivering the most views and clips for
                this campaign.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!hasCampaignId ? (
                <div className="text-sm text-muted-foreground">
                  Missing campaign identifier. Try reloading the page.
                </div>
              ) : isTopClippersLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading clipper stats...
                </div>
              ) : topClippersError ? (
                <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                  Unable to load stats: {topClippersError.message}
                </div>
              ) : !topClippers ||
                (topClippers.byViews.length === 0 &&
                  topClippers.byClips.length === 0) ? (
                <div className="text-sm text-muted-foreground">
                  No approved submissions yet. Once clippers begin delivering
                  views, their performance will be highlighted here.
                </div>
              ) : (
                <div className="grid gap-6 md:grid-cols-2">
                  <div>
                    <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
                      By views delivered
                    </p>
                    {topClippers.byViews.length === 0 ? (
                      <p className="mt-3 text-sm text-muted-foreground">
                        No view data yet.
                      </p>
                    ) : (
                      <div className="mt-3 space-y-3">
                        {topClippers.byViews.map((clipper) => (
                          <div
                            key={`views-${clipper.userId}`}
                            className="flex items-center justify-between rounded-2xl border border-border/60 bg-background/60 p-3"
                          >
                            <div className="flex items-center gap-3">
                              <Avatar className="h-10 w-10">
                                <AvatarImage
                                  src={clipper.avatarUrl ?? undefined}
                                />
                                <AvatarFallback className="text-xs font-semibold">
                                  {getClipperAvatarFallback(clipper)}
                                </AvatarFallback>
                              </Avatar>
                              <div>
                                <p className="text-sm font-medium leading-tight">
                                  {getClipperDisplayName(clipper)}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {clipper.clipCount.toLocaleString()} clips
                                </p>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="text-sm font-semibold">
                                {clipper.viewCount.toLocaleString()}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                views
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
                      By clips submitted
                    </p>
                    {topClippers.byClips.length === 0 ? (
                      <p className="mt-3 text-sm text-muted-foreground">
                        No clip submission data yet.
                      </p>
                    ) : (
                      <div className="mt-3 space-y-3">
                        {topClippers.byClips.map((clipper) => (
                          <div
                            key={`clips-${clipper.userId}`}
                            className="flex items-center justify-between rounded-2xl border border-border/60 bg-background/60 p-3"
                          >
                            <div className="flex items-center gap-3">
                              <Avatar className="h-10 w-10">
                                <AvatarImage
                                  src={clipper.avatarUrl ?? undefined}
                                />
                                <AvatarFallback className="text-xs font-semibold">
                                  {getClipperAvatarFallback(clipper)}
                                </AvatarFallback>
                              </Avatar>
                              <div>
                                <p className="text-sm font-medium leading-tight">
                                  {getClipperDisplayName(clipper)}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {clipper.viewCount.toLocaleString()} views
                                </p>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="text-sm font-semibold">
                                {clipper.clipCount.toLocaleString()}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                approved clips
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {shouldShowDemographicsCard && (
            <Demographics
              demographics={demographicsData}
              visibleCountries={demographicsVisibleCountries}
              isLoading={isCampaignDetailsLoading}
            />
          )}

          <Card className="border-dashed">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-muted-foreground" />
                Moderator review performance
              </CardTitle>
              <CardDescription>
                {hasCampaignId
                  ? totalReviews && totalReviews > 0
                    ? `${totalReviews.toLocaleString()} decisions recorded across all moderators.`
                    : "As soon as mods begin reviewing, their decisions will appear here."
                  : "Provide a campaign ID to load review performance."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!hasCampaignId ? (
                <div className="text-sm text-muted-foreground">
                  Missing campaign identifier. Try reloading the page.
                </div>
              ) : isLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading moderator stats...
                </div>
              ) : error ? (
                <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                  Unable to load stats: {error.message}
                </div>
              ) : !reviewPerformance || reviewPerformance.length === 0 ? (
                <div className="text-sm text-muted-foreground">
                  No completed reviews have been recorded for this campaign yet.
                </div>
              ) : (
                <div className="space-y-4">
                  {reviewPerformance.map((reviewer) => (
                    <div
                      key={reviewer.reviewerId}
                      className="flex flex-col gap-3 rounded-2xl border border-border/60 bg-background/60 p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="flex items-center gap-3">
                        <Avatar className="h-11 w-11">
                          <AvatarImage src={reviewer.avatarUrl ?? undefined} />
                          <AvatarFallback className="text-xs font-semibold">
                            {getAvatarFallback(reviewer)}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="text-sm font-medium leading-tight">
                            {getDisplayName(reviewer)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {reviewer.totalReviewed.toLocaleString()} total
                            reviews
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {Object.entries(reviewer.statusBreakdown)
                          .sort((a, b) => {
                            const priorityA = statusPriority[a[0]] ?? 50;
                            const priorityB = statusPriority[b[0]] ?? 50;
                            if (priorityA !== priorityB) {
                              return priorityA - priorityB;
                            }
                            return b[1] - a[1];
                          })
                          .map(([status, count]) => (
                            <Badge
                              key={`${reviewer.reviewerId}-${status}`}
                              variant="secondary"
                              className={cn(
                                "border px-2.5 py-1 text-xs font-medium",
                                statusBadgeStyles[status] ||
                                  statusBadgeStyles.unknown
                              )}
                            >
                              {formatStatusLabel(status)} · {count}
                            </Badge>
                          ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Read-only geo view: who qualifies, who just dropped out, and what
              the hold/clearance did with each account's money. Criteria are
              authored on the Edit page, so the controls are hidden here. */}
          {campaignId && (
            <CampaignGeoRulesManager campaignId={campaignId} readOnly />
          )}
        </div>
      </div>
    </AppLayout>
  );
};

export default CampaignStats;
