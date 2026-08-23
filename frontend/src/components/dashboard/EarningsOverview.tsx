import { Badge, Card, Empty, Label, Loading, Numeric, Stat } from "@/components/ds";
import { useAuth } from "@/hooks/useAuth";
import { formatCurrency } from "@/lib/formatCurrency";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Lock,
  RotateCcw,
  SlidersHorizontal,
} from "lucide-react";
import { useMemo, useState } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// EARNINGS OVERVIEW
//
// Presentation only. Every figure comes from procedures that already exist:
//   rewards.getMyEarnings              → currentBalance, totalEarned, entries
//   demographicsVerification.getClaimable → claimable, lockedTotal
//
// NOTHING here recomputes earnings. The two authoritative totals (lifetime
// earned, current balance) are returned by the server and printed as-is. The
// per-type figures are a SUM OF THE ROWS ALREADY ON SCREEN — the same ledger
// the list below shows — and are labelled as such, because getMyEarnings caps
// at 500 entries and ignores anything before 2025-11-17, so they are a view of
// this page's data, not a second source of truth about a clipper's history.
// ─────────────────────────────────────────────────────────────────────────────

const TYPE_META: Record<
  string,
  { label: string; icon: typeof ArrowUpRight; tone: "positive" | "neutral" | "danger" }
> = {
  reward: { label: "Reward", icon: ArrowUpRight, tone: "positive" },
  manual_adjustment: {
    label: "Adjustment",
    icon: SlidersHorizontal,
    tone: "neutral",
  },
  withdrawal: { label: "Withdrawal", icon: ArrowDownLeft, tone: "neutral" },
  withdrawal_cancellation: {
    label: "Withdrawal cancelled",
    icon: RotateCcw,
    tone: "neutral",
  },
  withdrawal_refund: { label: "Refund", icon: RotateCcw, tone: "neutral" },
};

const FILTERS = [
  { id: "all", label: "All" },
  { id: "reward", label: "Rewards" },
  { id: "withdrawal", label: "Withdrawals" },
  { id: "manual_adjustment", label: "Adjustments" },
] as const;

export const EarningsOverview = () => {
  const { user } = useAuth();
  const earnings = trpc.rewards.getMyEarnings.useQuery(undefined, {
    enabled: Boolean(user),
  });
  const gate = trpc.demographicsVerification.getClaimable.useQuery(undefined, {
    enabled: Boolean(user),
  });

  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");

  const entries = earnings.data?.entries ?? [];

  const totals = useMemo(() => {
    let earned = 0;
    let deducted = 0;
    let paidOut = 0;
    let returned = 0;
    for (const e of entries) {
      const amount = Number(e.amount ?? 0);
      if (e.type === "reward") earned += amount;
      else if (e.type === "manual_adjustment") {
        if (amount < 0) deducted += -amount;
        else earned += amount;
      } else if (e.type === "withdrawal") paidOut += -amount;
      else if (
        e.type === "withdrawal_cancellation" ||
        e.type === "withdrawal_refund"
      )
        returned += amount;
    }
    return { earned, deducted, paidOut: paidOut - returned };
  }, [entries]);

  const visible = useMemo(
    () =>
      filter === "all"
        ? entries
        : entries.filter((e) =>
            filter === "withdrawal"
              ? e.type.startsWith("withdrawal")
              : e.type === filter
          ),
    [entries, filter]
  );

  if (!user) return null;
  if (earnings.isLoading) return <Loading label="Loading earnings" />;

  const balance = Number(earnings.data?.currentBalance ?? 0);
  const lifetime = Number(earnings.data?.totalEarned ?? 0);
  const claimable = gate.data?.claimable;
  const locked = gate.data?.lockedTotal ?? 0;

  return (
    <div className="space-y-6">
      {/* Headline: what they can take out right now, and why it might differ
          from the balance. Both figures come straight from the server. */}
      <Card inverted className="space-y-4 p-6">
        <div className="flex items-start justify-between">
          <Label className="opacity-60">Claimable now</Label>
          {locked > 0 ? (
            <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] opacity-70">
              <Lock className="h-3 w-3" />
              {formatCurrency(locked)} on hold
            </span>
          ) : null}
        </div>
        <Numeric size="xl">
          {claimable === undefined ? "—" : formatCurrency(claimable)}
        </Numeric>
        <div className="grid grid-cols-2 gap-4 border-t border-background/20 pt-4">
          <Stat
            label={<span className="opacity-60">Current balance</span>}
            value={<Numeric size="sm">{formatCurrency(balance)}</Numeric>}
          />
          <Stat
            label={<span className="opacity-60">Earned all time</span>}
            value={<Numeric size="sm">{formatCurrency(lifetime)}</Numeric>}
          />
        </div>
      </Card>

      {/* Breakdown of the rows shown below — explicitly scoped, see header. */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-5">
          <Stat
            label="Earned"
            value={<Numeric>{formatCurrency(totals.earned)}</Numeric>}
            hint="in the activity below"
          />
        </Card>
        <Card className="p-5">
          <Stat
            label="Deducted"
            value={
              <Numeric className={totals.deducted > 0 ? "text-destructive" : ""}>
                {totals.deducted > 0 ? "−" : ""}
                {formatCurrency(totals.deducted)}
              </Numeric>
            }
            hint="clawbacks and corrections"
          />
        </Card>
        <Card className="p-5">
          <Stat
            label="Paid out"
            value={<Numeric>{formatCurrency(totals.paidOut)}</Numeric>}
            hint="net of cancellations"
          />
        </Card>
      </div>

      {/* Activity */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Label>Activity</Label>
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                aria-pressed={filter === f.id}
                className={cn(
                  "rounded-lg border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] transition-colors",
                  filter === f.id
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-muted/40 text-muted-foreground hover:border-foreground/40"
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {visible.length === 0 ? (
          <Empty>
            {entries.length === 0
              ? "No balance activity yet. Submit clips to start earning."
              : "Nothing of that kind in your recent activity."}
          </Empty>
        ) : (
          <Card className="divide-y divide-border">
            {visible.map((entry) => {
              const meta = TYPE_META[entry.type] ?? {
                label: entry.type,
                icon: SlidersHorizontal,
                tone: "neutral" as const,
              };
              const Icon = meta.icon;
              const amount = Number(entry.amount ?? 0);
              const positive = amount >= 0;

              return (
                <div
                  key={entry.id}
                  className="flex items-start gap-3 px-5 py-3.5"
                >
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-muted">
                    <Icon className="h-3.5 w-3.5" />
                  </span>

                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={meta.tone}>{meta.label}</Badge>
                      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                        {format(new Date(entry.createdAt), "d MMM yyyy, HH:mm")}
                      </span>
                    </div>
                    {entry.memo ? (
                      <p className="text-sm leading-relaxed text-muted-foreground">
                        {entry.memo}
                      </p>
                    ) : null}
                  </div>

                  <span
                    className={cn(
                      "shrink-0 font-mono text-sm font-bold",
                      positive ? "text-foreground" : "text-destructive"
                    )}
                  >
                    {positive ? "+" : "−"}
                    {formatCurrency(Math.abs(amount))}
                  </span>
                </div>
              );
            })}
          </Card>
        )}

        {entries.length >= 500 ? (
          <p className="text-[11px] text-muted-foreground">
            Showing the most recent 500 entries.
          </p>
        ) : null}
      </div>
    </div>
  );
};

export default EarningsOverview;
