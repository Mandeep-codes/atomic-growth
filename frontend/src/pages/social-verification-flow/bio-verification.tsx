import { useEffect, useMemo, useState } from "react";
import { StepSection, type StepStatus } from "@/components/StepSection";
import { SocialVerificationFlowLayout } from "./social-verification-flow-layout";
import { VerificationCardVerifyBio } from "@/components/VerificationCardVerifyBio";
import { Instagram, Music2, Twitter, Youtube } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSearchParams } from "react-router-dom";

const platformOptions = [
  {
    id: "instagram" as const,
    name: "Instagram",
    description: "For Reels and feed posts",
    icon: Instagram,
  },
  {
    id: "youtube" as const,
    name: "YouTube",
    description: "Channels and Shorts",
    icon: Youtube,
  },
  {
    id: "x" as const,
    name: "X",
    description: "Tweets and reposts",
    icon: Twitter,
  },
  {
    id: "tiktok" as const,
    name: "TikTok",
    description: "Clips and livestreams",
    icon: Music2,
  },
];

const SocialVerificationBio = () => {
  const [searchParams] = useSearchParams();
  const platformQueryParam = searchParams.get("platform");
  const normalizedPlatformFromQuery = useMemo<
    (typeof platformOptions)[number]["id"] | null
  >(() => {
    if (!platformQueryParam) {
      return null;
    }
    const normalized = platformQueryParam.toLowerCase();
    return platformOptions.some((option) => option.id === normalized)
      ? (normalized as (typeof platformOptions)[number]["id"])
      : null;
  }, [platformQueryParam]);
  const [selectedPlatformId, setSelectedPlatformId] = useState<
    (typeof platformOptions)[number]["id"] | null
  >(normalizedPlatformFromQuery);
  const showPlatformStep = !normalizedPlatformFromQuery;
  const verificationStepNumber = showPlatformStep ? 2 : 1;

  useEffect(() => {
    if (normalizedPlatformFromQuery) {
      setSelectedPlatformId(normalizedPlatformFromQuery);
    }
  }, [normalizedPlatformFromQuery]);

  const selectedPlatform = useMemo(
    () => platformOptions.find((option) => option.id === selectedPlatformId),
    [selectedPlatformId]
  );

  const step1Status: StepStatus = selectedPlatform ? "complete" : "current";
  const step2Status: StepStatus = selectedPlatform ? "current" : "pending";

  return (
    <SocialVerificationFlowLayout
      title="Profile Verification"
      description="Add a verification code to your profile."
      currentStep={2}
      totalSteps={2}
    >
      <div className="space-y-5">
        {showPlatformStep ? (
          <StepSection
            step={1}
            status={step1Status}
            title="Choose a platform"
            description="Select the account you’re verifying."
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
          step={verificationStepNumber}
          status={step2Status}
          title="Add verification code"
          description="Follow the steps to add and verify your code."
          disabledMessage="Select a platform first to continue."
        >
          {selectedPlatform ? (
            <VerificationCardVerifyBio
              key={selectedPlatform.id}
              platform={selectedPlatform.id}
              platformName={selectedPlatform.name}
              refetchVerification={() => {}}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              Choose a platform above to get your verification code
              instructions.
            </p>
          )}
        </StepSection>
      </div>
    </SocialVerificationFlowLayout>
  );
};

export default SocialVerificationBio;
