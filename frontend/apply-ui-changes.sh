#!/usr/bin/env bash
# Atomik Clips — apply the UI changes.
# Run from the frontend/ directory:   bash apply-ui-changes.sh
set -euo pipefail

if [ ! -f package.json ] || [ ! -d src/components ]; then
  echo "ERROR: run this from the frontend/ directory (the one with package.json)."
  exit 1
fi

echo "Backing up files that already exist -> *.bak"
for f in src/components/AppLayout.tsx src/pages/Onboarding.tsx \
         src/components/dashboard/AnnouncementsPanel.tsx; do
  [ -f "$f" ] && cp "$f" "$f.bak"
done
echo

echo "writing src/components/AppLayout.tsx"
mkdir -p "src/components"
cat > src/components/AppLayout.tsx << 'ATOMIK_EOF'
import { ReactNode, createContext, useContext } from "react";
import { TopNav } from "./TopNav";

interface AppLayoutProps {
  children: ReactNode;
}

// Every clipper page wraps ITSELF in <AppLayout>. That is fine while each one
// owns a route, but the single-page dashboard renders those same pages as
// sections — which would nest a top bar and a <main> inside another one.
// Rather than strip the wrapper out of seven large pages (and risk breaking
// their standalone routes, which still need to work for deep links), a nested
// AppLayout detects the outer one and renders its children bare.
const InsideAppLayout = createContext(false);

// True when this page is being rendered as a SECTION of another page rather
// than as its own route. A page that redirects on mount must check this: the
// dashboard stacks whole pages inline, so an unguarded redirect fires while the
// user is on "/" and drags the entire app to that page's route.
export const useInsideAppLayout = () => useContext(InsideAppLayout);

/**
 * THE SIDEBAR IS GONE.
 *
 * It used to render for staff only (`roles.length > 0`), so clippers already
 * saw nothing but this bar — worth knowing, because the confusion the client
 * reported can only have come from a staff or dev account. Either way it is
 * removed for everyone now, and TopNav carries navigation instead: four links
 * inline, the rest behind a menu, the admin tree behind its own.
 *
 * Removed with it: SidebarProvider, AppSidebar, MobileFloatingNav, and the
 * open/showSidebar state that existed only to drive them. AppSidebar.tsx and
 * MobileFloatingNav.tsx are now unreferenced and can be deleted; the nav model
 * they held lives in lib/navItems.ts.
 */
export function AppLayout({ children }: AppLayoutProps) {
  const nested = useContext(InsideAppLayout);

  if (nested) {
    return <>{children}</>;
  }

  return (
    <InsideAppLayout.Provider value={true}>
      <div className="flex min-h-screen w-full flex-col">
        <TopNav />
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </InsideAppLayout.Provider>
  );
}
ATOMIK_EOF

echo "writing src/lib/phoneOtp.ts"
mkdir -p "src/lib"
cat > src/lib/phoneOtp.ts << 'ATOMIK_EOF'
import { useCallback, useEffect, useRef, useState } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// PHONE OTP
//
// ⚠️  THE BACKEND HAS NO OTP PROCEDURES YET.
//
// There is no SMS provider, no code table and no rate limiting anywhere in the
// repo — `user.updatePhoneNumber` writes the number straight to the profile.
// So the transport lives here, alone, behind two functions. When the backend
// lands, replace ONLY the two bodies marked WIRE HERE. Nothing else in the app
// touches OTP.
//
// The two procedures to add (names the UI already assumes):
//
//   user.sendPhoneOtp   input  { phoneNumber, phoneCountryCode }
//                       output { expiresInSeconds, resendAfterSeconds }
//                       — generates a 6-digit code, stores a HASH of it with a
//                         short TTL against the user id, sends the SMS.
//                         Rate limit per user AND per number, or this is an
//                         SMS-billing hole.
//
//   user.verifyPhoneOtp input  { phoneNumber, phoneCountryCode, code }
//                       output { verified: boolean }
//                       — compares, burns the code on success, counts failures
//                         and locks after ~5. On success it should ALSO persist
//                         the number, which makes the separate
//                         updatePhoneNumber call below unnecessary — drop it
//                         then, or you save the number twice.
//
// Until that exists, local dev simulates the round trip so the flow is
// reviewable, and production fails loudly rather than silently accepting any
// code and marking unverified numbers as verified.
// ─────────────────────────────────────────────────────────────────────────────

const IS_LOCAL_DEV = import.meta.env.VITE_LOCAL_DEV === "true";

export const OTP_LENGTH = 6;
const RESEND_SECONDS = 30;

/** Dev-only: the code the simulator last "sent", so the UI can surface it. */
let devCode: string | null = null;

