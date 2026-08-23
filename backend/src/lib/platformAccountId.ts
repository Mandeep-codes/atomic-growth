import { env } from "./env";

// ─────────────────────────────────────────────────────────────────────────
// Stable, rename-proof platform account IDs (Feature 0).
//
// The @handle a clipper links changes when they rename; the platform's
// internal account ID does not. We resolve + store it so the one-account
// rule, rename-safe existence checks, and deletion detection all key on a
// stable identifier instead of the mutable handle.
//
//   youtube   -> channelId (UC...)
//   instagram -> numeric user pk
//   tiktok    -> numeric user id  (+ secUid as secondary)
//   x         -> user rest_id
//
// Each resolver returns the stable id (and an optional secondary), or one of
// the sentinel results below so callers can tell "genuinely not found" from
// "couldn't check right now" (rate-limited / transient) — critical so a
// backfill or check never treats a transient failure as a real absence.
// ─────────────────────────────────────────────────────────────────────────

export type ResolveOutcome =
  | { status: "ok"; id: string; secondaryId: string | null }
  | { status: "not_found" } // platform definitively has no such account
  | { status: "error" }; // rate-limited / transient / unparseable — retry later

export type Platform = "youtube" | "instagram" | "tiktok" | "x";

const cleanHandle = (handle: string) =>
  (handle ?? "").trim().replace(/^@/, "");

const RAPID_HOSTS: Record<Exclude<Platform, "youtube">, string> = {
  instagram: "social-media-data-api1.p.rapidapi.com",
  tiktok: "tiktok-api23.p.rapidapi.com",
  x: "twitter241.p.rapidapi.com",
};

function rapidHeaders(host: string): Record<string, string> {
  return {
    "x-rapidapi-key": env.RAPIDAPI_KEY,
    "x-rapidapi-host": host,
    // social-media-data-api1 additionally wants this; harmless elsewhere.
    "x-access-key": env.RAPIDAPI_KEY,
  };
}

// Treat these as "couldn't check" (never "not found") — see getViews.ts notes.
const isTransientStatus = (s: number) => s === 429 || s >= 500;

export async function resolveYouTubeChannelId(
  handle: string,
  opts?: { skipSearchFallback?: boolean }
): Promise<ResolveOutcome> {
  const h = cleanHandle(handle);
  if (!h) return { status: "not_found" };
  try {
    const r = await fetch(
      `https://www.googleapis.com/youtube/v3/channels?part=id&forHandle=${encodeURIComponent(
        h
      )}&key=${env.YOUTUBE_API_KEY}`
    );
    if (isTransientStatus(r.status)) return { status: "error" };
    // Any other non-OK (403 quota-exceeded, key restriction…) is "couldn't
    // check", never "not found" — otherwise a quota-exhausted day would
    // mass-strike every account the daily check touches.
    if (!r.ok) return { status: "error" };
    const d: any = await r.json();
    const id = d?.items?.[0]?.id;
    if (id) return { status: "ok", id, secondaryId: null };
    // Fallback: search (handles legacy display-name/custom-url values).
    // search.list costs 100 quota units vs 1 — repeat callers (the daily
    // account check) skip it: a known handle that misses forHandle daily
    // gains nothing from re-searching and can burn the whole day's quota.
    if (opts?.skipSearchFallback) return { status: "not_found" };
    const r2 = await fetch(
      `https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&q=${encodeURIComponent(
        h
      )}&maxResults=1&key=${env.YOUTUBE_API_KEY}`
    );
    if (isTransientStatus(r2.status)) return { status: "error" };
    if (!r2.ok) return { status: "error" };
    const d2: any = await r2.json();
    const ch = d2?.items?.[0]?.snippet?.channelId;
    return ch
      ? { status: "ok", id: ch, secondaryId: null }
      : { status: "not_found" };
  } catch {
    return { status: "error" };
  }
}

// Rename-proof existence check: a channel that renamed still answers by its
// stable UC… id; only a banned/terminated/self-deleted channel does not.
// Returns the channel's CURRENT handle (customUrl without the @) so callers
// can self-heal a stored handle after a rename.
export type IdCheckOutcome =
  | { status: "ok"; currentHandle: string | null }
  | { status: "not_found" }
  | { status: "error" };

