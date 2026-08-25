import { Link } from "react-router-dom";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import type { AppRouter } from "../../../backend/src/routers";
import type { inferRouterOutputs } from "@trpc/server";
import { timeAgo } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import { Instagram, Music2, Twitter, Youtube } from "lucide-react";
import { trackEvent } from "@/lib/analytics";
import { formatCurrency } from "@/lib/formatCurrency";
import { trpc } from "@/lib/trpc";
import { PrivateCampaignApplySection } from "@/components/PrivateCampaignApplySection";

type RouterOutput = inferRouterOutputs<AppRouter>;
// unlockedForMe rides in from useCampaignsData: the row was already
// unlock-merged for this approved clipper, so the budget/rates it carries
// are real — don't flash the locked treatment while getApplicationState
// round-trips.
export type CampaignDetail = RouterOutput["campaigns"]["getAll"][number] & {
  unlockedForMe?: boolean;
};

interface CampaignDetailDialogProps {
  campaign: CampaignDetail | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actionLabel?: string;
}

const getInitials = (title: string | null | undefined) => {
  if (!title) return "C";
  const words = title.trim().split(" ");
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return `${words[0]![0] ?? "C"}${words[1]?.[0] ?? ""}`.toUpperCase();
};

const formatViews = (views: number | null | undefined) => {
  const value = views ?? 0;
  return new Intl.NumberFormat("en-US").format(Math.max(0, Math.round(value)));
};

const formatPerMillion = (ratePerThousand: number | null | undefined) => {
  const value = ratePerThousand ?? 0;
  return formatCurrency(value * 1000);
};

const dailyCpmBoostTiers = [
  {
    label: "Flameholder",
    range: "Most views yesterday",
    boost: 0.1,
    image: "/images/hot-streak-flameholder.svg",
  },
  {
    label: "Heatwave",
    range: "Next two view leaders",
    boost: 0.05,
    image: "/images/hot-streak-heatwave.svg",
  },
  {
    label: "Embers",
    range: "Remaining top creators",
    boost: 0.03,
    image: "/images/hot-streak-embers.svg",
  },
];

