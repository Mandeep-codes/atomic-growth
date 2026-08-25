import { SubmissionStep1 } from "@/components/SubmissionStep1";
import { SubmissionStep3 } from "@/components/SubmissionStep3";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Avatar, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { AlertCircle, CheckCircle2, Loader2, Sparkles } from "lucide-react";
import { FormEvent, useContext, useState, useEffect } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useSubmissionFlowCampaign } from "./useSubmissionFlowCampaign";
import { SubmissionContext } from "@/components/SubmissionContext";
import { trackEvent } from "@/lib/analytics";

type StepState = {
  campaignTitle?: string | null;
};

const Step2 = () => {
  const { campaignId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state as StepState | undefined) ?? {};

  // Optional account scope hint from the dashboard: `?verifiedHandle=X&platform=Y`.
  // We only use this to render a "submitting on @handle" banner — the backend
  // still derives the account from the pasted URL, which is the source of truth.
  const searchParams = new URLSearchParams(location.search);
  const scopedHandle = searchParams.get("verifiedHandle") ?? null;
  const scopedPlatform = searchParams.get("platform") ?? null;

  const ctx = useContext(SubmissionContext);
  if (!ctx) {
    throw new Error("Step2 must be used within SubmissionProvider");
  }

  const currentCampaignId = campaignId ?? "";
  const { data: campaignData } = useSubmissionFlowCampaign(currentCampaignId);

  const [submissionPhase, setSubmissionPhase] = useState<
    "idle" | "submitting" | "success"
  >("idle");
  const [submissionError, setSubmissionError] = useState<string | null>(null);

  const utils = trpc.useUtils();
  const createSubmission = trpc.submissions.createSubmission.useMutation({
    onSuccess: () => {
      // Refresh the campaign-card submission counts so the dropdown on
      // /admin/submissions and any other consumer of campaigns.getAll see
      // the new submission without a hard page reload.
      utils.campaigns.getAll.invalidate();
    },
  });
  const profileQuery = trpc.user.getProfile.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });

  // Per-account redemption progress. The clipper sees a small table
  // listing each verified account they've used on this campaign and
  // whether that specific account is at the cap.
  const redemptionQuery = trpc.submissions.getRedemptionProgress.useQuery(
    { campaign_id: currentCampaignId },
    { enabled: Boolean(currentCampaignId) }
  );
  const redemption = redemptionQuery.data;
  const enabled = redemption?.enabled ?? false;
  const perAccount = redemption?.perAccount ?? [];
  // If ANY of the clipper's accounts is at the cap, surface a top-of-page
  // CTA. We don't block the submit form because we don't yet know which
  // account the clipper is about to use — the backend will throw with a
  // clear message if they pick a maxed account.
  const anyAtCap = perAccount.some((a) => a.mustRedeem);

  const campaignTitle =
    state.campaignTitle ?? campaignData?.title ?? "Submit your clip";

  const {
    setPhoneStepComplete,
  } = ctx;
  const profilePhoneNumber = profileQuery.data?.phoneNumber;

  useEffect(() => {
    if (!ctx.step3Complete) {
      setSubmissionError(null);
    }
  }, [ctx.step3Complete]);

  useEffect(() => {
    if (profilePhoneNumber === undefined) {
      return;
    }
    setPhoneStepComplete(Boolean(profilePhoneNumber));
  }, [profilePhoneNumber, setPhoneStepComplete]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmissionPhase("submitting");
    if (!ctx) return;
    if (!ctx.contentUrl || !ctx.detectedPlatform) {
      setSubmissionPhase("idle");
      setSubmissionError(
        "Missing submission details. Please follow the steps again."
      );
      return;
    }
    try {
      const s = await createSubmission.mutateAsync({
        campaign_id: campaignId!,
        url: ctx.contentUrl,
        platform: ctx.detectedPlatform,
        is_user_generated_content: ctx.isUserGeneratedContent,
        // The account this flow told them they were submitting on. The banner
        // above already promises the clip must come from this exact account;
        // sending it is what makes that promise true, instead of the clip
        // being quietly filed against whichever account the link belongs to.
        ...(scopedHandle ? { verified_handle: scopedHandle } : {}),
      });
      ctx.setContentUrl(undefined);
      ctx.setDetectedPlatform(undefined);
      ctx.setDetectedHandle(undefined);
      ctx.setHasVerifiedHandle(false);
      ctx.setIsUserGeneratedContent(false);
      ctx.setStep1Complete(false);
      ctx.setStep2Complete(false);
      ctx.setStep3Complete(false);
      trackEvent({
        event: "submission_step2_submit_success",
        properties: {
          campaignTitle: campaignTitle ?? "",
          campaignId: campaignId ?? "",
          submissionId: s?.id,
        },
      });
      navigate(`/campaign/${campaignId}/step-3`);
    } catch (error) {
      trackEvent({
        event: "submission_step2_submit_error",
        properties: {
          campaignTitle: campaignTitle ?? "",
          campaignId: campaignId ?? "",
          error: error instanceof Error ? error.message : "Unknown error",
          contentUrl: ctx.contentUrl,
        },
      });
      setSubmissionPhase("idle");
      setSubmissionError(
        error instanceof Error ? error.message : "Please try again shortly."
      );
    }
  };

  const isSubmitting = submissionPhase === "submitting";

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="display-heading text-2xl sm:text-3xl">
          Submit your clip
        </CardTitle>
        <CardDescription>
          <span className="inline-flex items-center gap-2">
            {campaignData?.imageUrl ? (
              <Avatar className="h-8 w-8">
                <AvatarImage
                  src={campaignData?.imageUrl}
                  alt={`${campaignTitle ?? "Campaign"} avatar`}
                />
              </Avatar>
            ) : null}
            <span>{campaignTitle}</span>
          </span>
        </CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-6">
          <div className="space-y-5">
            {scopedHandle ? (
              <Alert>
                <Sparkles className="h-4 w-4" />
                <AlertTitle>
                  Submitting on @{scopedHandle}
                  {scopedPlatform ? ` (${scopedPlatform})` : ""}
                </AlertTitle>
                <AlertDescription>
                  Paste a URL from this exact account. If the pasted URL is
                  from a different verified account, the submission will be
                  rejected.
                </AlertDescription>
              </Alert>
            ) : null}
            {/* Per-account redemption progress. We only render this when
                the campaign has the flow enabled AND the clipper has at
                least one verified account active on the campaign. */}
            {enabled && perAccount.length > 0 ? (
              <div className="space-y-3 rounded-lg border p-4">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Sparkles className="h-4 w-4" />
                  Non-campaign clip ledger (per account)
                </div>
                <p className="text-xs text-muted-foreground">
                  Each non-campaign clip covers up to{" "}
                  {perAccount[0]?.cap ?? "a few"} campaign clips from the SAME
                  account — before or after, order doesn't matter. Posting one
                  early banks the extra coverage for your next clips. Accounts
                  are tracked separately.
                </p>
                <div className="space-y-2">
                  {perAccount.map((acc) => (
                    <div
                      key={acc.verifiedUserId}
                      className={
                        "flex items-center justify-between rounded-md border p-3 text-sm " +
                        (acc.mustRedeem
                          ? "border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950"
                          : acc.allowedRemaining === 1
                          ? "border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950"
                          : "border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950")
                      }
                    >
                      <div>
                        <div className="font-medium">
                          @{acc.handle || "unknown"}{" "}
                          <span className="text-xs text-muted-foreground">
                            ({acc.platform})
                          </span>
                        </div>
                        {/* Same wording fix as submit-dashboard: this counts
                            clips NOT yet covered by a non-campaign clip, not
                            the clipper's clips. */}
                        <div className="text-xs">
                          {Math.min(acc.unredeemed, acc.cap)} of {acc.cap}{" "}
                          toward your next non-campaign clip
                          {acc.mustRedeem
                            ? " — submit a non-campaign clip from this account to continue"
                            : ` (${acc.allowedRemaining} more campaign clips before one is required)`}
                          {acc.covered > 0
                            ? ` · ${acc.covered} already covered`
                            : ""}
                        </div>
                      </div>
                      {acc.mustRedeem ? (
                        <Button asChild size="sm" variant="destructive">
                          <Link
                            to={`/campaign/${currentCampaignId}/non-campaign`}
                          >
                            Submit non-campaign
                          </Link>
                        </Button>
                      ) : (
                        <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                      )}
                    </div>
                  ))}
                </div>
                {anyAtCap ? (
                  <p className="text-xs font-medium text-red-700 dark:text-red-400">
                    ⚠ At least one of your accounts is at the cap. If you try
                    to submit from a maxed account, you'll be blocked until
                    you post a non-campaign clip from that same account.
                  </p>
                ) : null}
              </div>
            ) : null}

            {/* Two steps removed from this flow:

                "Verify ownership" — the server already refuses a clip whose
                detected handle is not one of the clipper's verified accounts
                (createSubmission), and since 2ed192c it also refuses one from a
                different account than the clipper picked. So this step asked
                them to confirm by hand something the backend proves anyway.

                "Add a phone number" — nothing in the submission path reads it.
                It blocked the submit button on a field the clip does not need,
                and the profile page still collects it for anyone who wants to
                give one. */}
            <SubmissionStep1
              allowedPlatforms={campaignData?.allowedPlatforms}
              rateByPlatform={{
                youtube: campaignData?.youtube_per_1000,
                instagram: campaignData?.insta_per_1000,
                tiktok: campaignData?.tiktok_per_1000,
                x: campaignData?.x_per_1000,
              }}
              minViewsByPlatform={{
                youtube: campaignData?.youtube_min_views,
                instagram: campaignData?.insta_min_views,
                tiktok: campaignData?.tiktok_min_views,
                x: campaignData?.x_min_views,
              }}
            />
            <SubmissionStep3 />
          </div>
        </CardContent>
        <CardFooter className="flex flex-col gap-2">
          {/* Same five conditions, unchanged — only the label now says WHICH
              one is blocking. A disabled button with no reason was the single
              most confusing thing on this screen. */}
          <Button
            type="submit"
            className="w-full rounded-xl py-6 font-mono text-xs font-extrabold uppercase tracking-[0.18em]"
            // step2Complete (verify ownership) and isPhoneStepBlocking are gone
            // with the steps that set them — leaving either in would disable
            // this button forever, since nothing can ever mark them done now.
            disabled={
              isSubmitting || !ctx.step1Complete || !ctx.step3Complete
            }
          >
            {isSubmitting ? (
              <span className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Submitting
              </span>
            ) : !ctx.step1Complete ? (
              "Paste your clip URL first"
            ) : !ctx.step3Complete ? (
              "Finish the steps above"
            ) : (
              "Submit clip"
            )}
          </Button>
        </CardFooter>
        {submissionError && ctx.step3Complete ? (
          <Alert variant="destructive" className="my-2 max-w-xl mx-auto">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Unable to continue</AlertTitle>
            <AlertDescription>{submissionError}</AlertDescription>
          </Alert>
        ) : null}
        {profileQuery.isError ? (
          <Alert variant="destructive" className="my-2 max-w-xl mx-auto">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Profile unavailable</AlertTitle>
            <AlertDescription>
              {profileQuery.error instanceof Error
                ? profileQuery.error.message
                : "We couldn't confirm your phone number. You can still submit your clip."}
            </AlertDescription>
          </Alert>
        ) : null}
      </form>
    </Card>
  );
};

export default Step2;
