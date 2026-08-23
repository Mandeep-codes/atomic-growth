import { FormEvent, useEffect, useMemo, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { BountyProgress } from "@/components/dashboard/BountyProgress";
import { Leaderboard } from "@/components/dashboard/Leaderboard";
import { PlatformBreakdown } from "@/components/dashboard/PlatformBreakdown";
import { SubmissionTrends } from "@/components/dashboard/SubmissionTrends";
import { useDashboardCampaignData } from "@/hooks/useCampaignData";
import { Loader2, Eye, EyeOff } from "lucide-react";
import { useParams } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { useRole } from "@/hooks/useRole";
import { CampaignCategories } from "@/components/dashboard/CampaignCategories";
import { Demographics } from "@/components/dashboard/Demographics";
import { useFeatureFlag } from "@/hooks/useFeatureFlag";

const Index = () => {
  const { campaignId, category } = useParams();
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [password, setPassword] = useState("");
  // The verified password is kept (the input itself is cleared) so the page
  // can re-authorize server-side and show this client their real campaign —
  // title, budget and CPM — instead of the private-campaign teaser cover.
  const [unlockPassword, setUnlockPassword] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const { roles, isRolesLoaded } = useRole();
  const { enabled: demographicsFeatureFlagEnabled } = useFeatureFlag(
    "DEMOGRAPHICS_ON_CAMPAIGN"
  );

  if (!campaignId) {
    throw new Error("Campaign ID is required");
  }

  // Same entitlement-aware source the metric cards use, so the heading shows
  // the REAL campaign title to staff and to the unlocked client. The public
  // getById swaps in private_teaser_title — the pre-application cover name —
  // which left the dashboard headed "Secret AI Tech Campaign" instead of
  // "Nyne AI". Unauthorized viewers still get the teaser.
  const { data: campaignInfo, isLoading: campaignLoading } =
    useDashboardCampaignData(campaignId, category, unlockPassword);
  const verifyPassword = trpc.campaigns.verifyExternalPassword.useMutation();

  const handlePasswordSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPasswordError(null);

    if (!password.trim()) {
      setPasswordError("Enter the password to continue.");
      return;
    }

    try {
      const result = await verifyPassword.mutateAsync({
        campaignId,
        password,
      });

      if (result.valid) {
        setIsUnlocked(true);
        setUnlockPassword(password);
        setPassword("");
      } else {
        setPasswordError("Incorrect password. Try again.");
      }
    } catch (error) {
      setPasswordError(
        error instanceof Error ? error.message : "Unable to verify password"
      );
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const isAuthorized = isUnlocked || roles.includes("campaign-editor");

  if (campaignLoading || !isRolesLoaded) {
    return (
      <AppLayout>
        <div className="max-w-7xl mx-auto px-6 py-6">
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-muted-foreground">Loading...</span>
          </div>
        </div>
      </AppLayout>
    );
  }

  if (!isAuthorized) {
    return (
      <AppLayout>
        <div className="mx-auto flex min-h-[60vh] max-w-lg flex-col justify-center gap-6 px-6 py-10">
          <div className="space-y-2 text-center">
            <h2 className="text-2xl font-semibold text-foreground">
              Enter Password
            </h2>
            <p className="text-sm text-muted-foreground">
              Enter the password provided by the campaign owner to view live
              performance data.
            </p>
          </div>
          <form
            onSubmit={handlePasswordSubmit}
            className="space-y-4 rounded-2xl border border-border/70 bg-card/80 p-6 shadow-sm"
          >
            <div className="space-y-2">
              <Label htmlFor="campaign-password">Password</Label>
              <div className="relative">
                <Input
                  id="campaign-password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  autoComplete="current-password"
                  onChange={(event) => setPassword(event.target.value)}
                  disabled={verifyPassword.isPending}
                />
                <button
                  type="button"
                  className="absolute inset-y-0 right-3 flex items-center text-muted-foreground"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={
                    showPassword
                      ? "Hide campaign password"
                      : "Show campaign password"
                  }
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
              {passwordError && (
                <p className="text-sm text-destructive">{passwordError}</p>
              )}
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={verifyPassword.isPending}
            >
              {verifyPassword.isPending ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" /> Unlocking…
                </span>
              ) : (
                "Unlock dashboard"
              )}
            </Button>
          </form>
        </div>
      </AppLayout>
    );
  }

  const showDemographics =
    Boolean(campaignInfo?.campaign?.demographics_json) &&
    Boolean(campaignInfo?.campaign?.demographicsVerificationEnabled);

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto px-6 py-6">
        <div className="text-left">
          <h2 className="text-xl font-semibold text-foreground">
            {campaignInfo?.campaign?.title || "Campaign Dashboard"}
          </h2>
          <p className="text-sm text-muted-foreground">
            Active since{" "}
            {campaignInfo?.campaign?.created_at
              ? formatDate(campaignInfo.campaign.created_at.toISOString())
              : "Unknown date"}
          </p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 pb-8">
        <div className="space-y-8">
          <BountyProgress
            campaignId={campaignId}
            unlockPassword={unlockPassword}
          />
          {/* <SubmissionTrends campaignId={campaignId} /> */}

          <div className="space-y-8">
            <div className="space-y-8">
              <Leaderboard campaignId={campaignId} limit={100} />
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <PlatformBreakdown campaignId={campaignId} />
              {showDemographics && (
                <Demographics
                  demographics={campaignInfo?.campaign?.demographics_json}
                  visibleCountries={
                    campaignInfo?.campaign?.demographicsVisibleCountries ?? null
                  }
                />
              )}
            </div>
          </div>

          {/* Campaign Categories */}
          <CampaignCategories campaignId={campaignId} />
        </div>
      </div>
    </AppLayout>
  );
};

export default Index;
