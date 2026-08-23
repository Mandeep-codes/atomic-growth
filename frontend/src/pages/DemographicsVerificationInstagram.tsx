import { ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/use-toast";
import { AppLayout } from "@/components/AppLayout";
import { env } from "@/lib/env";

interface OAuthTokens {
  access_token?: string;
  refresh_token?: string;
  [key: string]: unknown;
}

interface OAuthMessage {
  type?: string;
  state?: string;
  success?: boolean;
  tokens?: OAuthTokens;
  error?: string;
}

const deriveBackendOrigin = () => {
  try {
    const trpcUrl = new URL(env.VITE_TRPC_URL);
    return trpcUrl.origin;
  } catch (error) {
    if (typeof window !== "undefined" && window.location?.origin) {
      return window.location.origin;
    }
    return "";
  }
};

interface StepSectionProps {
  stepNumber: number;
  title: string;
  description: string;
  children: ReactNode;
  dimmed?: boolean;
}

const StepSection = ({
  stepNumber,
  title,
  description,
  children,
  dimmed = false,
}: StepSectionProps) => (
  <section
    className={`rounded-2xl border bg-background/60 p-5 shadow-sm transition-opacity ${
      dimmed ? "opacity-60" : ""
    }`}
  >
    <div className="flex items-start gap-4">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
        {stepNumber}
      </div>
      <div className="space-y-1">
        <p className="text-sm font-semibold leading-tight">{title}</p>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
    <div className="mt-4 space-y-4">{children}</div>
  </section>
);

const DemographicsVerificationInstagram = () => {
  const { id } = useParams<{ id: string }>();
  const claimId = id ?? "";
  const { toast } = useToast();

  const {
    data: claim,
    isLoading,
    error,
  } = trpc.demographicsVerification.getClaim.useQuery(
    { id: claimId },
    { enabled: Boolean(claimId) }
  );

  const utils = trpc.useUtils();
  const backendOrigin = useMemo(() => deriveBackendOrigin(), []);
  const [oauthPayload, setOauthPayload] = useState<OAuthMessage | null>();
  const [oauthPopup, setOauthPopup] = useState<Window | null>(null);
  const createInstagramSession =
    trpc.instagramOAuth.createSession.useMutation();
  const instagramAudienceReport =
    trpc.instagramOAuth.getAudienceReport.useMutation();
  const navigate = useNavigate();

  useEffect(() => {
    setOauthPayload(null);
  }, [claimId]);

  useEffect(() => {
    if (!oauthPopup || oauthPopup.closed) return () => undefined;
    return () => {
      if (oauthPopup && !oauthPopup.closed) {
        oauthPopup.close();
      }
    };
  }, [oauthPopup]);

  const instagramHandle =
    claim?.verifiedHandle ?? claim?.verifiedUsername ?? "";
  const hasInstagramTokens = Boolean(oauthPayload?.tokens?.access_token);
  useEffect(() => {
    if (!backendOrigin) return;

    const listener = (event: MessageEvent) => {
      if (event.origin !== backendOrigin) return;
      const data = event.data as OAuthMessage;
      if (!data || data.type !== "instagram-oauth") return;

      setOauthPayload(data);
      if (oauthPopup && !oauthPopup.closed) {
        oauthPopup.close();
      }
      setOauthPopup(null);
    };

    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, [backendOrigin, oauthPopup]);

  const handleConnectInstagram = useCallback(async () => {
    try {
      const response = await createInstagramSession.mutateAsync();
      const authUrl = response.authorizationUrl;
      const popupWindow = window.open(
        authUrl,
        "instagram-oauth",
        "width=500,height=700"
      );
      if (!popupWindow) {
        throw new Error(
          "Popup was blocked. Please allow popups and try again."
        );
      }
      setOauthPopup(popupWindow);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to start Instagram OAuth";
      toast({
        title: "Unable to connect Instagram",
        description: message,
        variant: "destructive",
      });
    }
  }, [createInstagramSession, toast]);

  const handleFetchInstagramReport = useCallback(async () => {
    if (!hasInstagramTokens || !oauthPayload?.tokens?.access_token) {
      toast({
        title: "Connect your Instagram account",
        description: "Authorize access before fetching demographics.",
        variant: "destructive",
      });
      return;
    }

    if (!claimId) {
      toast({
        title: "Missing verification id",
        description: "Reload the page and try again",
        variant: "destructive",
      });
      return;
    }

    if (!instagramHandle) {
      toast({
        title: "Missing Instagram handle",
        description:
          "We couldn't determine which account to use for this claim.",
        variant: "destructive",
      });
      return;
    }

    try {
      await instagramAudienceReport.mutateAsync({
        accessToken: oauthPayload.tokens.access_token,
        handle: instagramHandle,
        demographicsVerificationId: claimId,
      });

      navigate("/demographics-verification");

      toast({
        title: "Audience synced",
        description: "Pulled demographics directly from Instagram.",
      });
      await utils.demographicsVerification.getClaim.invalidate({ id: claimId });
    } catch (err) {
      console.log("err", err);
      const description =
        err instanceof Error ? err.message : "Please try again in a moment.";
      toast({
        title: "Failed to fetch Instagram data",
        description,
        variant: "destructive",
      });
    }
  }, [
    claimId,
    hasInstagramTokens,
    oauthPayload?.tokens,
    toast,
    utils,
    instagramAudienceReport,
    instagramHandle,
  ]);

  return (
    <AppLayout>
      <div className="min-h-screen bg-muted/40 py-10 px-4">
        <div className="mx-auto flex max-w-4xl flex-col gap-6">
          <div className="space-y-1">
            <p className="text-sm uppercase tracking-wide text-muted-foreground">
              Verify Demographics
            </p>
            <h1 className="text-3xl font-semibold">
              {claim?.campaignTitle ?? "Campaign"}
            </h1>
            <p className="text-muted-foreground">
              Confirm the demographics data for @
              {claim?.verifiedHandle ?? claim?.verifiedUsername}.
            </p>
          </div>

          {error && (
            <Card>
              <CardContent className="p-6">
                <p className="text-destructive">
                  Failed to load this verification request.
                </p>
              </CardContent>
            </Card>
          )}

          {claim ? (
            <Card>
              <CardHeader>
                <CardTitle>Complete demographics verification</CardTitle>
                <CardDescription>
                  Connect your account, review what we pull, and confirm the
                  results.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <>
                  <StepSection
                    stepNumber={1}
                    title="Connect your Instagram account"
                    description="Authorize access so we can securely pull analytics."
                  >
                    <p className="text-sm text-muted-foreground">
                      We'll match the connected account to @{instagramHandle}.
                    </p>
                    <div className="flex flex-wrap items-center gap-3">
                      <Button
                        type="button"
                        onClick={handleConnectInstagram}
                        disabled={createInstagramSession.isPending}
                      >
                        {createInstagramSession.isPending
                          ? "Opening Meta…"
                          : hasInstagramTokens
                          ? "Reconnect Instagram"
                          : "Connect Instagram"}
                      </Button>
                      {hasInstagramTokens && (
                        <Badge variant="secondary">Connected</Badge>
                      )}
                      {oauthPayload?.error && (
                        <p className="text-sm text-destructive">
                          {oauthPayload.error}
                        </p>
                      )}
                    </div>
                  </StepSection>
                  <StepSection
                    stepNumber={2}
                    title="Fetch your audience data"
                    description="Use the authenticated session to pull Instagram Insights demographics."
                    dimmed={!hasInstagramTokens}
                  >
                    <p className="text-sm text-muted-foreground">
                      Once connected, fetch the report and we'll handle the rest
                      — no recording needed.
                    </p>
                    <Button
                      type="button"
                      onClick={handleFetchInstagramReport}
                      disabled={
                        !hasInstagramTokens || instagramAudienceReport.isPending
                      }
                    >
                      {instagramAudienceReport.isPending
                        ? "Fetching data…"
                        : "Fetch from Instagram"}
                    </Button>
                  </StepSection>
                </>
              </CardContent>
            </Card>
          ) : isLoading ? (
            <Card>
              <CardContent className="p-6 text-sm text-muted-foreground">
                Loading verification details...
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </AppLayout>
  );
};

export default DemographicsVerificationInstagram;
