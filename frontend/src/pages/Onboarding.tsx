import BankAccounts from "@/pages/BankAccounts";
import { TopNav } from "@/components/TopNav";
import {
  Button,
  Card,
  Input,
  Label,
  Chip,
  Steps,
} from "@/components/ds";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { useAuth } from "@/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { useToast } from "@/hooks/use-toast";
import { OTP_LENGTH, getDevOtpCode, usePhoneOtp } from "@/lib/phoneOtp";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ExternalLink,
  MessageCircle,
  Pencil,
} from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

// ─────────────────────────────────────────────────────────────────────────────
// ONBOARDING
//
// A shell around flows that already exist. Nothing here implements auth,
// payouts or verification — it sequences and re-presents what the app already
// does, which is the rule for this redesign.
//
//   Step 1 Discord   — Clerk session (already established to reach this page)
//                      + the existing Discord server invite
//   Step 2 Payout    — RENDERS THE EXISTING BankAccounts PAGE. Not a copy of
//                      it. That form is country-branching (bank_code / IFSC /
//                      account_number differ per country) and rebuilding it
//                      here would create a second implementation that drifts
//                      from the real one's fields and validation.
//   Step 3 Experience— NOT BACKED BY ANYTHING TODAY. See the note on the step.
//   Step 4 Phone     — number, then a 6-digit code confirmed in this same card
//                      before the step will finish. Transport lives in
//                      lib/phoneOtp.ts, which is the ONLY place that needs
//                      touching when the backend procedures land.
//
// SKIP AND BACK SIT AT THE TOP of the card, not under the primary button.
// Underneath, "Skip for now" sat directly below "Continue" in matching width,
// which reads as a second suggestion rather than an escape hatch — and on the
// payout step it landed below the fold entirely, past an embedded page.
// ─────────────────────────────────────────────────────────────────────────────

const DISCORD_INVITE =
  "https://discord.com/channels/1395157211839201400/1395362775534014525";

const STEP_LABELS = ["Discord", "Payout", "Experience", "Phone"];

