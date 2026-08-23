import { Badge, Card, Empty, Label, Loading, Numeric, SectionTitle } from "@/components/ds";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useAuth } from "@/hooks/useAuth";
import { formatCurrency } from "@/lib/formatCurrency";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Instagram, Music2, Play, Trophy, Twitter, Video, Youtube } from "lucide-react";
import { useEffect, useState, type ElementType } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// TOP CLIPS + TOP EARNERS
//
// Two boards, kept apart on purpose, because the two procedures carry
// different data and merging them would mean inventing fields:
//
//   leaderboard.getCampaignTopClips → { campaignTitle, clips: [{ rank,
//       platform, views, videoUrl, thumbnailUrl, isHosted }] }
//       NO creator and NO earnings. That omission is deliberate in the
//       backend — the board is anonymous — so this UI does not show a
//       clipper name or a reward on a clip.
//
//   leaderboard.getTopEarners → creator (discord_username) + totalEarned.
//       This is where identity and money legitimately exist.
//
// Nothing here ranks, counts views or computes earnings. It renders the
// server's order and the server's numbers.
//
// GATE: leaderboard.isLeaderboardEnabled reads site_settings.leaderboard_enabled.
// It defaults TRUE when no row exists and fails OPEN if the read throws, so
// this component must not treat "enabled" as proof the board has data.
// ─────────────────────────────────────────────────────────────────────────────

const PLATFORM: Record<string, { icon: ElementType; label: string }> = {
  youtube: { icon: Youtube, label: "YouTube" },
  instagram: { icon: Instagram, label: "Instagram" },
  tiktok: { icon: Music2, label: "TikTok" },
  x: { icon: Twitter, label: "X" },
};

const nf = new Intl.NumberFormat("en-US");
const ALL = "__all__";

type Clip = {
  rank: number;
  platform: string;
  views: number;
  videoUrl?: string | null;
  thumbnailUrl?: string | null;
  isHosted?: boolean;
};

