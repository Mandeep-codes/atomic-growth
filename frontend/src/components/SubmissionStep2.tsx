import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { UseAccountVerification } from "@/hooks/useAccountVerification";
import { useHandleVerified } from "@/hooks/useHandleVerified";
import type { LucideIcon } from "lucide-react";
import {
  CheckCircle2,
  Instagram,
  Loader2,
  Music2,
  Twitter,
  Youtube,
} from "lucide-react";
import { useContext, useEffect, useState } from "react";
import { StepSection, StepStatus } from "./StepSection";
import { SubmissionContext } from "./SubmissionContext";
import { SupportedPlatform } from "@/lib/types";
import { trackEvent } from "@/lib/analytics";
import { Link } from "react-router-dom";
import { TermsDialog } from "@/components/TermsDialog";
import { useFeatureFlag } from "@/hooks/useFeatureFlag";

const PLATFORM_META: Record<
  SupportedPlatform,
  { label: string; icon: LucideIcon }
> = {
  youtube: { label: "YouTube", icon: Youtube },
  instagram: { label: "Instagram", icon: Instagram },
  tiktok: { label: "TikTok", icon: Music2 },
  x: { label: "X", icon: Twitter },
};

type VerificationMethod = "OTP" | "login-flow" | "manual";

const DEFAULT_VERIFICATION_METHODS: VerificationMethod[] = [
  "OTP",
  "login-flow",
  "manual",
];

const VERIFICATION_METHOD_LABELS: Record<VerificationMethod, string> = {
  OTP: "Profile Verification",
  "login-flow": "login verification",
  manual: "manual verification",
};

interface SubmissionStep2Props {
  allowedVerificationMethods?: VerificationMethod[] | null;
}

