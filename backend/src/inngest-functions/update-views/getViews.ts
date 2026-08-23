import axios from "axios";
import { env } from "../../lib/env";
import { getYouTubeVideoId } from "./getYouTubeViews";

// 10 requests per second, could be 100ms but we do 200ms to be safe
const MIN_TWITTER_INTERVAL_MS = 200;
let twitterRateLimiter: Promise<unknown> = Promise.resolve();
let lastTwitterRequestTime = 0;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const enqueueTwitterRequest = <T>(fn: () => Promise<T>): Promise<T> => {
  const execute = async (): Promise<T> => {
    const elapsed = Date.now() - lastTwitterRequestTime;
    if (elapsed < MIN_TWITTER_INTERVAL_MS) {
      await delay(MIN_TWITTER_INTERVAL_MS - elapsed);
    }
    lastTwitterRequestTime = Date.now();
    return fn();
  };

  const next = twitterRateLimiter.then(execute, execute);
  twitterRateLimiter = next.then(() => undefined, () => undefined);
  return next;
};

function extractInstagramCode(url: string) {
  const match = url.match(/(?:\/[^/]+)?\/(?:p|reel|tv)\/([A-Za-z0-9_-]{5,})/);
  return match ? match[1] || match[2] || match[3] : null;
}

export async function getInstagramViews(instagramUrl: string) {
  const code = extractInstagramCode(instagramUrl);
  if (!code) {
    console.error("Invalid Instagram video URL or code not found.");
    return 0;
  }

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
    const response = await axios.request(options);
    const playCount = response.data?.play_count;

    if (typeof playCount === "number") {
      console.log(`✅ Instagram video play count: ${playCount}`);
      return playCount;
    } else {
      console.warn("Play count not found in response.");
      return 0;
    }
  } catch (error) {
    console.error(
      "❌ Failed to fetch Instagram views:",
      (error as Error).message
    );
    return 0;
  }
}

export async function getTwitterViews(url: string) {
  return enqueueTwitterRequest(async () => {
    try {
      const tweetId = url.match(/\/status\/(\d+)/)?.[1];
      if (!tweetId) {
        throw new Error("Invalid Twitter URL");
      }

      const options: RequestInit = {
        method: "GET",
        headers: {
          "x-rapidapi-key": env.RAPIDAPI_KEY,
          "x-rapidapi-host": "twitter241.p.rapidapi.com",
        },
      };

      const response = await fetch(
        `https://twitter241.p.rapidapi.com/tweet-v2?pid=${tweetId}`,
        options
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      const views = (data as any)?.result?.tweetResult?.result?.views?.count;
      if (!views) {
        console.log("No view count available");
        return 0;
      }
      const viewCount = parseInt(views);
      console.log("Twitter views:", viewCount);
      return viewCount;
    } catch (error) {
      console.error("Error getting Twitter views:", (error as Error).message);
      return 0;
    }
  });
}

export async function getTikTokViews(url: string) {
  try {
    const cleanUrl = url.split("?")[0];
    const videoId = cleanUrl?.match(/video\/(\d+)/)?.[1];
    if (!videoId) console.error("Video ID not found in URL");

    const options = {
      method: "GET",
      url: "https://tiktok-api23.p.rapidapi.com/api/post/detail",
      params: { videoId: videoId },
      headers: {
        "x-rapidapi-key": env.RAPIDAPI_KEY,
        "x-rapidapi-host": "tiktok-api23.p.rapidapi.com",
      },
    };

    const response = await axios.request(options);
    const video = response.data?.itemInfo?.itemStruct;

    if (video && video.stats) {
      console.log("✅ Video view stats:", video.stats.playCount);
      return video.stats.playCount;
    } else {
      console.log("Video or stats not found in API response");
      return 0;
    }
  } catch (err) {
    console.error("❌ Error getting TikTok views:", (err as Error).message);
    return 0;
  }
}

export async function getYouTubeViewsViaRapidApi(url: string) {
  try {
    const videoId = getYouTubeVideoId(url);
    if (!videoId) {
      console.error("Video ID not found in URL");
      return 0;
    }

    const options = {
      method: "GET",
      url: `https://yt-api.p.rapidapi.com/video/info?id=${videoId}`,
      params: { id: videoId },
      headers: {
        "x-rapidapi-key": env.RAPIDAPI_KEY,
        "x-rapidapi-host": "yt-api.p.rapidapi.com",
      },
    };

    const response = await axios.request(options);
    const viewCount = response.data?.viewCount;

    if (viewCount != undefined) {
      console.log("✅ Video view stats:", viewCount);
      return viewCount;
    } else {
      console.log("Video or stats not found in API response");
      return 0;
    }
  } catch (err) {
    console.error("❌ Error getting TikTok views:", (err as Error).message);
    return 0;
  }
}
