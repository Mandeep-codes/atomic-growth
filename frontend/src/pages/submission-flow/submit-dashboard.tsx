import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage } from "@/components/ui/avatar";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Loader2,
  Sparkles,
  AlertTriangle,
  Plus,
} from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useEffect } from "react";
import { useSubmissionFlowCampaign } from "./useSubmissionFlowCampaign";
import { trpc } from "@/lib/trpc";

// Single landing page for the clipper after they click "Submit clip" on
// a campaign card. Replaces the old step-1 → step-2 flow as the entry
// point: shows a card per verified account on the campaign's allowed
// platforms, each with its current ledger state and clear "Submit
// campaign clip on @X" / "Submit non-campaign clip on @X" actions.
const SubmitDashboard = () => {
  const { campaignId } = useParams();
  const navigate = useNavigate();
  const currentCampaignId = campaignId ?? "";

  const { data: campaignData, isLoading: campaignLoading } =
    useSubmissionFlowCampaign(currentCampaignId);
  const { data: dashboard, isLoading: dashboardLoading } =
    trpc.submissions.getCampaignAccountDashboard.useQuery(
      { campaign_id: currentCampaignId },
      { enabled: Boolean(currentCampaignId) }
    );

  const campaignTitle = campaignData?.title ?? "Submit a clip";
  const enabled = dashboard?.enabled ?? false;
  const cap = dashboard?.cap ?? 0;
  const perAccount = dashboard?.perAccount ?? [];

  // Feature-off fallback: if this campaign does NOT require non-campaign clips
  // (non_campaign_clips_required = 0 / null), the dashboard's per-account
  // picker adds zero value — the clipper just needs to paste a URL like in
  // the old flow. Auto-forward to step-1 so feature-off campaigns are
  // indistinguishable from the pre-redemption experience. We wait for the
  // dashboard query to resolve so we don't flicker.
  useEffect(() => {
    if (!currentCampaignId) return;
    if (dashboardLoading || !dashboard) return;
    if (dashboard.enabled === false) {
      navigate(`/campaign/${currentCampaignId}/step-1`, { replace: true });
    }
  }, [currentCampaignId, dashboard, dashboardLoading, navigate]);

  if (campaignLoading || dashboardLoading) {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Loading…</CardTitle>
        </CardHeader>
        <CardContent>
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  // Campaign paused new submissions: no link inputs at all, just the notice.
  if (campaignData?.submissionsPaused) {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="text-2xl font-semibold">
            {campaignTitle}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Not accepting submissions right now</AlertTitle>
            <AlertDescription>
              This campaign has paused new clip submissions. Your
              already-submitted clips are unaffected and keep counting —
              check back later.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="text-2xl font-semibold">
          Submit a clip
        </CardTitle>
        <CardDescription>
          <span className="inline-flex items-center gap-2">
            {campaignData?.imageUrl ? (
              <Avatar className="h-8 w-8">
                <AvatarImage
                  src={campaignData?.imageUrl}
                  alt={`${campaignTitle} avatar`}
                />
              </Avatar>
            ) : null}
            <span>{campaignTitle}</span>
          </span>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Top-of-page rule explanation */}
        {enabled ? (
          <Alert>
            <Sparkles className="h-4 w-4" />
            <AlertTitle>Non-campaign clip rule</AlertTitle>
            <AlertDescription>
              Each <strong>non-campaign clip covers up to {cap} campaign
              clips</strong> from that same account — post it{" "}
              <strong>before or after those clips, the order doesn't
              matter</strong>. Posting one early covers what you have and banks
              the rest for your next clips, so the counter dropping to 0 means
              you're fully covered, not reset. Each account tracks separately.
            </AlertDescription>
          </Alert>
        ) : null}

        {/* Empty state: clipper has no verified accounts on this campaign's platforms. */}
        {perAccount.length === 0 ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>No verified account</AlertTitle>
            <AlertDescription>
              You haven't verified a{" "}
              {campaignData?.allowedPlatforms?.join(" / ") ?? "supported"}{" "}
              account for this campaign yet. Verify one to start submitting
              clips.
              <div className="mt-3">
                <Button asChild>
                  <Link to="/verification">Manage verified accounts</Link>
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        ) : null}

        {/* One card per verified account. Color-coded by state. */}
        <div className="grid gap-3">
          {perAccount.map((acc) => {
            const blocked = enabled && acc.mustRedeem;
            const oneAway = enabled && acc.allowedRemaining === 1;
            // Never render a count above the cap ("5 of 3"): the raw unredeemed
            // bucket can transiently exceed the cap (e.g. a rejected
            // non-campaign clip re-uncovers clips). The gate is mustRedeem, not
            // the printed number, so clamping the display is safe.
            const shown = Math.min(acc.unredeemed, acc.cap);
            // State is carried by a left accent bar and the badge, not by a
            // full pastel fill — the filled cards read as error boxes even in
            // the healthy case, and three saturated backgrounds fight the
            // monochrome surface. Same three states, same conditions.
            const accentClass = blocked
              ? "before:bg-destructive"
              : oneAway
              ? "before:bg-amber-500"
              : "before:bg-emerald-500";

            return (
              <div
                key={acc.verifiedUserId}
                className={`relative overflow-hidden rounded-2xl border border-border bg-card p-4 pl-5 before:absolute before:inset-y-0 before:left-0 before:w-1 before:content-[''] ${accentClass}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-lg font-semibold">
                      @{acc.handle || "unknown"}
                      <Badge variant="outline" className="text-xs capitalize">
                        {acc.platform}
                      </Badge>
                      {blocked ? (
                        <Badge variant="destructive" className="text-xs">
                          AT CAP
                        </Badge>
                      ) : enabled ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      ) : null}
                    </div>
                    {enabled ? (
                      <p className="text-sm text-muted-foreground">
                        {blocked ? (
                          <>
                            {shown} of {acc.cap} toward your next non-campaign
                            clip — submit a non-campaign clip from @
                            {acc.handle} to continue.
                          </>
                        ) : (
                          <>
                            {shown} of {acc.cap} toward your next non-campaign
                            clip — {acc.allowedRemaining} more campaign{" "}
                            {acc.allowedRemaining === 1 ? "clip" : "clips"}{" "}
                            before one is required.
                          </>
                        )}
                        {/* Without this line the counter is unreadable. A clip
                            submitted while an earlier non-campaign clip still
                            has credit is covered the instant it lands, so the
                            number never moves and clippers report it as "the
                            app isn't counting my videos" — then resubmit the
                            same link and hit "already submitted". */}
                        {acc.covered > 0 ? (
                          <>
                            {" "}
                            <span className="text-foreground">
                              {acc.covered} earlier{" "}
                              {acc.covered === 1 ? "clip is" : "clips are"}{" "}
                              already covered and no longer counted here.
                            </span>
                          </>
                        ) : null}
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    asChild
                    disabled={blocked}
                    variant={blocked ? "outline" : "default"}
                    size="sm"
                  >
                    {blocked ? (
                      <span className="cursor-not-allowed opacity-60">
                        <Plus className="mr-1 h-4 w-4" />
                        Submit campaign clip on @{acc.handle}
                      </span>
                    ) : (
                      <Link
                        to={`/campaign/${currentCampaignId}/step-1?verifiedHandle=${encodeURIComponent(
                          acc.handle
                        )}&platform=${encodeURIComponent(acc.platform)}`}
                      >
                        <Plus className="mr-1 h-4 w-4" />
                        Submit campaign clip on @{acc.handle}
                        <ArrowRight className="ml-1 h-4 w-4" />
                      </Link>
                    )}
                  </Button>

                  {enabled ? (
                    <Button
                      asChild
                      variant={blocked ? "default" : "outline"}
                      size="sm"
                    >
                      <Link
                        to={`/campaign/${currentCampaignId}/non-campaign?verifiedHandle=${encodeURIComponent(
                          acc.handle
                        )}&platform=${encodeURIComponent(acc.platform)}`}
                      >
                        <Plus className="mr-1 h-4 w-4" />
                        Submit non-campaign clip on @{acc.handle}
                      </Link>
                    </Button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>

        {enabled && perAccount.some((a) => a.mustRedeem) ? (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>At least one account is at the cap</AlertTitle>
            <AlertDescription>
              The accounts shown in red can't accept more campaign clips
              until you post a non-campaign clip from that same account.
              Until you do, those campaign clips won't pay.
            </AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  );
};

export default SubmitDashboard;
