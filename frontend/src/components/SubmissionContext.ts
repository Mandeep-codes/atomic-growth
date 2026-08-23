import { SupportedPlatform } from "@/lib/types";
import { createContext } from "react";

type SubmissionContextType = {
  contentUrl?: string;
  setContentUrl: (url: string | undefined) => void;
  detectedPlatform?: SupportedPlatform;
  setDetectedPlatform: (platform: SupportedPlatform | undefined) => void;
  detectedHandle?: string;
  setDetectedHandle: (handle: string | undefined) => void;
  hasVerifiedHandle?: boolean;
  setHasVerifiedHandle: (hasVerifiedHandle: boolean) => void;
  isUserGeneratedContent: boolean;
  setIsUserGeneratedContent: (isUserGeneratedContent: boolean) => void;
  loadingSocialDetection: boolean;
  setLoadingSocialDetection: (loading: boolean) => void;
  step1Complete: boolean;
  setStep1Complete: (complete: boolean) => void;
  step2Complete: boolean;
  setStep2Complete: (complete: boolean) => void;
  step3Complete: boolean;
  setStep3Complete: (complete: boolean) => void;
  phoneStepComplete: boolean;
  setPhoneStepComplete: (complete: boolean) => void;
};

export const SubmissionContext = createContext<
  SubmissionContextType | undefined
>(undefined);
