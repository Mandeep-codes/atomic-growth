import { AppLayout } from "@/components/AppLayout";
import { PrivateCampaignGate } from "@/pages/submission-flow/submission-flow-layout";
import { useSubmissionFlowCampaign } from "@/pages/submission-flow/useSubmissionFlowCampaign";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { AlertCircle, ArrowLeft, Loader2 } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";

// Detects which platform a URL belongs to. Matches the backend regex shapes
// (youtube / instagram / tiktok / x) but only for surface guidance —
// the backend re-validates and decides whether the URL is accepted.
function guessPlatform(
  url: string
): "youtube" | "instagram" | "tiktok" | "x" | null {
  if (!url) return null;
  if (/youtu(be\.com|\.be)\//i.test(url)) return "youtube";
  if (/instagram\.com\//i.test(url)) return "instagram";
  if (/tiktok\.com\//i.test(url)) return "tiktok";
  if (/(x|twitter)\.com\//i.test(url)) return "x";
  return null;
}

function isValidUrl(u: string) {
  try {
    new URL(u);
    return true;
  } catch {
    return false;
  }
}

const NonCampaignClipSubmit = () => {
  const { campaignId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  // Optional account scope hint from the dashboard. Backend re-derives the
  // verified account from the pasted URL, so this is purely for UX clarity.
  const searchParams = new URLSearchParams(location.search);
  const scopedHandle = searchParams.get("verifiedHandle") ?? null;
  const scopedPlatform = searchParams.get("platform") ?? null;

  // Merges the unlocked title/image for approved private-campaign clippers
  // (raw getByIdPublic would show the teaser cover name here).
  const { data: campaign } = useSubmissionFlowCampaign(campaignId);
  const utils = trpc.useUtils();
  const submitMutation = trpc.submissions.submitNonCampaignClip.useMutation();
  // After we redeem, re-read the progress so the success screen tells the
  // clipper whether they still owe more non-campaign clips or whether
  // they're free to go submit a campaign clip.
  const progressQuery = trpc.submissions.getRedemptionProgress.useQuery(
    { campaign_id: campaignId ?? "" },
    { enabled: Boolean(campaignId) }
  );
  const progress = progressQuery.data;

  // Feature-off guard: if the campaign doesn't require non-campaign clips,
  // bounce the clipper to the regular submit dashboard. Reasons we redirect
  // instead of showing the form:
  //   - The backend hard-rejects with "This campaign does not require
  //     non-campaign clips" anyway, so the form is dead UX.
  //   - Bookmarked / shared / search-engine-cached URLs land here for
  //     feature-off campaigns and would otherwise show a misleading form.
  useEffect(() => {
    if (!campaignId) return;
    if (progressQuery.isLoading || progressQuery.isError) return;
    if (progress && progress.enabled === false) {
      navigate(`/campaign/${campaignId}/submit`, { replace: true });
    }
  }, [campaignId, progress, progressQuery.isLoading, progressQuery.isError, navigate]);
  // Aggregate across all the clipper's accounts: are any still at the cap?
  // If yes, we keep showing the "you still owe more" alert; if no, we
  // unblock them with the "submit a campaign clip" CTA.
  const accountsStillBlocked = (progress?.perAccount ?? []).filter(
    (a) => a.mustRedeem
  );
  const anyAccountAtCap = accountsStillBlocked.length > 0;
  const totalUnredeemedAcrossAccounts = (progress?.perAccount ?? []).reduce(
    (sum, a) => sum + a.unredeemed,
    0
  );
  const sharedCap = progress?.perAccount?.[0]?.cap ?? 0;

  const [url, setUrl] = useState("");
  const [debouncedUrl, setDebouncedUrl] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{
    coveredCount: number;
    creditRemaining: number;
    resubmitted: boolean;
  } | null>(null);

  const guessedPlatform = useMemo(() => guessPlatform(url), [url]);
  const validUrl = isValidUrl(url);

  // Debounce the URL so we don't slam the preview endpoint on every keystroke.
  // 600ms is enough to feel responsive after a paste but not query-spam.
  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedUrl(url.trim()), 600);
    return () => window.clearTimeout(id);
  }, [url]);

  // Live preview: backend resolves the platform/handle and tells us whether
  // the URL matches one of the clipper's verified accounts and whether it's
  // already been submitted.
  const previewQuery = trpc.submissions.previewClipUrl.useQuery(
    { url: debouncedUrl, campaign_id: campaignId ?? "" },
    {
      enabled: Boolean(debouncedUrl && validUrl && guessedPlatform),
      refetchOnWindowFocus: false,
      retry: false,
    }
  );
  const preview = previewQuery.data;

  // ── The clip must come from the account this page is scoped to ──
  // previewClipUrl answers "is this ANY of your verified accounts on this
  // platform?", which is the wrong question once the clipper has picked one:
  // a clip from their own @B satisfied it while the header said @A, so they
  // got a green tick and a server rejection on submit. Computed once and used
  // by BOTH the message and the Submit button, so the two cannot drift apart.
  const wrongAccount = Boolean(
    scopedHandle &&
      preview?.matchedVerifiedAccount &&
      preview.matchedVerifiedAccount.handle.toLowerCase() !==
        scopedHandle.toLowerCase()
  );

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!campaignId) return;
    if (!guessedPlatform) {
      setSubmitError(
        "We couldn't detect the platform from your URL. Make sure it's a full YouTube / Instagram / TikTok / X post URL."
      );
      return;
    }
    // Short-circuit the obvious failure cases the preview already knows
    // about — saves a round trip and surfaces a clean inline error.
    if (preview?.alreadySubmitted) {
      setSubmitError(
        preview.alreadySubmittedKind === "campaign"
          ? "This URL has already been submitted as a campaign clip. Each clip can only be submitted once."
          : "This URL has already been submitted as a non-campaign clip. Each clip can only be submitted once."
      );
      return;
    }
    setSubmitError(null);
    try {
      const result = await submitMutation.mutateAsync({
        campaign_id: campaignId,
        url: url.trim(),
        platform: guessedPlatform,
        // The account this page was opened for. Sending it is what stops the
        // clip being banked against a different account of theirs while the
        // one they came here to unblock stays at the cap.
        ...(scopedHandle ? { verified_handle: scopedHandle } : {}),
      });
      setSuccess({
        coveredCount: result.coveredCount,
        creditRemaining: result.creditRemaining,
        resubmitted: result.resubmitted,
      });
      // Invalidate the redemption progress query so both the next page load
      // AND the success screen below reflect the new state immediately.
      await utils.submissions.getRedemptionProgress.invalidate({
        campaign_id: campaignId,
      });
    } catch (err) {
      setSubmitError(
        err instanceof Error
          ? err.message
          : "Could not submit. Please try again."
      );
    }
  };

  return (
    <AppLayout>
      <div className="mx-auto max-w-2xl px-4 py-8">
        <Link
          to={`/campaign/${campaignId}/submit`}
          className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to submission dashboard
        </Link>

        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">Submit a non-campaign clip</CardTitle>
            <CardDescription>
              {campaign?.title
                ? `Unlocks more campaign clips for ${campaign.title}.`
                : "Unlocks more campaign clips for this campaign."}
            </CardDescription>
          </CardHeader>

          {success ? (
            <CardContent>
              {/* The success message branches on whether the clipper is now
                  unblocked (allowedRemaining > 0) or still owes more
                  non-campaign clips. Showing the wrong CTA — e.g. "Submit a
                  campaign clip" when they're still at the cap — sends them
                  back to step-2 which loops them back here, which is the
                  exact confusion Pranav called out. */}
              {progress?.enabled && anyAccountAtCap ? (
                <Alert variant="destructive">
                  <AlertTitle>Submitted — but you still owe more</AlertTitle>
                  <AlertDescription>
                    Your non-campaign clip covered{" "}
                    <strong>{success.coveredCount}</strong> earlier campaign
                    clip{success.coveredCount === 1 ? "" : "s"}, but{" "}
                    <strong>{accountsStillBlocked.length}</strong> of your
                    accounts {accountsStillBlocked.length === 1 ? "is" : "are"}{" "}
                    still at the cap:
                    <ul className="mt-2 list-disc pl-5">
                      {accountsStillBlocked.map((a) => (
                        <li key={a.verifiedUserId}>
                          <strong>@{a.handle}</strong> ({a.platform}):{" "}
                          {a.unredeemed} unredeemed — needs a non-campaign
                          clip from this same account.
                        </li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              ) : (
                <Alert>
                  <AlertTitle>Submitted</AlertTitle>
                  <AlertDescription>
                    {success.resubmitted
                      ? "Your previously rejected non-campaign clip was resubmitted and is back in the review queue."
                      : "Your non-campaign clip is in."}{" "}
                    {success.coveredCount > 0 ? (
                      <>
                        It covered <strong>{success.coveredCount}</strong>{" "}
                        campaign clip
                        {success.coveredCount === 1 ? "" : "s"} you'd already
                        submitted (they're now eligible for payout).
                      </>
                    ) : (
                      <>You didn't have any unredeemed campaign clips — this
                      one will cover your next campaign submission
                      {success.creditRemaining === 1 ? "" : "s"}.</>
                    )}{" "}
                    {success.creditRemaining > 0 ? (
                      <>
                        You can now submit{" "}
                        <strong>{success.creditRemaining}</strong> more campaign
                        clip{success.creditRemaining === 1 ? "" : "s"} before
                        needing another non-campaign clip.
                      </>
                    ) : (
                      <>
                        You'll need another non-campaign clip before your next
                        campaign submission.
                      </>
                    )}
                  </AlertDescription>
                </Alert>
              )}
              <p className="mt-3 text-xs text-muted-foreground">
                Once a moderator <strong>accepts</strong> this clip, any
                campaign-clip earnings that were paused by an earlier rejection
                are restored automatically — within 24 hours of acceptance.
              </p>
              <div className="mt-4 flex gap-2">
                {progress?.enabled && anyAccountAtCap ? (
                  <Button
                    onClick={() => {
                      setSuccess(null);
                      setUrl("");
                    }}
                  >
                    Submit another non-campaign clip
                  </Button>
                ) : (
                  <>
                    <Button
                      onClick={() => navigate(`/campaign/${campaignId}/submit`)}
                    >
                      Submit a campaign clip
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setSuccess(null);
                        setUrl("");
                      }}
                    >
                      Submit another non-campaign clip
                    </Button>
                  </>
                )}
              </div>
            </CardContent>
          ) : (
            <form onSubmit={onSubmit}>
              <CardContent className="space-y-4">
                {scopedHandle ? (
                  <Alert>
                    <AlertTitle>
                      Submitting non-campaign clip on @{scopedHandle}
                      {scopedPlatform ? ` (${scopedPlatform})` : ""}
                    </AlertTitle>
                    <AlertDescription>
                      Paste a URL from this exact account. URLs from a
                      different verified account will be rejected.
                    </AlertDescription>
                  </Alert>
                ) : null}
                <p className="text-sm text-muted-foreground">
                  Paste a public post URL from <strong>your own account</strong>
                  {" "}— same account as the campaign clips you've been posting.
                  Each non-campaign clip URL can only be used once across all
                  clippers.
                </p>
                <Alert>
                  <AlertTitle>Restoring paused earnings?</AlertTitle>
                  <AlertDescription>
                    If a previous non-campaign clip was rejected and your
                    campaign-clip earnings were reduced, don't worry. Once this
                    new non-campaign clip is <strong>accepted</strong>, that
                    reduction is reverted automatically —{" "}
                    <strong>within 24 hours</strong> of acceptance.
                  </AlertDescription>
                </Alert>
                <div className="space-y-2">
                  <Label htmlFor="non-campaign-url">Non-campaign clip URL</Label>
                  <Input
                    id="non-campaign-url"
                    type="url"
                    placeholder="https://"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    disabled={submitMutation.isPending}
                    aria-invalid={url.length > 0 && !validUrl}
                  />
                  {url.length > 0 && !validUrl ? (
                    <p className="text-xs text-destructive">
                      That doesn't look like a valid URL.
                    </p>
                  ) : guessedPlatform ? (
                    <p className="text-xs text-muted-foreground">
                      Detected platform:{" "}
                      <span className="font-medium capitalize">
                        {guessedPlatform}
                      </span>
                    </p>
                  ) : url.length > 0 ? (
                    <p className="text-xs text-amber-700">
                      Couldn't detect platform — must be YouTube, Instagram,
                      TikTok, or X.
                    </p>
                  ) : null}
                </div>

                {/* Live preview: shows detected platform + page (handle) +
                    duplicate status BEFORE the clipper hits submit. */}
                {validUrl && guessedPlatform && debouncedUrl ? (
                  <div className="rounded-lg border p-3 text-sm">
                    {previewQuery.isFetching ? (
                      <span className="inline-flex items-center gap-2 text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Checking URL…
                      </span>
                    ) : preview?.alreadySubmitted ? (
                      <div className="space-y-1 text-red-700">
                        <div className="font-medium">⚠ Already submitted</div>
                        <div className="text-xs">
                          This URL was already submitted as a{" "}
                          {preview.alreadySubmittedKind === "campaign"
                            ? "campaign clip"
                            : "non-campaign clip"}
                          . Each clip can only be submitted once across all
                          clippers.
                        </div>
                      </div>
                    ) : preview?.ok ? (
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs text-muted-foreground">
                            Platform:
                          </span>
                          <span className="font-medium capitalize">
                            {preview.platform}
                          </span>
                          {preview.handle ? (
                            <>
                              <span className="text-xs text-muted-foreground">
                                · Page:
                              </span>
                              <span className="font-medium">
                                @{preview.handle}
                              </span>
                            </>
                          ) : (
                            <span className="text-xs text-amber-700">
                              · Couldn't resolve page handle
                            </span>
                          )}
                        </div>
                        {/* The green tick used to appear for ANY of the
                            clipper's verified accounts on this platform, so a
                            clip from @B passed the check while the page header
                            said they were submitting on @A — a tick telling
                            them to go ahead, followed by a server rejection on
                            submit. When this page is scoped to one account,
                            only that account counts. */}
                        {wrongAccount && preview.matchedVerifiedAccount ? (
                          <div className="text-xs text-red-700">
                            ✗ This clip is from @
                            {preview.matchedVerifiedAccount.handle}, but you're
                            submitting on @{scopedHandle}. A non-campaign clip
                            only covers campaign clips from the same account —
                            paste one posted by @{scopedHandle}.
                          </div>
                        ) : preview.matchedVerifiedAccount ? (
                          <div className="text-xs text-emerald-700">
                            ✓ Matches your verified account @
                            {preview.matchedVerifiedAccount.handle}
                          </div>
                        ) : preview.handle ? (
                          <div className="text-xs text-red-700">
                            ✗ @{preview.handle} is not one of your verified
                            accounts on this platform. Submission will be
                            rejected.
                          </div>
                        ) : null}
                        {preview.resubmitOfRejectedNonCampaign ? (
                          <div className="text-xs text-amber-700">
                            ↻ This clip was rejected before. Submitting it
                            again sends it back to the moderators for a fresh
                            review.
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {submitError ? (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Submission failed</AlertTitle>
                    <AlertDescription>{submitError}</AlertDescription>
                  </Alert>
                ) : null}
              </CardContent>
              <CardFooter className="flex justify-end gap-2">
                <Button
                  type="submit"
                  disabled={
                    submitMutation.isPending ||
                    !validUrl ||
                    !guessedPlatform ||
                    preview?.alreadySubmitted === true ||
                    // The server rejects a clip from a different account than
                    // the one this page is scoped to, so there is no point
                    // letting them press Submit and find out afterwards. The
                    // red line above already says which account it needs.
                    wrongAccount
                  }
                >
                  {submitMutation.isPending ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Submitting
                    </span>
                  ) : (
                    "Submit"
                  )}
                </Button>
              </CardFooter>
            </form>
          )}
        </Card>
      </div>
    </AppLayout>
  );
};

// Private campaigns: only approved applicants can reach this form (the
// backend enforces the same rule on submit).
const NonCampaignClipSubmitPage = () => (
  <PrivateCampaignGate standalone>
    <NonCampaignClipSubmit />
  </PrivateCampaignGate>
);

export default NonCampaignClipSubmitPage;
