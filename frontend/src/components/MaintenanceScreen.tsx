import { Loader2, Wrench } from "lucide-react";

// Full-screen screen shown to everyone WITHOUT the SOS role while maintenance
// mode is on. Intentionally minimal — no nav, no data, nothing to interact
// with.
export const MaintenanceScreen = ({
  message,
  inline = false,
}: {
  message?: string | null;
  inline?: boolean;
}) => {
  return (
    <div
      className={`${
        inline ? "absolute" : "fixed"
      } inset-0 z-[9999] flex flex-col items-center justify-center bg-background px-6 text-center`}
    >
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
        <Wrench className="h-8 w-8 text-primary" />
      </div>
      <h1 className="mt-6 text-2xl font-semibold text-foreground sm:text-3xl">
        We&apos;ll be right back
      </h1>
      <p className="mt-3 max-w-md text-base text-muted-foreground">
        {message?.trim()
          ? message
          : "The website is under maintenance and will be back up in a few moments. Thanks for your patience."}
      </p>
      <div className="mt-8 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>Checking back automatically…</span>
      </div>
    </div>
  );
};
