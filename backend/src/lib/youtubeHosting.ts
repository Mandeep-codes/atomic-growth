import { db } from "./db";
import { site_settings } from "./schema";
import { env } from "./env";

// Runtime config for YouTube leaderboard clip hosting, stored in site_settings
// so the team can flip it from the admin UI without DigitalOcean env access.
//
//   enabled    — master switch. Default OFF, so YouTube clips are only fetched
//                (via the paid RapidAPI downloader) once someone turns it on.
//   apiKey     — the key the downloader actually uses: the DB-stored
//                youtube_rapidapi_key when set, otherwise the RAPIDAPI_KEY env
//                var. Lets a SEPARATE RapidAPI account power just YouTube.
//   usingDbKey — true when the DB key is in effect (for the admin diagnostic).
// Where the YouTube RapidAPI key came from, for the admin diagnostic:
//   "db"          — admin-set key in site_settings.youtube_rapidapi_key
//   "youtube-env" — the dedicated YOUTUBE_RAPIDAPI_KEY env var
//   "main-env"    — fell back to the shared RAPIDAPI_KEY env var
export type YtKeySource = "db" | "youtube-env" | "main-env";

export type YoutubeHostingConfig = {
  // Master switch: is the whole home-page leaderboard section shown at all?
  leaderboardEnabled: boolean;
  // Is YouTube clip DOWNLOADING (via paid RapidAPI) switched on?
  enabled: boolean;
  apiKey: string;
  keySource: YtKeySource;
};

// Read on every clip-download decision (and by the cron each run), so cache it
// briefly like the maintenance flag. setHostingSettings busts the cache so a
// toggle takes effect at once.
const TTL_MS = 15_000;
let cache: { value: YoutubeHostingConfig; at: number } | null = null;

export async function getYoutubeHostingConfig(
  force = false
): Promise<YoutubeHostingConfig> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) {
    return cache.value;
  }
  try {
    const [row] = await db
      .select({
        enabled: site_settings.youtube_hosting_enabled,
        key: site_settings.youtube_rapidapi_key,
        leaderboardEnabled: site_settings.leaderboard_enabled,
      })
      .from(site_settings)
      .limit(1);
    const dbKey = row?.key && row.key.trim() ? row.key.trim() : null;
    // Prefer an admin-set DB key, then the dedicated YOUTUBE_RAPIDAPI_KEY env
    // var, then the shared RAPIDAPI_KEY. This keeps YouTube on its own key
    // without ever changing the main key used for view counts.
    const youtubeEnvKey =
      env.YOUTUBE_RAPIDAPI_KEY && env.YOUTUBE_RAPIDAPI_KEY.trim()
        ? env.YOUTUBE_RAPIDAPI_KEY.trim()
        : null;
    let apiKey: string;
    let keySource: YtKeySource;
    if (dbKey) {
      apiKey = dbKey;
      keySource = "db";
    } else if (youtubeEnvKey) {
      apiKey = youtubeEnvKey;
      keySource = "youtube-env";
    } else {
      apiKey = env.RAPIDAPI_KEY;
      keySource = "main-env";
    }
    const value: YoutubeHostingConfig = {
      // No row yet = defaults: leaderboard ON, YouTube hosting OFF.
      leaderboardEnabled: row ? Boolean(row.leaderboardEnabled) : true,
      enabled: Boolean(row?.enabled),
      apiKey,
      keySource,
    };
    cache = { value, at: Date.now() };
    return value;
  } catch (err) {
    // If the settings row can't be read, fail CLOSED for paid YouTube hosting
    // (never spend on a DB hiccup) but leave the leaderboard SHOWN (its data is
    // free), matching the maintenance flag's fail-open stance for reads.
    console.error("getYoutubeHostingConfig failed; defaulting to safe:", err);
    const youtubeEnvKey =
      env.YOUTUBE_RAPIDAPI_KEY && env.YOUTUBE_RAPIDAPI_KEY.trim()
        ? env.YOUTUBE_RAPIDAPI_KEY.trim()
        : null;
    return {
      leaderboardEnabled: true,
      enabled: false,
      apiKey: youtubeEnvKey ?? env.RAPIDAPI_KEY,
      keySource: youtubeEnvKey ? "youtube-env" : "main-env",
    };
  }
}

export async function isYouTubeHostingEnabled(force = false): Promise<boolean> {
  return (await getYoutubeHostingConfig(force)).enabled;
}

export async function isLeaderboardEnabled(force = false): Promise<boolean> {
  return (await getYoutubeHostingConfig(force)).leaderboardEnabled;
}

export function bustYoutubeHostingCache() {
  cache = null;
}
