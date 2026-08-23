import { Badge, Card, Empty, Label, Loading, SectionTitle } from "@/components/ds";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useAuth } from "@/hooks/useAuth";
import { useCampaignsData } from "@/hooks/useCampaignsData";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import type { inferRouterOutputs } from "@trpc/server";
import { formatDistanceToNow } from "date-fns";
import { AlertTriangle, ChevronRight, Megaphone, Radio } from "lucide-react";
import { useMemo, useState } from "react";
import type { AppRouter } from "../../../../backend/src/routers";

type Announcement =
  inferRouterOutputs<AppRouter>["notifications"]["getAnnouncements"][number];

// Only the two tones the announcement metadata can carry today.
const TONE = {
  announcement: {
    label: "Announcement",
    icon: Megaphone,
    badge: "neutral" as const,
  },
  "issue-alert": {
    label: "Issue alert",
    icon: AlertTriangle,
    badge: "warning" as const,
  },
};

const toneOf = (a: Announcement) =>
  TONE[(a.metadata?.type as keyof typeof TONE) ?? "announcement"] ??
  TONE.announcement;

// ─────────────────────────────────────────────────────────────────────────────
// CAMPAIGN-SCOPED ANNOUNCEMENTS
//
// Announcements are global today: `createAnnouncement` takes only
// { title, description, type, expiresMinutes } and every signed-in user sees
// every row. Those are the Discord posts.
//
// To scope one to a campaign, the backend needs to carry a campaign id on the
// announcement. The cheapest way in is METADATA — it is already a JSON column
// that already holds `type`, so this needs no migration:
//
//   createAnnouncement  input   + campaignId?: string
//                       stores  metadata = { type, campaignId }
//
// Nothing else has to change server-side. `getAnnouncements` keeps returning
// every row and the filtering happens here, because the client already knows
// which campaigns this clipper is in and the server would need a join to work
// it out. If the announcement volume ever gets large, move the filter into the
// procedure — the shape below will not need to change.
//
// Read with a cast because the generated metadata type does not know about
// campaignId until that input lands. It reads as undefined until then, which
// means every existing announcement keeps behaving exactly as it does today.
// ─────────────────────────────────────────────────────────────────────────────
const campaignIdOf = (a: Announcement): string | null => {
  const raw = (a.metadata as { campaignId?: unknown } | null)?.campaignId;
  return typeof raw === "string" && raw.length > 0 ? raw : null;
};

type Scoped = {
  announcement: Announcement;
  /** null = platform-wide (the Discord posts). */
  campaignTitle: string | null;
};

/**
 * Dashboard announcements: platform-wide posts plus anything posted to a
 * campaign this clipper has actually joined, in one list, newest first.
 *
 * A campaign post is labelled with the campaign name so it is obvious why it
 * is here and who it applies to. A campaign post for a campaign the clipper is
 * NOT in never renders — including when the campaign list is still loading,
 * which is deliberate: showing it and then removing it is worse than showing
 * it a beat late.
 *
 * NOTE: there is no author on an announcement. The table has id, title,
 * description, metadata, expires_minutes, dismissed_at, created_at — no
 * posted-by column. So "who posted it" cannot be shown without a schema
 * change; the date is shown, the author is not invented.
 */
