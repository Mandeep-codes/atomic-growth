import { DEMO_MODE } from "@/lib/demo/demoLink";
import { resetDemo } from "@/lib/demo/demoData";
import { RotateCcw } from "lucide-react";

/**
 * A thin strip so nobody mistakes the walkthrough for live data, plus the
 * reset that puts the fixtures back — needed between demos, since submitting
 * clips and verifying channels persists to localStorage on purpose.
 */
export const DemoBanner = () => {
  if (!DEMO_MODE) return null;

  return (
    <div className="flex items-center justify-center gap-3 border-b border-border/60 bg-muted/40 px-4 py-1.5">
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        Demo mode · sample data · nothing is saved to a server
      </span>
      <button
        type="button"
        onClick={resetDemo}
        className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground"
      >
        <RotateCcw className="h-3 w-3" />
        Reset
      </button>
    </div>
  );
};

export default DemoBanner;
