import { CampaignPreviewModal } from "@/components/CampaignPreviewModal";
import { TopNav } from "@/components/TopNav";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency } from "@/lib/formatCurrency";
import { trpc } from "@/lib/trpc";
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
import { useMemo, useState, type ElementType } from "react";
import type { AppRouter } from "../../../backend/src/routers";

type Campaign = inferRouterOutputs<AppRouter>["campaigns"]["getAll"][number];

const PLATFORM_META: Record<string, { icon: ElementType; label: string }> = {
  youtube: { icon: Youtube, label: "YouTube" },
  yt: { icon: Youtube, label: "YouTube" },
  instagram: { icon: Instagram, label: "Instagram" },
  ig: { icon: Instagram, label: "Instagram" },
  tiktok: { icon: Music2, label: "TikTok" },
  tt: { icon: Music2, label: "TikTok" },
  x: { icon: Twitter, label: "X" },
  twitter: { icon: Twitter, label: "X" },
};

const initials = (title?: string | null) => {
  if (!title) return "AC";
  const w = title.trim().split(" ");
  return w.length === 1
    ? w[0]!.slice(0, 2).toUpperCase()
    : `${w[0]![0] ?? ""}${w[1]![0] ?? ""}`.toUpperCase();
};

const topRateOf = (c: Campaign) => {
  const rates = [
    c.youtube_per_1000,
    c.insta_per_1000,
    c.tiktok_per_1000,
    c.x_per_1000,
  ]
    .map((r) => Number(r ?? 0))
    .filter((r) => r > 0);
  if (!rates.length) return null;
  return { top: Math.max(...rates), varies: new Set(rates).size > 1 };
};

/** Full-bleed thumbnail card. Falls back to the campaign's initials. */
const CampaignCard = ({
  campaign,
  onOpen,
  dimmed,
}: {
  campaign: Campaign;
  onOpen: () => void;
  dimmed?: boolean;
}) => {
  const teased =
    campaign.visibility === "private" &&
    !(campaign as Campaign & { unlockedForMe?: boolean }).unlockedForMe;
  const hideBudget = teased && !campaign.private_show_budget;
  const hideRates = teased && !campaign.private_show_rates;
  const rate = topRateOf(campaign);
  const platforms = (campaign.platforms ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  const progress = Number.isFinite(campaign.achievementPercentage)
    ? Math.max(0, Math.min(Number(campaign.achievementPercentage), 100))
    : null;

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "group flex flex-col overflow-hidden rounded-3xl border border-border bg-card text-left shadow-xl transition-all duration-300",
        "hover:-translate-y-0.5 hover:border-foreground/30",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2",
        dimmed && "opacity-70 hover:opacity-100"
      )}
    >
      {/* Thumbnail — the whole width of the card, as in the design. */}
      <div className="relative h-40 w-full overflow-hidden border-b border-border bg-muted">
        {campaign.imageUrl ? (
          <img
            src={campaign.imageUrl}
            alt=""
            aria-hidden="true"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center font-mono text-3xl font-bold text-muted-foreground">
            {initials(campaign.title)}
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-card/80 to-transparent" />
        <div className="absolute left-3 top-3 flex gap-1.5">
          {campaign.visibility === "private" ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-background/80 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.14em] backdrop-blur">
              <Lock className="h-2.5 w-2.5" /> Private
            </span>
          ) : null}
          {campaign.ended ? (
            <span className="rounded-full bg-background/80 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.14em] backdrop-blur">
              Closed
            </span>
          ) : null}
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-4 p-5">
        <h3 className="text-xl font-bold leading-tight tracking-tight">
          {campaign.title || "Untitled campaign"}
        </h3>

        {platforms.length ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {platforms.map((p) => {
              const meta = PLATFORM_META[p.toLowerCase()];
              const Icon = meta?.icon ?? Video;
              return (
                <span
                  key={`${campaign.id}-${p}`}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted/60 px-2 py-1 font-mono text-[10px] text-foreground/80"
                >
                  <Icon className="h-3 w-3" />
                  {meta?.label ?? p}
                </span>
              );
            })}
          </div>
        ) : null}

        <div className="mt-auto grid grid-cols-2 gap-3 rounded-xl border border-border bg-muted/40 p-3 font-mono">
          <div>
            <span className="block text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
              {rate?.varies ? "Rate up to" : "Reward rate"}
            </span>
            <span className="mt-0.5 block text-lg font-bold">
              {hideRates || !rate ? (
                <span className="text-sm text-muted-foreground">
                  {hideRates ? "Hidden" : "Not set"}
                </span>
              ) : (
                <>
                  ${rate.top.toFixed(2)}
                  <span className="text-[10px] font-normal text-muted-foreground">
                    {" "}
                    / 1k
                  </span>
                </>
              )}
            </span>
          </div>
          <div>
            <span className="block text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
              Budget
            </span>
            <span className="mt-0.5 block text-lg font-bold">
              {hideBudget ? (
                <span className="text-sm text-muted-foreground">Hidden</span>
              ) : (
                formatCurrency(campaign.budget)
              )}
            </span>
          </div>
        </div>

        {!hideBudget && progress !== null ? (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between font-mono text-[9px] uppercase tracking-[0.16em]">
              <span className="text-muted-foreground">Pool claimed</span>
              <span className="font-bold">{progress.toFixed(0)}% full</span>
            </div>
            <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-foreground transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        ) : null}

        <div className="flex w-full items-center justify-center gap-2 rounded-xl bg-foreground py-3.5 font-mono text-xs font-extrabold uppercase tracking-[0.18em] text-background transition-transform duration-200 group-hover:scale-[0.98]">
          <span>{campaign.ended ? "View campaign" : "Review campaign"}</span>
          <ArrowUpRight className="h-3.5 w-3.5" />
        </div>
      </div>
    </button>
  );
};

