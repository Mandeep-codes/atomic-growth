import { Link, useNavigate } from "react-router-dom";
import { inferRouterOutputs } from "@trpc/server";
import { Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useEffect, useMemo } from "react";
import { AppLayout, useInsideAppLayout } from "@/components/AppLayout";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { AppRouter } from "../../../backend/src/routers";
import { formatPlatformLabel } from "@/lib/utils";

type RouterOutput = inferRouterOutputs<AppRouter>;
type Claim = RouterOutput["demographicsVerification"]["listClaims"][number];

const statusMeta: Record<
  Claim["status"] | "unknown",
  { label: string; variant: "default" | "secondary" | "destructive" }
> = {
  created: { label: "Awaiting upload", variant: "secondary" },
  pending: { label: "Pending confirmation", variant: "secondary" },
  active: { label: "Awaiting", variant: "default" },
  approved: {
    label: "Approved",
    variant: "default",
  },
  cancelled: { label: "Cancelled", variant: "secondary" },
  // Clipper-facing: this state means WE owe them a decision, not the reverse.
  "needs-human-review": { label: "In review", variant: "secondary" },
  rejected: { label: "Rejected", variant: "destructive" },
  unknown: { label: "Unknown", variant: "secondary" },
};

const formatRequestedDate = (date: Claim["createdAt"]) => {
  if (!date) return null;
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString();
};

