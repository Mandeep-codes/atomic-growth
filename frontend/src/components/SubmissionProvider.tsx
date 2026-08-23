import { ReactNode, useState } from "react";
import { SubmissionContext } from "./SubmissionContext";
import { SupportedPlatform } from "@/lib/types";

interface SubmissionProviderProps {
  children: ReactNode;
}

export const SubmissionProvider = ({ children }: SubmissionProviderProps) => {
  const [contentUrl, setContentUrl] = useState<string | undefined>();
  const [detectedPlatform, setDetectedPlatform] =
    useState<SupportedPlatform | undefined>();
  const [detectedHandle, setDetectedHandle] = useState<string | undefined>();
  const [hasVerifiedHandle, setHasVerifiedHandle] = useState<boolean>(false);
  const [isUserGeneratedContent, setIsUserGeneratedContent] =
    useState<boolean>(false);
  const [loadingSocialDetection, setLoadingSocialDetection] =
    useState<boolean>(false);
  const [step1Complete, setStep1Complete] = useState(false);
  const [step2Complete, setStep2Complete] = useState(false);
  const [step3Complete, setStep3Complete] = useState(false);
  const [phoneStepComplete, setPhoneStepComplete] = useState(false);

  return (
    <SubmissionContext.Provider
      value={{
        contentUrl,
        setContentUrl,
        detectedPlatform,
        setDetectedPlatform,
        detectedHandle,
        setDetectedHandle,
        hasVerifiedHandle,
        setHasVerifiedHandle,
        isUserGeneratedContent,
        setIsUserGeneratedContent,
        loadingSocialDetection,
        setLoadingSocialDetection,
        step1Complete,
        setStep1Complete,
        step2Complete,
        setStep2Complete,
        step3Complete,
        setStep3Complete,
        phoneStepComplete,
        setPhoneStepComplete,
      }}
    >
      {children}
    </SubmissionContext.Provider>
  );
};
