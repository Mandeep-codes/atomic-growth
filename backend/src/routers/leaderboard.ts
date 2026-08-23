import {
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { z } from "zod";
import { db } from "../lib/db";
import {
  campaign_applications,
  campaign_view_rewards,
  campaigns,
  site_settings,
  submissions,
  user_clerk,
} from "../lib/schema";
import {
  campaignsEditorRoleProcedure,
  publicProcedure,
  router,
} from "../lib/trpc";
import { optionalAuthProcedure } from "../lib/optionalAuth";
import {
  checkYtDlp,
  downloadAndHostClip,
  isYouTubeUrl,
  isHostingRateLimitedError,
} from "../lib/clipDownloader";
import {
  getYoutubeHostingConfig,
  isYouTubeHostingEnabled,
  isLeaderboardEnabled,
  bustYoutubeHostingCache,
} from "../lib/youtubeHosting";

// Specific accounts kept OFF the public earners board (Pranav's own account
// + EVERY Hannaan account, per request). We do NOT blanket-exclude staff/mods —
// mods like tanishq/achuth/devansh are allowed to appear.
//
//   EXACT      — username must equal one of these (case-insensitive).
//   SUBSTRING  — username CONTAINS one of these (case-insensitive). Used for
//                Hannaan because there are several accounts like
//                "hannaan.kirmani"; a contains-match catches all of them. Kept
//                to distinctive spellings to limit false hits.
//   IDS        — exact numeric Discord IDs: the rename-proof block. Add IDs
//                here and the account is hidden no matter what username it uses.
const EARNERS_DENYLIST_EXACT = new Set(["channelprnv"]);
const EARNERS_DENYLIST_SUBSTRINGS = ["hannaan", "hannan", "hanaan"];
const EARNERS_DENYLIST_IDS = new Set<string>([]);

function isEarnerDenylisted(userId: string, username: string): boolean {
  if (EARNERS_DENYLIST_IDS.has(userId)) return true;
  const u = username.trim().toLowerCase();
  if (EARNERS_DENYLIST_EXACT.has(u)) return true;
  return EARNERS_DENYLIST_SUBSTRINGS.some((s) => u.includes(s));
}

// The earners board is a live per-campaign SUM. The home page can be hit a
// lot, and the underlying earnings only change ~every 4h (reward cron), so
// cache each campaign's result briefly to avoid re-running the SUM on every
// single visit. (No external API is involved — this only spares the DB.)
//
// We ONLY cache results for real, eligible campaigns (see getTopEarners), never
// the "not found / not eligible" empty result — otherwise an unauthenticated
// caller could spam random campaign ids to grow this Map without bound, and a
// campaign briefly toggled inactive would stay "empty" for the whole TTL. The
// hard size cap is a second backstop on memory.
// The private campaigns a viewer is APPROVED for. Approval is the entire
// authorization for seeing a private campaign's board (real title, top clips,
// every earner's name) — an applicant who is pending or rejected gets nothing,
// same as an anonymous visitor. Empty for anonymous viewers.
async function approvedPrivateCampaignIds(
  viewerId: string | null
): Promise<string[]> {
  if (!viewerId) return [];
  const rows = await db
    .select({ campaignId: campaign_applications.campaign_id })
    .from(campaign_applications)
    .where(
      and(
        eq(campaign_applications.user_id, viewerId),
        eq(campaign_applications.status, "approved")
      )
    );
  return rows.map((r) => r.campaignId);
}

// One gate for every board endpoint. Liveness is identical for public and
// private (a dead campaign has no board either way); only VISIBILITY differs:
// a private campaign needs an approved application from this viewer.
async function viewerCanSeeBoard(
  campaign: {
    visibility: string | null;
    cardDeletedAt: Date | null;
    active: boolean | null;
    ended: boolean | null;
  } | null,
  campaignId: string,
  viewerId: string | null
): Promise<boolean> {
  if (
    !campaign ||
    campaign.cardDeletedAt ||
    !campaign.active ||
    campaign.ended
  ) {
    return false;
  }
  if (campaign.visibility !== "private") return true;
  if (!viewerId) return false;
  const [application] = await db
    .select({ id: campaign_applications.id })
    .from(campaign_applications)
    .where(
      and(
        eq(campaign_applications.campaign_id, campaignId),
        eq(campaign_applications.user_id, viewerId),
        eq(campaign_applications.status, "approved")
      )
    )
    .limit(1);
  return Boolean(application);
}

const EARNERS_CACHE_TTL_MS = 10 * 60 * 1000;
const EARNERS_CACHE_MAX = 500;
type EarnersResult = { earners: { rank: number; username: string; totalEarned: number }[] };
const earnersCache = new Map<string, { at: number; data: EarnersResult }>();

function cacheEarners(campaignId: string, data: EarnersResult): EarnersResult {
  // Evict the oldest entry once we hit the cap so memory stays bounded even if
  // the number of eligible campaigns ever grows large.
  if (earnersCache.size >= EARNERS_CACHE_MAX && !earnersCache.has(campaignId)) {
    const oldest = earnersCache.keys().next().value;
    if (oldest !== undefined) earnersCache.delete(oldest);
  }
  earnersCache.set(campaignId, { at: Date.now(), data });
  return data;
}

// Public leaderboards for the home page. Two boards:
//   - per-campaign "top clips": the best-performing clips, played on OUR
//     self-hosted player (no link to the source post).
//   - "top earners": the top 10 by lifetime earnings, username + amount only.
// Both are PUBLIC (no auth) and deliberately expose no source URLs, no
// social-account handles, and — for private campaigns — nothing at all.
export const leaderboardRouter = router({
  // Campaigns eligible for a public clip leaderboard: live, non-private,
  // card not deleted. Drives the home-page campaign selector.
  // Public live campaigns for everyone, PLUS any private live campaign this
  // viewer is approved for (they already see its real identity, so the real
  // title is correct here — no teaser).
  listCampaigns: optionalAuthProcedure.query(async ({ ctx }) => {
    const approvedIds = await approvedPrivateCampaignIds(ctx.viewerId);
    const rows = await db
      .select({
        id: campaigns.id,
        title: campaigns.title,
        imageUrl: campaigns.imageUrl,
        visibility: campaigns.visibility,
      })
      .from(campaigns)
      .where(
        and(
          eq(campaigns.active, true),
          eq(campaigns.ended, false),
          isNull(campaigns.card_deleted_at),
          // or(x, undefined) collapses to x — anonymous viewers get exactly
          // the previous public-only filter.
          or(
            ne(campaigns.visibility, "private"),
            approvedIds.length
              ? inArray(campaigns.id, approvedIds)
              : undefined
          )
        )
      )
      .orderBy(desc(campaigns.created_at));
    return rows.map((r) => ({
      id: r.id,
      title: r.title ?? "Untitled campaign",
      imageUrl: r.imageUrl,
      // Lets the UI mark a board as private — only ever true for a viewer
      // who is approved for it.
      isPrivate: r.visibility === "private",
    }));
  }),

  // Top clips for one campaign, by views. Returns ONLY what's needed to show
  // "what's working": rank, views, platform, and our self-hosted video +
  // thumbnail. It never returns the source URL or the clipper's identity, so
  // a viewer can't navigate to the original post or see whose account it is.
  getCampaignTopClips: optionalAuthProcedure
    .input(
      z.object({
        campaignId: z.string().min(1),
        limit: z.number().int().min(1).max(20).default(10),
      })
    )
    .query(async ({ input, ctx }) => {
      // Guard: live, non-deleted, and either public or a private campaign
      // this viewer is approved for — mirrors listCampaigns so a direct call
      // can't reach a campaign the viewer isn't entitled to.
      const [campaign] = await db
        .select({
          id: campaigns.id,
          title: campaigns.title,
          visibility: campaigns.visibility,
          cardDeletedAt: campaigns.card_deleted_at,
          active: campaigns.active,
          ended: campaigns.ended,
        })
        .from(campaigns)
        .where(eq(campaigns.id, input.campaignId))
        .limit(1);
      if (
        !campaign ||
        !(await viewerCanSeeBoard(campaign, input.campaignId, ctx.viewerId))
      ) {
        return { campaignTitle: null, clips: [] };
      }

      const rows = await db
        .select({
          id: submissions.id,
          platform: submissions.platform,
          views: submissions.views,
          hostedVideoUrl: submissions.hosted_video_url,
          hostedThumbnailUrl: submissions.hosted_thumbnail_url,
        })
        .from(submissions)
        .where(
          and(
            eq(submissions.campaign_id, input.campaignId),
            eq(submissions.status, "approved"),
            isNull(submissions.deleted_at)
          )
        )
        .orderBy(desc(submissions.views))
        .limit(input.limit);

      return {
        campaignTitle: campaign.title ?? "Untitled campaign",
        clips: rows.map((r, index) => ({
          rank: index + 1,
          platform: r.platform,
          views: r.views,
          videoUrl: r.hostedVideoUrl,
          thumbnailUrl: r.hostedThumbnailUrl,
          // true once our cron has downloaded and re-hosted the clip.
          isHosted: Boolean(r.hostedVideoUrl),
        })),
      };
    }),

  // Top earners for ONE campaign: a live SUM of that campaign's
  // campaign_view_rewards.amount grouped by user_id (so no platform/channel
  // ever enters the result), staff-excluded, top 10 by total. Username +
  // amount only.
  getTopEarners: optionalAuthProcedure
    .input(z.object({ campaignId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      // Eligibility is checked LIVE, PER VIEWER, and BEFORE the cache read.
      // Two reasons that ordering matters: a campaign flipped to private /
      // ended / card-deleted must stop serving usernames + earnings
      // immediately rather than linger for up to EARNERS_CACHE_TTL_MS; and a
      // private campaign's cached board must never be handed to a viewer who
      // isn't approved for it. The cached VALUE is viewer-independent (every
      // approved viewer sees the same board), so caching by campaignId alone
      // stays correct as long as this gate runs first.
      const [campaign] = await db
        .select({
          visibility: campaigns.visibility,
          cardDeletedAt: campaigns.card_deleted_at,
          active: campaigns.active,
          ended: campaigns.ended,
        })
        .from(campaigns)
        .where(eq(campaigns.id, input.campaignId))
        .limit(1);
      if (
        !campaign ||
        !(await viewerCanSeeBoard(campaign, input.campaignId, ctx.viewerId))
      ) {
        // Not eligible / not found: return empty but do NOT cache it (so random
        // ids can't grow the cache and a re-activated campaign recovers at once).
        return { earners: [] };
      }

      // Only now (this viewer is entitled) is the cached board safe to serve.
      const cached = earnersCache.get(input.campaignId);
      if (cached && Date.now() - cached.at < EARNERS_CACHE_TTL_MS) {
        return cached.data;
      }

      // Earnings THIS campaign, per user, from the reward ledger. Grouping by
      // user_id only means no platform/channel ever enters the result.
      const rows = await db
        .select({
          userId: campaign_view_rewards.user_id,
          username: user_clerk.discord_username,
          totalEarned: sql<number>`SUM(${campaign_view_rewards.amount})`,
        })
        .from(campaign_view_rewards)
        .leftJoin(
          user_clerk,
          eq(user_clerk.discord_id, campaign_view_rewards.user_id)
        )
        .where(eq(campaign_view_rewards.campaign_id, input.campaignId))
        .groupBy(campaign_view_rewards.user_id, user_clerk.discord_username)
        .orderBy(desc(sql`SUM(${campaign_view_rewards.amount})`))
        // Fetch extra so the blocklist can't shrink us below 10.
        .limit(30);

      const earners = rows
        .filter((r) => Number(r.totalEarned) > 0)
        // Require a real username: without one we can't check the username
        // blocklist, and a named board reads better than "Anonymous".
        .filter((r) => Boolean(r.username && r.username.trim()))
        // Drop Pranav's account + every Hannaan account (and any blocked ID).
        .filter((r) => !isEarnerDenylisted(r.userId, r.username!))
        .slice(0, 10)
        .map((r, index) => ({
          rank: index + 1,
          username: r.username!.trim(),
          totalEarned: Number(r.totalEarned),
        }));

      // Eligible campaign (with or without earners) — safe to cache.
      return cacheEarners(input.campaignId, { earners });
    }),

  // ── Admin diagnostics / manual "run now" ──
  // These let an admin run the two scheduled jobs on demand (e.g. to test
  // right after deploy without waiting for the 4-hour tick, or if the
  // scheduler isn't reachable). Gated to the campaign-editor role.

  // Is yt-dlp installed in this deploy? The single fastest check for the
  // "clips stuck on Preparing" problem — if available is false, the Docker
  // image wasn't rebuilt with yt-dlp.
  checkYtDlp: campaignsEditorRoleProcedure.query(async () => {
    return checkYtDlp();
  }),

  // Hosts up to `limit` (small) un-hosted top clips synchronously and returns
  // exactly what happened per clip, so a yt-dlp / download failure is visible
  // right in the response. Bounded small to fit a request timeout — the cron
  // handles the full backfill.
  runClipHostingNow: campaignsEditorRoleProcedure
    .input(z.object({ limit: z.number().int().min(1).max(5).default(3) }))
    .mutation(async ({ input }) => {
      const ytdlp = await checkYtDlp();
      const youtubeEnabled = await isYouTubeHostingEnabled(true);

      // Same scope as the host-top-clips cron: every live campaign with a
      // board, private included (their approved clippers see a board too).
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

      const toHost: { id: string; url: string }[] = [];
      for (const campaign of boardCampaigns) {
        if (toHost.length >= input.limit) break;
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
          .limit(10);
        for (const clip of top) {
          // Skip YouTube clips while hosting is off (no attempt burned).
          if (isYouTubeUrl(clip.url) && !youtubeEnabled) continue;
          // This manual button force-retries even clips that hit the cron's
          // retry cap — it's a deliberate admin action (bounded to `limit`). It
          // does NOT reset the DB counter, so the background cron still respects
          // the cap and can't loop on a permanently-broken clip.
          if (!clip.hostedVideoUrl) {
            toHost.push({ id: clip.id, url: clip.url });
            if (toHost.length >= input.limit) break;
          }
        }
      }

      const results: {
        id: string;
        url: string;
        ok: boolean;
        detail: string;
      }[] = [];
      // Once YouTube's quota is hit, skip remaining YouTube clips (they'd 429)
      // but keep hosting Instagram/TikTok/X, which use a different path.
      let youtubeQuotaHit = false;
      for (const clip of toHost) {
        if (youtubeQuotaHit && isYouTubeUrl(clip.url)) {
          results.push({
            id: clip.id,
            url: clip.url,
            ok: false,
            detail: "Skipped: YouTube daily/quota limit reached.",
          });
          continue;
        }
        try {
          const r = await downloadAndHostClip({
            submissionId: clip.id,
            url: clip.url,
          });
          await db
            .update(submissions)
            .set({
              hosted_video_url: r.videoUrl,
              hosted_thumbnail_url: r.thumbnailUrl,
              hosted_at: new Date(),
            })
            .where(eq(submissions.id, clip.id));
          results.push({ id: clip.id, url: clip.url, ok: true, detail: "hosted" });
        } catch (error) {
          // A rate/quota cap is not a real failure — report it, don't bump
          // attempts, and skip further YouTube clips (keep hosting the rest).
          if (isHostingRateLimitedError(error)) {
            youtubeQuotaHit = true;
            results.push({
              id: clip.id,
              url: clip.url,
              ok: false,
              detail:
                "Hit the YouTube downloader's daily/quota limit — not counted as a failure; try again later.",
            });
            continue;
          }
          await db
            .update(submissions)
            .set({ hosting_attempts: sql`${submissions.hosting_attempts} + 1` })
            .where(eq(submissions.id, clip.id));
          results.push({
            id: clip.id,
            url: clip.url,
            ok: false,
            detail: error instanceof Error ? error.message : String(error),
          });
        }
      }

      return {
        ytdlp,
        consideredUnhosted: toHost.length,
        results,
      };
    }),

  // Clear the hosted copy of every already-hosted clip so it re-downloads and
  // re-hosts with the current normalization (H.264/AAC + faststart), fixing
  // clips stored in a mobile-incompatible codec (e.g. VP9). They show
  // "Preparing" until the cron / "Host now" re-hosts them.
  rehostClips: campaignsEditorRoleProcedure.mutation(async () => {
    // Only clear clips that can actually be RE-hosted — the same predicate the
    // cron / "Host now" pickup uses (approved, non-deleted clips in a live,
    // public, non-ended, non-card-deleted campaign). Clearing anything wider
    // would orphan a clip's hosted copy with no path to restore it.
    const rows = await db
      .select({ id: submissions.id })
      .from(submissions)
      .innerJoin(campaigns, eq(campaigns.id, submissions.campaign_id))
      .where(
        and(
          isNotNull(submissions.hosted_video_url),
          isNull(submissions.deleted_at),
          eq(submissions.status, "approved"),
          eq(campaigns.active, true),
          eq(campaigns.ended, false),
          isNull(campaigns.card_deleted_at)
          // Private campaigns included: their clips are hosted for their
          // approved clippers' board, so they need re-encoding too.
        )
      );
    if (rows.length > 0) {
      await db
        .update(submissions)
        .set({
          hosted_video_url: null,
          hosted_thumbnail_url: null,
          hosted_at: null,
          hosting_attempts: 0,
        })
        .where(
          inArray(
            submissions.id,
            rows.map((r) => r.id)
          )
        );
    }
    return { cleared: rows.length };
  }),

  // Public: the home page reads this (even unauthenticated) to decide whether
  // to show the leaderboard section at all. Cheap + cached.
  isLeaderboardEnabled: publicProcedure.query(async () => {
    return { enabled: await isLeaderboardEnabled() };
  }),

  // Read the leaderboard master switch, the YouTube-hosting switch, and whether
  // a RapidAPI key is set. NEVER returns the key itself, only whether one exists
  // and where it comes from.
  getHostingSettings: campaignsEditorRoleProcedure.query(async () => {
    const config = await getYoutubeHostingConfig(true);
    return {
      leaderboardEnabled: config.leaderboardEnabled,
      youtubeEnabled: config.enabled,
      // A real (non-placeholder) key is available to call RapidAPI with.
      hasKey: Boolean(config.apiKey && config.apiKey !== "dummy"),
      // Which key is in effect: dedicated YouTube key vs the shared one.
      keySource: config.keySource,
    };
  }),

  // Flip the leaderboard master switch and/or the YouTube-hosting switch, and
  // optionally set the YouTube-only RapidAPI key. All stored in site_settings so
  // no DigitalOcean env access is needed. The DB key takes precedence over both
  // env vars. rapidApiKey: non-empty sets/replaces it; "" clears it (fall back
  // to env); undefined leaves it untouched. The key is never returned.
  setHostingSettings: campaignsEditorRoleProcedure
    .input(
      z.object({
        leaderboardEnabled: z.boolean().optional(),
        youtubeEnabled: z.boolean().optional(),
        rapidApiKey: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const values: Record<string, unknown> = { updated_at: new Date() };
      if (input.leaderboardEnabled !== undefined) {
        values.leaderboard_enabled = input.leaderboardEnabled;
      }
      if (input.youtubeEnabled !== undefined) {
        values.youtube_hosting_enabled = input.youtubeEnabled;
      }
      if (input.rapidApiKey !== undefined) {
        const trimmed = input.rapidApiKey.trim();
        values.youtube_rapidapi_key = trimmed.length > 0 ? trimmed : null;
      }

      const [existing] = await db.select().from(site_settings).limit(1);
      if (!existing) {
        await db.insert(site_settings).values(values);
      } else {
        await db
          .update(site_settings)
          .set(values)
          .where(eq(site_settings.id, existing.id));
      }

      // Take effect immediately rather than after the cache TTL.
      bustYoutubeHostingCache();
      const config = await getYoutubeHostingConfig(true);
      return {
        leaderboardEnabled: config.leaderboardEnabled,
        youtubeEnabled: config.enabled,
        hasKey: Boolean(config.apiKey && config.apiKey !== "dummy"),
        keySource: config.keySource,
      };
    }),
});
