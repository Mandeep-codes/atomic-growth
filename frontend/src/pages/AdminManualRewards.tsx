import { useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { trpc } from "@/lib/trpc";
import { Loader2, UserRound } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RewardEligibleUserSelect } from "@/components/RewardEligibleUserSelect";
import {
  formatRewardEligibleUserLabel,
  type RewardEligibleUser,
} from "@/lib/rewardUsers";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";

const MIN_USER_SEARCH_CHARS = 2;

const AdminManualRewards = () => {
  const { toast } = useToast();
  const [selectedUserId, setSelectedUserId] = useState("");
  const [selectedUser, setSelectedUser] = useState<RewardEligibleUser | null>(
    null
  );
  const [userSearchInput, setUserSearchInput] = useState("");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("Thanks for the extra help!");
  const [campaignId, setCampaignId] = useState<string>("");
  const [countsTowardCampaign, setCountsTowardCampaign] = useState(true);

  const { data: campaignsList = [] } = trpc.campaigns.getAll.useQuery();

  const debouncedUserSearch = useDebouncedValue(userSearchInput, 400);
  const trimmedUserSearch = debouncedUserSearch.trim();
  const shouldFetchUsers = trimmedUserSearch.length >= MIN_USER_SEARCH_CHARS;
  const {
    data: searchedUsers = [],
    isFetching: isSearchingUsers,
    error: usersError,
  } = trpc.user.listUsers.useQuery(
    { query: trimmedUserSearch, limit: 20 },
    { enabled: shouldFetchUsers }
  );
  const rewardUsers = shouldFetchUsers ? searchedUsers : [];
  const usersErrorMessage =
    usersError && shouldFetchUsers ? "Failed to search users" : undefined;

  const createManualReward = trpc.rewards.createManualReward.useMutation({
    onSuccess: (result) => {
      toast({
        title: "Reward sent",
        description: `User balance is now $${result.newBalance.toFixed(2)}`,
      });
      setAmount("");
      setMemo("Thanks for the extra help!");
    },
    onError: (error) => {
      toast({
        title: "Unable to create reward",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedUserId) {
      toast({
        title: "Choose a recipient",
        description: "Pick the user receiving this reward.",
        variant: "destructive",
      });
      return;
    }

    const parsedAmount = Number(amount);

    await createManualReward.mutateAsync({
      userId: selectedUserId,
      amount: parsedAmount,
      memo,
      campaignId: campaignId || undefined,
      countsTowardCampaign,
    });
  };

  const isSubmitting = createManualReward.isPending;

  return (
    <AppLayout>
      <div className="mx-auto max-w-3xl px-6 py-8 space-y-6">
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold text-foreground">
            Ad hoc rewards
          </h1>
          <p className="text-muted-foreground">
            Credit a user’s balance manually for exceptions, bonuses, or quick
            fixes. Entries are tracked alongside automated rewards.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Issue a manual reward</CardTitle>
            <CardDescription>
              Choose the recipient, set an amount, and add a short memo for
              auditing.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-6" onSubmit={handleSubmit}>
              <div className="space-y-2">
                <Label>Recipient</Label>
                <div>
                  <RewardEligibleUserSelect
                    users={rewardUsers}
                    value={selectedUserId}
                    onValueChange={setSelectedUserId}
                    disabled={isSubmitting}
                    onUserSelected={(user) => {
                      setSelectedUser(user);
                      setUserSearchInput("");
                    }}
                    selectedUser={selectedUser}
                    searchQuery={userSearchInput}
                    onSearchQueryChange={setUserSearchInput}
                    isSearching={isSearchingUsers}
                    minSearchChars={MIN_USER_SEARCH_CHARS}
                    errorMessage={usersErrorMessage}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Need someone new? They must sign in with Discord at least once
                  before rewards can be manually issued.
                </p>
              </div>

              {selectedUser && (
                <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
                  <div className="flex items-center gap-2 text-foreground">
                    <UserRound className="h-4 w-4" />
                    <span className="font-medium">
                      {formatRewardEligibleUserLabel(selectedUser)}
                    </span>
                  </div>
                  {selectedUser.email && (
                    <p className="mt-1 text-xs">{selectedUser.email}</p>
                  )}
                  <p className="mt-2 text-xs">
                    This reward will post as a manual adjustment and counts
                    toward their total earnings.
                  </p>
                </div>
              )}

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="amount">Amount (USD)</Label>
                  <Input
                    id="amount"
                    type="number"
                    step="0.01"
                    placeholder="50"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    disabled={isSubmitting}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Currency</Label>
                  <Input value="USD" disabled className="bg-muted/60" />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Campaign (optional)</Label>
                <Select
                  value={campaignId || "none"}
                  onValueChange={(value) =>
                    setCampaignId(value === "none" ? "" : value)
                  }
                  disabled={isSubmitting}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="No campaign" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No campaign</SelectItem>
                    {campaignsList.map((campaign) => (
                      <SelectItem key={campaign.id} value={campaign.id}>
                        {campaign.title ?? campaign.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex items-center gap-2 pt-1">
                  <Checkbox
                    id="counts-toward-campaign"
                    checked={Boolean(campaignId) && countsTowardCampaign}
                    disabled={isSubmitting || !campaignId}
                    onCheckedChange={(checked) =>
                      setCountsTowardCampaign(checked === true)
                    }
                  />
                  <Label
                    htmlFor="counts-toward-campaign"
                    className="text-sm font-normal text-muted-foreground"
                  >
                    Counts toward campaign budget (adds to the campaign's
                    achieved meter — negative amounts subtract)
                  </Label>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="memo">Memo</Label>
                <Textarea
                  id="memo"
                  rows={3}
                  value={memo}
                  onChange={(event) => setMemo(event.target.value)}
                  placeholder="Why is this reward being issued?"
                  disabled={isSubmitting}
                />
                <p className="text-xs text-muted-foreground">
                  Appears on the balance entry for future auditing.
                </p>
              </div>

              <div className="flex justify-end">
                <Button
                  type="submit"
                  disabled={isSubmitting || !selectedUserId}
                >
                  {isSubmitting ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Sending…
                    </span>
                  ) : (
                    "Issue reward"
                  )}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
};

export default AdminManualRewards;
