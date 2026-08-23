import { useMemo, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const generateIdempotencyKey = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `reward-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const AdminRewards = () => {
  const { toast } = useToast();
  const utils = trpc.useUtils();

  const [selectedCampaignId, setSelectedCampaignId] = useState<string>("");
  const [idempotencyKey, setIdempotencyKey] = useState<string>(() =>
    generateIdempotencyKey()
  );
  const [lastRunResult, setLastRunResult] = useState<null | {
    successCount: number;
    failureCount: number;
    failedUserIdsSample: { userId: string; error: string }[];
  }>(null);

  const { data: campaigns, isLoading: isLoadingCampaigns } =
    trpc.campaigns.getAll.useQuery();

  const campaignOptions = useMemo(
    () =>
      (campaigns || []).map((campaign) => ({
        id: campaign.id,
        label: `${campaign.title || "Untitled campaign"} • ${
          campaign.submissionCount?.toLocaleString() ?? "0"
        } submissions`,
      })),
    [campaigns]
  );

  const createCampaignRewards =
    trpc.rewards.createCampaignViewsRewards.useMutation({
      async onSuccess(data) {
        setLastRunResult(data);

        toast({
          title: "Campaign rewards processed",
          description: `${data.successCount.toLocaleString()} users updated, ${data.failureCount.toLocaleString()} failed.`,
        });

        setIdempotencyKey(generateIdempotencyKey());
        await utils.invalidate();
      },
      onError(error) {
        toast({
          title: "Reward processing failed",
          description: error.message,
          variant: "destructive",
        });
      },
    });

  const isBulkRunning = createCampaignRewards.isPending;

  const handleRunCampaignRewards = async () => {
    if (!selectedCampaignId) {
      toast({
        title: "Select a campaign",
        description: "Choose a campaign before running the reward update.",
        variant: "destructive",
      });
      return;
    }

    const safeKey = idempotencyKey.trim() || generateIdempotencyKey();
    setIdempotencyKey(safeKey);

    await createCampaignRewards.mutateAsync({
      campaignId: selectedCampaignId,
      idempotencyKey: safeKey,
    });
  };

  const handleGenerateKey = () => {
    setIdempotencyKey(generateIdempotencyKey());
  };

  return (
    <AppLayout>
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <Card>
          <CardHeader className="space-y-2">
            <CardTitle className="flex items-center gap-2 text-xl">
              <Sparkles className="h-5 w-5" />
              Campaign View Rewards
            </CardTitle>
            <CardDescription>
              Select a campaign and run the view-reward processor to allocate
              rewards for approved submissions across each platform.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="space-y-2">
              <label
                htmlFor="campaign"
                className="text-sm font-medium text-muted-foreground"
              >
                Campaign
              </label>
              <Select
                value={selectedCampaignId}
                onValueChange={(value) => setSelectedCampaignId(value)}
                disabled={isLoadingCampaigns || isBulkRunning}
              >
                <SelectTrigger id="campaign">
                  <SelectValue
                    placeholder={
                      isLoadingCampaigns
                        ? "Loading campaigns..."
                        : "Select campaign"
                    }
                    className="flex-1"
                  />
                </SelectTrigger>
                <SelectContent>
                  {campaignOptions.length === 0 ? (
                    <SelectItem value="__no-campaigns" disabled>
                      {isLoadingCampaigns
                        ? "Loading campaigns..."
                        : "No campaigns available"}
                    </SelectItem>
                  ) : (
                    campaignOptions.map((option) => (
                      <SelectItem key={option.id} value={option.id}>
                        {option.label}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div className="flex flex-1 flex-col">
                <label
                  htmlFor="idempotency-key"
                  className="text-sm font-medium text-muted-foreground"
                >
                  Idempotency Key
                </label>
                <div className="mt-1 flex items-center gap-2">
                  <Input
                    id="idempotency-key"
                    value={idempotencyKey}
                    onChange={(event) => setIdempotencyKey(event.target.value)}
                    disabled={isBulkRunning}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleGenerateKey}
                    disabled={isBulkRunning}
                  >
                    Generate
                  </Button>
                </div>
              </div>

              <Button
                type="button"
                className="sm:w-auto"
                onClick={handleRunCampaignRewards}
                disabled={isBulkRunning || !selectedCampaignId}
              >
                {isBulkRunning ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Processing…
                  </span>
                ) : (
                  "Process rewards"
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        {lastRunResult && (
          <Card>
            <CardHeader className="space-y-1">
              <CardTitle>Last run summary</CardTitle>
              <CardDescription>
                {`${lastRunResult.successCount.toLocaleString()} succeeded • ${lastRunResult.failureCount.toLocaleString()} failed`}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {lastRunResult.failureCount > 0 ? (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">
                    Sample of failed users (up to 10):
                  </p>
                  <ul className="space-y-1">
                    {lastRunResult.failedUserIdsSample.map((item) => (
                      <li
                        key={item.userId}
                        className="rounded bg-muted p-2 text-xs font-mono"
                      >
                        <span className="font-semibold">{item.userId}</span>
                        {": "}
                        {item.error}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  All processed users succeeded.
                </p>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
};

export default AdminRewards;
