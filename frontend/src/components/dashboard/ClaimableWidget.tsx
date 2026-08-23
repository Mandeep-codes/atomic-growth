import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { formatCurrency } from "@/lib/formatCurrency";
import { trpc } from "@/lib/trpc";
import { ArrowUpRight } from "lucide-react";
import { Link } from "react-router-dom";

/**
 * The high-contrast payout tile from the redesign: an inverted card so the
 * one number a clipper opens the app for is the brightest thing on the page.
 *
 * ONE figure: the total balance. It used to print `claimable` large with
 * `balance` beneath it and a panel breaking down what was on hold — three
 * different amounts on a tile the size of a postcard, which is how a clipper
 * ends up unsure which number is actually theirs.
 *
 * The hold has not gone anywhere, it just is not explained here: /earnings
 * shows what is held, per campaign, with the action to release it. This tile's
 * job is the headline number and a way through to that page.
 */
export const ClaimableWidget = () => {
  const { user } = useAuth();
  const { data, isLoading, error } =
    trpc.demographicsVerification.getClaimable.useQuery(undefined, {
      enabled: Boolean(user),
    });

  // Signed out there is no balance to show, and the query would 401.
  if (!user || error) return null;

  return (
    <div className="flex flex-col justify-between gap-4 rounded-3xl bg-foreground p-6 text-background shadow-2xl">
      <div className="flex items-start justify-between">
        <span className="text-[11px] font-bold uppercase tracking-[0.16em] opacity-70">
          Total balance
        </span>
        {/* The arrow was decoration — it sat in the corner looking tappable and
            did nothing. It is the link to the earnings section now, which is
            what a corner arrow reads as. */}
        <Link
          to="/earnings"
          aria-label="Go to earnings"
          className="opacity-70 transition-opacity hover:opacity-100"
        >
          <ArrowUpRight className="h-5 w-5" />
        </Link>
      </div>

      {isLoading ? (
        <Skeleton className="h-12 w-40 bg-background/20" />
      ) : (
        // One number. It used to lead with `claimable` and print `balance`
        // underneath, so the card showed two different figures for "your
        // money" and left the reader to work out which one was theirs.
        <div className="text-5xl font-bold leading-none tracking-tight">
          {formatCurrency(data?.balance ?? 0)}
        </div>
      )}

      <Link
        to="/earnings"
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-background py-3.5 text-xs font-bold uppercase tracking-[0.16em] text-foreground transition-transform duration-200 hover:scale-[0.98]"
      >
        <span>Go to earnings</span>
        <ArrowUpRight className="h-4 w-4" />
      </Link>
    </div>
  );
};

export default ClaimableWidget;
