import { Badge, Card, Label, Loading } from "@/components/ds";
import { useAuth } from "@/hooks/useAuth";
import { formatCurrency } from "@/lib/formatCurrency";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { AlertCircle, Banknote, Bitcoin, Check, Clock, Lock } from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// PAYOUT READINESS
//
// Answers the five questions prompt 15 asks, and nothing more:
//   is a payout method connected?  which one?  is anything incomplete?
//   can I be paid right now?  what else is needed?
//
// It decides none of them. Each line mirrors a condition that already gates
// the claim button in Earnings.tsx, read from the same procedures:
//
//   bankAccounts.getAll                    → is a bank account saved
//   cryptoPayouts.getMyMethods             → is a wallet saved
//   cryptoPayouts.getMyOutstandingWithdrawal → a request already in flight
//   demographicsVerification.getClaimable  → claimable vs held
//   MINIMUM_CLAIM_AMOUNT = 2               → the same constant Earnings uses
//       (Earnings.tsx:39; the gate there is `currentBalance > 2`, strictly
//       greater, so that is what is reproduced here)
//
// Nothing here submits a payout or changes eligibility. The claim flow and its
// checks stay exactly where they are.
// ─────────────────────────────────────────────────────────────────────────────

const MINIMUM_CLAIM_AMOUNT = 2;

const Line = ({
  ok,
  icon: Icon,
  title,
  detail,
}: {
  ok: boolean | null;
  icon: typeof Check;
  title: React.ReactNode;
  detail?: React.ReactNode;
}) => (
  <li className="flex items-start gap-3 rounded-xl border border-border bg-muted/30 px-4 py-3">
    <span
      className={cn(
        "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
        ok === true && "text-emerald-600 dark:text-emerald-400",
        ok === false && "text-amber-600 dark:text-amber-400",
        ok === null && "text-muted-foreground"
      )}
    >
      <Icon className="h-4 w-4" />
    </span>
    <div className="min-w-0 flex-1">
      <p className="text-sm font-medium">{title}</p>
      {detail ? (
        <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
          {detail}
        </p>
      ) : null}
    </div>
  </li>
);

export const PayoutReadiness = () => {
  const { user } = useAuth();
  const enabled = Boolean(user);

  const banks = trpc.bankAccounts.getAll.useQuery(undefined, { enabled });
  const wallets = trpc.cryptoPayouts.getMyMethods.useQuery(undefined, {
    enabled,
  });
  const outstanding =
    trpc.cryptoPayouts.getMyOutstandingWithdrawal.useQuery(undefined, {
      enabled,
    });
  const claim = trpc.demographicsVerification.getClaimable.useQuery(undefined, {
    enabled,
  });

  if (!user) return null;
  if (banks.isLoading || wallets.isLoading) {
    return <Loading label="Checking your payout setup" />;
  }

  const bankCount = banks.data?.length ?? 0;
  const walletCount = wallets.data?.length ?? 0;
  const hasMethod = bankCount > 0 || walletCount > 0;

  const balance = Number(claim.data?.balance ?? 0);
  const claimable = Number(claim.data?.claimable ?? 0);
  const held = Number(claim.data?.lockedTotal ?? 0);
  const meetsMinimum = balance > MINIMUM_CLAIM_AMOUNT;
  const pending = Boolean(outstanding.data);

  const ready = hasMethod && meetsMinimum && claimable > 0 && !pending;

  return (
    <Card className="space-y-4 p-5">
      <div className="flex items-center justify-between gap-3">
        <Label>Payout readiness</Label>
        {ready ? (
          <Badge tone="positive">Ready to claim</Badge>
        ) : pending ? (
          <Badge tone="warning">Payout in progress</Badge>
        ) : (
          <Badge tone="warning">Not ready yet</Badge>
        )}
      </div>

      <ul className="space-y-2">
        <Line
          ok={hasMethod}
          icon={hasMethod ? Check : AlertCircle}
          title={
            hasMethod
              ? [
                  bankCount > 0
                    ? `${bankCount} bank ${bankCount === 1 ? "account" : "accounts"}`
                    : null,
                  walletCount > 0
                    ? `${walletCount} crypto ${walletCount === 1 ? "wallet" : "wallets"}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : "No payout method connected"
          }
          detail={
            hasMethod
              ? "Add or change these under Payout methods below."
              : "Add a bank account or a crypto wallet before you can be paid."
          }
        />

        <Line
          ok={meetsMinimum}
          icon={meetsMinimum ? Check : Banknote}
          title={
            meetsMinimum
              ? `Balance is above the ${formatCurrency(MINIMUM_CLAIM_AMOUNT)} minimum`
              : `Balance must be over ${formatCurrency(MINIMUM_CLAIM_AMOUNT)} to claim`
          }
          detail={`You currently have ${formatCurrency(balance)}.`}
        />

        <Line
          ok={held === 0}
          icon={held === 0 ? Check : Lock}
          title={
            held === 0
              ? "Nothing is on hold"
              : `${formatCurrency(held)} held pending demographics`
          }
          detail={
            held === 0
              ? undefined
              : `${formatCurrency(claimable)} of your balance is claimable right now. The rest releases when a moderator approves your reports.`
          }
        />

        {pending ? (
          <Line
            ok={null}
            icon={Clock}
            title="A payout request is already in progress"
            detail="You can cancel it from the earnings page if you need to change anything."
          />
        ) : null}
      </ul>

      {!hasMethod ? (
        <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/40 px-4 py-3 text-[11px] text-muted-foreground">
          <Bitcoin className="h-3.5 w-3.5 shrink-0" />
          Crypto payouts support USDT/USDC on low-fee networks. Ethereum
          (ERC-20) and Tron (TRC-20) are not supported.
        </div>
      ) : null}
    </Card>
  );
};

export default PayoutReadiness;
