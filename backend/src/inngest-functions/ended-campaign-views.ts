import { and, eq, isNull, sql, sum } from "drizzle-orm";
import { submissionOwnerInGoodStanding } from "../lib/banPurge";
import { db } from "../lib/db";
import { campaigns, submissions } from "../lib/schema";
import { inngest } from "../lib/inngest";
import { env } from "../lib/env";
import {
  fetchRichAny,
  getYouTubeBatchRich,
  youtubeRichFromBatch,
  type YouTubeBatchRich,
} from "./update-views/getViewsRich";
import { getYouTubeVideoId } from "./update-views/getYouTubeViews";
import { DELETION_STRIKE_THRESHOLD, DELETION_HANDLING_ENABLED } from "./update-views/updateViewCounts";

// Ended campaigns are skipped by the 4-hour cron (it only does active ones).
// This job keeps their view counts (and dashboard totals) fresh, and — for
// campaigns that have an end_date (the "must stay live 3 months after end"
// rule, i.e. Superblocks onward) and are still inside that 3-month window —
// also watches for deleted clips. It NEVER changes rewards (ended campaigns
// don't pay more), and post-end deletions are FLAGGED only (no clawback —
// that money was already earned), surfacing in the user-page "deleted after
// campaign end" section for a ban decision.
//
// QUOTA SHAPE (2026-07-06): the pool is every approved clip of every ended
// campaign — tens of thousands and growing as campaigns end. Doing them all
// in one run, one YouTube call per clip, demanded several times the entire
// 10k/day quota in a single morning. Now: the cron runs DAILY but each run
// takes only the shard of clips whose CRC32(id) % SHARDS matches the day, so
// every clip is refreshed once every SHARDS days (~2x/week), the load is
// flat across days, and newly-ended campaigns automatically join the
// rotation. YouTube lookups are batched 50 ids per call (1 quota unit per
// call) like the active-campaign cron. Net: ~43k clips ≈ ~580 units/day
// instead of ~43k units every second day. Deletion strikes accrue once per
// shard visit, so confirmed-deletion takes STRIKE_THRESHOLD × SHARDS days.
const CHUNK = 25;
const SHARDS = 3;
const THREE_MONTHS_MS = 1000 * 60 * 60 * 24 * 91;

const isYouTubeUrl = (url: string) =>
  url.includes("youtube.com") || url.includes("you");

const processEndedClip = async (
  clip: {
    id: string;
    url: string;
    views: number;
    unavailable_strikes: number;
    unavailable_since: Date | null;
  },
  watchForDeletion: boolean,
  // Pre-fetched YouTube batch for this chunk — 1 quota unit per 50 clips
  // instead of 1 per clip. Non-YouTube URLs still fetch individually
  // (RapidAPI, separate budget).
  youtubeBatch: YouTubeBatchRich
) => {
  let rich;
  try {
    rich = isYouTubeUrl(clip.url)
      ? youtubeRichFromBatch(clip.url, youtubeBatch)
      : await fetchRichAny(clip.url);
  } catch {
    return;
  }
  if (rich.state === "error") return;

  if (rich.state === "gone") {
    if (!DELETION_HANDLING_ENABLED) return;
    // Older campaigns (no end_date): views only, no deletion enforcement.
    if (!watchForDeletion) return;
    const strikes = (clip.unavailable_strikes ?? 0) + 1;
    const updates: Record<string, unknown> = { unavailable_strikes: strikes };
    if (!clip.unavailable_since) updates.unavailable_since = new Date();
    // Flag only — NO clawback (campaign already paid out). The 3-month section
    // shows these for a ban decision.
    if (strikes >= DELETION_STRIKE_THRESHOLD) updates.deleted_at = new Date();
    await db
      .update(submissions)
      .set(updates)
      .where(eq(submissions.id, clip.id));
    return;
  }

  // live: clear transient strikes + refresh views (no reward changes)
  const updates: Record<string, unknown> = {};
  if ((clip.unavailable_strikes ?? 0) > 0 || clip.unavailable_since) {
    updates.unavailable_strikes = 0;
    updates.unavailable_since = null;
  }
  if (rich.views !== clip.views) updates.views = rich.views;
  if (Object.keys(updates).length) {
    await db.update(submissions).set(updates).where(eq(submissions.id, clip.id));
  }
};

