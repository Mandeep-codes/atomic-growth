import { Badge } from "@/components/ui/badge";
import { CpmBoostBadge } from "@/components/CpmBoostBadge";
import { useMyCpmGroupRates } from "@/hooks/useMyCpmGroupRates";
import { trackEvent } from "@/lib/analytics";
import { formatCurrency } from "@/lib/formatCurrency";
import { cn } from "@/lib/utils";
import type { inferRouterOutputs } from "@trpc/server";
import {
  ArrowUpRight,
  Instagram,
  Lock,
  Music2,
  Twitter,
  Video,
  Youtube,
} from "lucide-react";
import type { ElementType } from "react";
import type { AppRouter } from "../../../backend/src/routers";
import { Skeleton } from "./ui/skeleton";

export type RouterOutput = inferRouterOutputs<AppRouter>;
// unlockedForMe rides in from useCampaignsData: the caller is an approved
// applicant, so the teaser treatment below must stand down for this card.
export type Campaign = RouterOutput["campaigns"]["getAll"][number] & {
  unlockedForMe?: boolean;
};

interface ActiveCampaignsSectionProps {
  campaigns: Campaign[];
  onSelectCampaign?: (campaign: Campaign) => void;
  title?: string;
  isLoading?: boolean;
}

const getInitials = (title: string | null | undefined) => {
  if (!title) return "C";
  const words = title.trim().split(" ");
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return `${words[0]![0] ?? "C"}${words[1]?.[0] ?? ""}`.toUpperCase();
};

const PLATFORM_META: Record<string, { icon: ElementType; label: string }> = {
  instagram: { icon: Instagram, label: "Instagram" },
  ig: { icon: Instagram, label: "Instagram" },
  youtube: { icon: Youtube, label: "YouTube" },
  yt: { icon: Youtube, label: "YouTube" },
  tiktok: { icon: Music2, label: "TikTok" },
  tt: { icon: Music2, label: "TikTok" },
  x: { icon: Twitter, label: "X" },
  // Alias only — "x" is the stored value; this keeps a legacy row rendering
  // as X instead of falling through to the raw key.
  twitter: { icon: Twitter, label: "X" },
};

const parsePlatforms = (platforms: Campaign["platforms"]) =>
  (platforms ?? "")
    .split(",")
    .map((platform) => platform.trim())
    .filter(Boolean);

/**
 * The card shows ONE headline rate, but a campaign carries four independent
 * per-platform rates. Take the best one the clipper could actually earn and
 * label it "up to" whenever the platforms disagree — quoting a single number
 * as if it applied everywhere is the kind of thing clippers screenshot.
 */
const headlineRate = (campaign: Campaign) => {
  const rates = [
    campaign.youtube_per_1000,
    campaign.insta_per_1000,
    campaign.tiktok_per_1000,
    campaign.x_per_1000,
  ]
    .map((rate) => Number(rate ?? 0))
    .filter((rate) => rate > 0);

  if (rates.length === 0) return null;
  const top = Math.max(...rates);
  return { top, varies: new Set(rates).size > 1 };
};

const MicroLabel = ({ children }: { children: React.ReactNode }) => (
  <span className="block font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
    {children}
  </span>
);

