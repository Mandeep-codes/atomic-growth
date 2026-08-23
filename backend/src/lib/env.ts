import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

const envSchema = z.object({
  // Database
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  // Environment
  NODE_ENV: z.enum(["development", "production"]).default("development"),
  LOCAL_DEV_NO_AUTH: z.string().optional().transform((v) => v === "true"),
  LOCAL_DEV_USER_ID: z.string().optional(),
  // "clipper" strips every admin role from the dev bypass so the app can be
  // reviewed as a plain clipper sees it. Anything else (or unset) keeps the
  // full role set. See dev-auth.ts.
  LOCAL_DEV_ROLES: z.string().optional(),
  // Server
  PORT: z.string().default("3000"),
  CORS_ORIGIN: z.string().url().default("http://localhost:3000"),
  // Clerk Authentication
  CLERK_SECRET_KEY: z.string().min(1, "CLERK_SECRET_KEY is required"),
  // External APIs
  RAPIDAPI_KEY: z.string().min(1, "RAPIDAPI_KEY is required"),
  YOUTUBE_API_KEY: z.string().min(1, "YOUTUBE_API_KEY is required"),
  // DigitalOcean Spaces
  DO_SPACES_ACCESS_KEY_ID: z
    .string()
    .min(1, "DO_SPACES_ACCESS_KEY_ID is required"),
  DO_SPACES_SECRET_ACCESS_KEY: z
    .string()
    .min(1, "DO_SPACES_SECRET_ACCESS_KEY is required"),
  DO_SPACES_ENDPOINT: z
    .string()
    .url()
    .default("https://blr1.digitaloceanspaces.com"),
  DO_SPACES_REGION: z.string().default("blr1"),
  DO_SPACES_BUCKET: z.string().default("atomik-general-bucket"),
  DO_SPACES_PUBLIC_URL: z.string().url().optional(),
  // OpenAI
  OPENAI_API_KEY: z.string().min(1, "OPENAI_API_KEY is required"),
  // Wise configuration
  WISE_API_TOKEN: z
    .string()
    .min(1, "WISE_API_TOKEN is required")
    .default("61c439b6-b866-4e6c-a444-ab952b0d0484"),
  WISE_PROFILE_ID: z
    .string()
    .min(1, "WISE_PROFILE_ID is required")
    .default("29141118"),
  WISE_API_BASE_URL: z
    .string()
    .url()
    .default("https://api.sandbox.transferwise.tech"),
  // Inbound API
  INBOUND_API_KEY: z.string().min(1, "INBOUND_API_KEY is required"),
  // ForwardEmail API (optional so boot doesn't fail where unset; alias sync
  // becomes a no-op without it)
  FORWARDEMAIL_API_KEY: z.string().optional(),
  // Inngest
  INNGEST_SIGNING_KEY: z.string().min(1, "INNGEST_SIGNING_KEY is required"),
  INNGEST_EVENT_KEY: z.string().min(1, "INNGEST_EVENT_KEY is required"),
  INNGEST_SERVE_HOST: z.string().url().optional(),
  INNGEST_SERVE_PATH: z.string().optional(),
  // Google OAuth (YouTube)
  GOOGLE_OAUTH_CLIENT_ID: z
    .string()
    .min(1, "GOOGLE_OAUTH_CLIENT_ID is required"),
  GOOGLE_OAUTH_CLIENT_SECRET: z
    .string()
    .min(1, "GOOGLE_OAUTH_CLIENT_SECRET is required"),
  GOOGLE_OAUTH_REDIRECT_URI: z
    .string()
    .url("GOOGLE_OAUTH_REDIRECT_URI must be a valid URL"),
  // Discord bot (private campaigns). Optional: when unset, approving a
  // private-campaign application still works — the clipper just isn't
  // auto-added to the private server and no invite is generated.
  DISCORD_BOT_TOKEN: z.string().optional(),
  // yt-dlp (leaderboard clip hosting). Optional. YTDLP_PATH defaults to the
  // binary on PATH; YTDLP_COOKIES_FILE is a cookies.txt path used mainly for
  // Instagram, which often needs a logged-in session to download. yt-dlp is
  // used for Instagram / TikTok / X. YouTube is handled separately below.
  YTDLP_PATH: z.string().default("yt-dlp"),
  YTDLP_COOKIES_FILE: z.string().optional(),
  // ffmpeg/ffprobe (bundled in the image alongside yt-dlp). Used to normalize
  // downloaded clips to H.264/AAC mp4 + faststart so they play on mobile (iOS
  // Safari can't decode VP9/AV1).
  FFMPEG_PATH: z.string().default("ffmpeg"),
  FFPROBE_PATH: z.string().default("ffprobe"),
  // YouTube clip hosting goes through a RapidAPI downloader instead of yt-dlp.
  // Google blocks datacenter IPs at BOTH the extract step AND the video-CDN
  // download step, so a downloader that returns a googlevideo.com link doesn't
  // help — our server still can't fetch it. The defaults target Cloud API Hub's
  // /mux endpoint, which muxes video+audio on ITS server and returns a file on
  // its OWN domain (api-hub.cloud), which our server CAN download. One request
  // per clip: GET /mux?id=<videoId>&quality=<q>. Override to point elsewhere.
  YOUTUBE_RAPIDAPI_HOST: z
    .string()
    .default("cloud-api-hub-youtube-downloader.p.rapidapi.com"),
  YOUTUBE_RAPIDAPI_PATH: z.string().default("/mux"),
  YOUTUBE_RAPIDAPI_ID_PARAM: z.string().default("id"),
  // Requested output quality (max vertical resolution) for the muxer.
  YOUTUBE_RAPIDAPI_QUALITY: z.string().default("1080"),
  // A SEPARATE RapidAPI key used ONLY for the YouTube downloader, so YouTube can
  // run on its own subscription/account without touching RAPIDAPI_KEY (which
  // still powers view counts). Optional: when unset, YouTube falls back to
  // RAPIDAPI_KEY. Set this in DigitalOcean rather than in code.
  YOUTUBE_RAPIDAPI_KEY: z.string().optional(),
  // Instagram OAuth
  INSTAGRAM_APP_ID: z.string().min(1, "INSTAGRAM_APP_ID is required"),
  INSTAGRAM_APP_SECRET: z.string().min(1, "INSTAGRAM_APP_SECRET is required"),
  INSTAGRAM_OAUTH_REDIRECT_URI: z
    .string()
    .url("INSTAGRAM_OAUTH_REDIRECT_URI must be a valid URL"),
  // NOWPayments (crypto mass payouts, pilot). All optional: when unset, the
  // crypto payout endpoints fail with a clear "not configured" message and
  // the rest of the app is unaffected. Payout calls need BOTH the API key
  // and the account email/password — NOWPayments' payout API requires a
  // short-lived JWT from POST /auth on top of x-api-key.
  NOWPAYMENTS_API_BASE_URL: z
    .string()
    .url()
    .default("https://api.nowpayments.io/v1"),
  NOWPAYMENTS_API_KEY: z.string().optional(),
  NOWPAYMENTS_EMAIL: z.string().optional(),
  NOWPAYMENTS_PASSWORD: z.string().optional(),
  // Discord one-click join (Path B): the ATOMS application's OAuth2 creds,
  // used to get each clipper a guilds.join token so the Atoms bot can add
  // their exact account to a private server. MUST be the same Discord app as
  // the bot (DISCORD_BOT_TOKEN). All optional: when unset, the join-OAuth
  // endpoints report "not configured" and approvals fall back to invite links.
  DISCORD_OAUTH_CLIENT_ID: z.string().optional(),
  DISCORD_OAUTH_CLIENT_SECRET: z.string().optional(),
  DISCORD_OAUTH_REDIRECT_URI: z.string().url().optional(),
  // Dev Overlook code activity. Optional so boot never depends on it — the
  // panel just reports "not configured" instead of showing an empty feed and
  // implying nobody touched anything. Needs a read-only PAT with `repo` scope
  // (the repo is private, so an unauthenticated call sees nothing).
  GITHUB_TOKEN: z.string().optional(),
  GITHUB_REPO: z.string().default("Atomik-Growth/atomik-clips-monorepo"),
});

const env = envSchema.parse(process.env);
type Env = z.infer<typeof envSchema>;

export { env, type Env };
