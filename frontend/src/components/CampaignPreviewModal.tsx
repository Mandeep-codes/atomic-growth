import { Dialog, DialogContent } from "@/components/ui/dialog";
import { EligibilityPanel } from "@/components/campaign/EligibilityPanel";
import { formatCurrency } from "@/lib/formatCurrency";
import { useAuth } from "@/hooks/useAuth";
import type { inferRouterOutputs } from "@trpc/server";
import { ArrowRight, Check, Lock } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { AppRouter } from "../../../backend/src/routers";

type Campaign = inferRouterOutputs<AppRouter>["campaigns"]["getAll"][number] & {
  unlockedForMe?: boolean;
};

const PLATFORM_LABELS: Record<string, string> = {
  youtube: "YouTube",
  yt: "YouTube",
  instagram: "Instagram",
  ig: "Instagram",
  tiktok: "TikTok",
  tt: "TikTok",
  x: "X",
  twitter: "X",
};

const nf = new Intl.NumberFormat("en-US");

/**
 * Derive the requirement list from what the campaign actually stores.
 *
 * The design mocked this as a hand-written "key requirements" list, but there
 * is no such column — inventing copy here would state rules the payout engine
 * does not enforce. Every line below is read from a real field, so the panel
 * cannot drift from what actually gates the money.
 */
const requirementsFor = (campaign: Campaign, hideNumbers: boolean) => {
  const out: string[] = [];

  const platforms = (campaign.platforms ?? "")
    .split(",")
    .map((p) => PLATFORM_LABELS[p.trim().toLowerCase()] ?? p.trim())
    .filter(Boolean);
  if (platforms.length) {
    out.push(`Post on ${[...new Set(platforms)].join(", ")}`);
  }

  if (!hideNumbers && Number(campaign.min_payout) > 0) {
    out.push(
      `Reach ${nf.format(
        Number(campaign.min_payout)
      )} combined views across your accounts before earnings start`
    );
  }

  const floors: [string, unknown][] = [
    ["YouTube", campaign.youtube_min_views],
    ["Instagram", campaign.insta_min_views],
    ["TikTok", campaign.tiktok_min_views],
    ["X", campaign.x_min_views],
  ];
  const active = floors.filter(([, v]) => Number(v ?? 0) > 0);
  if (!hideNumbers && active.length) {
    const same = new Set(active.map(([, v]) => Number(v))).size === 1;
    out.push(
      same
        ? `Each clip needs at least ${nf.format(
            Number(active[0]![1])
          )} views to be paid`
        : active
            .map(([p, v]) => `${p}: ${nf.format(Number(v))} views per clip`)
            .join(" · ")
    );
  }

  const required = Number(campaign.non_campaign_clips_required ?? 0);
  const per = Number(campaign.non_campaign_clips_per ?? 0);
  if (required > 0 && per > 0) {
    out.push(
      `One non-campaign clip covers every ${per} campaign ${
        per === 1 ? "clip" : "clips"
      } from that account`
    );
  }

  out.push("Post from a social account you have verified on Atomik Clips");

  return out;
};

