import axios from "axios";
import { env } from "../../lib/env";
import { getYouTubeVideoId } from "./getYouTubeViews";

// ─────────────────────────────────────────────────────────────────────────
// Rich view-fetchers (Features 0 + 1). Same single API call the view cron
// already makes, but returns WHY a clip reads the way it does:
//
//   state "live"  -> reachable; `views` is real (may legitimately be 0/low)
//   state "gone"  -> the platform DEFINITIVELY says deleted/unavailable/private
//   state "error" -> rate-limited / transient / unparseable -> NEVER act on it
//
// It also returns the owner's stable account id from the same response, so
// Feature 0 capture is free. Signals were validated live against real
// deleted / archived / live content on IG, YouTube and X (TikTok per the
// documented statusCode enum).
// ─────────────────────────────────────────────────────────────────────────

export type FetchState = "live" | "gone" | "error";
export type RichFetch = {
  state: FetchState;
  views: number;
  ownerId: string | null;
  ownerSecondaryId: string | null;
};

const ERR: RichFetch = { state: "error", views: 0, ownerId: null, ownerSecondaryId: null };
const isTransientHttp = (s: number) => s === 429 || s >= 500;

const extractInstagramCode = (url: string) => {
  const m = url.match(/\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]{5,})/);
  return m ? m[1] : null;
};

export async function fetchInstagramRich(url: string): Promise<RichFetch> {
  const code = extractInstagramCode(url);
  if (!code) return ERR;
  try {
    const r = await fetch(
      `https://social-media-data-api1.p.rapidapi.com/v1/media/by/code?code=${code}`,
      {
        headers: {
          "x-rapidapi-key": env.RAPIDAPI_KEY,
          "x-rapidapi-host": "social-media-data-api1.p.rapidapi.com",
          "x-access-key": env.RAPIDAPI_KEY,
        },
      }
    );
    // Validated: deleted/archived/private reels -> HTTP 404 "MediaNotFound".
    if (r.status === 404) return { state: "gone", views: 0, ownerId: null, ownerSecondaryId: null };
    if (isTransientHttp(r.status)) return ERR;
    const d: any = await r.json().catch(() => null);
    const play = d?.play_count;
    if (typeof play === "number") {
      const ownerId = d?.user?.pk ?? d?.user?.id ?? null;
      return { state: "live", views: play, ownerId: ownerId ? String(ownerId) : null, ownerSecondaryId: null };
    }
    // 200 but no play_count and not a clean 404 -> ambiguous, treat as error.
    return ERR;
  } catch {
    return ERR;
  }
}

export async function fetchTwitterRich(url: string): Promise<RichFetch> {
  const tweetId = url.match(/\/status\/(\d+)/)?.[1];
  if (!tweetId) return ERR;
  try {
    const r = await fetch(
      `https://twitter241.p.rapidapi.com/tweet-v2?pid=${tweetId}`,
      {
        headers: {
          "x-rapidapi-key": env.RAPIDAPI_KEY,
          "x-rapidapi-host": "twitter241.p.rapidapi.com",
        },
      }
    );
    if (isTransientHttp(r.status)) return ERR;
    if (r.status !== 200) return ERR;
    const d: any = await r.json().catch(() => null);
    const result = d?.result?.tweetResult?.result;
    const views = result?.views?.count;
    const typename = result?.__typename;
    const ownerId =
      result?.core?.user_results?.result?.rest_id ??
      result?.legacy?.user_id_str ??
      null;
    if (views != null || typename === "Tweet" || typename === "TweetWithVisibilityResults") {
      return { state: "live", views: parseInt(String(views ?? 0), 10) || 0, ownerId: ownerId ? String(ownerId) : null, ownerSecondaryId: null };
    }
    // Validated: a deleted tweet -> HTTP 200 with an EMPTY tweetResult {}.
    if (!result || Object.keys(result || {}).length === 0 || typename === "TweetTombstone" || typename === "TweetUnavailable") {
      return { state: "gone", views: 0, ownerId: null, ownerSecondaryId: null };
    }
    return ERR;
  } catch {
    return ERR;
  }
}