export const ActiveCampaignsSection = ({
  campaigns,
  onSelectCampaign,
  title,
  isLoading,
}: ActiveCampaignsSectionProps) => {
  const notEndedCampaigns = campaigns.filter((campaign) => !campaign.ended);
  // One fetch for the whole grid; cards look their boost up by campaign id.
  const cpmGroupRates = useMyCpmGroupRates();

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-1 border-b border-border/40 pb-4 sm:flex-row sm:items-end sm:justify-between">
        <h2 className="display-heading text-3xl text-foreground sm:text-4xl">
          {title || "Current Campaigns"}
        </h2>
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          {notEndedCampaigns.length}{" "}
          {notEndedCampaigns.length === 1 ? "campaign" : "campaigns"} live
        </p>
      </div>

      {isLoading ? (
        <div className="grid gap-6 md:grid-cols-2">
          <Skeleton className="h-[340px] rounded-3xl" />
          <Skeleton className="h-[340px] rounded-3xl" />
        </div>
      ) : notEndedCampaigns.length === 0 ? (
        <div className="flex items-center justify-center rounded-3xl border border-dashed border-border/60 py-16">
          <p className="text-sm text-muted-foreground">
            No active campaigns available right now.
          </p>
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          {notEndedCampaigns.map((campaign) => {
            const isPrivate = campaign.visibility === "private";
            const teased = isPrivate && !campaign.unlockedForMe;
            const hideBudget = teased && !campaign.private_show_budget;
            const hideRates = teased && !campaign.private_show_rates;
            const hideDescription = teased && !campaign.private_show_description;

            const rate = headlineRate(campaign);
            const platforms = parsePlatforms(campaign.platforms);
            // A campaign with a zero budget divides by zero upstream, so this
            // arrives as NaN — which is a number, and typeof-checking it
            // rendered a literal "NaN% full" on the card.
            const progress = Number.isFinite(campaign.achievementPercentage)
              ? (campaign.achievementPercentage as number)
              : null;

            return (
              <button
                key={campaign.id}
                type="button"
                onClick={() => {
                  trackEvent({
                    event: "campaign_card_selected",
                    properties: {
                      campaignId: campaign.id,
                      campaignTitle: campaign.title,
                    },
                  });
                  onSelectCampaign?.(campaign);
                }}
                className={cn(
                  "group relative flex min-h-[340px] flex-col overflow-hidden rounded-3xl border border-border/60 bg-card text-left shadow-xl transition-all duration-300",
                  "hover:-translate-y-0.5 hover:border-foreground/30",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2",
                  cpmGroupRates.has(campaign.id) && "cpm-boost-card"
                )}
              >
                {/* Thumbnail — same full-bleed banner the campaign cards use on
                    the public pages. The dashboard was showing the same
                    campaigns as a small 44px avatar beside the title, so the
                    identical campaign looked like a different product
                    depending on which page you reached it from. Padding moved
                    off the card and onto the body below so this can run edge
                    to edge. */}
                <div className="relative h-40 w-full shrink-0 overflow-hidden border-b border-border bg-muted">
                  {campaign.imageUrl ? (
                    <img
                      src={campaign.imageUrl}
                      alt=""
                      aria-hidden="true"
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                  ) : (
                    // Same initials fallback as the public card, at banner
                    // scale — a campaign with no artwork still gets a card of
                    // the same shape rather than a collapsed one.
                    <div className="flex h-full w-full items-center justify-center font-mono text-3xl font-bold text-muted-foreground">
                      {getInitials(campaign.title)}
                    </div>
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-card/80 to-transparent" />
                </div>

                <div className="flex flex-1 flex-col justify-between p-6">
                <div className="space-y-4">
                  {/* The 44px avatar that used to sit here showed the same
                      image as the banner above it — the artwork twice, once
                      too small to read. The banner carries it now. */}
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-xl font-bold tracking-tight text-foreground">
                        {campaign.title || "Untitled Campaign"}
                      </h3>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        {isPrivate && (
                          <Badge
                            variant="secondary"
                            className="rounded-full bg-violet-500/15 text-[10px] font-medium text-violet-600 dark:text-violet-300"
                          >
                            <Lock className="mr-1 h-3 w-3" /> Private
                          </Badge>
                        )}
                        {campaign.submissions_paused && (
                          <Badge
                            variant="secondary"
                            className="rounded-full bg-amber-500/15 text-[10px] font-medium text-amber-700 dark:text-amber-300"
                          >
                            Paused
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>

                  {!hideDescription && campaign.description ? (
                    <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                      {campaign.description}
                    </p>
                  ) : null}

                  {platforms.length > 0 && (
                    <div className="space-y-2">
                      <MicroLabel>Eligible channels</MicroLabel>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {platforms.map((platform) => {
                          const meta = PLATFORM_META[platform.toLowerCase()];
                          const Icon = meta?.icon ?? Video;
                          const label = meta?.label ?? platform;
                          return (
                            <span
                              key={`${campaign.id}-${label}`}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-muted/60 px-2.5 py-1 font-mono text-[11px] text-foreground/80"
                            >
                              <Icon className="h-3.5 w-3.5" />
                              {label}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                <div className="mt-5 space-y-4">
                  <div className="grid grid-cols-2 gap-3 rounded-xl border border-border/50 bg-muted/40 p-3.5 font-mono">
                    <div>
                      <MicroLabel>
                        {rate?.varies ? "Rate up to" : "Reward rate"}
                      </MicroLabel>
                      <div className="mt-0.5 text-xl font-bold text-foreground">
                        {/* "Hidden" is a private-campaign teaser state and must
                            not be shown for a public campaign that simply has
                            no rate configured yet — that reads as us
                            withholding the number. */}
                        {hideRates ? (
                          <span className="text-base text-muted-foreground">
                            Hidden
                          </span>
                        ) : !rate ? (
                          <span className="text-base text-muted-foreground">
                            Not set
                          </span>
                        ) : (
                          <>
                            ${rate.top.toFixed(2)}
                            <span className="text-xs font-normal text-muted-foreground">
                              {" "}
                              / 1k
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                    <div>
                      <MicroLabel>Campaign budget</MicroLabel>
                      <div className="mt-0.5 text-xl font-bold text-foreground">
                        {hideBudget ? (
                          <span className="text-base text-muted-foreground">
                            Hidden
                          </span>
                        ) : (
                          formatCurrency(campaign.budget)
                        )}
                      </div>
                    </div>
                  </div>

                  {!hideBudget && progress !== null && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.18em]">
                        <span className="text-muted-foreground">
                          Campaign progress
                        </span>
                        <span className="font-bold text-foreground">
                          {progress.toFixed(1)}% full
                        </span>
                      </div>
                      <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-foreground transition-all duration-500"
                          style={{
                            width: `${Math.max(0, Math.min(progress, 100))}%`,
                          }}
                        />
                      </div>
                    </div>
                  )}

                  {/* foreground/background rather than primary: the app's
                      --primary is magenta, which fights the monochrome card.
                      This inverts cleanly in both themes — white-on-black in
                      dark, black-on-white in light — matching the design. */}
                  <div className="flex w-full items-center justify-center gap-2 rounded-xl bg-foreground py-3.5 font-mono text-xs font-extrabold uppercase tracking-[0.18em] text-background transition-transform duration-200 group-hover:scale-[0.98]">
                    <span>
                      {teased && !campaign.unlockedForMe
                        ? "Apply to unlock"
                        : "Review campaign"}
                    </span>
                    <ArrowUpRight className="h-4 w-4" />
                  </div>
                </div>
                </div>

                <CpmBoostBadge rate={cpmGroupRates.get(campaign.id)} />
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
};

export default ActiveCampaignsSection;
