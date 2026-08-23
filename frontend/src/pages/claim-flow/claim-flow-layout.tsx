import { ReactNode } from "react";
import { AppLayout } from "@/components/AppLayout";

interface ClaimFlowLayoutProps {
  children: ReactNode;
  title: string;
  description?: string;
  currentStep: number;
  totalSteps: number;
}

export const ClaimFlowLayout = ({
  children,
  title,
  description,
  currentStep,
  totalSteps,
}: ClaimFlowLayoutProps) => {
  const progress = Math.min(100, Math.max(0, (currentStep / totalSteps) * 100));

  return (
    <AppLayout>
      <div className="mx-auto flex min-h-[calc(100vh-3.5rem)] w-full max-w-4xl flex-col items-center justify-center px-6 py-10">
        <div className="w-full space-y-8">
          <div className="space-y-3 text-center">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Step {currentStep} of {totalSteps}
            </p>
            <h1 className="text-3xl font-semibold text-foreground">{title}</h1>
            {description ? (
              <p className="text-sm text-muted-foreground">{description}</p>
            ) : null}
            <div className="mx-auto h-1 w-full max-w-sm rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          <div className="w-full">{children}</div>
        </div>
      </div>
    </AppLayout>
  );
};

export default ClaimFlowLayout;
