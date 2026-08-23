import { KeyboardEvent, useContext, useEffect, useMemo, useState } from "react";
import { SubmissionContext } from "./SubmissionContext";
import { StepSection, StepStatus } from "./StepSection";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useToast } from "@/hooks/use-toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  PHONE_COUNTRY_CODES,
  type PhoneCountryCode,
} from "@/lib/phoneCountryCodes";

interface SubmissionPhoneStepProps {
  step: number;
  phoneNumber?: string | null;
  phoneCountryCode?: string | null;
}

export const SubmissionPhoneStep = ({
  step,
  phoneNumber,
  phoneCountryCode,
}: SubmissionPhoneStepProps) => {
  const ctx = useContext(SubmissionContext);
  if (!ctx) {
    throw new Error("SubmissionPhoneStep must be used within SubmissionProvider");
  }

  const {
    step3Complete,
    phoneStepComplete,
    setPhoneStepComplete,
  } = ctx;
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const defaultCountryCode = "+91";
  const [phoneInput, setPhoneInput] = useState(phoneNumber ?? "");
  const [countryCode, setCountryCode] = useState(
    phoneCountryCode ?? defaultCountryCode
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    setPhoneInput(phoneNumber ?? "");
  }, [phoneNumber]);

  useEffect(() => {
    setCountryCode(phoneCountryCode ?? defaultCountryCode);
  }, [phoneCountryCode]);

  const options = useMemo(() => {
    return [...PHONE_COUNTRY_CODES].sort((a, b) =>
      a.country.localeCompare(b.country)
    );
  }, []);


  const updatePhone = trpc.user.updatePhoneNumber.useMutation({
    onSuccess: ({ phoneNumber: savedPhone, phoneCountryCode: savedCode }) => {
      setPhoneStepComplete(true);
      utils.user.getProfile.setData(undefined, (prev) =>
        prev
          ? {
            ...prev,
            phoneNumber: savedPhone,
            phoneCountryCode: savedCode,
          }
          : prev
      );
      toast({
        title: "Phone number saved",
      });
      setErrorMessage(null);
    },
    onError: (error) => {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to save your phone number."
      );
    },
  });

  const handleSave = () => {
    setErrorMessage(null);
    if (!phoneInput.trim()) {
      setErrorMessage("Enter your phone number before continuing.");
      return;
    }
    if (!countryCode) {
      setErrorMessage("Select your country code.");
      return;
    }
    updatePhone.mutate({
      phoneNumber: phoneInput,
      phoneCountryCode: countryCode,
    });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      handleSave();
    }
  };

  const stepStatus: StepStatus = !step3Complete
    ? "pending"
    : phoneStepComplete
      ? "complete"
      : "current";

  const isSaving = updatePhone.isPending;

  return (
    <StepSection
      step={step}
      status={stepStatus}
      title="Add a phone number"
      description="We'll only reach out if there's an issue with a submission."
      disabledMessage="Complete the previous steps to continue."
    >
      <div className="space-y-4" role="form" aria-label="Phone number">
        <div className="space-y-2">
          <Label htmlFor="submission-phone">Phone number</Label>
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="sm:w-52">
              <Select
                value={countryCode}
                onValueChange={(value) => setCountryCode(value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select country" />
                </SelectTrigger>
                <SelectContent>
                  {options.map((option: PhoneCountryCode) => (
                    <SelectItem key={option.code} value={option.code}>
                      {option.country} ({option.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1">
              <Input
                id="submission-phone"
                placeholder="Enter your phone"
                value={phoneInput}
                onChange={(event) => setPhoneInput(event.target.value)}
                onKeyDown={handleKeyDown}
                autoComplete="tel"
                inputMode="tel"
                required
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Pick the country where you receive creator payouts so we can reach
            you quickly if there’s an issue with a clip or a payment.
          </p>
        </div>
        {errorMessage ? (
          <p className="text-xs text-destructive" role="alert">
            {errorMessage}
          </p>
        ) : null}
        <div className="flex justify-end">
          <Button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="w-full sm:w-auto"
          >
            {isSaving ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving
              </span>
            ) : phoneStepComplete ? (
              "Update number"
            ) : (
              "Save number"
            )}
          </Button>
        </div>
      </div>
    </StepSection>
  );
};
