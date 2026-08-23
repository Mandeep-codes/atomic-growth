import { useMemo, useState } from "react";
import {
  Loader2,
  AlertTriangle,
  UserX,
  RotateCcw,
  Clock,
} from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

const clipperLabel = (c: {
  username: string | null;
  name: string | null;
  userId: string;
}) => c.username || c.name || c.userId;

export default function AdminClipperActivity() {
  const { toast } = useToast();
  const [campaignId, setCampaignId] = useState<string | null>(null);

  const campaignsQuery = trpc.clipperActivity.listActiveCampaigns.useQuery();
  const activityQuery = trpc.clipperActivity.getActivity.useQuery(
    { campaignId: campaignId ?? "" },
    { enabled: Boolean(campaignId) }
  );

  const suspendMutation = trpc.clipperActivity.suspend.useMutation({
    onSuccess: () => {
      toast({ title: "Clipper suspended from campaign" });
      activityQuery.refetch();
    },
    onError: (e) =>
      toast({ title: "Failed to suspend", description: e.message, variant: "destructive" }),
  });
  const unsuspendMutation = trpc.clipperActivity.unsuspend.useMutation({
    onSuccess: () => {
      toast({ title: "Clipper reinstated" });
      activityQuery.refetch();
    },
    onError: (e) =>
      toast({ title: "Failed to reinstate", description: e.message, variant: "destructive" }),
  });
  const grantGraceMutation = trpc.clipperActivity.grantGrace.useMutation({
    onSuccess: (result) => {
      if (!result.granted) {
        toast({
          title:
            result.reason === "already-suspended"
              ? "Clipper is suspended — reinstate them instead"
              : "Clipper is already on a grace week",
          variant: "destructive",
        });
      } else if (result.dmSent) {
        toast({
          title: "Grace week granted",
          description:
            "The final warning was sent to them on Discord and in the app.",
        });
      } else {
        // The grace still stands — only the DM failed (DMs closed, bot not in
        // their server, token unset). The mod has to deliver it by hand.
        toast({
          title: "Grace granted — Discord DM failed",
          description:
            "They got the in-app final warning, but the DM didn't go through. Please warn them on Discord manually.",
          variant: "destructive",
        });
      }
      activityQuery.refetch();
    },
    onError: (e) =>
      toast({
        title: "Failed to grant grace",
        description: e.message,
        variant: "destructive",
      }),
  });

  const data = activityQuery.data;
  const inactive = useMemo(
    () => (data?.clippers ?? []).filter((c) => c.isInactive),
    [data]
  );

  const handleSuspend = (userId: string) => {
    if (!campaignId || !data) return;
    suspendMutation.mutate({
      campaignId,
      userId,
      inactiveWeekStart: new Date(data.lastCompletedWeek.weekStart),
      inactiveWeekEnd: new Date(data.lastCompletedWeek.weekEnd),
      reason: `No clips posted during the week of ${data.lastCompletedWeek.label}`,
    });
  };

  const handleGrantGrace = (userId: string) => {
    if (!campaignId || !data) return;
    grantGraceMutation.mutate({
      campaignId,
      userId,
      inactiveWeekStart: new Date(data.lastCompletedWeek.weekStart),
      inactiveWeekEnd: new Date(data.lastCompletedWeek.weekEnd),
      note: `Inactive during the week of ${data.lastCompletedWeek.label} — final warning issued`,
    });
  };

  const formatGraceDate = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        })
      : "";

  return (
    <AppLayout>
      <div className="min-h-screen bg-muted/40 py-10 px-4">
        <div className="mx-auto flex max-w-6xl flex-col gap-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1">
              <p className="text-sm uppercase tracking-wide text-muted-foreground">
                Admin • Clipper Activity
              </p>
              <h1 className="text-3xl font-semibold">Clipper activity</h1>
              <p className="text-muted-foreground">
                Weekly posting activity per campaign. Suspend clippers who go a
                full Mon–Sun week without posting (this campaign only), or give
                them one more week's grace with a final warning.
              </p>
            </div>
            <Select
              value={campaignId ?? undefined}
              onValueChange={(v) => setCampaignId(v)}
            >
              <SelectTrigger className="w-full sm:w-[280px]">
                <SelectValue placeholder="Select an active campaign" />
              </SelectTrigger>
              <SelectContent>
                {(campaignsQuery.data ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {!campaignId ? (
            <Card>
              <CardContent className="py-16 text-center text-muted-foreground">
                Pick an active campaign to see its clipper activity.
              </CardContent>
            </Card>
          ) : activityQuery.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-20 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" /> Loading activity…
            </div>
          ) : activityQuery.isError ? (
            <Card>
              <CardContent className="py-16 text-center text-muted-foreground">
                {activityQuery.error?.message ??
                  "Could not load activity for this campaign."}
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Inactive / suspendable */}
              <Card className="border-amber-300/60">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-amber-700">
                    <AlertTriangle className="h-5 w-5" />
                    Inactive last week — eligible to suspend ({inactive.length})
                  </CardTitle>
                  <CardDescription>
                    Posted before but had{" "}
                    <strong>zero clips during {data?.lastCompletedWeek.label}</strong>{" "}
                    (the last completed Mon–Sun week).
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {inactive.length === 0 ? (
                    <p className="py-6 text-center text-muted-foreground">
                      🎉 Everyone active this campaign posted last week.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {inactive.map((c) => (
                        <div
                          key={c.userId}
                          className="flex items-center justify-between rounded-lg border bg-background p-3"
                        >
                          <div>
                            <p className="font-medium">{clipperLabel(c)}</p>
                            <p className="text-xs text-muted-foreground">
                              {c.totalClips} total clips • last posted{" "}
                              {new Date(c.lastClipAt).toLocaleDateString()}
                            </p>
                          </div>
                          <div className="flex gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              className="border-amber-400 text-amber-700 hover:bg-amber-50"
                              disabled={grantGraceMutation.isPending}
                              onClick={() => handleGrantGrace(c.userId)}
                            >
                              <Clock className="mr-2 h-4 w-4" /> 1 week grace
                            </Button>
                            <Button
                              variant="destructive"
                              size="sm"
                              disabled={suspendMutation.isPending}
                              onClick={() => handleSuspend(c.userId)}
                            >
                              <UserX className="mr-2 h-4 w-4" /> Suspend
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Full weekly activity */}
              <Card>
                <CardHeader>
                  <CardTitle>Weekly activity — last 6 weeks</CardTitle>
                  <CardDescription>
                    Most active clippers first. Numbers are clips posted that
                    week.
                  </CardDescription>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Clipper</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                        {(data?.weeks ?? []).map((w) => (
                          <TableHead key={w.weekStart} className="text-right">
                            {w.label}
                            {w.isCurrent ? " (now)" : ""}
                          </TableHead>
                        ))}
                        <TableHead>Status</TableHead>
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(data?.clippers ?? []).map((c) => (
                        <TableRow key={c.userId}>
                          <TableCell className="font-medium">
                            {clipperLabel(c)}
                          </TableCell>
                          <TableCell className="text-right">
                            {c.totalClips}
                          </TableCell>
                          {(data?.weeks ?? []).map((w) => {
                            const n = c.clipsByWeek[w.weekStart] ?? 0;
                            return (
                              <TableCell
                                key={w.weekStart}
                                className={`text-right ${
                                  n === 0 ? "text-muted-foreground/40" : ""
                                }`}
                              >
                                {n || "·"}
                              </TableCell>
                            );
                          })}
                          <TableCell>
                            {c.isSuspended ? (
                              <Badge variant="destructive">Suspended</Badge>
                            ) : c.isOnGrace ? (
                              <Badge className="bg-sky-100 text-sky-800">
                                Grace until {formatGraceDate(c.graceExpiresAt)}
                              </Badge>
                            ) : c.isInactive ? (
                              <Badge className="bg-amber-100 text-amber-800">
                                Inactive
                              </Badge>
                            ) : (
                              <Badge className="bg-emerald-100 text-emerald-800">
                                Active
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {c.isSuspended ? (
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={unsuspendMutation.isPending}
                                onClick={() =>
                                  campaignId &&
                                  unsuspendMutation.mutate({
                                    campaignId,
                                    userId: c.userId,
                                  })
                                }
                              >
                                <RotateCcw className="mr-2 h-4 w-4" /> Reinstate
                              </Button>
                            ) : c.isInactive ? (
                              <div className="flex justify-end gap-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="border-amber-400 text-amber-700 hover:bg-amber-50"
                                  disabled={grantGraceMutation.isPending}
                                  onClick={() => handleGrantGrace(c.userId)}
                                >
                                  <Clock className="mr-2 h-4 w-4" /> Grace
                                </Button>
                                <Button
                                  variant="destructive"
                                  size="sm"
                                  disabled={suspendMutation.isPending}
                                  onClick={() => handleSuspend(c.userId)}
                                >
                                  Suspend
                                </Button>
                              </div>
                            ) : null}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
