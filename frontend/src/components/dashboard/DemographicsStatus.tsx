import { Badge, Button, Card, Label, Loading } from "@/components/ds";
import { useAuth } from "@/hooks/useAuth";
import { formatCurrency } from "@/lib/formatCurrency";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { ArrowRight, Check, Clock, Lock, ShieldCheck } from "lucide-react";
import { useNavigate } from "react-router-dom";

// ─────────────────────────────────────────────────────────────────────────────
// DEMOGRAPHICS STATUS
//
// Shows the ask, per account, and nothing when there is no ask.
//
// The condition is not re-derived here: getCampaignAsks already decides who is
// asked (threshold, participating accounts, banned handles, satisfied rounds),
// and this renders exactly what it returns. If a campaign stops asking, this
// disappears on its own — which is the whole point of prompt 14's "if
// demographics are not currently required, do not force the user through it".
//
// TWO THINGS THE COPY MUST NOT GET WRONG, both load-bearing:
//   1. Earnings are held PER CAMPAIGN and release on moderator APPROVAL, not
//      on submission. "Submitted" is not "released".
//   2. An exemption still requires the screen recording and still releases the
//      campaign's base pay once approved — it only forgoes the geo bonus.
//
// The money fields (claimable, lockedTotal) are spread at the TOP LEVEL of
// getCampaignAsks, not nested under a balance object.
// ─────────────────────────────────────────────────────────────────────────────

const STATE = {
  approved: { label: "Approved", tone: "positive" as const, icon: Check },
  exempt: { label: "Exempt — approved", tone: "positive" as const, icon: ShieldCheck },
  submitted: { label: "In review", tone: "warning" as const, icon: Clock },
  missing: { label: "Needs report", tone: "danger" as const, icon: Lock },
};

const stateOf = (a: {
  approved: boolean;
  submitted: boolean;
  exempt: boolean;
}) =>
  a.approved && a.exempt
    ? STATE.exempt
    : a.approved
    ? STATE.approved
    : a.submitted
    ? STATE.submitted
    : STATE.missing;

export const DemographicsStatus = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data, isLoading } = trpc.demographicsVerification.getCampaignAsks.useQuery(
    undefined,
    { enabled: Boolean(user) }
  );

  if (!user) return null;
  if (isLoading) return <Loading label="Checking demographics" />;

  const asks = data?.asks ?? [];
  const outstanding = asks.filter((a) => !a.satisfied);

  // Nothing outstanding — every asked account has been APPROVED, so whatever
  // was held for it has been released.
  if (outstanding.length === 0) {
    const claimable = Number(data?.claimable ?? 0);

    return (
      <Card className="flex flex-wrap items-center justify-between gap-3 p-5">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border bg-muted">
            <Check className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium">
              {claimable > 0
                ? "Demographics approved"
                : "No demographics requested"}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {claimable > 0
                ? `${formatCurrency(claimable)} released and ready to claim.`
                : "Nothing is being held. We'll ask here if a campaign needs a report."}
            </p>
          </div>
        </div>

        {/* Claim appears only once the reports are APPROVED, not when they are
            merely submitted. The server refuses a withdrawal while any ask is
            unsatisfied, so a button offered at submission time would be a
            button that always fails — and "submitting is not the same as being
            approved" is exactly the thing this panel exists to teach. */}
        {claimable > 0 ? (
          <Button onClick={() => navigate("/earnings/claim")}>
            Claim {formatCurrency(claimable)}
            <ArrowRight className="h-4 w-4" />
          </Button>
        ) : null}
      </Card>
    );
  }

  const locked = Number(data?.lockedTotal ?? 0);

  return (
    <div className="space-y-3">
      {locked > 0 ? (
        <Card className="flex flex-wrap items-center justify-between gap-3 border-amber-500/40 bg-amber-500/5 p-4">
          <div className="flex items-center gap-2 text-sm">
            <Lock className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <span>
              <strong>{formatCurrency(locked)}</strong> is held until these
              reports are <strong>approved</strong>.
            </span>
          </div>
          <Button onClick={() => navigate("/demographics-verification/weekly")}>
            Submit demographics
            <ArrowRight className="h-4 w-4" />
          </Button>
        </Card>
      ) : null}

      {outstanding.map((ask) => (
        <Card key={ask.campaignId} className="space-y-3 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <Label>Reporting for</Label>
              <p className="truncate text-base font-semibold">
                {ask.campaignTitle ?? "Campaign"}
              </p>
            </div>
            <Badge tone="warning">
              {ask.accounts.filter((a) => !a.approved).length} of{" "}
              {ask.accounts.length} outstanding
            </Badge>
          </div>

          <ul className="space-y-1.5">
            {ask.accounts.map((account) => {
              const s = stateOf(account);
              const Icon = s.icon;
              return (
                <li
                  key={account.verifiedUserId}
                  className="flex items-center gap-2.5 rounded-lg border border-border bg-muted/30 px-3 py-2"
                >
                  <Icon
                    className={cn(
                      "h-3.5 w-3.5 shrink-0",
                      s.tone === "positive" &&
                        "text-emerald-600 dark:text-emerald-400",
                      s.tone === "warning" &&
                        "text-amber-600 dark:text-amber-400",
                      s.tone === "danger" && "text-destructive"
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate text-sm">
                    @{account.handle ?? "unknown"}
                    <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      {account.platform}
                    </span>
                  </span>
                  <Badge tone={s.tone}>{s.label}</Badge>
                </li>
              );
            })}
          </ul>

          {/* Stated once, plainly, because it is the single most misread rule
              in this flow. */}
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Submitting is not the same as being approved — this campaign's
            earnings release once a moderator approves each account.
          </p>
        </Card>
      ))}
    </div>
  );
};

export default DemographicsStatus;
