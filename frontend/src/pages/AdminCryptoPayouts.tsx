import { useMemo, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { trpc } from "@/lib/trpc";
import { useToast } from "@/hooks/use-toast";
import { Coins, Download, FolderPlus, Loader2 } from "lucide-react";

type PayoutRow = {
  withdrawalId: string;
  userId: string;
  amount: number;
  npCurrency: string;
  address: string;
  memo: string | null;
  status: string;
  network: string;
  asset: string;
  paid: boolean;
  userEmail: string | null;
  userDiscordUsername: string | null;
  userFirstName: string | null;
  userLastName: string | null;
};

const usd = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    n
  );

const clipperName = (r: PayoutRow) =>
  r.userDiscordUsername ||
  [r.userFirstName, r.userLastName].filter(Boolean).join(" ") ||
  r.userEmail ||
  r.userId;

const csvEscape = (v: string | number | null | undefined) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// One CSV row per payout — everything an admin needs to send the crypto by hand.
const rowsToCsv = (rows: PayoutRow[]) => {
  const header = [
    "clipper",
    "discord_id",
    "email",
    "amount_usd",
    "asset",
    "network",
    "wallet_address",
    "memo_tag",
    "paid",
  ];
  const lines = rows.map((r) =>
    [
      clipperName(r),
      r.userId,
      r.userEmail,
      r.amount.toFixed(2),
      r.asset,
      r.network,
      r.address,
      r.memo,
      r.paid ? "yes" : "no",
    ]
      .map(csvEscape)
      .join(",")
  );
  return [header.join(","), ...lines].join("\n");
};