export const TopClipsBoard = () => {
  const { user } = useAuth();
  const enabledQuery = trpc.leaderboard.isLeaderboardEnabled.useQuery();
  // The procedure returns { enabled }, not { leaderboardEnabled } — the audit
  // map named this field wrong, and reading the wrong key silently hid the
  // whole board (undefined is falsy, so it never rendered).
  const on = enabledQuery.data?.enabled;

  const campaigns = trpc.leaderboard.listCampaigns.useQuery(undefined, {
    enabled: Boolean(on),
  });
  const [campaignId, setCampaignId] = useState<string>(ALL);
  const [open, setOpen] = useState<Clip | null>(null);

  const list = campaigns.data ?? [];
  useEffect(() => {
    if (campaignId !== ALL && !list.some((c) => c.id === campaignId)) {
      setCampaignId(ALL);
    }
  }, [list, campaignId]);

  const selected = campaignId === ALL ? list[0]?.id : campaignId;

  const clips = trpc.leaderboard.getCampaignTopClips.useQuery(
    { campaignId: selected ?? "" },
    { enabled: Boolean(on && selected) }
  );
  const earners = trpc.leaderboard.getTopEarners.useQuery(
    { campaignId: selected ?? "" },
    { enabled: Boolean(on && selected) }
  );

  // Hidden entirely when the site setting is off — same as today's
  // HomeLeaderboards, which returns null rather than showing an empty board.
  if (!on) return null;

  const rows = (clips.data?.clips ?? []) as Clip[];

  return (
    <section className="space-y-6">
      <SectionTitle
        meta={clips.data?.campaignTitle ?? undefined}
      >
        Top clips
      </SectionTitle>

      {/* Campaign filter */}
      {list.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setCampaignId(ALL)}
            aria-pressed={campaignId === ALL}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] transition-colors",
              campaignId === ALL
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-muted/40 text-muted-foreground hover:border-foreground/40"
            )}
          >
            <Trophy className="h-3 w-3" /> All campaigns
          </button>
          {list.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCampaignId(c.id)}
              aria-pressed={campaignId === c.id}
              className={cn(
                "rounded-lg border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] transition-colors",
                campaignId === c.id
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-muted/40 text-muted-foreground hover:border-foreground/40"
              )}
            >
              {c.title || "Untitled"}
            </button>
          ))}
        </div>
      ) : null}

      {clips.isLoading ? (
        <Loading label="Loading top clips" />
      ) : rows.length === 0 ? (
        <Empty>
          No clips have made this board yet. Approved clips with the most views
          show up here.
        </Empty>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((clip) => {
            const meta = PLATFORM[clip.platform?.toLowerCase()] ?? {
              icon: Video,
              label: clip.platform,
            };
            const Icon = meta.icon;
            const podium = clip.rank <= 3;

            return (
              <button
                key={`${clip.rank}-${clip.platform}-${clip.views}`}
                type="button"
                onClick={() => setOpen(clip)}
                className={cn(
                  "group flex flex-col overflow-hidden rounded-3xl border bg-card text-left shadow-xl transition-all duration-300",
                  "hover:-translate-y-0.5 hover:border-foreground/30",
                  podium ? "border-foreground/30" : "border-border"
                )}
              >
                <div className="relative h-36 w-full overflow-hidden bg-muted">
                  {clip.thumbnailUrl ? (
                    <img
                      src={clip.thumbnailUrl}
                      alt=""
                      aria-hidden="true"
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <Play className="h-6 w-6 text-muted-foreground" />
                    </div>
                  )}
                  <span
                    className={cn(
                      "absolute left-3 top-3 flex h-7 w-7 items-center justify-center rounded-full font-mono text-[11px] font-bold backdrop-blur",
                      podium
                        ? "bg-foreground text-background"
                        : "bg-background/80 text-foreground"
                    )}
                  >
                    {clip.rank}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-3 p-4">
                  <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                    <Icon className="h-3.5 w-3.5" />
                    {meta.label}
                  </span>
                  <div className="text-right">
                    <Label>Views</Label>
                    <Numeric size="sm">{nf.format(Number(clip.views ?? 0))}</Numeric>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Top earners — the only place creator identity and money exist. */}
      {(earners.data?.length ?? 0) > 0 ? (
        <div className="space-y-3">
          <Label>Top earners</Label>
          <Card className="divide-y divide-border">
            {(earners.data ?? []).map((e, i) => (
              <div
                key={`${e.username ?? i}`}
                className="flex items-center gap-3 px-5 py-3"
              >
                <span className="w-5 shrink-0 font-mono text-[11px] font-bold text-muted-foreground">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm">
                  {e.username ?? "Unknown"}
                </span>
                <span className="shrink-0 font-mono text-sm font-bold">
                  {formatCurrency(Number(e.totalEarned ?? 0))}
                </span>
              </div>
            ))}
          </Card>
        </div>
      ) : null}

      {/* Clip detail */}
      <Dialog open={Boolean(open)} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto rounded-3xl border-border bg-card p-0">
          {open ? (
            <>
              <div className="relative aspect-video w-full overflow-hidden rounded-t-3xl bg-black">
                {open.videoUrl ? (
                  <video
                    src={open.videoUrl}
                    controls
                    playsInline
                    poster={open.thumbnailUrl ?? undefined}
                    className="h-full w-full object-contain"
                  />
                ) : open.thumbnailUrl ? (
                  <img
                    src={open.thumbnailUrl}
                    alt=""
                    aria-hidden="true"
                    className="h-full w-full object-cover"
                  />
                ) : null}
              </div>

              <div className="space-y-4 p-6">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={open.rank <= 3 ? "positive" : "neutral"}>
                    Rank {open.rank}
                  </Badge>
                  <Badge>
                    {PLATFORM[open.platform?.toLowerCase()]?.label ??
                      open.platform}
                  </Badge>
                  {clips.data?.campaignTitle ? (
                    <Label className="inline">{clips.data.campaignTitle}</Label>
                  ) : null}
                </div>

                <div>
                  <Label>Views</Label>
                  <Numeric size="lg">
                    {nf.format(Number(open.views ?? 0))}
                  </Numeric>
                </div>

                {/* The board is anonymous by design — getCampaignTopClips
                    returns no clipper and no reward, so neither is shown. */}
                {!open.videoUrl ? (
                  <p className="text-[11px] text-muted-foreground">
                    This clip is still being prepared for playback.
                  </p>
                ) : null}
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  );
};

export default TopClipsBoard;
