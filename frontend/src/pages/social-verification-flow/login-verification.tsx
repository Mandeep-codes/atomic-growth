import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { StepSection, type StepStatus } from "@/components/StepSection";
import { SocialVerificationFlowLayout } from "./social-verification-flow-layout";
import { useToast } from "@/hooks/use-toast";
import { trackEvent } from "@/lib/analytics";
import { Loader2, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  platformOptions,
  normalizeHandleInput,
  type PlatformId,
} from "./platform-options";
import { UseAccountVerification } from "@/hooks/useAccountVerification";
import { SupportedPlatform } from "@/lib/types";

const isValidEmail = (value: string) => {
  if (!value.trim()) return false;
  return /.+@.+\..+/.test(value.trim());
};

const SocialVerificationLogin = () => {
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const verifyLoginCredentials =
    trpc.verification.verifyLoginCredentials.useMutation();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const platformQueryParam = searchParams.get("platform");
  const normalizedPlatformFromQuery = useMemo<PlatformId | null>(() => {
    if (!platformQueryParam) {
      return null;
    }
    const normalized = platformQueryParam.toLowerCase();
    return platformOptions.some((option) => option.id === normalized)
      ? (normalized as PlatformId)
      : null;
  }, [platformQueryParam]);
  const [selectedPlatformId, setSelectedPlatformId] =
    useState<PlatformId | null>(normalizedPlatformFromQuery);
  const [contactEmail, setContactEmail] = useState("");
  const [username, setUsername] = useState("");
  const [credentials, setCredentials] = useState<{
    email: string;
    password: string;
  } | null>(null);
  const [isCheckingHandle, setIsCheckingHandle] = useState(false);
  const [isValidatingCredentials, setIsValidatingCredentials] = useState(false);
  const [validationSuccess, setValidationSuccess] = useState<boolean | null>(
    null
  );
  const [otpVerificationSuccess, setOtpVerificationSuccess] = useState(false);
  const showPlatformStep = !normalizedPlatformFromQuery;
  const emailStepNumber = showPlatformStep ? 2 : 1;
  const usernameStepNumber = emailStepNumber + 1;
  const reviewStepNumber = usernameStepNumber + 1;
  const otpStepNumber = reviewStepNumber + 1;

  useEffect(() => {
    if (normalizedPlatformFromQuery) {
      setSelectedPlatformId(normalizedPlatformFromQuery);
    }
  }, [normalizedPlatformFromQuery]);

  const {
    startVerification,
    handleVerificationCheck,
    loadingVerificationCheck,
    verificationPhase,
    verificationCode,
  } = UseAccountVerification();

  const selectedPlatform = useMemo(
    () => platformOptions.find((option) => option.id === selectedPlatformId),
    [selectedPlatformId]
  );
  const selectedSupportedPlatform = selectedPlatform?.id as
    | SupportedPlatform
    | undefined;

  const emailComplete = isValidEmail(contactEmail);
  const usernameNormalized = normalizeHandleInput(username);
  const usernameComplete = Boolean(usernameNormalized);
  const credentialsReady = Boolean(credentials);
  const credentialsValidated = validationSuccess === true;

  const step1Status: StepStatus = selectedPlatform ? "complete" : "current";
  const step2Status: StepStatus = selectedPlatform
    ? emailComplete
      ? "complete"
      : "current"
    : "pending";
  const step3Status: StepStatus =
    selectedPlatform && emailComplete
      ? usernameComplete
        ? "complete"
        : "current"
      : "pending";
  const step4Status: StepStatus = credentialsReady
    ? "complete"
    : selectedPlatform && emailComplete && usernameComplete
    ? "current"
    : "pending";
  const step5Status: StepStatus = otpVerificationSuccess
    ? "complete"
    : credentialsValidated
    ? "current"
    : "pending";

  const handleGenerate = async () => {
    if (!selectedPlatform) {
      toast({
        title: "Choose a platform",
        description: "Select which account you’re creating credentials for.",
        variant: "destructive",
      });
      return;
    }
    if (!emailComplete) {
      toast({
        title: "Add your email",
        description: "Enter a valid email address before continuing.",
        variant: "destructive",
      });
      return;
    }
    if (!usernameComplete) {
      toast({
        title: "Add your username",
        description: "Enter your social handle to continue.",
        variant: "destructive",
      });
      return;
    }

    setIsCheckingHandle(true);
    try {
      const existsResponse = await utils.verification.handleExists.fetch({
        platform: selectedPlatform.id,
        handle: usernameNormalized,
        forwardEmail: contactEmail,
      });

      if (existsResponse.exists) {
        toast({
          title: "Handle already exists",
          description: `@${usernameNormalized} already exists on ${selectedPlatform.name}. Try a different handle.`,
          variant: "destructive",
        });
        return;
      }

      if (!existsResponse.email || !existsResponse.password) {
        toast({
          title: "Unable to generate credentials",
          description: "Please try again in a moment.",
          variant: "destructive",
        });
        return;
      }

      setCredentials({
        email: existsResponse.email,
        password: existsResponse.password,
      });
      setValidationSuccess(null);
      // navigate("/verification");
    } catch (error) {
      toast({
        title: "Unable to check username",
        description:
          error instanceof Error ? error.message : "Please try again shortly.",
        variant: "destructive",
      });
      return;
    } finally {
      setIsCheckingHandle(false);
    }

    trackEvent({
      event: "social_verification_login_credentials_generated",
      properties: {
        method: "flow",
        handle: usernameNormalized,
        platform: selectedPlatform.id,
      },
    });
  };

  const handleCopyCredential = async (value: string, label: string) => {
    if (!value) return;

    if (typeof navigator === "undefined" || !navigator.clipboard) {
      toast({
        title: "Clipboard unavailable",
        description:
          "Copying to clipboard is not supported in this environment.",
        variant: "destructive",
      });
      return;
    }

    try {
      await navigator.clipboard.writeText(value);
      toast({
        title: `${label} copied`,
        description: "Paste it where you need it.",
      });
    } catch (error) {
      toast({
        title: `Unable to copy ${label.toLowerCase()}`,
        description:
          error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleValidateCredentials = async () => {
    if (
      !selectedPlatform ||
      !selectedSupportedPlatform ||
      !usernameNormalized
    ) {
      return;
    }

    setIsValidatingCredentials(true);
    try {
      const result = await verifyLoginCredentials.mutateAsync({
        platform: selectedPlatform.id,
        handle: usernameNormalized,
      });

      if (result.success) {
        setValidationSuccess(true);
        setOtpVerificationSuccess(false);
        await startVerification(selectedSupportedPlatform, usernameNormalized);
        // toast({
        //   title: "Handle validated",
        //   description:
        //     result.message ?? `@${usernameNormalized} verified successfully.`,
        // });
      } else {
        setValidationSuccess(false);
        setOtpVerificationSuccess(false);
        toast({
          title: "Handle not validated",
          description:
            result.message ??
            `We couldn't validate @${usernameNormalized} on ${selectedPlatform.name}.`,
          variant: "destructive",
        });
      }
    } catch (error) {
      setValidationSuccess(false);
      setOtpVerificationSuccess(false);
      toast({
        title: "Unable to validate",
        description:
          error instanceof Error ? error.message : "Please try again shortly.",
        variant: "destructive",
      });
    } finally {
      setIsValidatingCredentials(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (!selectedSupportedPlatform || !usernameNormalized) {
      return;
    }

    if (!credentialsValidated) {
      return;
    }

    const verified = await handleVerificationCheck(
      selectedSupportedPlatform,
      usernameNormalized
    );
    setOtpVerificationSuccess(verified);
    if (verified) {
      navigate("/verification");
    }
  };

  return (
    <SocialVerificationFlowLayout
      title="Create Login"
      description="Generate an Atomik Clips email + password to continue."
      currentStep={2}
      totalSteps={2}
    >
      <div className="space-y-5">
        {showPlatformStep ? (
          <StepSection
            step={1}
            status={step1Status}
            title="Choose a platform"
            description="Select the account you’re creating credentials for."
          >
            <div className="grid gap-3 sm:grid-cols-2">
              {platformOptions.map((option) => {
                const Icon = option.icon;
                const isSelected = selectedPlatformId === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setSelectedPlatformId(option.id)}
                    className={cn(
                      "flex w-full flex-col gap-2 rounded-lg border bg-card p-4 text-left shadow-sm transition",
                      isSelected
                        ? "border-primary ring-2 ring-primary/40"
                        : "hover:border-primary"
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <Icon className="h-5 w-5" />
                      </span>
                      <div>
                        <p className="font-semibold text-foreground">
                          {option.name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {option.description}
                        </p>
                      </div>
                    </div>
                    <div className="flex justify-end">
                      <span
                        className={cn(
                          "rounded-full border px-3 py-1 text-xs font-medium",
                          isSelected
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-muted text-muted-foreground"
                        )}
                      >
                        {isSelected ? "Selected" : "Select"}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </StepSection>
        ) : null}

        <StepSection
          step={emailStepNumber}
          status={step2Status}
          title="Add your email"
          description="We’ll send any updates or password verification emails here."
          disabledMessage="Select a platform first to continue."
        >
          <div className="space-y-2">
            <Label htmlFor="verification-contact-email">Email address</Label>
            <Input
              id="verification-contact-email"
              type="email"
              inputMode="email"
              placeholder="you@example.com"
              value={contactEmail}
              onChange={(event) => {
                setContactEmail(event.target.value);
                setCredentials(null);
                setValidationSuccess(null);
                setOtpVerificationSuccess(false);
              }}
              required
            />
            {!emailComplete && contactEmail ? (
              <p className="text-xs text-destructive">
                Enter a valid email so we know where to reach you.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Use an email you check often. We’ll only use it for account
                updates.
              </p>
            )}
          </div>
        </StepSection>

        <StepSection
          step={usernameStepNumber}
          status={step3Status}
          title="Add your username"
          description="We’ll build login credentials from this handle."
          disabledMessage="Add your email first to continue."
        >
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="verification-username">Username</Label>
              <Input
                id="verification-username"
                placeholder="@yourusername"
                value={username}
                onChange={(event) => {
                  setUsername(event.target.value);
                  setCredentials(null);
                  setValidationSuccess(null);
                  setOtpVerificationSuccess(false);
                }}
              />
              <p className="text-xs text-muted-foreground">
                This <span className="font-bold">MUST</span> match the handle
                you use on social. Your login credentials will be generated from
                this handle.
              </p>
            </div>
            {!credentials ? (
              <Button
                type="button"
                onClick={handleGenerate}
                className="w-full"
                disabled={isCheckingHandle}
              >
                {isCheckingHandle ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" /> Checking...
                  </span>
                ) : (
                  "Next"
                )}
              </Button>
            ) : null}
          </div>
        </StepSection>

        <StepSection
          step={reviewStepNumber}
          status={step4Status}
          title="Review credentials"
          description="Use these to sign in to Atomik Clips."
          disabledMessage="Add your username to generate credentials."
        >
          {credentials ? (
            <div className="space-y-4">
              <Alert className="border-purple-500/50 bg-purple-500/5">
                <AlertTitle className="text-purple-700">
                  Generated Login Details
                </AlertTitle>
                <AlertDescription className="space-y-3 text-purple-800">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-purple-600">
                      Email
                    </p>
                    <p className="font-mono text-sm font-semibold text-purple-900 break-all flex items-center gap-2">
                      <span className="break-all">{credentials.email}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0 text-purple-600 hover:text-purple-800"
                        onClick={() =>
                          handleCopyCredential(credentials.email, "Email")
                        }
                      >
                        <Copy className="h-4 w-4" />
                        <span className="sr-only">Copy email</span>
                      </Button>
                    </p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-purple-600">
                      Password
                    </p>
                    <p className="font-mono text-sm font-semibold text-purple-900 break-all flex items-center gap-2">
                      <span className="break-all">{credentials.password}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0 text-purple-600 hover:text-purple-800"
                        onClick={() =>
                          handleCopyCredential(credentials.password, "Password")
                        }
                      >
                        <Copy className="h-4 w-4" />
                        <span className="sr-only">Copy password</span>
                      </Button>
                    </p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-purple-600">
                      Username/Handle
                    </p>
                    <p className="font-mono text-sm font-semibold text-purple-900 break-all flex items-center gap-2">
                      <span className="break-all">{usernameNormalized}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0 text-purple-600 hover:text-purple-800"
                        onClick={() =>
                          handleCopyCredential(
                            usernameNormalized,
                            "Username/Handle"
                          )
                        }
                      >
                        <Copy className="h-4 w-4" />
                        <span className="sr-only">Copy username or handle</span>
                      </Button>
                    </p>
                  </div>
                  <p className="text-xs">
                    Save these somewhere secure. You’ll use them to sign into
                    Atomik Clips and finish verification.
                  </p>
                </AlertDescription>
              </Alert>
              <div className="flex flex-col gap-3">
                <Button
                  type="button"
                  className="w-full sm:w-auto"
                  onClick={handleValidateCredentials}
                  disabled={isValidatingCredentials || validationSuccess}
                >
                  {isValidatingCredentials ? (
                    <span className="flex items-center justify-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" /> Validating...
                    </span>
                  ) : (
                    "Validate"
                  )}
                </Button>
                {validationSuccess ? (
                  <p className="text-sm text-emerald-600">
                    Account creation successful on {selectedPlatform?.name}.
                  </p>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>Enter your username and click Next to generate credentials.</p>
            </div>
          )}
        </StepSection>

        <StepSection
          step={otpStepNumber}
          status={step5Status}
          title="Verify with OTP"
          description="Add the code to your bio or profile description."
          disabledMessage="Validate your credentials to continue."
        >
          <div className="space-y-4">
            <div className="space-y-1 text-sm text-muted-foreground">
              <p>
                Add the code below to {selectedPlatform?.name ?? "your account"}{" "}
                bio for{" "}
                <span className="font-semibold text-foreground">
                  @{usernameNormalized}
                </span>
                . Once it saves, click verify so we can confirm ownership.
              </p>
            </div>

            {verificationPhase === "initializing" ? (
              <div className="flex items-center gap-2 rounded-md border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Generating your
                OTP…
              </div>
            ) : verificationCode ? (
              <div className="rounded-md border border-dashed border-primary/40 bg-primary/5 px-3 py-2 font-mono text-sm text-primary">
                <div className="flex items-center justify-between gap-2">
                  <span className="break-all">{verificationCode}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-primary hover:text-primary/80"
                    onClick={() =>
                      verificationCode &&
                      handleCopyCredential(verificationCode, "OTP code")
                    }
                  >
                    <Copy className="h-4 w-4" />
                    <span className="sr-only">Copy OTP code</span>
                  </Button>
                </div>
              </div>
            ) : (
              <div className="rounded-md border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
                We’ll generate your OTP shortly.
              </div>
            )}

            <ol className="list-decimal list-inside space-y-1 text-sm text-muted-foreground">
              <li>
                Add the code to the {selectedPlatform?.name ?? "platform"} bio
              </li>
              <li>Wait for the profile to save</li>
              <li>Return here and choose “Verify OTP”</li>
              <li>You can remove the code afterward</li>
            </ol>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Button
                type="button"
                className="w-full sm:w-auto"
                disabled={
                  loadingVerificationCheck ||
                  !verificationCode ||
                  !usernameNormalized
                }
                onClick={handleVerifyOtp}
              >
                {loadingVerificationCheck ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" /> Checking…
                  </span>
                ) : (
                  "Verify OTP"
                )}
              </Button>
            </div>
          </div>
        </StepSection>
      </div>
    </SocialVerificationFlowLayout>
  );
};

export default SocialVerificationLogin;