export const SubmissionStep2 = ({
  allowedVerificationMethods,
}: SubmissionStep2Props) => {
  const ctx = useContext(SubmissionContext);
  if (!ctx) {
    throw new Error("SubmissionStep2 must be used within SubmissionProvider");
  }

  const {
    detectedPlatform,
    detectedHandle,
    hasVerifiedHandle,
    setHasVerifiedHandle,
    step1Complete,
    step2Complete,
    setStep2Complete,
    setStep3Complete,
  } = ctx;

  const allowedMethods =
    allowedVerificationMethods && allowedVerificationMethods.length > 0
      ? allowedVerificationMethods
      : DEFAULT_VERIFICATION_METHODS;

  const [showTermsDialog, setShowTermsDialog] = useState(false);

  const isMethodAllowed = (method: VerificationMethod) =>
    allowedMethods.includes(method);

  const {
    startVerification,
    loadingVerificationCheck,
    handleVerificationCheck,
    verificationPhase,
    verificationCode,
  } = UseAccountVerification();

  useEffect(() => {
    if (detectedPlatform && detectedHandle) {
      void startVerification(detectedPlatform, detectedHandle);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detectedPlatform, detectedHandle]);

  const {
    hasVerifiedHandle: remoteVerified,
    isVerificationFetching,
    matchingAccount,
  } = useHandleVerified({
    platform: detectedPlatform,
    handle: detectedHandle,
  });

  const remoteVerificationMethod = matchingAccount?.verification_method as
    | VerificationMethod
    | undefined;
  const verificationMethodAllowed = remoteVerificationMethod
    ? isMethodAllowed(remoteVerificationMethod)
    : true;
  const verificationMethodMismatch = Boolean(
    matchingAccount && !verificationMethodAllowed
  );

  const verificationRedirectTarget = "/verification/flow";

  useEffect(() => {
    if (!remoteVerified) {
      return;
    }
    setHasVerifiedHandle(verificationMethodAllowed);
  }, [remoteVerified, verificationMethodAllowed, setHasVerifiedHandle]);

  useEffect(() => {
    if (verificationMethodMismatch) {
      setStep2Complete(false);
      setStep3Complete(false);
    }
  }, [verificationMethodMismatch, setStep2Complete, setStep3Complete]);

  const { enabled: termsAndConditionsEnabled } = useFeatureFlag(
    "TERMS_AND_CONDITIONS"
  );

  const step2Status: StepStatus = !step1Complete
    ? "pending"
    : step2Complete
    ? "complete"
    : "current";

  const canContinue = Boolean(hasVerifiedHandle) && !loadingVerificationCheck;

  const handleContinue = () => {
    if (!canContinue) return;
    trackEvent({
      event: "submission_step2_continue_clicked",
      properties: {
        platform: detectedPlatform,
        handle: detectedHandle,
      },
    });
    setStep2Complete(true);
    setStep3Complete(true);
  };

  const handleVerify = async () => {
    if (!detectedPlatform || !detectedHandle) {
      return;
    }
    trackEvent({
      event: "submission_step2_verify_clicked",
      properties: {
        platform: detectedPlatform,
        handle: detectedHandle,
      },
    });
    const verified = await handleVerificationCheck(
      detectedPlatform,
      detectedHandle
    );
    if (verified) {
      if (isMethodAllowed("OTP")) {
        setHasVerifiedHandle(true);
        setStep2Complete(true);
        setStep3Complete(true);
        trackEvent({
          event: "submission_step2_verify_result",
          properties: {
            platform: detectedPlatform,
            handle: detectedHandle,
            status: "verified",
          },
        });
      } else {
        setHasVerifiedHandle(false);
        setStep2Complete(false);
        setStep3Complete(false);
        trackEvent({
          event: "submission_step2_verify_result",
          properties: {
            platform: detectedPlatform,
            handle: detectedHandle,
            status: "method_not_allowed",
          },
        });
      }
    } else {
      setHasVerifiedHandle(false);
      setStep2Complete(false);
      setStep3Complete(false);
      trackEvent({
        event: "submission_step2_verify_result",
        properties: {
          platform: detectedPlatform,
          handle: detectedHandle,
          status: "unverified",
        },
      });
    }
  };

  return (
    <StepSection
      step={2}
      status={step2Status}
      title="Verify ownership"
      description="Confirm the detected handle belongs to you."
      disabledMessage="Add a content URL so we can detect your account."
    >
      <div className="space-y-4">
        {step2Complete ? (
          <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100">
            <CheckCircle2 className="h-4 w-4" /> Ownership verified. Continue to
            review your content below.
          </div>
        ) : null}

        {detectedPlatform ? (
          <div className="space-y-4 rounded-lg border border-border/60 bg-secondary/20 p-4">
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant="outline" className="flex items-center gap-1">
                {(() => {
                  const Icon = PLATFORM_META[detectedPlatform].icon;
                  return <Icon className="h-3.5 w-3.5" />;
                })()}
                {PLATFORM_META[detectedPlatform].label}
              </Badge>
              {isVerificationFetching ? (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" /> Checking…
                </span>
              ) : hasVerifiedHandle ? (
                <span className="flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Handle verified
                </span>
              ) : null}
            </div>

            <div className="space-y-2 text-sm">
              {detectedHandle ? (
                <p className="text-xl">@{detectedHandle}</p>
              ) : (
                <p>We’re still reading the handle from your link.</p>
              )}
            </div>

            {hasVerifiedHandle && !isVerificationFetching && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100">
                  <CheckCircle2 className="h-4 w-4" />
                  <span>We’ve confirmed ownership of this handle.</span>
                </div>
                {!step2Complete ? (
                  <div className="flex justify-end">
                    <Button
                      type="button"
                      size="sm"
                      onClick={handleContinue}
                      disabled={!canContinue}
                    >
                      Continue
                    </Button>
                  </div>
                ) : null}
              </div>
            )}

            {!hasVerifiedHandle &&
              !isVerificationFetching &&
              allowedMethods.includes("OTP") && (
                <div className="space-y-3 rounded-md border border-dashed border-primary/40 bg-background p-4 text-sm text-muted-foreground">
                  <div className="space-y-1">
                    <p className="font-semibold text-foreground">
                      Add the code below to your bio, then choose “Verify”.
                    </p>
                    <ol className="list-decimal list-inside space-y-1">
                      <li>
                        Add this code to your {detectedPlatform} bio/description
                      </li>
                      <li>Wait a few seconds for changes to save</li>
                      <li>Click "Verify" to check</li>
                      <li>You can remove the code after verification</li>
                    </ol>
                  </div>

                  {verificationPhase === "initializing" ? (
                    <div className="flex items-center gap-2 rounded-md border border-dashed border-border px-3 py-3">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Generating your verification code…
                    </div>
                  ) : verificationCode ? (
                    <div className="rounded-md border border-dashed border-amber-300 bg-amber-50 px-3 py-2 font-mono text-sm text-amber-900">
                      {verificationCode}
                    </div>
                  ) : null}

                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="default"
                      size="sm"
                      disabled={loadingVerificationCheck}
                      onClick={() => {
                        if (termsAndConditionsEnabled) {
                          setShowTermsDialog(true);
                        } else {
                          handleVerify();
                        }
                      }}
                    >
                      {loadingVerificationCheck ? (
                        <span className="flex items-center gap-1">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          Checking…
                        </span>
                      ) : (
                        "Verify"
                      )}
                    </Button>
                  </div>
                </div>
              )}

            {!hasVerifiedHandle &&
              !isVerificationFetching &&
              !allowedMethods.includes("OTP") && (
                <div className="space-y-3 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
                  <p>
                    This account needs further verification to enter this
                    campaign. Consider creating a new account with a different
                    verification method. Reach out in{" "}
                    <a
                      href="https://discord.com/channels/1395157211839201400/1395362775534014525"
                      target="_blank"
                      className="text-primary underline"
                      rel="noopener noreferrer"
                    >
                      Discord
                    </a>{" "}
                    if you need more help.
                  </p>
                  {VERIFICATION_METHOD_LABELS[remoteVerificationMethod]
                    ?.length > 0 && (
                    <p>
                      This account was verified using{" "}
                      <span className="font-semibold">
                        {VERIFICATION_METHOD_LABELS[remoteVerificationMethod]}
                      </span>
                      .{" "}
                    </p>
                  )}
                  <Button asChild size="sm" variant="outline" className="w-fit">
                    <Link to={verificationRedirectTarget}>
                      Go to social verification
                    </Link>
                  </Button>
                </div>
              )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            We’ll detect the platform and handle automatically once the link
            loads.
          </p>
        )}
      </div>
      <TermsDialog
        open={showTermsDialog}
        onOpenChange={(open) => {
          if (!loadingVerificationCheck) {
            setShowTermsDialog(open);
          }
        }}
        onConfirm={async () => {
          await handleVerify();
          setShowTermsDialog(false);
        }}
        isLoading={loadingVerificationCheck}
        confirmLabel="Accept & Verify"
        loadingLabel="Verifying"
      />
    </StepSection>
  );
};
