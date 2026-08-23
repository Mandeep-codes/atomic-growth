import { useEffect, useMemo, useState } from "react";
import {
  Loader2,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  CheckSquare,
  Undo2,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AppLayout } from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { useToast } from "@/hooks/use-toast";

const currencyFormat = (value: number, currency = "USD") =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(value);

interface SelectionState {
  [userId: string]: {
    amount: number;
    recipientRecordId: string;
  };
}

const PAGE_SIZE = 20;

const fuzzyMatch = (query: string, value: string) => {
  if (!query) {
    return true;
  }
  if (!value) {
    return false;
  }
  if (value.includes(query)) {
    return true;
  }
  let matchIndex = 0;
  for (let i = 0; i < value.length && matchIndex < query.length; i++) {
    if (value[i] === query[matchIndex]) {
      matchIndex++;
    }
  }
  return matchIndex === query.length;
};

const AdminPayouts = () => {
  const { toast } = useToast();
  const [selection, setSelection] = useState<SelectionState>({});
  const [returning, setReturning] = useState<{
    withdrawalId: string;
    name: string;
    amount: number;
  } | null>(null);
  const [batchName, setBatchName] = useState(
    () => `Atomik Batch ${new Date().toISOString().slice(0, 10)}`
  );
  const [page, setPage] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");

  const {
    data: candidates,
    isLoading,
    refetch: refetchCandidates,
  } = trpc.wise.getPayoutCandidates.useQuery();
  // Read-only preview of the sync — fetched on demand via the Dry run button.
  const dryRunSync = trpc.wise.dryRunSyncPendingWithdrawals.useQuery(
    undefined,
    { enabled: false, refetchOnWindowFocus: false }
  );
  const syncWithdrawals = trpc.wise.syncPendingWithdrawals.useMutation({
    onSuccess: (result) => {
      toast({
        title: "Synced Wise transfers",
        description: `Completed ${result.completed}, refunded ${result.refunded}. ${result.stillPending} still pending.`,
      });
      if (result.missingTransferId > 0) {
        toast({
          title: `${result.missingTransferId} withdrawal${result.missingTransferId === 1 ? "" : "s"} need manual review`,
          description: `Pending with no Wise transfer attached (interrupted payout batch): ${result.missingTransferIdRows.join(", ")}. Check these against Wise before touching them.`,
          variant: "destructive",
        });
      }
      refetchCandidates();
    },
    onError: (error) => {
      toast({
        title: "Sync failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const createBatch = trpc.wise.createBatchPayout.useMutation({
    onSuccess: (result) => {
      toast({
        title: "Wise batch created",
        description: `Batch ${result.batchGroupId} sent (${result.transferCount} transfers).`,
      });
      if (result.skippedWithdrawals.length > 0) {
        toast({
          title: `${result.skippedWithdrawals.length} withdrawal${result.skippedWithdrawals.length === 1 ? "" : "s"} skipped`,
          description: result.skippedWithdrawals
            .map(
              (skipped) =>
                `${skipped.withdrawalId} (user ${skipped.userId}, txn ${skipped.customerTransactionId}): ${skipped.reason}`
            )
            .join("\n"),
          variant: "destructive",
        });
      }
      refetchCandidates();
      setSelection({});
    },
    onError: (error) => {
      toast({
        title: "Wise batch failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const returnWithdrawal = trpc.wise.returnWithdrawalToBalance.useMutation({
    onSuccess: (result) => {
      toast({
        title: "Returned to balance",
        description: `${currencyFormat(result.amount)} is back in the clipper's platform balance. They can claim again anytime.`,
      });
      setReturning(null);
      refetchCandidates();
    },
    onError: (error) => {
      toast({
        title: "Couldn't return withdrawal",
        description: error.message,
        variant: "destructive",
      });
      setReturning(null);
      refetchCandidates();
    },
  });

  const selectedEntries = useMemo(() => Object.entries(selection), [selection]);
  const sortedCandidates = useMemo(() => {
    if (!candidates) {
      return [];
    }
    return [...candidates].sort((a, b) => {
      if (a.hasRecipient === b.hasRecipient) {
        return 0;
      }
      return a.hasRecipient ? -1 : 1;
    });
  }, [candidates]);

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filteredCandidates = useMemo(() => {
    if (!normalizedQuery) {
      return sortedCandidates;
    }
    return sortedCandidates.filter((candidate) => {
      const haystacks = [
        candidate.fullName,
        candidate.username,
        candidate.userId,
        candidate.email,
        candidate.discordId,
        candidate.discordUsername,
      ].reduce<string[]>((acc, value) => {
        if (value) {
          acc.push(value.toLowerCase());
        }
        return acc;
      }, []);
      return haystacks.some((value) => fuzzyMatch(normalizedQuery, value));
    });
  }, [sortedCandidates, normalizedQuery]);

  const totalPages = Math.max(
    1,
    Math.ceil(filteredCandidates.length / PAGE_SIZE)
  );
  const pagedCandidates = useMemo(() => {
    const start = page * PAGE_SIZE;
    return filteredCandidates.slice(start, start + PAGE_SIZE);
  }, [filteredCandidates, page]);

  useEffect(() => {
    setPage((prev) => {
      const maxPage = Math.max(0, totalPages - 1);
      return Math.min(prev, maxPage);
    });
  }, [totalPages]);

  useEffect(() => {
    setPage(0);
  }, [normalizedQuery]);

  const showingStart =
    filteredCandidates.length === 0 ? 0 : page * PAGE_SIZE + 1;
  const showingEnd =
    filteredCandidates.length === 0
      ? 0
      : Math.min(filteredCandidates.length, (page + 1) * PAGE_SIZE);
  const canGoPrev = page > 0;
  const canGoNext = page < totalPages - 1;
  const totalAmount = useMemo(
    () => selectedEntries.reduce((sum, [, value]) => sum + value.amount, 0),
    [selectedEntries]
  );
  const candidatesById = useMemo(() => {
    const map = new Map<string, (typeof sortedCandidates)[number]>();
    sortedCandidates.forEach((candidate) => {
      map.set(candidate.userId, candidate);
    });
    return map;
  }, [sortedCandidates]);

  const handleToggle = (
    userId: string,
    recipientRecordId: string,
    defaultAmount: number
  ) => {
    if (!recipientRecordId) {
      toast({
        title: "Recipient missing",
        description: "Select users with a valid Wise recipient.",
        variant: "destructive",
      });
      return;
    }
    setSelection((prev) => {
      if (prev[userId]) {
        const updated = { ...prev };
        delete updated[userId];
        return updated;
      }
      return {
        ...prev,
        [userId]: {
          recipientRecordId,
          amount: Number(defaultAmount.toFixed(2)),
        },
      };
    });
  };

  const handleBulkSelectReady = () => {
    if (!sortedCandidates.length) {
      return;
    }

    const readyCandidates = sortedCandidates.filter(
      (candidate) =>
        candidate.hasRecipient && !candidate.hasOutstandingDemographics
    );

    setSelection((prev) => {
      const next: SelectionState = { ...prev };
      const allSelected = readyCandidates.every((candidate) =>
        Boolean(next[candidate.userId])
      );

      if (allSelected) {
        readyCandidates.forEach((candidate) => {
          delete next[candidate.userId];
        });
        return { ...next };
      }

      readyCandidates.forEach((candidate) => {
        next[candidate.userId] = {
          recipientRecordId: candidate.recipient?.recordId || "",
          amount: Number(candidate.balance.toFixed(2)),
        };
      });

      return next;
    });
  };

  const handleCreateBatch = async () => {
    const payouts = selectedEntries.map(([userId, value]) => ({
      userId,
      recipientRecordId: value.recipientRecordId,
      amount: Number(value.amount.toFixed(2)),
    }));

    if (payouts.length === 0) {
      toast({
        title: "Select at least one payout",
        variant: "destructive",
      });
      return;
    }

    await createBatch.mutateAsync({
      batchName,
      payouts,
    });
  };

  const isSubmitting = createBatch.isPending;

  const handleExportCsv = () => {
    if (selectedEntries.length === 0) {
      toast({
        title: "Select payouts first",
        description: "Choose at least one balance to export.",
        variant: "destructive",
      });
      return;
    }

    const escapeCsv = (value: string | number | null | undefined) => {
      const stringValue =
        value === null || value === undefined ? "" : String(value);
      return `"${stringValue.replace(/"/g, '""')}"`;
    };

    const header = [
      "User",
      "Full Name",
      "Discord ID",
      "Discord Username",
      "Email",
      "Amount",
    ];

    const rows = selectedEntries.map(([userId, value]) => {
      const candidate = candidatesById.get(userId);
      return [
        escapeCsv(candidate?.username || userId),
        escapeCsv(candidate?.fullName || ""),
        escapeCsv(candidate?.discordId || userId),
        escapeCsv(candidate?.discordUsername || ""),
        escapeCsv(candidate?.email || ""),
        escapeCsv(value.amount.toFixed(2)),
      ].join(",");
    });

    const csvContent = [header.join(","), ...rows].join("\n");
    const blob = new Blob([csvContent], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute(
      "download",
      `outstanding-balances-${new Date().toISOString().slice(0, 10)}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <AppLayout>
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8">
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Batch configuration</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="batchName">Batch name</Label>
                <Input
                  id="batchName"
                  value={batchName}
                  onChange={(event) => setBatchName(event.target.value)}
                />
              </div>
              <div className="flex flex-col justify-end">
                <Button
                  onClick={handleCreateBatch}
                  disabled={isSubmitting || selectedEntries.length === 0}
                >
                  {isSubmitting ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Sending…
                    </span>
                  ) : (
                    `Send ${selectedEntries.length} payouts (${currencyFormat(
                      totalAmount
                    )})`
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <CardTitle>Outstanding balances</CardTitle>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleBulkSelectReady}
                    disabled={sortedCandidates.length === 0}
                  >
                    <CheckSquare className="mr-2 h-4 w-4" />
                    Select ready
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleExportCsv}
                    disabled={selectedEntries.length === 0}
                  >
                    Export CSV
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => refetchCandidates()}
                  >
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Refresh
                  </Button>
                </div>
              </div>
              <Input
                placeholder="Search names, emails, or Discord handles"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                className="w-full md:max-w-sm"
              />
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center gap-2 py-10 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading balances…
              </div>
            ) : filteredCandidates.length === 0 ? (
              <p className="py-6 text-sm text-muted-foreground">
                {normalizedQuery
                  ? "No balances match your search."
                  : "No pending balances found."}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[60px]">Pay</TableHead>
                      <TableHead>User</TableHead>
                      <TableHead>Balance</TableHead>
                      <TableHead>Demographics</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pagedCandidates.map((candidate) => {
                      const selected = Boolean(selection[candidate.userId]);
                      const disabled = !candidate.hasRecipient;
                      return (
                        <TableRow key={candidate.userId}>
                          <TableCell>
                            <Checkbox
                              checked={selected}
                              disabled={disabled}
                              onCheckedChange={() =>
                                handleToggle(
                                  candidate.userId,
                                  candidate.recipient?.recordId || "",
                                  candidate.balance
                                )
                              }
                            />
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col">
                              <span className="font-medium">
                                {candidate.fullName ||
                                  candidate.username ||
                                  candidate.userId}
                              </span>
                              {candidate.email ? (
                                <span className="text-xs text-muted-foreground">
                                  {candidate.email}
                                </span>
                              ) : null}
                              <span className="text-xs text-muted-foreground">
                                Discord: {candidate.discordUsername || candidate.discordId}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell>
                            {currencyFormat(candidate.balance)}
                          </TableCell>
                          <TableCell>
                            {candidate.hasOutstandingDemographics ? (
                              <div className="flex items-center gap-2 text-amber-600">
                                <AlertTriangle className="h-4 w-4" />
                                Action required
                              </div>
                            ) : (
                              <div className="flex items-center gap-2 text-emerald-600">
                                <CheckCircle2 className="h-4 w-4" />
                                Clear
                              </div>
                            )}
                          </TableCell>
                          <TableCell>
                            {candidate.hasRecipient ? (
                              <div className="flex items-center gap-2 text-emerald-600">
                                <CheckCircle2 className="h-4 w-4" />
                                Ready
                              </div>
                            ) : (
                              <div className="flex items-center gap-2 text-amber-600">
                                <AlertTriangle className="h-4 w-4" />
                                Needs info
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={
                                selected || returnWithdrawal.isPending
                              }
                              title={
                                selected
                                  ? "Deselect from the payout batch first"
                                  : "Send this amount back to the clipper's platform balance"
                              }
                              onClick={() =>
                                setReturning({
                                  withdrawalId: candidate.withdrawalId,
                                  name:
                                    candidate.fullName ||
                                    candidate.username ||
                                    candidate.userId,
                                  amount: candidate.balance,
                                })
                              }
                            >
                              <Undo2 className="mr-2 h-4 w-4" /> Return
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
                <div className="flex flex-col gap-3 border-t pt-4 text-sm sm:flex-row sm:items-center sm:justify-between">
                  <span className="text-muted-foreground">
                    Showing {showingStart}-{showingEnd} of{" "}
                    {sortedCandidates.length} entries
                  </span>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!canGoPrev}
                      onClick={() => setPage((prev) => Math.max(0, prev - 1))}
                    >
                      Previous
                    </Button>
                    <span className="text-xs font-medium text-muted-foreground">
                      Page {sortedCandidates.length === 0 ? 0 : page + 1} of{" "}
                      {sortedCandidates.length === 0 ? 0 : totalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!canGoNext}
                      onClick={() =>
                        setPage((prev) => Math.min(totalPages - 1, prev + 1))
                      }
                    >
                      Next
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="space-y-2">
            <CardTitle>Sync Wise transfers</CardTitle>
            <p className="text-sm text-muted-foreground">
              Check every pending Wise withdrawal, mark completed payouts, and
              automatically refund any transfers Wise cancelled or returned.
              Run a dry run first — it asks Wise the same questions but
              changes nothing, so you can review who would be refunded.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-3">
              <Button
                variant="outline"
                onClick={() => dryRunSync.refetch()}
                disabled={dryRunSync.isFetching}
              >
                {dryRunSync.isFetching ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Checking Wise…
                  </span>
                ) : (
                  "Dry run (no changes)"
                )}
              </Button>
              <Button
                onClick={() => syncWithdrawals.mutateAsync()}
                disabled={syncWithdrawals.isPending}
              >
                {syncWithdrawals.isPending ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Syncing…
                  </span>
                ) : (
                  "Sync Wise transfers"
                )}
              </Button>
            </div>
            {dryRunSync.data ? (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2 text-xs">
                  <Badge variant="outline">
                    {dryRunSync.data.summary.total} pending checked
                  </Badge>
                  <Badge variant="destructive">
                    {dryRunSync.data.summary.refund} would be refunded ($
                    {dryRunSync.data.summary.totalRefundAmount.toLocaleString()}
                    )
                  </Badge>
                  <Badge variant="outline">
                    {dryRunSync.data.summary.complete} would complete
                  </Badge>
                  <Badge variant="outline">
                    {dryRunSync.data.summary.stillPending} still pending
                  </Badge>
                  <Badge variant="outline">
                    {dryRunSync.data.summary.errorSkipped} lookup errors
                  </Badge>
                  <Badge variant="outline">
                    {dryRunSync.data.summary.manualReview} need manual review
                  </Badge>
                  {dryRunSync.data.summary.refundsToAlreadyCompensated > 0 ? (
                    <Badge variant="destructive">
                      ⚠ {dryRunSync.data.summary.refundsToAlreadyCompensated}{" "}
                      refunds go to already-compensated clippers
                    </Badge>
                  ) : null}
                </div>
                <div className="max-h-96 overflow-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Clipper</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead>Requested</TableHead>
                        <TableHead>Wise says</TableHead>
                        <TableHead>Sync would</TableHead>
                        <TableHead className="text-right">
                          Manual credits ⚠
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {[...dryRunSync.data.rows]
                        .sort((a, b) => {
                          const order = (r: (typeof dryRunSync.data.rows)[number]) =>
                            r.wouldDo === "refund" ? 0 : r.wouldDo === "manual-review-no-transfer-id" ? 1 : 2;
                          return order(a) - order(b) || b.amount - a.amount;
                        })
                        .map((row) => (
                          <TableRow key={row.withdrawalId}>
                            <TableCell>{row.username ?? row.userId}</TableCell>
                            <TableCell className="text-right">
                              ${row.amount.toFixed(2)}
                            </TableCell>
                            <TableCell>
                              {new Date(row.createdAt).toLocaleDateString()}
                            </TableCell>
                            <TableCell>{row.wiseStatus}</TableCell>
                            <TableCell
                              className={
                                row.wouldDo === "refund"
                                  ? "font-semibold text-destructive"
                                  : undefined
                              }
                            >
                              {row.wouldDo}
                            </TableCell>
                            <TableCell className="text-right">
                              {row.manualCreditsReceived > 0
                                ? `⚠ $${row.manualCreditsReceived.toFixed(2)}`
                                : "—"}
                            </TableCell>
                          </TableRow>
                        ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <AlertDialog
        open={Boolean(returning)}
        onOpenChange={(open) => {
          if (!open) setReturning(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Return withdrawal to balance?</AlertDialogTitle>
            <AlertDialogDescription>
              {returning ? (
                <>
                  This closes{" "}
                  <span className="font-medium text-foreground">
                    {returning.name}
                  </span>
                  's queued withdrawal and puts{" "}
                  <span className="font-medium text-foreground">
                    {currencyFormat(returning.amount)}
                  </span>{" "}
                  back into their platform balance. They'll be notified and can
                  claim again anytime. Only possible while the payout is still
                  in this queue — once it's sent to Wise it can't be returned.
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={returnWithdrawal.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={returnWithdrawal.isPending}
              onClick={(event) => {
                event.preventDefault();
                if (returning) {
                  returnWithdrawal.mutate({
                    withdrawalId: returning.withdrawalId,
                  });
                }
              }}
            >
              {returnWithdrawal.isPending ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" /> Returning…
                </span>
              ) : (
                "Return to balance"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
};

export default AdminPayouts;
