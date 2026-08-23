import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Save, Trash2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { useToast } from "@/hooks/use-toast";

interface CampaignLevelsManagerProps {
  campaignId: string;
}

type LevelDraft = {
  threshold: string;
  cpmRate: string;
  description: string;
};

export const CampaignLevelsManager = ({ campaignId }: CampaignLevelsManagerProps) => {
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const { data: levels, isLoading } = trpc.campaigns.getCampaignLevels.useQuery(
    { campaignId },
    { enabled: Boolean(campaignId) }
  );
  const createLevelMutation = trpc.campaigns.createCampaignLevel.useMutation();
  const updateLevelMutation = trpc.campaigns.updateCampaignLevel.useMutation();
  const deleteLevelMutation = trpc.campaigns.deleteCampaignLevel.useMutation();

  const [newLevel, setNewLevel] = useState<LevelDraft>({ threshold: "", cpmRate: "", description: "" });
  const [levelDrafts, setLevelDrafts] = useState<Record<string, LevelDraft>>({});

  useEffect(() => {
    if (!levels) {
      setLevelDrafts({});
      return;
    }

    const drafts: Record<string, LevelDraft> = {};
    levels.forEach((level) => {
      drafts[level.id] = {
        threshold: level.level_threshold.toString(),
        cpmRate: level.cpm_rate.toString(),
        description: level.additional_rewards_description ?? "",
      };
    });
    setLevelDrafts(drafts);
  }, [levels]);

  const isMutating =
    createLevelMutation.isPending ||
    updateLevelMutation.isPending ||
    deleteLevelMutation.isPending;

  const sortedLevels = useMemo(() => {
    return (levels ?? []).slice().sort((a, b) => a.level_threshold - b.level_threshold);
  }, [levels]);

  const handleAddLevel = async () => {
    const thresholdValue = Number(newLevel.threshold);
    const cpmValue = Number(newLevel.cpmRate);

    if (!Number.isFinite(thresholdValue) || thresholdValue < 0) {
      toast({
        title: "Invalid threshold",
        description: "Level threshold must be a non-negative number.",
        variant: "destructive",
      });
      return;
    }

    if (!Number.isFinite(cpmValue) || cpmValue <= 0) {
      toast({
        title: "Invalid CPM",
        description: "CPM rate must be greater than 0.",
        variant: "destructive",
      });
      return;
    }

    try {
      const description = newLevel.description.trim();
      await createLevelMutation.mutateAsync({
        campaignId,
        levelThreshold: thresholdValue,
        cpmRate: cpmValue,
        additionalRewardsDescription: description || undefined,
      });
      await utils.campaigns.getCampaignLevels.invalidate({ campaignId });
      setNewLevel({ threshold: "", cpmRate: "", description: "" });
      toast({
        title: "Level added",
        description: "The campaign level has been created.",
      });
    } catch (error) {
      toast({
        title: "Failed to add level",
        description: error instanceof Error ? error.message : "Something went wrong.",
        variant: "destructive",
      });
    }
  };

  const handleUpdateLevel = async (levelId: string) => {
    const draft = levelDrafts[levelId];
    if (!draft) return;

    const thresholdValue = Number(draft.threshold);
    const cpmValue = Number(draft.cpmRate);
    const description = draft.description.trim();

    if (!Number.isFinite(thresholdValue) || thresholdValue < 0) {
      toast({
        title: "Invalid threshold",
        description: "Level threshold must be a non-negative number.",
        variant: "destructive",
      });
      return;
    }

    if (!Number.isFinite(cpmValue) || cpmValue <= 0) {
      toast({
        title: "Invalid CPM",
        description: "CPM rate must be greater than 0.",
        variant: "destructive",
      });
      return;
    }

    try {
      await updateLevelMutation.mutateAsync({
        id: levelId,
        campaignId,
        levelThreshold: thresholdValue,
        cpmRate: cpmValue,
        additionalRewardsDescription: description || undefined,
      });
      await utils.campaigns.getCampaignLevels.invalidate({ campaignId });
      toast({
        title: "Level updated",
        description: "The campaign level has been saved.",
      });
    } catch (error) {
      toast({
        title: "Failed to update level",
        description: error instanceof Error ? error.message : "Something went wrong.",
        variant: "destructive",
      });
    }
  };

  const handleDeleteLevel = async (levelId: string) => {
    try {
      await deleteLevelMutation.mutateAsync({ id: levelId, campaignId });
      await utils.campaigns.getCampaignLevels.invalidate({ campaignId });
      toast({
        title: "Level removed",
        description: "The campaign level has been deleted.",
      });
    } catch (error) {
      toast({
        title: "Failed to delete level",
        description: error instanceof Error ? error.message : "Something went wrong.",
        variant: "destructive",
      });
    }
  };

  const isAddDisabled =
    !newLevel.threshold.trim() ||
    !newLevel.cpmRate.trim() ||
    isMutating;

  const hasLevels = sortedLevels.length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Campaign Levels</CardTitle>
        <CardDescription>
          Reward creators with higher CPMs once they reach specific lifetime view thresholds for this campaign.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label>Add a new level</Label>
          <div className="grid gap-4 md:grid-cols-[1fr_1fr_2fr_auto]">
            <Input
              type="number"
              min="0"
              placeholder="e.g. 50000"
              value={newLevel.threshold}
              onChange={(event) =>
                setNewLevel((prev) => ({ ...prev, threshold: event.target.value }))
              }
              disabled={isMutating}
            />
            <Input
              type="number"
              min="0"
              step="0.01"
              placeholder="New CPM rate"
              value={newLevel.cpmRate}
              onChange={(event) =>
                setNewLevel((prev) => ({ ...prev, cpmRate: event.target.value }))
              }
              disabled={isMutating}
            />
            <Input
              placeholder="Describe additional rewards"
              value={newLevel.description}
              onChange={(event) =>
                setNewLevel((prev) => ({
                  ...prev,
                  description: event.target.value,
                }))
              }
              disabled={isMutating}
            />
            <Button onClick={handleAddLevel} disabled={isAddDisabled}>
              {createLevelMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Plus className="mr-2 h-4 w-4" />
              )}
              Add level
            </Button>
          </div>
        </div>

        <div className="space-y-4">
          <Label>Existing levels</Label>
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading levels...
            </div>
          ) : hasLevels ? (
            <div className="divide-y rounded-md border">
              {sortedLevels.map((level) => {
                const draft = levelDrafts[level.id];
                const thresholdMatches =
                  draft && Number(draft.threshold) === level.level_threshold;
                const cpmMatches = draft && Number(draft.cpmRate) === level.cpm_rate;
                const descriptionMatches =
                  (draft?.description ?? "") ===
                  (level.additional_rewards_description ?? "");
                const hasChanges = !(
                  thresholdMatches && cpmMatches && descriptionMatches
                );

                return (
                  <div
                    key={level.id}
                    className="grid gap-4 p-4 md:grid-cols-[1fr_1fr_2fr_auto] md:items-center"
                  >
                    <Input
                      type="number"
                      min="0"
                      value={draft?.threshold ?? ""}
                      onChange={(event) =>
                        setLevelDrafts((prev) => ({
                          ...prev,
                          [level.id]: {
                            threshold: event.target.value,
                            cpmRate: prev[level.id]?.cpmRate ?? "",
                            description: prev[level.id]?.description ?? "",
                          },
                        }))
                      }
                      disabled={isMutating}
                    />
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={draft?.cpmRate ?? ""}
                      onChange={(event) =>
                        setLevelDrafts((prev) => ({
                          ...prev,
                          [level.id]: {
                            threshold: prev[level.id]?.threshold ?? "",
                            cpmRate: event.target.value,
                            description: prev[level.id]?.description ?? "",
                          },
                        }))
                      }
                      disabled={isMutating}
                    />
                    <Input
                      placeholder="Describe additional rewards"
                      value={draft?.description ?? ""}
                      onChange={(event) =>
                        setLevelDrafts((prev) => ({
                          ...prev,
                          [level.id]: {
                            threshold: prev[level.id]?.threshold ?? "",
                            cpmRate: prev[level.id]?.cpmRate ?? "",
                            description: event.target.value,
                          },
                        }))
                      }
                      disabled={isMutating}
                    />
                    <div className="flex items-center gap-2 justify-self-end">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => handleUpdateLevel(level.id)}
                        disabled={!hasChanges || isMutating}
                      >
                        {updateLevelMutation.isPending &&
                        updateLevelMutation.variables?.id === level.id ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Save className="mr-2 h-4 w-4" />
                        )}
                        Save
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        onClick={() => handleDeleteLevel(level.id)}
                        disabled={isMutating}
                      >
                        {deleteLevelMutation.isPending &&
                        deleteLevelMutation.variables?.id === level.id ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="mr-2 h-4 w-4" />
                        )}
                        Delete
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No levels have been created yet. Use the form above to create the first threshold.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
