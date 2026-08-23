import { useParams, useNavigate, Link } from "react-router-dom";
import { useState, useEffect } from "react";
import {
  Loader2,
  Save,
  Copy,
  Check,
  Eye,
  EyeOff,
  ChevronsUpDown,
  X,
  Scissors,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAdminCampaignData } from "@/hooks/useCampaignData";
import { useToast } from "@/hooks/use-toast";
import { trpc } from "@/lib/trpc";
import { AppLayout } from "@/components/AppLayout";
import { countrySchema } from "@/shared/demographics";
import { CampaignLevelsManager } from "@/components/CampaignLevelsManager";
import { CampaignCpmGroupsManager } from "@/components/CampaignCpmGroupsManager";
import { CampaignGeoRulesManager } from "@/components/CampaignGeoRulesManager";

const countryOptions = countrySchema.options;
type CountryOption = (typeof countryOptions)[number];

// The exact phrase a user must type to confirm deleting a campaign card.
// Per-clip floor inputs: BLANK means "use the platform default" (matching the
// placeholder ghost text), NOT 0 — parseInt("")||0 silently disabled the floor
// while the empty box still displayed "1500". An explicit 0 turns the floor
// off. Number() (not parseInt) so "2e4" reads as 20000, not 2.
const parseFloorInput = (raw: string, platformDefault: number): number => {
  const trimmed = raw.trim();
  if (trimmed === "") return platformDefault;
  const n = Number(trimmed);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : platformDefault;
};

const DELETE_CONFIRM_PHRASE =
  "I really really really know what i am doing. pinky promise!";

