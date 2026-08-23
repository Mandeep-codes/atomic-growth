import { useEffect, useState } from "react";
import { Loader2, Plus, Save, Trash2, X } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
import type { AppRouter } from "../../../backend/src/routers";
import type { inferRouterOutputs } from "@trpc/server";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { trpc } from "@/lib/trpc";
import { useToast } from "@/hooks/use-toast";

type RouterOutput = inferRouterOutputs<AppRouter>;
type CpmGroup = RouterOutput["campaigns"]["listCpmGroups"][number];
type ClipperCandidate =
  RouterOutput["campaigns"]["lookupClipperForCpm"][number];

interface CampaignCpmGroupsManagerProps {
  campaignId: string;
}

const MIN_LOOKUP_CHARS = 2;
const MAX_LOOKUP_CHARS = 100;
// Backend zod bounds mirrored here (min = smallest decimal(8,4) step).
const MIN_CPM_PER_1000 = 0.0001;
const MAX_CPM_PER_1000 = 10;
const MIN_GROUP_NAME_CHARS = 1;
const MAX_GROUP_NAME_CHARS = 60;

const isValidRate = (value: number) =>
  Number.isFinite(value) &&
  value >= MIN_CPM_PER_1000 &&
  value <= MAX_CPM_PER_1000;

