import { AppLayout } from "@/components/AppLayout";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { trpc } from "@/lib/trpc";
import { Loader2 } from "lucide-react";

const fmtPct = (n: number) => `${n.toFixed(1)}%`;

const AdminUSDemographics = () => {
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const { data: access, isLoading: accessLoading } =
    trpc.demographicsVerification.getUsDemographicsAccess.useQuery();
  const isOwner = access?.isOwner === true;
  const { data: campaigns, isLoading } =
    trpc.demographicsVerification.getUsDemographicsOverview.useQuery(undefined, {
      enabled: isOwner,
    });
  const setMethod =
    trpc.demographicsVerification.setCampaignDemographicsMethod.useMutation({
      onSuccess: async () => {
        await utils.demographicsVerification.getUsDemographicsOverview.invalidate();
      },
      onError: (error) => {
        toast({
          title: "Couldn't change the method",
          description: error.message,
          variant: "destructive",
        });
      },
    });

  const handleToggle = (campaignId: string, useOldMethod: boolean) => {
    setMethod.mutate(
      { campaignId, useOldMethod },
      {
        onSuccess: (res) => {
          toast({
            title: useOldMethod
              ? "Switched to old method (inflated)"
              : "Switched to new method (accurate)",
            description: `US now shows ${fmtPct(res.usPct)} for this campaign.`,
          });
        },
      }
    );
  };

  if (accessLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center gap-2 py-24 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      </AppLayout>
    );
  }

  if (!isOwner) {
    return (
      <AppLayout>
        <div className="mx-auto max-w-md px-6 py-24 text-center space-y-2">
          <h1 className="text-2xl font-semibold text-foreground">Restricted</h1>
          <p className="text-muted-foreground">
            This panel isn't available to your account.
          </p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="mx-auto max-w-4xl px-6 py-8 space-y-6">
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold text-foreground">
            US Demographics
          </h1>
          <p className="text-muted-foreground">
            Switch a campaign's demographic calculation between the new method
            and the old method, and see how the percentages change.
          </p>
        </div>

        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-700 dark:text-amber-300">
          The <strong>old method</strong> excludes the uncalculated ("Other")
          audience and re-normalizes the named countries to 100%, so every
          named country — including the US — reads higher than reality. The{" "}
          <strong>new method</strong> (default) keeps "Other" in the
          denominator and reflects the real share. Whatever you pick here is
          what the campaign's dashboard shows to the client.
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading campaigns…
          </div>
        ) : !campaigns || campaigns.length === 0 ? (
          <div className="rounded-lg border p-8 text-center text-sm text-muted-foreground">
            No campaigns to configure.
          </div>
        ) : (
          <div className="space-y-4">
            {campaigns.map((c) => {
              const activeUS = c.useOldMethod
                ? c.oldMethod.usPct
                : c.newMethod.usPct;
              const delta = c.oldMethod.usPct - c.newMethod.usPct;
              return (
                <Card key={c.campaignId}>
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <CardTitle className="text-lg flex items-center gap-2">
                          {c.title ?? "Untitled campaign"}
                          {c.ended ? (
                            <Badge variant="secondary" className="font-normal">
                              Ended
                            </Badge>
                          ) : null}
                        </CardTitle>
                        <CardDescription>
                          {c.measuredClippers} clipper
                          {c.measuredClippers === 1 ? "" : "s"} with demographic
                          data
                        </CardDescription>
                      </div>
                      <div className="text-right">
                        <div className="text-2xl font-semibold">
                          {fmtPct(activeUS)}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          US · showing to client
                        </div>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap items-center justify-between gap-4">
                      <div className="flex items-center gap-3 text-sm">
                        <span
                          className={
                            c.useOldMethod
                              ? "text-muted-foreground"
                              : "font-medium text-foreground"
                          }
                        >
                          New {fmtPct(c.newMethod.usPct)}
                        </span>
                        <span className="text-muted-foreground">→</span>
                        <span
                          className={
                            c.useOldMethod
                              ? "font-medium text-foreground"
                              : "text-muted-foreground"
                          }
                        >
                          Old {fmtPct(c.oldMethod.usPct)}
                        </span>
                        <Badge variant="secondary">
                          {delta >= 0 ? "+" : ""}
                          {delta.toFixed(1)} pts
                        </Badge>
                      </div>

                      <div className="flex items-center gap-2">
                        <Label
                          htmlFor={`old-${c.campaignId}`}
                          className="text-sm font-normal text-muted-foreground"
                        >
                          Use old method (inflated)
                        </Label>
                        <Switch
                          id={`old-${c.campaignId}`}
                          checked={c.useOldMethod}
                          disabled={setMethod.isPending}
                          onCheckedChange={(checked) =>
                            handleToggle(c.campaignId, checked)
                          }
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </AppLayout>
  );
};

export default AdminUSDemographics;