// Batched form of checkYouTubeChannelById: one channels.list call per 50 ids
// (1 quota unit per call instead of 1 per channel). Same semantics as the
// video batch in getViewsRich: ok:false = the CALL failed (quota/transient) —
// treat every requested id as "error", never flag; ok:true + id absent from
// the map = that channel is genuinely gone (banned/terminated/deleted).
export async function checkYouTubeChannelsByIds(
  channelIds: string[]
): Promise<{
  ok: boolean;
  byId: Map<string, { currentHandle: string | null }>;
}> {
  const byId = new Map<string, { currentHandle: string | null }>();
  const ids = channelIds.map((id) => (id ?? "").trim()).filter(Boolean);
  if (!ids.length) return { ok: true, byId };
  try {
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      const r = await fetch(
        `https://www.googleapis.com/youtube/v3/channels?part=snippet&id=${chunk
          .map(encodeURIComponent)
          .join(",")}&key=${env.YOUTUBE_API_KEY}&maxResults=50`
      );
      if (isTransientStatus(r.status)) return { ok: false, byId };
      if (!r.ok) return { ok: false, byId };
      const d: any = await r.json();
      for (const item of d?.items ?? []) {
        if (item?.id) {
          const customUrl = item?.snippet?.customUrl;
          byId.set(item.id, {
            currentHandle: customUrl ? cleanHandle(String(customUrl)) : null,
          });
        }
      }
    }
    return { ok: true, byId };
  } catch {
    return { ok: false, byId };
  }
}

export async function checkYouTubeChannelById(
  channelId: string
): Promise<IdCheckOutcome> {
  const id = (channelId ?? "").trim();
  if (!id) return { status: "not_found" };
  try {
    const r = await fetch(
      `https://www.googleapis.com/youtube/v3/channels?part=snippet&id=${encodeURIComponent(
        id
      )}&key=${env.YOUTUBE_API_KEY}`
    );
    if (isTransientStatus(r.status)) return { status: "error" };
    if (!r.ok) return { status: "error" };
    const d: any = await r.json();
    const item = d?.items?.[0];
    if (!item) return { status: "not_found" };
    const customUrl = item?.snippet?.customUrl;
    return {
      status: "ok",
      currentHandle: customUrl ? cleanHandle(String(customUrl)) : null,
    };
  } catch {
    return { status: "error" };
  }
}

export async function resolveInstagramUserId(
  handle: string
): Promise<ResolveOutcome> {
  const h = cleanHandle(handle);
  if (!h) return { status: "not_found" };
  try {
    const r = await fetch(
      `https://${RAPID_HOSTS.instagram}/v1/user/by/username?username=${encodeURIComponent(
        h
      )}`,
      { headers: rapidHeaders(RAPID_HOSTS.instagram) }
    );
    if (isTransientStatus(r.status)) return { status: "error" };
    const d: any = await r.json().catch(() => null);
    const pk = d?.pk ?? d?.id ?? d?.user?.pk ?? d?.user?.id ?? d?.data?.pk ?? d?.data?.id;
    return pk
      ? { status: "ok", id: String(pk), secondaryId: null }
      : { status: "not_found" };
  } catch {
    return { status: "error" };
  }
}

export async function resolveTikTokUserId(
  handle: string
): Promise<ResolveOutcome> {
  const h = cleanHandle(handle);
  if (!h) return { status: "not_found" };
  try {
    const r = await fetch(
      `https://${RAPID_HOSTS.tiktok}/api/user/info?uniqueId=${encodeURIComponent(
        h
      )}`,
      { headers: rapidHeaders(RAPID_HOSTS.tiktok) }
    );
    if (isTransientStatus(r.status)) return { status: "error" };
    const d: any = await r.json().catch(() => null);
    const u = d?.userInfo?.user;
    if (u?.id) {
      return { status: "ok", id: String(u.id), secondaryId: u.secUid ?? null };
    }
    return { status: "not_found" };
  } catch {
    return { status: "error" };
  }
}

export async function resolveXUserId(handle: string): Promise<ResolveOutcome> {
  const h = cleanHandle(handle);
  if (!h) return { status: "not_found" };
  try {
    const r = await fetch(
      `https://${RAPID_HOSTS.x}/user?username=${encodeURIComponent(h)}`,
      { headers: rapidHeaders(RAPID_HOSTS.x) }
    );
    if (isTransientStatus(r.status)) return { status: "error" };
    const d: any = await r.json().catch(() => null);
    const rid = d?.result?.data?.user?.result?.rest_id;
    return rid
      ? { status: "ok", id: String(rid), secondaryId: null }
      : { status: "not_found" };
  } catch {
    return { status: "error" };
  }
}

export async function resolvePlatformAccountId(
  platform: string,
  handle: string,
  opts?: { skipSearchFallback?: boolean }
): Promise<ResolveOutcome> {
  switch ((platform ?? "").toLowerCase()) {
    case "youtube":
      return resolveYouTubeChannelId(handle, opts);
    case "instagram":
      return resolveInstagramUserId(handle);
    case "tiktok":
      return resolveTikTokUserId(handle);
    case "x":
    case "twitter":
      return resolveXUserId(handle);
    default:
      return { status: "error" };
  }
}
