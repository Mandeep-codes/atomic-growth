import { AppLayout } from "@/components/AppLayout";
import { CreatorStats } from "@/components/dashboard/CreatorStats";
import { PayoutReadiness } from "@/components/dashboard/PayoutReadiness";
import { ReferralPanel } from "@/components/dashboard/ReferralPanel";
import {
  Badge,
  Button,
  Card,
  Empty,
  Label,
  Loading,
  Numeric,
  SectionTitle,
  Stat,
} from "@/components/ds";
import { useAuth } from "@/hooks/useAuth";
import { formatCurrency } from "@/lib/formatCurrency";
import { trpc } from "@/lib/trpc";
import BankAccounts from "@/pages/BankAccounts";
import ReferralCodePage from "@/pages/ReferralCode";
import SocialVerification from "@/pages/SocialVerification";
import { format } from "date-fns";
import { ArrowUpRight, Phone } from "lucide-react";
import { Link } from "react-router-dom";

// ─────────────────────────────────────────────────────────────────────────────
// PROFILE
//
// There was no profile page before this — the audit map confirms it. So this
// composes surfaces that already exist rather than inventing any:
//
//   identity          user.getProfile  → { discordId, firstName, lastName,
//                     email, phoneNumber, phoneCountryCode, imageUrl,
//                     createdAt }. That is the WHOLE profile shape, and
//                     user.updatePhoneNumber is the only writer of profile
//                     data anywhere in the app.
//   balance           demographicsVerification.getClaimable
//   demographics      demographicsVerification.getCampaignAsks — shown ONLY
//                     when there is an unsatisfied ask, which is the same
//                     condition the earnings hold uses. No ask ⇒ no prompt.
//   payout history    rewards.getMyEarnings, filtered to the withdrawal rows
//                     the ledger already returns.
//   connected accounts / payout methods / referrals
//                     the real pages, embedded. AppLayout no-ops when nested,
//                     so each keeps its own flow, fields and validation.
// ─────────────────────────────────────────────────────────────────────────────

const WITHDRAWAL_TYPES = new Set([
  "withdrawal",
  "withdrawal_cancellation",
  "withdrawal_refund",
]);

const PAYOUT_LABEL: Record<string, string> = {
  withdrawal: "Withdrawal",
  withdrawal_cancellation: "Cancelled",
  withdrawal_refund: "Refunded",
};