const CampaignEdit = () => {
  const { campaignId } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { data: campaignInfo, isLoading: campaignLoading } = useAdminCampaignData(
    campaignId!,
    undefined,
    {
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      refetchInterval: false,
      staleTime: Infinity,
    }
  );

  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [copied, setCopied] = useState(false);
  const [hasExternalPassword, setHasExternalPassword] = useState(false);
  const [externalPasswordInput, setExternalPasswordInput] = useState("");
  const [removeExternalPassword, setRemoveExternalPassword] = useState(false);
  const [showExternalPassword, setShowExternalPassword] = useState(false);
  const [countryPopoverOpen, setCountryPopoverOpen] = useState(false);
  const [bulkActivateSince, setBulkActivateSince] = useState("");

  // Campaign form state
  const [campaignForm, setCampaignForm] = useState({
    title: "",
    budget: "",
    external_budget: "",
    cpm: "",
    max_payout: "",
    min_payout: "",
    demographics_min_views: "",
    insta_per_1000: "",
    x_per_1000: "",
    youtube_per_1000: "",
    tiktok_per_1000: "",
    youtube_min_views: "",
    insta_min_views: "",
    x_min_views: "",
    tiktok_min_views: "",
    imageUrl: "",
    sopEmbedUrl: "",
    description: "",
    active: true,
    ended: false,
    submissionsPaused: false,
    demographicsVerificationEnabled: false,
    demographicsVisibleCountries: [] as CountryOption[],
    // "" = no specific window; otherwise "7" | "28" | "90".
    demographicsRecordingPeriod: "",
    is_hot_streak_enabled: false,
    clipperActivityEnabled: true,
    requireNonCampaignClips: false,
    nonCampaignClipsCount: "1",
    nonCampaignClipsPer: "1",
    endDate: "",
    platforms: [] as Array<"youtube" | "instagram" | "tiktok" | "x">,
    isPrivate: false,
    privateShowBudget: false,
    privateShowRates: false,
    privateShowMinViews: false,
    privateShowDescription: true,
    privateTeaserTitle: "",
    privateTeaserImageUrl: "",
    privateTeaserDescription: "",
    paymentMethods: [] as string[],
    privateDiscordGuildId: "",
  });

  // tRPC mutation
  const updateCampaignMutation = trpc.campaigns.updateCampaign.useMutation();
  const utils = trpc.useUtils();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [finalConfirmOpen, setFinalConfirmOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const deleteCardMutation = trpc.campaigns.deleteCard.useMutation({
    onSuccess: async () => {
      await utils.campaigns.getAll.invalidate();
      toast({
        title: "Campaign card deleted",
        description:
          "The card is hidden. The campaign and all its data are intact — recover it anytime from Clipping Campaigns.",
      });
      setDeleteDialogOpen(false);
      setFinalConfirmOpen(false);
      setDeleteConfirmText("");
      navigate("/admin");
    },
    onError: (e) =>
      toast({
        title: "Delete failed",
        description: e.message || "Could not delete the campaign card.",
        variant: "destructive",
      }),
  });
  const bulkActivateClaimsMutation =
    trpc.demographicsVerification.bulkActivateByCampaign.useMutation();

  // ── Campaign-scoped demographics request ──
  // Asks only the clippers who generated views on THIS campaign, about only the
  // accounts they used here, and holds back only this campaign's earnings.
  const [resetNote, setResetNote] = useState("");
  const openAsk = trpc.demographicsVerification.listOpenResetRequests.useQuery(
    undefined,
    { enabled: Boolean(campaignId) }
  );
  const activeAsk = (openAsk.data ?? []).find(
    (row) => row.campaignId === campaignId
  );
  const requestResetMutation =
    trpc.demographicsVerification.requestCampaignReset.useMutation({
      onSuccess: (result) => {
        toast({
          title: "Demographics requested",
          description: `${result.notifiedUserCount} clipper(s) notified. Their earnings on this campaign are on hold until approved.`,
        });
        setResetNote("");
        void openAsk.refetch();
      },
      onError: (e) =>
        toast({
          title: "Could not send the request",
          description: e.message,
          variant: "destructive",
        }),
    });
  const cancelResetMutation =
    trpc.demographicsVerification.cancelCampaignReset.useMutation({
      onSuccess: () => {
        toast({
          title: "Request closed",
          description: "This campaign's earnings are no longer on hold.",
        });
        void openAsk.refetch();
      },
      onError: (e) =>
        toast({
          title: "Could not close the request",
          description: e.message,
          variant: "destructive",
        }),
    });
  const slashYoutubeRewardsMutation =
    trpc.campaigns.slashYoutubeHeavyRewards.useMutation();

  // Populate campaign form with existing data
  useEffect(() => {
    if (campaignInfo?.campaign) {
      const campaign = campaignInfo.campaign;
      const visibleCountries = Array.isArray(
        campaign.demographicsVisibleCountries
      )
        ? campaign.demographicsVisibleCountries.filter(
            (country): country is CountryOption =>
              countryOptions.includes(country as CountryOption)
          )
        : [];
      setCampaignForm({
        title: campaign.title || "",
        budget: (campaign.budget || 0).toString(),
        external_budget: (campaign.external_budget ?? 0).toString(),
        cpm: (campaign.cpm ?? 0).toString(),
        max_payout: (campaign.max_payout || 0).toString(),
        min_payout: (campaign.min_payout || 0).toString(),
        demographics_min_views: (campaign.demographics_min_views ?? 0).toString(),
        insta_per_1000: (campaign.insta_per_1000 || 0).toString(),
        x_per_1000: (campaign.x_per_1000 || 0).toString(),
        youtube_per_1000: (campaign.youtube_per_1000 || 0).toString(),
        tiktok_per_1000: (campaign.tiktok_per_1000 || 0).toString(),
        youtube_min_views: (campaign.youtube_min_views ?? 1500).toString(),
        insta_min_views: (campaign.insta_min_views ?? 1500).toString(),
        x_min_views: (campaign.x_min_views ?? 1500).toString(),
        tiktok_min_views: (campaign.tiktok_min_views ?? 0).toString(),
        imageUrl: campaign.imageUrl || "",
        sopEmbedUrl: campaign.sopEmbedUrl || "",
        description: campaign.description || "",
        active: campaign.active ?? true,
        ended: campaign.ended ?? false,
        submissionsPaused: Boolean(
          (campaign as { submissions_paused?: boolean | null })
            .submissions_paused
        ),
        demographicsVerificationEnabled:
          campaign.demographicsVerificationEnabled ?? false,
        demographicsVisibleCountries: visibleCountries,
        demographicsRecordingPeriod:
          campaign.demographics_recording_period_days != null
            ? String(campaign.demographics_recording_period_days)
            : "",
        is_hot_streak_enabled: campaign.is_hot_streak_enabled ?? false,
        clipperActivityEnabled: campaign.clipper_activity_enabled ?? true,
        requireNonCampaignClips:
          (campaign.non_campaign_clips_required ?? 0) > 0,
        nonCampaignClipsCount: String(
          campaign.non_campaign_clips_required ?? 1
        ),
        nonCampaignClipsPer: String(
          (campaign as { non_campaign_clips_per?: number | null })
            .non_campaign_clips_per ?? 1
        ),
        endDate: (campaign as { end_date?: string | Date | null }).end_date
          ? new Date(
              (campaign as { end_date?: string | Date | null })
                .end_date as string | Date
            )
              .toISOString()
              .slice(0, 10)
          : "",
        isPrivate: campaign.visibility === "private",
        privateShowBudget: campaign.private_show_budget ?? false,
        privateShowRates: campaign.private_show_rates ?? false,
        privateShowMinViews: campaign.private_show_min_views ?? false,
        privateShowDescription: campaign.private_show_description ?? true,
        privateTeaserTitle: campaign.private_teaser_title ?? "",
        privateTeaserImageUrl: campaign.private_teaser_image_url ?? "",
        privateTeaserDescription: campaign.private_teaser_description ?? "",
        paymentMethods: (campaign.payment_methods ?? []).filter(
          (m): m is string => typeof m === "string"
        ),
        privateDiscordGuildId: campaign.private_discord_guild_id ?? "",
        // Parse the comma-separated platforms string into a typed array.
        // Defensive: lowercase + trim + filter to the 4 supported values so
        // legacy odd entries (typos, spaces, ig/yt aliases) don't break the UI.
        platforms: (campaign.platforms ?? "")
          .split(",")
          .map((p) => p.trim().toLowerCase())
          .map((p) =>
            p === "ig" ? "instagram" : p === "yt" ? "youtube" : p === "twitter" ? "x" : p === "tt" ? "tiktok" : p
          )
          .filter((p): p is "youtube" | "instagram" | "tiktok" | "x" =>
            p === "youtube" || p === "instagram" || p === "tiktok" || p === "x"
          ),
      });
      setHasExternalPassword(Boolean(campaign.external_password));
      setExternalPasswordInput("");
      setRemoveExternalPassword(false);
      setIsLoadingData(false);
    }
  }, [campaignInfo]);

  // useEffect(() => {
  //   if (demographicsFilterDisabled && countryPopoverOpen) {
  //     setCountryPopoverOpen(false);
  //   }
  // }, [demographicsFilterDisabled, countryPopoverOpen]);

  const handleCopyLink = async () => {
    const campaignUrl = `${window.location.origin}/campaign/${campaignId}`;
    try {
      await navigator.clipboard.writeText(campaignUrl);
      setCopied(true);
      toast({
        title: "Success",
        description: "Campaign link copied to clipboard",
      });
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to copy link to clipboard",
        variant: "destructive",
      });
    }
  };

  const normalizeDescription = (html: string) => {
    if (!html) return "";
    const textContent = html
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    return textContent ? html : "";
  };

  const handleCountryToggle = (country: CountryOption) => {
    setCampaignForm((prev) => {
      const selected = prev.demographicsVisibleCountries;
      const exists = selected.includes(country);
      const updated = exists
        ? selected.filter((value) => value !== country)
        : [...selected, country];

      return {
        ...prev,
        demographicsVisibleCountries: updated,
      };
    });
  };

  const handleClearCountries = () => {
    setCampaignForm((prev) => ({
      ...prev,
      demographicsVisibleCountries: [],
    }));
  };

  const handleSave = async () => {
    if (!campaignId) {
      toast({
        title: "Error",
        description: "Campaign ID is missing",
        variant: "destructive",
      });
      return;
    }

    if (!campaignForm.title.trim()) {
      toast({
        title: "Error",
        description: "Campaign title is required",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    try {
      // Update campaign via tRPC
      const payload: Parameters<typeof updateCampaignMutation.mutateAsync>[0] =
        {
          id: campaignId,
          title: campaignForm.title,
          budget: parseFloat(campaignForm.budget) || 0,
          external_budget: parseFloat(campaignForm.external_budget) || 0,
          cpm: parseFloat(campaignForm.cpm) || 0,
          max_payout: parseFloat(campaignForm.max_payout) || 0,
          min_payout: parseFloat(campaignForm.min_payout) || 0,
          demographics_min_views:
            parseInt(campaignForm.demographics_min_views, 10) || 0,
          insta_per_1000: parseFloat(campaignForm.insta_per_1000) || 0,
          x_per_1000: parseFloat(campaignForm.x_per_1000) || 0,
          youtube_per_1000: parseFloat(campaignForm.youtube_per_1000) || 0,
          tiktok_per_1000: parseFloat(campaignForm.tiktok_per_1000) || 0,
          youtube_min_views: parseFloorInput(
            campaignForm.youtube_min_views,
            1500
          ),
          insta_min_views: parseFloorInput(campaignForm.insta_min_views, 1500),
          x_min_views: parseFloorInput(campaignForm.x_min_views, 1500),
          tiktok_min_views: parseFloorInput(campaignForm.tiktok_min_views, 0),
          imageUrl: campaignForm.imageUrl.trim() || undefined,
          sopEmbedUrl: campaignForm.sopEmbedUrl.trim() || undefined,
          description:
            normalizeDescription(campaignForm.description || "") || undefined,
          active: campaignForm.active,
          ended: campaignForm.ended,
          submissionsPaused: campaignForm.submissionsPaused,
          demographicsVerificationEnabled:
            campaignForm.demographicsVerificationEnabled,
          demographicsVisibleCountries:
            campaignForm.demographicsVisibleCountries,
          demographics_recording_period_days:
            campaignForm.demographicsRecordingPeriod
              ? (Number(campaignForm.demographicsRecordingPeriod) as
                  | 7
                  | 28
                  | 90)
              : null,
          is_hot_streak_enabled: campaignForm.is_hot_streak_enabled,
          clipperActivityEnabled: campaignForm.clipperActivityEnabled,
          nonCampaignClipsRequired: campaignForm.requireNonCampaignClips
            ? Math.max(
                1,
                Math.min(
                  10,
                  parseInt(campaignForm.nonCampaignClipsCount, 10) || 1
                )
              )
            : null,
          nonCampaignClipsPer: campaignForm.requireNonCampaignClips
            ? Math.max(
                1,
                Math.min(10, parseInt(campaignForm.nonCampaignClipsPer, 10) || 1)
              )
            : 1,
          // Feature 4: campaign end date (drives the 3-month deletion watch).
          endDate: campaignForm.endDate ? campaignForm.endDate : null,
          // Comma-separated list of allowed platforms — controls both the
          // icons rendered on the home page card AND which platforms clippers
          // can submit from. Empty string means "no platforms set" (the card
          // will show the 'Platforms coming soon' fallback).
          platforms: campaignForm.platforms.join(","),
          visibility: campaignForm.isPrivate ? "private" : "public",
          privateShowBudget: campaignForm.privateShowBudget,
          privateShowRates: campaignForm.privateShowRates,
          privateShowMinViews: campaignForm.privateShowMinViews,
          privateShowDescription: campaignForm.privateShowDescription,
          privateTeaserTitle: campaignForm.privateTeaserTitle.trim() || null,
          privateTeaserImageUrl:
            campaignForm.privateTeaserImageUrl.trim() || null,
          privateTeaserDescription:
            campaignForm.privateTeaserDescription.trim() || null,
          payment_methods: campaignForm.paymentMethods.filter(
            (m): m is "bank" | "crypto" | "paypal" =>
              m === "bank" || m === "crypto" || m === "paypal"
          ),
          privateDiscordGuildId:
            campaignForm.privateDiscordGuildId.trim() || null,
        };

      if (removeExternalPassword) {
        payload.externalPassword = "";
      } else if (externalPasswordInput.trim()) {
        payload.externalPassword = externalPasswordInput.trim();
      }

      await updateCampaignMutation.mutateAsync(payload);

      toast({
        title: "Success",
        description: "Campaign updated successfully",
      });

      if (removeExternalPassword) {
        setHasExternalPassword(false);
      } else if (externalPasswordInput.trim()) {
        setHasExternalPassword(true);
      }
      setExternalPasswordInput("");
      setRemoveExternalPassword(false);

      navigate(`/campaign/${campaignId}`);
    } catch (error) {
      console.error("Error updating campaign:", error);
      toast({
        title: "Error",
        description:
          error instanceof Error ? error.message : "Failed to update campaign",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleBulkActivateClaims = async () => {
    if (!campaignId) {
      toast({
        title: "Error",
        description: "Campaign ID is missing",
        variant: "destructive",
      });
      return;
    }

    if (!bulkActivateSince) {
      toast({
        title: "Error",
        description: "Please select a starting date",
        variant: "destructive",
      });
      return;
    }

    const sinceDate = new Date(bulkActivateSince);

    if (Number.isNaN(sinceDate.getTime())) {
      toast({
        title: "Error",
        description: "Invalid date provided",
        variant: "destructive",
      });
      return;
    }

    try {
      const result = await bulkActivateClaimsMutation.mutateAsync({
        campaignId,
        updatedSince: sinceDate,
      });

      toast({
        title: "Demographics reset",
        description:
          result.updatedCount > 0
            ? `${result.updatedCount} verification(s) were reset and activated.`
            : "No verifications matched the criteria.",
      });
    } catch (error) {
      console.error("Error bulk activating claims:", error);
      toast({
        title: "Error",
        description:
          error instanceof Error
            ? error.message
            : "Failed to activate demographics claims",
        variant: "destructive",
      });
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const handleSlashYoutubePayouts = async () => {
    if (!campaignId) {
      toast({
        title: "Error",
        description: "Campaign ID is missing",
        variant: "destructive",
      });
      return;
    }

    const confirmed = confirm(
      "Slash payouts for YouTube-heavy creators? This will create negative manual adjustments."
    );

    if (!confirmed) {
      return;
    }

    try {
      const result = await slashYoutubeRewardsMutation.mutateAsync({
        campaignId,
      });

      const currencyFormatter = new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
      });

      if (result.affectedUsers > 0) {
        toast({
          title: "Payouts slashed",
          description: `${result.affectedUsers} creator(s) adjusted for a total of ${currencyFormatter.format(result.totalSlashed)}.`,
        });
      } else {
        toast({
          title: "No payouts matched",
          description: "No rewards met the YouTube-heavy criteria.",
        });
      }
    } catch (error) {
      console.error("Error slashing payouts:", error);
      toast({
        title: "Error",
        description:
          error instanceof Error
            ? error.message
            : "Failed to slash payouts",
        variant: "destructive",
      });
    }
  };

  const hasSelectedVisibleCountries =
    campaignForm.demographicsVisibleCountries.length > 0;
  const demographicsFilterDisabled =
    isLoading || isLoadingData || !campaignForm.demographicsVerificationEnabled;

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto px-6 py-6">
        <div className="text-left mb-6">
          {campaignLoading ? (
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-muted-foreground">Loading campaign...</span>
            </div>
          ) : (
            <>
              <h2 className="text-xl font-semibold text-foreground">
                Edit Campaign:{" "}
                {campaignInfo?.campaign?.title || "Unknown Campaign"}
              </h2>
              <p className="text-sm text-muted-foreground">
                Created{" "}
                {campaignInfo?.campaign?.created_at
                  ? formatDate(campaignInfo.campaign.created_at.toISOString())
                  : "Unknown date"}
              </p>
            </>
          )}
        </div>

        <div className="max-w-5xl space-y-6">
          {/* Campaign Basic Information */}
          <Card>
            <CardHeader>
              <CardTitle>Campaign Information</CardTitle>
            </CardHeader>
            {isLoadingData ? (
              <CardContent>
                <div className="flex items-center gap-2 py-8">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-muted-foreground">
                    Loading campaign...
                  </span>
                </div>
              </CardContent>
            ) : (
              <CardContent className="space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="title">Campaign Title *</Label>
                  <Input
                    id="title"
                    placeholder="Enter campaign title"
                    value={campaignForm.title}
                    onChange={(e) =>
                      setCampaignForm({
                        ...campaignForm,
                        title: e.target.value,
                      })
                    }
                    disabled={isLoading || isLoadingData}
                  />
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="budget">Budget ($)</Label>
                    <Input
                      id="budget"
                      type="number"
                      step="1"
                      min="0"
                      placeholder="0"
                      value={campaignForm.budget}
                      onChange={(e) =>
                        setCampaignForm({
                          ...campaignForm,
                          budget: e.target.value,
                        })
                      }
                      disabled={isLoading || isLoadingData}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="external_budget">External Budget ($)</Label>
                    <Input
                      id="external_budget"
                      type="number"
                      step="1"
                      min="0"
                      placeholder="0"
                      value={campaignForm.external_budget}
                      onChange={(e) =>
                        setCampaignForm({
                          ...campaignForm,
                          external_budget: e.target.value,
                        })
                      }
                      disabled={isLoading || isLoadingData}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="endDate">Campaign end date</Label>
                    <Input
                      id="endDate"
                      type="date"
                      value={campaignForm.endDate}
                      onChange={(e) =>
                        setCampaignForm({
                          ...campaignForm,
                          endDate: e.target.value,
                        })
                      }
                      disabled={isLoading || isLoadingData}
                    />
                    <p className="text-xs text-muted-foreground">
                      After this date, reels must stay live for 3 months — the
                      system watches them for deletion during that window.
                    </p>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="externalPassword">
                    External dashboard password
                  </Label>
                  <div className="relative">
                    <Input
                      id="externalPassword"
                      type={showExternalPassword ? "text" : "password"}
                      placeholder={
                        hasExternalPassword
                          ? "Enter a new password to replace the existing one"
                          : "Leave blank to keep the dashboard private"
                      }
                      value={externalPasswordInput}
                      onChange={(e) => {
                        setExternalPasswordInput(e.target.value);
                        if (removeExternalPassword) {
                          setRemoveExternalPassword(false);
                        }
                      }}
                      disabled={
                        isLoading || isLoadingData || removeExternalPassword
                      }
                    />
                    <button
                      type="button"
                      className="absolute inset-y-0 right-3 flex items-center text-muted-foreground"
                      onClick={() => setShowExternalPassword((prev) => !prev)}
                      disabled={isLoading || isLoadingData}
                      aria-label={
                        showExternalPassword
                          ? "Hide dashboard password"
                          : "Show dashboard password"
                      }
                    >
                      {showExternalPassword ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {removeExternalPassword
                      ? "The dashboard password will be removed when you save."
                      : hasExternalPassword
                        ? "A password is currently set. Enter a new one to replace it or remove it below."
                        : "No password is set. Set one to restrict access to the dashboard."}
                  </p>
                  {hasExternalPassword && (
                    <Button
                      type="button"
                      variant={
                        removeExternalPassword ? "destructive" : "outline"
                      }
                      size="sm"
                      onClick={() => {
                        setRemoveExternalPassword(!removeExternalPassword);
                        setExternalPasswordInput("");
                      }}
                      disabled={isLoading || isLoadingData}
                    >
                      {removeExternalPassword
                        ? "Undo password removal"
                        : "Remove password"}
                    </Button>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="cpm">External CPM ($)</Label>
                    <Input
                      id="cpm"
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="0"
                      value={campaignForm.cpm}
                      onChange={(e) =>
                        setCampaignForm({
                          ...campaignForm,
                          cpm: e.target.value,
                        })
                      }
                      disabled={isLoading || isLoadingData}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="max_payout">Max Payout (% of bounty)</Label>
                    <Input
                      id="max_payout"
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="0"
                      value={campaignForm.max_payout}
                      onChange={(e) =>
                        setCampaignForm({
                          ...campaignForm,
                          max_payout: e.target.value,
                        })
                      }
                      disabled={isLoading || isLoadingData}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="min_payout">
                      Min views to start earning (TOTAL across the campaign)
                    </Label>
                    <Input
                      id="min_payout"
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="0"
                      value={campaignForm.min_payout}
                      onChange={(e) =>
                        setCampaignForm({
                          ...campaignForm,
                          min_payout: e.target.value,
                        })
                      }
                      disabled={isLoading || isLoadingData}
                    />
                    <p className="text-xs text-muted-foreground">
                      A clipper's combined views across ALL their clips in this
                      campaign must pass this number before they earn anything.
                      This is NOT a per-clip requirement — for that, use the
                      per-clip minimums below.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="demographics_min_views">
                      Min views to submit demographics (TOTAL across the
                      campaign) — optional override
                    </Label>
                    <Input
                      id="demographics_min_views"
                      type="number"
                      step="1"
                      min="0"
                      placeholder="0"
                      value={campaignForm.demographics_min_views}
                      onChange={(e) =>
                        setCampaignForm({
                          ...campaignForm,
                          demographics_min_views: e.target.value,
                        })
                      }
                      disabled={isLoading || isLoadingData}
                    />
                    <p className="text-xs text-muted-foreground">
                      A clipper is only asked for — and only allowed to submit —
                      demographics on this campaign once their combined views
                      across every account they ran here reach this number. They
                      then report on each of those accounts separately, as
                      usual. Leave it at 0 and it follows the earning threshold
                      above automatically — so a clipper is asked for
                      demographics at exactly the point they start earning, and
                      never before. Only set a number here if you deliberately
                      want verification to kick in somewhere else.
                    </p>
                  </div>
                </div>

                <div className="space-y-4">
                  <h3 className="text-lg font-medium">
                    Per-clip minimum views
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    A clip below this many views counts as 0 views and earns
                    nothing until it crosses the minimum (it stays live — it
                    just doesn't pay yet). Applies per clip, per platform, in
                    this campaign only. Type 0 to turn the minimum off; leave
                    a box blank to use the default (1500 for YouTube,
                    Instagram and X; 0 for TikTok).
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="youtube_min_views">YouTube</Label>
                      <Input
                        id="youtube_min_views"
                        type="number"
                        step="1"
                        min="0"
                        placeholder="1500"
                        value={campaignForm.youtube_min_views}
                        onChange={(e) =>
                          setCampaignForm({
                            ...campaignForm,
                            youtube_min_views: e.target.value,
                          })
                        }
                        disabled={isLoading || isLoadingData}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="insta_min_views">Instagram</Label>
                      <Input
                        id="insta_min_views"
                        type="number"
                        step="1"
                        min="0"
                        placeholder="1500"
                        value={campaignForm.insta_min_views}
                        onChange={(e) =>
                          setCampaignForm({
                            ...campaignForm,
                            insta_min_views: e.target.value,
                          })
                        }
                        disabled={isLoading || isLoadingData}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="x_min_views">X</Label>
                      <Input
                        id="x_min_views"
                        type="number"
                        step="1"
                        min="0"
                        placeholder="1500"
                        value={campaignForm.x_min_views}
                        onChange={(e) =>
                          setCampaignForm({
                            ...campaignForm,
                            x_min_views: e.target.value,
                          })
                        }
                        disabled={isLoading || isLoadingData}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="tiktok_min_views">TikTok</Label>
                      <Input
                        id="tiktok_min_views"
                        type="number"
                        step="1"
                        min="0"
                        placeholder="0"
                        value={campaignForm.tiktok_min_views}
                        onChange={(e) =>
                          setCampaignForm({
                            ...campaignForm,
                            tiktok_min_views: e.target.value,
                          })
                        }
                        disabled={isLoading || isLoadingData}
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <h3 className="text-lg font-medium">Payment methods</h3>
                  <p className="text-sm text-muted-foreground">
                    Checked options show in the campaign card's "Payment"
                    tile. Display only — this doesn't change how payouts
                    actually run. Leave all unchecked to keep the default
                    ("Bank — Direct transfer").
                  </p>
                  <div className="flex flex-wrap gap-6">
                    {(
                      [
                        { value: "bank", label: "Bank transfer" },
                        { value: "crypto", label: "Crypto" },
                        { value: "paypal", label: "PayPal" },
                      ] as const
                    ).map((method) => (
                      <label
                        key={method.value}
                        htmlFor={`payment_${method.value}`}
                        className="flex items-center gap-2 text-sm font-medium"
                      >
                        <Checkbox
                          id={`payment_${method.value}`}
                          checked={campaignForm.paymentMethods.includes(
                            method.value
                          )}
                          onCheckedChange={(checked) =>
                            setCampaignForm({
                              ...campaignForm,
                              paymentMethods: checked
                                ? [
                                    ...campaignForm.paymentMethods,
                                    method.value,
                                  ]
                                : campaignForm.paymentMethods.filter(
                                    (m) => m !== method.value
                                  ),
                            })
                          }
                          disabled={isLoading || isLoadingData}
                        />
                        {method.label}
                      </label>
                    ))}
                  </div>
                </div>

                <div className="space-y-4">
                  <h3 className="text-lg font-medium">Campaign Details</h3>
                  <div className="space-y-2">
                    <Label htmlFor="imageUrl">Image URL</Label>
                    <Input
                      id="imageUrl"
                      type="url"
                      placeholder="https://example.com/preview.jpg"
                      value={campaignForm.imageUrl}
                      onChange={(e) =>
                        setCampaignForm({
                          ...campaignForm,
                          imageUrl: e.target.value,
                        })
                      }
                      disabled={isLoading || isLoadingData}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="sopEmbedUrl">SOP Embed URL</Label>
                    <Input
                      id="sopEmbedUrl"
                      type="url"
                      placeholder="https://example.com/embed"
                      value={campaignForm.sopEmbedUrl}
                      onChange={(e) =>
                        setCampaignForm({
                          ...campaignForm,
                          sopEmbedUrl: e.target.value,
                        })
                      }
                      disabled={isLoading || isLoadingData}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="description">Description</Label>
                    <RichTextEditor
                      id="description"
                      value={campaignForm.description}
                      onChange={(value) =>
                        setCampaignForm({
                          ...campaignForm,
                          description: value,
                        })
                      }
                      placeholder="Add context or instructions for creators"
                      className="min-h-[200px]"
                      disabled={isLoading || isLoadingData}
                    />
                  </div>
                </div>

                <div className="space-y-4">
                  <h3 className="text-lg font-medium">Audience Demographics</h3>
                  <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
                    <div className="space-y-1">
                      <Label htmlFor="demographicsVerificationEnabled">
                        Show audience demographics
                      </Label>
                      <p className="text-sm text-muted-foreground">
                        Toggle to display verified audience demographics on the
                        campaign dashboard when available.
                      </p>
                    </div>
                    <Switch
                      id="demographicsVerificationEnabled"
                      checked={campaignForm.demographicsVerificationEnabled}
                      onCheckedChange={(checked) =>
                        setCampaignForm({
                          ...campaignForm,
                          demographicsVerificationEnabled: checked,
                        })
                      }
                      disabled={isLoading || isLoadingData}
                    />
                  </div>
                  <div className="space-y-2 rounded-lg border p-4">
                    <Label>Screen-recording window</Label>
                    <p className="text-sm text-muted-foreground">
                      The analytics window a clipper must show when verifying
                      demographics for this campaign. 7 / 28 / 90 days are the
                      buckets every platform actually offers.{" "}
                      <span className="font-medium text-foreground">None</span>{" "}
                      = no specific window (API pulls the campaign lifetime).
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {[
                        { value: "", label: "None" },
                        { value: "7", label: "7 days" },
                        { value: "28", label: "28 days" },
                        { value: "90", label: "90 days" },
                      ].map((opt) => (
                        <Button
                          key={opt.value || "none"}
                          type="button"
                          size="sm"
                          variant={
                            campaignForm.demographicsRecordingPeriod ===
                            opt.value
                              ? "default"
                              : "outline"
                          }
                          onClick={() =>
                            setCampaignForm({
                              ...campaignForm,
                              demographicsRecordingPeriod: opt.value,
                            })
                          }
                          disabled={isLoading || isLoadingData}
                        >
                          {opt.label}
                        </Button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="demographicsVisibleCountries">
                        Visible countries
                      </Label>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={handleClearCountries}
                        disabled={!hasSelectedVisibleCountries}
                      >
                        Clear selection
                      </Button>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Choose which reported countries should appear on the
                      dashboard. Leave empty to show every country that we
                      receive from the demographics feed.
                    </p>
                    <div className="space-y-3">
                      <Popover
                        open={countryPopoverOpen}
                        onOpenChange={(open) => {
                          setCountryPopoverOpen(open);
                        }}
                      >
                        <PopoverTrigger asChild>
                          <Button
                            type="button"
                            id="demographicsVisibleCountries"
                            variant="outline"
                            size="sm"
                            className="w-full justify-between"
                          >
                            {hasSelectedVisibleCountries
                              ? `${
                                  campaignForm.demographicsVisibleCountries
                                    .length
                                } ${
                                  campaignForm.demographicsVisibleCountries
                                    .length === 1
                                    ? "country"
                                    : "countries"
                                } selected`
                              : "All countries visible"}
                            <ChevronsUpDown className="ml-2 h-4 w-4 opacity-50" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-[calc(100vw-2rem)] max-w-[320px] p-0" align="start">
                          <Command>
                            <CommandInput placeholder="Search countries..." />
                            <CommandList className="max-h-64 overflow-y-auto">
                              <CommandEmpty>No countries found.</CommandEmpty>
                              <CommandGroup>
                                {countryOptions.map((country) => {
                                  const isSelected =
                                    campaignForm.demographicsVisibleCountries.includes(
                                      country
                                    );
                                  return (
                                    <CommandItem
                                      key={country}
                                      onSelect={() =>
                                        handleCountryToggle(country)
                                      }
                                    >
                                      <Check
                                        className={`mr-2 h-4 w-4 ${
                                          isSelected
                                            ? "opacity-100"
                                            : "opacity-0"
                                        }`}
                                      />
                                      {country}
                                    </CommandItem>
                                  );
                                })}
                              </CommandGroup>
                            </CommandList>
                          </Command>
                        </PopoverContent>
                      </Popover>
                      {hasSelectedVisibleCountries ? (
                        <div className="flex flex-wrap gap-2">
                          {campaignForm.demographicsVisibleCountries.map(
                            (country) => (
                              <Badge
                                key={country}
                                variant="secondary"
                                className="flex items-center gap-1"
                              >
                                {country}
                                <button
                                  type="button"
                                  onClick={() => handleCountryToggle(country)}
                                  className="rounded-full p-0.5 text-muted-foreground transition hover:text-foreground disabled:opacity-50"
                                  aria-label={`Remove ${country}`}
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </Badge>
                            )
                          )}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          Every country that appears in the demographics feed
                          will be shown on the dashboard.
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                {/* ── Non-campaign clips section ──
                     Opt-in per campaign: when enabled, every campaign-clip
                     submission must include N non-campaign clip URLs from
                     the clipper's same account. Each URL is globally unique
                     across the non_campaign_clips table (DB-level + app
                     pre-check), so no clipper can ever reuse a link.
                     Mods see both the campaign URL and the non-campaign
                     URLs side-by-side during review and verify niche/account
                     match manually. */}
                <div className="space-y-4">
                  <h3 className="text-lg font-medium">Non-Campaign Clips</h3>
                  <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
                    <div className="space-y-1">
                      <Label htmlFor="requireNonCampaignClips">
                        Require non-campaign clips per submission
                      </Label>
                      <p className="text-sm text-muted-foreground">
                        When enabled, clippers must submit additional clip
                        URLs from the same account alongside every campaign
                        clip. Each non-campaign URL can only ever be used
                        once across all clippers — moderators verify
                        same-account / same-niche during review.
                      </p>
                    </div>
                    <Switch
                      id="requireNonCampaignClips"
                      checked={campaignForm.requireNonCampaignClips}
                      onCheckedChange={(checked) =>
                        setCampaignForm({
                          ...campaignForm,
                          requireNonCampaignClips: checked,
                        })
                      }
                      disabled={isLoading || isLoadingData}
                    />
                  </div>
                  {campaignForm.requireNonCampaignClips ? (
                    <div className="space-y-2">
                      <Label htmlFor="nonCampaignClipsCount">
                        Non-campaign clip ratio
                      </Label>
                      <div className="flex flex-wrap items-center gap-2">
                        <Input
                          id="nonCampaignClipsCount"
                          type="number"
                          min="1"
                          max="10"
                          step="1"
                          value={campaignForm.nonCampaignClipsCount}
                          onChange={(e) =>
                            setCampaignForm({
                              ...campaignForm,
                              nonCampaignClipsCount: e.target.value,
                            })
                          }
                          disabled={isLoading || isLoadingData}
                          className="w-20"
                        />
                        <span className="text-sm text-muted-foreground">
                          non-campaign clip(s) for every
                        </span>
                        <Input
                          id="nonCampaignClipsPer"
                          type="number"
                          min="1"
                          max="10"
                          step="1"
                          value={campaignForm.nonCampaignClipsPer}
                          onChange={(e) =>
                            setCampaignForm({
                              ...campaignForm,
                              nonCampaignClipsPer: e.target.value,
                            })
                          }
                          disabled={isLoading || isLoadingData}
                          className="w-20"
                        />
                        <span className="text-sm text-muted-foreground">
                          campaign clip(s)
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        e.g. <strong>1 for every 3</strong> = post one
                        non-campaign reel per three campaign reels, submitted
                        together. Each number 1–10. Set the second to 1 for the
                        classic "N per single clip" behavior.
                      </p>
                    </div>
                  ) : null}
                </div>

                {/* Allowed platforms — drives BOTH the icons shown on the
                     home page card AND the platforms a clipper is allowed
                     to submit from. Stored as a comma-separated string on
                     campaigns.platforms. */}
                <div className="space-y-4">
                  <h3 className="text-lg font-medium">Allowed Platforms</h3>
                  <p className="text-sm text-muted-foreground">
                    Tick every platform clippers can post on for this campaign.
                    These also become the icons shown on the home page card.
                  </p>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {(
                      [
                        { value: "youtube", label: "YouTube" },
                        { value: "instagram", label: "Instagram" },
                        { value: "tiktok", label: "TikTok" },
                        { value: "x", label: "X" },
                      ] as const
                    ).map((opt) => {
                      const checked = campaignForm.platforms.includes(opt.value);
                      return (
                        <label
                          key={opt.value}
                          className="flex cursor-pointer items-center gap-2 rounded-lg border bg-muted/30 p-3 text-sm"
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(v) => {
                              setCampaignForm((prev) => {
                                const next = new Set(prev.platforms);
                                if (v) next.add(opt.value);
                                else next.delete(opt.value);
                                return {
                                  ...prev,
                                  platforms: Array.from(next),
                                };
                              });
                            }}
                            disabled={isLoading || isLoadingData}
                          />
                          <span>{opt.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-4">
                  <h3 className="text-lg font-medium">Platform CPM Rates</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="insta_per_1000">
                        Instagram (per 1000)
                      </Label>
                      <Input
                        id="insta_per_1000"
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0"
                        value={campaignForm.insta_per_1000}
                        onChange={(e) =>
                          setCampaignForm({
                            ...campaignForm,
                            insta_per_1000: e.target.value,
                          })
                        }
                        disabled={isLoading || isLoadingData}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="youtube_per_1000">
                        YouTube (per 1000)
                      </Label>
                      <Input
                        id="youtube_per_1000"
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0"
                        value={campaignForm.youtube_per_1000}
                        onChange={(e) =>
                          setCampaignForm({
                            ...campaignForm,
                            youtube_per_1000: e.target.value,
                          })
                        }
                        disabled={isLoading || isLoadingData}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="x_per_1000">X/Twitter (per 1000)</Label>
                      <Input
                        id="x_per_1000"
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0"
                        value={campaignForm.x_per_1000}
                        onChange={(e) =>
                          setCampaignForm({
                            ...campaignForm,
                            x_per_1000: e.target.value,
                          })
                        }
                        disabled={isLoading || isLoadingData}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="tiktok_per_1000">TikTok (per 1000)</Label>
                      <Input
                        id="tiktok_per_1000"
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0"
                        value={campaignForm.tiktok_per_1000}
                        onChange={(e) =>
                          setCampaignForm({
                            ...campaignForm,
                            tiktok_per_1000: e.target.value,
                          })
                        }
                        disabled={isLoading || isLoadingData}
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <h3 className="text-lg font-medium">Campaign Toggles</h3>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="active">
                      Active
                      <p className="text-xs text-muted-foreground">
                        Toggle to activate the campaign view counts.{" "}
                      </p>
                    </Label>
                    <Switch
                      id="active"
                      checked={campaignForm.active}
                      onCheckedChange={(checked) =>
                        setCampaignForm({
                          ...campaignForm,
                          active: checked,
                          // ended: checked ? false : campaignForm.ended,
                        })
                      }
                      disabled={isLoading || isLoadingData}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="ended">
                      Ended
                      <p className="text-xs text-muted-foreground">
                        Toggle to end the campaign and remove from
                        discoverability
                      </p>
                    </Label>
                    <Switch
                      id="ended"
                      checked={campaignForm.ended}
                      onCheckedChange={(checked) =>
                        setCampaignForm({
                          ...campaignForm,
                          ended: checked,
                          // active: checked ? false : campaignForm.active,
                        })
                      }
                      disabled={isLoading || isLoadingData}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="acceptingSubmissions">
                      Accepting submissions
                      <p className="text-xs text-muted-foreground">
                        Turn off to stop new clip submissions for this
                        campaign. Existing clips keep counting views and
                        earning — only new submissions are blocked.
                      </p>
                    </Label>
                    <Switch
                      id="acceptingSubmissions"
                      checked={!campaignForm.submissionsPaused}
                      onCheckedChange={(checked) =>
                        setCampaignForm({
                          ...campaignForm,
                          submissionsPaused: !checked,
                        })
                      }
                      disabled={isLoading || isLoadingData}
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between">
                      <Label htmlFor="is_hot_streak_enabled">
                        Hot streaks enabled
                      </Label>
                      <Switch
                        id="is_hot_streak_enabled"
                        checked={campaignForm.is_hot_streak_enabled}
                        onCheckedChange={(checked) =>
                          setCampaignForm({
                            ...campaignForm,
                            is_hot_streak_enabled: checked,
                          })
                        }
                        disabled={isLoading || isLoadingData}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Reward the daily top view earners with extra CPM boosts
                      through Hot Streaks.
                    </p>
                  </div>
                  <div>
                    <div className="flex items-center justify-between">
                      <Label htmlFor="clipperActivityEnabled">
                        Weekly clipper activity
                      </Label>
                      <Switch
                        id="clipperActivityEnabled"
                        checked={campaignForm.clipperActivityEnabled}
                        onCheckedChange={(checked) =>
                          setCampaignForm({
                            ...campaignForm,
                            clipperActivityEnabled: checked,
                          })
                        }
                        disabled={isLoading || isLoadingData}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Track weekly activity in the Clipper Activity panel and
                      allow inactivity suspensions. Turn off for campaigns
                      where clippers don't need to stay active every week —
                      the campaign disappears from the panel and existing
                      suspensions stop blocking submissions.
                    </p>
                  </div>
                </div>

                <div className="space-y-4">
                  <h3 className="text-lg font-medium">Private Campaign</h3>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="isPrivate">
                      Private campaign
                      <p className="text-xs text-muted-foreground">
                        Clippers must apply with their accounts and be approved
                        by a mod before they can submit clips.
                      </p>
                    </Label>
                    <Switch
                      id="isPrivate"
                      checked={campaignForm.isPrivate}
                      onCheckedChange={(checked) =>
                        setCampaignForm({ ...campaignForm, isPrivate: checked })
                      }
                      disabled={isLoading || isLoadingData}
                    />
                  </div>
                  {campaignForm.isPrivate && (
                    <>
                      <div className="flex items-center justify-between">
                        <Label htmlFor="privateShowBudget">
                          Show budget before approval
                          <p className="text-xs text-muted-foreground">
                            Reveal the bounty on the card to clippers who
                            aren't approved yet.
                          </p>
                        </Label>
                        <Switch
                          id="privateShowBudget"
                          checked={campaignForm.privateShowBudget}
                          onCheckedChange={(checked) =>
                            setCampaignForm({
                              ...campaignForm,
                              privateShowBudget: checked,
                            })
                          }
                          disabled={isLoading || isLoadingData}
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <Label htmlFor="privateShowRates">
                          Show payout rates before approval
                          <p className="text-xs text-muted-foreground">
                            Reveal CPM rates and levels to unapproved
                            clippers. (Minimum views has its own toggle
                            below.)
                          </p>
                        </Label>
                        <Switch
                          id="privateShowRates"
                          checked={campaignForm.privateShowRates}
                          onCheckedChange={(checked) =>
                            setCampaignForm({
                              ...campaignForm,
                              privateShowRates: checked,
                            })
                          }
                          disabled={isLoading || isLoadingData}
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <Label htmlFor="privateShowMinViews">
                          Show minimum views before approval
                          <p className="text-xs text-muted-foreground">
                            Reveal the view requirements (per-clip minimums +
                            total needed for payout) even while rates stay
                            hidden. Has no effect when rates are shown.
                          </p>
                        </Label>
                        <Switch
                          id="privateShowMinViews"
                          checked={campaignForm.privateShowMinViews}
                          onCheckedChange={(checked) =>
                            setCampaignForm({
                              ...campaignForm,
                              privateShowMinViews: checked,
                            })
                          }
                          disabled={isLoading || isLoadingData}
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <Label htmlFor="privateShowDescription">
                          Show description before approval
                          <p className="text-xs text-muted-foreground">
                            Reveal the campaign details/SOP to unapproved
                            clippers.
                          </p>
                        </Label>
                        <Switch
                          id="privateShowDescription"
                          checked={campaignForm.privateShowDescription}
                          onCheckedChange={(checked) =>
                            setCampaignForm({
                              ...campaignForm,
                              privateShowDescription: checked,
                            })
                          }
                          disabled={isLoading || isLoadingData}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="privateTeaserTitle">
                          Cover name before approval
                        </Label>
                        <Input
                          id="privateTeaserTitle"
                          placeholder='e.g. "Secret Campaign #1"'
                          value={campaignForm.privateTeaserTitle}
                          onChange={(e) =>
                            setCampaignForm({
                              ...campaignForm,
                              privateTeaserTitle: e.target.value,
                            })
                          }
                          disabled={isLoading || isLoadingData}
                        />
                        <p className="text-xs text-muted-foreground">
                          Unapproved clippers see this instead of the real
                          campaign name. Leave empty to show the real name.
                        </p>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="privateTeaserImageUrl">
                          Cover image URL before approval
                        </Label>
                        <Input
                          id="privateTeaserImageUrl"
                          placeholder="https://…"
                          value={campaignForm.privateTeaserImageUrl}
                          onChange={(e) =>
                            setCampaignForm({
                              ...campaignForm,
                              privateTeaserImageUrl: e.target.value,
                            })
                          }
                          disabled={isLoading || isLoadingData}
                        />
                        <p className="text-xs text-muted-foreground">
                          Shown instead of the real campaign image until
                          approval. Leave empty to show the real image.
                        </p>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="privateTeaserDescription">
                          Details shown before approval
                        </Label>
                        <Textarea
                          id="privateTeaserDescription"
                          rows={4}
                          placeholder="What unapproved clippers read in the details section…"
                          value={campaignForm.privateTeaserDescription}
                          onChange={(e) =>
                            setCampaignForm({
                              ...campaignForm,
                              privateTeaserDescription: e.target.value,
                            })
                          }
                          disabled={isLoading || isLoadingData}
                        />
                        <p className="text-xs text-muted-foreground">
                          When set, unapproved clippers see THIS text instead
                          of the real campaign details (the real details stay
                          hidden until approval). Leave empty to fall back to
                          the "Show description" toggle above.
                        </p>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="privateDiscordGuildId">
                          Private Discord server ID
                        </Label>
                        <Input
                          id="privateDiscordGuildId"
                          placeholder="e.g. 1234567890123456789"
                          value={campaignForm.privateDiscordGuildId}
                          onChange={(e) =>
                            setCampaignForm({
                              ...campaignForm,
                              privateDiscordGuildId: e.target.value,
                            })
                          }
                          disabled={isLoading || isLoadingData}
                        />
                        <p className="text-xs text-muted-foreground">
                          Approved clippers get pulled into this server by the
                          bot (the bot must be a member with the Create Invite
                          permission). Leave empty to handle Discord manually.
                        </p>
                      </div>
                    </>
                  )}
                </div>
                <div className="flex gap-3 pt-4">
                  <Button
                    onClick={handleSave}
                    disabled={isLoading || isLoadingData}
                  >
                    {isLoading ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4 mr-2" />
                    )}
                    Save Changes
                  </Button>

                  <Button variant="outline" asChild>
                    <Link to={`/campaign/${campaignId}`}>Cancel</Link>
                  </Button>
                </div>
              </CardContent>
            )}
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Demographics Verification — Reset for Payout</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Use this before a payout to make clippers re-submit fresh
                demographics for <strong>this campaign</strong>. Enter the
                date of your last payout: every demographics record in this
                campaign whose last activity — a new paid-view reward or an
                earlier verification — falls on or after that date is wiped
                back to <strong>active</strong>, clearing its screen recording
                and country data. Those clippers must re-record and be
                re-approved before that account counts toward this
                campaign&apos;s demographics again.
              </p>
              <ul className="text-xs text-muted-foreground list-disc pl-5 space-y-1">
                <li>
                  <strong>This campaign only.</strong> Demographics are
                  per-campaign — run this once for each campaign you&apos;re
                  paying out.
                </li>
                <li>
                  It matches on when each record was last touched (earning or
                  verification activity), <em>not</em> directly on who earned.
                  Because active earners&apos; records stay current, the
                  last-payout date catches everyone still earning; accounts
                  with no new views since that date keep their existing
                  approval.
                </li>
                <li>
                  <strong>No undo.</strong> The screen recordings and parsed
                  demographic data are permanently cleared.
                </li>
                <li>
                  While a clipper has any reset (active) record in{" "}
                  <strong>any</strong> campaign, their Claim button is disabled
                  and they&apos;re flagged in the payout list until they
                  re-verify — this block is enforced in the UI, not the payout
                  backend.
                </li>
              </ul>
              <div className="space-y-2 max-w-sm">
                <Label htmlFor="bulkActivateSince">Last payout date *</Label>
                <Input
                  id="bulkActivateSince"
                  type="date"
                  value={bulkActivateSince}
                  onChange={(e) => setBulkActivateSince(e.target.value)}
                  disabled={
                    isLoadingData || bulkActivateClaimsMutation.isLoading
                  }
                />
                <p className="text-xs text-muted-foreground">
                  Records with activity on or after this date (read as 00:00
                  UTC) are reset.
                </p>
              </div>
              <div className="flex gap-3">
                <Button
                  type="button"
                  variant="destructive"
                  disabled={
                    !bulkActivateSince ||
                    isLoadingData ||
                    bulkActivateClaimsMutation.isLoading
                  }
                  onClick={handleBulkActivateClaims}
                >
                  {bulkActivateClaimsMutation.isLoading ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Check className="h-4 w-4 mr-2" />
                  )}
                  Reset demographics
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* ── Campaign-scoped demographics request ── */}
          <Card>
            <CardHeader>
              <CardTitle>Request demographics for this campaign</CardTitle>
              <CardDescription>
                Asks only the clippers who generated views here, about only the
                accounts they used on this campaign.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                <li>
                  A clipper with ten connected accounts is asked about the ones
                  that actually ran here — not all ten.
                </li>
                <li>
                  <strong>Only this campaign&apos;s earnings go on hold.</strong>{" "}
                  Money they made on other campaigns, referrals and manual
                  credits stays claimable.
                </li>
                <li>
                  Requesting again supersedes the current round and re-asks
                  everyone.
                </li>
              </ul>

              {activeAsk && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/40">
                  <p className="font-medium text-amber-900 dark:text-amber-200">
                    A request is open — {activeAsk.notifiedUserCount} clipper(s)
                    notified for cycle {activeAsk.cycleStart}.
                  </p>
                  {activeAsk.note && (
                    <p className="mt-1 text-amber-900/80 dark:text-amber-200/80">
                      {activeAsk.note}
                    </p>
                  )}
                </div>
              )}

              <div className="max-w-lg space-y-2">
                <Label htmlFor="resetNote">Message to clippers (optional)</Label>
                <Input
                  id="resetNote"
                  placeholder="e.g. Re-checking audience before the next payout"
                  value={resetNote}
                  onChange={(e) => setResetNote(e.target.value)}
                  disabled={requestResetMutation.isLoading}
                />
              </div>

              <div className="flex gap-3">
                <Button
                  type="button"
                  disabled={!campaignId || requestResetMutation.isLoading}
                  onClick={() =>
                    requestResetMutation.mutate({
                      campaignId: campaignId!,
                      note: resetNote.trim() || undefined,
                    })
                  }
                >
                  {requestResetMutation.isLoading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="mr-2 h-4 w-4" />
                  )}
                  {activeAsk ? "Re-ask everyone" : "Request demographics"}
                </Button>
                {activeAsk && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={cancelResetMutation.isLoading}
                    onClick={() =>
                      cancelResetMutation.mutate({ campaignId: campaignId! })
                    }
                  >
                    {cancelResetMutation.isLoading && (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    Close request &amp; release hold
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>YouTube-heavy Payout Controls</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Automatically add negative adjustments for creators whose
                approved clips are overwhelmingly on YouTube. 100% YouTube
                uploads will incur a 45% reduction, ≥85% will be reduced by
                35%, and ≥75% by 30%.
              </p>
              <Button
                type="button"
                variant="destructive"
                disabled={
                  slashYoutubeRewardsMutation.isLoading ||
                  isLoadingData ||
                  isLoading
                }
                onClick={handleSlashYoutubePayouts}
              >
                {slashYoutubeRewardsMutation.isLoading ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Scissors className="h-4 w-4 mr-2" />
                )}
                Slash YouTube-heavy payouts
              </Button>
            </CardContent>
          </Card>

          {campaignId && <CampaignLevelsManager campaignId={campaignId} />}

          {campaignId && <CampaignCpmGroupsManager campaignId={campaignId} />}

          {campaignId && <CampaignGeoRulesManager campaignId={campaignId} />}

          {/* Danger zone: soft-delete the campaign CARD (data preserved) */}
          <Card className="border-red-300">
            <CardHeader>
              <CardTitle className="text-red-700">Danger zone</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Delete this campaign card. This only hides the card from
                listings — the campaign and all its submissions, rewards, and
                clips stay fully intact. You can recover the card anytime from
                the “Recover deleted campaign cards” button on the Clipping
                Campaigns page.
              </p>
              <Button
                variant="destructive"
                onClick={() => {
                  setDeleteConfirmText("");
                  setDeleteDialogOpen(true);
                }}
                disabled={isLoading || isLoadingData}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete campaign card
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Are you really sure?</DialogTitle>
            <DialogDescription>
              This hides the campaign card. The campaign data is NOT deleted and
              can be recovered anytime.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <img
              src="/delete-card-confirm.webp"
              alt="Are you really sure?"
              className="mx-auto max-h-64 w-auto rounded-lg"
            />
            <div className="space-y-2">
              <Label htmlFor="delete-confirm">
                Type exactly:{" "}
                <span className="font-semibold text-foreground">
                  {DELETE_CONFIRM_PHRASE}
                </span>
              </Label>
              <Input
                id="delete-confirm"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder={DELETE_CONFIRM_PHRASE}
                autoComplete="off"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setDeleteDialogOpen(false);
                setDeleteConfirmText("");
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteConfirmText.trim() !== DELETE_CONFIRM_PHRASE}
              onClick={() => {
                setDeleteDialogOpen(false);
                setFinalConfirmOpen(true);
              }}
            >
              I am very sure
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Second / final confirmation — image again, last chance */}
      <Dialog open={finalConfirmOpen} onOpenChange={setFinalConfirmOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Last chance — are you ABSOLUTELY sure?</DialogTitle>
            <DialogDescription>
              This is the final step. The card will be hidden (the campaign
              data stays intact and recoverable).
            </DialogDescription>
          </DialogHeader>
          <img
            src="/delete-card-confirm.webp"
            alt="Are you absolutely sure?"
            className="mx-auto max-h-64 w-auto rounded-lg"
          />
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setFinalConfirmOpen(false);
                setDeleteConfirmText("");
              }}
            >
              No, keep it
            </Button>
            <Button
              variant="destructive"
              disabled={deleteCardMutation.isPending}
              onClick={() =>
                campaignId && deleteCardMutation.mutate({ id: campaignId })
              }
            >
              {deleteCardMutation.isPending ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Deleting…
                </span>
              ) : (
                "Yes, delete the card"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
};

export default CampaignEdit;
// Component for editing campaign settings and category metadata
