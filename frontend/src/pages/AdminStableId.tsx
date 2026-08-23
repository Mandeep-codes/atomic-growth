import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/components/ui/use-toast";

// Feature 0 backfill — admin-triggered, resumable. Resolves verified accounts'
// stable platform IDs in batches; "Run until done" loops until none remain.
const AdminStableId = () => {
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const statusQuery = trpc.stableId.backfillStatus.useQuery();
  const backfill = trpc.stableId.backfillStableIds.useMutation();
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  const runOnce = async () => {
    const res = await backfill.mutateAsync({ batchSize: 150 });
    setLog((l) => [
      `Batch: ${res.resolved} resolved · ${res.notFound} not-found · ${res.errored} errored — ${res.remaining} remaining`,
      ...l,
    ]);
    await utils.stableId.backfillStatus.invalidate();
    return res.remaining;
  };

  const runAll = async () => {
    setRunning(true);
    try {
      let remaining = Infinity;
      let guard = 0;
      while (remaining > 0 && guard < 200) {
        remaining = await runOnce();
        guard++;
      }
      toast({ title: "Backfill complete", description: `${remaining} remaining.` });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Backfill failed",
        description: e instanceof Error ? e.message : "error",
      });
    } finally {
      setRunning(false);
    }
  };

  return (
    <AppLayout>
      <div className="mx-auto max-w-3xl space-y-6 px-6 py-10">
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold">Stable ID backfill</h1>
          <p className="text-sm text-muted-foreground">
            Resolve + store each verified account's permanent platform ID
            (channel / pk / secUid / rest_id). Resumable — only processes
            accounts not yet resolved. ~1% of the API quota in total.
          </p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Status</CardTitle>
            <CardDescription>
              {statusQuery.data
                ? `${statusQuery.data.remaining.toLocaleString()} accounts left to resolve`
                : "Loading…"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Button onClick={runAll} disabled={running}>
                {running ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" /> Running…
                  </span>
                ) : (
                  "Run backfill until done"
                )}
              </Button>
              <Button
                variant="outline"
                onClick={() => runOnce()}
                disabled={running || backfill.isPending}
              >
                Run one batch
              </Button>
            </div>
            <div className="max-h-64 space-y-1 overflow-auto rounded-md border bg-muted/30 p-3 font-mono text-xs">
              {log.length === 0 ? (
                <span className="text-muted-foreground">No runs yet.</span>
              ) : (
                log.map((l, i) => <div key={i}>{l}</div>)
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
};

export default AdminStableId;
