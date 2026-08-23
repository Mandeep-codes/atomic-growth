import { and, eq, gte, lt, not, or, sql, type SQL } from "drizzle-orm";
import { submissions } from "./schema";

// Campaigns whose PUBLIC STATS — per-campaign leaderboard, dashboard, and
// bounty progress — count ONLY clips that meet a minimum view count. This is
// a client-facing "qualifying delivery" view: clips below the threshold are
// hidden from the delivered-views / progress / rankings numbers, matching the
// campaign's min-views payout requirement.
//
// IMPORTANT: this is display-only. It deliberately does NOT touch the reward /
// payout engine (createCampaignViewRewards / createReward), which keeps its own
// per-user min_payout logic and pays real money. It also does not affect the
// mod applicant-review history.
//
// Keyed by campaign id -> minimum views. To apply this to another campaign,
// add its id here (typically equal to that campaign's min_payout).
export const MIN_VIEW_DISPLAY_THRESHOLDS: Record<string, number> = {
  // Replit Private Campaign (private, ended; min_payout = 3000 views).
  campaign_1783258985456: 3000,
};

// Returns a Drizzle condition that keeps only clips at/above the campaign's
// display threshold, or undefined for campaigns with no rule (so it can be
// dropped straight into an `and(...)` unchanged). Use in single-campaign
// queries where the campaign id is known.
export const minViewDisplayFilter = (
  campaignId: string
): SQL | undefined => {
  const threshold = MIN_VIEW_DISPLAY_THRESHOLDS[campaignId];
  return threshold != null ? gte(submissions.views, threshold) : undefined;
};

// For MULTI-campaign aggregates (e.g. the campaign-card grid): drops a row
// only when its campaign has a threshold AND the row is below it. Campaigns
// with no rule pass through untouched. Returns undefined when no rules exist.
export const minViewDisplayFilterAllCampaigns = (): SQL | undefined => {
  const belowThresholdPerCampaign = Object.entries(MIN_VIEW_DISPLAY_THRESHOLDS)
    .map(([campaignId, threshold]) =>
      and(
        eq(submissions.campaign_id, campaignId),
        lt(submissions.views, threshold)
      )
    )
    .filter((c): c is SQL => c != null);

  if (belowThresholdPerCampaign.length === 0) return undefined;
  // Keep the row unless it is a below-threshold clip of a ruled campaign.
  return not(or(...belowThresholdPerCampaign)!);
};

// Raw-SQL form of the same rule, for use INSIDE a correlated subquery over the
// `submissions` table (e.g. the private-campaign card overlay's SUM(reward)).
// Yields a predicate that keeps a row unless it's a below-threshold clip of a
// ruled campaign; `1 = 1` (no-op) when there are no rules.
export const minViewDisplaySqlPredicate = (): SQL => {
  const clauses = Object.entries(MIN_VIEW_DISPLAY_THRESHOLDS).map(
    ([campaignId, threshold]) =>
      sql`NOT (${submissions.campaign_id} = ${campaignId} AND ${submissions.views} < ${threshold})`
  );
  if (clauses.length === 0) return sql`1 = 1`;
  return sql.join(clauses, sql` AND `);
};
