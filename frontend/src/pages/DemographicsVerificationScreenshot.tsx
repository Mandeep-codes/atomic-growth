import { ReactNode, useEffect, useMemo, useState } from "react";
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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/components/ui/use-toast";
import { AppLayout } from "@/components/AppLayout";
import { CountryPicker } from "@/components/CountryPicker";
import { isValidYouTubeUrl, parseYouTubeUrl } from "@/lib/youtube";

type VerificationMethod = "api" | "screenshot" | "exemption";

// Google Drive links are QUIETLY accepted as an alternative to YouTube —
// some clippers' YouTube accounts are banned, so they can't host the
// analytics recording there. Deliberately unadvertised: every visible
// string keeps saying "YouTube only"; a pasted Drive link simply passes
// validation with no detection badge and no error. Mods are told 1:1.
// The mod review page falls back to a plain open-in-new-tab link for
// non-YouTube URLs, so no other UI changes are needed.
const GOOGLE_DRIVE_VIDEO_PATTERN =
  /^https?:\/\/(?:drive|docs)\.google\.com\/(?:file\/d\/[A-Za-z0-9_-]{10,}|(?:open|uc)\?(?:[^#]*&)?id=[A-Za-z0-9_-]{10,})/i;

// Clipper-entered country breakdown only applies to campaigns created
// after this cutoff. Existing campaigns (the one currently running)
// continue to skip Step 4 and let the moderator fill it in.
// Set to UTC midnight 2026-06-17 so anything Pranav creates from
// 2026-06-17 IST onwards picks up the new flow.
const CLIPPER_DEMOGRAPHIC_ENTRY_CUTOFF = new Date("2026-06-17T00:00:00Z");

// Top 6 countries that consistently appear in every Atomik campaign
// rollup (India, US, UK, Canada, Germany, Australia cover ~92% of
// typical audience). Pre-populated so most clippers can fill the form
// without typing a country name.
const TOP_6_COUNTRIES = [
  "India",
  "United States",
  "United Kingdom",
  "Canada",
  "Germany",
  "Australia",
];

// Platform-specific guidance for where to find the audience country
// breakdown. Falls back to a generic line for unknown platforms.
const PLATFORM_ANALYTICS_PATH: Record<
  string,
  { label: string; path: string }
> = {
  youtube: {
    label: "YouTube",
    path: "Open YouTube Studio (studio.youtube.com or the YouTube Studio app), go to Analytics → Audience → Top geographies.",
  },
  instagram: {
    label: "Instagram",
    path: "Open the Instagram app, go to your Profile → Professional dashboard → Total audience → Top countries.",
  },
  tiktok: {
    label: "TikTok",
    path: "Open the TikTok app, go to Profile → Menu (☰) → Creator tools → Analytics → Followers tab → Top territories.",
  },
  x: {
    label: "X",
    path: "Open analytics.x.com on desktop, sign in, then go to Audience → Geography.",
  },
};

function getPlatformGuidance(platform: string | null | undefined) {
  if (!platform) return null;
  return PLATFORM_ANALYTICS_PATH[platform.toLowerCase()] ?? null;
}

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
  children,
  description,
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

const DemographicsVerification = ({
  method,
}: {
  method: VerificationMethod;
}) => {
  const { id } = useParams<{ id: string }>();
  const claimId = id ?? "";
  const { toast } = useToast();
  const navigate = useNavigate();

  const {
    data: claim,
    isLoading,
    error,
  } = trpc.demographicsVerification.getClaim.useQuery(
    { id: claimId },
    { enabled: Boolean(claimId) }
  );

  const utils = trpc.useUtils();
  const [videoUrl, setVideoUrl] = useState("");
  const [exemptionReason, setExemptionReason] = useState("");
  const [localStatus, setLocalStatus] = useState<string | null>(null);

  // Country breakdown form state — clipper enters the percentages they
  // see in their analytics so the mod has it pre-filled in review.
  const [demographics, setDemographics] = useState<Record<string, string>>({});
  const [customCountries, setCustomCountries] = useState<string[]>([]);
  const [attestationConfirmed, setAttestationConfirmed] = useState(false);

  // Prefill from server in case the user is editing an existing claim.
  useEffect(() => {
    if (claim?.screenshotFileUrl) setVideoUrl(claim.screenshotFileUrl);
  }, [claim?.screenshotFileUrl]);
  useEffect(() => {
    if (claim?.status) setLocalStatus(claim.status);
  }, [claim?.status]);
  useEffect(() => {
    if (typeof claim?.exemptionReason === "string") {
      setExemptionReason(claim.exemptionReason);
    }
  }, [claim?.exemptionReason]);

  const submitVideoMutation =
    trpc.demographicsVerification.submitVideoLink.useMutation({
      onSuccess: async () => {
        setLocalStatus("needs-human-review");
        toast({
          title: "Submitted for review",
          description:
            "A moderator will watch your recording and confirm the data shortly.",
        });
        await utils.demographicsVerification.getClaim.invalidate({
          id: claimId,
        });
        navigate("/demographics-verification");
      },
      onError: (err) => {
        toast({
          title: "Submission failed",
          description: err.message,
          variant: "destructive",
        });
      },
    });

  const submitExemptionMutation =
    trpc.demographicsVerification.submitExemption.useMutation({
      onSuccess: async () => {
        setLocalStatus("needs-human-review");
        toast({
          title: "Exemption requested",
          description: "A moderator will review your request shortly.",
        });
        await utils.demographicsVerification.getClaim.invalidate({
          id: claimId,
        });
        navigate("/demographics-verification");
      },
      onError: (err) => {
        toast({
          title: "Submission failed",
          description: err.message,
          variant: "destructive",
        });
      },
    });

  const parsedVideo = useMemo(() => parseYouTubeUrl(videoUrl), [videoUrl]);
  const isDriveVideo = GOOGLE_DRIVE_VIDEO_PATTERN.test(videoUrl.trim());
  const trimmedReason = exemptionReason.trim();
  const platformGuidance = getPlatformGuidance(claim?.verifiedPlatform);

  // Only campaigns created on/after the cutoff make the clipper fill in
  // the country breakdown. Older campaigns keep the upload-only flow and
  // the moderator fills the form during review.
  const clipperDemographicEntryRequired = useMemo(() => {
    if (!claim?.campaignCreatedAt) return false;
    return new Date(claim.campaignCreatedAt) >= CLIPPER_DEMOGRAPHIC_ENTRY_CUTOFF;
  }, [claim?.campaignCreatedAt]);

  // Live-computed sum + remainder for the country form.
  const totalEnteredPct = useMemo(() => {
    return Object.values(demographics).reduce((acc, v) => {
      const n = parseFloat(v);
      return acc + (Number.isFinite(n) ? n : 0);
    }, 0);
  }, [demographics]);
  const otherPercentage = Math.max(0, 100 - totalEnteredPct);

  // Did the clipper enter any country data at all?
  const hasAnyCountryData = useMemo(() => {
    return [...TOP_6_COUNTRIES, ...customCountries].some((c) => {
      const v = parseFloat(demographics[c] ?? "");
      return Number.isFinite(v) && v > 0;
    });
  }, [demographics, customCountries]);

  const handleRemoveCustomCountry = (country: string) => {
    setCustomCountries(customCountries.filter((c) => c !== country));
    const next = { ...demographics };
    delete next[country];
    setDemographics(next);
  };

  const buildParsedDataPayload = () => {
    if (!hasAnyCountryData) return undefined;
    const result: { country: string; percentage: number }[] = [];
    [...TOP_6_COUNTRIES, ...customCountries].forEach((c) => {
      const v = parseFloat(demographics[c] ?? "");
      if (Number.isFinite(v) && v > 0) {
        result.push({ country: c, percentage: v });
      }
    });
    if (otherPercentage > 0) {
      result.push({
        country: "Other",
        percentage: Number(otherPercentage.toFixed(2)),
      });
    }
    return { countries: result };
  };

  const handleSubmitVideo = () => {
    if (!isValidYouTubeUrl(videoUrl) && !isDriveVideo) {
      toast({
        title: "Invalid YouTube link",
        description:
          "Please paste an unlisted YouTube video URL (youtube.com or youtu.be).",
        variant: "destructive",
      });
      return;
    }
    if (totalEnteredPct > 100) {
      toast({
        title: "Country percentages exceed 100%",
        description: "Adjust the entered values so the total is 100% or less.",
        variant: "destructive",
      });
      return;
    }
    if (hasAnyCountryData && !attestationConfirmed) {
      toast({
        title: "Please confirm your attestation",
        description:
          "Tick the box at the bottom to confirm the country breakdown matches what's in your recording.",
        variant: "destructive",
      });
      return;
    }
    submitVideoMutation.mutate({
      id: claimId,
      videoUrl: videoUrl.trim(),
      parsedData: buildParsedDataPayload(),
      attestationConfirmed: hasAnyCountryData ? attestationConfirmed : undefined,
    });
  };

  const handleSubmitExemption = () => {
    if (!trimmedReason) {
      toast({
        title: "Please provide a reason",
        description:
          "Tell us why you can't record analytics so the moderator has context.",
        variant: "destructive",
      });
      return;
    }
    submitExemptionMutation.mutate({
      id: claimId,
      exemptionReason: trimmedReason,
    });
  };

  const currentStatus = localStatus ?? claim?.status ?? "created";
  const isFinalized = ["approved", "needs-human-review", "cancelled"].includes(
    currentStatus
  );
  const isExemption = method === "exemption";

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
            {claim && claim.coveredCampaignCount > 1 && (
              <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
                This one submission for @
                {claim.verifiedHandle ?? claim.verifiedUsername} covers all{" "}
                {claim.coveredCampaignCount} of its campaigns:{" "}
                <span className="font-medium text-foreground">
                  {claim.coveredCampaignTitles.join(", ")}
                </span>
                .
              </p>
            )}
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
                <CardTitle>
                  {isExemption
                    ? "Request an exemption"
                    : "Submit your screen recording"}
                </CardTitle>
                <CardDescription>
                  {isExemption
                    ? "Tell us why you can't record analytics — a moderator will review and confirm."
                    : "A moderator will watch your recording before this is approved. No auto-approval."}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {!isExemption && (
                  <>
                    <StepSection
                      stepNumber={1}
                      title="Record your screen"
                      description="Show that the recording is fresh and unedited."
                    >
                      {claim?.requiredRecordingPeriodDays && (
                        <p className="rounded-lg border border-primary/40 bg-primary/10 p-3 text-sm">
                          <span className="font-medium">
                            Set your analytics to the last{" "}
                            {claim.requiredRecordingPeriodDays} days
                          </span>{" "}
                          before recording — in your{" "}
                          {platformGuidance?.label ?? "analytics"} audience view,
                          choose the {claim.requiredRecordingPeriodDays}-day
                          window and screen-record the country breakdown for
                          that period.
                        </p>
                      )}
                      {platformGuidance && (
                        <p className="rounded-lg border bg-muted/40 p-3 text-sm">
                          <span className="font-medium">
                            You're verifying your {platformGuidance.label}{" "}
                            account
                          </span>
                          {claim?.verifiedHandle
                            ? ` (@${claim.verifiedHandle})`
                            : ""}
                          . The recording must show audience data from this
                          account specifically.
                        </p>
                      )}
                      <ul className="ml-1 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
                        <li>
                          <span className="font-medium text-foreground">
                            On mobile:
                          </span>{" "}
                          start the screen recording, open your phone's
                          Calendar app showing today's date, then continue.
                        </li>
                        <li>
                          <span className="font-medium text-foreground">
                            On desktop:
                          </span>{" "}
                          start a browser screen recording, Google search{" "}
                          <span className="italic">
                            "what is today's date and time"
                          </span>{" "}
                          and show the result, then continue.
                        </li>
                        <li>
                          {platformGuidance
                            ? platformGuidance.path
                            : "Open the platform's app or website for the account you verified, and navigate to its audience analytics."}
                        </li>
                        <li>
                          Make sure the country/geography breakdown is clearly
                          visible in the recording.
                        </li>
                        <li>End the recording and save it.</li>
                      </ul>
                    </StepSection>

                    <StepSection
                      stepNumber={2}
                      title="Upload to YouTube as Unlisted"
                      description="Unlisted videos are only visible to people with the link — they don't appear in search."
                    >
                      <ul className="ml-1 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                        <li>Open YouTube and upload your recording.</li>
                        <li>
                          Set the visibility to{" "}
                          <span className="font-medium text-foreground">
                            Unlisted
                          </span>{" "}
                          — not Private, not Public.
                        </li>
                        <li>Copy the video link once it's uploaded.</li>
                      </ul>
                    </StepSection>

                    <StepSection
                      stepNumber={3}
                      title="Paste your unlisted YouTube link"
                      description="We accept regular videos and Shorts (vertical) — both work."
                    >
                      <div className="space-y-2">
                        <Input
                          type="url"
                          inputMode="url"
                          placeholder="https://youtu.be/your-video-id"
                          value={videoUrl}
                          onChange={(event) => setVideoUrl(event.target.value)}
                          disabled={
                            submitVideoMutation.isPending || isFinalized
                          }
                          aria-invalid={
                            videoUrl.length > 0 && !parsedVideo && !isDriveVideo
                              ? true
                              : false
                          }
                        />
                        {videoUrl.length > 0 && !parsedVideo && !isDriveVideo && (
                          <p className="text-xs text-destructive">
                            That doesn't look like a YouTube URL. Try a
                            youtube.com or youtu.be link.
                          </p>
                        )}
                        {parsedVideo && (
                          <p className="text-xs text-muted-foreground">
                            Detected: {parsedVideo.isShort ? "YouTube Short" : "YouTube video"} •
                            {" "}id <span className="font-mono">{parsedVideo.id}</span>
                          </p>
                        )}
                      </div>
                    </StepSection>

                    {/* NEW Step 4 — clipper enters the country breakdown they see.
                         Gated to campaigns created after CLIPPER_DEMOGRAPHIC_ENTRY_CUTOFF;
                         older campaigns continue with upload-only and let the mod fill it in. */}
                    {clipperDemographicEntryRequired && (
                    <StepSection
                      stepNumber={4}
                      title="Enter your country breakdown"
                      description="Type the percentage you see for each country in your analytics. You must enter a value for every country shown to you. If any value is wrong, all your clips AND your payout for this campaign will be rejected."
                    >
                      <div className="grid grid-cols-1 gap-x-3 gap-y-2 sm:grid-cols-2">
                        {TOP_6_COUNTRIES.map((country) => (
                          <div
                            key={country}
                            className="grid grid-cols-[1fr_56px] sm:grid-cols-[1fr_80px] items-center gap-2"
                          >
                            <span className="text-sm">{country}</span>
                            <Input
                              type="number"
                              min={0}
                              max={100}
                              step={0.1}
                              placeholder="0"
                              value={demographics[country] ?? ""}
                              onChange={(e) =>
                                setDemographics({
                                  ...demographics,
                                  [country]: e.target.value,
                                })
                              }
                              className="h-8 text-right"
                              disabled={
                                submitVideoMutation.isPending || isFinalized
                              }
                            />
                          </div>
                        ))}

                        {customCountries.map((country) => (
                          <div
                            key={country}
                            className="grid grid-cols-[1fr_56px_32px] sm:grid-cols-[1fr_80px_30px] items-center gap-1"
                          >
                            <span className="text-sm truncate">{country}</span>
                            <Input
                              type="number"
                              min={0}
                              max={100}
                              step={0.1}
                              placeholder="0"
                              value={demographics[country] ?? ""}
                              onChange={(e) =>
                                setDemographics({
                                  ...demographics,
                                  [country]: e.target.value,
                                })
                              }
                              className="h-8 text-right"
                              disabled={
                                submitVideoMutation.isPending || isFinalized
                              }
                            />
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-muted-foreground"
                              onClick={() => handleRemoveCustomCountry(country)}
                              type="button"
                              title="Remove this country"
                            >
                              ✕
                            </Button>
                          </div>
                        ))}
                      </div>

                      {/* Other (auto-calculated) */}
                      <div className="grid grid-cols-[1fr_56px] sm:grid-cols-[1fr_80px] items-center gap-2 border-t pt-2">
                        <span className="text-sm font-medium text-muted-foreground">
                          Other (auto-calculated)
                        </span>
                        <div className="text-right text-sm font-mono">
                          {otherPercentage.toFixed(1)}
                        </div>
                      </div>

                      {/* + Add other country — searchable dropdown from canonical ISO list */}
                      <CountryPicker
                        excluded={[...TOP_6_COUNTRIES, ...customCountries]}
                        onPick={(country) => {
                          if (
                            !TOP_6_COUNTRIES.includes(country) &&
                            !customCountries.includes(country)
                          ) {
                            setCustomCountries([...customCountries, country]);
                          }
                        }}
                        disabled={
                          submitVideoMutation.isPending || isFinalized
                        }
                      />

                      {/* Live total + warnings */}
                      <div className="flex items-center justify-between border-t pt-2 text-xs">
                        <span className="text-muted-foreground">
                          Total entered: {totalEnteredPct.toFixed(1)}% + Other{" "}
                          {otherPercentage.toFixed(1)}% ={" "}
                          {(totalEnteredPct + otherPercentage).toFixed(1)}%
                        </span>
                        {totalEnteredPct > 100 && (
                          <span className="text-destructive">
                            ⚠ Over 100% — adjust before submitting
                          </span>
                        )}
                      </div>

                      {/* Attestation disclaimer (required when country data is entered) */}
                      {hasAnyCountryData && (
                        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
                          <label className="flex items-start gap-3 cursor-pointer">
                            <Checkbox
                              checked={attestationConfirmed}
                              onCheckedChange={(v) =>
                                setAttestationConfirmed(Boolean(v))
                              }
                              disabled={
                                submitVideoMutation.isPending || isFinalized
                              }
                              className="mt-0.5"
                            />
                            <span className="leading-snug">
                              <span className="font-semibold">
                                I confirm these values match exactly what's
                                shown in my screen recording.
                              </span>{" "}
                              I understand that if any percentage is wrong or
                              missing, all my clips AND my payout for this
                              campaign will be rejected. This is my
                              responsibility.
                            </span>
                          </label>
                        </div>
                      )}
                    </StepSection>
                    )}

                    {/* Final submit */}
                    <div>
                      <Button
                        onClick={handleSubmitVideo}
                        disabled={
                          (!parsedVideo && !isDriveVideo) ||
                          submitVideoMutation.isPending ||
                          isFinalized ||
                          totalEnteredPct > 100 ||
                          (hasAnyCountryData && !attestationConfirmed)
                        }
                        className="w-full sm:w-auto"
                      >
                        {submitVideoMutation.isPending
                          ? "Submitting..."
                          : "Submit for moderator review"}
                      </Button>
                    </div>
                  </>
                )}

                {isExemption && (
                  <StepSection
                    stepNumber={1}
                    title="Why can't you record your analytics?"
                    description="Common reasons: account is too new for analytics, platform doesn't show country data for your tier, etc."
                  >
                    <Textarea
                      value={exemptionReason}
                      onChange={(event) =>
                        setExemptionReason(event.target.value)
                      }
                      placeholder="Example: My YouTube channel is less than 30 days old and demographics haven't been generated yet."
                      disabled={
                        submitExemptionMutation.isPending || isFinalized
                      }
                    />
                    <div className="pt-2">
                      <Button
                        onClick={handleSubmitExemption}
                        disabled={
                          !trimmedReason ||
                          submitExemptionMutation.isPending ||
                          isFinalized
                        }
                      >
                        {submitExemptionMutation.isPending
                          ? "Submitting..."
                          : "Request exemption"}
                      </Button>
                    </div>
                  </StepSection>
                )}

                {isFinalized && (
                  <p className="text-sm text-muted-foreground">
                    This verification is{" "}
                    <span className="font-medium text-foreground">
                      {currentStatus}
                    </span>
                    . You'll be notified once the moderator finishes their
                    review.
                  </p>
                )}
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

export default DemographicsVerification;
