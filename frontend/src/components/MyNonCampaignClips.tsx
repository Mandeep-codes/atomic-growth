import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { format } from "date-fns";
import { ExternalLink, Loader2 } from "lucide-react";
import { useMemo } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// MY NON-CAMPAIGN CLIPS
//
// Non-campaign clips go through the same moderator queue as campaign clips and
// end up in the same three states, but the clipper could only ever see them as
// a number on a counter — the rows lived in the admin screens and nowhere else.
// When one was rejected, their coverage silently disappeared: no row, no
// reason, no date. This is the missing half of "My Campaigns".
//
// It renders nothing at all when the clipper has never posted one, so it stays
// invisible for everyone on campaigns that don't use the ratio.
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_CLASSES: Record<string, string> = {
  approved: "bg-green-500/10 text-green-600 ring-1 ring-green-500/20",
  pending:
    "bg-amber-500/10 text-amber-600 ring-1 ring-amber-500/20 dark:bg-amber-500/20 dark:text-amber-400 dark:ring-amber-500/30",
  rejected:
    "bg-red-500/10 text-red-600 ring-1 ring-red-500/20 dark:bg-red-500/20 dark:text-red-400 dark:ring-red-500/30",
};

// "Pending" is what the database calls it; "Under review" is what it means to
// the person waiting. The other two already say what they mean.
const STATUS_LABEL: Record<string, string> = {
  approved: "Approved",
  pending: "Under review",
  rejected: "Rejected",
};

const compact = (n: number) =>
  new Intl.NumberFormat("en-US", { notation: "compact" }).format(n ?? 0);

export const MyNonCampaignClips = () => {
  const { data, isLoading } =
    trpc.submissions.getMyNonCampaignClips.useQuery(undefined);

  const clips = useMemo(() => data ?? [], [data]);

  const counts = useMemo(() => {
    const acc = { pending: 0, approved: 0, rejected: 0 };
    for (const clip of clips) {
      const status = clip.status?.toLowerCase();
      if (status === "pending") acc.pending += 1;
      else if (status === "approved") acc.approved += 1;
      else if (status === "rejected") acc.rejected += 1;
    }
    return acc;
  }, [clips]);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading your non-campaign clips…
      </div>
    );
  }

  // Never posted one — nothing to explain, so show nothing.
  if (clips.length === 0) return null;

  return (
    <section className="space-y-4">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-2xl font-semibold text-foreground">
            Non-campaign clips
          </h2>
          <div className="flex flex-wrap gap-2">
            {counts.pending > 0 ? (
              <Badge className={STATUS_CLASSES.pending} variant="outline">
                {counts.pending} under review
              </Badge>
            ) : null}
            {counts.approved > 0 ? (
              <Badge className={STATUS_CLASSES.approved} variant="outline">
                {counts.approved} approved
              </Badge>
            ) : null}
            {counts.rejected > 0 ? (
              <Badge className={STATUS_CLASSES.rejected} variant="outline">
                {counts.rejected} rejected
              </Badge>
            ) : null}
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          These are the clips you posted to cover your campaign clips. A
          moderator reviews each one, and only an approved clip counts as
          cover.
        </p>
      </header>

      <Card className="divide-y divide-border overflow-hidden rounded-[28px]">
        {clips.map((clip) => {
          const status = clip.status?.toLowerCase() ?? "pending";
          return (
            <div key={clip.id} className="space-y-2 px-5 py-4">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <Badge
                  className={STATUS_CLASSES[status] ?? ""}
                  variant="outline"
                >
                  {STATUS_LABEL[status] ?? clip.status}
                </Badge>

                <span className="text-sm font-medium text-foreground">
                  {clip.campaign_title ?? "Campaign"}
                </span>

                {clip.handle ? (
                  <span className="text-xs text-muted-foreground">
                    @{clip.handle}
                  </span>
                ) : null}

                <span className="text-xs capitalize text-muted-foreground">
                  {clip.platform}
                </span>

                <span className="ml-auto flex items-center gap-3">
                  <span className="text-xs text-muted-foreground">
                    {compact(clip.views ?? 0)} views
                  </span>
                  <a
                    href={clip.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted-foreground transition-colors hover:text-foreground"
                    aria-label="Open clip"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </span>
              </div>

              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>
                  Posted {format(new Date(clip.created_at), "d MMM yyyy")}
                </span>
                {/* The honest answer to "has anyone looked at this yet?" —
                    a pending clip has no review date, and saying so beats
                    leaving the clipper to guess. */}
                {clip.reviewed_at ? (
                  <span>
                    Reviewed{" "}
                    {format(new Date(clip.reviewed_at), "d MMM yyyy")}
                  </span>
                ) : status === "pending" ? (
                  <span>Not reviewed yet</span>
                ) : null}
                {status === "approved" && (clip.creditRemaining ?? 0) > 0 ? (
                  <span>
                    Still covers {clip.creditRemaining} more campaign{" "}
                    {clip.creditRemaining === 1 ? "clip" : "clips"}
                  </span>
                ) : null}
                {/* A post that vanished from the platform is a different
                    thing from a moderator rejecting it, so it is never
                    folded into the rejected badge. */}
                {clip.deleted_at ? (
                  <span className="text-red-600 dark:text-red-400">
                    No longer available on {clip.platform}
                  </span>
                ) : null}
              </div>

              {status === "rejected" && clip.rejectedReason ? (
                <p className="text-xs text-red-600 dark:text-red-400">
                  Reason: {clip.rejectedReason}
                </p>
              ) : null}
            </div>
          );
        })}
      </Card>
    </section>
  );
};

export default MyNonCampaignClips;
