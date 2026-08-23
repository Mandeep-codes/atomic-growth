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
