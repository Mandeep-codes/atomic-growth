import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle2, Clock, Loader2, XCircle } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { useToast } from "@/hooks/use-toast";
// countries.ts, not demographic.ts — see the note there. A value import from a
// file that imports zod breaks the deploy build, because the frontend is built
// with dependencies installed only inside frontend/.
import { COUNTRIES as COUNTRY_LIST } from "../../../backend/src/lib/zod-schemas/countries";

const COUNTRIES = COUNTRY_LIST as unknown as string[];
const ROWS = 5;

type Row = { country: string; percentage: string };

const emptyRows = (): Row[] =>
  Array.from({ length: ROWS }, () => ({ country: "", percentage: "" }));

// ── One source for the badge and the counts ──
//
// This used to switch on the `status` STRING while the counts above it read the
// `submitted` / `approved` BOOLEANS, so the two could disagree — and they did:
// the header said 3 accounts still to report while only 2 badges said "Not
// submitted".
//
// Worse, "Under review" was the fall-through: any status the list did not name
// — a new one, an empty one — rendered as "with a moderator, nothing to do".
// That is the most reassuring thing the badge can say and the most dangerous to
// guess, because a clipper who reads it stops filling the form and their money
// stays held.
//
// Now it reads the same fields the counts do, in the order the flow actually
// happens, and an account that has not been submitted says so no matter what
// its status string is.
const statusBadge = (account: {
  approved?: boolean;
  submitted?: boolean;
  status?: string | null;
}) => {
  if (account.approved)
    return (
      <Badge className="bg-emerald-600 hover:bg-emerald-600">
        <CheckCircle2 className="mr-1 h-3 w-3" /> Approved
      </Badge>
    );
  if (account.status === "rejected")
    return (
      <Badge variant="destructive">
        <XCircle className="mr-1 h-3 w-3" /> Rejected — resubmit
      </Badge>
    );
  if (!account.submitted)
    return (
      <Badge variant="destructive">
        <XCircle className="mr-1 h-3 w-3" /> Not submitted
      </Badge>
    );
  return (
    <Badge variant="secondary">
      <Clock className="mr-1 h-3 w-3" /> Under review
    </Badge>
  );
};

