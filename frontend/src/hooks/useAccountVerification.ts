import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { useToast } from "./use-toast";
import { SupportedPlatform } from "@/lib/types";

export type VerificationPhase = "idle" | "initializing" | "ready";

export const UseAccountVerification = () => {
  const initializeVerification =
    trpc.verification.initializeVerification.useMutation();
  const verifyUserBio = trpc.verification.verifyUserBio.useMutation();
  const utils = trpc.useUtils();
  const { toast } = useToast();

  const [verificationPhase, setVerificationPhase] =
    useState<VerificationPhase>("idle");
  const [verificationCode, setVerificationCode] = useState<string | null>(null);

  const startVerification = async (
    platform: SupportedPlatform,
    handle: string
  ) => {
    setVerificationPhase("initializing");
    setVerificationCode(null);

    try {
      const result = await initializeVerification.mutateAsync({
        platform,
        handle,
      });

      setVerificationCode(result.verifyCode);
      setVerificationPhase("ready");
    } catch (error) {
      setVerificationPhase("idle");
      toast({
        title: "Unable to start verification",
        description:
          error instanceof Error ? error.message : "Please try again shortly.",
        variant: "destructive",
      });
    }
  };

  const handleVerificationCheck = async (
    platform: SupportedPlatform,
    handle: string
  ): Promise<boolean> => {
    try {
      const result = await verifyUserBio.mutateAsync({
        platform,
        handle,
      });

      if (result.verified) {
        void utils.verification.checkVerification.invalidate({ platform });
        toast({
          title: "Account verified",
          description: "You're all set!",
        });
        setVerificationCode(null);
        return true;
      } else {
        setVerificationCode(result.verifyCode ?? verificationCode);
        toast({
          title: "Verification needed",
          description:
            result.message ??
            "Add the code to your bio and try again in a few moments.",
          variant: "destructive",
        });
        return false;
      }
    } catch (error) {
      toast({
        title: "Verification failed",
        description:
          error instanceof Error ? error.message : "Please try again shortly.",
        variant: "destructive",
      });
      return false;
    }
  };

  return {
    startVerification,
    handleVerificationCheck,
    loadingVerificationCheck: verifyUserBio.isPending,
    verificationPhase,
    verificationCode,
  };
};
