import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { trackEvent } from "@/lib/analytics";
import { trpc } from "@/lib/trpc";
import { AlertCircle, Loader2, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { TermsDialog } from "@/components/TermsDialog";
import { useFeatureFlag } from "@/hooks/useFeatureFlag";

interface VerificationCardProps {
  platform: "youtube" | "instagram" | "tiktok" | "x";
  platformName: string;
  refetchVerification: () => void;
}

const normalizeHandleInput = (rawHandle: string) =>
  rawHandle.trim().replace(/^@+/, "");

export const VerificationCardVerifyBio = ({
  platform,
  platformName,
  refetchVerification,
}: VerificationCardProps) => {
  const { toast } = useToast();
  const [verificationStarted, setVerificationStarted] = useState(false);
  const [verificationHandle, setVerificationHandle] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const [verificationCode, setVerificationCode] = useState<string | null>(null);
  const [showTermsDialog, setShowTermsDialog] = useState(false);
  const navigate = useNavigate();
  const { enabled: termsAndConditionsEnabled } = useFeatureFlag(
    "TERMS_AND_CONDITIONS"
  );
  // Initialize verification mutation
  const initializeVerificationMutation =
    trpc.verification.initializeVerification.useMutation();

  // Verify user bio mutation
  const verifyBioMutation = trpc.verification.verifyUserBio.useMutation();

  const handleStartVerification = async () => {
    const cleanedHandle = normalizeHandleInput(verificationHandle);

    if (!cleanedHandle) {
      toast({
        title: "Error",
        description: "Please enter your account handle",
        variant: "destructive",
      });
      return;
    }

    trackEvent({
      event: "social_verification_start_clicked",
      properties: {
        platform,
        handle: cleanedHandle,
      },
    });
    setIsInitializing(true);
    try {
      const result = await initializeVerificationMutation.mutateAsync({
        platform,
        handle: cleanedHandle,
      });

      setVerificationCode(result.verifyCode);
      setVerificationStarted(true);
      toast({
        title: "Verification Started",
        description: result.message,
      });
      trackEvent({
        event: "social_verification_start_result",
        properties: {
          platform,
          handle: cleanedHandle,
          status: "success",
        },
      });
    } catch (error) {
      toast({
        title: "Error",
        description:
          error instanceof Error
            ? error.message
            : "Failed to start verification",
        variant: "destructive",
      });
      trackEvent({
        event: "social_verification_start_result",
        properties: {
          platform,
          handle: cleanedHandle,
          status: "error",
          errorMessage:
            error instanceof Error ? error.message : "Unknown error",
        },
      });
    } finally {
      setIsInitializing(false);
    }
  };

  const handleVerifyAccount = async () => {
    const cleanedHandle = normalizeHandleInput(verificationHandle);

    if (!cleanedHandle) {
      toast({
        title: "Error",
        description: "Please enter your account handle",
        variant: "destructive",
      });
      return;
    }

    trackEvent({
      event: "social_verification_verify_clicked",
      properties: {
        platform,
        handle: cleanedHandle,
      },
    });
    setIsVerifying(true);
    try {
      const result = await verifyBioMutation.mutateAsync({
        platform,
        handle: cleanedHandle,
      });

      if (result.verified) {
        toast({
          title: "Success!",
          description: result.message,
        });
        setVerificationCode(null);
        setVerificationStarted(false);
        setVerificationHandle("");
        refetchVerification();
        trackEvent({
          event: "social_verification_verify_result",
          properties: {
            platform,
            handle: cleanedHandle,
            status: "verified",
          },
        });
        navigate("/verification");
      } else {
        setVerificationCode(result.verifyCode || null);
        toast({
          title: "Verification Code",
          description: result.message,
          variant: "default",
        });
        trackEvent({
          event: "social_verification_verify_result",
          properties: {
            platform,
            handle: cleanedHandle,
            status: "code_resent",
          },
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description:
          error instanceof Error ? error.message : "Failed to verify account",
        variant: "destructive",
      });
      trackEvent({
        event: "social_verification_verify_result",
        properties: {
          platform,
          handle: cleanedHandle,
          status: "error",
          errorMessage:
            error instanceof Error ? error.message : "Unknown error",
        },
      });
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Show verification flow when adding new account */}
      <div className="space-y-4 pt-4 border-t">
        <div>
          <h4 className="text-sm font-medium mb-2">
            Add New {platformName} Account
          </h4>
        </div>
        <div className="space-y-2">
          <Label htmlFor={`handle-${platform}`}>
            {platform === "youtube" ? "Channel Handle" : "Username"}
          </Label>
          <div className="flex gap-2">
            <Input
              id={`handle-${platform}`}
              placeholder={
                platform === "youtube" ? "@YourChannelHandle" : "@yourusername"
              }
              value={verificationHandle}
              onChange={(e) => setVerificationHandle(e.target.value)}
              disabled={isVerifying || isInitializing || verificationStarted}
            />
            {!verificationStarted ? (
              <Button
                type="button"
                onClick={handleStartVerification}
                disabled={isInitializing || !verificationHandle.trim()}
                size="sm"
              >
                {isInitializing ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Starting...
                  </>
                ) : (
                  "Start"
                )}
              </Button>
            ) : (
              <Button
                type="button"
                onClick={() => {
                  if (termsAndConditionsEnabled) {
                    setShowTermsDialog(true);
                  } else {
                    handleVerifyAccount();
                  }
                }}
                disabled={isVerifying}
                size="sm"
              >
                {isVerifying ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Verifying
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Verify
                  </>
                )}
              </Button>
            )}
          </div>
        </div>

        {verificationCode && (
          <Alert className="border-blue-500/50 bg-blue-500/5">
            <AlertCircle className="h-4 w-4 text-blue-500" />
            <AlertTitle className="text-blue-700">Verification Code</AlertTitle>
            <AlertDescription className="text-blue-600 space-y-2">
              <p className="font-mono text-lg font-bold">{verificationCode}</p>
              <ol className="list-decimal list-inside space-y-1 text-sm">
                <li>Add this code to your {platformName} bio/description</li>
                <li>Wait a few seconds for changes to save</li>
                <li>Click "Verify" to check</li>
                <li>You can remove the code after verification</li>
              </ol>
            </AlertDescription>
          </Alert>
        )}
      </div>
      <TermsDialog
        open={showTermsDialog}
        onOpenChange={(open) => {
          if (!isVerifying) {
            setShowTermsDialog(open);
          }
        }}
        onConfirm={async () => {
          await handleVerifyAccount();
          setShowTermsDialog(false);
        }}
        isLoading={isVerifying}
        confirmLabel="Accept & Verify"
        loadingLabel="Verifying"
      />
    </div>
  );
};