const WeeklyDemographics = () => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const utils = trpc.useUtils();

  const status = trpc.demographicsVerification.getCampaignAsks.useQuery();
  const [accountId, setAccountId] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [rows, setRows] = useState<Row[]>(emptyRows());
  // Exemption: still a submission, still needs the recording — just no country
  // breakdown, and therefore no geo bonus for this account on this campaign.
  const [exempt, setExempt] = useState(false);
  const [exemptReason, setExemptReason] = useState("");

  const asks = status.data?.asks ?? [];

  // ── The campaign is DERIVED, never chosen ──
  // A moderator asked one campaign for a report, so which campaign this
  // submission answers is already decided — presenting it as a dropdown only
  // creates a way to file the report against the wrong one, which would leave
  // the campaign that actually asked still on hold and put an unasked-for row
  // in the review queue.
  //
  // Picks the first ask with an account that has not been submitted yet, NOT
  // the first unsatisfied one: an ask stays unsatisfied until a moderator
  // APPROVES every account, so anchoring on that would pin the form to a
  // campaign the clipper has already fully answered and block them from
  // reaching the next one for as long as review takes.
  // ONLY an ask that still has an account the clipper has not filed for.
  //
  // This used to fall back to `asks.find(ask => !ask.satisfied)` when every
  // account was already submitted. An ask stays unsatisfied until a MODERATOR
  // approves it, so that fallback re-opened the form on a campaign the clipper
  // had already fully answered — same campaign, same accounts, submit button
  // live. They filed again, and again, each time writing another row, until
  // something finally got approved. That is the reported "bharne ke baad bhi
  // wapas bharne ka option aa raha hai".
  //
  // With no fallback, a fully-filed clipper gets the awaiting-review state
  // below instead of a form. The next campaign is still reachable: the first
  // clause scans EVERY ask, so any campaign with outstanding accounts becomes
  // active on its own.
  const activeAsk = asks.find((ask) =>
    ask.accounts.some((a) => !a.submitted)
  );

  // Filed everything, waiting on a moderator. Not the same as "nothing to do".
  const awaitingReview =
    !activeAsk && asks.some((ask) => !ask.satisfied);
  const activeCampaignId = activeAsk?.campaignId ?? "";
  // Only the accounts that ran in THIS campaign. A clipper with ten connected
  // accounts is asked about the ones that actually generated views here.
  const accounts = activeAsk?.accounts ?? [];
  // Guard against a stale selection surviving the move to the next campaign —
  // the id would no longer be in this campaign's list, and submitting it would
  // be rejected by the server's participation check.
  const selectedAccountId = accounts.some((a) => a.verifiedUserId === accountId)
    ? accountId
    : "";
  // Other campaigns still waiting behind this one, so the clipper knows the
  // form will move on rather than that they have missed something.
  const remainingAsks = asks.filter(
    (ask) => !ask.satisfied && ask.campaignId !== activeCampaignId
  ).length;

  const submit = trpc.demographicsVerification.submitForCampaign.useMutation({
    onSuccess: (result) => {
      toast({
        title: result.exempt ? "Exemption submitted" : "Demographics submitted",
        description: result.exempt
          ? `${result.handle} — sent for review. This account will be paid the base rate for this campaign, with no geo bonus.`
          : `${result.handle} — sent for review.`,
      });
      setAccountId("");
      setVideoUrl("");
      setRows(emptyRows());
      setExempt(false);
      setExemptReason("");
      void utils.demographicsVerification.getCampaignAsks.invalidate();
      void utils.demographicsVerification.getClaimable.invalidate();
      void utils.rewards.getPayoutEligibility.invalidate();
    },
    onError: (error) =>
      toast({
        title: "Could not submit",
        description: error.message,
        variant: "destructive",
      }),
  });

  // Mirror the server's rules so the clipper sees the problem while typing
  // instead of after a round trip. The API re-validates regardless.
  const problems = useMemo(() => {
    const list: string[] = [];
    if (!activeCampaignId) {
      list.push(
        awaitingReview
          ? "Everything you've sent is with a moderator — nothing more to submit"
          : "No campaign is asking for a report yet"
      );
    }
    if (!selectedAccountId) {
      list.push("Choose which account this report is for");
    }
    // Required on BOTH paths — an exemption still has to show the recording.
    if (!videoUrl.trim()) list.push("Add the link to your screen recording");

    if (exempt) {
      if (exemptReason.trim().length < 10) {
        list.push("Explain why this account can't give a country breakdown");
      }
      return list;
    }

    const filled = rows.filter((r) => r.country && r.percentage !== "");
    if (filled.length < ROWS) {
      list.push(`Fill in all ${ROWS} countries (${filled.length}/${ROWS} done)`);
    }
    if (rows.some((r) => r.percentage !== "" && Number(r.percentage) <= 0)) {
      list.push("Every percentage must be greater than 0");
    }
    const chosen = rows.map((r) => r.country).filter(Boolean);
    if (new Set(chosen).size !== chosen.length) {
      list.push("The same country is listed twice");
    }
    const total = rows.reduce((sum, r) => sum + (Number(r.percentage) || 0), 0);
    if (total > 100) {
      list.push(`Percentages add up to ${total.toFixed(2)}% — max is 100%`);
    }
    return list;
  }, [
    activeCampaignId,
    selectedAccountId,
    videoUrl,
    rows,
    exempt,
    exemptReason,
  ]);

  const total = rows.reduce((sum, r) => sum + (Number(r.percentage) || 0), 0);
  const pending = accounts.filter((a) => !a.approved);
  const locked = status.data?.locked ?? [];

  return (
    <AppLayout>
      <div className="mx-auto max-w-3xl space-y-6 p-6">
        <div>
          <h1 className="text-3xl font-bold">Audience demographics</h1>
          <p className="mt-1 text-muted-foreground">
            When a campaign asks for fresh demographics, report on the accounts
            you actually ran in it. Only that campaign's earnings wait on the
            report — everything else stays claimable.
          </p>
        </div>

        {/* ── What each campaign is holding ── */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Your balance</CardTitle>
            <CardDescription>
              {status.isLoading
                ? "Loading…"
                : `$${(status.data?.claimable ?? 0).toFixed(
                    2
                  )} claimable of $${(status.data?.balance ?? 0).toFixed(2)}`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {status.isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : locked.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing is on hold. Your full balance is available to claim.
              </p>
            ) : (
              <ul className="space-y-2">
                {locked.map((row) => (
                  <li
                    key={row.campaignId}
                    className="flex items-center justify-between rounded-lg border p-3"
                  >
                    <span>
                      <span className="font-medium">
                        {row.campaignTitle ?? "Campaign"}
                      </span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {row.accountsMissing > 0
                          ? `${row.accountsMissing} account(s) still to report`
                          : `${row.accountsAwaitingReview} awaiting review`}
                      </span>
                    </span>
                    <span className="font-semibold tabular-nums">
                      ${row.amount.toFixed(2)} on hold
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* ── Campaigns asking, and the accounts each one asks about ── */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Requests</CardTitle>
            <CardDescription>
              {asks.length === 0
                ? "No campaign is asking for demographics right now."
                : "Campaigns that have asked you for a fresh report."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {status.isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : asks.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                You'll get a notification when a campaign needs one.
              </p>
            ) : (
              <ul className="space-y-3">
                {asks.map((ask) => (
                  <li
                    key={ask.campaignId}
                    className={
                      ask.campaignId === activeCampaignId
                        ? "rounded-lg border-2 border-primary p-3"
                        : "rounded-lg border p-3"
                    }
                  >
                    {/* Status only. Deliberately NOT clickable: which campaign
                        the form answers is decided by the request, not here. */}
                    <div className="flex w-full items-center justify-between">
                      <span className="font-medium">
                        {ask.campaignTitle ?? "Campaign"}
                      </span>
                      {ask.satisfied ? (
                        statusBadge({ approved: true })
                      ) : (
                        // "Outstanding" counts what the CLIPPER still has to
                        // do, so it counts unsubmitted accounts — not
                        // unapproved ones. Counting !approved called a report
                        // already filed and sitting with a moderator
                        // "outstanding", which is why this header read "4 of 4"
                        // while the badges below it showed two of those four as
                        // Under review. Same rule the badges use, so the two
                        // can no longer disagree.
                        <span className="text-xs text-muted-foreground">
                          {ask.accounts.filter((a) => !a.submitted).length} of{" "}
                          {ask.accounts.length} account(s) still to report
                        </span>
                      )}
                    </div>
                    {ask.note && (
                      <p className="mt-2 text-sm text-muted-foreground">
                        {ask.note}
                      </p>
                    )}
                    <ul className="mt-2 space-y-1">
                      {ask.accounts.map((a) => (
                        <li
                          key={a.verifiedUserId}
                          className="flex items-center justify-between text-sm"
                        >
                          <span>
                            {a.handle}
                            <span className="ml-2 text-xs text-muted-foreground">
                              {a.platform} · {a.views.toLocaleString()} views
                            </span>
                            {a.exempt && (
                              <span className="ml-2 text-xs font-medium text-amber-600 dark:text-amber-400">
                                exempt — base rate only
                              </span>
                            )}
                          </span>
                          {statusBadge(a)}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* ── Submission form ── */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Submit a report</CardTitle>
            <CardDescription>
              Record your in-platform analytics for the last 7 days, upload it as
              an unlisted video, then paste the link and type your top 5
              countries exactly as shown in the recording.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Read-only: the campaign comes from the request, not the clipper. */}
            <div className="rounded-lg border bg-muted/40 p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Reporting for
              </p>
              <p className="mt-0.5 font-medium">
                {activeAsk?.campaignTitle ?? "No campaign is asking right now"}
              </p>
              {remainingAsks > 0 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {remainingAsks} more campaign
                  {remainingAsks > 1 ? "s" : ""} to report on after this one.
                </p>
              )}
            </div>

            <div>
              <Label>Account</Label>
              <Select value={selectedAccountId} onValueChange={setAccountId}>
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      activeCampaignId
                        ? "Choose an account…"
                        : "Nothing to submit"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {(pending.length > 0 ? pending : accounts).map((a) => (
                    <SelectItem key={a.verifiedUserId} value={a.verifiedUserId}>
                      {a.handle} — {a.platform} ({a.views.toLocaleString()}{" "}
                      views)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1 text-xs text-muted-foreground">
                Only the accounts that generated views on this campaign are
                listed.
              </p>
            </div>

            <div>
              <Label>Screen recording link</Label>
              <Input
                placeholder="https://youtube.com/watch?v=…"
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                An unlisted YouTube video showing your analytics screen.
              </p>
            </div>

            {/* ── Exemption ── */}
            <div className="rounded-lg border p-3">
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4"
                  checked={exempt}
                  onChange={(e) => setExempt(e.target.checked)}
                />
                <span>
                  <span className="text-sm font-medium">
                    I can&apos;t provide a country breakdown for this account
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    Your submission is still reviewed and still releases this
                    campaign&apos;s earnings once approved — you&apos;ll just be
                    paid the base rate, with no geo bonus for this account. The
                    screen recording is still required.
                  </span>
                </span>
              </label>

              {exempt && (
                <div className="mt-3">
                  <Label htmlFor="exemptReason">Reason</Label>
                  <Input
                    id="exemptReason"
                    placeholder="e.g. This platform doesn't show a country breakdown for my account"
                    value={exemptReason}
                    onChange={(e) => setExemptReason(e.target.value)}
                  />
                </div>
              )}
            </div>

            <div className={exempt ? "pointer-events-none opacity-40" : ""}>
              <div className="mb-2 flex items-center justify-between">
                <Label>Top 5 audience countries</Label>
                <span
                  className={
                    total > 100
                      ? "text-sm font-semibold text-destructive"
                      : "text-sm text-muted-foreground"
                  }
                >
                  Total: {total.toFixed(2)}%
                </span>
              </div>

              <div className="space-y-2">
                {rows.map((row, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="w-5 text-sm text-muted-foreground">
                      {i + 1}.
                    </span>
                    <Select
                      value={row.country}
                      onValueChange={(value) => {
                        const next = [...rows];
                        next[i] = { ...next[i], country: value };
                        setRows(next);
                      }}
                    >
                      <SelectTrigger className="flex-1">
                        <SelectValue placeholder="Select a country…" />
                      </SelectTrigger>
                      <SelectContent className="max-h-72">
                        {COUNTRIES.filter(
                          (name) =>
                            name === row.country ||
                            !rows.some((other) => other.country === name)
                        ).map((name) => (
                          <SelectItem key={name} value={name}>
                            {name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      type="number"
                      step="0.01"
                      className="w-28"
                      placeholder="%"
                      value={row.percentage}
                      onChange={(e) => {
                        const next = [...rows];
                        next[i] = { ...next[i], percentage: e.target.value };
                        setRows(next);
                      }}
                    />
                    <span className="text-sm text-muted-foreground">%</span>
                  </div>
                ))}
              </div>
            </div>

            {problems.length > 0 && (
              <ul className="space-y-1 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/40">
                {problems.map((problem) => (
                  <li
                    key={problem}
                    className="text-sm text-amber-900 dark:text-amber-200"
                  >
                    • {problem}
                  </li>
                ))}
              </ul>
            )}

            <div className="flex gap-2">
              <Button
                onClick={() =>
                  submit.mutate(
                    exempt
                      ? {
                          mode: "exemption",
                          campaignId: activeCampaignId,
                          verifiedUserId: selectedAccountId,
                          evidenceVideoUrl: videoUrl.trim(),
                          exemptionReason: exemptReason.trim(),
                        }
                      : {
                          mode: "report",
                          campaignId: activeCampaignId,
                          verifiedUserId: selectedAccountId,
                          evidenceVideoUrl: videoUrl.trim(),
                          countries: rows.map((r) => ({
                            country: r.country as never,
                            percentage: Number(r.percentage),
                          })),
                        }
                  )
                }
                disabled={problems.length > 0 || submit.isLoading}
              >
                {submit.isLoading && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                {exempt ? "Submit exemption" : "Submit for review"}
              </Button>
              <Button variant="outline" onClick={() => navigate("/earnings")}>
                Back to earnings
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
};

export default WeeklyDemographics;
