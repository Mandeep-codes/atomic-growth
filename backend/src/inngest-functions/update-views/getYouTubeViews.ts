import { google } from "googleapis";
import { env } from "../../lib/env";

export function getYouTubeVideoId(url: string) {
  const match = url.match(
    /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/
  );
  return match ? match[1] : null;
}

export async function getYouTubeViews(url: string): Promise<number> {
  try {
    const videoId = getYouTubeVideoId(url);

    if (!videoId) throw new Error("Invalid YouTube URL");

    const viewMap = await getYouTubeViewsBatch([videoId]);
    const views = viewMap[videoId];
    console.log("YouTube views:", views);
    return views ?? 0;
  } catch (error) {
    console.error("Error getting YouTube views:", (error as Error).message);
    return 0;
  }
}

export async function getYouTubeViewsBatch(videoIds: string[]) {
  const uniqueIds = Array.from(new Set(videoIds.filter(Boolean)));
  if (!uniqueIds.length) return {} as Record<string, number>;

  const youtube = google.youtube({
    version: "v3",
    auth: env.YOUTUBE_API_KEY,
  });

  const views: Record<string, number> = {};
  const MAX_BATCH = 50;

  for (let i = 0; i < uniqueIds.length; i += MAX_BATCH) {
    const chunk = uniqueIds.slice(i, i + MAX_BATCH);
    try {
      const { data } = await youtube.videos.list({
        part: ["statistics"],
        id: chunk,
      });

      for (const item of data.items ?? []) {
        const id = item.id;
        const value = item.statistics?.viewCount;
        if (id && value) {
          views[id] = parseInt(value, 10);
        }
      }
    } catch (error) {
      console.error(
        "Error getting batched YouTube views:",
        (error as Error).message
      );
    }
  }

  return views;
}