const downloadCsv = (filename: string, csv: string) => {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

const AdminCryptoPayouts = () => {
  const { toast } = useToast();
  const utils = trpc.useUtils();

  const candidatesQuery = trpc.cryptoPayouts.getPayoutCandidates.useQuery();
  const batchesQuery = trpc.cryptoPayouts.listBatches.useQuery();

  const createBatch = trpc.cryptoPayouts.createBatch.useMutation();
  const markPaid = trpc.cryptoPayouts.markPaid.useMutation();
  const markUnpaid = trpc.cryptoPayouts.markUnpaid.useMutation();
  const returnToBalance =
    trpc.cryptoPayouts.returnWithdrawalToBalance.useMutation();
  const removeFromBatch = trpc.cryptoPayouts.removeFromBatch.useMutation();
  const renameBatch = trpc.cryptoPayouts.renameBatch.useMutation();
  const deleteBatch = trpc.cryptoPayouts.deleteBatch.useMutation();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchDialogOpen, setBatchDialogOpen] = useState(false);
  const [batchTitle, setBatchTitle] = useState("");

  const candidates = (candidatesQuery.data ?? []) as PayoutRow[];
  const batches = batchesQuery.data ?? [];

  const refetchAll = async () => {
    await Promise.all([
      utils.cryptoPayouts.getPayoutCandidates.invalidate(),
      utils.cryptoPayouts.listBatches.invalidate(),
    ]);
  };

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const selectedRows = useMemo(
    () => candidates.filter((r) => selected.has(r.withdrawalId)),
    [candidates, selected]
  );
  const selectedTotal = selectedRows.reduce((s, r) => s + r.amount, 0);

  const handleCreateBatch = async () => {
    if (!batchTitle.trim() || selected.size === 0) return;
    try {
      await createBatch.mutateAsync({
        batchTitle: batchTitle.trim(),
        withdrawalIds: [...selected],
      });
      setBatchDialogOpen(false);
      setBatchTitle("");
      setSelected(new Set());
      await refetchAll();
      toast({ title: "Batch created" });
    } catch (e) {
      toast({
        title: "Couldn't create batch",
        description: e instanceof Error ? e.message : undefined,
        variant: "destructive",
      });
    }
  };

  const act = async (fn: () => Promise<unknown>, okTitle: string) => {
    try {
      await fn();
      await refetchAll();
      toast({ title: okTitle });
    } catch (e) {
      toast({
        title: "Action failed",
        description: e instanceof Error ? e.message : undefined,
        variant: "destructive",
      });
    }
  };

  const RowActions = ({ r, inBatch }: { r: PayoutRow; inBatch: boolean }) => (
    <div className="flex flex-wrap justify-end gap-1">
      {r.paid ? (
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            act(
              () => markUnpaid.mutateAsync({ withdrawalId: r.withdrawalId }),
              "Marked unpaid"
            )
          }
        >
          Unmark paid
        </Button>
      ) : (
        <Button
          size="sm"
          onClick={() =>
            act(
              () => markPaid.mutateAsync({ withdrawalId: r.withdrawalId }),
              "Marked paid"
            )
          }
        >
          Mark paid
        </Button>
      )}
      {inBatch ? (
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            act(
              () =>
                removeFromBatch.mutateAsync({ withdrawalId: r.withdrawalId }),
              "Removed from batch"
            )
          }
        >
          Remove
        </Button>
      ) : (
        !r.paid && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              act(
                () =>
                  returnToBalance.mutateAsync({
                    withdrawalId: r.withdrawalId,
                  }),
                "Returned to balance"
              )
            }
          >
            Return
          </Button>
        )
      )}
    </div>
  );

  const PayoutTable = ({
    rows,
    selectable,
  }: {
    rows: PayoutRow[];
    selectable: boolean;
  }) => (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            {selectable && <TableHead className="w-8" />}
            <TableHead>Clipper</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead>Coin</TableHead>
            <TableHead>Network</TableHead>
            <TableHead>Wallet address</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.withdrawalId}>
              {selectable && (
                <TableCell>
                  <Checkbox
                    checked={selected.has(r.withdrawalId)}
                    onCheckedChange={() => toggle(r.withdrawalId)}
                  />
                </TableCell>
              )}
              <TableCell className="font-medium">{clipperName(r)}</TableCell>
              <TableCell className="text-right font-semibold">
                {usd(r.amount)}
              </TableCell>
              <TableCell>{r.asset}</TableCell>
              <TableCell className="text-xs">{r.network}</TableCell>
              <TableCell className="max-w-[220px] truncate font-mono text-xs">
                {r.address}
                {r.memo ? ` (memo: ${r.memo})` : ""}
              </TableCell>
              <TableCell>
                {r.paid ? (
                  <Badge className="bg-emerald-500/15 text-emerald-600">
                    Paid
                  </Badge>
                ) : (
                  <Badge variant="outline">Unpaid</Badge>
                )}
              </TableCell>
              <TableCell>
                <RowActions r={r} inBatch={!selectable} />
              </TableCell>
            </TableRow>
          ))}
          {rows.length === 0 && (
            <TableRow>
              <TableCell
                colSpan={selectable ? 8 : 7}
                className="py-6 text-center text-sm text-muted-foreground"
              >
                Nothing here.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );

  const isLoading = candidatesQuery.isLoading || batchesQuery.isLoading;

  return (
    <AppLayout>
      <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Coins className="h-6 w-6" /> Crypto Payouts
          </h1>
          <p className="text-sm text-muted-foreground">
            Every crypto claim to pay out by hand — amount, coin, network and
            wallet address. Group them into labelled batches and tag each as
            paid once you've sent it.
          </p>
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" /> Loading…
          </div>
        ) : (
          <>
            {/* Main list — unbatched claims */}
            <Card>
              <CardHeader>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <CardTitle>To pay ({candidates.length})</CardTitle>
                    <CardDescription>
                      {selected.size > 0
                        ? `${selected.size} selected — ${usd(selectedTotal)}`
                        : "Select rows to group them into a batch."}
                    </CardDescription>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={candidates.length === 0}
                      onClick={() =>
                        downloadCsv("crypto-payouts.csv", rowsToCsv(candidates))
                      }
                    >
                      <Download className="mr-2 h-4 w-4" /> CSV
                    </Button>
                    <Button
                      size="sm"
                      disabled={selected.size === 0}
                      onClick={() => setBatchDialogOpen(true)}
                    >
                      <FolderPlus className="mr-2 h-4 w-4" /> Batch selected
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <PayoutTable rows={candidates} selectable />
              </CardContent>
            </Card>

            {/* Batch folders */}
            <Card>
              <CardHeader>
                <CardTitle>Batches ({batches.length})</CardTitle>
                <CardDescription>
                  Batched claims live only inside their folder.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {batches.length === 0 ? (
                  <p className="py-4 text-sm text-muted-foreground">
                    No batches yet.
                  </p>
                ) : (
                  <Accordion type="multiple" className="w-full">
                    {batches.map((b) => (
                      <AccordionItem key={b.id} value={b.id}>
                        <AccordionTrigger>
                          <span className="flex flex-1 items-center gap-2 pr-4 text-left">
                            <span className="font-semibold">{b.title}</span>
                            <Badge variant="secondary">
                              {b.count} · {usd(b.totalAmount)}
                            </Badge>
                            {b.allPaid && (
                              <Badge className="bg-emerald-500/15 text-emerald-600">
                                All paid
                              </Badge>
                            )}
                          </span>
                        </AccordionTrigger>
                        <AccordionContent>
                          <div className="mb-3 flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                // Banned clippers are dropped from the export.
                                // A batch can only contain one if it was filed
                                // BEFORE the ban; this CSV is what gets used to
                                // send crypto by hand, so it must not carry
                                // them. The row stays visible in the panel
                                // (greyed) so it can still be reconciled.
                                const payable = (b.items as PayoutRow[]).filter(
                                  (i) => !(i as { userBanned?: boolean }).userBanned
                                );
                                const excluded = b.items.length - payable.length;
                                if (excluded > 0) {
                                  toast({
                                    variant: "destructive",
                                    title: `${excluded} banned clipper(s) left out`,
                                    description:
                                      "They are shown in the batch but excluded from the CSV. Do not send them.",
                                  });
                                }
                                downloadCsv(
                                  `crypto-batch-${b.title}.csv`,
                                  rowsToCsv(payable)
                                );
                              }}
                            >
                              <Download className="mr-2 h-4 w-4" /> CSV
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                const t = window.prompt("Rename batch", b.title);
                                if (t && t.trim())
                                  act(
                                    () =>
                                      renameBatch.mutateAsync({
                                        batchId: b.id,
                                        title: t.trim(),
                                      }),
                                    "Batch renamed"
                                  );
                              }}
                            >
                              Rename
                            </Button>
                            {b.count === 0 && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() =>
                                  act(
                                    () =>
                                      deleteBatch.mutateAsync({ batchId: b.id }),
                                    "Batch deleted"
                                  )
                                }
                              >
                                Delete empty batch
                              </Button>
                            )}
                          </div>
                          <PayoutTable
                            rows={b.items as PayoutRow[]}
                            selectable={false}
                          />
                        </AccordionContent>
                      </AccordionItem>
                    ))}
                  </Accordion>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>

      <Dialog open={batchDialogOpen} onOpenChange={setBatchDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create a batch</DialogTitle>
            <DialogDescription>
              {selected.size} claim(s) · {usd(selectedTotal)}. They'll move out
              of the main list into this folder.
            </DialogDescription>
          </DialogHeader>
          <Input
            placeholder="Batch label (e.g. Sunday crypto — Jul 12)"
            value={batchTitle}
            onChange={(e) => setBatchTitle(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setBatchDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreateBatch}
              disabled={!batchTitle.trim() || createBatch.isPending}
            >
              {createBatch.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Create batch
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
};

export default AdminCryptoPayouts;