export async function fetchTikTokRich(url: string): Promise<RichFetch> {
  const videoId = url.split("?")[0]?.match(/video\/(\d+)/)?.[1];
  if (!videoId) return ERR;
  try {
    const resp = await axios.request({
      method: "GET",
      url: "https://tiktok-api23.p.rapidapi.com/api/post/detail",
      params: { videoId },
      validateStatus: () => true,
      headers: {
        "x-rapidapi-key": env.RAPIDAPI_KEY,
        "x-rapidapi-host": "tiktok-api23.p.rapidapi.com",
      },
    });
    if (isTransientHttp(resp.status)) return ERR;
    const d: any = resp.data;
    const sc = d?.statusCode;
    const item = d?.itemInfo?.itemStruct;
    // 10204 deleted, 10216/10222 private — user said treat private as gone too.
    if (sc === 10204 || sc === 10216 || sc === 10222) {
      return { state: "gone", views: 0, ownerId: null, ownerSecondaryId: null };
    }
    if (sc === 0 && item) {
      const author = item.author ?? {};
      return {
        state: "live",
        views: Number(item?.stats?.playCount ?? 0),
        ownerId: author.id ? String(author.id) : null,
        ownerSecondaryId: author.secUid ?? null,
      };
    }
    // captcha (10000), server/net (10101/10111), shark blocks, missing itemStruct
    // with no clear "gone" code -> transient, never flag.
    return ERR;
  } catch {
    return ERR;
  }
}

// YouTube is batched (one call per chunk) for quota. Returns per-id rich data;
// an id ABSENT from the returned map (when the call itself was HTTP 200) means
// deleted-or-private -> caller treats absence as "gone".
export type YouTubeBatchRich = {
  ok: boolean; // false if the batch call failed entirely (treat all as error)
  byId: Map<string, { views: number; channelId: string | null }>;
};

export async function getYouTubeBatchRich(
  videoIds: string[]
): Promise<YouTubeBatchRich> {
  const byId = new Map<string, { views: number; channelId: string | null }>();
  if (!videoIds.length) return { ok: true, byId };
  try {
    // Data API allows up to 50 ids per call.
    for (let i = 0; i < videoIds.length; i += 50) {
      const chunk = videoIds.slice(i, i + 50);
      const r = await fetch(
        `https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&id=${chunk.join(
          ","
        )}&key=${env.YOUTUBE_API_KEY}`
      );
      if (isTransientHttp(r.status) || r.status === 403) return { ok: false, byId };
      const d: any = await r.json().catch(() => null);
      for (const it of d?.items ?? []) {
        if (it?.id) {
          byId.set(it.id, {
            views: Number(it?.statistics?.viewCount ?? 0),
            channelId: it?.snippet?.channelId ?? null,
          });
        }
      }
    }
    return { ok: true, byId };
  } catch {
    return { ok: false, byId };
  }
}

export function youtubeRichFromBatch(
  url: string,
  batch: YouTubeBatchRich | undefined
): RichFetch {
  const id = getYouTubeVideoId(url);
  if (!batch || !batch.ok || !id) return ERR; // batch failed -> never flag
  const hit = batch.byId.get(id);
  if (hit) {
    return { state: "live", views: hit.views, ownerId: hit.channelId, ownerSecondaryId: null };
  }
  // Batch call succeeded but this id wasn't returned -> deleted or private.
  return { state: "gone", views: 0, ownerId: null, ownerSecondaryId: null };
}

// Dispatch by URL (non-YouTube; YouTube goes through the batch helpers above).
export async function fetchRichByUrl(url: string): Promise<RichFetch> {
  if (url.includes("instagram.com") || url.includes("inst")) return fetchInstagramRich(url);
  if (url.includes("x.com") || url.includes("twitter.com")) return fetchTwitterRich(url);
  if (url.includes("tiktok")) return fetchTikTokRich(url);
  return ERR;
}

// Single-clip rich fetch for ANY platform (incl. YouTube via a 1-id batch).
// Used by the non-campaign-clip path which isn't batched.
export async function fetchRichAny(url: string): Promise<RichFetch> {
  if (url.includes("youtube.com") || url.includes("you")) {
    const id = getYouTubeVideoId(url);
    if (!id) return ERR;
    const batch = await getYouTubeBatchRich([id]);
    return youtubeRichFromBatch(url, batch);
  }
  return fetchRichByUrl(url);
}
