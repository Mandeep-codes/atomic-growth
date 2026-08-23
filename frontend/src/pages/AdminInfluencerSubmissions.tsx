import { ChangeEvent, FormEvent, useMemo, useRef, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { DemographicData } from "@/shared/demographics";

const fileToBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const [, base64] = result.split(",");
      resolve(base64 ?? result);
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error("Failed to read file"));
    };
    reader.readAsDataURL(file);
  });

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

const AdminInfluencerSubmissions = () => {
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const [linkInput, setLinkInput] = useState("");
  const [detectedPlatform, setDetectedPlatform] = useState<string | null>(null);
  const [detectedHandle, setDetectedHandle] = useState<string | null>(null);
  const [normalizedLink, setNormalizedLink] = useState<string | null>(null);
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const [selectedCampaignId, setSelectedCampaignId] = useState("");
  const [isDetecting, setIsDetecting] = useState(false);
  const lastDetectionRequest = useRef(0);
  const demographicsFileInputRef = useRef<HTMLInputElement | null>(null);
  const [demographicsUpload, setDemographicsUpload] = useState<{
    screenshotUrl: string;
    data: DemographicData;
  } | null>(null);
  const [demographicsError, setDemographicsError] = useState<string | null>(
    null
  );
  const [impressionsInput, setImpressionsInput] = useState("");

  const linkValidationMessage = useMemo(() => {
    if (!linkInput) {
      return null;
    }
    return validateContentUrl(linkInput);
  }, [linkInput]);

  const { data: campaigns = [], isLoading: campaignsLoading } =
    trpc.influencerSubmissions.listCampaigns.useQuery();

  const demographicsUploadMutation =
    trpc.uploads.uploadDemographicScreenshot.useMutation({
      onSuccess: (response) => {
        if (response.success && response.demographics && response.screenshotUrl) {
          setDemographicsUpload({
            screenshotUrl: response.screenshotUrl,
            data: response.demographics,
          });
          setDemographicsError(null);
          toast({
            title: "Demographics parsed",
            description: "We detected audience countries from that image.",
          });
        } else {
          setDemographicsUpload(null);
          setDemographicsError(
            "We couldn't parse that screenshot. Try a clearer image."
          );
          toast({
            title: "Parsing failed",
            description: "Please upload a clearer demographics screenshot.",
            variant: "destructive",
          });
        }
      },
      onError: (error) => {
        setDemographicsError(error.message);
        toast({
          title: "Upload error",
          description: error.message,
          variant: "destructive",
        });
      },
    });

  const createInfluencerSubmission =
    trpc.influencerSubmissions.createSubmission.useMutation({
      onSuccess: () => {
        toast({
          title: "Submission stored",
          description: "We added this influencer clip to the campaign.",
        });
        setLinkInput("");
        setNormalizedLink(null);
        setDetectedPlatform(null);
        setDetectedHandle(null);
        setMetadataError(null);
        setDemographicsUpload(null);
        setDemographicsError(null);
        setImpressionsInput("");
      },
      onError: (error) => {
        toast({
          title: "Unable to save submission",
          description: error.message,
          variant: "destructive",
        });
      },
    });

  const handleLinkChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const { value } = event.target;
    setLinkInput(value);
    setMetadataError(null);
    setDetectedPlatform(null);
    setDetectedHandle(null);
    setNormalizedLink(null);

    if (!value) {
      setIsDetecting(false);
      return;
    }

    const validationError = validateContentUrl(value);
    if (validationError !== null) {
      setIsDetecting(false);
      return;
    }

    const requestId = ++lastDetectionRequest.current;
    setIsDetecting(true);

    try {
      const metadata = await utils.submissions.getPlatformMetadata.fetch({
        url: value,
      });

      if (requestId !== lastDetectionRequest.current) {
        return;
      }

      setNormalizedLink(metadata.url ?? value);
      setDetectedPlatform(metadata.platform ?? null);
      setDetectedHandle(metadata.username ?? null);

      if (!metadata.platform || !metadata.username) {
        setMetadataError("Unable to detect handle and platform from this link.");
      }
    } catch (error) {
      if (requestId !== lastDetectionRequest.current) {
        return;
      }
      setMetadataError(
        error instanceof Error
          ? error.message
          : "We couldn’t verify that link."
      );
    } finally {
      if (requestId === lastDetectionRequest.current) {
        setIsDetecting(false);
      }
    }
  };

  const handleDemographicsFileChange = async (
    event: ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    setDemographicsError(null);
    try {
      const base64 = await fileToBase64(file);
      await demographicsUploadMutation.mutateAsync({
        fileName: file.name,
        fileType: file.type || "application/octet-stream",
        fileBase64: base64,
        folder: "influencer-submissions/demographics",
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to upload screenshot";
      setDemographicsError(message);
      toast({
        title: "Upload failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      event.target.value = "";
    }
  };

  const supportedPlatforms = new Set(["x", "twitter", "linkedin"]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedCampaignId) {
      toast({
        title: "Choose a campaign",
        description: "Pick a campaign to attach this clip to.",
        variant: "destructive",
      });
      return;
    }

    if (!normalizedLink || !detectedPlatform || !detectedHandle) {
      toast({
        title: "Missing link details",
        description: "We need a valid link, platform, and handle first.",
        variant: "destructive",
      });
      return;
    }

    const normalizedPlatform = detectedPlatform.toLowerCase();
    if (!supportedPlatforms.has(normalizedPlatform)) {
      toast({
        title: "Unsupported platform",
        description: "Only Twitter/X and LinkedIn submissions are supported.",
        variant: "destructive",
      });
      return;
    }

    await createInfluencerSubmission.mutateAsync({
      influencerCampaignId: selectedCampaignId,
      link: normalizedLink,
      platform: normalizedPlatform === "twitter" ? "twitter" : normalizedPlatform,
      handle: detectedHandle,
      impressions: impressionsInput ? Number(impressionsInput) : undefined,
      demographics: demographicsUpload
        ? {
          screenshotUrl: demographicsUpload.screenshotUrl,
          parsed: demographicsUpload.data,
        }
        : undefined,
    });
  };

  const submitting = createInfluencerSubmission.isPending;
  const isUploadingDemographics = demographicsUploadMutation.isPending;
  const formDisabled = submitting || isDetecting || isUploadingDemographics;
  const normalizedPlatformValue = detectedPlatform?.toLowerCase();
  const submitDisabled =
    formDisabled ||
    !normalizedLink ||
    !normalizedPlatformValue ||
    !supportedPlatforms.has(normalizedPlatformValue) ||
    !detectedHandle ||
    !selectedCampaignId;

  return (
    <AppLayout>
      <div className="mx-auto max-w-4xl space-y-6 px-6 py-8">
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold text-foreground">
            Influencer submissions
          </h1>
          <p className="text-muted-foreground">
            Track influencer content you sourced manually by attaching a link and
            filing it under a campaign.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Add a submission</CardTitle>
            <CardDescription>
              Paste the link, confirm the detected handle, and choose the
              influencer campaign.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-6" onSubmit={handleSubmit}>
              <div className="space-y-2">
                <Label htmlFor="submission-link">Content link</Label>
                <div className="relative">
                  <Input
                    id="submission-link"
                    placeholder="https://"
                    value={linkInput}
                    onChange={handleLinkChange}
                    inputMode="url"
                    autoComplete="off"
                    disabled={submitting}
                    className={cn(isDetecting && "pr-10")}
                    aria-describedby="link-helper"
                  />
                  {isDetecting ? (
                    <Loader2 className="absolute right-3 top-1/3 h-4 w-4 animate-spin text-muted-foreground" />
                  ) : null}
                </div>
                <p id="link-helper" className="text-xs text-muted-foreground">
                  We’ll auto-detect the platform and handle from this URL.
                </p>
                {linkValidationMessage ? (
                  <p className="text-xs text-destructive">
                    {linkValidationMessage}
                  </p>
                ) : metadataError ? (
                  <p className="text-xs text-destructive">{metadataError}</p>
                ) : null}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Platform</Label>
                  <Input
                    value={detectedPlatform ?? "Not detected"}
                    disabled
                    className="text-left"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Handle</Label>
                  <Input
                    value={detectedHandle ?? "Not detected"}
                    disabled
                    className="text-left"
                  />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Campaign</Label>
                  <Select
                    value={selectedCampaignId}
                    onValueChange={setSelectedCampaignId}
                    disabled={formDisabled || campaigns.length === 0}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue
                        placeholder={
                          campaignsLoading
                            ? "Loading campaigns…"
                            : campaigns.length > 0
                              ? "Select a campaign"
                              : "No campaigns available"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {campaigns.map((campaign) => (
                        <SelectItem key={campaign.id} value={campaign.id}>
                          <div className="flex flex-col">
                            <span className="font-medium">{campaign.title}</span>
                            <span className="text-xs text-muted-foreground">
                              {campaign.submissionCount} submissions logged
                            </span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Campaigns come directly from the influencer campaigns table.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="impressions">Impressions (optional)</Label>
                  <Input
                    id="impressions"
                    type="number"
                    min={0}
                    inputMode="numeric"
                    placeholder="0"
                    value={impressionsInput}
                    onChange={(event) => setImpressionsInput(event.target.value)}
                    disabled={formDisabled}
                  />
                  <p className="text-xs text-muted-foreground">
                    Optional. Provide the reported views for this clip.
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Add demographics (optional)</Label>
                <p className="text-sm text-muted-foreground">
                  Upload a demographics screenshot to auto-fill audience data for
                  this submission.
                </p>
                <input
                  type="file"
                  className="hidden"
                  ref={demographicsFileInputRef}
                  accept="image/*"
                  onChange={handleDemographicsFileChange}
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => demographicsFileInputRef.current?.click()}
                    disabled={isUploadingDemographics || submitting}
                  >
                    {isUploadingDemographics
                      ? "Uploading screenshot"
                      : demographicsUpload
                        ? "Replace screenshot"
                        : "Upload screenshot"}
                  </Button>
                  {demographicsUpload ? (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setDemographicsUpload(null)}
                      disabled={isUploadingDemographics || submitting}
                    >
                      Remove demographics
                    </Button>
                  ) : null}
                </div>
                {isUploadingDemographics ? (
                  <div className="flex items-center gap-3 rounded-lg border bg-muted/40 px-4 py-3 text-sm">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Analyzing screenshot…</span>
                  </div>
                ) : null}
                {demographicsUpload ? (
                  <div className="space-y-2 rounded-lg border bg-muted/40 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                      <div>
                        <p className="text-xs uppercase text-muted-foreground">
                          Countries detected
                        </p>
                        <p className="text-xl font-semibold">
                          {demographicsUpload.data.countries.length}
                        </p>
                      </div>
                      <a
                        href={demographicsUpload.screenshotUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs font-medium text-primary underline"
                      >
                        View screenshot
                      </a>
                    </div>
                    <ul className="space-y-1 text-sm">
                      {[...demographicsUpload.data.countries]
                        .sort((a, b) => b.percentage - a.percentage)
                        .slice(0, 3)
                        .map((country) => (
                          <li
                            key={country.country}
                            className="flex items-center justify-between"
                          >
                            <span>{country.country}</span>
                            <span className="text-muted-foreground">
                              {country.percentage}%
                            </span>
                          </li>
                        ))}
                    </ul>
                  </div>
                ) : null}
                {demographicsError ? (
                  <p className="text-xs text-destructive">{demographicsError}</p>
                ) : null}
              </div>

              <Button type="submit" disabled={submitDisabled} className="w-full sm:w-auto">
                {submitting ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Saving
                  </span>
                ) : (
                  "Save submission"
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
};

export default AdminInfluencerSubmissions;
