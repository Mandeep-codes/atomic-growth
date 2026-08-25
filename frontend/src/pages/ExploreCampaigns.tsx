import { CampaignPreviewModal } from "@/components/CampaignPreviewModal";
import { TopNav } from "@/components/TopNav";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency } from "@/lib/formatCurrency";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import type { inferRouterOutputs } from "@trpc/server";
import {
  ArrowUpRight,
  BadgeCheck,
  ChevronLeft,
  ChevronRight,
  Search,
  Instagram,
  Lock,
  Music2,
  Twitter,
  Video,
  Youtube,
} from "lucide-react";
import { useEffect, useMemo, useState, type ElementType } from "react";
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
  // max_payout is a PERCENTAGE of the bounty (see CampaignEdit: "Max Payout
  // (% of bounty)"). Never surfaced to clippers before, so the cap on a single
  // clip was invisible on the one screen where people decide what to clip.
  const maxPerClip =
    ((Number(campaign.max_payout) || 0) * (Number(campaign.budget) || 0)) / 100;

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
      <div className="relative h-52 w-full overflow-hidden border-b border-border bg-muted sm:h-56">
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
                    per 1,000 views
                  </span>
                </>
              )}
            </span>
          </div>
          <div>
            <span className="block text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
              Max per clip
            </span>
            <span className="mt-0.5 block text-lg font-bold">
              {hideBudget ? (
                <span className="text-sm text-muted-foreground">Hidden</span>
              ) : maxPerClip > 0 ? (
                formatCurrency(maxPerClip)
              ) : (
                <span className="text-sm text-muted-foreground">No cap</span>
              )}
            </span>
          </div>
        </div>

        {!hideBudget && progress !== null ? (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between font-mono text-[9px] uppercase tracking-[0.16em]">
              <span className="text-muted-foreground">Campaign progress</span>
              <span className="font-bold">
                {(100 - progress).toFixed(0)}%% budget left
              </span>
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
const PLATFORM_FILTERS = [
  { id: "youtube", icon: Youtube, label: "YouTube" },
  { id: "tiktok", icon: Music2, label: "TikTok" },
  { id: "instagram", icon: Instagram, label: "Instagram" },
  { id: "x", icon: Twitter, label: "X" },
];

/**
 * Structured like the category leaders: a full-bleed HERO for whatever is worth
 * clipping right now, a filter rail, then the grid. A flat grid of equal cards
 * makes every campaign look equally worth your time, which is the opposite of
 * what a clipper needs when deciding where to spend an evening editing.
 */
const ExploreCampaigns = () => {
  const { data, isLoading } = trpc.campaigns.getAll.useQuery();
  const [selected, setSelected] = useState<Campaign | null>(null);
  const [query, setQuery] = useState("");
  const [platform, setPlatform] = useState<string | null>(null);
  const [slide, setSlide] = useState(0);

  const { current, past } = useMemo(() => {
    const all = data ?? [];
    return {
      current: all.filter((c) => c.active && !c.ended),
      past: all.filter((c) => c.ended),
    };
  }, [data]);

  // Hero = live campaigns with the most budget still unclaimed. That is the
  // number clippers actually filter on, so it beats recency: a nearly-drained
  // campaign at the top wastes everyone's time.
  const heroes = useMemo(
    () =>
      [...current]
        .sort(
          (a, b) =>
            (Number(a.achievementPercentage) || 0) -
            (Number(b.achievementPercentage) || 0)
        )
        .slice(0, 5),
    [current]
  );

  useEffect(() => {
    if (slide >= heroes.length) setSlide(0);
  }, [heroes.length, slide]);

  const matches = (c: Campaign) => {
    const q = query.trim().toLowerCase();
    if (q && !(c.title ?? "").toLowerCase().includes(q)) return false;
    if (platform && !(c.platforms ?? "").toLowerCase().includes(platform))
      return false;
    return true;
  };

  const filteredCurrent = current.filter(matches);
  const filteredPast = past.filter(matches);
  const hero = heroes[slide];
  const heroRate = hero ? topRateOf(hero) : null;
  const heroTeased =
    hero &&
    hero.visibility === "private" &&
    !(hero as Campaign & { unlockedForMe?: boolean }).unlockedForMe;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <TopNav showSidebarTrigger={false} />

      {hero ? (
        <section className="relative h-[62vh] min-h-[420px] w-full overflow-hidden">
          {hero.imageUrl ? (
            <img
              key={hero.id}
              src={hero.imageUrl}
              alt=""
              aria-hidden="true"
              className="absolute inset-0 h-full w-full object-cover"
            />
          ) : (
            <div className="absolute inset-0 bg-gradient-to-br from-muted via-background to-muted" />
          )}
          {/* Two gradients: the bottom fade carries the text, the left fade
              keeps it legible over a busy photo. */}
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/70 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-r from-background/90 via-background/30 to-transparent" />

          <div className="absolute inset-x-0 bottom-0 mx-auto max-w-6xl px-6 pb-12">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-foreground/10 font-mono text-[10px] font-bold backdrop-blur">
                {initials(hero.title)}
              </span>
              <span className="text-sm font-semibold">Atomik Clips</span>
              <BadgeCheck className="h-4 w-4 text-muted-foreground" />
            </div>

            <h1 className="display-heading mt-3 max-w-3xl text-4xl leading-none sm:text-6xl">
              {hero.title || "Untitled campaign"}
            </h1>

            <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
              {heroRate && !(heroTeased && !hero.private_show_rates) ? (
                <span>
                  <span className="font-bold text-foreground">
                    ${heroRate.top.toFixed(2)}
                  </span>
                  /1K views
                </span>
              ) : (
                <span>Rate revealed on approval</span>
              )}
              <span aria-hidden="true">&middot;</span>
              {heroTeased && !hero.private_show_budget ? (
                <span>Budget hidden</span>
              ) : (
                <span>{formatCurrency(hero.budget)} bounty</span>
              )}
              <span aria-hidden="true">&middot;</span>
              <span>
                {Math.max(0, 100 - (Number(hero.achievementPercentage) || 0)).toFixed(0)}
                % budget left
              </span>
            </p>

            <button
              type="button"
              onClick={() => setSelected(hero)}
              className="mt-6 inline-flex items-center gap-2 rounded-full bg-foreground px-8 py-3.5 text-sm font-bold text-background transition-transform duration-200 hover:scale-[0.98]"
            >
              Join campaign
              <ArrowUpRight className="h-4 w-4" />
            </button>
          </div>

          {heroes.length > 1 ? (
            <>
              <div className="absolute bottom-6 right-6 flex gap-2">
                <button
                  type="button"
                  aria-label="Previous campaign"
                  onClick={() => setSlide((i) => (i - 1 + heroes.length) % heroes.length)}
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-background/70 backdrop-blur transition-colors hover:border-foreground/40"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  aria-label="Next campaign"
                  onClick={() => setSlide((i) => (i + 1) % heroes.length)}
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-background/70 backdrop-blur transition-colors hover:border-foreground/40"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
              <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 gap-1.5">
                {heroes.map((h, i) => (
                  <button
                    key={h.id}
                    type="button"
                    aria-label={`Go to campaign ${i + 1}`}
                    onClick={() => setSlide(i)}
                    className={cn(
                      "h-1 rounded-full transition-all",
                      i === slide ? "w-6 bg-foreground" : "w-3 bg-foreground/30"
                    )}
                  />
                ))}
              </div>
            </>
          ) : null}
        </section>
      ) : null}

      <main className="mx-auto max-w-6xl space-y-10 px-6 py-10">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <label className="flex flex-1 items-center gap-3 rounded-full border border-border bg-card px-5 py-3">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search campaigns"
              aria-label="Search campaigns"
              className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </label>

          <div className="flex items-center gap-2">
            {PLATFORM_FILTERS.map((f) => {
              const Icon = f.icon;
              const on = platform === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  aria-label={f.label}
                  aria-pressed={on}
                  onClick={() => setPlatform(on ? null : f.id)}
                  className={cn(
                    "flex h-11 w-11 items-center justify-center rounded-full border transition-colors",
                    on
                      ? "border-foreground bg-foreground text-background"
                      : "border-border bg-card text-muted-foreground hover:border-foreground/40 hover:text-foreground"
                  )}
                >
                  <Icon className="h-4 w-4" />
                </button>
              );
            })}
          </div>
        </div>

        <section className="space-y-6">
          <div className="flex items-end justify-between border-b border-border pb-4">
            <h2 className="display-heading text-3xl sm:text-4xl">Featured</h2>
            <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              {filteredCurrent.length} live
            </span>
          </div>

          {isLoading ? (
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              <Skeleton className="h-[420px] rounded-3xl" />
              <Skeleton className="h-[420px] rounded-3xl" />
              <Skeleton className="h-[420px] rounded-3xl" />
            </div>
          ) : filteredCurrent.length === 0 ? (
            <div className="flex items-center justify-center rounded-3xl border border-dashed border-border py-16">
              <p className="text-sm text-muted-foreground">
                {query || platform
                  ? "Nothing matches those filters."
                  : "No campaigns are running right now - check back soon."}
              </p>
            </div>
          ) : (
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {filteredCurrent.map((campaign) => (
                <CampaignCard
                  key={campaign.id}
                  campaign={campaign}
                  onOpen={() => setSelected(campaign)}
                />
              ))}
            </div>
          )}
        </section>

        {filteredPast.length > 0 ? (
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
                {filteredPast.length} closed
              </span>
            </div>

            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {filteredPast.map((campaign) => (
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
