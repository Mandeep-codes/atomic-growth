import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StepSection, StepStatus } from "./StepSection";
import { useUser } from "@clerk/clerk-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ChangeEvent, useContext, useEffect, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { SubmissionContext } from "./SubmissionContext";
import { Loader2 } from "lucide-react";
import { SUPPORTED_PLATFORMS, SupportedPlatform } from "@/lib/types";

interface SubmissionStep1Props {
  allowedPlatforms?: SupportedPlatform[];
  // Ratio: how many campaign reels must be uploaded together (denominator).
  campaignReelCount?: number;
  // How many non-campaign reels are required after verification (numerator).
  nonCampaignRequired?: number;
  // Campaign reels #2..N (reel #1 is the detection input / ctx.contentUrl).
  extraCampaignUrls?: string[];
  onExtraCampaignUrlsChange?: (urls: string[]) => void;
}

export const SubmissionStep1 = ({
  allowedPlatforms,
  campaignReelCount = 1,
  nonCampaignRequired = 0,
  extraCampaignUrls = [],
  onExtraCampaignUrlsChange,
}: SubmissionStep1Props) => {
  const { isSignedIn } = useUser();
  const navigate = useNavigate();
  const ctx = useContext(SubmissionContext);
  if (!ctx) {
    throw new Error("SubmissionStep1 must be used within SubmissionProvider");
  }

  const {
    contentUrl,
    detectedPlatform,
    detectedHandle,
    setContentUrl,
    setDetectedPlatform,
    setDetectedHandle,
    setLoadingSocialDetection,
    loadingSocialDetection,
    setHasVerifiedHandle,
    setIsUserGeneratedContent,
    setStep1Complete,
    setStep2Complete,
    setStep3Complete,
    step1Complete,
  } = ctx;
  const utils = trpc.useUtils();

  const [inputUrl, setInputUrl] = useState(contentUrl ?? "");
  const [platformError, setPlatformError] = useState<string | null>(null);

  // The account the clipper picked on the submit dashboard (?verifiedHandle=X).
  // Absent when they came in from an entry point that never scoped the flow to
  // one account — then there is nothing to compare against and no warning.
  const [searchParams] = useSearchParams();
  const scopedHandle = searchParams.get("verifiedHandle");

  // Caught HERE, at the paste, rather than after they finish all three steps
  // and hit submit. The handle is already detected live for the field below,
  // so the mismatch is knowable immediately — making them complete the flow
  // first only to fail is what left clippers unable to work out which of
  // their accounts the clip actually belonged to.
  const handleMismatch = Boolean(
    scopedHandle &&
      detectedHandle &&
      detectedHandle.toLowerCase() !== scopedHandle.toLowerCase()
  );

  const isValidContentUrl = useMemo(() => {
    if (!inputUrl) {
      return false;
    }

    return !validateContentUrl(inputUrl);
  }, [inputUrl]);

  useEffect(() => {
    const isStep1Complete = Boolean(
      detectedPlatform && detectedHandle && isValidContentUrl && !handleMismatch
    );
    setStep1Complete(isStep1Complete);
    if (!isStep1Complete) {
      setStep2Complete(false);
      setStep3Complete(false);
      setHasVerifiedHandle(false);
    }
  }, [
    isValidContentUrl,
    detectedPlatform,
    detectedHandle,
    handleMismatch,
    setHasVerifiedHandle,
    setStep1Complete,
    setStep2Complete,
    setStep3Complete,
  ]);

  const step1Status: StepStatus = step1Complete ? "complete" : "current";

  const handleContentUrlChange = async (
    event: ChangeEvent<HTMLInputElement>
  ) => {
    const { value } = event.target;
    setInputUrl(value);
    setPlatformError(null);
    // TODO: tracking in future
    // console.log("submitted URL", event.target.value);
    if (!isSignedIn) {
      const redirectPath = `${location.pathname}${location.search}`;
      navigate(`/auth?redirect=${encodeURIComponent(redirectPath)}`);
      // Bail before the metadata fetch: getPlatformMetadata is now a
      // protectedProcedure, so calling it here (while redirecting to /auth)
      // just throws an unhandled UNAUTHORIZED for signed-out users.
      return;
    }

    setDetectedPlatform(undefined);
    setDetectedHandle(undefined);
    setHasVerifiedHandle(false);
    setStep2Complete(false);
    setStep3Complete(false);
    setContentUrl(undefined);
    setIsUserGeneratedContent(false);

    // TODO: debounce
    if (validateContentUrl(value) === null) {
      setLoadingSocialDetection(true);

      try {
        const res = await utils.submissions.getPlatformMetadata.fetch({
          url: value,
        });

        const detected = res.platform;
        const platform = SUPPORTED_PLATFORMS.includes(detected as SupportedPlatform)
          ? (detected as SupportedPlatform)
          : null;

        if (!platform) {
          setPlatformError(
            "This link is from an unsupported platform. Please submit a link from YouTube, Instagram, TikTok, or X."
          );
          return;
        }

        if (allowedPlatforms?.length && !allowedPlatforms.includes(platform)) {
          const labelMap: Record<SupportedPlatform, string> = {
            youtube: "YouTube",
            instagram: "Instagram",
            tiktok: "TikTok",
            x: "X",
          };
          const allowedLabelList = allowedPlatforms
            .map((p) => labelMap[p])
            .join(", ");

          setPlatformError(
            `This campaign only accepts submissions from: ${allowedLabelList}.`
          );
          return;
        }

        setDetectedPlatform(platform);
        setDetectedHandle(res.username ?? undefined);
        setContentUrl(res.url);
      } finally {
        setLoadingSocialDetection(false);
      }
    }
  };

  const isBatch = campaignReelCount > 1;
  const showInstructions = isBatch || nonCampaignRequired > 0;

  return (
    <StepSection
      step={1}
      status={step1Status}
      title={
        isBatch
          ? `Upload your ${campaignReelCount} campaign reels`
          : "Enter content URL"
      }
      description={
        isBatch
          ? `This campaign requires ${campaignReelCount} campaign reels submitted together.`
          : "Paste the link to your published content."
      }
    >
      {showInstructions ? (
        <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-100">
          <p className="mb-1 font-semibold">How this campaign works</p>
          <ol className="ml-4 list-decimal space-y-1">
            <li>
              Upload your <strong>{campaignReelCount} campaign reel{campaignReelCount === 1 ? "" : "s"}</strong>{" "}
              below — all from the same account.
            </li>
            <li>We verify you own that account and the content is yours.</li>
            {nonCampaignRequired > 0 ? (
              <li>
                After verifying ownership &amp; content, you'll add{" "}
                <strong>
                  {nonCampaignRequired} non-campaign reel
                  {nonCampaignRequired === 1 ? "" : "s"}
                </strong>{" "}
                from the same account.
              </li>
            ) : null}
          </ol>
          {nonCampaignRequired > 0 ? (
            <p className="mt-2 text-blue-800">
              <strong>Why:</strong> this is a requirement for this campaign.
              Posting non-campaign reels gives your account wider reach and
              makes it look legitimate — like a real, established theme page —
              instead of an account that only posts paid clips.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="content-url">
          {isBatch ? "Campaign reel #1" : "Content URL"}
        </Label>
        <div className="relative">
          <Input
            id="content-url"
            inputMode="url"
            placeholder="https://"
            value={inputUrl}
            onChange={handleContentUrlChange}
            required
            className={loadingSocialDetection ? "pr-10" : undefined}
            aria-busy={loadingSocialDetection}
          />
          {loadingSocialDetection ? (
            <Loader2
              className="absolute right-3 top-1/3 h-4 w-4 animate-spin text-muted-foreground"
              aria-hidden
            />
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">
          We’ll detect the platform &amp; your handle from this first reel.
        </p>
        {!isValidContentUrl && inputUrl ? (
          <p className="text-xs text-destructive">
            The URL is not valid. Please enter a valid URL.
          </p>
        ) : platformError ? (
          <p className="text-xs text-destructive">{platformError}</p>
        ) : detectedPlatform && !detectedHandle ? (
          <p className="text-xs text-destructive">
            We're unable to detect your user handle from your link
          </p>
        ) : handleMismatch ? (
          // Names both accounts and links straight to the right one. The old
          // behaviour accepted this silently and filed the clip under
          // @{detectedHandle}, so the clipper's counters moved on an account
          // they weren't even looking at.
          <p className="text-xs text-destructive">
            You're submitting on <strong>@{scopedHandle}</strong>, but this clip
            was posted by <strong>@{detectedHandle}</strong>. Paste a clip from
            @{scopedHandle}, or{" "}
            <button
              type="button"
              className="underline underline-offset-2"
              onClick={() => navigate(-1)}
            >
              go back and pick @{detectedHandle}
            </button>{" "}
            to submit it there.
          </p>
        ) : null}
      </div>

      {isBatch
        ? extraCampaignUrls.map((url, i) => {
            let invalid = false;
            if (url.length > 0) {
              try {
                new URL(url);
              } catch {
                invalid = true;
              }
            }
            return (
              <div key={i} className="mt-3 space-y-2">
                <Label htmlFor={`campaign-reel-${i + 2}`}>
                  Campaign reel #{i + 2}
                </Label>
                <Input
                  id={`campaign-reel-${i + 2}`}
                  inputMode="url"
                  placeholder="https://"
                  value={url}
                  onChange={(e) => {
                    const next = [...extraCampaignUrls];
                    next[i] = e.target.value;
                    onExtraCampaignUrlsChange?.(next);
                  }}
                  aria-invalid={invalid || url.length === 0}
                />
                {invalid ? (
                  <p className="text-xs text-destructive">
                    That doesn't look like a valid URL.
                  </p>
                ) : url.length === 0 ? (
                  <p className="text-xs text-amber-700">
                    Required — paste campaign reel #{i + 2} (same account).
                  </p>
                ) : null}
              </div>
            );
          })
        : null}
    </StepSection>
  );
};

const validateContentUrl = (value: string) => {
  if (!value.trim()) {
    return "Please enter a URL.";
  }

  try {
    const parsed = new URL(value);
    if (!parsed.protocol.startsWith("http")) {
      return "URL must start with http or https.";
    }
  } catch {
    return "Please enter a valid URL.";
  }

  return null;
};
