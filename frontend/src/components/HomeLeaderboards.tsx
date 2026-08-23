import { useEffect, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import {
  Trophy,
  Flame,
  Lock,
  Loader2,
  Instagram,
  Music2,
  Twitter,
  Youtube,
  Video,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { formatCurrency } from "@/lib/formatCurrency";

const platformIcon: Record<string, LucideIcon> = {
  instagram: Instagram,
  youtube: Youtube,
  tiktok: Music2,
  x: Twitter,
  twitter: Twitter,
};

const compactViews = (n: number) =>
  new Intl.NumberFormat("en-US", { notation: "compact" }).format(n ?? 0);

// Medal tints keep their meaning but need a dark counterpart — the pastel
// chips were solid light blocks against the redesign's black page.
const rankAccent = (rank: number) =>
  rank === 1
    ? "bg-amber-100 text-amber-800 dark:bg-amber-400/15 dark:text-amber-300"
    : rank === 2
      ? "bg-slate-200 text-slate-700 dark:bg-slate-400/15 dark:text-slate-300"
      : rank === 3
        ? "bg-orange-100 text-orange-800 dark:bg-orange-400/15 dark:text-orange-300"
        : "bg-muted text-muted-foreground";

const TopEarnersBoard = ({ campaignId }: { campaignId: string | null }) => {
  const { data, isLoading } = trpc.leaderboard.getTopEarners.useQuery(
    { campaignId: campaignId ?? "" },
    { enabled: Boolean(campaignId) }
  );
  const earners = data?.earners ?? [];

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Trophy className="h-5 w-5 text-amber-500" /> Top earners
        </CardTitle>
        <CardDescription>
          The 10 highest-earning clippers in this campaign.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!campaignId || isLoading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" /> Loading…
          </div>
        ) : earners.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            No earners in this campaign yet.
          </p>
        ) : (
          <ol className="space-y-2">
            {earners.map((e) => (
              <li
                key={e.rank}
                className="flex items-center justify-between rounded-lg border bg-background px-3 py-2"
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold ${rankAccent(
                      e.rank
                    )}`}
                  >
                    {e.rank}
                  </span>
                  <span className="font-medium">{e.username}</span>
                </div>
                <span className="font-semibold text-foreground">
                  {formatCurrency(e.totalEarned)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
};

const ClipTile = ({
  rank,
  platform,
  views,
  videoUrl,
  thumbnailUrl,
  isHosted,
}: {
  rank: number;
  platform: string;
  views: number;
  videoUrl: string | null;
  thumbnailUrl: string | null;
  isHosted: boolean;
}) => {
  const Icon = platformIcon[platform] ?? Video;
  return (
    <div className="overflow-hidden rounded-2xl border bg-background shadow-sm">
      <div className="relative aspect-[9/16] bg-muted">
        {isHosted && videoUrl ? (
          // src directly on <video> (no <source type>) so the browser plays
          // by the served Content-Type — correct even for a rare non-mp4
          // container.
          <video
            className="h-full w-full object-cover"
            src={videoUrl}
            controls
            // Hide the browser's built-in download (and picture-in-picture /
            // speed) controls so clippers can't pull the source file from the
            // player. Right-click "Save video as…" is blocked too. (Not DRM —
            // a determined user can still read the network tab — but it removes
            // the one-click download the player otherwise offers.)
            controlsList="nodownload noplaybackrate noremoteplayback"
            disablePictureInPicture
            onContextMenu={(e) => e.preventDefault()}
            playsInline
            preload="none"
            poster={thumbnailUrl ?? undefined}
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
            <span className="text-xs">Preparing clip…</span>
          </div>
        )}
        <span
          className={`absolute left-2 top-2 flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold ${rankAccent(
            rank
          )}`}
        >
          {rank}
        </span>
      </div>
      <div className="flex items-center justify-between px-3 py-2">
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Icon className="h-4 w-4" /> {platform}
        </span>
        <span className="text-sm font-semibold">
          {compactViews(views)} views
        </span>
      </div>
    </div>
  );
};

const TopClipsBoard = ({ campaignId }: { campaignId: string | null }) => {
  const { data, isLoading } = trpc.leaderboard.getCampaignTopClips.useQuery(
    { campaignId: campaignId ?? "" },
    { enabled: Boolean(campaignId) }
  );
  const clips = data?.clips ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Flame className="h-5 w-5 text-orange-500" /> Top clips
        </CardTitle>
        <CardDescription>
          The best-performing clips in this campaign. See what's working.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!campaignId || isLoading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" /> Loading clips…
          </div>
        ) : clips.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            No clips in this campaign yet.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {clips.map((clip) => (
              <ClipTile key={clip.rank} {...clip} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export const HomeLeaderboards = () => {
  // Master switch: if an admin turned the leaderboard off, render nothing.
  const { data: enabledData, isLoading: enabledLoading } =
    trpc.leaderboard.isLeaderboardEnabled.useQuery();
  const leaderboardOn = enabledData?.enabled ?? false;

  // The campaign list depends on WHO is asking (an approved clipper also gets
  // their private campaigns), so it must not run until Clerk has resolved —
  // otherwise the first fetch goes out tokenless and the public-only answer
  // gets cached for the whole session.
  const { isLoaded: authLoaded, isSignedIn } = useAuth();
  const utils = trpc.useUtils();

  // One selector drives BOTH boards — the clips and the earners are always
  // for the same campaign.
  const { data: campaigns, isLoading: campaignsLoading } =
    trpc.leaderboard.listCampaigns.useQuery(undefined, {
      enabled: leaderboardOn && authLoaded,
    });
  const [campaignId, setCampaignId] = useState<string | null>(null);

  // Signing in or out changes which campaigns are visible, but the query key
  // doesn't include identity — so drop the cached boards on any auth flip.
  useEffect(() => {
    if (authLoaded) void utils.leaderboard.invalidate();
  }, [isSignedIn, authLoaded, utils]);

  // Keep the selection valid: if the selected campaign disappears (e.g. the
  // viewer signed out of a private board), fall back to the first available.
  useEffect(() => {
    if (!campaigns || campaigns.length === 0) return;
    if (!campaignId || !campaigns.some((c) => c.id === campaignId)) {
      setCampaignId(campaigns[0]!.id);
    }
  }, [campaigns, campaignId]);

  // While we don't yet know, or when it's off, show nothing.
  if (enabledLoading || !leaderboardOn) {
    return null;
  }

  if (!campaignsLoading && (campaigns ?? []).length === 0) {
    return null; // No campaign this viewer can see a leaderboard for.
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-semibold text-foreground">Leaderboards</h2>
        <Select
          value={campaignId ?? undefined}
          onValueChange={(v) => setCampaignId(v)}
        >
          <SelectTrigger className="w-full sm:w-[260px]">
            <SelectValue
              placeholder={
                campaignsLoading ? "Loading campaigns…" : "Pick a campaign"
              }
            />
          </SelectTrigger>
          <SelectContent>
            {(campaigns ?? []).map((c) => (
              <SelectItem key={c.id} value={c.id}>
                <span className="flex items-center gap-1.5">
                  {c.isPrivate && (
                    <Lock className="h-3 w-3 text-muted-foreground" />
                  )}
                  {c.title}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <TopClipsBoard campaignId={campaignId} />
        <TopEarnersBoard campaignId={campaignId} />
      </div>
    </section>
  );
};

export default HomeLeaderboards;