const getClipperDisplayName = (
  user: {
    discordUsername: string | null;
    firstName: string | null;
    lastName: string | null;
  },
  fallbackId: string
) => {
  if (user.discordUsername) return user.discordUsername;
  const fullName = `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim();
  if (fullName) return fullName;
  return fallbackId;
};

const getInitials = (value: string) => {
  if (!value) return "UC";
  const letters = value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase());
  if (letters.length === 0) return value.slice(0, 2).toUpperCase();
  return letters.slice(0, 2).join("") || value.slice(0, 2).toUpperCase();
};

interface CpmGroupCardProps {
  campaignId: string;
  group: CpmGroup;
}

const CpmGroupCard = ({ campaignId, group }: CpmGroupCardProps) => {
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const updateRateMutation = trpc.campaigns.updateCpmGroupRate.useMutation();
  const deleteGroupMutation = trpc.campaigns.deleteCpmGroup.useMutation();
  const addMemberMutation = trpc.campaigns.addCpmGroupMember.useMutation();
  const removeMemberMutation =
    trpc.campaigns.removeCpmGroupMember.useMutation();

  const [rateDraft, setRateDraft] = useState(group.cpmPer1000.toString());
  const [searchInput, setSearchInput] = useState("");

  useEffect(() => {
    setRateDraft(group.cpmPer1000.toString());
  }, [group.cpmPer1000]);

  const debouncedSearch = useDebouncedValue(searchInput, 400);
  const trimmedSearch = debouncedSearch.trim();
  const shouldSearch = trimmedSearch.length >= MIN_LOOKUP_CHARS;
  const {
    data: candidates = [],
    isFetching: isSearching,
    isError: isSearchError,
  } = trpc.campaigns.lookupClipperForCpm.useQuery(
    { query: trimmedSearch },
    { enabled: shouldSearch }
  );

  const isMutating =
    updateRateMutation.isPending ||
    deleteGroupMutation.isPending ||
    addMemberMutation.isPending ||
    removeMemberMutation.isPending;

  const rateChanged = Number(rateDraft) !== group.cpmPer1000;

  const handleSaveRate = async () => {
    const rateValue = Number(rateDraft);
    if (!isValidRate(rateValue)) {
      toast({
        title: "Invalid rate",
        description: `Rate must be between $${MIN_CPM_PER_1000} and $${MAX_CPM_PER_1000} per 1000 views.`,
        variant: "destructive",
      });
      return;
    }

    try {
      const result = await updateRateMutation.mutateAsync({
        campaignId,
        groupId: group.id,
        cpmPer1000: rateValue,
      });
      await utils.campaigns.listCpmGroups.invalidate({ campaignId });
      toast({
        title: "Rate updated",
        description: `${result.settledMembers} members settled at the old rate.`,
      });
    } catch (error) {
      toast({
        title: "Failed to update rate",
        description:
          error instanceof Error ? error.message : "Something went wrong.",
        variant: "destructive",
      });
    }
  };

  const handleDeleteGroup = async () => {
    try {
      await deleteGroupMutation.mutateAsync({ campaignId, groupId: group.id });
      await utils.campaigns.listCpmGroups.invalidate({ campaignId });
      toast({
        title: "Group deleted",
        description: `Members of "${group.name}" go back to the normal campaign rates.`,
      });
    } catch (error) {
      toast({
        title: "Failed to delete group",
        description:
          error instanceof Error ? error.message : "Something went wrong.",
        variant: "destructive",
      });
    }
  };

  const handleAddMember = async (candidate: ClipperCandidate) => {
    try {
      await addMemberMutation.mutateAsync({
        campaignId,
        groupId: group.id,
        discordId: candidate.discordId,
      });
      await utils.campaigns.listCpmGroups.invalidate({ campaignId });
      setSearchInput("");
      toast({
        title: "Clipper added",
        description: `${getClipperDisplayName(
          candidate,
          candidate.discordId
        )} now earns $${group.cpmPer1000.toFixed(4)} / 1000 views on new views.`,
      });
    } catch (error) {
      // Backend messages here are admin-actionable (e.g. "already in a rate
      // group", "banned") — surface them verbatim.
      toast({
        title: "Failed to add clipper",
        description:
          error instanceof Error ? error.message : "Something went wrong.",
        variant: "destructive",
      });
    }
  };

  const handleRemoveMember = async (memberId: string) => {
    try {
      await removeMemberMutation.mutateAsync({
        campaignId,
        groupId: group.id,
        memberId,
      });
      await utils.campaigns.listCpmGroups.invalidate({ campaignId });
      toast({
        title: "Clipper removed",
        description: "The clipper goes back to the normal campaign rates.",
      });
    } catch (error) {
      toast({
        title: "Failed to remove clipper",
        description:
          error instanceof Error ? error.message : "Something went wrong.",
        variant: "destructive",
      });
    }
  };

  const hasMembers = group.members.length > 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-col gap-1">
            <CardTitle className="text-base">{group.name}</CardTitle>
            <CardDescription>
              Updated {new Date(group.updatedAt).toLocaleString()}
            </CardDescription>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Input
              type="number"
              min={MIN_CPM_PER_1000}
              max={MAX_CPM_PER_1000}
              step="0.01"
              placeholder="$ / 1000 views"
              className="w-40"
              value={rateDraft}
              onChange={(event) => setRateDraft(event.target.value)}
              disabled={isMutating}
            />
            <Button
              onClick={handleSaveRate}
              disabled={!rateDraft.trim() || !rateChanged || isMutating}
            >
              {updateRateMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              Save rate
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive"
                  disabled={isMutating}
                >
                  {deleteGroupMutation.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="mr-2 h-4 w-4" />
                  )}
                  Delete group
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    Delete "{group.name}"?
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    Members drop back to normal campaign rates. Pending views
                    are paid at the group rate first.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDeleteGroup}>
                    Delete group
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label>Members</Label>
          {hasMembers ? (
            <div className="divide-y rounded-md border">
              {group.members.map((member) => {
                const displayName = getClipperDisplayName(
                  member,
                  member.userId
                );
                return (
                  <div
                    key={member.id}
                    className="flex flex-wrap items-center gap-3 p-3"
                  >
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={member.imageUrl ?? undefined} />
                      <AvatarFallback>{getInitials(displayName)}</AvatarFallback>
                    </Avatar>
                    <div className="flex flex-col">
                      <span className="text-sm font-medium">{displayName}</span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {member.userId}
                      </span>
                    </div>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="ml-auto text-destructive"
                          disabled={isMutating}
                        >
                          {removeMemberMutation.isPending &&
                          removeMemberMutation.variables?.memberId ===
                            member.id ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <X className="mr-2 h-4 w-4" />
                          )}
                          Remove
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>
                            Remove {displayName} from "{group.name}"?
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            {displayName} drops back to the normal campaign
                            rates. Pending views are paid at the group rate
                            first.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => handleRemoveMember(member.id)}
                          >
                            Remove clipper
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No members yet. Search for a clipper below to add one.
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label>Add clipper</Label>
          <Input
            maxLength={MAX_LOOKUP_CHARS}
            placeholder="Search by Discord username or ID"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            disabled={isMutating}
          />
          {shouldSearch &&
            (isSearching ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Searching
                clippers...
              </div>
            ) : isSearchError ? (
              <p className="text-sm text-destructive">
                Search failed — try again.
              </p>
            ) : candidates.length > 0 ? (
              <div className="divide-y rounded-md border">
                {candidates.map((candidate) => {
                  const displayName = getClipperDisplayName(
                    candidate,
                    candidate.discordId
                  );
                  return (
                    <button
                      key={candidate.discordId}
                      type="button"
                      className="flex w-full items-center gap-3 p-3 text-left hover:bg-muted/50"
                      onClick={() => handleAddMember(candidate)}
                      disabled={isMutating}
                    >
                      <Avatar className="h-8 w-8">
                        <AvatarImage src={candidate.imageUrl ?? undefined} />
                        <AvatarFallback>
                          {getInitials(displayName)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex flex-col">
                        <span className="text-sm font-medium">
                          {displayName}
                        </span>
                        <span className="font-mono text-xs text-muted-foreground">
                          {candidate.discordId}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No clippers found for that search.
              </p>
            ))}
        </div>
      </CardContent>
    </Card>
  );
};

export const CampaignCpmGroupsManager = ({
  campaignId,
}: CampaignCpmGroupsManagerProps) => {
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const {
    data: groups,
    isLoading,
    isError,
  } = trpc.campaigns.listCpmGroups.useQuery(
    { campaignId },
    { enabled: Boolean(campaignId) }
  );
  const createGroupMutation = trpc.campaigns.createCpmGroup.useMutation();

  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupRate, setNewGroupRate] = useState("");

  const handleCreateGroup = async () => {
    const name = newGroupName.trim();
    if (
      name.length < MIN_GROUP_NAME_CHARS ||
      name.length > MAX_GROUP_NAME_CHARS
    ) {
      toast({
        title: "Invalid group name",
        description: `Group name must be between ${MIN_GROUP_NAME_CHARS} and ${MAX_GROUP_NAME_CHARS} characters.`,
        variant: "destructive",
      });
      return;
    }

    const rateValue = Number(newGroupRate);
    if (!isValidRate(rateValue)) {
      toast({
        title: "Invalid rate",
        description: `Rate must be between $${MIN_CPM_PER_1000} and $${MAX_CPM_PER_1000} per 1000 views.`,
        variant: "destructive",
      });
      return;
    }

    try {
      await createGroupMutation.mutateAsync({
        campaignId,
        name,
        cpmPer1000: rateValue,
      });
      await utils.campaigns.listCpmGroups.invalidate({ campaignId });
      setNewGroupName("");
      setNewGroupRate("");
      toast({
        title: "Group created",
        description: `"${name}" pays $${rateValue.toFixed(4)} / 1000 views.`,
      });
    } catch (error) {
      toast({
        title: "Failed to create group",
        description:
          error instanceof Error ? error.message : "Something went wrong.",
        variant: "destructive",
      });
    }
  };

  const isCreateDisabled =
    !newGroupName.trim() ||
    !newGroupRate.trim() ||
    createGroupMutation.isPending;

  const hasGroups = (groups ?? []).length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>CPM Rate Groups</CardTitle>
        <CardDescription>
          Pay named groups of clippers a custom absolute rate on this campaign.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <p className="text-sm text-muted-foreground">
          Each group has one absolute rate that replaces the base rate, levels,
          and boosts for its members on all enabled platforms. Rate changes,
          adds, and removals apply to NEW views only — pending views are
          automatically paid out at the old rate first. All changes require a
          live campaign (paused campaigns must be reactivated first); once a
          campaign has ended, groups can only be cleaned up, not re-priced.
        </p>

        <div className="space-y-2">
          <Label>Create group</Label>
          <div className="grid gap-4 md:grid-cols-[2fr_1fr_auto]">
            <Input
              maxLength={MAX_GROUP_NAME_CHARS}
              placeholder='Group name, e.g. "Big Boys"'
              value={newGroupName}
              onChange={(event) => setNewGroupName(event.target.value)}
              disabled={createGroupMutation.isPending}
            />
            <Input
              type="number"
              min={MIN_CPM_PER_1000}
              max={MAX_CPM_PER_1000}
              step="0.01"
              placeholder="$ / 1000 views"
              value={newGroupRate}
              onChange={(event) => setNewGroupRate(event.target.value)}
              disabled={createGroupMutation.isPending}
            />
            <Button onClick={handleCreateGroup} disabled={isCreateDisabled}>
              {createGroupMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Plus className="mr-2 h-4 w-4" />
              )}
              Create group
            </Button>
          </div>
        </div>

        <div className="space-y-4">
          <Label>Existing groups</Label>
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading rate
              groups...
            </div>
          ) : isError ? (
            <p className="text-sm text-destructive">
              Failed to load rate groups — refresh the page to try again.
            </p>
          ) : hasGroups ? (
            <div className="space-y-4">
              {(groups ?? []).map((group) => (
                <CpmGroupCard
                  key={group.id}
                  campaignId={campaignId}
                  group={group}
                />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No rate groups yet. Create one above to get started.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
