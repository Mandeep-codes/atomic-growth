import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { useUser } from "@clerk/clerk-react";
import { useToast } from "@/hooks/use-toast";
import { trpc } from "@/lib/trpc";

const REFERRAL_CODE_STORAGE_KEY = "referral_code_v2";
const REFERRAL_QUERY_PARAM_KEYS = ["referral_code", "referralCode", "ref"];

const getReferralCodeFromSearch = (search: string) => {
  if (!search) {
    return null;
  }

  const params = new URLSearchParams(search);
  for (const key of REFERRAL_QUERY_PARAM_KEYS) {
    const value = params.get(key);
    if (value && value.trim()) {
      return value.trim();
    }
  }

  return null;
};

const getStoredReferralCode = () => {
  if (typeof window === "undefined") {
    return null;
  }
  return window.localStorage.getItem(REFERRAL_CODE_STORAGE_KEY);
};

const saveReferralCode = (code: string) => {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(REFERRAL_CODE_STORAGE_KEY, code);
};

const clearReferralCode = () => {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(REFERRAL_CODE_STORAGE_KEY);
};

export const ReferralTracker = () => {
  const location = useLocation();
  const { toast } = useToast();
  const { user, isSignedIn, isLoaded } = useUser();

  const { mutateAsync: validateReferralCode } =
    trpc.referrals.validateCode.useMutation();
  const { mutateAsync: attachReferralToUser, isPending: isAttachingReferral } =
    trpc.referrals.attachReferralToUser.useMutation();

  const lastStoredCodeRef = useRef<string | null>(null);
  const failedAttachCodeRef = useRef<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const referralCode = getReferralCodeFromSearch(location.search);
    if (!referralCode) {
      return;
    }

    if (lastStoredCodeRef.current === referralCode) {
      return;
    }

    const existingCode = getStoredReferralCode();
    if (existingCode === referralCode) {
      lastStoredCodeRef.current = referralCode;
      return;
    }

    lastStoredCodeRef.current = referralCode;

    const verifyAndStore = async () => {
      try {
        const { isValid } = await validateReferralCode({ code: referralCode });
        if (!isValid) {
          toast({
            title: "Invalid referral link",
            description: "The referral code in this link is no longer valid.",
            variant: "destructive",
          });
          return;
        }

        saveReferralCode(referralCode);
        toast({
          title: "Referral applied",
          description: "We'll apply this referral once your account is ready.",
        });
      } catch (error) {
        console.error("Failed to validate referral code", error);
        toast({
          title: "Unable to store referral code",
          description: "Please try opening the referral link again.",
          variant: "destructive",
        });
      }
    };

    void verifyAndStore();
  }, [location.search, toast, validateReferralCode]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (!isLoaded || !isSignedIn || !user) {
      return;
    }

    const storedCode = getStoredReferralCode();
    if (!storedCode) {
      failedAttachCodeRef.current = null;
      return;
    }

    if (isAttachingReferral) {
      return;
    }

    if (failedAttachCodeRef.current === storedCode) {
      return;
    }

    const attach = async () => {
      try {
        const result = await attachReferralToUser({ code: storedCode });
        failedAttachCodeRef.current = null;

        if (result.attached) {
          clearReferralCode();
          toast({
            title: "Referral connected",
            description: "Thanks for joining through a referral!",
          });
          return;
        }

        if (result.reason) {
          clearReferralCode();
          const reasonMessages: Record<string, string> = {
            FEATURE_NOT_ELIGIBLE:
              "Referral codes only work for accounts created after the referral program launched.",
            HAS_REWARDS:
              "Referral codes must be applied before earning any rewards.",
            SELF_REFERRAL: "You can't refer yourself.",
            ALREADY_ATTACHED:
              "Your account already has a referral associated with it.",
          };

          toast({
            title: "Referral not applied",
            description:
              reasonMessages[result.reason] ??
              "Please try entering the referral code manually.",
            variant: "destructive",
          });
          return;
        }
      } catch (error) {
        clearReferralCode();
        console.error("Failed to attach referral code", error);
        failedAttachCodeRef.current = storedCode;
        toast({
          title: "Couldn't apply referral",
          description: "Please try entering the referral code manually.",
          variant: "destructive",
        });
      }
    };

    void attach();
  }, [attachReferralToUser, isAttachingReferral, isLoaded, isSignedIn, toast, user]);

  return null;
};