export const CampaignPreviewModal = ({
  campaign,
  onClose,
}: {
  campaign: Campaign | null;
  onClose: () => void;
}) => {
  const navigate = useNavigate();
  const { user } = useAuth();

  if (!campaign) return null;

  const isPrivate = campaign.visibility === "private";
  const teased = isPrivate && !campaign.unlockedForMe;
  const hideBudget = teased && !campaign.private_show_budget;
  const hideRates = teased && !campaign.private_show_rates;

  const rates = [
    campaign.youtube_per_1000,
    campaign.insta_per_1000,
    campaign.tiktok_per_1000,
    campaign.x_per_1000,
  ]
    .map((r) => Number(r ?? 0))
    .filter((r) => r > 0);
  const topRate = rates.length ? Math.max(...rates) : null;
  const ratesVary = new Set(rates).size > 1;

  const progress = Number.isFinite(campaign.achievementPercentage)
    ? Math.max(0, Math.min(Number(campaign.achievementPercentage), 100))
    : null;

  const ended = Boolean(campaign.ended);
  const paused = Boolean(campaign.submissions_paused);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto rounded-3xl border-border bg-card p-0">
        {campaign.imageUrl ? (
          <div className="relative h-40 w-full overflow-hidden rounded-t-3xl border-b border-border bg-muted">
            <img
              src={campaign.imageUrl}
              alt=""
              aria-hidden="true"
              className="h-full w-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-card via-card/30 to-transparent" />
          </div>
        ) : null}

        <div className="space-y-6 p-6">
          <div className="space-y-2">
            <h2 className="display-heading text-2xl leading-tight sm:text-3xl">
              {campaign.title || "Untitled campaign"}
            </h2>
            {isPrivate ? (
              <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                <Lock className="h-3 w-3" /> Private campaign
              </span>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-3 rounded-2xl border border-border bg-muted/40 p-4 font-mono">
            <div>
              <span className="block text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                {ratesVary ? "Reward rate up to" : "Reward rate"}
              </span>
              <span className="mt-1 block text-2xl font-bold">
                {hideRates || topRate === null ? (
                  <span className="text-base text-muted-foreground">
                    {hideRates ? "Hidden" : "Not set"}
                  </span>
                ) : (
                  <>
                    ${topRate.toFixed(2)}
                    <span className="text-xs font-normal text-muted-foreground">
                      {" "}
                      / 1k views
                    </span>
                  </>
                )}
              </span>
            </div>
            <div>
              <span className="block text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                Overall budget
              </span>
              <span className="mt-1 block text-2xl font-bold">
                {hideBudget ? (
                  <span className="text-base text-muted-foreground">
                    Hidden
                  </span>
                ) : (
                  formatCurrency(campaign.budget)
                )}
              </span>
            </div>
          </div>

          {!hideBudget && progress !== null ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.18em]">
                <span className="text-muted-foreground">
                  Campaign completion
                </span>
                <span className="font-bold">{progress.toFixed(0)}%</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-foreground transition-all duration-500"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          ) : null}

          {campaign.description ? (
            <div className="space-y-2">
              <span className="block font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                Campaign brief
              </span>
              <p className="rounded-2xl border border-border bg-muted/40 p-4 text-sm leading-relaxed text-foreground/80">
                {campaign.description}
              </p>
            </div>
          ) : null}

          <div className="space-y-2">
            <span className="block font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              Key requirements
            </span>
            <ul className="space-y-2">
              {requirementsFor(campaign, hideRates).map((line) => (
                <li key={line} className="flex items-start gap-2 text-sm">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="text-foreground/80">{line}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Private campaigns gate on moderator approval before the CTA
              means anything, so the requirement list sits directly above it.
              Renders nothing for public campaigns. */}
          {user ? (
            <EligibilityPanel
              campaignId={campaign.id}
              isPrivate={isPrivate}
              ended={ended}
            />
          ) : null}

          {/* For a private campaign the eligibility panel owns the action —
              it knows whether the clipper is approved. Rendering the generic
              Submit Clip button underneath it offered a route the server
              would reject with "This is a private campaign. Apply from the
              campaign card and wait for a moderator to approve you before
              submitting clips." */}
          {isPrivate && user ? null : ended ? (
            <div className="rounded-xl border border-border bg-muted/40 py-3.5 text-center font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
              Campaign closed
            </div>
          ) : paused ? (
            <div className="rounded-xl border border-border bg-muted/40 py-3.5 text-center font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
              Not accepting submissions
            </div>
          ) : user ? (
            <button
              type="button"
              onClick={() => navigate(`/campaign/${campaign.id}/submit`)}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-foreground py-3.5 font-mono text-xs font-extrabold uppercase tracking-[0.18em] text-background transition-transform duration-200 hover:scale-[0.98]"
            >
              <span>Submit clip</span>
              <ArrowRight className="h-4 w-4" />
            </button>
          ) : (
            // Signed out, Submit Clip enters onboarding — the same path the
            // landing page takes, so there is one continuous flow into the
            // product no matter where someone starts.
            <button
              type="button"
              onClick={() => navigate("/onboarding")}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-foreground py-3.5 font-mono text-xs font-extrabold uppercase tracking-[0.18em] text-background transition-transform duration-200 hover:scale-[0.98]"
            >
              <span>Sign in to submit</span>
              <ArrowRight className="h-4 w-4" />
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default CampaignPreviewModal;