export const AnnouncementsPanel = () => {
  const { user } = useAuth();
  const { data, isLoading, error } =
    trpc.notifications.getAnnouncements.useQuery(undefined, {
      enabled: Boolean(user),
    });

  // Which campaigns this clipper is in. Rewards rows are the membership
  // record — a clipper has a row per campaign they have earned against.
  const { data: myRewards, isLoading: rewardsLoading } =
    trpc.rewards.getMyCampaignRewards.useQuery(undefined, {
      enabled: Boolean(user),
    });
  const { data: campaigns } = useCampaignsData();

  const [open, setOpen] = useState<Scoped | null>(null);
  const [showCampaignOnly, setShowCampaignOnly] = useState(false);

  const myCampaignIds = useMemo(
    () => new Set((myRewards ?? []).map((r) => r.campaignId)),
    [myRewards]
  );

  const titleById = useMemo(() => {
    const map = new Map<string, string>();
    (campaigns ?? []).forEach((c) => map.set(c.id, c.title));
    return map;
  }, [campaigns]);

  const scoped = useMemo<Scoped[]>(() => {
    return (data ?? []).flatMap((announcement) => {
      const campaignId = campaignIdOf(announcement);
      if (!campaignId) {
        return [{ announcement, campaignTitle: null }];
      }
      // Campaign post: only for members of that campaign.
      if (!myCampaignIds.has(campaignId)) return [];
      return [
        {
          announcement,
          campaignTitle: titleById.get(campaignId) ?? "Campaign",
        },
      ];
    });
  }, [data, myCampaignIds, titleById]);

  const campaignCount = scoped.filter((s) => s.campaignTitle).length;
  const visible = showCampaignOnly
    ? scoped.filter((s) => s.campaignTitle)
    : scoped;

  if (!user || error) return null;

  const [latest, ...older] = visible;
  // Campaign posts are held back until membership is known, so keep the
  // spinner up until both queries have answered.
  const busy = isLoading || rewardsLoading;

  const SourceTag = ({ campaignTitle }: { campaignTitle: string | null }) =>
    campaignTitle ? (
      <Badge tone="neutral">
        <span className="truncate">{campaignTitle}</span>
      </Badge>
    ) : (
      <Label className="inline-flex items-center gap-1.5">
        <Radio className="h-3 w-3" /> Discord
      </Label>
    );

  return (
    <section className="space-y-6">
      <SectionTitle
        meta={
          visible.length
            ? `${visible.length} ${visible.length === 1 ? "post" : "posts"}`
            : undefined
        }
      >
        Announcements
      </SectionTitle>

      {/* Only offered when there is something to filter to. A toggle that
          always shows but does nothing is worse than no toggle. */}
      {campaignCount > 0 ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setShowCampaignOnly(false)}
            aria-pressed={!showCampaignOnly}
            className={cn(
              "rounded-full border px-3.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] transition-colors",
              !showCampaignOnly
                ? "border-foreground bg-foreground text-background"
                : "border-border text-muted-foreground hover:border-foreground/40"
            )}
          >
            All
          </button>
          <button
            type="button"
            onClick={() => setShowCampaignOnly(true)}
            aria-pressed={showCampaignOnly}
            className={cn(
              "rounded-full border px-3.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] transition-colors",
              showCampaignOnly
                ? "border-foreground bg-foreground text-background"
                : "border-border text-muted-foreground hover:border-foreground/40"
            )}
          >
            My campaigns ({campaignCount})
          </button>
        </div>
      ) : null}

      {busy ? (
        <Loading label="Loading announcements" />
      ) : visible.length === 0 ? (
        <Empty>
          {showCampaignOnly
            ? "Nothing from your campaigns right now."
            : "Nothing announced right now. New campaigns and payout updates will show up here."}
        </Empty>
      ) : (
        <div className="space-y-3">
          {/* Latest, opened out — the one thing worth reading now. */}
          {latest ? (
            <Card className="p-5">
              <button
                type="button"
                onClick={() => setOpen(latest)}
                className="w-full text-left"
              >
                <div className="flex items-start gap-4">
                  <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-muted">
                    {(() => {
                      const Icon = toneOf(latest.announcement).icon;
                      return <Icon className="h-4 w-4" />;
                    })()}
                  </span>

                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={toneOf(latest.announcement).badge}>
                        {toneOf(latest.announcement).label}
                      </Badge>
                      <SourceTag campaignTitle={latest.campaignTitle} />
                      <Label className="inline">
                        {formatDistanceToNow(
                          new Date(latest.announcement.createdAt),
                          { addSuffix: true }
                        )}
                      </Label>
                    </div>
                    <p className="text-base font-semibold">
                      {latest.announcement.title}
                    </p>
                    <p className="line-clamp-2 text-sm leading-relaxed text-muted-foreground">
                      {latest.announcement.description}
                    </p>
                  </div>

                  <ChevronRight className="mt-3 h-4 w-4 shrink-0 text-muted-foreground" />
                </div>
              </button>
            </Card>
          ) : null}

          {/* Everything older, compact. */}
          {older.length ? (
            <Card className="divide-y divide-border">
              {older.map((row) => {
                const tone = toneOf(row.announcement);
                const Icon = tone.icon;
                return (
                  <button
                    key={row.announcement.id}
                    type="button"
                    onClick={() => setOpen(row)}
                    className={cn(
                      "flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors",
                      "hover:bg-muted/40 focus-visible:outline-none focus-visible:bg-muted/40"
                    )}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {row.announcement.title}
                    </span>
                    {row.campaignTitle ? (
                      <span className="hidden max-w-[9rem] shrink-0 truncate rounded-full border border-border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground sm:inline">
                        {row.campaignTitle}
                      </span>
                    ) : null}
                    <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      {formatDistanceToNow(
                        new Date(row.announcement.createdAt),
                        { addSuffix: true }
                      )}
                    </span>
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  </button>
                );
              })}
            </Card>
          ) : null}
        </div>
      )}

      <Dialog open={Boolean(open)} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto rounded-3xl border-border bg-card">
          {open ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={toneOf(open.announcement).badge}>
                  {toneOf(open.announcement).label}
                </Badge>
                <SourceTag campaignTitle={open.campaignTitle} />
                <Label className="inline">
                  {new Date(open.announcement.createdAt).toLocaleString()}
                </Label>
              </div>
              <h2 className="display-heading text-2xl leading-tight">
                {open.announcement.title}
              </h2>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/80">
                {open.announcement.description}
              </p>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  );
};

export default AnnouncementsPanel;
