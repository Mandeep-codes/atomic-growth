import { google } from "googleapis";
import axios from "axios";
import { env } from "../../lib/env";
import { getYouTubeVideoId } from "../../inngest-functions/update-views/getYouTubeViews";

export async function getPlatfromFromUrl(url: string) {
  try {
    const youtubeRegex = new RegExp(
      "(?:https?://)?(?:www\\.)?(youtube\\.com/(?:watch\\?.*v=|shorts/|embed/)|youtu\\.be/)([a-zA-Z0-9_-]{11})"
    );
    const instaRegex = new RegExp(
      "(?:https?://)?(?:www\\.)?instagram\\.com/(?:[\\w.-]+/)?(?:p|reel|tv)/([a-zA-Z0-9_-]+)"
    );
    const twitterRegex = new RegExp(
      // "i/web" admits x.com/i/web/status/<id>, the handle-less desktop form;
      // without it that URL reads as an unrecognised platform. See
      // X_NO_HANDLE_STATUS below for how the real handle is then recovered.
      "(?:https?://)?(?:www\\.)?(?:twitter\\.com|x\\.com)/(?:#!/)?(?:i/web|\\w+)/status/(\\d+)"
    );
    const tiktokRegex = new RegExp(
      "(?:https?://)?(?:www\\.|vm\\.)?tiktok\\.com/(?:@([\\w.-]+)/video/(\\d+)|[\\w.-]+)"
    );
    const linkedinRegex = new RegExp(
      "(?:https?://)?(?:www\\.)?linkedin\\.com/posts/([a-zA-Z0-9%._-]+)_.+?activity-(\\d+)-[A-Za-z0-9]+",
      "i"
    );

    if (youtubeRegex.test(url)) {
      return "youtube";
    } else if (instaRegex.test(url)) {
      return "instagram";
    } else if (twitterRegex.test(url)) {
      return "x";
    } else if (tiktokRegex.test(url)) {
      return "tiktok";
    } else if (linkedinRegex.test(url)) {
      return "linkedin";
    } else {
      return null;
    }
  } catch (err) {
    console.error("Error extracting platform/handle:", (err as Error).message);
    return null;
  }
}

export async function getPlatformAndHandleFromUrl(url: string) {
  try {
    const youtubeRegex = new RegExp(
      "(?:https?://)?(?:www\\.)?(youtube\\.com/(?:watch\\?.*v=|shorts/|embed/)|youtu\\.be/)([a-zA-Z0-9_-]{11})"
    );
    const instaRegex = new RegExp(
      "(?:https?://)?(?:www\\.)?instagram\\.com/(?:[\\w.-]+/)?(?:p|reel|tv)/([a-zA-Z0-9_-]+)"
    );
    const twitterRegex = new RegExp(
      // "i/web" admits x.com/i/web/status/<id>, the handle-less desktop form;
      // without it that URL reads as an unrecognised platform. See
      // X_NO_HANDLE_STATUS below for how the real handle is then recovered.
      "(?:https?://)?(?:www\\.)?(?:twitter\\.com|x\\.com)/(?:#!/)?(?:i/web|\\w+)/status/(\\d+)"
    );
    const tiktokRegex = new RegExp(
      "(?:https?://)?(?:www\\.|vm\\.)?tiktok\\.com/(?:@([\\w.-]+)/video/(\\d+)|[\\w.-]+)"
    );
    const linkedinRegex = new RegExp(
      "(?:https?://)?(?:www\\.)?linkedin\\.com/posts/([a-zA-Z0-9%._-]+)_.+?activity-(\\d+)-[A-Za-z0-9]+",
      "i"
    );

    if (youtubeRegex.test(url)) {
      // Can't fully trust this RapidAPI, so we have the Google API as a fallback
      const res = await getYouTubeMetaWithGoogleAPI(url);
      // const res = await getYouTubeMeta(url);
      return { platform: "youtube", handle: res?.handle };
    } else if (instaRegex.test(url)) {
      const res = await getInstagramMeta(url);
      return { platform: "instagram", handle: res?.username };
    } else if (twitterRegex.test(url)) {
      const meta = await extractVideoUrlInfo(url);
      return { platform: "x", handle: meta.username };
    } else if (tiktokRegex.test(url)) {
      const meta = await extractVideoUrlInfo(url);
      return { platform: "tiktok", handle: meta.username };
    } else if (linkedinRegex.test(url)) {
      const match = url.match(linkedinRegex);
      const handle = match?.[1]
        ? decodeURIComponent(match[1]).replace(/\s+/g, "")
        : null;
      return { platform: "linkedin", handle };
    } else {
      return { platform: null, handle: null };
    }
  } catch (err) {
    console.error("Error extracting platform/handle:", (err as Error).message);
    return { platform: null, handle: null };
  }
}

