import { useMemo, useState } from "react";
import { Loader2, Plus, Trash2, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { useToast } from "@/hooks/use-toast";
import { CRYPTO_PAYOUT_OPTIONS } from "@/shared/cryptoPayoutOptions";

// Crypto payout destinations. Rendered below the Bank Accounts card and open
// to every logged-in clipper: save a USDT/USDC address on a low-fee network
// and claim to it. Payouts are sent manually by an admin.
export const CryptoPaymentsPanel = () => {
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const methodsQuery = trpc.cryptoPayouts.getMyMethods.useQuery();
  const addMethod = trpc.cryptoPayouts.addMethod.useMutation();
  const deleteMethod = trpc.cryptoPayouts.deleteMethod.useMutation();

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [npCurrency, setNpCurrency] = useState<string>("");
  const [address, setAddress] = useState("");
  const [memo, setMemo] = useState("");
  const [label, setLabel] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const optionByCurrency = useMemo(
    () => new Map(CRYPTO_PAYOUT_OPTIONS.map((o) => [o.npCurrency, o])),
    []
  );


  const resetForm = () => {
    setNpCurrency("");
    setAddress("");
    setMemo("");
    setLabel("");
    setFormError(null);
  };

  const handleAdd = async () => {
    setFormError(null);
    if (!npCurrency) {
      setFormError("Pick a currency and network.");
      return;
    }
    if (address.trim().length < 20) {
      setFormError("That wallet address looks too short.");
      return;
    }
    try {
      await addMethod.mutateAsync({
        npCurrency,
        address: address.trim(),
        memo: memo.trim() || undefined,
        label: label.trim() || undefined,
      });
      toast({
        title: "Crypto address saved",
        description: "You can now claim your balance to this address.",
      });
      setIsDialogOpen(false);
      resetForm();
      await utils.cryptoPayouts.getMyMethods.invalidate();
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : "Could not save the address."
      );
    }
  };

  const handleDelete = async () => {
    if (!deleteTargetId) return;
    try {
      await deleteMethod.mutateAsync({ methodId: deleteTargetId });
      toast({ title: "Crypto address removed" });
      await utils.cryptoPayouts.getMyMethods.invalidate();
    } catch (error) {
      toast({
        title: "Could not remove address",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
    } finally {
      setDeleteTargetId(null);
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Wallet className="h-5 w-5" />
                Crypto Payments
              </CardTitle>
              <CardDescription>
                Get paid in USDT/USDC on cheap networks. Ethereum (ERC-20) and
                Tron (TRC-20) are not supported — their fees eat small payouts.
              </CardDescription>
            </div>
            <Button onClick={() => setIsDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Add address
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {methodsQuery.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading your crypto addresses…
            </div>
          ) : (methodsQuery.data?.length ?? 0) === 0 ? (
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>No crypto address saved.</p>
              <p>Click “Add address” to add a wallet for payouts.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {methodsQuery.data!.map((method) => {
                const option = optionByCurrency.get(method.npCurrency);
                return (
                  <div
                    key={method.id}
                    className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="font-medium">
                        {option
                          ? `${option.asset} · ${option.network}`
                          : method.npCurrency}
                        {method.label ? ` — ${method.label}` : ""}
                      </p>
                      <p className="truncate font-mono text-xs text-muted-foreground">
                        {method.address}
                        {method.memo ? `  (memo: ${method.memo})` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setDeleteTargetId(method.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={isDialogOpen}
        onOpenChange={(open) => {
          setIsDialogOpen(open);
          if (!open) resetForm();
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add a crypto address</DialogTitle>
            <DialogDescription>
              Double-check the network — funds sent on the wrong network are
              unrecoverable.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Currency & network</Label>
              <Select value={npCurrency} onValueChange={setNpCurrency}>
                <SelectTrigger>
                  <SelectValue placeholder="Select currency and network" />
                </SelectTrigger>
                <SelectContent>
                  {CRYPTO_PAYOUT_OPTIONS.map((option) => (
                    <SelectItem
                      key={option.npCurrency}
                      value={option.npCurrency}
                    >
                      {option.asset} — {option.network}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="crypto-address">Wallet address</Label>
              <Input
                id="crypto-address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Paste the deposit address"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="crypto-memo">Memo / tag (optional)</Label>
              <Input
                id="crypto-memo"
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                placeholder="Only if your wallet/exchange requires one (e.g. TON)"
                autoComplete="off"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="crypto-label">Label (optional)</Label>
              <Input
                id="crypto-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. My Binance USDT"
              />
            </div>
            {formError && (
              <p className="text-sm text-destructive">{formError}</p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsDialogOpen(false)}
              disabled={addMethod.isPending}
            >
              Cancel
            </Button>
            <Button onClick={handleAdd} disabled={addMethod.isPending}>
              {addMethod.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Save address
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(deleteTargetId)}
        onOpenChange={(open) => !open && setDeleteTargetId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this crypto address?</AlertDialogTitle>
            <AlertDialogDescription>
              Past payouts keep their records; you just won’t be able to claim
              to this address anymore.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
