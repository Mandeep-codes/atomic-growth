import { and, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "../lib/db";
import { campaign_view_rewards, campaigns, submissions } from "../lib/schema";
import { protectedProcedure, publicProcedure, router } from "../lib/trpc";

// PUBLIC PLATFORM STATS
//
// Real numbers for the landing page: what has been paid, how many views
// tracked, how many clips approved. Every clipping platform that recruits well
// leads with these (Vues publishes total paid and approved-clip counts openly)
// and it is the strongest recruiting tool the category has - "3 campaigns live
// now" persuades nobody.
//
// WHY NOT JUST USE campaigns.getAll:
// The landing page currently derives these client-side from getAll, which only
// returns campaigns the VIEWER may see. Signed out that means public campaigns
// only, so the figures understate the platform - and most campaigns here are
// private. This aggregates across everything.
//
// SAFE TO EXPOSE: only four totals leave this procedure. No campaign is named,
// no clipper is named, no per-campaign budget or rate is revealed, so private
// campaign economics stay private. Same class of disclosure as "we have paid
// out $X" on a marketing page.
//
// CACHING: recomputed at most every CACHE_MS. These are aggregate scans over
// the two largest tables, and the landing page is the most public URL we have -
// without this an unauthenticated visitor could trigger a full scan per load.

const CACHE_MS = 5 * 60 * 1000;
// Shorter: the queue moves through the day, and a stale depth is worse than a
// slightly more expensive query.
const QUEUE_CACHE_MS = 60 * 1000;

type PublicTotals = {
  totalPaid: number;
  totalViews: number;
  clipsApproved: number;
  campaignsLive: number;
};

let cache: { at: number; value: PublicTotals } | null = null;

async function computeTotals(): Promise<PublicTotals> {
  // Legacy rows (verified_user_id IS NULL) and per-account rows coexist after
  // the odometer cutover, so SUM(amount) over everything is still the true
  // total paid - opening rows were seeded at amount 0 precisely so they do not
  // double-count.
  const [rewards] = await db
    .select({
      paid: sql<number>`COALESCE(SUM(${campaign_view_rewards.amount}), 0)`,
      views: sql<number>`COALESCE(SUM(${campaign_view_rewards.view_count}), 0)`,
    })
    .from(campaign_view_rewards);

  const [clips] = await db
    .select({ n: sql<number>`COUNT(*)` })
    .from(submissions)
    .where(
      and(eq(submissions.status, "approved"), isNull(submissions.deleted_at))
    );

  const [live] = await db
    .select({ n: sql<number>`COUNT(*)` })
    .from(campaigns)
    // active AND not ended - `ended` is a separate flag, and an ended campaign
    // left active would otherwise be counted as live.
    .where(and(eq(campaigns.active, true), eq(campaigns.ended, false)));

  return {
    totalPaid: Number(rewards?.paid ?? 0),
    totalViews: Number(rewards?.views ?? 0),
    clipsApproved: Number(clips?.n ?? 0),
    campaignsLive: Number(live?.n ?? 0),
  };
}

/**
 * How the review queue is doing, right now. Same numbers for everyone, so it
 * caches hard and costs one small query.
 *
 * This exists because auto-approval was explicitly rejected - clip review is
 * quality control that Divy runs daily, and taking the decision away would
 * undermine it. But the clipper-side problem is real: a clip sitting in
 * "pending" with no end date is unpaid work with no visible progress. Showing
 * queue depth and typical turnaround solves the anxiety without touching who
 * makes the decision.
 */
async function computeQueue() {
  const [pending] = await db
    .select({ n: sql<number>`COUNT(*)` })
    .from(submissions)
    .where(
      and(
        or(eq(submissions.status, "pending"), isNull(submissions.status)),
        isNull(submissions.deleted_at)
      )
    );

  // Median would be better than mean, but MySQL has no percentile function and
  // this is a hint, not a contract. 30-day lookback so one ancient clip cannot
  // skew what a clipper is shown today.
  const [recent] = await db
    .select({
      hours: sql<number>`AVG(TIMESTAMPDIFF(HOUR, ${submissions.created_at}, ${submissions.updated_at}))`,
    })
    .from(submissions)
    .where(
      and(
        eq(submissions.status, "approved"),
        isNull(submissions.deleted_at),
        sql`${submissions.updated_at} >= NOW() - INTERVAL 30 DAY`
      )
    );

  const avg = Number(recent?.hours ?? 0);
  return {
    pendingCount: Number(pending?.n ?? 0),
    // null when there is not enough history to say anything honest.
    typicalHours: Number.isFinite(avg) && avg > 0 ? Math.round(avg) : null,
  };
}

let queueCache: { at: number; value: Awaited<ReturnType<typeof computeQueue>> } | null =
  null;

export const statsRouter = router({
  /** Platform-wide totals for the public landing page. Unauthenticated. */
  getPublicTotals: publicProcedure.query(async () => {
    if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;

    try {
      const value = await computeTotals();
      cache = { at: Date.now(), value };
      return value;
    } catch (error) {
      // The landing page is the front door. A stats query falling over should
      // never take it down - serve the last good value, or zeros, and let the
      // page render. The frontend hides any tile whose value is zero.
      console.error("[stats] getPublicTotals failed", error);
      return (
        cache?.value ?? {
          totalPaid: 0,
          totalViews: 0,
          clipsApproved: 0,
          campaignsLive: 0,
        }
      );
    }
  }),

  /** Review queue depth + typical turnaround. Signed-in clippers only. */
  getReviewQueue: protectedProcedure.query(async () => {
    if (queueCache && Date.now() - queueCache.at < QUEUE_CACHE_MS) {
      return queueCache.value;
    }
    try {
      const value = await computeQueue();
      queueCache = { at: Date.now(), value };
      return value;
    } catch (error) {
      console.error("[stats] getReviewQueue failed", error);
      return queueCache?.value ?? { pendingCount: 0, typicalHours: null };
    }
  }),
});
