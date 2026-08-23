import { useState } from "react";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Flame,
  Wrench,
  Youtube,
  LayoutList,
} from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

type ClipResult = {
  ytdlp: {
    available: boolean;
    version: string | null;
    error?: string;
    youtube: {
      enabled: boolean;
      configured: boolean;
      keySource: "db" | "youtube-env" | "main-env";
      host: string;
    };
  };
  consideredUnhosted: number;
  results: { id: string; url: string; ok: boolean; detail: string }[];
};

export default function AdminLeaderboardTools() {
  const { toast } = useToast();
  const [clipResult, setClipResult] = useState<ClipResult | null>(null);

  const ytdlpQuery = trpc.leaderboard.checkYtDlp.useQuery();

  const clipMutation = trpc.leaderboard.runClipHostingNow.useMutation({
    onSuccess: (r) => {
      setClipResult(r);
      const ok = r.results.filter((x) => x.ok).length;
      toast({
        title: `Hosted ${ok}/${r.results.length} clips`,
        description: r.ytdlp.available
          ? `yt-dlp ${r.ytdlp.version} is installed.`
          : "yt-dlp is NOT installed — see below.",
        variant: r.ytdlp.available ? undefined : "destructive",
      });
    },
    onError: (e) =>
      toast({ title: "Clip hosting failed", description: e.message, variant: "destructive" }),
  });

  const utilsForRehost = trpc.useUtils();
  const rehostMutation = trpc.leaderboard.rehostClips.useMutation({
    onSuccess: (r) => {
      utilsForRehost.leaderboard.checkYtDlp.invalidate();
      toast({
        title: `Cleared ${r.cleared} clip(s) to re-encode`,
        description:
          "They'll re-host in the mobile-safe format on the next run — click \"Host up to 3 clips now\" a few times to speed it up.",
      });
    },
    onError: (e) =>
      toast({ title: "Couldn't re-host", description: e.message, variant: "destructive" }),
  });

  // Leaderboard master switch + YouTube hosting switch + optional key.
  const utils = trpc.useUtils();
  const settingsQuery = trpc.leaderboard.getHostingSettings.useQuery();
  const [keyInput, setKeyInput] = useState("");
  const settingsMutation = trpc.leaderboard.setHostingSettings.useMutation({
    onSuccess: () => {
      utils.leaderboard.getHostingSettings.invalidate();
      utils.leaderboard.checkYtDlp.invalidate();
      utils.leaderboard.isLeaderboardEnabled.invalidate();
    },
    onError: (e) =>
      toast({ title: "Couldn't save", description: e.message, variant: "destructive" }),
  });
  const settings = settingsQuery.data;

  const ytdlp = ytdlpQuery.data;

  return (
    <AppLayout>
      <div className="min-h-screen bg-muted/40 py-10 px-4">
        <div className="mx-auto flex max-w-3xl flex-col gap-6">
          <div className="space-y-1">
            <p className="text-sm uppercase tracking-wide text-muted-foreground">
              Admin • Leaderboard tools
            </p>
            <h1 className="flex items-center gap-2 text-3xl font-semibold">
              <Wrench className="h-7 w-7" /> Leaderboard tools
            </h1>
            <p className="text-muted-foreground">
              Run the two scheduled leaderboard jobs on demand — useful right
              after a deploy, or to check why a board is empty.
            </p>
          </div>

          {/* Master switch — show/hide the entire home-page leaderboard */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <LayoutList className="h-5 w-5" /> Leaderboard on the home page
              </CardTitle>
              <CardDescription>
                Turns the whole leaderboard section on the home page on or off —
                both the top clips and the top earners. Off means visitors see
                no leaderboard at all.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {settingsQuery.isLoading ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" /> Loading…
                </div>
              ) : (
                <div className="flex items-center justify-between gap-4 rounded-lg border bg-background p-3">
                  <div>
                    <Label htmlFor="lb-switch" className="text-base">
                      Show the leaderboard
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      {settings?.leaderboardEnabled
                        ? "On — the leaderboard is visible on the home page."
                        : "Off — the whole leaderboard is hidden from the home page."}
                    </p>
                  </div>
                  <Switch
                    id="lb-switch"
                    checked={Boolean(settings?.leaderboardEnabled)}
                    disabled={settingsMutation.isPending}
                    onCheckedChange={(checked) => {
                      settingsMutation.mutate(
                        { leaderboardEnabled: checked },
                        {
                          onSuccess: () =>
                            toast({
                              title: checked
                                ? "Leaderboard shown"
                                : "Leaderboard hidden",
                            }),
                        }
                      );
                    }}
                  />
                </div>
              )}
            </CardContent>
          </Card>

          {/* yt-dlp status (Instagram / TikTok / X) */}
          <Card>
            <CardHeader>
              <CardTitle>Downloader status (Instagram / TikTok / X)</CardTitle>
              <CardDescription>
                These platforms use yt-dlp, which must be installed in the
                running container. YouTube is separate — see the card below.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {ytdlpQuery.isLoading ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" /> Checking…
                </div>
              ) : ytdlp?.available ? (
                <div className="flex items-center gap-2 text-emerald-700">
                  <CheckCircle2 className="h-5 w-5" /> yt-dlp is installed
                  (version {ytdlp.version}).
                </div>
              ) : (
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-red-700">
                    <XCircle className="h-5 w-5" /> yt-dlp is NOT installed in
                    this deploy.
                  </div>
                  <p className="text-sm text-muted-foreground">
                    The Docker image wasn't rebuilt with yt-dlp. Rebuild the
                    container (don't just restart it) and redeploy.
                    {ytdlp?.error ? ` (${ytdlp.error})` : ""}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* YouTube hosting — on/off switch + optional separate key */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Youtube className="h-5 w-5 text-red-600" /> YouTube clip hosting
              </CardTitle>
              <CardDescription>
                YouTube blocks our server, so YouTube clips are fetched through a
                paid RapidAPI downloader. Keep this OFF until you've subscribed
                to the downloader on RapidAPI. Instagram / TikTok / X are not
                affected by this switch.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {settingsQuery.isLoading ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" /> Loading…
                </div>
              ) : (
                <>
                  {/* On/off switch */}
                  <div className="flex items-center justify-between gap-4 rounded-lg border bg-background p-3">
                    <div>
                      <Label htmlFor="yt-switch" className="text-base">
                        Host YouTube clips
                      </Label>
                      <p className="text-sm text-muted-foreground">
                        {settings?.youtubeEnabled
                          ? "On — new YouTube top clips will be downloaded."
                          : "Off — YouTube clips stay on \"Preparing\" and cost nothing."}
                      </p>
                    </div>
                    <Switch
                      id="yt-switch"
                      checked={Boolean(settings?.youtubeEnabled)}
                      disabled={settingsMutation.isPending}
                      onCheckedChange={(checked) => {
                        settingsMutation.mutate(
                          { youtubeEnabled: checked },
                          {
                            onSuccess: () =>
                              toast({
                                title: checked
                                  ? "YouTube hosting turned ON"
                                  : "YouTube hosting turned OFF",
                              }),
                          }
                        );
                      }}
                    />
                  </div>

                  {/* Warn when the key in use is NOT the dedicated YouTube one */}
                  {settings?.youtubeEnabled &&
                    settings?.keySource !== "youtube-env" &&
                    settings?.keySource !== "db" && (
                      <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
                        <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                        It's on, but YouTube is using your shared/main key, not a
                        dedicated one. Paste the YouTube RapidAPI key below so
                        downloads use the right account.
                      </div>
                    )}

                  {/* Current key source */}
                  <div className="space-y-1">
                    <Label>RapidAPI key for YouTube</Label>
                    <p className="flex items-center gap-2 text-sm text-muted-foreground">
                      {settings?.keySource === "db" ? (
                        <>
                          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                          Using a key saved here (this beats the env vars).
                        </>
                      ) : settings?.keySource === "youtube-env" ? (
                        <>
                          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                          Using the dedicated YOUTUBE_RAPIDAPI_KEY env var.
                        </>
                      ) : (
                        <>Using the shared RAPIDAPI_KEY (same key as view counts).</>
                      )}
                    </p>
                  </div>

                  {/* Paste a key (saved to the DB — wins over the env vars) */}
                  <div className="space-y-2">
                    <Label htmlFor="yt-key">
                      Paste a YouTube-only RapidAPI key
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      Saved here, it powers YouTube from a separate account and
                      overrides the env vars — no DigitalOcean access needed.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Input
                        id="yt-key"
                        type="password"
                        autoComplete="off"
                        placeholder="Paste RapidAPI key…"
                        value={keyInput}
                        onChange={(e) => setKeyInput(e.target.value)}
                        className="min-w-[220px] flex-1"
                      />
                      <Button
                        onClick={() =>
                          settingsMutation.mutate(
                            { rapidApiKey: keyInput },
                            {
                              onSuccess: () => {
                                setKeyInput("");
                                toast({ title: "Key saved" });
                              },
                            }
                          )
                        }
                        disabled={
                          settingsMutation.isPending || keyInput.trim().length === 0
                        }
                      >
                        Save key
                      </Button>
                      {settings?.keySource === "db" && (
                        <Button
                          variant="outline"
                          onClick={() =>
                            settingsMutation.mutate(
                              { rapidApiKey: "" },
                              {
                                onSuccess: () =>
                                  toast({ title: "Saved key cleared" }),
                              }
                            )
                          }
                          disabled={settingsMutation.isPending}
                        >
                          Clear saved key
                        </Button>
                      )}
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Clip hosting */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Flame className="h-5 w-5 text-orange-500" /> Top clips
              </CardTitle>
              <CardDescription>
                Downloads and hosts up to 3 un-hosted top clips now, and shows
                exactly what happened for each (including any error). May take a
                few seconds per clip.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={() => clipMutation.mutate({ limit: 3 })}
                  disabled={clipMutation.isPending}
                >
                  {clipMutation.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Flame className="mr-2 h-4 w-4" />
                  )}
                  Host up to 3 clips now
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    if (
                      window.confirm(
                        "Re-encode ALL hosted clips for mobile? They'll briefly show \"Preparing\" while they re-host in the mobile-safe format."
                      )
                    ) {
                      rehostMutation.mutate();
                    }
                  }}
                  disabled={rehostMutation.isPending}
                >
                  {rehostMutation.isPending && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  Re-encode existing clips for mobile
                </Button>
              </div>

              {clipResult && (
                <div className="space-y-2 rounded-lg border bg-background p-3 text-sm">
                  <p className="text-muted-foreground">
                    {clipResult.consideredUnhosted === 0
                      ? "No un-hosted top clips were found (they may already be hosted, or there are no eligible campaigns/clips)."
                      : `Attempted ${clipResult.results.length} clip(s).`}
                  </p>
                  {clipResult.results.map((r) => (
                    <div key={r.id} className="flex items-start gap-2">
                      {r.ok ? (
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                      ) : (
                        <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                      )}
                      <span className="break-all">
                        <span className="text-muted-foreground">{r.url}</span>
                        {" — "}
                        {r.detail}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
}