export const getDevOtpCode = () => (IS_LOCAL_DEV ? devCode : null);

async function sendCodeRequest(_input: {
  phoneNumber: string;
  phoneCountryCode: string;
}): Promise<{ resendAfterSeconds: number }> {
  // ── WIRE HERE ──────────────────────────────────────────────────────────
  // return trpcClient.user.sendPhoneOtp.mutate(_input);
  if (!IS_LOCAL_DEV) {
    throw new Error(
      "Phone verification is not available yet. Skip this step for now."
    );
  }
  await new Promise((r) => setTimeout(r, 600));
  devCode = String(Math.floor(100000 + Math.random() * 900000));
  // eslint-disable-next-line no-console
  console.info(`[dev] OTP code: ${devCode}`);
  return { resendAfterSeconds: RESEND_SECONDS };
}

async function verifyCodeRequest(input: {
  phoneNumber: string;
  phoneCountryCode: string;
  code: string;
}): Promise<{ verified: boolean }> {
  // ── WIRE HERE ──────────────────────────────────────────────────────────
  // return trpcClient.user.verifyPhoneOtp.mutate(input);
  if (!IS_LOCAL_DEV) {
    throw new Error(
      "Phone verification is not available yet. Skip this step for now."
    );
  }
  await new Promise((r) => setTimeout(r, 600));
  return { verified: input.code === devCode };
}

type Phase = "entry" | "code" | "verified";