const Onboarding = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const utils = trpc.useUtils();

  const [step, setStep] = useState(0);
  const [joinedDiscord, setJoinedDiscord] = useState(false);

  // Local only — see the step 3 note.
  const [experience, setExperience] = useState({
    years: "",
    platforms: [] as string[],
    clipsPerWeek: "",
  });

  const profile = trpc.user.getProfile.useQuery(undefined, {
    enabled: Boolean(user),
  });
  const [phone, setPhone] = useState({ countryCode: "+91", number: "" });
  const [code, setCode] = useState("");
  const otp = usePhoneOtp();

  const updatePhone = trpc.user.updatePhoneNumber.useMutation({
    onSuccess: () => {
      utils.user.getProfile.invalidate();
      finish();
    },
    onError: (error) =>
      toast({
        title: "Could not save your number",
        description: error.message,
        variant: "destructive",
      }),
  });

  const next = () => setStep((s) => Math.min(s + 1, STEP_LABELS.length - 1));
  const back = () => setStep((s) => Math.max(s - 1, 0));

  const finish = () => {
    // Local demo only: the stubbed Clerk provider starts signed out so the
    // public pages can be reviewed. With the real SDK the session already
    // exists here and this branch never runs.
    if (import.meta.env.VITE_LOCAL_DEV === "true") {
      window.localStorage.setItem("dev-onboarded", "true");
      window.localStorage.removeItem("dev-signed-out");
      window.location.href = "/";
      return;
    }
    navigate("/");
  };

  const togglePlatform = (p: string) =>
    setExperience((e) => ({
      ...e,
      platforms: e.platforms.includes(p)
        ? e.platforms.filter((x) => x !== p)
        : [...e.platforms, p],
    }));

  const phoneReady =
    Boolean(phone.number.trim()) && Boolean(phone.countryCode.trim());

  const handleSendCode = async () => {
    setCode("");
    const ok = await otp.send(phone.number, phone.countryCode);
    if (ok) {
      const dev = getDevOtpCode();
      toast({
        title: `Code sent to ${phone.countryCode} ${phone.number}`,
        description: dev
          ? `Local dev — your code is ${dev}`
          : "It should arrive within a few seconds.",
      });
    }
  };

  const handleVerify = async (value: string) => {
    const ok = await otp.verify(phone.number, phone.countryCode, value);
    if (!ok) {
      setCode("");
      return;
    }
    // The number is only written once the code has checked out, so an
    // unverified number can never reach the profile.
    updatePhone.mutate({
      phoneNumber: phone.number,
      phoneCountryCode: phone.countryCode,
    });
  };

  // Steps that can be passed over. Discord gates identity and Experience has a
  // Continue that saves nothing anyway, so neither offers a skip.
  const skippable = step === 1 || step === 3;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <TopNav />

      <main className="mx-auto max-w-2xl space-y-8 px-6 py-10">
        <Steps steps={STEP_LABELS} current={step} />

        <Card className="space-y-6 p-6 sm:p-8">
          {/* ── Top rail: back on the left, skip on the right ───────────── */}
          {step > 0 || skippable ? (
            <div className="-mt-1 flex items-center justify-between gap-4">
              {step > 0 ? (
                <button
                  type="button"
                  onClick={back}
                  className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground transition-colors hover:text-foreground"
                >
                  <ArrowLeft className="h-3.5 w-3.5" /> Back
                </button>
              ) : (
                <span />
              )}

              {skippable ? (
                <button
                  type="button"
                  onClick={step === 3 ? finish : next}
                  className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground"
                >
                  Skip for now
                </button>
              ) : (
                <span />
              )}
            </div>
          ) : null}

          <div className="space-y-2">
            <Label>
              Step {step + 1} of {STEP_LABELS.length}
            </Label>
            <h1 className="display-heading text-2xl sm:text-3xl">
              {["Connect Discord", "Get paid", "Your experience", "Your phone number"][step]}
            </h1>
          </div>

          {/* ── 1. Discord ───────────────────────────────────────────────── */}
          {step === 0 ? (
            <div className="space-y-4">
              <p className="text-sm leading-relaxed text-muted-foreground">
                Atomik Clips identifies you by your Discord account, and
                campaign announcements and payout updates go out on the server.
                Join it, then come back here.
              </p>

              {user ? (
                <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/40 px-4 py-3">
                  <Check className="h-4 w-4 shrink-0" />
                  <span className="text-sm">
                    Signed in as{" "}
                    <span className="font-medium">
                      {user.user_metadata.display_name || user.email}
                    </span>
                  </span>
                </div>
              ) : null}

              <a
                href={DISCORD_INVITE}
                target="_blank"
                rel="noreferrer"
                onClick={() => setJoinedDiscord(true)}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-card px-5 py-3.5 font-mono text-xs font-extrabold uppercase tracking-[0.18em] transition-colors hover:border-foreground/40"
              >
                <MessageCircle className="h-4 w-4" />
                <span>Join the Discord server</span>
                <ExternalLink className="h-3.5 w-3.5 opacity-60" />
              </a>

              <Button block onClick={next} disabled={!joinedDiscord}>
                {joinedDiscord ? "Continue" : "Join the server first"}
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          ) : null}

          {/* ── 2. Payout method ─────────────────────────────────────────── */}
          {step === 1 ? (
            <div className="space-y-4">
              <p className="text-sm leading-relaxed text-muted-foreground">
                Choose how you want to be paid. You can set this up later
                instead — it does not block you from clipping.
              </p>

              {/* The real Receive Payments screen, embedded. It already offers
                  both bank and crypto with their own dialogs, so there is no
                  chooser here — adding one would just be a second, drifting
                  copy of a decision that screen already makes. AppLayout
                  no-ops when nested, so it renders bare inside this card. */}
              <div className="-mx-2 rounded-2xl border border-border bg-muted/20">
                <BankAccounts />
              </div>

              <Button block onClick={next}>
                Continue
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          ) : null}

          {/* ── 3. Clipper experience ────────────────────────────────────── */}
          {step === 2 ? (
            <div className="space-y-4">
              {/* NOTHING STORES THIS YET. There is no column, no procedure and
                  no validation for these three answers anywhere in the app —
                  they came from the design mock, not the product. Presented as
                  optional so nobody is blocked by a question we cannot save.
                  Needs a schema decision before it can be wired. */}
              <p className="text-sm leading-relaxed text-muted-foreground">
                These answers help match you to campaigns. Optional — nothing
                here is required to start clipping.
              </p>

              <Input
                label="Years of clipping"
                inputMode="numeric"
                placeholder="e.g. 2"
                value={experience.years}
                onChange={(e) =>
                  setExperience((x) => ({ ...x, years: e.target.value }))
                }
              />

              <div className="space-y-2">
                <Label>Primary platforms</Label>
                <div className="flex flex-wrap gap-2">
                  {["YouTube", "Instagram", "TikTok", "X"].map((p) => (
                    <Chip
                      key={p}
                      active={experience.platforms.includes(p)}
                      onClick={() => togglePlatform(p)}
                    >
                      {p}
                    </Chip>
                  ))}
                </div>
              </div>

              <Input
                label="Clips you can produce per week"
                inputMode="numeric"
                placeholder="e.g. 15"
                value={experience.clipsPerWeek}
                onChange={(e) =>
                  setExperience((x) => ({
                    ...x,
                    clipsPerWeek: e.target.value,
                  }))
                }
              />

              <Button block onClick={next}>
                Continue
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          ) : null}

          {/* ── 4. Phone, then the code ──────────────────────────────────── */}
          {step === 3 ? (
            <div className="space-y-4">
              {otp.phase === "entry" ? (
                <>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    We use your number to reach you about a payout or a
                    campaign. We'll text a code to confirm it's yours.
                  </p>

                  <div className="grid grid-cols-[7rem_1fr] gap-3">
                    <Input
                      label="Country code"
                      value={phone.countryCode}
                      maxLength={8}
                      onChange={(e) =>
                        setPhone((p) => ({ ...p, countryCode: e.target.value }))
                      }
                    />
                    <Input
                      label="Phone number"
                      inputMode="tel"
                      placeholder="98765 43210"
                      value={phone.number}
                      onChange={(e) =>
                        setPhone((p) => ({ ...p, number: e.target.value }))
                      }
                    />
                  </div>

                  {profile.data?.phoneNumber ? (
                    <p className="text-[11px] text-muted-foreground">
                      A number is already saved on your account. Confirming a
                      new one replaces it.
                    </p>
                  ) : null}

                  {otp.error ? (
                    <p className="text-[11px] text-destructive">{otp.error}</p>
                  ) : null}

                  <Button
                    block
                    loading={otp.sending}
                    disabled={!phoneReady}
                    onClick={handleSendCode}
                  >
                    Send code
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm text-muted-foreground">
                      Enter the {OTP_LENGTH}-digit code sent to{" "}
                      <span className="font-medium text-foreground">
                        {phone.countryCode} {phone.number}
                      </span>
                    </p>
                    <button
                      type="button"
                      onClick={otp.editNumber}
                      className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground"
                    >
                      <Pencil className="h-3 w-3" /> Change
                    </button>
                  </div>

                  <div className="flex justify-center py-2">
                    <InputOTP
                      maxLength={OTP_LENGTH}
                      value={code}
                      disabled={otp.verifying || updatePhone.isPending}
                      onChange={(value) => {
                        setCode(value);
                        // Auto-submit on the last digit — nobody wants to
                        // type six numbers and then hunt for a button.
                        if (value.length === OTP_LENGTH) handleVerify(value);
                      }}
                    >
                      <InputOTPGroup>
                        {Array.from({ length: OTP_LENGTH }).map((_, i) => (
                          <InputOTPSlot key={i} index={i} />
                        ))}
                      </InputOTPGroup>
                    </InputOTP>
                  </div>

                  {otp.error ? (
                    <p className="text-center text-[11px] text-destructive">
                      {otp.error}
                    </p>
                  ) : null}

                  <Button
                    block
                    loading={otp.verifying || updatePhone.isPending}
                    disabled={code.length !== OTP_LENGTH}
                    onClick={() => handleVerify(code)}
                  >
                    Confirm and finish
                    <Check className="h-4 w-4" />
                  </Button>

                  <button
                    type="button"
                    onClick={handleSendCode}
                    disabled={otp.cooldown > 0 || otp.sending}
                    className="w-full font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {otp.cooldown > 0
                      ? `Resend in ${otp.cooldown}s`
                      : "Resend code"}
                  </button>
                </>
              )}
            </div>
          ) : null}
        </Card>
      </main>
    </div>
  );
};

export default Onboarding;
