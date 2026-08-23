import { extractVideoUrlInfo, getPlatformAndHandleFromUrl } from "./helpers";

export interface PlatformMetadata {
  url: string;
  platform: "youtube" | "instagram" | "tiktok" | "x" | "linkedin" | null;
  username: string | null;
  videoId: string | null;
  viewCount: number;
  embedUrl: string | null;
  thumbnailUrl: string | null;
  title: string | null;
  success: boolean;
  error?: string;
}

export async function getPlatformMetadata(
  url: string
): Promise<PlatformMetadata> {
  let resolvedUrl = url;
  try {
    const urlInfo = await extractVideoUrlInfo(url);
    resolvedUrl = urlInfo.resolvedUrl ?? url;

    let platform = urlInfo.platform ?? null;
    let username = urlInfo.username ?? null;
    let videoId = urlInfo.videoId ?? null;

    if (!username || username === "(no handle found)" || !platform) {
      try {
        const fallback = await getPlatformAndHandleFromUrl(resolvedUrl);
        platform =
          platform ??
          (fallback.platform as PlatformMetadata["platform"]) ??
          null;

        if (fallback.handle && fallback.handle !== "(no handle found)") {
          const normalized = fallback.handle.startsWith("@")
            ? fallback.handle.slice(1)
            : fallback.handle;
          username = normalized || username;
        }
      } catch (fallbackError) {
        console.warn("Fallback handle extraction failed", fallbackError);
      }
    }

    if (!platform) {
      return {
        url: resolvedUrl,
        platform: null,
        username: null,
        videoId: null,
        viewCount: 0,
        embedUrl: null,
        thumbnailUrl: null,
        title: null,
        success: false,
        error: "Unsupported platform or invalid URL",
      };
    }

    if (!videoId && urlInfo.videoId) {
      videoId = urlInfo.videoId;
    }

    if (!videoId && platform === "youtube") {
      const youtubeIdMatch = resolvedUrl.match(
        /(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/
      );
      videoId = youtubeIdMatch ? youtubeIdMatch[1] ?? null : null;
    }

    const viewCount = 0;

    // Generate embed URL and thumbnail
    const embedData = generateEmbedData(
      urlInfo.platform ?? null,
      urlInfo.videoId
    );

    return {
      url: resolvedUrl,
      platform,
      username: username ?? null,
      videoId: videoId || null,
      viewCount,
      embedUrl: embedData.embedUrl,
      thumbnailUrl: embedData.thumbnailUrl,
      title: embedData.title,
      success: true,
    };
  } catch (error) {
    console.error("Error getting video preview:", error);
    return {
      url: resolvedUrl,
      platform: null,
      username: null,
      videoId: null,
      viewCount: 0,
      embedUrl: null,
      thumbnailUrl: null,
      title: null,
      success: false,
      error: error instanceof Error ? error.message : "Unknown error occurred",
    };
  }
}

/**
 * Generate embed URL and thumbnail for iframe previews
 * @param platform - Detected platform
 * @param videoId - Extracted video ID (if available)
 * @returns Object with embedUrl, thumbnailUrl, and title
 */
function generateEmbedData(
  platform: string | null,
  videoId?: string
): {
  embedUrl: string | null;
  thumbnailUrl: string | null;
  title: string | null;
} {
  if (!platform) {
    return { embedUrl: null, thumbnailUrl: null, title: null };
  }

  switch (platform) {
    case "youtube":
      if (videoId) {
        return {
          embedUrl: `https://www.youtube.com/embed/${videoId}`,
          thumbnailUrl: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
          title: `YouTube Video - ${videoId}`,
        };
      }
      break;

    case "instagram":
      // Instagram doesn't support direct embedding for most content
      // Return the original URL as a fallback
      return {
        embedUrl: null, // Instagram doesn't allow direct embedding
        thumbnailUrl: null,
        title: "Instagram Post",
      };

    case "tiktok":
      if (videoId) {
        return {
          embedUrl: `https://www.tiktok.com/embed/v2/${videoId}`,
          thumbnailUrl: null, // TikTok doesn't provide direct thumbnail URLs
          title: `TikTok Video - ${videoId}`,
        };
      }
      break;

    case "x":
      return {
        embedUrl: null, // X/Twitter blocks iframe embedding via X-Frame-Options
        thumbnailUrl: null,
        title: videoId ? `Twitter Post - ${videoId}` : "Twitter Post",
      };

    case "linkedin":
      return {
        embedUrl: null,
        thumbnailUrl: null,
        title: "LinkedIn Post",
      };

    default:
      return { embedUrl: null, thumbnailUrl: null, title: null };
  }

  return { embedUrl: null, thumbnailUrl: null, title: null };
}
