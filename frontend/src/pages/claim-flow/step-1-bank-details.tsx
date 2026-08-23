import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Plus, Trash2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
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
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { trackEvent } from "@/lib/analytics";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { WISE_NEPAL_BANKS } from "@/shared/wiseNepalBanks";

type SupportedCountry = "IN" | "NP" | "PH";

const countryConfigurations: Record<SupportedCountry, {
  label: string;
  currency: string;
  allowBusiness: boolean;
}> = {
  IN: { label: "India", currency: "INR", allowBusiness: true },
  NP: { label: "Nepal", currency: "NPR", allowBusiness: false },
  PH: { label: "Philippines", currency: "PHP", allowBusiness: false },
};

interface BankAccountForm {
  account_holder: string;
  account_number: string;
  ifsc_code: string;
  bank_code: string;
  address_first_line: string;
  address_city: string;
  address_post_code: string;
  legal_type: "PRIVATE" | "BUSINESS";
  country_code: SupportedCountry;
}

const initialFormState: BankAccountForm = {
  account_holder: "",
  account_number: "",
  ifsc_code: "",
  bank_code: "",
  address_first_line: "",
  address_city: "",
  address_post_code: "",
  legal_type: "PRIVATE",
  country_code: "IN",
};

const ClaimBankDetailsStep = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [formData, setFormData] = useState<BankAccountForm>(initialFormState);

  const utils = trpc.useUtils();
  const {
    data: wiseRecipient,
    isLoading,
    refetch,
  } = trpc.wiseRecipients.getMine.useQuery();
  const { data: earnings, isLoading: isBalanceLoading } =
    trpc.rewards.getMyEarnings.useQuery();
  const createRecipient = trpc.wiseRecipients.create.useMutation();
  const deleteRecipient = trpc.wiseRecipients.delete.useMutation();
  const requestWithdrawal = trpc.wise.requestMyWithdrawal.useMutation();
  const selectedCountryConfig = countryConfigurations[formData.country_code];
  const philippineBanksQuery = trpc.wiseRecipients.getPhilippinesBanks.useQuery(
    undefined,
    { enabled: formData.country_code === "PH", staleTime: 60 * 60 * 1000 }
  );
  const philippineBanks = philippineBanksQuery.data ?? [];

  const availableBalance = earnings?.currentBalance ?? 0;
  const hasBalance = availableBalance > 0;

  const handleDialogOpen = () => {
    if (wiseRecipient?.summary) {
      const summary = wiseRecipient.summary;
      const summaryCountry = summary.addressCountry;
      const countryCode: SupportedCountry =
        summaryCountry === "NP" || summaryCountry === "PH" ? summaryCountry : "IN";
      const routingLabel = summary.routingCodeLabel;
      const routingValue = summary.routingCodeValue ?? "";
      const allowBusiness = countryConfigurations[countryCode].allowBusiness;

      setFormData({
        account_holder: summary.accountHolderName ?? "",
        account_number: summary.accountNumber ?? "",
        ifsc_code:
          countryCode === "IN" && routingLabel === "IFSC code" ? routingValue : "",
        bank_code:
          (countryCode === "NP" || countryCode === "PH") &&
          routingLabel === "Bank code"
            ? routingValue
            : "",
        address_first_line: summary.addressFirstLine ?? "",
        address_city: summary.addressCity ?? "",
        address_post_code: summary.addressPostCode ?? "",
        legal_type:
          allowBusiness && summary.legalType === "BUSINESS" ? "BUSINESS" : "PRIVATE",
        country_code: countryCode,
      });
    } else {
      setFormData(initialFormState);
    }
    setFormError(null);
    setRequestError(null);
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setTimeout(() => {
      setFormData(initialFormState);
      setFormError(null);
      setRequestError(null);
    }, 200);
  };

  const handleDialogChange = (open: boolean) => {
    if (open) {
      handleDialogOpen();
    } else {
      handleCloseDialog();
    }
  };

  const handleCountryChange = (country: SupportedCountry) => {
    setFormData((prev) => {
      const allowBusiness = countryConfigurations[country].allowBusiness;
      return {
        ...prev,
        country_code: country,
        legal_type: allowBusiness ? prev.legal_type : "PRIVATE",
        account_number: prev.account_number,
        ifsc_code: country === "IN" ? prev.ifsc_code : "",
        bank_code: country === "NP" || country === "PH" ? prev.bank_code : "",
      };
    });
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    setRequestError(null);

    const commonPayload = {
      accountHolderName: formData.account_holder.trim(),
      addressFirstLine: formData.address_first_line.trim(),
      addressCity: formData.address_city.trim(),
      addressPostCode: formData.address_post_code.trim(),
    };

    try {
      trackEvent({ event: "claim_flow_wise_recipient_submit_attempt" });
      if (formData.country_code === "IN") {
        await createRecipient.mutateAsync({
          countryCode: "IN",
          ...commonPayload,
          accountNumber: formData.account_number.trim(),
          ifscCode: formData.ifsc_code.trim(),
          legalType: formData.legal_type,
        });
      } else if (formData.country_code === "NP") {
        if (!formData.bank_code) {
          setFormError("Select a bank before continuing.");
          return;
        }
        await createRecipient.mutateAsync({
          countryCode: "NP",
          ...commonPayload,
          bankCode: formData.bank_code,
          accountNumber: formData.account_number.trim(),
          legalType: "PRIVATE",
        });
      } else {
        if (!formData.bank_code) {
          setFormError("Select a bank before continuing.");
          return;
        }
        await createRecipient.mutateAsync({
          countryCode: "PH",
          ...commonPayload,
          bankCode: formData.bank_code,
          accountNumber: formData.account_number.trim(),
          legalType: "PRIVATE",
        });
      }

      toast({
        title: wiseRecipient ? "Recipient updated" : "Recipient created",
        description: "We’ll use this account for your next payout.",
      });

      trackEvent({
        event: "claim_flow_wise_recipient_submit_result",
        properties: { status: "success" },
      });
      await refetch();
      handleCloseDialog();
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to save bank account";
      setFormError(message);
      trackEvent({
        event: "claim_flow_wise_recipient_submit_result",
        properties: { status: "error", errorMessage: message },
      });
    }
  };

  const handleContinue = async () => {
    setRequestError(null);

    if (!wiseRecipient) {
      setRequestError("Add a bank account before continuing.");
      return;
    }

    if (!hasBalance) {
      setRequestError("You need a positive balance to request a payout.");
      return;
    }

    try {
      await requestWithdrawal.mutateAsync();
      await Promise.all([
        utils.rewards.getMyEarnings.invalidate(),
        refetch(),
      ]);
      navigate("/earnings/claim/bank/confirmation", {
        state: {
          amount: availableBalance,
          currency: "USD",
        },
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to start withdrawal request.";
      setRequestError(message);
    }
  };

  const handleDeleteConfirm = async () => {
    try {
      trackEvent({ event: "claim_flow_wise_recipient_delete_attempt" });
      await deleteRecipient.mutateAsync();
      toast({
        title: "Recipient removed",
        description: "Add a new bank account before your next claim.",
      });
      await refetch();
      setIsDeleteDialogOpen(false);
      trackEvent({
        event: "claim_flow_wise_recipient_delete_result",
        properties: { status: "success" },
      });
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to remove Wise recipient";
      toast({
        title: "Error removing account",
        description: message,
        variant: "destructive",
      });
      trackEvent({
        event: "claim_flow_wise_recipient_delete_result",
        properties: { status: "error", errorMessage: message },
      });
    }
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Choose where we should send your payout</CardTitle>
        <CardDescription>
          Atomik uses Wise to send payouts directly to bank accounts in India,
          Nepal, and the Philippines.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* <div className="rounded-lg border bg-muted/40 p-4 text-sm">
          {isBalanceLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Checking your available balance…
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              <span className="text-muted-foreground">Available balance</span>
              <span className="text-lg font-semibold">
                {new Intl.NumberFormat("en-US", {
                  style: "currency",
                  currency: "USD",
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                }).format(availableBalance)}
              </span>
            </div>
          )}
        </div> */}

        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Checking your payout details…
          </div>
        ) : wiseRecipient ? (
          <div className="space-y-3 rounded-lg border bg-muted/40 p-4">
            <div>
              <p className="text-sm text-muted-foreground">Account holder</p>
              <p className="text-base font-medium">
                {wiseRecipient.summary?.accountHolderName ?? "Unknown"}
              </p>
            </div>
            <div className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
              <div>
                <span className="font-medium text-foreground">
                  {wiseRecipient.summary?.routingCodeLabel ?? "Routing code"}:
                </span>{" "}
                {wiseRecipient.summary?.routingCodeValue ?? "—"}
              </div>
              <div>
                <span className="font-medium text-foreground">
                  Account ending in:
                </span>{" "}
                {wiseRecipient.summary?.last4 ?? "—"}
              </div>
            </div>
            <div className="text-xs text-muted-foreground space-y-1 sm:flex sm:flex-wrap sm:gap-4 sm:space-y-0">
              <span>
                Recipient ID:{" "}
                <span className="font-mono">{wiseRecipient.recipientId}</span>
              </span>
              <span>
                Country: {wiseRecipient.summary?.addressCountry ?? "—"} · Currency: {
                  wiseRecipient.summary?.currency ?? "—"
                }
              </span>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            No bank account on file. Add one to receive your next payout.
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={handleDialogOpen}>
            <Plus className="mr-2 h-4 w-4" />
            {wiseRecipient ? "Update bank account" : "Add bank account"}
          </Button>
          {wiseRecipient ? (
            <Button
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={() => setIsDeleteDialogOpen(true)}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Remove
            </Button>
          ) : null}
        </div>

        <div className="rounded-lg bg-muted px-4 py-3 text-sm text-muted-foreground">
          We’ll queue your withdrawal for the next payment cycle after you
          confirm the payout details.
        </div>

        {requestError ? (
          <Alert variant="destructive">
            <AlertTitle>Unable to continue</AlertTitle>
            <AlertDescription>{requestError}</AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
          {(!wiseRecipient || !hasBalance) && (
            <p className="text-sm text-muted-foreground">
              {wiseRecipient
                ? "Your balance must be greater than $0."
                : "Add a bank account to continue."}
            </p>
          )}
          <Button
            onClick={handleContinue}
            disabled={!wiseRecipient || !hasBalance || requestWithdrawal.isPending}
          >
            {requestWithdrawal.isPending ? (
              <span className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Requesting…
              </span>
            ) : (
              "Continue"
            )}
          </Button>
        </div>
      </CardContent>

      <Dialog open={isDialogOpen} onOpenChange={handleDialogChange}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {wiseRecipient ? "Update bank details" : "Add bank details"}
            </DialogTitle>
            <DialogDescription>
              We’ll send this information to Wise to create a payout recipient.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4 py-2">
            {formError ? (
              <Alert variant="destructive">
                <AlertTitle>Unable to save bank account</AlertTitle>
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor="account_holder">Account holder name</Label>
              <Input
                id="account_holder"
                value={formData.account_holder}
                onChange={(event) =>
                  setFormData((prev) => ({
                    ...prev,
                    account_holder: event.target.value,
                  }))
                }
                placeholder="Full legal name"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="country_code">Bank country</Label>
              <Select
                value={formData.country_code}
                onValueChange={(value) =>
                  handleCountryChange(value as SupportedCountry)
                }
              >
                <SelectTrigger id="country_code">
                  <SelectValue placeholder="Select country" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="IN">India (INR)</SelectItem>
                  <SelectItem value="NP">Nepal (NPR)</SelectItem>
                  <SelectItem value="PH">Philippines (PHP)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Atomik sends payouts in {selectedCountryConfig.currency} to
                banks located in {selectedCountryConfig.label}.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="legal_type">Account type</Label>
              <Select
                value={formData.legal_type}
                onValueChange={(value) =>
                  setFormData((prev) => ({
                    ...prev,
                    legal_type: value as "PRIVATE" | "BUSINESS",
                  }))
                }
                disabled={!selectedCountryConfig.allowBusiness}
              >
                <SelectTrigger id="legal_type">
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PRIVATE">Individual</SelectItem>
                  <SelectItem value="BUSINESS">Business</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {selectedCountryConfig.allowBusiness
                  ? "Choose “Business” if the account belongs to a registered company."
                  : `Only individual recipients are supported in ${selectedCountryConfig.label}.`}
              </p>
            </div>

            {formData.country_code === "NP" && (
              <div className="space-y-2">
                <Label htmlFor="bank_code">Bank name</Label>
                <Select
                  value={formData.bank_code}
                  onValueChange={(value) =>
                    setFormData((prev) => ({ ...prev, bank_code: value }))
                  }
                >
                  <SelectTrigger id="bank_code">
                    <SelectValue placeholder="Select bank" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {WISE_NEPAL_BANKS.map((bank) => (
                      <SelectItem key={bank.code} value={bank.code}>
                        {bank.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Pick the bank where you receive NPR deposits.
                </p>
              </div>
            )}

            {formData.country_code === "PH" && (
              <div className="space-y-2">
                <Label htmlFor="bank_code">Bank name</Label>
                {philippineBanksQuery.isLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading banks…
                  </div>
                ) : philippineBanks.length > 0 ? (
                  <Select
                    value={formData.bank_code}
                    onValueChange={(value) =>
                      setFormData((prev) => ({ ...prev, bank_code: value }))
                    }
                  >
                    <SelectTrigger id="bank_code">
                      <SelectValue placeholder="Select bank" />
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      {philippineBanks.map((bank) => (
                        <SelectItem key={bank.code} value={bank.code}>
                          {bank.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    id="bank_code"
                    value={formData.bank_code}
                    onChange={(event) =>
                      setFormData((prev) => ({
                        ...prev,
                        bank_code: event.target.value,
                      }))
                    }
                    placeholder="Bank code (e.g. BDO)"
                    required
                  />
                )}
                <p className="text-xs text-muted-foreground">
                  Pick the bank where you receive PHP deposits.
                </p>
              </div>
            )}

            {formData.country_code === "IN" ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="account_number">Account number</Label>
                  <Input
                    id="account_number"
                    value={formData.account_number}
                    onChange={(event) =>
                      setFormData((prev) => ({
                        ...prev,
                        account_number: event.target.value,
                      }))
                    }
                    placeholder="Account number"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ifsc_code">IFSC code</Label>
                  <Input
                    id="ifsc_code"
                    value={formData.ifsc_code}
                    onChange={(event) =>
                      setFormData((prev) => ({
                        ...prev,
                        ifsc_code: event.target.value.toUpperCase(),
                      }))
                    }
                    placeholder="e.g. HDFC0001234"
                    required
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="account_number">Account number</Label>
                <Input
                  id="account_number"
                  value={formData.account_number}
                  onChange={(event) =>
                    setFormData((prev) => ({
                      ...prev,
                      account_number: event.target.value,
                    }))
                  }
                  placeholder="Account number"
                  required
                />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="address_first_line">Street address</Label>
              <Input
                id="address_first_line"
                value={formData.address_first_line}
                onChange={(event) =>
                  setFormData((prev) => ({
                    ...prev,
                    address_first_line: event.target.value,
                  }))
                }
                placeholder="House / street"
                required
              />
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="address_city">City</Label>
                <Input
                  id="address_city"
                  value={formData.address_city}
                  onChange={(event) =>
                    setFormData((prev) => ({
                      ...prev,
                      address_city: event.target.value,
                    }))
                  }
                  placeholder="City"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="address_post_code">Postal code</Label>
                <Input
                  id="address_post_code"
                  value={formData.address_post_code}
                  onChange={(event) =>
                    setFormData((prev) => ({
                      ...prev,
                      address_post_code: event.target.value,
                    }))
                  }
                  placeholder="Postal code"
                  required
                />
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={handleCloseDialog}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={createRecipient.isPending}>
                {createRecipient.isPending ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Saving…
                  </span>
                ) : wiseRecipient ? (
                  "Update recipient"
                ) : (
                  "Create recipient"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove bank account?</AlertDialogTitle>
            <AlertDialogDescription>
              We’ll stop routing payouts to this Wise recipient. You can add a
              new account any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteRecipient.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              disabled={deleteRecipient.isPending}
            >
              {deleteRecipient.isPending ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Removing…
                </span>
              ) : (
                "Remove"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
};

export default ClaimBankDetailsStep;
