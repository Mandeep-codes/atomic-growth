import { cn } from "@/lib/utils";
import { Check } from "lucide-react";
import { ReactNode } from "react";

export type StepStatus = "pending" | "current" | "complete";

export const StepIndicator = ({
  step,
  status,
}: {
  step: number;
  status: StepStatus;
}) => {
  const baseClass =
    "flex h-7 w-7 items-center justify-center rounded-full border text-xs font-semibold transition-colors";

  if (status === "complete") {
    return (
      <span
        className={cn(
          baseClass,
          "border-emerald-200 bg-emerald-100 text-emerald-700"
        )}
      >
        <Check className="h-4 w-4" />
      </span>
    );
  }

  if (status === "current") {
    return (
      <span
        className={cn(
          baseClass,
          "border-primary bg-primary text-primary-foreground"
        )}
      >
        {step}
      </span>
    );
  }

  return (
    <span
      className={cn(baseClass, "border-muted bg-muted text-muted-foreground")}
    >
      {step}
    </span>
  );
};

export type StepSectionProps = {
  step: number;
  title: string;
  status: StepStatus;
  description?: string;
  disabledMessage?: string;
  children: ReactNode;
  className?: string;
};

export const StepSection = ({
  step,
  title,
  description,
  status,
  disabledMessage,
  children,
  className,
}: StepSectionProps) => {
  const isPending = status === "pending";

  return (
    <div
      className={cn(
        "rounded-xl border bg-card shadow-sm",
        status === "complete" ? "border-emerald-200" : "border-border",
        className
      )}
    >
      <div className="flex flex-col gap-4 p-4 sm:p-5">
        <div className="flex items-center gap-3">
          <StepIndicator step={step} status={status} />
          <div>
            <p className="text-sm font-semibold text-foreground">{title}</p>
            {description ? (
              <p className="text-xs text-muted-foreground">{description}</p>
            ) : null}
          </div>
        </div>

        <div
          className={cn(
            "space-y-3",
            isPending && "pointer-events-none select-none opacity-70"
          )}
        >
          {isPending ? (
            <p className="text-sm text-muted-foreground">
              {disabledMessage ?? "Complete the previous step to continue."}
            </p>
          ) : (
            children
          )}
        </div>
      </div>
    </div>
  );
};