export const updateEndedCampaignViews = inngest.createFunction(
  { id: "update-ended-campaign-views" },
  { cron: "TZ=America/New_York 0 8 * * *" }, // daily, 8 AM ET — one shard/day
  async ({ logger, step }) => {
    if (env.NODE_ENV !== "production") {
      logger.info("Skipping update-ended-campaign-views in non-production");
      return;
    }

    // Today's shard: clips whose CRC32(id) % SHARDS matches. Deterministic,
    // stateless, and self-balancing — every clip lands in exactly one shard,
    // so each is refreshed every SHARDS days regardless of pool growth.
    // Pinned in a memoized step: Inngest replays the whole function body on
    // every step invocation, so a bare Date.now() here could flip the shard
    // mid-run if the run crosses a UTC day boundary (skipping that day's
    // later clips). Recording it once keeps the shard stable for the run.
    const shard = await step.run("pick-shard", () =>
      Math.floor(Date.now() / 86_400_000) % SHARDS
    );

    const ended = await db
      .select({
        id: campaigns.id,
        title: campaigns.title,
        end_date: campaigns.end_date,
      })
      .from(campaigns)
      .where(eq(campaigns.ended, true));

    logger.info("Ended campaigns to refresh", ended.length);

    for (const campaign of ended) {
      const watchForDeletion = campaign.end_date
        ? Date.now() <=
          new Date(campaign.end_date).getTime() + THREE_MONTHS_MS
        : false;

      const clips = await db
        .select({
          id: submissions.id,
          url: submissions.url,
          views: submissions.views,
          unavailable_strikes: submissions.unavailable_strikes,
          unavailable_since: submissions.unavailable_since,
        })
        .from(submissions)
        .where(
          and(
            eq(submissions.campaign_id, campaign.id),
            eq(submissions.status, "approved"),
            isNull(submissions.deleted_at),
            sql`CRC32(${submissions.id}) % ${SHARDS} = ${shard}`
          )
        );

      for (let i = 0; i < clips.length; i += CHUNK) {
        const chunk = clips.slice(i, i + CHUNK);
        await step.run(`ended-${campaign.id}-${i}`, async () => {
          // One videos.list call for the chunk's YouTube clips (1 unit per
          // 50 ids) — same batch the active-campaign cron uses.
          const youtubeBatch = await getYouTubeBatchRich(
            chunk
              .map((c) => (isYouTubeUrl(c.url) ? getYouTubeVideoId(c.url) : null))
              .filter((id): id is string => Boolean(id))
          );
          await Promise.all(
            chunk.map((clip) =>
              processEndedClip(clip, watchForDeletion, youtubeBatch)
            )
          );
          return { ok: true };
        });
      }

      // Refresh the dashboard total views (NO reward / achieved change).
      const [tot] = await db
        .select({ totalViews: sum(submissions.views) })
        .from(submissions)
        .where(
          and(
            eq(submissions.campaign_id, campaign.id),
            eq(submissions.status, "approved"),
            // Deleted clips drop out of an ended campaign's total views too.
            isNull(submissions.deleted_at),
            // So do banned clippers'. A LIVE campaign's views already exclude
            // them, so without this the number visibly JUMPED BACK UP the day
            // the campaign ended — a client-facing figure rising for no
            // reason at exactly the moment you'd be reporting on it.
            submissionOwnerInGoodStanding
          )
        );
      await db
        .update(campaigns)
        .set({ views: Number(tot?.totalViews ?? 0) })
        .where(eq(campaigns.id, campaign.id));
    }

    return { endedCampaigns: ended.length };
  }
);