const DemographicsVerificationList = () => {
  const {
    data: claims,
    isLoading,
    isError,
  } = trpc.demographicsVerification.listClaims.useQuery();

  // ── Send an outstanding ask to the screen that can actually answer it ──
  //
  // This page lists listClaims, which returns 'active' / 'rejected' / 'pending'
  // rows across every campaign, ended ones included. 'active' is a placeholder
  // meaning nothing has been filed. It has no submit form — the weekly screen
  // is the only thing that calls submitForCampaign.
  //
  // So a clipper following "submit demographics" landed here, saw placeholder
  // rows (or "no accounts") that did not match what the earnings page told
  // them, and went hunting between pages. When a campaign is genuinely asking,
  // go straight to the one screen that can take the answer.
  const asks = trpc.demographicsVerification.getCampaignAsks.useQuery();

  // ── One source of truth for "is this still being asked for" ──
  //
  // listClaims returns raw rows by status. It has no idea whether the campaign
  // is still live, whether the cycle is current, or whether the clipper still
  // qualifies — so it kept surfacing stale 'active' placeholders for campaigns
  // that stopped asking months ago. That is why this page said "2 campaigns
  // need demographics" while the earnings page said everything was submitted:
  // the two screens were applying two different definitions of outstanding.
  //
  // getCampaignAsks IS the definition — it is what the money hold uses. So the
  // rows shown here are narrowed to the campaigns it actually returns. A row
  // whose campaign is not being asked about is history, not a to-do.
  const askedCampaignIds = useMemo(
    () => new Set((asks.data?.asks ?? []).map((ask) => ask.campaignId)),
    [asks.data]
  );
  const visibleClaims = useMemo(
    () =>
      asks.isLoading
        ? []
        : (claims ?? []).filter((claim) =>
            askedCampaignIds.has(claim.campaignId)
          ),
    [claims, askedCampaignIds, asks.isLoading]
  );
  const navigate = useNavigate();
  const hasOutstandingAsk = (asks.data?.asks ?? []).some(
    (ask) => !ask.satisfied && ask.accounts.some((a) => !a.submitted)
  );

  // Only redirect when this page IS the route. The dashboard renders it inline
  // as one of its stacked sections, and there the redirect fired on mount and
  // pulled the whole app off "/" onto the weekly form — so opening the site
  // landed on Audience demographics instead of the dashboard, every time.
  const nested = useInsideAppLayout();

  useEffect(() => {
    if (nested) return;
    if (asks.isLoading) return;
    if (hasOutstandingAsk) {
      navigate("/demographics-verification/weekly", { replace: true });
    }
  }, [nested, asks.isLoading, hasOutstandingAsk, navigate]);

  return (
    <AppLayout>
      <div className="min-h-screen py-4 px-4">
        <div className="mx-auto flex max-w-5xl flex-col gap-6">
          <div className="space-y-1">
            <h1 className="text-3xl font-semibold">
              Verify your audience demographics
            </h1>
            <p className="text-muted-foreground">
              Review and complete any outstanding demographics verification
              requests. Each account only needs to be verified once — a single
              submission covers every campaign that account is in.
            </p>
          </div>

          <Card>
            <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle></CardTitle>
                <CardDescription></CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading verification requests...
                </div>
              ) : isError ? (
                <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
                  We couldn't load your verification requests. Please try again.
                </div>
              ) : visibleClaims.length > 0 ? (
                <>
                  <div className="hidden sm:block">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Campaigns</TableHead>
                          <TableHead>Handle</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Action</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {visibleClaims.map((claim) => {
                          const meta =
                            statusMeta[claim.status] ?? statusMeta.unknown;
                          const requestedDate = formatRequestedDate(
                            claim.createdAt
                          );
                          return (
                            <TableRow key={claim.id}>
                              <TableCell>
                                <div className="font-medium">
                                  {claim.campaignCount > 1
                                    ? `${claim.campaignCount} campaigns`
                                    : claim.campaignTitles[0] ?? "Campaign"}
                                </div>
                                {claim.campaignCount > 1 && (
                                  <div className="text-xs text-muted-foreground">
                                    {claim.campaignTitles.join(", ")}
                                  </div>
                                )}
                                {requestedDate && (
                                  <div className="text-xs text-muted-foreground">
                                    Requested {requestedDate}
                                  </div>
                                )}
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  <span>
                                    @
                                    {claim.verifiedHandle ??
                                      claim.verifiedUsername ??
                                      "unknown"}
                                  </span>
                                  {claim.verifiedPlatform && (
                                    <span className="text-xs text-muted-foreground">
                                      ·{" "}
                                      {formatPlatformLabel(
                                        claim.verifiedPlatform
                                      )}
                                    </span>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell>
                                <Badge variant={meta.variant}>
                                  {meta.label}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-right">
                                <Button variant="outline" size="sm" asChild>
                                  <Link to={`/demographics-verify/${claim.id}`}>
                                    Review
                                  </Link>
                                </Button>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>

                  <div className="space-y-4 sm:hidden">
                    {visibleClaims.map((claim) => {
                      const meta =
                        statusMeta[claim.status] ?? statusMeta.unknown;
                      const requestedDate = formatRequestedDate(
                        claim.createdAt
                      );
                      return (
                        <div
                          key={claim.id}
                          className="rounded-2xl border border-border/60 bg-background p-4"
                        >
                          <div className="space-y-2">
                            <div>
                              <p className="text-sm font-medium">
                                {claim.campaignCount > 1
                                  ? `${claim.campaignCount} campaigns`
                                  : claim.campaignTitles[0] ?? "Campaign"}
                              </p>
                              {claim.campaignCount > 1 && (
                                <p className="text-xs text-muted-foreground">
                                  {claim.campaignTitles.join(", ")}
                                </p>
                              )}
                              {requestedDate && (
                                <p className="text-xs text-muted-foreground">
                                  Requested {requestedDate}
                                </p>
                              )}
                            </div>
                            <div className="text-sm text-muted-foreground">
                              <div className="font-medium text-foreground">
                                @
                                {claim.verifiedHandle ??
                                  claim.verifiedUsername ??
                                  "unknown"}
                              </div>
                              {claim.verifiedPlatform && (
                                <span>
                                  {formatPlatformLabel(claim.verifiedPlatform)}
                                </span>
                              )}
                            </div>
                            <Badge variant={meta.variant}>{meta.label}</Badge>
                          </div>
                          <Button className="mt-4 w-full" size="sm" asChild>
                            <Link to={`/demographics-verify/${claim.id}`}>
                              Review
                            </Link>
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
                  <p className="text-base font-medium text-foreground">
                    You're all caught up
                  </p>
                  <p className="max-w-sm text-sm">
                    We’ll show any demographics verification requests here as
                    soon as your campaigns require them.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
};

export default DemographicsVerificationList;
