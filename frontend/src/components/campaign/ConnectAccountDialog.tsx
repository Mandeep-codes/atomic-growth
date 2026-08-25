import { Button, Input, Label } from "@/components/ds";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { UseAccountVerification } from "@/hooks/useAccountVerification";
import { useToast } from "@/hooks/use-toast";
import { platformOptions } from "@/pages/social-verification-flow/platform-options";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { ArrowLeft, ArrowRight, Check, Copy } from "lucide-react";
import { useState } from "react";

type SupportedPlatform = (typeof platformOptions)[number]["id"];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fires once an account is verified, so the caller can continue its flow. */
  onConnected: () => void;
}

// Applying to a private campaign requires a verified account. That requirement
// used to be a REDIRECT to /verification - a different page in a different part
// of the app, with getting back to the campaign left to you. It is the most
// disorienting jump in the product and it sits at the exact moment someone has
// decided they want in. So the requirement comes to them instead: same steps,
// same procedures, run in a dialog over the campaign.
//
// Bio verification only. The routed flow also offers login-credential
// verification, which needs a generated inbox, a password and its own review
// step - too long for a dialog. That path stays available on the full page.

export const ConnectAccountDialog = ({
  open,
  onOpenChange,
  onConnected,
}: Props) => {
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const [platform, setPlatform] = useState<SupportedPlatform | null>(null);
  const [handle, setHandle] = useState("");

  const {
    startVerification,
    handleVerificationCheck,
    loadingVerificationCheck,
    verificationPhase,
    verificationCode,
  } = UseAccountVerification();

  const reset = () => {
    setPlatform(null);
    setHandle("");
  };

  const close = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const cleanHandle = handle.trim().replace(/^@/, "");
  const ready = Boolean(platform && cleanHandle);

  const onVerified = async () => {
    if (!platform) return;
    const ok = await handleVerificationCheck(platform, cleanHandle);
    if (!ok) return;
    utils.privateCampaigns.myVerifiedAccounts.invalidate();
    utils.verification.checkVerification.invalidate();
    toast({
      title: "Account connected",
      description: `@${cleanHandle} is verified.`,
    });
    close(false);
    onConnected();
  };

  const showingCode = verificationPhase === "ready" && verificationCode;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-md rounded-3xl border-border bg-card">
        <DialogHeader>
          <DialogTitle className="display-heading text-xl">
            Connect an account
          </DialogTitle>
          <DialogDescription className="text-sm">
            Verifying proves the account is yours, so nobody else can submit
            clips as you. You only do this once per account.
          </DialogDescription>
        </DialogHeader>

        {!platform ? (
          <div className="space-y-2">
            <Label>Where do you post?</Label>
            <div className="grid grid-cols-2 gap-2">
              {platformOptions.map((option) => {
                const Icon = option.icon;
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setPlatform(option.id)}
                    className="flex flex-col items-start gap-2 rounded-xl border border-border bg-muted/20 p-3 text-left transition-colors hover:border-foreground/40"
                  >
                    <Icon className="h-4 w-4" />
                    <span className="text-sm font-medium">{option.name}</span>
                    <span className="text-[11px] leading-tight text-muted-foreground">
                      {option.description}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : !showingCode ? (
          <div className="space-y-3">
            <Input
              label={`Your ${
                platformOptions.find((o) => o.id === platform)?.name
              } handle`}
              placeholder="yourhandle"
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
            />
            <Button
              block
              disabled={!ready}
              loading={verificationPhase === "initializing"}
              onClick={() => platform && startVerification(platform, cleanHandle)}
            >
              Get my code
              <ArrowRight className="h-4 w-4" />
            </Button>
            <button
              type="button"
              onClick={reset}
              className="flex w-full items-center justify-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="h-3 w-3" /> Change platform
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Add this code to the bio of{" "}
              <span className="font-medium text-foreground">@{cleanHandle}</span>
              , save the profile, then verify. You can remove it afterwards.
            </p>

            <button
              type="button"
              onClick={() => {
                navigator.clipboard?.writeText(verificationCode!);
                toast({ title: "Code copied" });
              }}
              className={cn(
                "flex w-full items-center justify-between gap-3 rounded-xl border border-border",
                "bg-muted/40 px-4 py-3 text-left transition-colors hover:border-foreground/40"
              )}
            >
              <span className="break-all font-mono text-sm">
                {verificationCode}
              </span>
              <Copy className="h-4 w-4 shrink-0 text-muted-foreground" />
            </button>

            <Button block loading={loadingVerificationCheck} onClick={onVerified}>
              I've added it — verify
              <Check className="h-4 w-4" />
            </Button>
            <button
              type="button"
              onClick={reset}
              className="flex w-full items-center justify-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="h-3 w-3" /> Start over
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default ConnectAccountDialog;
