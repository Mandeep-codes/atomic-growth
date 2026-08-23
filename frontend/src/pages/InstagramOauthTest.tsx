import { AppLayout } from "@/components/AppLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useToast } from "@/components/ui/use-toast";
import { env } from "@/lib/env";
import { trpc } from "@/lib/trpc";
import { ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

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

const InstagramOauthTest = () => {
  const { toast } = useToast();

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
    if (!oauthPopup || oauthPopup.closed) return () => undefined;
    return () => {
      if (oauthPopup && !oauthPopup.closed) {
        oauthPopup.close();
      }
    };
  }, [oauthPopup]);

  const instagramHandle = "sebrulz";
  const hasInstagramTokens = Boolean(oauthPayload?.tokens?.access_token);
  console.log("oauthPayload", oauthPayload);
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

  return (
    <AppLayout>
      <div className="min-h-screen bg-muted/40 py-10 px-4">
        <div className="mx-auto flex max-w-4xl flex-col gap-6">
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
              </>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
};

export default InstagramOauthTest;