/**
 * The public campaign catalogue: everything currently running, then everything
 * that has closed. Reachable signed out — campaigns.getAll is public and
 * strips private campaigns' budget and rates server-side.
 */
const ExploreCampaigns = () => {
  const { data, isLoading } = trpc.campaigns.getAll.useQuery();
  const [selected, setSelected] = useState<Campaign | null>(null);

  const { current, past } = useMemo(() => {
    const all = data ?? [];
    return {
      current: all.filter((c) => c.active && !c.ended),
      past: all.filter((c) => c.ended),
    };
  }, [data]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <TopNav showSidebarTrigger={false} />

      <main className="mx-auto max-w-6xl space-y-12 px-6 py-10">
        <header className="flex flex-col items-center gap-3 text-center">
          <img
            src="/atomik.png"
            alt=""
            aria-hidden="true"
            className="h-16 w-16 object-contain invert dark:invert-0"
          />
          <h1 className="display-heading text-4xl leading-none sm:text-6xl">
            Atomik Clips
          </h1>
        </header>

        <section className="space-y-6">
          <div className="flex items-end justify-between border-b border-border pb-4">
            <h2 className="display-heading text-3xl sm:text-4xl">
              Current campaigns
            </h2>
            <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              {current.length} live
            </span>
          </div>

          {isLoading ? (
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              <Skeleton className="h-[420px] rounded-3xl" />
              <Skeleton className="h-[420px] rounded-3xl" />
              <Skeleton className="h-[420px] rounded-3xl" />
            </div>
          ) : current.length === 0 ? (
            <div className="flex items-center justify-center rounded-3xl border border-dashed border-border py-16">
              <p className="text-sm text-muted-foreground">
                No campaigns are running right now — check back soon.
              </p>
            </div>
          ) : (
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {current.map((campaign) => (
                <CampaignCard
                  key={campaign.id}
                  campaign={campaign}
                  onOpen={() => setSelected(campaign)}
                />
              ))}
            </div>
          )}
        </section>

        {past.length > 0 ? (
          <section className="space-y-6">
            <div className="flex items-end justify-between border-b border-border pb-4">
              <div>
                <h2 className="display-heading text-3xl sm:text-4xl">
                  Past campaigns
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Closed campaigns with completed payout pools
                </p>
              </div>
              <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                {past.length} closed
              </span>
            </div>

            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {past.map((campaign) => (
                <CampaignCard
                  key={campaign.id}
                  campaign={campaign}
                  onOpen={() => setSelected(campaign)}
                  dimmed
                />
              ))}
            </div>
          </section>
        ) : null}
      </main>

      <CampaignPreviewModal
        campaign={selected}
        onClose={() => setSelected(null)}
      />
    </div>
  );
};

export default ExploreCampaigns;
