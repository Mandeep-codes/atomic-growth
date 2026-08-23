import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Loader2, Wallet } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { useToast } from "@/hooks/use-toast";
import { CRYPTO_PAYOUT_OPTIONS } from "@/shared/cryptoPayoutOptions";

const usd = (amount: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);

// Crypto claim step (open to all clippers). The clipper chooses how much of
// their balance to claim, but only ONE claim can be queued at a time — they
// must wait for it to be paid out or cancel it before claiming again.
const ClaimCryptoDetailsStep = () => {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const { toast } = useToast();

  const { data: earnings, isLoading: earningsLoading } =
    trpc.rewards.getMyEarnings.useQuery();
  const methodsQuery = trpc.cryptoPayouts.getMyMethods.useQuery();
  const outstandingQuery =
    trpc.cryptoPayouts.getMyOutstandingWithdrawal.useQuery();
  const requestWithdrawal =
    trpc.cryptoPayouts.requestMyWithdrawal.useMutation();
  const cancelWithdrawal =
    trpc.cryptoPayouts.cancelMyRequestedWithdrawal.useMutation();

  const [methodId, setMethodId] = useState<string>("");
  const [amountInput, setAmountInput] = useState<string>("");
  const [requestError, setRequestError] = useState<string | null>(null);

  const availableBalance = earnings?.currentBalance ?? 0;
  const methods = methodsQuery.data ?? [];
  const outstanding = outstandingQuery.data ?? null;

  const optionByCurrency = useMemo(
    () => new Map(CRYPTO_PAYOUT_OPTIONS.map((o) => [o.npCurrency, o])),
    []
  );

  const parsedAmount = Number(amountInput);
  const amountValid =
    amountInput.trim() !== "" &&
    Number.isFinite(parsedAmount) &&
    parsedAmount > 0 &&
    parsedAmount <= availableBalance + 0.0001;

  const describeMethod = (method: (typeof methods)[number]) => {
    const option = optionByCurrency.get(method.npCurrency);
    const name = option
      ? `${option.asset} · ${option.network}`
      : method.npCurrency;
    return `${name} — ${method.address.slice(0, 8)}…${method.address.slice(-6)}`;
  };

  const handleClaim = async () => {
    setRequestError(null);
    if (!methodId) {
      setRequestError("Pick a crypto address first.");
      return;
    }
    if (!amountValid) {
      setRequestError(
        `Enter an amount between $0.01 and ${usd(availableBalance)}.`
      );
      return;
    }
    try {
      const amount = Math.round(parsedAmount * 100) / 100;
      await requestWithdrawal.mutateAsync({ methodId, amount });
      await Promise.all([
        utils.rewards.getMyEarnings.invalidate(),
        utils.cryptoPayouts.getMyOutstandingWithdrawal.invalidate(),
      ]);
      setAmountInput("");
      navigate("/earnings/claim/crypto/confirmation", {
        state: { amount, currency: "USD" },
      });
    } catch (error) {
      setRequestError(
        error instanceof Error ? error.message : "Could not queue the claim."
      );
    }
  };

  const handleCancel = async () => {
    if (!outstanding) return;
    setRequestError(null);
    try {
      await cancelWithdrawal.mutateAsync({ withdrawalId: outstanding.id });
      await Promise.all([
        utils.rewards.getMyEarnings.invalidate(),
        utils.cryptoPayouts.getMyOutstandingWithdrawal.invalidate(),
      ]);
      toast({ title: "Claim cancelled", description: "Balance restored." });
    } catch (error) {
      setRequestError(
        error instanceof Error ? error.message : "Could not cancel the claim."
      );
    }
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wallet className="h-5 w-5" />
          Claim to your crypto wallet
        </CardTitle>
        <CardDescription>
          Choose how much of your balance to claim. One claim at a time — the
          rest of your balance stays claimable once this one clears.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {earningsLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Checking your available balance…
          </div>
        ) : (
          <div className="flex items-center justify-between rounded-lg border p-3 text-sm">
            <span className="text-muted-foreground">Available balance</span>
            <span className="font-semibold">{usd(availableBalance)}</span>
          </div>
        )}

        {outstanding ? (
          // A claim is already queued — no second claim until it clears.
          <div className="space-y-3 rounded-lg border border-primary/40 bg-primary/5 p-4 text-sm">
            <p className="font-medium">You have a queued crypto claim.</p>
            <p className="text-muted-foreground">
              {usd(Number(outstanding.amount))} to{" "}
              {outstanding.address.slice(0, 8)}…{outstanding.address.slice(-6)} —
              it will go out with the next payout batch. Claim the rest of your
              balance once this one clears.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={handleCancel}
              disabled={cancelWithdrawal.isPending}
            >
              {cancelWithdrawal.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Cancel queued claim
            </Button>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <Label>Pay to</Label>
              {methodsQuery.isLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading your crypto addresses…
                </div>
              ) : methods.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No crypto address saved yet. Add one under{" "}
                  <Link className="underline" to="/bank-accounts">
                    Bank Accounts → Crypto Payments
                  </Link>{" "}
                  first.
                </p>
              ) : (
                <Select value={methodId} onValueChange={setMethodId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a crypto address" />
                  </SelectTrigger>
                  <SelectContent>
                    {methods.map((method) => (
                      <SelectItem key={method.id} value={method.id}>
                        {describeMethod(method)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="claim-amount">Amount to claim (USD)</Label>
                <button
                  type="button"
                  className="text-xs text-primary underline disabled:opacity-50"
                  onClick={() =>
                    setAmountInput(
                      String(Math.floor(availableBalance * 100) / 100)
                    )
                  }
                  disabled={availableBalance <= 0}
                >
                  Max ({usd(availableBalance)})
                </button>
              </div>
              <Input
                id="claim-amount"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                max={availableBalance}
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
                placeholder="e.g. 25.00"
              />
              <p className="text-xs text-muted-foreground">
                Up to your available balance. The rest stays claimable after
                this one is paid.
              </p>
            </div>
          </>
        )}

        {requestError && (
          <p className="text-sm text-destructive">{requestError}</p>
        )}

        <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={() => navigate("/earnings/claim")}>
            Back
          </Button>
          {!outstanding && (
            <Button
              onClick={handleClaim}
              disabled={
                requestWithdrawal.isPending ||
                !amountValid ||
                !methodId ||
                methods.length === 0
              }
            >
              {requestWithdrawal.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Claim {amountValid ? usd(Math.round(parsedAmount * 100) / 100) : ""}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default ClaimCryptoDetailsStep;
