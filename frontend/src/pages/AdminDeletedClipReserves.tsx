import { useMemo, useState } from "react";
import {
  Loader2,
  Trash2,
  ExternalLink,
  Wallet,
  Instagram,
  Music2,
  Twitter,
  Youtube,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../backend/src/routers";

type RouterOutput = inferRouterOutputs<AppRouter>;
type Reserve =
  RouterOutput["clipperActivity"]["listDeletedClipReserves"][number];

const platformIcons: Record<string, LucideIcon> = {
  instagram: Instagram,
  youtube: Youtube,
  tiktok: Music2,
  x: Twitter,
};

const money = (n: number) =>
  `$${Number(n ?? 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const compactViews = (n: number) =>
  new Intl.NumberFormat("en-US", { notation: "compact" }).format(n ?? 0);

const clipperLabel = (r: {
  username: string | null;
  name: string | null;
  userId: string;
}) => r.username || r.name || r.userId;

export default function AdminDeletedClipReserves() {
  const { toast } = useToast();
  const [showAll, setShowAll] = useState(false);
  const [collecting, setCollecting] = useState<Reserve | null>(null);
  const [amountInput, setAmountInput] = useState("");

  const reservesQuery = trpc.clipperActivity.listDeletedClipReserves.useQuery({
    status: showAll ? "all" : "outstanding",
  });

  const collectMutation =
    trpc.clipperActivity.collectDeletedClipReserve.useMutation({
      onSuccess: (res) => {
        toast({
          title: `Collected ${money(res.collected)}`,
          description: res.fullyRecovered
            ? "Reserve fully recovered and closed."
            : `${money(res.remaining)} still outstanding.`,
        });
        setCollecting(null);
        setAmountInput("");
        reservesQuery.refetch();
      },
      onError: (e) =>
        toast({
          title: "Couldn't collect",
          description: e.message,
          variant: "destructive",
        }),
    });

  const reserves = reservesQuery.data ?? [];
  const totalOutstanding = useMemo(
    () =>
      reserves
        .filter((r) => r.status === "outstanding")
        .reduce((sum, r) => sum + r.remaining, 0),
    [reserves]
  );

  const openCollect = (reserve: Reserve) => {
    setCollecting(reserve);
    // Default the amount to whatever is collectable right now.
    setAmountInput(reserve.collectableNow ? String(reserve.collectableNow) : "");
  };

  const maxCollectable = collecting?.collectableNow ?? 0;
  const amountNum = Number(amountInput);
  const amountValid =
    Number.isFinite(amountNum) && amountNum > 0 && amountNum <= maxCollectable;

  return (
    <AppLayout>
      <div className="min-h-screen bg-muted/40 py-10 px-4">
        <div className="mx-auto flex max-w-6xl flex-col gap-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1">
              <p className="text-sm uppercase tracking-wide text-muted-foreground">
                Admin • Clipper Activity
              </p>
              <h1 className="flex items-center gap-2 text-3xl font-semibold">
                <Trash2 className="h-7 w-7" /> Deleted clip reserves
              </h1>
              <p className="max-w-2xl text-muted-foreground">
                When a deleted reel's clawback was more than the clipper's
                wallet held, we took what was there and reserved the rest here.
                Collect the remainder once they've earned more — any amount up
                to what their wallet currently holds.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="rounded-lg border bg-background px-4 py-2 text-right">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Outstanding
                </p>
                <p className="text-xl font-semibold">
                  {money(totalOutstanding)}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowAll((v) => !v)}
              >
                {showAll ? "Show outstanding only" : "Show all history"}
              </Button>
            </div>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Reserves</CardTitle>
              <CardDescription>
                Newest first. "Collect" is disabled when the wallet is empty.
              </CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {reservesQuery.isLoading ? (
                <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" /> Loading reserves…
                </div>
              ) : reserves.length === 0 ? (
                <p className="py-16 text-center text-muted-foreground">
                  🎉 No {showAll ? "" : "outstanding "}deleted-clip reserves.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Clipper</TableHead>
                      <TableHead>Reel</TableHead>
                      <TableHead className="text-right">Views</TableHead>
                      <TableHead className="text-right">Owed</TableHead>
                      <TableHead className="text-right">Clawed</TableHead>
                      <TableHead className="text-right">Remaining</TableHead>
                      <TableHead className="text-right">Wallet</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {reserves.map((r) => {
                      const Icon =
                        platformIcons[r.platform ?? ""] ?? Music2;
                      return (
                        <TableRow key={r.id}>
                          <TableCell className="font-medium">
                            {clipperLabel(r)}
                            <p className="text-xs text-muted-foreground">
                              {r.campaignTitle ?? "campaign"}
                            </p>
                          </TableCell>
                          <TableCell>
                            {r.url ? (
                              <a
                                href={r.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-primary hover:underline"
                              >
                                <Icon className="h-4 w-4" /> open
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {compactViews(r.views)}
                          </TableCell>
                          <TableCell className="text-right">
                            {money(r.totalOwed)}
                          </TableCell>
                          <TableCell className="text-right text-muted-foreground">
                            {money(r.clawedAmount)}
                          </TableCell>
                          <TableCell className="text-right font-semibold">
                            {r.status === "outstanding" ? (
                              money(r.remaining)
                            ) : (
                              <Badge
                                className={
                                  r.status === "recovered"
                                    ? "bg-emerald-100 text-emerald-800"
                                    : "bg-muted text-muted-foreground"
                                }
                              >
                                {r.status}
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {money(r.walletBalance)}
                          </TableCell>
                          <TableCell className="text-right">
                            {r.status === "outstanding" && (
                              <Button
                                size="sm"
                                disabled={r.collectableNow <= 0}
                                title={
                                  r.collectableNow <= 0
                                    ? "Wallet empty — wait for them to earn"
                                    : undefined
                                }
                                onClick={() => openCollect(r)}
                              >
                                <Wallet className="mr-2 h-4 w-4" /> Take money
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Collect dialog */}
      <Dialog
        open={Boolean(collecting)}
        onOpenChange={(open) => {
          if (!open) {
            setCollecting(null);
            setAmountInput("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Collect deleted-clip debt</DialogTitle>
          </DialogHeader>
          {collecting && (
            <div className="space-y-4">
              <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                <p>
                  <span className="font-medium">
                    {clipperLabel(collecting)}
                  </span>
                  's deleted reel had{" "}
                  <span className="font-medium">
                    {compactViews(collecting.views)} views
                  </span>{" "}
                  and owed <span className="font-medium">
                    {money(collecting.totalOwed)}
                  </span>
                  . {money(collecting.clawedAmount)} has been clawed so far,
                  leaving{" "}
                  <span className="font-medium">
                    {money(collecting.remaining)}
                  </span>{" "}
                  outstanding.
                </p>
                {collecting.url && (
                  <a
                    href={collecting.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    View the reel <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Amount to take now</label>
                <Input
                  type="number"
                  min={0}
                  max={maxCollectable}
                  step="0.01"
                  value={amountInput}
                  onChange={(e) => setAmountInput(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Max collectable right now: {money(maxCollectable)} (their
                  wallet holds {money(collecting.walletBalance)}). Taking money
                  never pushes the wallet below zero.
                </p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setCollecting(null);
                setAmountInput("");
              }}
            >
              Cancel
            </Button>
            <Button
              disabled={!amountValid || collectMutation.isPending}
              onClick={() =>
                collecting &&
                collectMutation.mutate({
                  reserveId: collecting.id,
                  amount: Number(amountNum.toFixed(2)),
                })
              }
            >
              {collectMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Wallet className="mr-2 h-4 w-4" />
              )}
              Take {amountValid ? money(amountNum) : "money"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
