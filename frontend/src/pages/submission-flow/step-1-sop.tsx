import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useEffect } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { SubmissionFlowLayout } from "./submission-flow-layout";
import { Loader2 } from "lucide-react";
import { useSubmissionFlowCampaign } from "./useSubmissionFlowCampaign";

interface Step2LocationState {
  campaignTitle?: string | null;
}

const Step1 = () => {
  const navigate = useNavigate();
  const { campaignId } = useParams();
  const location = useLocation();
  const state = (location.state as Step2LocationState | undefined) ?? {};

  const currentCampaignId = campaignId ?? "";
  const {
    data: campaignData,
    isLoading,
    error,
  } = useSubmissionFlowCampaign(currentCampaignId);

  const campaignTitle =
    state.campaignTitle ?? campaignData?.title ?? "Campaign SOP";
  const campaignImageUrl = campaignData?.imageUrl ?? undefined;

  const sopEmbedUrl = campaignData?.sopEmbedUrl || undefined;

  const isNotionLink = (() => {
    if (!sopEmbedUrl) return false;
    try {
      const { hostname } = new URL(sopEmbedUrl);
      return hostname.endsWith("notion.so") || hostname.endsWith("notion.site");
    } catch (error) {
      return sopEmbedUrl.includes("notion.");
    }
  })();

  // Preserve the dashboard-passed account scope (?verifiedHandle=X&platform=Y)
  // so step-2 knows which account this submission is intended for.
  const forwardSearch = location.search || "";

  const handleNext = () => {
    if (!campaignId) {
      return;
    }

    navigate(`/campaign/${campaignId}/step-2${forwardSearch}`, {
      state: {
        campaignTitle: campaignTitle ?? null,
      },
    });
  };

  // Auto-skip the SOP step entirely when the campaign hasn't configured an
  // SOP embed URL. The page would otherwise just show "SOP not available"
  // and force the clipper to click "Accept & Continue" for nothing —
  // confusing friction the user explicitly called out.
  useEffect(() => {
    if (!campaignId) return;
    if (isLoading || error) return;
    if (campaignData && !campaignData.sopEmbedUrl) {
      navigate(`/campaign/${campaignId}/step-2${forwardSearch}`, {
        replace: true,
        state: { campaignTitle: campaignTitle ?? null },
      });
    }
  }, [campaignId, isLoading, error, campaignData, campaignTitle, navigate, forwardSearch]);

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="text-2xl font-semibold">
          Review SOP & Rules
        </CardTitle>
        <CardDescription>
          <span className="inline-flex items-center gap-2">
            {campaignImageUrl ? (
              <Avatar className="h-8 w-8">
                <AvatarImage
                  src={campaignImageUrl}
                  alt={`${campaignTitle ?? "Campaign"} avatar`}
                />
              </Avatar>
            ) : null}
            <span>{campaignTitle}</span>
          </span>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {isLoading ? (
          <div className="flex flex-col items-center gap-3 py-12 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
            <span>Loading campaign details...</span>
          </div>
        ) : error ? (
          <Alert variant="destructive">
            <AlertTitle>Unable to load campaign</AlertTitle>
            <AlertDescription>
              {error.message ||
                "We couldn’t fetch the campaign details. Please try again."}
            </AlertDescription>
          </Alert>
        ) : (
          <>
            {sopEmbedUrl ? (
              <>
                {isNotionLink ? (
                  <div className="rounded-md border border-dashed bg-muted/40 p-4 text-sm text-muted-foreground">
                    <p className="mb-3">
                      This SOP is hosted in Notion. Use the link below to open it
                      in a new tab and review it there.
                    </p>
                    <Button asChild variant="outline" size="sm">
                      <a
                        href={sopEmbedUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Open in new tab
                      </a>
                    </Button>
                  </div>
                ) : (
                  <>
                    <iframe
                      title="Campaign SOP"
                      src={sopEmbedUrl}
                      className="min-h-[480px] h-[60vh] w-full rounded-md border"
                    />
                    <p className="text-xs text-muted-foreground">
                      Having trouble viewing the document?{" "}
                      <a
                        href={sopEmbedUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline"
                      >
                        Open it in a new tab
                      </a>
                      .
                    </p>
                  </>
                )}
              </>
            ) : (
              <Alert>
                <AlertTitle>SOP not available</AlertTitle>
                <AlertDescription>
                  The campaign has not provided an SOP embed yet. Please reach
                  out to the campaign manager for the latest instructions.
                </AlertDescription>
              </Alert>
            )}

            <div className="flex justify-end">
              <Button onClick={handleNext} className="w-full sm:w-auto">
                Accept & Continue
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default Step1;
