import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { ExternalLink, Loader2 } from "lucide-react";
import { StepSection, StepStatus } from "./StepSection";
import { useContext } from "react";
import { SubmissionContext } from "./SubmissionContext";
import { InstagramEmbed } from "./InstagramEmbed";
import { TwitterEmbed } from "./TwitterEmbed";
import { trackEvent } from "@/lib/analytics";

export const SubmissionStep3 = () => {
  const ctx = useContext(SubmissionContext);
  if (!ctx) {
    throw new Error("SubmissionStep3 must be used within SubmissionProvider");
  }

  const {
    contentUrl,
    detectedPlatform,
    detectedHandle,
    isUserGeneratedContent,
    setIsUserGeneratedContent,
    step1Complete,
    step3Complete,
    setStep3Complete,
  } = ctx;

  const previewIsValid = Boolean(detectedHandle && detectedPlatform);

  const step3Status: StepStatus = !step1Complete
    ? "pending"
    : step3Complete
    ? "complete"
    : "current";

  const {
    data: previewData,
    error: previewError,
    isError: isPreviewError,
    isLoading: isPreviewLoading,
  } = trpc.submissions.getPlatformMetadata.useQuery(
    { url: contentUrl ?? "" },
    {
      enabled: previewIsValid && step1Complete && Boolean(contentUrl),
      retry: false,
    }
  );

  const canContinue = step1Complete && !isPreviewLoading;

  const isInstagram = previewData?.platform === "instagram";
  const isTwitter = previewData?.platform === "x";

  return (
    <StepSection
      step={2}
      status={step3Status}
      title="Review your content"
      description="Make sure everything looks correct before continuing."
      disabledMessage="Paste your clip URL to unlock this step."
    >
      {previewIsValid ? (
        <div className="space-y-3 rounded-lg border border-border/60 bg-secondary/20 p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <p className="text-sm font-semibold text-foreground">
                Content preview
              </p>
              <p className="text-xs text-muted-foreground">
                Submitting as @{detectedHandle}
              </p>
            </div>
          </div>

          {isPreviewLoading ? (
            <div className="flex items-center gap-2 rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Fetching preview…
            </div>
          ) : isPreviewError ? (
            <div className="space-y-2 rounded-md border border-dashed border-red-200 bg-red-50 p-4 text-xs text-red-600">
              <p>We couldn’t load a preview for this link.</p>
              {previewError instanceof Error ? (
                <p>{previewError.message}</p>
              ) : null}
            </div>
          ) : isInstagram && contentUrl ? (
            <InstagramEmbed url={contentUrl} />
          ) : isTwitter && contentUrl ? (
            <TwitterEmbed url={contentUrl} />
          ) : previewData?.embedUrl ? (
            <iframe
              title="Content preview"
              src={previewData.embedUrl}
              className="aspect-video h-[750px] w-full max-w-xl mx-auto"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          ) : (
            <div className="space-y-2 py-5 text-xs text-muted-foreground">
              <Button asChild variant="outline" size="sm" className="w-fit">
                <a
                  href={contentUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() =>
                    trackEvent({
                      event: "submission_step3_open_post_clicked",
                      properties: {
                        platform: detectedPlatform,
                        handle: detectedHandle,
                        contentUrl,
                      },
                    })
                  }
                >
                  Open post in new tab <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </Button>
              <p>This platform limits embeds. Open the post to double-check.</p>
            </div>
          )}
          {/* 
          <div className="rounded-lg border border-border/60 bg-secondary/20 p-3">
            <div className="flex items-center gap-3">
              <Switch
                id="ugc-content"
                checked={isUserGeneratedContent}
                onCheckedChange={(checked) =>
                  setIsUserGeneratedContent(checked)
                }
              />
              <div className="space-y-1">
                <Label htmlFor="ugc-content" className="text-sm font-medium">
                  This is user-generated content (UGC)
                </Label>
                <p className="text-xs text-muted-foreground">
                  Let us know if the clip was created by a user/community member
                  so the review team can handle it appropriately.
                </p>
              </div>
            </div>
          </div> */}

          <div className="flex justify-end pt-1">
            {step3Complete ? null : (
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  trackEvent({
                    event: "submission_step3_approve_clicked",
                    properties: {
                      platform: detectedPlatform,
                      handle: detectedHandle,
                      contentUrl,
                    },
                  });
                  setStep3Complete(true);
                }}
                disabled={!canContinue}
              >
                Approve
              </Button>
            )}
          </div>
        </div>
      ) : contentUrl ? (
        <p className="text-sm text-muted-foreground">
          We’ll load a preview automatically once the link finishes processing.
        </p>
      ) : null}
    </StepSection>
  );
};
