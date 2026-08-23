import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Loader2,
  Eye,
  DollarSign,
  Target,
  Calendar,
  ArrowRight,
  Settings,
  FileText,
  Plus,
  BarChart3,
  RotateCcw,
} from "lucide-react";
import { useNavigate, Link } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { useToast } from "@/hooks/use-toast";
import { trpc } from "@/lib/trpc";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../backend/src/routers";

type RouterOutput = inferRouterOutputs<AppRouter>;
type Campaign = RouterOutput["campaigns"]["getAllAdmin"][number];

const Campaigns = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  // Admin view — unsanitized listing (private campaigns keep real budgets).
  const {
    data: campaigns,
    isLoading,
    error,
  } = trpc.campaigns.getAllAdmin.useQuery();
  const utils = trpc.useUtils();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [newCampaignTitle, setNewCampaignTitle] = useState("");
  const [newCampaignBudget, setNewCampaignBudget] = useState("");
  const [recoverOpen, setRecoverOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetSince, setResetSince] = useState("");
  const [resetSelectedIds, setResetSelectedIds] = useState<string[]>([]);
  // "" = leave each campaign's window unchanged; otherwise "7" | "28" | "90".
  const [resetPeriod, setResetPeriod] = useState("");

  const bulkActivateByCampaignsMutation =
    trpc.demographicsVerification.bulkActivateByCampaigns.useMutation();

  const { data: deletedCards, isLoading: deletedLoading } =
    trpc.campaigns.getDeletedCards.useQuery(undefined, { enabled: recoverOpen });
  const recoverCardMutation = trpc.campaigns.recoverCard.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.campaigns.getAll.invalidate(),
        utils.campaigns.getAllAdmin.invalidate(),
        utils.campaigns.getDeletedCards.invalidate(),
      ]);
      toast({
        title: "Campaign card recovered",
        description: "It's back in the campaigns list.",
      });
    },
    onError: (e) =>
      toast({
        title: "Recover failed",
        description: e.message || "Could not recover the card.",
        variant: "destructive",
      }),
  });

  const createCampaignMutation = trpc.campaigns.createCampaign.useMutation({
    onError: (mutationError) => {
      toast({
        title: "Unable to create campaign",
        description:
          mutationError instanceof Error
            ? mutationError.message
            : "Please try again.",
        variant: "destructive",
      });
    },
  });

  const formatNumber = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  if (isLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center py-12">
          <div className="flex items-center gap-2">
            <Loader2 className="h-6 w-6 animate-spin" />
            <span className="text-muted-foreground">Loading campaigns...</span>
          </div>
        </div>
      </AppLayout>
    );
  }

  if (error) {
    return (
      <AppLayout>
        <div className="max-w-7xl mx-auto px-6 py-8">
          <div className="flex items-center justify-center py-12">
            <p className="text-destructive">Failed to load campaigns</p>
          </div>
        </div>
      </AppLayout>
    );
  }

  const handleCreateCampaign = async () => {
    if (!newCampaignTitle.trim()) {
      toast({
        title: "A title is required",
        description: "Add a working title so we can create the campaign",
        variant: "destructive",
      });
      return;
    }

    try {
      const result = await createCampaignMutation.mutateAsync({
        title: newCampaignTitle.trim(),
        budget: parseFloat(newCampaignBudget) || 0,
      });

      await Promise.all([
        utils.campaigns.getAll.invalidate(),
        utils.campaigns.getAllAdmin.invalidate(),
      ]);
      toast({
        title: "Campaign created",
        description: "Finish configuring it in the editor",
      });
      setNewCampaignTitle("");
      setNewCampaignBudget("");
      setIsDialogOpen(false);
      if (result?.id) {
        navigate(`/campaign/${result.id}/edit`);
      }
    } catch {
      // handled by mutation onError
    }
  };

  const liveCampaigns =
    campaigns?.filter((campaign) => !campaign.ended) || [];
  const endedCampaigns =
    campaigns?.filter((campaign) => campaign.ended) || [];
  // The reset can target any campaign, including ended ones (you may still be
  // paying out an ended campaign). Live first, ended after.
  const resettableCampaigns = [...liveCampaigns, ...endedCampaigns];

  const toggleResetCampaign = (id: string, checked: boolean) => {
    setResetSelectedIds((prev) =>
      checked ? [...prev, id] : prev.filter((existing) => existing !== id)
    );
  };

  const handleResetDemographics = async () => {
    if (resetSelectedIds.length === 0 || !resetSince) return;
    try {
      const result = await bulkActivateByCampaignsMutation.mutateAsync({
        campaignIds: resetSelectedIds,
        updatedSince: new Date(resetSince),
        recordingPeriodDays: resetPeriod
          ? (Number(resetPeriod) as 7 | 28 | 90)
          : undefined,
      });
      // The reset writes the recording window onto the campaigns, so refresh
      // the campaign caches (a warm CampaignEdit would otherwise save over it).
      await Promise.all([
        utils.campaigns.getAllAdmin.invalidate(),
        utils.campaigns.getAll.invalidate(),
      ]);
      const windowNote = resetPeriod
        ? ` Recording window set to ${resetPeriod} days on ${resetSelectedIds.length} campaign(s).`
        : "";
      toast({
        title: "Demographics reset",
        description:
          (result.totalUpdated > 0
            ? `${result.totalUpdated} verification(s) reset across ${resetSelectedIds.length} campaign(s). Clippers must re-record before this payout.`
            : "No verifications matched the date in the selected campaigns.") +
          windowNote,
      });
      setResetOpen(false);
      setResetSelectedIds([]);
      setResetSince("");
      setResetPeriod("");
    } catch (mutationError) {
      toast({
        title: "Reset failed",
        description:
          mutationError instanceof Error
            ? mutationError.message
            : "Please try again.",
        variant: "destructive",
      });
    }
  };

  const renderCampaignCard = (campaign: Campaign) => (
    <Card key={campaign.id} className="hover-lift">
      <CardHeader>
        <div className="flex items-start justify-between">
          <CardTitle className="text-lg line-clamp-2">
            {campaign.title || "Untitled Campaign"}
          </CardTitle>
          <Badge
            variant={!campaign.ended ? "default" : "secondary"}
            className={
              !campaign.ended
                ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                : ""
            }
          >
            {!campaign.ended ? "Live" : "Ended"}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <div className="flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            <div>
              <div className="font-medium">
                ${campaign.budget?.toLocaleString() || 0}
              </div>
              <div className="text-muted-foreground">Internal Budget</div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-green-600 dark:text-green-400" />
            <div>
              <div className="font-medium">
                ${campaign.external_budget?.toLocaleString() || 0}
              </div>
              <div className="text-muted-foreground">External Budget</div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-purple-600 dark:text-purple-400" />
            <div>
              <div className="font-medium">
                {formatNumber(campaign.submissionCount || 0)}
              </div>
              <div className="text-muted-foreground">Submissions</div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Eye className="h-4 w-4 text-orange-600 dark:text-orange-400" />
            <div>
              <div className="font-medium">
                {formatNumber(campaign.views || 0)}
              </div>
              <div className="text-muted-foreground">Views</div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Target className="h-4 w-4 text-red-600 dark:text-red-400" />
            <div>
              <div className="font-medium">
                {(campaign.achievementPercentage || 0).toFixed(1)}%
              </div>
              <div className="text-muted-foreground">Achieved</div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-gray-600 dark:text-gray-400" />
            <div>
              <div className="font-medium">
                {formatDate(campaign.created_at.toISOString())}
              </div>
              <div className="text-muted-foreground">Created</div>
            </div>
          </div>
        </div>

        {campaign.platforms && (
          <div>
            <div className="text-sm text-muted-foreground mb-2">Platforms</div>
            <div className="flex flex-wrap gap-1">
              {campaign.platforms
                .split(",")
                .map((platform: string, index: number) => (
                  <Badge
                    key={index}
                    variant="outline"
                    className="text-xs hover:bg-primary/10 transition-colors"
                  >
                    {platform.trim()}
                  </Badge>
                ))}
            </div>
          </div>
        )}

        <div className="space-y-2">
          <Button asChild className="w-full">
            <Link to={`/campaign/${campaign.id}`}>
              View Dashboard
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              asChild
              variant="outline"
              size="sm"
              className="w-full sm:flex-1"
            >
              <Link to={`/campaign/${campaign.id}/edit`}>
                <Settings className="mr-2 h-4 w-4" />
                Edit Campaign
              </Link>
            </Button>
            <Button
              asChild
              variant="outline"
              size="sm"
              className="w-full sm:flex-1"
            >
              <Link to={`/campaign/${campaign.id}/stats`}>
                <BarChart3 className="mr-2 h-4 w-4" />
                View Stats
              </Link>
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto px-6 py-8 space-y-12">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">
              Campaigns
            </h1>
            <p className="text-sm text-muted-foreground">
              Review campaigns and spin up new ones instantly.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Dialog
            open={resetOpen}
            onOpenChange={(open) => {
              setResetOpen(open);
              if (!open && !bulkActivateByCampaignsMutation.isPending) {
                setResetSelectedIds([]);
                setResetSince("");
                setResetPeriod("");
              }
            }}
          >
            <DialogTrigger asChild>
              <Button variant="outline" className="w-full md:w-auto">
                <RotateCcw className="mr-2 h-4 w-4" />
                Reset demographics
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Reset demographics for payout</DialogTitle>
                <DialogDescription>
                  Pick the campaigns you're paying out and your last payout
                  date. Every demographics record in those campaigns with
                  activity on or after that date is cleared, so clippers
                  re-record before this payout. An account used across several
                  of these campaigns is only asked once.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="space-y-2">
                  <Label htmlFor="reset-since">Last payout date</Label>
                  <Input
                    id="reset-since"
                    type="date"
                    value={resetSince}
                    onChange={(event) => setResetSince(event.target.value)}
                    disabled={bulkActivateByCampaignsMutation.isPending}
                  />
                  <p className="text-xs text-muted-foreground">
                    Records with activity on or after this date (read as 00:00
                    UTC) are reset. Clearing the screen recordings is permanent.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>Screen-recording window (optional)</Label>
                  <p className="text-xs text-muted-foreground">
                    Apply this recording window to every selected campaign.
                    &quot;Leave unchanged&quot; keeps each campaign&apos;s
                    current setting.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { value: "", label: "Leave unchanged" },
                      { value: "7", label: "7 days" },
                      { value: "28", label: "28 days" },
                      { value: "90", label: "90 days" },
                    ].map((opt) => (
                      <Button
                        key={opt.value || "unchanged"}
                        type="button"
                        size="sm"
                        variant={
                          resetPeriod === opt.value ? "default" : "outline"
                        }
                        onClick={() => setResetPeriod(opt.value)}
                        disabled={bulkActivateByCampaignsMutation.isPending}
                      >
                        {opt.label}
                      </Button>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Campaigns to reset</Label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={
                        resettableCampaigns.length === 0 ||
                        bulkActivateByCampaignsMutation.isPending
                      }
                      onClick={() =>
                        setResetSelectedIds(
                          resetSelectedIds.length === resettableCampaigns.length
                            ? []
                            : resettableCampaigns.map((campaign) => campaign.id)
                        )
                      }
                    >
                      {resetSelectedIds.length === resettableCampaigns.length &&
                      resettableCampaigns.length > 0
                        ? "Clear all"
                        : "Select all"}
                    </Button>
                  </div>
                  <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border p-2">
                    {resettableCampaigns.length === 0 ? (
                      <p className="p-2 text-sm text-muted-foreground">
                        No campaigns to reset.
                      </p>
                    ) : (
                      resettableCampaigns.map((campaign) => (
                        <label
                          key={campaign.id}
                          className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-muted/50"
                        >
                          <Checkbox
                            checked={resetSelectedIds.includes(campaign.id)}
                            onCheckedChange={(checked) =>
                              toggleResetCampaign(campaign.id, checked === true)
                            }
                            disabled={bulkActivateByCampaignsMutation.isPending}
                          />
                          <span className="text-sm">
                            {campaign.title ?? "Untitled campaign"}
                          </span>
                          {campaign.ended && (
                            <Badge variant="secondary" className="text-[10px]">
                              Ended
                            </Badge>
                          )}
                        </label>
                      ))
                    )}
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setResetOpen(false)}
                  disabled={bulkActivateByCampaignsMutation.isPending}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleResetDemographics}
                  disabled={
                    bulkActivateByCampaignsMutation.isPending ||
                    resetSelectedIds.length === 0 ||
                    !resetSince
                  }
                >
                  {bulkActivateByCampaignsMutation.isPending && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  Reset{" "}
                  {resetSelectedIds.length > 0
                    ? `${resetSelectedIds.length} `
                    : ""}
                  campaign
                  {resetSelectedIds.length === 1 ? "" : "s"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Dialog
            open={isDialogOpen}
            onOpenChange={(open) => {
              setIsDialogOpen(open);
              if (!open && !createCampaignMutation.isPending) {
                setNewCampaignTitle("");
                setNewCampaignBudget("");
              }
            }}
          >
            <DialogTrigger asChild>
              <Button className="w-full md:w-auto">
                <Plus className="mr-2 h-4 w-4" />
                New Campaign
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create a new campaign</DialogTitle>
                <DialogDescription>
                  Start with a title and optional budget. You can fine-tune
                  everything else in the campaign editor.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="space-y-2">
                  <Label htmlFor="new-campaign-title">Campaign title</Label>
                  <Input
                    id="new-campaign-title"
                    placeholder="e.g. Summer UGC push"
                    value={newCampaignTitle}
                    onChange={(event) => setNewCampaignTitle(event.target.value)}
                    disabled={createCampaignMutation.isPending}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-campaign-budget">
                    Initial internal budget (USD)
                  </Label>
                  <Input
                    id="new-campaign-budget"
                    type="number"
                    min="0"
                    step="1"
                    placeholder="0"
                    value={newCampaignBudget}
                    onChange={(event) => setNewCampaignBudget(event.target.value)}
                    disabled={createCampaignMutation.isPending}
                  />
                  <p className="text-xs text-muted-foreground">
                    Budgets, payouts, and platform settings can all be refined
                    later on the Edit Campaign screen.
                  </p>
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setIsDialogOpen(false)}
                  disabled={createCampaignMutation.isPending}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleCreateCampaign}
                  disabled={createCampaignMutation.isPending}
                >
                  {createCampaignMutation.isPending && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  Create & continue
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          </div>
        </div>

        {/* Recover deleted campaign cards */}
        <Dialog open={recoverOpen} onOpenChange={setRecoverOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Recover deleted campaign cards</DialogTitle>
              <DialogDescription>
                These cards are hidden but their campaigns and data are fully
                intact. Recover one to put its card back in the list.
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-[60vh] space-y-2 overflow-y-auto">
              {deletedLoading ? (
                <div className="flex items-center gap-2 py-8 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" /> Loading…
                </div>
              ) : !deletedCards || deletedCards.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No deleted campaign cards.
                </p>
              ) : (
                deletedCards.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center justify-between gap-3 rounded-lg border p-3"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium">
                        {c.title || "Untitled Campaign"}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Deleted{" "}
                        {c.cardDeletedAt
                          ? new Date(c.cardDeletedAt).toLocaleString()
                          : ""}
                        {c.platforms ? ` · ${c.platforms}` : ""}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      disabled={recoverCardMutation.isPending}
                      onClick={() => recoverCardMutation.mutate({ id: c.id })}
                    >
                      Recover
                    </Button>
                  </div>
                ))
              )}
            </div>
          </DialogContent>
        </Dialog>

        {/* Live Campaigns Section */}
        <div>
          <div className="mb-6">
            <h2 className="text-xl font-semibold text-foreground mb-2">
              Live Campaigns
            </h2>
            <p className="text-sm text-muted-foreground">
              {liveCampaigns.length} campaign
              {liveCampaigns.length !== 1 ? "s" : ""} live
            </p>
          </div>

          {liveCampaigns.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <p className="text-muted-foreground">No live campaigns found</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {liveCampaigns.map(renderCampaignCard)}
            </div>
          )}
        </div>

        {/* Ended Campaigns Section */}
        <div>
          <div className="mb-6">
            <h2 className="text-xl font-semibold text-foreground mb-2">
              Ended Campaigns
            </h2>
            <p className="text-sm text-muted-foreground">
              {endedCampaigns.length} campaign
              {endedCampaigns.length !== 1 ? "s" : ""} ended
            </p>
          </div>

          {endedCampaigns.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <p className="text-muted-foreground">
                No ended campaigns found
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {endedCampaigns.map(renderCampaignCard)}
            </div>
          )}
        </div>

        {/* Recover deleted campaign cards — bottom of the page */}
        <div className="flex justify-center border-t border-border/60 pt-8">
          <Button
            type="button"
            variant="outline"
            onClick={() => setRecoverOpen(true)}
          >
            Recover deleted campaign cards
          </Button>
        </div>
      </div>
    </AppLayout>
  );
};

export default Campaigns;
