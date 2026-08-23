import { useState } from "react";
import { Banknote, Loader2, Plus, Trash2 } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { CryptoPaymentsPanel } from "@/components/CryptoPaymentsPanel";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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

const countryConfigurations: Record<SupportedCountry, {
  label: string;
  currency: string;
  allowBusiness: boolean;
}> = {
  IN: { label: "India", currency: "INR", allowBusiness: true },
  NP: { label: "Nepal", currency: "NPR", allowBusiness: false },
  PH: { label: "Philippines", currency: "PHP", allowBusiness: false },
};

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

const BankAccounts = () => {
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formData, setFormData] = useState<BankAccountForm>(initialFormState);
  const [dialogStep, setDialogStep] = useState<"country" | "details">(
    "country"
  );

  const {
    data: wiseRecipient,
    isLoading,
    refetch,
  } = trpc.wiseRecipients.getMine.useQuery();
  const createRecipient = trpc.wiseRecipients.create.useMutation();
  const deleteRecipient = trpc.wiseRecipients.delete.useMutation();
  const selectedCountryConfig = countryConfigurations[formData.country_code];
  const philippineBanksQuery = trpc.wiseRecipients.getPhilippinesBanks.useQuery(
    undefined,
    { enabled: formData.country_code === "PH", staleTime: 60 * 60 * 1000 }
  );
  const philippineBanks = philippineBanksQuery.data ?? [];

  const handleOpenDialog = () => {
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
    setDialogStep(wiseRecipient?.summary ? "details" : "country");
    trackEvent({ event: "wise_recipient_modal_opened" });
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setTimeout(() => {
      setFormData(initialFormState);
      setFormError(null);
      setDialogStep("country");
    }, 200);
  };

  const handleDialogChange = (open: boolean) => {
    if (open) {
      setIsDialogOpen(true);
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

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);

    const commonPayload = {
      accountHolderName: formData.account_holder.trim(),
      addressFirstLine: formData.address_first_line.trim(),
      addressCity: formData.address_city.trim(),
      addressPostCode: formData.address_post_code.trim(),
    };

    try {
      trackEvent({ event: "wise_recipient_submit_attempt" });
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
        title: "Recipient created",
      });
      trackEvent({
        event: "recipient_submit_result",
        properties: { status: "success" },
      });
      refetch();
      handleCloseDialog();
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to create Wise recipient";
      setFormError(message);
      trackEvent({
        event: "wise_recipient_submit_result",
        properties: { status: "error", errorMessage: message },
      });
    }
  };

  const handleDeleteConfirm = async () => {
    try {
      trackEvent({ event: "wise_recipient_delete_attempt" });
      await deleteRecipient.mutateAsync();
      toast({
        title: "Recipient removed",
        description: "You can add another account at any time.",
      });
      refetch();
      setIsDeleteDialogOpen(false);
      trackEvent({
        event: "wise_recipient_delete_result",
        properties: { status: "success" },
      });
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to remove Wise recipient";
      toast({
        title: "Error",
        description: message,
        variant: "destructive",
      });
      trackEvent({
        event: "wise_recipient_delete_result",
        properties: { status: "error", errorMessage: message },
      });
    }
  };

  return (
    <AppLayout>
      <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8">
        <div>
          <h1 className="text-2xl font-bold">Receive Payments</h1>
          <p className="text-sm text-muted-foreground">
            Choose how you want to receive your payouts.
          </p>
        </div>

        <Card>
          <CardHeader>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle className="flex items-center gap-2">
                <Banknote className="h-5 w-5" />
                Bank Account
              </CardTitle>
              <div className="flex gap-2">
                <Button onClick={handleOpenDialog}>
                  <Plus className="mr-2 h-4 w-4" />
                  {wiseRecipient ? "Update account" : "Add account"}
                </Button>
                {wiseRecipient && (
                  <Button
                    variant="outline"
                    onClick={() => setIsDeleteDialogOpen(true)}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Remove
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Checking your payout details…
              </div>
            ) : wiseRecipient ? (
              wiseRecipient.summary ? (
                <div className="space-y-3">
                  <div>
                    <p className="text-sm text-muted-foreground">
                      Account holder
                    </p>
                    <p className="text-base font-medium">
                      {wiseRecipient.summary.accountHolderName ?? "Unknown"}
                    </p>
                  </div>
                  <div className="grid gap-2 text-sm text-muted-foreground md:grid-cols-2">
                    <div>
                      <span className="font-medium text-foreground">
                        {wiseRecipient.summary.routingCodeLabel ?? "Routing code"}:
                      </span>{" "}
                      {wiseRecipient.summary.routingCodeValue ?? "Not available"}
                    </div>
                    <div>
                      <span className="font-medium text-foreground">
                        Account ending in:
                      </span>{" "}
                      {wiseRecipient.summary.last4 ?? "Unknown"}
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground space-y-1 sm:flex sm:flex-wrap sm:gap-4 sm:space-y-0">
                    <span>
                      Recipient ID:{" "}
                      <span className="font-mono">
                        {wiseRecipient.recipientId}
                      </span>
                    </span>
                    <span>
                      Country: {wiseRecipient.summary.addressCountry ?? "—"} · Currency: {
                        wiseRecipient.summary.currency ?? "—"
                      }
                    </span>
                  </div>
                  {/* <p className="text-sm text-muted-foreground">
                    We fetch these details from Wise each time you visit this
                    page. Update the account if anything changes.
                  </p> */}
                </div>
              ) : (
                <div className="space-y-2 text-sm text-muted-foreground">
                  <p>We couldn’t fetch the latest details from Wise.</p>
                  <p>
                    Recipient ID:{" "}
                    <span className="font-mono">
                      {wiseRecipient.recipientId}
                    </span>
                  </p>
                </div>
              )
            ) : (
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>No bank account found.</p>
                <p>Click “Add account” to enter your bank details.</p>
              </div>
            )}
          </CardContent>
        </Card>

        <CryptoPaymentsPanel />
      </div>

      <Dialog open={isDialogOpen} onOpenChange={handleDialogChange}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {wiseRecipient ? "Update bank details" : "Add bank details"}
            </DialogTitle>
            <DialogDescription>
              We’ll send this information directly to Wise to create a
              recipient. The data is not stored in Atomik.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4 py-2">
            {formError && (
              <Alert variant="destructive">
                <AlertTitle>Failed to create account</AlertTitle>
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            )}

            {dialogStep === "country" ? (
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
                <DialogFooter className="pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleCloseDialog}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    onClick={() => setDialogStep("details")}
                  >
                    Continue
                  </Button>
                </DialogFooter>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2 text-sm">
                  <span>
                    Bank country:{" "}
                    <span className="font-medium">
                      {selectedCountryConfig.label} (
                      {selectedCountryConfig.currency})
                    </span>
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-auto px-2 py-1 text-xs"
                    onClick={() => setDialogStep("country")}
                  >
                    Change
                  </Button>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="account_holder">Account holder name</Label>
                  <Input
                    id="account_holder"
                    value={formData.account_holder}
                    onChange={(event) =>
                      setFormData({
                        ...formData,
                        account_holder: event.target.value,
                      })
                    }
                    placeholder="Full legal name"
                    required
                  />
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
                  <SelectValue placeholder="Select account type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PRIVATE">Individual</SelectItem>
                  <SelectItem value="BUSINESS">Business</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {selectedCountryConfig.allowBusiness
                  ? "Select “Business” if this recipient belongs to a registered company."
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
                      setFormData({
                        ...formData,
                        account_number: event.target.value,
                      })
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
                      setFormData({
                        ...formData,
                        ifsc_code: event.target.value.toUpperCase(),
                      })
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
                    setFormData({
                      ...formData,
                      account_number: event.target.value,
                    })
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
                  setFormData({
                    ...formData,
                    address_first_line: event.target.value,
                  })
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
                    setFormData({
                      ...formData,
                      address_city: event.target.value,
                    })
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
                    setFormData({
                      ...formData,
                      address_post_code: event.target.value,
                    })
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
                    onClick={() => setDialogStep("country")}
                  >
                    Back
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
              </>
            )}
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove recipient?</AlertDialogTitle>
            <AlertDialogDescription>
              You can create a new recipient whenever you need to update your
              bank details.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm}>
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
    </AppLayout>
  );
};

export default BankAccounts;