export const CampaignDetailDialog = ({
  campaign,
  open,
  onOpenChange,
  actionLabel = "Add clip",
}: CampaignDetailDialogProps) => {
  const isPrivate = campaign?.visibility === "private";

  // For private campaigns: the clipper's application state, plus the real
  // values behind the teaser once they're approved.
  const applicationQuery = trpc.privateCampaigns.getApplicationState.useQuery(
    { campaignId: campaign?.id ?? "" },
    { enabled: open && Boolean(campaign) && isPrivate }
  );
  const application = applicationQuery.data?.application ?? null;
  const unlocked = applicationQuery.data?.unlocked ?? null;
  const isApproved = application?.status === "approved";

  const unlockedForMe = Boolean(campaign?.unlockedForMe);
  const submissionsPaused = Boolean(
    (campaign as { submissions_paused?: boolean | null } | null)
      ?.submissions_paused
  );
  const pausedNotice = (
    <div className="flex h-12 w-full items-center justify-center rounded-full bg-amber-500/15 text-sm font-semibold text-amber-700">
      Not accepting submissions right now
    </div>
  );
  const hideBudget =
    isPrivate && !campaign?.private_show_budget && !unlocked && !unlockedForMe;
  const hideRates =
    isPrivate && !campaign?.private_show_rates && !unlocked && !unlockedForMe;
  // Approved clippers see the real identity behind a teaser name/image.
  const displayTitle = unlocked?.title ?? campaign?.title;
  const displayImageUrl = unlocked?.imageUrl ?? campaign?.imageUrl;
  const displayBudget = unlocked?.budget ?? campaign?.budget ?? 0;
  const displayMinPayout = unlocked?.min_payout ?? campaign?.min_payout ?? 0;

  // max_payout is a PERCENTAGE of the bounty (CampaignEdit labels it "Max
  // Payout (% of bounty)"). Admins have always set it; no clipper-facing screen
  // has ever read it, so the cap on a single clip was invisible. Resolve it to
  // money here rather than making anyone do the arithmetic.
  const maxPayoutPct = unlocked?.max_payout ?? campaign?.max_payout ?? 0;
  const maxPayoutValue = (displayBudget * maxPayoutPct) / 100;

  // Clippers filter hard on this - a nearly-drained campaign means posting for
  // nothing. achievementPercentage is how much has been PAID OUT, so remaining
  // is its complement.
  const budgetLeftPct = Math.max(
    0,
    Math.min(100, 100 - (Number(campaign?.achievementPercentage) || 0))
  );
  // View requirements have their own reveal toggle: a private campaign can
  // hide its CPM rates but still show how many views are needed.
  const hideMinViews =
    isPrivate &&
    !campaign?.private_show_rates &&
    !campaign?.private_show_min_views &&
    !unlocked &&
    !unlockedForMe;
  // Per-clip floors (clips below don't count/earn).
  const rawFloors = [
    {
      label: "YouTube",
      value: unlocked?.youtube_min_views ?? campaign?.youtube_min_views ?? 0,
    },
    {
      label: "Instagram",
      value: unlocked?.insta_min_views ?? campaign?.insta_min_views ?? 0,
    },
    {
      label: "X",
      value: unlocked?.x_min_views ?? campaign?.x_min_views ?? 0,
    },
    {
      label: "TikTok",
      value: unlocked?.tiktok_min_views ?? campaign?.tiktok_min_views ?? 0,
    },
  ];
  const displayFloors = rawFloors.filter((f) => f.value > 0);
  // A single unqualified "N per clip" is only honest when ALL platforms
  // share the floor — e.g. TikTok at 0 while the rest are 1500 must show
  // the breakdown, or TikTok clippers are told their clips don't count.
  const floorsAllEqual =
    displayFloors.length > 0 &&
    rawFloors.every((f) => f.value === rawFloors[0]!.value);
  const paymentMethodLabels: Record<string, string> = {
    bank: "Bank transfer",
    crypto: "Crypto",
    paypal: "PayPal",
  };
  const paymentMethods = (campaign?.payment_methods ?? []).filter(
    (m): m is string => typeof m === "string" && m in paymentMethodLabels
  );
  const displayDescription = unlocked?.description ?? campaign?.description;
  const displaySopEmbedUrl = unlocked?.sopEmbedUrl ?? campaign?.sopEmbedUrl;

  const campaignLevels = (campaign?.levels ?? [])
    .slice()
    .sort((a, b) => a.level_threshold - b.level_threshold);
  const platformRates: Array<{
    label: string;
    perThousand: number | null | undefined;
    icon: LucideIcon;
  }> = campaign
    ? [
        {
          label: "Instagram",
          perThousand: unlocked?.insta_per_1000 ?? campaign.insta_per_1000,
          icon: Instagram,
        },
        {
          label: "X",
          perThousand: unlocked?.x_per_1000 ?? campaign.x_per_1000,
          icon: Twitter,
        },
        {
          label: "YouTube",
          perThousand: unlocked?.youtube_per_1000 ?? campaign.youtube_per_1000,
          icon: Youtube,
        },
        {
          label: "TikTok",
          perThousand: unlocked?.tiktok_per_1000 ?? campaign.tiktok_per_1000,
          icon: Music2,
        },
      ].filter((platform) => platform.perThousand != null)
    : [];

  const displayPlatformRates = platformRates.filter(
    (platform) => (platform.perThousand ?? 0) !== 0
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Wider than 3xl: two columns in the old width left both halves too
          narrow to read, which is the usual way a split layout ends up worse
          than the stack it replaced. */}
      <DialogContent className="max-h-[92vh] w-[calc(100vw-1.5rem)] max-w-5xl overflow-y-auto rounded-3xl border-0 p-0 shadow-2xl sm:w-full sm:rounded-[32px]">
        {campaign ? (
          <div className="flex max-h-[85vh] flex-col">
            <div className="flex-1 space-y-10 overflow-y-auto px-8 py-10">
              <header className="flex items-start gap-6">
                <Avatar className="h-20 w-20 ring-4 ring-black/5">
                  <AvatarImage src={displayImageUrl} alt="Campaign Logo" />
                  <AvatarFallback className="bg-primary/10 text-2xl font-semibold text-primary">
                    {getInitials(displayTitle)}
                  </AvatarFallback>
                </Avatar>

                <div className="flex-1 space-y-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-3">
                        <h2 className="text-2xl font-semibold text-foreground">
                          {displayTitle || "Untitled Campaign"}
                        </h2>
                      </div>
                    </div>
                    <Badge
                      variant="secondary"
                      className={
                        campaign.active
                          ? "rounded-full bg-green-500/15 text-xs font-medium text-green-600"
                          : "rounded-full bg-muted text-xs font-medium text-muted-foreground"
                      }
                    >
                      {campaign.active ? "Live" : "Inactive"}
                    </Badge>
                  </div>
                </div>
              </header>

              {/* Two columns from lg up: the numbers on the left, what you
                  actually have to DO on the right. Stacked, a clipper read the
                  rates, scrolled past them, and hit the rules on a separate
                  screenful — so the two halves of the decision were never
                  visible at once. Single column below lg, where side-by-side
                  would just squeeze both. */}
              <div className="grid gap-8 lg:grid-cols-2 lg:items-start">
              <section className="rounded-[28px] border border-border/40 bg-muted/30 p-6">
                <div className="grid grid-cols-2 gap-5 sm:gap-6 lg:grid-cols-3">
                  <div className="space-y-1">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                      Created
                    </p>
                    <p className="text-lg font-semibold text-foreground">
                      {timeAgo(campaign.created_at)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {campaign.achievementPercentage.toFixed(2)}% paid out
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                      Payment
                    </p>
                    {paymentMethods.length > 0 ? (
                      <>
                        <p className="text-lg font-semibold text-foreground">
                          {paymentMethods
                            .map((m) => paymentMethodLabels[m])
                            .join(" · ")}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          How you get paid
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="text-lg font-semibold text-foreground">
                          Bank
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Direct transfer
                        </p>
                      </>
                    )}
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                      Bounty
                    </p>
                    <p className="text-lg font-semibold text-foreground">
                      {hideBudget ? "Hidden" : formatCurrency(displayBudget)}
                    </p>
                    {hideBudget && (
                      <p className="text-xs text-muted-foreground">
                        Revealed once you're approved
                      </p>
                    )}
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                      Max Per Clip
                    </p>
                    {hideBudget ? (
                      <>
                        <p className="text-lg font-semibold text-foreground">
                          Hidden
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Revealed once you're approved
                        </p>
                      </>
                    ) : maxPayoutPct > 0 ? (
                      <>
                        <p className="text-lg font-semibold text-foreground">
                          {formatCurrency(maxPayoutValue)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          The most one clip can earn, however far it goes
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="text-lg font-semibold text-foreground">
                          No cap
                        </p>
                        <p className="text-xs text-muted-foreground">
                          A single clip can earn the whole bounty
                        </p>
                      </>
                    )}
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                      Budget Left
                    </p>
                    {hideBudget ? (
                      <>
                        <p className="text-lg font-semibold text-foreground">
                          Hidden
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Revealed once you're approved
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="text-lg font-semibold text-foreground">
                          {budgetLeftPct.toFixed(0)}%
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {budgetLeftPct < 15
                            ? "Nearly spent - clips may not earn"
                            : "Of the bounty is still unclaimed"}
                        </p>
                      </>
                    )}
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                      Minimum Views
                    </p>
                    {hideMinViews ? (
                      <>
                        <p className="text-lg font-semibold text-foreground">
                          Hidden
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Revealed once you're approved
                        </p>
                      </>
                    ) : (
                      <div className="space-y-2">
                        <div>
                          <p className="text-sm font-semibold text-foreground">
                            {displayFloors.length === 0
                              ? "None"
                              : floorsAllEqual
                                ? `${formatViews(displayFloors[0]!.value)} per clip`
                                : displayFloors
                                    .map(
                                      (f) =>
                                        `${f.label} ${formatViews(f.value)}`
                                    )
                                    .join(" · ")}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {displayFloors.length === 0
                              ? "Every clip counts, no per-clip minimum"
                              : floorsAllEqual
                                ? "Per clip — clips under this don't count or earn"
                                : "Per clip on these platforms — clips under the number don't count or earn. Platforms not listed have no per-clip minimum."}
                          </p>
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-foreground">
                            {displayMinPayout > 0
                              ? `${formatViews(displayMinPayout)} in total`
                              : "No total minimum"}
                          </p>
                          {displayMinPayout > 0 && (
                            <p className="text-xs text-muted-foreground">
                              Combined across ALL your clips to get paid — not
                              per clip
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="space-y-3 sm:col-span-2 lg:col-span-4">
                    {displayPlatformRates.length > 0 ? (
                      <>
                        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                          Payouts
                        </p>
                        {(() => {
                          const baseRate =
                            displayPlatformRates[0]?.perThousand ?? 0;
                          const shouldConsolidateRates =
                            displayPlatformRates.every(
                              (rate) => rate.perThousand === baseRate
                            );

                          if (shouldConsolidateRates) {
                            return (
                              <div className="grid gap-3">
                                <div className="space-y-3 rounded-2xl border border-border/50 bg-background/60 px-4 py-4 text-center shadow-sm sm:col-span-2 lg:col-span-4">
                                  <div className="flex flex-col items-center space-y-2">
                                    <div className="flex space-x-2">
                                      {displayPlatformRates.map(
                                        ({ label, icon: Icon }) => (
                                          <span
                                            key={label}
                                            className="flex h-10 w-10 items-center justify-center rounded-full border border-muted bg-muted text-muted-foreground"
                                          >
                                            <Icon className="h-4 w-4" />
                                          </span>
                                        )
                                      )}
                                    </div>
                                    <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                                      All Platforms
                                    </p>
                                  </div>
                                  <div className="space-y-1 text-center">
                                    <p className="text-base font-semibold text-foreground">
                                      {formatPerMillion(baseRate)}
                                    </p>
                                    <p className="text-xs font-medium text-muted-foreground">
                                      per 1M views
                                    </p>
                                  </div>
                                </div>
                              </div>
                            );
                          }

                          return (
                            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                              {displayPlatformRates.map(
                                ({ label, perThousand, icon: Icon }) => (
                                  <div
                                    key={label}
                                    className="space-y-3 rounded-2xl border border-border/50 bg-background/60 px-4 py-4 shadow-sm"
                                  >
                                    <div className="flex flex-col items-center space-y-2">
                                      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
                                        <Icon className="h-4 w-4" />
                                      </span>
                                      <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                                        {label}
                                      </p>
                                    </div>
                                    <div className="space-y-1 text-center">
                                      <p className="text-base font-semibold text-foreground">
                                        {formatPerMillion(perThousand)}
                                      </p>
                                      <p className="text-xs font-medium text-muted-foreground">
                                        per 1M views
                                      </p>
                                    </div>
                                  </div>
                                )
                              )}
                            </div>
                          );
                        })()}
                      </>
                    ) : null}
                    {campaignLevels.length > 0 && (
                      <div className="space-y-2 py-4">
                        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                          Level boosts
                        </p>
                        <div className="space-y-2">
                          {campaignLevels.map((level, index) => (
                            <div
                              key={level.id}
                              className="flex items-center justify-between rounded-xl bg-background/60 shadow-sm px-3 py-3"
                            >
                              <div>
                                <p className="text-sm font-semibold text-primary">
                                  Level {index + 1}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {formatViews(level.level_threshold)} views
                                </p>
                              </div>
                              <div className="text-right">
                                <p className="text-sm font-semibold text-foreground">
                                  {formatCurrency(level.cpm_rate)} CPM
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {level.additional_rewards_description?.trim() ||
                                    ""}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {campaign.is_hot_streak_enabled && (
                      <div className="space-y-2 py-4">
                        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                          Hot Streaks
                        </p>
                        <div className="space-y-3 rounded-2xl border border-border/50 bg-background/60 px-4 py-4 shadow-sm">
                          <p className="text-xs text-muted-foreground">
                            We sum everyone's new views from yesterday. The top
                            10 earn extra CPM on top of their level rate when
                            rewards are created.
                          </p>
                          <div className="grid gap-3 sm:grid-cols-3">
                            {dailyCpmBoostTiers.map((tier) => (
                              <div
                                key={tier.label}
                                className="rounded-xl bg-muted/40 px-3 py-4 text-center"
                              >
                                <img
                                  src={tier.image}
                                  alt={`${tier.label} placeholder badge`}
                                  className="mx-auto mb-3 h-16 w-16 rounded-2xl object-cover shadow-sm"
                                  loading="lazy"
                                  width={64}
                                  height={64}
                                />
                                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
                                  {tier.label}
                                </p>
                                <p className="text-lg font-semibold text-foreground">
                                  +{formatCurrency(tier.boost)} CPM
                                </p>
                                <p className="text-[11px] text-muted-foreground">
                                  {tier.range}
                                </p>
                              </div>
                            ))}
                          </div>
                          <p className="text-[11px] text-muted-foreground">
                            Reset daily - Uses the last 24h view delta per user
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </section>

              {/* Right column: Details + SOP, grouped so the rules read as one
                  block rather than two loose sections. */}
              <div className="space-y-8">
              <section className="space-y-4">
                <h3 className="text-lg font-semibold text-foreground">
                  Details
                </h3>
                {displayDescription &&
                displayDescription
                  .replace(/<[^>]*>/g, " ")
                  .replace(/&nbsp;/g, " ")
                  .replace(/\s+/g, " ")
                  .trim() ? (
                  <div
                    className="prose prose-sm max-w-none leading-relaxed text-muted-foreground dark:prose-invert"
                    dangerouslySetInnerHTML={{
                      __html: displayDescription,
                    }}
                  />
                ) : (
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {isPrivate && !campaign.private_show_description && !unlocked
                      ? "Details are revealed once your application is approved."
                      : "No additional details provided."}
                  </p>
                )}
                {/* <div className="text-center">
                  <button
                    type="button"
                    className="text-sm font-semibold text-foreground underline-offset-4 transition hover:underline"
                  >
                    Show more
                  </button>
                </div> */}
              </section>

              <section className="space-y-4">
                <h3 className="text-lg font-semibold text-foreground">
                  What to include (SOP)
                </h3>
                {displaySopEmbedUrl ? (
                  <a
                    href={displaySopEmbedUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() =>
                      trackEvent({
                        event: "campaign_sop_link_clicked",
                        properties: {
                          campaignId: campaign.id,
                          campaignTitle: campaign.title,
                        },
                      })
                    }
                    className="inline-flex text-xs font-semibold uppercase underline text-primary/80 transition hover:text-primary"
                  >
                    Open in new tab
                  </a>
                ) : isPrivate && !unlocked ? (
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    The SOP is revealed once your application is approved.
                  </p>
                ) : null}
              </section>
              </div>
              </div>
            </div>

            <div className="space-y-4 border-t border-border/60 p-8">
              {campaign.ended ? (
                <p className="text-center text-sm text-muted-foreground">
                  This campaign has ended.
                </p>
              ) : isPrivate ? (
                <>
                  <PrivateCampaignApplySection
                    campaignId={campaign.id}
                    campaignTitle={campaign.title}
                    campaignPlatforms={campaign.platforms}
                    applicationState={applicationQuery.data}
                    isLoading={applicationQuery.isLoading}
                    onApplied={() => applicationQuery.refetch()}
                  />
                  {isApproved && submissionsPaused && pausedNotice}
                  {isApproved && !submissionsPaused && (
                    <Button
                      asChild
                      className="h-12 w-full rounded-full text-base font-semibold shadow-md"
                    >
                      <Link
                        to={`/campaign/${campaign.id}/submit`}
                        onClick={() => {
                          trackEvent({
                            event: "campaign_detail_primary_action_clicked",
                            properties: {
                              campaignId: campaign.id,
                              campaignTitle: campaign.title,
                              actionLabel,
                            },
                          });
                          onOpenChange(false);
                        }}
                      >
                        {actionLabel}
                      </Link>
                    </Button>
                  )}
                </>
              ) : submissionsPaused ? (
                pausedNotice
              ) : (
                <Button
                  asChild
                  className="h-12 w-full rounded-full text-base font-semibold shadow-md"
                >
                  <Link
                    to={`/campaign/${campaign.id}/submit`}
                    onClick={() => {
                      trackEvent({
                        event: "campaign_detail_primary_action_clicked",
                        properties: {
                          campaignId: campaign.id,
                          campaignTitle: campaign.title,
                          actionLabel,
                        },
                      });
                      onOpenChange(false);
                    }}
                  >
                    {actionLabel}
                  </Link>
                </Button>
              )}
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
};