const Profile = () => {
  const { user } = useAuth();
  const enabled = Boolean(user);

  const profile = trpc.user.getProfile.useQuery(undefined, { enabled });
  const claim = trpc.demographicsVerification.getClaimable.useQuery(undefined, {
    enabled,
  });
  const asks = trpc.demographicsVerification.getCampaignAsks.useQuery(
    undefined,
    { enabled }
  );
  const earnings = trpc.rewards.getMyEarnings.useQuery(undefined, { enabled });

  // Same condition as the earnings hold: an ask that is not yet satisfied.
  const outstanding = (asks.data?.asks ?? []).filter((a) => !a.satisfied);

  const payouts = (earnings.data?.entries ?? []).filter((e) =>
    WITHDRAWAL_TYPES.has(e.type)
  );

  const p = profile.data;
  const name = [p?.firstName, p?.lastName].filter(Boolean).join(" ");

  return (
    <AppLayout>
      <div className="mx-auto max-w-4xl space-y-10 px-6 py-8">
        {/* ── Identity ─────────────────────────────────────────────────── */}
        {profile.isLoading ? (
          <Loading label="Loading your profile" />
        ) : (
          <Card className="flex flex-wrap items-center gap-5 p-6">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-muted font-mono text-lg font-bold">
              {p?.imageUrl ? (
                <img
                  src={p.imageUrl}
                  alt=""
                  aria-hidden="true"
                  className="h-full w-full object-cover"
                />
              ) : (
                (name || p?.email || "AC").slice(0, 2).toUpperCase()
              )}
            </div>

            <div className="min-w-0 flex-1 space-y-1">
              <h1 className="display-heading text-2xl sm:text-3xl">
                {name || p?.email || "Creator"}
              </h1>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                {p?.discordId ? <span>Discord {p.discordId}</span> : null}
                {p?.phoneNumber ? (
                  <span>
                    {p.phoneCountryCode} {p.phoneNumber}
                  </span>
                ) : null}
                {p?.createdAt ? (
                  <span>Joined {format(new Date(p.createdAt), "MMM yyyy")}</span>
                ) : null}
              </div>
            </div>

            {!p?.phoneNumber ? (
              <Link
                to="/onboarding"
                className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2.5 font-mono text-[10px] font-bold uppercase tracking-[0.16em] transition-colors hover:border-foreground/40"
              >
                <Phone className="h-3.5 w-3.5" /> Add phone
              </Link>
            ) : null}
          </Card>
        )}

        {/* ── Balance + demographics requirement ───────────────────────── */}
        <Card inverted className="space-y-4 p-6">
          <div className="flex items-start justify-between">
            <Label className="opacity-60">Claimable balance</Label>
            <Link
              to="/earnings"
              aria-label="Open earnings"
              className="opacity-60 transition-opacity hover:opacity-100"
            >
              <ArrowUpRight className="h-4 w-4" />
            </Link>
          </div>
          <Numeric size="xl">
            {claim.data ? formatCurrency(claim.data.claimable) : "—"}
          </Numeric>

          {/* The grey panel that used to sit here repeated the hold — the
              amount, the campaign name, and a link — on a card whose job is the
              claimable figure. /earnings and the demographics panel both show
              that breakdown properly, with the accounts and their states.
              What stays is the one action, bold and without the underline
              that made it read as body copy with a link in it. */}
          {outstanding.length > 0 ? (
            <Link
              to="/demographics-verification/weekly"
              className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.14em] opacity-90 transition-opacity hover:opacity-100"
            >
              Submit demographics
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          ) : null}
        </Card>

        {/* ── Creator stats ────────────────────────────────────────────── */}
        <CreatorStats />

        {/* ── Payout history ───────────────────────────────────────────── */}
        <section className="space-y-6">
          <SectionTitle meta={payouts.length ? `${payouts.length}` : undefined}>
            Payout history
          </SectionTitle>
          {earnings.isLoading ? (
            <Loading label="Loading payouts" />
          ) : payouts.length === 0 ? (
            <Empty>
              No payouts yet. Once you claim, every payout shows up here.
            </Empty>
          ) : (
            <Card className="divide-y divide-border">
              {payouts.map((entry) => {
                const amount = Number(entry.amount ?? 0);
                return (
                  <div
                    key={entry.id}
                    className="flex items-center gap-3 px-5 py-3.5"
                  >
                    <Badge
                      tone={entry.type === "withdrawal" ? "neutral" : "warning"}
                    >
                      {PAYOUT_LABEL[entry.type] ?? entry.type}
                    </Badge>
                    <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                      {entry.memo || "—"}
                    </span>
                    <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      {format(new Date(entry.createdAt), "d MMM yyyy")}
                    </span>
                    <span className="shrink-0 font-mono text-sm font-bold">
                      {formatCurrency(Math.abs(amount))}
                    </span>
                  </div>
                );
              })}
            </Card>
          )}
        </section>

        {/* ── Connected accounts — the real verification page ──────────── */}
        <section className="space-y-6">
          <SectionTitle>Connected accounts</SectionTitle>
          {/* There used to be a compact per-platform summary above this, but it
              listed the same platforms with the same connect action as the page
              below it — the same accounts twice, and two places to click for
              one job. The real page already shows per-platform state AND owns
              connecting, removing, bio codes and OAuth, so it is the one that
              stays. */}
          <Card className="p-1">
            <SocialVerification />
          </Card>
        </section>

        {/* ── Payout methods — the real page ───────────────────────────── */}
        <section className="space-y-6">
          <SectionTitle>Payout methods</SectionTitle>
          {/* Readiness summary above the real screen: whether a method is
              connected, whether the balance clears the minimum, what is held,
              and whether a request is already in flight. Reads the same
              procedures that gate the claim button — it decides nothing. */}
          <PayoutReadiness />
          <Card className="p-1">
            <BankAccounts />
          </Card>
        </section>

        {/* ── Referrals — the real page ────────────────────────────────── */}
        <section className="space-y-6">
          <SectionTitle>Referrals</SectionTitle>
          {/* Code, copy, share and how many people used it. Uses the same
              referrals.* procedures as the full page below — including the
              existing behaviour that a cancelled native share is silent. */}
          <ReferralPanel />
          <Card className="p-1">
            <ReferralCodePage />
          </Card>
        </section>
      </div>
    </AppLayout>
  );
};

export default Profile;