// One submitted clip triggers this same lookup 3-4 times within minutes
// (step-1 preview, step-3 preview, server-side submit re-check, then again
// on every mod review open) — each invocation costs 2 YouTube quota units
// (videos.list + channels.list). Cache by videoId so a clip pays once.
// A video's channel handle doesn't change within the TTL in any way that
// matters to submission checks.
const YT_META_CACHE_TTL_MS = 15 * 60 * 1000;
const YT_META_CACHE_MAX = 500;
const ytMetaCache = new Map<
  string,
  { at: number; meta: { channelTitle?: string | null; videoTitle?: string | null; handle?: string | null } }
>();

async function getYouTubeMetaWithGoogleAPI(videoUrl: string) {
  try {
    const videoId = extractVideoId(videoUrl);
    if (!videoId) throw new Error("Invalid YouTube video URL");

    const cached = ytMetaCache.get(videoId);
    if (cached && Date.now() - cached.at < YT_META_CACHE_TTL_MS) {
      return cached.meta;
    }

    const youtube = google.youtube({
      version: "v3",
      auth: env.YOUTUBE_API_KEY,
    });

    // Step 1: Get video data to extract channelId
    const { data: videoData } = await youtube.videos.list({
      part: ["snippet"],
      id: [videoId],
    });

    const video = videoData.items?.[0];
    if (!video || !video.snippet) throw new Error("No video/snippet found");

    const channelId = video.snippet.channelId;
    if (!channelId) throw new Error("Channel ID missing");

    // Step 2: Use channelId to get channel metadata (handle)
    const { data: channelData } = await youtube.channels.list({
      part: ["snippet"],
      id: [channelId],
    });

    const channel = channelData.items?.[0];
    if (!channel) throw new Error("No channel found");

    const handle = channel.snippet?.customUrl
      ? channel.snippet.customUrl.replace(/^.*\//, "").replace(/^@/, "")
      : null;

    const meta = {
      channelTitle: video.snippet.channelTitle,
      videoTitle: video.snippet.title,
      handle: handle || "(no handle found)",
    };
    // Only successful lookups are cached — failures (quota, transient) stay
    // retryable. Drop the oldest entry when full.
    if (ytMetaCache.size >= YT_META_CACHE_MAX) {
      const oldest = ytMetaCache.keys().next().value;
      if (oldest !== undefined) ytMetaCache.delete(oldest);
    }
    ytMetaCache.set(videoId, { at: Date.now(), meta });
    return meta;
  } catch (err) {
    console.error("YouTube API error:", (err as Error).message);
    return {};
  }
}

function extractVideoId(url: string) {
  const match = url.match(
    /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/
  );
  return match ? match[1] : null;
}

async function getYouTubeMeta(videoUrl: string) {
  const videoId = getYouTubeVideoId(videoUrl);

  const options = {
    method: "GET",
    url: `https://yt-api.p.rapidapi.com/shorts/info?id=${videoId}`,
    params: { id: videoId },
    headers: {
      "x-rapidapi-key": env.RAPIDAPI_KEY,
      "x-rapidapi-host": "yt-api.p.rapidapi.com",
    },
  };
  try {
    const res = await axios.request(options);
    return {
      handle: res.data?.channelHandle?.replace(/^@/, ""),
    };
  } catch (err) {
    console.error("YoutTube RAPID API error:", (err as Error).message);
    return {};
  }
}

function extractInstagramCode(url: string) {
  const match = url.match(/(?:\/[^/]+)?\/(?:p|reel|tv)\/([A-Za-z0-9_-]{5,})/);
  return match ? match[1] || match[2] || match[3] : null;
}

async function getInstagramMeta(url: string) {
  const code = extractInstagramCode(url);
  if (!code) return {};
  const options = {
    method: "GET",
    url: "https://social-media-data-api1.p.rapidapi.com/v1/media/by/code",
    params: { code },
    headers: {
      "x-rapidapi-key": env.RAPIDAPI_KEY,
      "x-rapidapi-host": "social-media-data-api1.p.rapidapi.com",
      "x-access-key": env.RAPIDAPI_KEY,
    },
  };
  try {
    const res = await axios.request(options);
    return {
      username: res.data?.user?.username || null,
      playCount: res.data?.play_count || 0,
    };
  } catch (err) {
    console.error("Instagram API error:", (err as Error).message);
    return {};
  }
}

interface RapidApiConfig {
  apiKey: string;
  endpoint: string; // e.g., 'https://social-media-info.p.rapidapi.com/url-info'
}

interface VideoUrlInfo {
  platform?: "youtube" | "instagram" | "tiktok" | "x" | "linkedin";
  username?: string;
  videoId?: string;
  success: boolean;
  source: "regex" | "api" | "failed";
  resolvedUrl?: string;
}

export async function extractVideoUrlInfo(
  url: string,
  useApi: boolean = false,
  rapidApiConfig?: RapidApiConfig
): Promise<VideoUrlInfo> {
  let workingUrl = url;

  // First, try regex extraction
  let regexResult = extractFromRegex(workingUrl);

  // Expand TikTok short links before giving up
  if (!regexResult.success && isTikTokShortUrl(workingUrl)) {
    const resolvedUrl = await resolveTikTokShortUrl(workingUrl);
    if (resolvedUrl) {
      workingUrl = resolvedUrl;
      regexResult = extractFromRegex(workingUrl);

      if (regexResult.success) {
        return regexResult;
      }
    }
  }

  // x.com/i/status/<id> carries no handle — follow X's own redirect to the
  // canonical /<handle>/status/<id> and read it from there.
  if (!regexResult.success && isXReservedHandleUrl(workingUrl)) {
    const canonicalUrl = await resolveXCanonicalUrl(workingUrl);
    if (canonicalUrl) {
      workingUrl = canonicalUrl;
      regexResult = extractFromRegex(workingUrl);

      if (regexResult.success) {
        return regexResult;
      }
    }
  }

  // If regex was successful, return the result
  if (regexResult.success) {
    return regexResult;
  }

  // If regex failed and we have API config, try API fallback
  if (!regexResult.success && useApi && rapidApiConfig) {
    console.log("Regex extraction failed, trying API fallback...");
    const apiResult = await extractFromApi(workingUrl, rapidApiConfig);

    // If API succeeded, return API result
    if (apiResult.success) {
      return apiResult;
    }

    // If API also failed, return the better of the two results
    return regexResult.platform ? regexResult : apiResult;
  }

  // No API config provided or both methods failed
  return regexResult;
}

export function extractFromRegex(url: string): VideoUrlInfo {
  // YouTube Shorts or Channel
  const youtubeMatch = url.match(URL_PATTERNS.youtube);
  if (youtubeMatch) {
    const videoId = youtubeMatch[2];
    const username = youtubeMatch[3] || youtubeMatch[4] || youtubeMatch[5];

    // If it's a shorts URL, we don't have username from the URL
    if (videoId && !username) {
      return {
        platform: "youtube",
        videoId,
        success: false,
        source: "regex",
        resolvedUrl: url,
      };
    }

    return {
      platform: "youtube",
      username: username,
      videoId,
      success: !!username,
      source: "regex",
      resolvedUrl: url,
    };
  }

  // Instagram
  const instagramMatch = url.match(URL_PATTERNS.instagramUser);
  if (instagramMatch) {
    const username = instagramMatch[2];
    if (
      !username ||
      ["reel", "reels", "p", "tv"].includes(username.toLowerCase())
    ) {
      return {
        platform: "instagram",
        success: false,
        source: "regex",
        resolvedUrl: url,
      };
    }
    return {
      platform: "instagram",
      username,
      success: true,
      source: "regex",
      resolvedUrl: url,
    };
  }

  // TikTok full URL
  const tiktokMatch = url.match(URL_PATTERNS.tiktok);
  if (tiktokMatch) {
    return {
      platform: "tiktok",
      username: tiktokMatch[2],
      videoId: tiktokMatch[3],
      success: true,
      source: "regex",
      resolvedUrl: url,
    };
  }

  // TikTok short URL
  if (URL_PATTERNS.tiktokShort.test(url)) {
    return {
      platform: "tiktok",
      success: false, //special handling for tiktok short urls
      source: "regex",
      resolvedUrl: url,
    };
  }

  // Twitter/X
  const twitterMatch = url.match(URL_PATTERNS.twitter);
  if (twitterMatch) {
    // "i" and friends are route prefixes, not handles. Reporting one as the
    // username is what produced the "@i" detection; mark the extraction
    // unsuccessful so extractVideoUrlInfo resolves the canonical URL instead.
    // The video id is still correct, so the duplicate check keeps working.
    if (isXReservedHandle(twitterMatch[3])) {
      return {
        platform: "x",
        username: undefined,
        videoId: twitterMatch[4],
        success: false,
        source: "regex",
        resolvedUrl: url,
      };
    }
    return {
      platform: "x",
      username: twitterMatch[3],
      videoId: twitterMatch[4],
      success: true,
      source: "regex",
      resolvedUrl: url,
    };
  }

  const linkedinMatch = url.match(URL_PATTERNS.linkedin);
  if (linkedinMatch) {
    const rawHandle = linkedinMatch[2] || "";
    const decodedHandle = decodeURIComponent(rawHandle).replace(/\s+/g, "");
    return {
      platform: "linkedin",
      username: decodedHandle,
      videoId: linkedinMatch[3],
      success: true,
      source: "regex",
      resolvedUrl: url,
    };
  }

  return {
    success: false,
    source: "failed",
    resolvedUrl: url,
  };
}

async function extractFromApi(
  url: string,
  config: RapidApiConfig
): Promise<VideoUrlInfo> {
  try {
    const response = await fetch(config.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-RapidAPI-Key": env.RAPIDAPI_KEY,
        "X-RapidAPI-Host": new URL(config.endpoint).hostname,
      },
      body: JSON.stringify({ url }),
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status}`);
    }

    const data = (await response.json()) as any;

    // Map API response to our interface
    // Note: Adjust these field names based on your actual API response structure
    return {
      platform: data?.platform ? mapPlatformName(data.platform) : undefined,
      username: data?.username || data?.handle || data?.author,
      videoId: data?.videoId || data?.id,
      success: !!(data?.username || data?.handle || data?.author),
      source: "api",
      resolvedUrl: url,
    };
  } catch (error) {
    console.error("API fallback failed:", error);
    return {
      success: false,
      source: "failed",
      resolvedUrl: url,
    };
  }
}

/**
 * Map API platform names to our standardized names
 */
function mapPlatformName(platform: string): VideoUrlInfo["platform"] {
  if (!platform) return;

  const normalized = platform.toLowerCase();
  switch (normalized) {
    case "youtube":
    case "yt":
      return "youtube";
    case "instagram":
    case "ig":
      return "instagram";
    case "tiktok":
    case "tt":
      return "tiktok";
    case "twitter":
    case "x":
      return "x";
    case "linkedin":
      return "linkedin";
    default:
      return;
  }
}

const URL_PATTERNS = {
  youtube:
    /^https?:\/\/(www\.|m\.)?youtube\.com\/(?:shorts\/([a-zA-Z0-9_-]+)|@([a-zA-Z0-9._-]+)|c\/([a-zA-Z0-9._-]+)|user\/([a-zA-Z0-9._-]+)).*$/,
  instagram:
    /^https?:\/\/(www\.)?instagram\.com\/(?:reel\/[a-zA-Z0-9_-]+\/|p\/[a-zA-Z0-9_-]+\/)?(?:\?.*)?$/,
  instagramUser: /^https?:\/\/(www\.)?instagram\.com\/([a-zA-Z0-9._]+)\/?.*$/,
  tiktok:
    /^https?:\/\/(www\.)?tiktok\.com\/@([a-zA-Z0-9._-]+)\/video\/(\d+).*$/,
  tiktokShort: /^\s*https?:\/\/(?:vm|vt)\.tiktok\.com\/[A-Za-z0-9_-]+\/?.*$/i,
  twitter:
    /^https?:\/\/(www\.|mobile\.)?(twitter|x)\.com\/([a-zA-Z0-9_]+)\/status\/(\d+).*$/,
  linkedin:
    /^https?:\/\/(www\.)?linkedin\.com\/posts\/([a-zA-Z0-9%._-]+)_.+?activity-(\d+)-[A-Za-z0-9]+.*$/i,
};

const TIKTOK_RESOLVE_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (compatible; AtomikClipsBot/1.0; +https://atomikclips.com)",
};

// ── X paths that are NOT usernames ──
// URL_PATTERNS.twitter reads the path segment before /status/ as the author's
// handle. On x.com/i/status/<id> — the form X's own share sheet produces when
// the post is opened from a feed — that segment is the literal "i", so the
// clipper was shown "@i" as their detected handle and verification then looked
// for an account nobody owns ("No verification record found"). The junk
// verified_users rows on production with handles i / r / re / ree are this bug
// leaving a trail.
//
// These are X's reserved route prefixes; none can be a real @handle.
const X_RESERVED_PATH_SEGMENTS = new Set([
  "i",
  "intent",
  "web",
  "home",
  "search",
  "explore",
  "notifications",
  "messages",
  "settings",
  "compose",
  "hashtag",
  "share",
]);

export const isXReservedHandle = (handle: string | null | undefined) =>
  !!handle && X_RESERVED_PATH_SEGMENTS.has(handle.trim().toLowerCase());

// The handle-less desktop form, x.com/i/web/status/<id>. URL_PATTERNS.twitter
// does not match it at all (two segments before /status/), so without this it
// would never reach the resolver and the clipper would just be told the
// platform was unrecognised.
const X_NO_HANDLE_STATUS =
  /^https?:\/\/(?:www\.|mobile\.)?(?:twitter|x)\.com\/i\/(?:web\/)?status\/\d+/i;

const isXReservedHandleUrl = (url: string) => {
  const trimmed = url.trim();
  if (X_NO_HANDLE_STATUS.test(trimmed)) return true;
  const match = trimmed.match(URL_PATTERNS.twitter);
  return !!match && isXReservedHandle(match[3]);
};

// X serves the canonical redirect only to a browser-like client: with the
// AtomikClipsBot agent the TikTok resolver sends, x.com/i/status/<id> answers
// 200 at the SAME url and the handle is never recovered. Verified both ways
// against a live post before settling on this.
const X_RESOLVE_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
};

// X answers x.com/i/status/<id> with a 307 to the canonical
// /<realHandle>/status/<id>, so following the redirect recovers the author
// without an API call or any quota. Same shape as resolveTikTokShortUrl:
// HEAD first, GET as the fallback, null when it can't be resolved.
async function resolveXCanonicalUrl(url: string): Promise<string | null> {
  try {
    const attempt = async (method: "HEAD" | "GET") => {
      const response = await fetch(url, {
        method,
        redirect: "follow",
        headers: X_RESOLVE_HEADERS,
      });
      try {
        // Only accept a redirect that actually produced a usable handle —
        // a login wall or an unchanged URL must not be mistaken for one.
        if (
          response.url &&
          response.url !== url &&
          !isXReservedHandleUrl(response.url) &&
          URL_PATTERNS.twitter.test(response.url)
        ) {
          return response.url;
        }
        return null;
      } finally {
        if (method === "GET") {
          await response.body?.cancel?.();
        }
      }
    };

    return (await attempt("HEAD")) ?? (await attempt("GET"));
  } catch (error) {
    console.warn("Failed to resolve X canonical URL", error);
    return null;
  }
}

export async function extractVideoIdFromUrl(
  url: string
): Promise<{ videoId: string | null; resolvedUrl: string }> {
  if (!url) {
    return { videoId: null, resolvedUrl: url };
  }

  let workingUrl = url;

  if (isTikTokShortUrl(workingUrl)) {
    const resolvedUrl = await resolveTikTokShortUrl(workingUrl);
    if (resolvedUrl) {
      workingUrl = resolvedUrl;
    }
  }

  const regex = new RegExp(
    "(?:" +
      // YouTube: standard, shorts, or short form
      "youtube\\.com/shorts/|" +
      "youtu\\.be/|" +
      // Instagram: with or without optional username/ before (p|reel)
      "instagram\\.com/(?:[\\w.-]+/)?(?:p|reel)/|" +
      // TikTok: with or without optional @username/ before /video/
      "(?:tiktok\\.com/(?:@[\\w.-]+/)?video/)|" +
      // Twitter/X: status URL, including the handle-less i/web form
      "(?:x|twitter)\\.com/(?:i/web|\\w+)/status/" +
      ")" +
      // The capturing group: matches one or more characters until a ?, /, & or # is found.
      "([^/?&#]+)",
    "i" // case-insensitive matching for the domain
  );

  const match = workingUrl.match(regex);

  if (match && match[1]) {
    return {
      videoId: match[1],
      resolvedUrl: workingUrl,
    };
  }

  const linkedinMatch = workingUrl.match(URL_PATTERNS.linkedin);
  if (linkedinMatch) {
    return {
      videoId: linkedinMatch[3] ?? null,
      resolvedUrl: workingUrl,
    };
  }

  return {
    videoId: null,
    resolvedUrl: workingUrl,
  };
}

function isTikTokShortUrl(url: string) {
  return URL_PATTERNS.tiktokShort.test(url.trim());
}

async function resolveTikTokShortUrl(url: string): Promise<string | null> {
  try {
    const attempt = async (method: "HEAD" | "GET") => {
      const response = await fetch(url, {
        method,
        redirect: "follow",
        headers: TIKTOK_RESOLVE_HEADERS,
      });
      try {
        if (response.url && response.url !== url) {
          return response.url;
        }
        return null;
      } finally {
        if (method === "GET") {
          await response.body?.cancel?.();
        }
      }
    };

    const headUrl = await attempt("HEAD");
    if (headUrl) {
      return headUrl;
    }

    const getUrl = await attempt("GET");
    if (getUrl) {
      return getUrl;
    }
  } catch (error) {
    console.error("Failed to resolve TikTok short link:", error);
  }

  return null;
}
