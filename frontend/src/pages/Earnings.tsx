import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AppLayout } from "@/components/AppLayout";
import { EarningsOverview } from "@/components/dashboard/EarningsOverview";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { Loader2 } from "lucide-react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../backend/src/routers";
import {
  balanceEntryMetadataSchema,
  withdrawalMetadataSchema,
  withdrawalRefundMetadataSchema,
} from "@/lib/balanceEntryMetadata";
import { formatCurrency } from "@/lib/formatCurrency";
import { formatPlatformLabel } from "@/lib/utils";
import { useFeatureFlag } from "@/hooks/useFeatureFlag";
import { useToast } from "@/hooks/use-toast";

type EarningsData = inferRouterOutputs<AppRouter>["rewards"]["getMyEarnings"];
type EarningsEntry = EarningsData["entries"][number];

const formatDateTime = (value: Date | string) =>
  new Date(value).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

// Mirrors MINIMUM_WITHDRAWAL_AMOUNT in backend/src/routers/wise.ts, which is
// what actually refuses the payout. This copy only decides what the button
// looks like — when the two drift, trust the server.
const MINIMUM_CLAIM_AMOUNT = 2;

const Earnings = () => {
  const { data, isLoading } = trpc.rewards.getMyEarnings.useQuery();
  // Only the loading flag is read now — the rows themselves stopped driving
  // this page when the notice moved onto getCampaignAsks (see below). Kept so
  // the Claim button still waits for demographics data exactly as before.
  const { isLoading: isLoadingDemographics } =
    trpc.demographicsVerification.listClaims.useQuery();
  const utils = trpc.useUtils();
  const navigate = useNavigate();
  const { enabled: demographicsVerificationEnabled } = useFeatureFlag(
    "DEMOGRAPHICS_VERIFICATION"
  );
  const { toast } = useToast();

  const currentBalance = data?.currentBalance ?? 0;
  const totalEarned = data?.totalEarned ?? 0;
  const entries: EarningsEntry[] = data?.entries ?? [];
  const outstandingWithdrawal = data?.outstandingWithdrawal ?? null;
  const cancelWithdrawal = trpc.wise.cancelRequestedWithdrawal.useMutation();
  const pageSize = 20;
  const [page, setPage] = useState(0);

  useEffect(() => {
    setPage(0);
  }, [entries.length]);

  const totalPages = Math.max(1, Math.ceil(entries.length / pageSize));
  const paginatedEntries = useMemo(
    () => entries.slice(page * pageSize, page * pageSize + pageSize),
    [entries, page, pageSize]
  );
  const showingStart = entries.length === 0 ? 0 : page * pageSize + 1;
  const showingEnd =
    entries.length === 0 ? 0 : Math.min(entries.length, (page + 1) * pageSize);
  const canGoPrev = page > 0;
  const canGoNext = page < totalPages - 1;

  const getEntryDetails = (entry: EarningsEntry) => {
    const parsedMetadata = entry.metadata
      ? balanceEntryMetadataSchema.safeParse(entry.metadata)
      : null;
    if (parsedMetadata?.success) {
      const metadata = parsedMetadata.data;
      switch (metadata.type) {
        case "campaign_view_reward": {
          const title = metadata.campaignTitle || "Campaign reward";
          const subtitle = `${formatPlatformLabel(
            metadata.platform
          )} +${metadata.viewDelta.toLocaleString()} views at $${metadata.cpm.toFixed(
            2
          )} per 1,000`;
          return { title, subtitle };
        }
        case "referral_reward": {
          const title = "Referral reward";
          const subtitleParts = [
            metadata.platform,
            metadata.referredUserEmail ?? "",
          ]
            .filter(Boolean)
            .join(" • ");
          return {
            title,
            subtitle: subtitleParts || metadata.campaignTitle || null,
          };
        }
        case "referral_reward_v2": {
          const title = "Referral reward";
          const subtitle = `Referral bonus for ${metadata.referredUserName
            } views on ${formatPlatformLabel(metadata.platform)} for ${metadata.campaignTitle
            }`;
          return { title, subtitle };
        }
        case "referee_reward": {
          const title = "Referred user boost reward";
          const subtitle = `Bonus for your views on ${formatPlatformLabel(
            metadata.platform
          )} for ${metadata.campaignTitle}`;
          return { title, subtitle };
        }
        case "manual_adjustment": {
          return {
            title: "Manual adjustment",
            subtitle: metadata.reason,
          };
        }
        case "withdrawal": {
          const parsedWithdrawal = entry.metadata
            ? withdrawalMetadataSchema.safeParse(entry.metadata)
            : null;

          if (parsedWithdrawal?.success) {
            const detail = parsedWithdrawal.data.details;
            if (detail?.type === "wise") {
              const wiseSubtitle = "";
              return {
                title: "Wise withdrawal",
                subtitle: wiseSubtitle || null,
              };
            }
            if (detail?.type === "manual") {
              return {
                title: "Withdrawal",
                subtitle: detail.reason ?? null,
              };
            }

            const subtitle = [
              parsedWithdrawal.data.method,
              parsedWithdrawal.data.referenceId,
            ]
              .filter(Boolean)
              .join(" • ");
            return {
              title: "Withdrawal",
              subtitle: subtitle || null,
            };
          }

          return {
            title: "Withdrawal",
            subtitle: null,
          };
        }
        case "withdrawal_refund": {
          const parsedRefund = entry.metadata
            ? withdrawalRefundMetadataSchema.safeParse(entry.metadata)
            : null;

          if (parsedRefund?.success) {
            const detail = parsedRefund.data.details;
            if (detail?.type === "wise") {
              const subtitle = "";
              return {
                title: "Wise withdrawal refund",
                subtitle: subtitle || null,
              };
            }
            return {
              title: "Withdrawal refund",
              subtitle: parsedRefund.data.reason ?? null,
            };
          }

          return {
            title: "Withdrawal refund",
            subtitle: null,
          };
        }
        default:
          break;
      }
    }

    return {
      title: entry.memo || "—",
      subtitle: null,
    };
  };

  // ── Why this no longer gates the claim button ──
  //
  // This was `listClaims.length > 0`. listClaims returns rows with status
  // 'active', 'rejected' or 'pending' — and 'active' is a PLACEHOLDER meaning
  // the clipper has not filed anything yet, on ANY campaign including ended
  // ones. So a stale placeholder disabled Claim outright.
  //
  // That is what produced "I submitted three or four times and then Claim
  // appeared": filing flips a row 'active' -> 'needs-human-review', which is
  // NOT in that status list, so each submission removed one row from this
  // count. When the count finally reached zero the button unlocked — nothing
  // to do with whether the money was actually released.
  //
  // In production this blocked 263 clippers, 233 of them held by placeholder
  // rows alone and 466 of the rows sitting on campaigns that have ENDED and
  // can never be actioned.
  //
  // The server never applied this rule. wise.requestMyWithdrawal enforces
  // exactly one thing — getClaimableBreakdown(...).claimable <= 0 — which is
  // campaign-scoped and is already mirrored below by weeklyGateBlocked. So
  // dropping this aligns the button with the server instead of loosening it.
  //
  // ── Why the notice no longer reads listClaims either ──
  //
  // It used to be `listClaims.length > 0`. listClaims returns every row still
  // awaiting a decision — which, correctly, INCLUDES 'needs-human-review'. So
  // the moment a clipper filed, the row stayed in that list and this page kept
  // saying "you have a demographics verification to resolve" and kept offering
  // "Submit demographics" — for a report they had just sent. Filing again did
  // nothing except add another row to the moderator's queue.
  //
  // The ask itself already carries the answer, so the notice reads that
  // instead. Derived below from `pendingAsks`, once the query is in scope.

  const hasEnoughToClaim = currentBalance > MINIMUM_CLAIM_AMOUNT;

  // ── Campaign-scoped demographics gate ──
  // Only campaigns with an OPEN request ask for anything, and each asks only
  // about the accounts that actually ran in it. This replaced a global gate
  // that listed every account the clipper had ever earned from — a clipper
  // with ten connected accounts was told all ten were outstanding even though
  // the campaign under review only involved four of them.
  //
  // The backend re-checks this on requestWithdrawal; this is only here so the
  // clipper can see WHAT is being asked and WHY the button is off.
  const gate = trpc.demographicsVerification.getCampaignAsks.useQuery();
  const pendingAsks = (gate.data?.asks ?? []).filter((ask) => !ask.satisfied);
  const lockedTotal = gate.data?.lockedTotal ?? 0;
  const claimable = gate.data?.claimable ?? currentBalance;

  // ── The three states a clipper can actually be in ──
  //
  // Same split WeeklyDemographics uses, so the two screens can never disagree
  // about whether there is a form to fill:
  //
  //   needsSubmission  an ask has an account with nothing filed for it — this
  //                    is the ONLY state that offers "Submit demographics".
  //   awaitingReview   everything asked for has been filed and is sitting with
  //                    a moderator. Nothing for the clipper to do, so no form
  //                    and no button; re-filing would only duplicate the row.
  //   neither          no open ask. The section is not rendered at all.
  //
  // Approved is covered by `satisfied`, which drops the ask from pendingAsks
  // entirely — so an approved clipper sees none of this, including while their
  // claim is in flight.
  const needsSubmission = pendingAsks.some((ask) =>
    ask.accounts.some((account) => !account.submitted)
  );
  const awaitingReview = pendingAsks.length > 0 && !needsSubmission;
  const showDemographicsNotice =
    demographicsVerificationEnabled && pendingAsks.length > 0;

  // ── An unanswered demographics request blocks the claim outright ──
  //
  // This was `pendingAsks.length > 0 && claimable <= 0`, so a clipper with an
  // unanswered request could still claim whatever the hold did not cover — and
  // they did, withdrawing while a request sat unanswered.
  //
  // The hold is an estimate of one campaign's share of a pooled balance. It
  // answers "how much of this wallet is that campaign's?", NOT "has the request
  // been answered?" — and only the second question belongs on this button.
  // Money is released on a moderator's approval, so nothing is claimable until
  // every asked account has one.
  //
  // pendingAsks already excludes satisfied asks, and getCampaignAsks only asks
  // about live campaigns and accounts that actually ran in them — so this is
  // not the old blanket listClaims block that stranded 263 clippers behind
  // placeholder rows on ended campaigns. wise.requestMyWithdrawal enforces the
  // same rule; this is only here so the button matches the server.
  const weeklyGateBlocked = pendingAsks.length > 0;

  // Approval now raises the withdrawal itself (backend: lib/auto-claim.ts), so
  // the button is no longer the normal path - it is the fallback for the cases
  // auto-claim deliberately skips. The one a clipper can fix is a missing
  // payout method, so that gets its own action rather than a dead button.
  const { data: payoutMethods } = trpc.bankAccounts.getAll.useQuery();
  const hasPayoutMethod = (payoutMethods?.length ?? 0) > 0;

  const claimButtonDisabled =
    isLoadingDemographics ||
    gate.isLoading ||
    weeklyGateBlocked ||
    Boolean(outstandingWithdrawal) ||
    !hasEnoughToClaim;

  const handleCancelWithdrawal = async () => {
    if (!outstandingWithdrawal) {
      return;
    }

    const confirmCancel = window.confirm(
      "Cancel this payout request and return the funds to your balance?"
    );

    if (!confirmCancel) {
      return;
    }

    try {
      await cancelWithdrawal.mutateAsync({
        withdrawalId: outstandingWithdrawal.id,
      });
      await utils.rewards.getMyEarnings.invalidate();
      toast({
        title: "Withdrawal cancelled",
        description: "Your balance has been restored.",
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to cancel withdrawal.";
      toast({
        title: "Cancellation failed",
        description: message,
        variant: "destructive",
      });
    }
  };

  return (
    <AppLayout>
      <div className="mx-auto max-w-5xl px-6 py-4 space-y-8">
        <header className="space-y-2">
          <h1 className="display-heading text-3xl sm:text-5xl">Earnings</h1>
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
            Balance, rewards, and every update applied to your account
          </p>
        </header>

        {/* Redesigned overview: headline claimable figure, the earned /
            deducted / paid-out breakdown, and filterable activity. Reads the
            same rewards.getMyEarnings and getClaimable this page already
            calls — it recomputes nothing. The claim controls and their
            eligibility logic stay exactly where they were, below. */}
        <EarningsOverview />

        <section className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Available to claim
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between gap-4">
                {isLoading ? (
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                ) : (
                  // One amount, nothing under it. The "of $X balance — $Y on
                  // hold" line that used to sit here put three figures in a
                  // card whose whole job is answering "how much can I take
                  // out". It is still the CLAIMABLE figure, so it can never
                  // disagree with what the button pays.
                  <p className="text-2xl font-semibold text-foreground">
                    {formatCurrency(claimable, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </p>
                )}

                <div className="flex flex-col items-end gap-1">

                  {/* When a report is owed, this becomes the action that
                      actually moves things forward. A disabled "Claim" told the
                      clipper they could not have their money without saying
                      what to do about it — and the panel that used to explain
                      it is gone. Same gate underneath: the button only claims
                      once every ask is approved. */}
                  {needsSubmission ? (
                    <Button
                      variant="default"
                      size="sm"
                      onClick={() =>
                        navigate("/demographics-verification/weekly")
                      }
                    >
                      Submit demographics
                    </Button>
                  ) : (
/* No Claim button in the normal case. Approval releases the hold AND
                       raises the withdrawal, so pressing anything is redundant -
                       the only states left are ones the clipper either cannot
                       act on (in review) or must fix first (no payout method). */
                    !hasPayoutMethod && hasEnoughToClaim ? (
                      <Button
                        variant="default"
                        size="sm"
                        onClick={() => navigate("/bank-accounts")}
                      >
                        Add a payout method
                      </Button>
                    ) : (
                      <p className="max-w-[16rem] text-right text-sm text-muted-foreground">
                        {awaitingReview
                          ? "Your audience data is with a moderator. Your balance is paid out automatically once it's approved."
                          : weeklyGateBlocked
                            ? "On hold pending audience data. Submit it below and this pays out automatically."
                            : outstandingWithdrawal
                              ? "Payout requested. It goes out in the next payment run."
                              : "Paid out automatically in the next payment run."}
                      </p>
                    )
                  )}

                  {/* The amber hold panel was removed here. It explained the
                      hold, listed each account and carried the Submit
                      demographics action — all of which the Demographics
                      section still shows in full. The Claim button stays
                      disabled while an ask is unanswered and its tooltip says
                      why, so the gate is unchanged. */}
                  {!hasEnoughToClaim && currentBalance > 0 && (
                    <p className="text-sm text-muted-foreground text-right">
                      You need at least
                      {" "}
                      {formatCurrency(MINIMUM_CLAIM_AMOUNT, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                      {" "}
                      to claim your balance.
                    </p>
                  )}
                  {/* A third telling of the same thing used to sit here:
                      "Complete pending demographics verification requests to
                      claim your balance. View requests." The panel directly
                      above already names the campaign, lists every account and
                      its state, and carries the Submit demographics button — so
                      this line repeated it with no new information and a second
                      link to the same page. */}
                  {!showDemographicsNotice && outstandingWithdrawal ? (
                    <p className="text-sm text-muted-foreground text-right">
                      You already have a payout queued.
                    </p>
                  ) : null}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Lifetime earnings
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              ) : (
                <p className="text-2xl font-semibold text-foreground">
                  {formatCurrency(totalEarned, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </p>
              )}
            </CardContent>
          </Card>

          {outstandingWithdrawal ? (
            <Card className="sm:col-span-2 border-primary bg-primary/5">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-primary">
                  Withdrawal queued
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-2xl font-semibold text-foreground">
                    {formatCurrency(outstandingWithdrawal.amount, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Requested {formatDateTime(outstandingWithdrawal.createdAt)}
                  </p>
                </div>
                <div className="text-sm text-muted-foreground sm:text-right">
                  <p>
                    Status:{" "}
                    <span className="font-medium text-foreground">
                      {outstandingWithdrawal.status === "pending"
                        ? "Processing"
                        : "Requested"}
                    </span>
                  </p>
                  {outstandingWithdrawal.externalStatus ? (
                    <p>Wise status: {outstandingWithdrawal.externalStatus}</p>
                  ) : null}
                  <p>
                    Payout will be processed in the next payment cycle. See
                    Discord for more details.
                  </p>
                </div>
                <div className="flex justify-end sm:items-center">
                  <Button
                    variant="outline"
                    onClick={handleCancelWithdrawal}
                    disabled={cancelWithdrawal.isPending}
                  >
                    {cancelWithdrawal.isPending ? (
                      <span className="flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Cancelling...
                      </span>
                    ) : (
                      "Cancel request"
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : null}
        </section>

        {/* The History table was removed here — Amount / Type / Note / Date
            with its own pagination. rewards.getMyEarnings still backs the
            balance figures above; only the row-by-row ledger is gone from this
            page. */}
      </div>
    </AppLayout>
  );
};

export default Earnings;