export function usePhoneOtp() {
  const [phase, setPhase] = useState<Phase>("entry");
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
    },
    []
  );

  const startCooldown = useCallback((seconds: number) => {
    setCooldown(seconds);
    if (timer.current) clearInterval(timer.current);
    timer.current = setInterval(() => {
      setCooldown((c) => {
        if (c <= 1) {
          if (timer.current) clearInterval(timer.current);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
  }, []);

  const send = useCallback(
    async (phoneNumber: string, phoneCountryCode: string) => {
      setError(null);
      setSending(true);
      try {
        const { resendAfterSeconds } = await sendCodeRequest({
          phoneNumber,
          phoneCountryCode,
        });
        setPhase("code");
        startCooldown(resendAfterSeconds ?? RESEND_SECONDS);
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not send the code.");
        return false;
      } finally {
        setSending(false);
      }
    },
    [startCooldown]
  );

  const verify = useCallback(
    async (phoneNumber: string, phoneCountryCode: string, code: string) => {
      setError(null);
      setVerifying(true);
      try {
        const { verified } = await verifyCodeRequest({
          phoneNumber,
          phoneCountryCode,
          code,
        });
        if (!verified) {
          setError("That code is not right. Check it and try again.");
          return false;
        }
        setPhase("verified");
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not check the code.");
        return false;
      } finally {
        setVerifying(false);
      }
    },
    []
  );

  /** Back to the number field — the number was wrong, not the code. */
  const editNumber = useCallback(() => {
    setPhase("entry");
    setError(null);
  }, []);

  return {
    phase,
    sending,
    verifying,
    error,
    cooldown,
    send,
    verify,
    editNumber,
  };
}
ATOMIK_EOF

echo "writing src/pages/Onboarding.tsx"
mkdir -p "src/pages"
cat > src/pages/Onboarding.tsx << 'ATOMIK_EOF'
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
ATOMIK_EOF

echo "writing src/components/dashboard/AnnouncementsPanel.tsx"
mkdir -p "src/components/dashboard"
cat > src/components/dashboard/AnnouncementsPanel.tsx << 'ATOMIK_EOF'
import { Badge, Card, Empty, Label, Loading, SectionTitle } from "@/components/ds";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useAuth } from "@/hooks/useAuth";
import { useCampaignsData } from "@/hooks/useCampaignsData";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import type { inferRouterOutputs } from "@trpc/server";
import { formatDistanceToNow } from "date-fns";
import { AlertTriangle, ChevronRight, Megaphone, Radio } from "lucide-react";
import { useMemo, useState } from "react";
import type { AppRouter } from "../../../../backend/src/routers";

type Announcement =
  inferRouterOutputs<AppRouter>["notifications"]["getAnnouncements"][number];

// Only the two tones the announcement metadata can carry today.
const TONE = {
  announcement: {
    label: "Announcement",
    icon: Megaphone,
    badge: "neutral" as const,
  },
  "issue-alert": {
    label: "Issue alert",
    icon: AlertTriangle,
    badge: "warning" as const,
  },
};

const toneOf = (a: Announcement) =>
  TONE[(a.metadata?.type as keyof typeof TONE) ?? "announcement"] ??
  TONE.announcement;

// ─────────────────────────────────────────────────────────────────────────────
// CAMPAIGN-SCOPED ANNOUNCEMENTS
//
// Announcements are global today: `createAnnouncement` takes only
// { title, description, type, expiresMinutes } and every signed-in user sees
// every row. Those are the Discord posts.
//
// To scope one to a campaign, the backend needs to carry a campaign id on the
// announcement. The cheapest way in is METADATA — it is already a JSON column
// that already holds `type`, so this needs no migration:
//
//   createAnnouncement  input   + campaignId?: string
//                       stores  metadata = { type, campaignId }
//
// Nothing else has to change server-side. `getAnnouncements` keeps returning
// every row and the filtering happens here, because the client already knows
// which campaigns this clipper is in and the server would need a join to work
// it out. If the announcement volume ever gets large, move the filter into the
// procedure — the shape below will not need to change.
//
// Read with a cast because the generated metadata type does not know about
// campaignId until that input lands. It reads as undefined until then, which
// means every existing announcement keeps behaving exactly as it does today.
// ─────────────────────────────────────────────────────────────────────────────
const campaignIdOf = (a: Announcement): string | null => {
  const raw = (a.metadata as { campaignId?: unknown } | null)?.campaignId;
  return typeof raw === "string" && raw.length > 0 ? raw : null;
};

type Scoped = {
  announcement: Announcement;
  /** null = platform-wide (the Discord posts). */
  campaignTitle: string | null;
};

/**
 * Dashboard announcements: platform-wide posts plus anything posted to a
 * campaign this clipper has actually joined, in one list, newest first.
 *
 * A campaign post is labelled with the campaign name so it is obvious why it
 * is here and who it applies to. A campaign post for a campaign the clipper is
 * NOT in never renders — including when the campaign list is still loading,
 * which is deliberate: showing it and then removing it is worse than showing
 * it a beat late.
 *
 * NOTE: there is no author on an announcement. The table has id, title,
 * description, metadata, expires_minutes, dismissed_at, created_at — no
 * posted-by column. So "who posted it" cannot be shown without a schema
 * change; the date is shown, the author is not invented.
 */
export const AnnouncementsPanel = () => {
  const { user } = useAuth();
  const { data, isLoading, error } =
    trpc.notifications.getAnnouncements.useQuery(undefined, {
      enabled: Boolean(user),
    });

  // Which campaigns this clipper is in. Rewards rows are the membership
  // record — a clipper has a row per campaign they have earned against.
  const { data: myRewards, isLoading: rewardsLoading } =
    trpc.rewards.getMyCampaignRewards.useQuery(undefined, {
      enabled: Boolean(user),
    });
  const { data: campaigns } = useCampaignsData();

  const [open, setOpen] = useState<Scoped | null>(null);
  const [showCampaignOnly, setShowCampaignOnly] = useState(false);

  const myCampaignIds = useMemo(
    () => new Set((myRewards ?? []).map((r) => r.campaignId)),
    [myRewards]
  );

  const titleById = useMemo(() => {
    const map = new Map<string, string>();
    (campaigns ?? []).forEach((c) => map.set(c.id, c.title));
    return map;
  }, [campaigns]);

  const scoped = useMemo<Scoped[]>(() => {
    return (data ?? []).flatMap((announcement) => {
      const campaignId = campaignIdOf(announcement);
      if (!campaignId) {
        return [{ announcement, campaignTitle: null }];
      }
      // Campaign post: only for members of that campaign.
      if (!myCampaignIds.has(campaignId)) return [];
      return [
        {
          announcement,
          campaignTitle: titleById.get(campaignId) ?? "Campaign",
        },
      ];
    });
  }, [data, myCampaignIds, titleById]);

  const campaignCount = scoped.filter((s) => s.campaignTitle).length;
  const visible = showCampaignOnly
    ? scoped.filter((s) => s.campaignTitle)
    : scoped;

  if (!user || error) return null;

  const [latest, ...older] = visible;
  // Campaign posts are held back until membership is known, so keep the
  // spinner up until both queries have answered.
  const busy = isLoading || rewardsLoading;

  const SourceTag = ({ campaignTitle }: { campaignTitle: string | null }) =>
    campaignTitle ? (
      <Badge tone="neutral">
        <span className="truncate">{campaignTitle}</span>
      </Badge>
    ) : (
      <Label className="inline-flex items-center gap-1.5">
        <Radio className="h-3 w-3" /> Discord
      </Label>
    );

  return (
    <section className="space-y-6">
      <SectionTitle
        meta={
          visible.length
            ? `${visible.length} ${visible.length === 1 ? "post" : "posts"}`
            : undefined
        }
      >
        Announcements
      </SectionTitle>

      {/* Only offered when there is something to filter to. A toggle that
          always shows but does nothing is worse than no toggle. */}
      {campaignCount > 0 ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setShowCampaignOnly(false)}
            aria-pressed={!showCampaignOnly}
            className={cn(
              "rounded-full border px-3.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] transition-colors",
              !showCampaignOnly
                ? "border-foreground bg-foreground text-background"
                : "border-border text-muted-foreground hover:border-foreground/40"
            )}
          >
            All
          </button>
          <button
            type="button"
            onClick={() => setShowCampaignOnly(true)}
            aria-pressed={showCampaignOnly}
            className={cn(
              "rounded-full border px-3.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] transition-colors",
              showCampaignOnly
                ? "border-foreground bg-foreground text-background"
                : "border-border text-muted-foreground hover:border-foreground/40"
            )}
          >
            My campaigns ({campaignCount})
          </button>
        </div>
      ) : null}

      {busy ? (
        <Loading label="Loading announcements" />
      ) : visible.length === 0 ? (
        <Empty>
          {showCampaignOnly
            ? "Nothing from your campaigns right now."
            : "Nothing announced right now. New campaigns and payout updates will show up here."}
        </Empty>
      ) : (
        <div className="space-y-3">
          {/* Latest, opened out — the one thing worth reading now. */}
          {latest ? (
            <Card className="p-5">
              <button
                type="button"
                onClick={() => setOpen(latest)}
                className="w-full text-left"
              >
                <div className="flex items-start gap-4">
                  <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-muted">
                    {(() => {
                      const Icon = toneOf(latest.announcement).icon;
                      return <Icon className="h-4 w-4" />;
                    })()}
                  </span>

                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={toneOf(latest.announcement).badge}>
                        {toneOf(latest.announcement).label}
                      </Badge>
                      <SourceTag campaignTitle={latest.campaignTitle} />
                      <Label className="inline">
                        {formatDistanceToNow(
                          new Date(latest.announcement.createdAt),
                          { addSuffix: true }
                        )}
                      </Label>
                    </div>
                    <p className="text-base font-semibold">
                      {latest.announcement.title}
                    </p>
                    <p className="line-clamp-2 text-sm leading-relaxed text-muted-foreground">
                      {latest.announcement.description}
                    </p>
                  </div>

                  <ChevronRight className="mt-3 h-4 w-4 shrink-0 text-muted-foreground" />
                </div>
              </button>
            </Card>
          ) : null}

          {/* Everything older, compact. */}
          {older.length ? (
            <Card className="divide-y divide-border">
              {older.map((row) => {
                const tone = toneOf(row.announcement);
                const Icon = tone.icon;
                return (
                  <button
                    key={row.announcement.id}
                    type="button"
                    onClick={() => setOpen(row)}
                    className={cn(
                      "flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors",
                      "hover:bg-muted/40 focus-visible:outline-none focus-visible:bg-muted/40"
                    )}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {row.announcement.title}
                    </span>
                    {row.campaignTitle ? (
                      <span className="hidden max-w-[9rem] shrink-0 truncate rounded-full border border-border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground sm:inline">
                        {row.campaignTitle}
                      </span>
                    ) : null}
                    <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      {formatDistanceToNow(
                        new Date(row.announcement.createdAt),
                        { addSuffix: true }
                      )}
                    </span>
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  </button>
                );
              })}
            </Card>
          ) : null}
        </div>
      )}

      <Dialog open={Boolean(open)} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto rounded-3xl border-border bg-card">
          {open ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={toneOf(open.announcement).badge}>
                  {toneOf(open.announcement).label}
                </Badge>
                <SourceTag campaignTitle={open.campaignTitle} />
                <Label className="inline">
                  {new Date(open.announcement.createdAt).toLocaleString()}
                </Label>
              </div>
              <h2 className="display-heading text-2xl leading-tight">
                {open.announcement.title}
              </h2>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/80">
                {open.announcement.description}
              </p>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  );
};

export default AnnouncementsPanel;
ATOMIK_EOF


echo
echo "Removing files nothing imports any more"
rm -f src/components/AppSidebar.tsx src/components/MobileFloatingNav.tsx
echo

echo "--- verify (each should print OK) ---"
check () { if grep -q "$2" "$1" 2>/dev/null; then echo "OK    $1"; else echo "FAIL  $1"; fi; }
check src/components/AppLayout.tsx                    "flex min-h-screen w-full flex-col"
check src/lib/phoneOtp.ts                             "export function usePhoneOtp"
check src/pages/Onboarding.tsx                        "Confirm and finish"
check src/components/dashboard/AnnouncementsPanel.tsx "campaignIdOf"
echo
echo "Now restart the dev server:"
echo "  rm -rf node_modules/.vite && pnpm dev:frontend"
echo "Then hard-reload the browser with Cmd+Shift+R."
