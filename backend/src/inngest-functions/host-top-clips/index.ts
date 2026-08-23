import { and, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { db } from "../../lib/db";
import { inngest } from "../../lib/inngest";
import { campaigns, submissions } from "../../lib/schema";
import {
  downloadAndHostClip,
  isYouTubeUrl,
  isHostingRateLimitedError,
} from "../../lib/clipDownloader";
import {
  isYouTubeHostingEnabled,
  isLeaderboardEnabled,
} from "../../lib/youtubeHosting";
import { env } from "../../lib/env";

// How many TOP clips per campaign the public leaderboard shows.
const TOP_N = 10;
// Cap downloads per run so one cron tick can't run for ages. Steady state is
// ~0 (everything already hosted); this only bites during the initial backfill,
// which catches up over successive runs. Runs 30 min after the view cron so
// the "top" ranking is based on fresh view counts.
const MAX_HOSTS_PER_RUN = 15;
// Stop retrying a clip that keeps failing to download (private/geo-blocked/
// removed). A mod can reset hosting_attempts to retry.
const MAX_ATTEMPTS = 3;

export const hostTopClips = inngest.createFunction(
  { id: "host-top-clips" },
  { cron: "TZ=America/New_York 30 */4 * * *" },
  async ({ logger, step }) => {
    if (env.NODE_ENV !== "production") {
      logger.info("Skipping host-top-clips in non-production");
      return;
    }

    // If the whole leaderboard is switched off, there's nothing to host.
    if (!(await isLeaderboardEnabled(true))) {
      logger.info("Skipping host-top-clips: leaderboard is disabled");
      return { considered: 0, hosted: 0, failed: 0 };
    }

    // When YouTube hosting is switched off we skip YouTube clips entirely (no
    // download, no RapidAPI call, and crucially no bumped attempt) so they're
    // picked up cleanly once it's switched back on.
    const youtubeEnabled = await isYouTubeHostingEnabled(true);

    // Every LIVE campaign with a leaderboard — public ones (visible to all)
    // and private ones (visible to their approved clippers). Private
    // campaigns are included because their approved clippers get a board too;
    // without hosting their clips the board would sit on "Preparing clip…"
    // forever. Who may SEE a board is enforced per request in the leaderboard
    // router, not here — this job only decides which clips get downloaded.
    const boardCampaigns = await db
      .select({ id: campaigns.id })
      .from(campaigns)
      .where(
        and(
          eq(campaigns.active, true),
          eq(campaigns.ended, false),
          isNull(campaigns.card_deleted_at)
        )
      );

    // Collect the top clips that still need hosting, capped per run.
    const toHost: { id: string; url: string }[] = [];
    for (const campaign of boardCampaigns) {
      if (toHost.length >= MAX_HOSTS_PER_RUN) break;
      const top = await db
        .select({
          id: submissions.id,
          url: submissions.url,
          hostedVideoUrl: submissions.hosted_video_url,
          hostingAttempts: submissions.hosting_attempts,
        })
        .from(submissions)
        .where(
          and(
            eq(submissions.campaign_id, campaign.id),
            eq(submissions.status, "approved"),
            isNull(submissions.deleted_at)
          )
        )
        .orderBy(desc(submissions.views))
        .limit(TOP_N);

      for (const clip of top) {
        // Skip YouTube clips while hosting is off — don't queue or count them.
        if (isYouTubeUrl(clip.url) && !youtubeEnabled) continue;
        if (!clip.hostedVideoUrl && clip.hostingAttempts < MAX_ATTEMPTS) {
          toHost.push({ id: clip.id, url: clip.url });
          if (toHost.length >= MAX_HOSTS_PER_RUN) break;
        }
      }
    }

    logger.info("host-top-clips: clips needing hosting", {
      count: toHost.length,
    });

    let hosted = 0;
    let failed = 0;
    // Once the YouTube downloader's quota is hit, we stop attempting YouTube
    // clips (they'd just 429) but keep hosting Instagram/TikTok/X clips, which
    // use yt-dlp and share no quota with YouTube.
    let youtubeQuotaHit = false;
    for (const clip of toHost) {
      if (youtubeQuotaHit && isYouTubeUrl(clip.url)) continue;
      // Two steps on purpose. The DOWNLOAD step memoizes its result on
      // success, so if the later DB write fails and the run retries, the clip
      // is NOT downloaded (and re-uploaded to Spaces) again. The download step
      // does no DB work, so nothing here bumps hosting_attempts for a mere
      // DB blip — only a genuine download failure counts as an attempt.
      const dl = await step.run(`download-${clip.id}`, async () => {
        try {
          const result = await downloadAndHostClip({
            submissionId: clip.id,
            url: clip.url,
          });
          return { ok: true as const, ...result };
        } catch (error) {
          // A rate/quota cap (e.g. free-tier daily limit) is NOT a real
          // failure — skip without bumping attempts so the clip is retried on
          // a later run once the cap resets, never marked broken.
          if (isHostingRateLimitedError(error)) {
            logger.info(`Rate limited hosting ${clip.id}; will retry later`);
            return { ok: false as const, rateLimited: true as const };
          }
          console.error(`Failed to host clip ${clip.id} (${clip.url})`, error);
          return { ok: false as const, rateLimited: false as const };
        }
      });

      if (dl.ok) {
        // Separate step: a DB failure here retries the persist (using the
        // memoized download result) instead of re-downloading.
        await step.run(`persist-${clip.id}`, async () => {
          await db
            .update(submissions)
            .set({
              hosted_video_url: dl.videoUrl,
              hosted_thumbnail_url: dl.thumbnailUrl,
              hosted_at: new Date(),
            })
            .where(eq(submissions.id, clip.id));
        });
        hosted++;
      } else if (dl.rateLimited) {
        // Out of YouTube quota — skip remaining YouTube clips (no attempt
        // burned; they retry once the cap resets) but keep going for the rest.
        youtubeQuotaHit = true;
        logger.info(
          "host-top-clips: YouTube quota hit; skipping remaining YouTube clips this run"
        );
        continue;
      } else {
        await step.run(`mark-failed-${clip.id}`, async () => {
          await db
            .update(submissions)
            .set({
              hosting_attempts: sql`${submissions.hosting_attempts} + 1`,
            })
            .where(eq(submissions.id, clip.id));
        });
        failed++;
      }
    }

    logger.info("host-top-clips complete", { hosted, failed });
    return { considered: toHost.length, hosted, failed };
  }
);

export { MAX_ATTEMPTS, TOP_N };
