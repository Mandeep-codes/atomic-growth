import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { MyCpmGroupRate } from "@/hooks/useMyCpmGroupRates";
import { Flame } from "lucide-react";
import { useState } from "react";

/** `$1.25`, `$1.1275` — trims trailing zeros but keeps ≥2 decimals. */
const formatCpmRate = (value: number) => {
  let text = value.toFixed(4).replace(/0+$/, "");
  if (text.endsWith(".")) {
    text = `${text}00`;
  } else if (text.split(".")[1]!.length < 2) {
    text = `${text}0`;
  }
  return `$${text}`;
};

interface CpmBoostBadgeProps {
  /** Renders nothing when the clipper has no group rate for the campaign. */
  rate: MyCpmGroupRate | undefined;
}

/**
 * Small fiery badge pinned to the bottom-left corner of a campaign card
 * (the card must be `position: relative`). Clicking it opens a dialog
 * explaining the boosted rate; the wrapper swallows clicks so the card's
 * own navigation never fires — including clicks inside the portaled
 * dialog, which bubble back through the React tree.
 */
export const CpmBoostBadge = ({ rate }: CpmBoostBadgeProps) => {
  const [open, setOpen] = useState(false);

  if (!rate) return null;

  const display = formatCpmRate(rate.cpmPer1000);

  return (
    <span onClick={(event) => event.stopPropagation()}>
      <span
        role="button"
        tabIndex={0}
        aria-label={`Boosted rate ${display} per 1,000 views — see details`}
        onClick={(event) => {
          event.preventDefault();
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            event.stopPropagation();
            setOpen(true);
          }
        }}
        className="cpm-boost-badge absolute bottom-3 left-3 z-10 inline-flex cursor-pointer items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400/60"
      >
        <Flame className="h-3 w-3" aria-hidden="true" />
        {display} per 1,000
      </span>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Flame className="h-4 w-4 text-orange-500" aria-hidden="true" />
              Boosted rate
            </DialogTitle>
            <DialogDescription>
              You have {display} per 1,000 for this campaign because you&apos;re part
              of the {rate.groupName} group.
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    </span>
  );
};

export default CpmBoostBadge;
