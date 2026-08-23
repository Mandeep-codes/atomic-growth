import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { env } from "./env";
import { uploadBufferToSpaces } from "./spaces";
import { getYouTubeVideoId } from "../inngest-functions/update-views/getYouTubeViews";
import { getYoutubeHostingConfig } from "./youtubeHosting";

const execFileAsync = promisify(execFile);

// Diagnostic: is yt-dlp actually installed in this environment? Runs
// `yt-dlp --version`. If this fails with "command not found"/ENOENT, the
// Docker image wasn't rebuilt with yt-dlp, and Instagram/TikTok/X hosting will
// never work. YouTube no longer needs yt-dlp — it goes through RapidAPI — so
// we also report whether that downloader is turned on and has a usable key.
export async function checkYtDlp(): Promise<{
  available: boolean;
  version: string | null;
  error?: string;
  youtube: {
    enabled: boolean;
    configured: boolean;
    keySource: "db" | "youtube-env" | "main-env";
    host: string;
  };
}> {
  const hosting = await getYoutubeHostingConfig(true);
  const youtube = {
    // Is YouTube hosting switched ON in the admin settings?
    enabled: hosting.enabled,
    // Do we have a real (non-placeholder) key to call RapidAPI with?
    configured: Boolean(
      hosting.apiKey && hosting.apiKey !== "dummy" && env.YOUTUBE_RAPIDAPI_HOST
    ),
    // Which key is in effect (dedicated YouTube key vs the shared one)?
    keySource: hosting.keySource,
    host: env.YOUTUBE_RAPIDAPI_HOST,
  };
  try {
    const { stdout } = await execFileAsync(env.YTDLP_PATH, ["--version"], {
      timeout: 10_000,
    });
    return { available: true, version: stdout.trim() || "unknown", youtube };
  } catch (error) {
    return {
      available: false,
      version: null,
      error:
        error instanceof Error ? error.message : "yt-dlp is not runnable here",
      youtube,
    };
  }
}

// Downloads a clip's video with yt-dlp and stores it (plus a thumbnail) on
// Spaces, returning the public URLs. Used by the host-top-clips cron so the
// leaderboard plays clips on our own player with no link back to the source.
//
// One tool for all platforms (YouTube/TikTok/Instagram/X). The platform CDN
// URLs are short-lived and access-gated, so yt-dlp fetching the bytes to a
// temp file and us copying them to Spaces is exactly right — and since a
// posted clip never changes, this runs once per clip, ever.

const HOSTED_FOLDER = "leaderboard-clips";
// Guards against a runaway download. The TIMEOUT is the real hard bound:
// yt-dlp's --max-filesize is best-effort and is skipped for unknown-size
// HLS/DASH streams, so a pathological clip could write past MAX_BYTES on
// disk before the post-download size check rejects it — the timeout (and
// sequential, one-at-a-time downloads) is what actually caps that.
const YTDLP_TIMEOUT_MS = 90_000;
const MAX_BYTES = 200 * 1024 * 1024; // 200MB post-download ceiling

export type HostedClip = {
  videoUrl: string;
  thumbnailUrl: string | null;
};

const isVideoFile = (name: string) =>
  /\.(mp4|webm|mkv|mov)$/i.test(name);
const isThumbFile = (name: string) => /\.(jpg|jpeg|png|webp)$/i.test(name);

const contentTypeFor = (name: string): string => {
  const ext = name.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "webm":
      return "video/webm";
    case "mkv":
      return "video/x-matroska";
    case "mov":
      return "video/quicktime";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    default:
      return "video/mp4";
  }
};

// Read one stream field via ffprobe (null if the stream/field is absent).
async function ffprobeField(
  path: string,
  stream: "v" | "a",
  field: string
): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      env.FFPROBE_PATH,
      [
        "-v", "error",
        "-select_streams", `${stream}:0`,
        "-show_entries", `stream=${field}`,
        "-of", "csv=p=0",
        path,
      ],
      { timeout: 20_000 }
    );
    return stdout.trim().toLowerCase() || null;
  } catch {
    return null;
  }
}

// Normalize a downloaded clip to an mp4 that plays EVERYWHERE, including iOS
// Safari — which can't decode VP9/AV1 (the codec yt-dlp sometimes picks at
// higher resolutions, so a clip plays on desktop but is dead on iPhone). We
// re-encode ONLY the streams that aren't already iOS-friendly (h264 video /
// aac audio) to keep it fast, and always move the moov atom to the front
// (+faststart) for smooth mobile streaming.
async function normalizeToMobileMp4(
  inPath: string,
  outPath: string
): Promise<void> {
  const [vcodec, vpix, acodec] = await Promise.all([
    ffprobeField(inPath, "v", "codec_name"),
    ffprobeField(inPath, "v", "pix_fmt"),
    ffprobeField(inPath, "a", "codec_name"),
  ]);
  // iOS Safari's H.264 decoder only handles 8-bit 4:2:0, so copy the video
  // stream only when it's h264 AND yuv420p; otherwise re-encode to that.
  const videoIsMobileSafe =
    vcodec === "h264" && (vpix === "yuv420p" || vpix === "yuvj420p");
  const vArgs = videoIsMobileSafe
    ? ["-c:v", "copy"]
    : ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p"];
  const aArgs = !acodec
    ? ["-an"]
    : acodec === "aac"
      ? ["-c:a", "copy"]
      : ["-c:a", "aac", "-b:a", "128k"];
  await execFileAsync(
    env.FFMPEG_PATH,
    ["-y", "-i", inPath, ...vArgs, ...aArgs, "-movflags", "+faststart", outPath],
    { timeout: YTDLP_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 }
  );
}

export const isYouTubeUrl = (url: string) =>
  /(?:youtube\.com|youtu\.be)/i.test(url);

// A browser-like UA — YouTube's googlevideo CDN can be picky serving bytes to
// a bare fetch client.
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// The download URL comes out of a THIRD-PARTY (RapidAPI) response, so before we
// fetch it with the server's egress — and upload the bytes to a public bucket —
// make sure it's a normal public http(s) URL. This blocks a hostile or
// compromised downloader from pointing us at an internal address (e.g. the
// cloud metadata endpoint at 169.254.169.254) and having us exfiltrate it.
function assertPublicHttpUrl(raw: string): void {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("download URL is not a valid URL");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    throw new Error(`download URL uses a disallowed scheme (${u.protocol})`);
  }
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase(); // strip IPv6 []
  const isPrivate =
    host === "localhost" ||
    host === "0.0.0.0" ||
    host === "::1" ||
    /^(127\.|10\.|0\.|169\.254\.|192\.168\.)/.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^fe80:/i.test(host) || // IPv6 link-local
    /^f[cd][0-9a-f]{2}:/i.test(host); // IPv6 unique-local (fc00::/7)
  if (isPrivate) {
    throw new Error("download URL points at a private/loopback address");
  }
  // Reject non-standard NUMERIC host encodings that decode to an IP but slip
  // past the dotted-decimal checks above — decimal (2130706433), hex
  // (0x7f000001) and octal (0177.0.0.1) all resolve to 127.0.0.1. No real
  // download host is a bare integer, so we reject the whole class rather than
  // try to decode each form. (Residual: a normal DNS name that RESOLVES to a
  // private IP — DNS rebinding — is NOT caught here; fully closing that needs
  // resolve-and-pin, tracked as a follow-up.)
  const octets = host.split(".");
  const allNumericOctets =
    octets.length === 4 &&
    octets.every((o) => /^(0x[0-9a-f]+|[0-9]+)$/i.test(o));
  const nonCanonicalNumericHost =
    /^0x[0-9a-f]+$/i.test(host) || // hex integer  (0x7f000001)
    /^[0-9]+$/.test(host) || // decimal integer  (2130706433)
    (allNumericOctets &&
      octets.some((o) => /^0[0-9]+$/.test(o) || /^0x/i.test(o))); // octal/hex octet
  if (nonCanonicalNumericHost) {
    throw new Error("download URL uses a non-standard numeric host encoding");
  }
}

// Download a URL's bytes into a Buffer, bounded by a timeout AND a hard byte
// cap enforced WHILE streaming — we never hold more than MAX_BYTES in memory,
// so a response with no/spoofed Content-Length can't OOM the process.
async function fetchToBuffer(url: string, timeoutMs: number): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // Follow redirects OURSELVES, re-running the SSRF guard on EVERY hop.
    // Default fetch() follows 3xx transparently, so a provider download URL
    // that passes the guard could still 302 us to an internal address (e.g.
    // 169.254.169.254 cloud metadata) and we'd fetch it + upload the bytes to
    // a public bucket. Manual redirects, each re-guarded, close that hole.
    const MAX_REDIRECTS = 5;
    let currentUrl = url;
    let res: Awaited<ReturnType<typeof fetch>>;
    for (let hop = 0; ; hop++) {
      assertPublicHttpUrl(currentUrl);
      res = await fetch(currentUrl, {
        signal: controller.signal,
        headers: { "user-agent": BROWSER_UA },
        redirect: "manual",
      });
      const location = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && location) {
        if (hop >= MAX_REDIRECTS) {
          throw new Error("download exceeded the redirect limit");
        }
        // Resolve a possibly-relative Location against the current URL; the
        // next iteration re-guards it before fetching.
        currentUrl = new URL(location, currentUrl).toString();
        await (res.body as any)?.cancel?.().catch(() => {});
        continue;
      }
      break;
    }
    if (res.status === 429) {
      // The provider's file host is rate-limited too — treat as a soft skip,
      // not a real failure (so it never burns a hosting attempt).
      throw new HostingRateLimitedError(
        "File download rate/quota limit reached (HTTP 429)"
      );
    }
    if (!res.ok) {
      throw new Error(`download returned HTTP ${res.status}`);
    }
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared && declared > MAX_BYTES) {
      throw new Error(`file too large (${declared} bytes)`);
    }
    if (!res.body) {
      throw new Error("download response had no body");
    }
    // Read the body chunk-by-chunk with a running total; abort the moment we
    // cross MAX_BYTES instead of buffering the whole (possibly huge) body first.
    const reader = (res.body as any).getReader() as {
      read: () => Promise<{ done: boolean; value?: Uint8Array }>;
      cancel: () => Promise<unknown>;
    };
    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.length;
      if (total > MAX_BYTES) {
        await reader.cancel().catch(() => {});
        controller.abort();
        throw new Error(`file exceeded the ${MAX_BYTES}-byte cap mid-download`);
      }
      chunks.push(Buffer.from(value));
    }
    if (total === 0) {
      throw new Error("downloaded file is empty");
    }
    return Buffer.concat(chunks, total);
  } finally {
    clearTimeout(timer);
  }
}

// Thrown when the YouTube downloader API reports a rate/quota limit (e.g. the
// free tier's daily cap). Callers treat this as "skip and retry later" and must
// NOT count it as a failed hosting attempt, so a temporary cap can never mark a
// clip as permanently broken.
export class HostingRateLimitedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HostingRateLimitedError";
  }
}

export function isHostingRateLimitedError(e: unknown): boolean {
  return (
    e instanceof HostingRateLimitedError ||
    (e instanceof Error && e.name === "HostingRateLimitedError")
  );
}

// YouTube path. Google blocks datacenter IPs at BOTH the extract step and the
// video-CDN download step (googlevideo.com 403s our server even with a valid
// link). So we use a RapidAPI downloader that muxes video+audio on ITS OWN
// servers and returns a finished file on its own domain, which our server CAN
// download. One request per clip: GET <host>/mux?id=<id>&quality=<q> ->
// { url: <provider download url> } -> download that -> store on Spaces.
// `apiKey` is resolved by the caller (admin-set DB key, else env key).
async function downloadYouTubeViaRapidApi(options: {
  submissionId: string;
  url: string;
  apiKey: string;
}): Promise<HostedClip> {
  const { submissionId, url, apiKey } = options;
  const videoId = getYouTubeVideoId(url);
  if (!videoId) {
    throw new Error("Could not read a YouTube video id from the URL");
  }

  const host = env.YOUTUBE_RAPIDAPI_HOST;
  const path = env.YOUTUBE_RAPIDAPI_PATH.startsWith("/")
    ? env.YOUTUBE_RAPIDAPI_PATH
    : `/${env.YOUTUBE_RAPIDAPI_PATH}`;
  const endpoint =
    `https://${host}${path}?${encodeURIComponent(env.YOUTUBE_RAPIDAPI_ID_PARAM)}` +
    `=${encodeURIComponent(videoId)}&quality=${encodeURIComponent(
      env.YOUTUBE_RAPIDAPI_QUALITY
    )}`;

  // 1) Ask the API to mux the clip server-side; it returns a download URL on
  //    its own domain.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  let payload: any;
  try {
    const res = await fetch(endpoint, {
      signal: controller.signal,
      headers: { "x-rapidapi-key": apiKey, "x-rapidapi-host": host },
    });
    if (res.status === 429) {
      // Daily/quota cap reached — not a failure, just try again later.
      throw new HostingRateLimitedError(
        "YouTube downloader rate/quota limit reached (HTTP 429)"
      );
    }
    if (!res.ok) {
      const hint =
        res.status === 403 ? " (not subscribed to this RapidAPI API?)" : "";
      throw new Error(`YouTube downloader returned HTTP ${res.status}${hint}`);
    }
    payload = await res.json();
  } finally {
    clearTimeout(timer);
  }

  const downloadUrl = typeof payload?.url === "string" ? payload.url : null;
  if (!downloadUrl) {
    throw new Error(
      `YouTube downloader gave no download URL (status: ${payload?.status ?? "?"})`
    );
  }

  // 2) Download the finished mp4 from the provider's own server. Unlike a
  //    googlevideo.com link, this works from a datacenter IP.
  const videoBuffer = await fetchToBuffer(downloadUrl, YTDLP_TIMEOUT_MS);
  if (videoBuffer.length === 0 || videoBuffer.length > MAX_BYTES) {
    throw new Error(
      `Hosted video is an unexpected size (${videoBuffer.length} bytes)`
    );
  }

  const keyBase = `${HOSTED_FOLDER}/${submissionId}-${randomUUID()}`;
  const { url: videoUrl } = await uploadBufferToSpaces({
    key: `${keyBase}.mp4`,
    buffer: videoBuffer,
    contentType: "video/mp4",
    acl: "public-read",
  });
  if (!videoUrl) {
    throw new Error("Spaces did not return a public URL for the video");
  }

  // 3) Thumbnail from YouTube's public image CDN (i.ytimg.com, not the blocked
  //    video CDN). Non-fatal — the player generates a poster if this fails.
  let thumbnailUrl: string | null = null;
  try {
    const thumbBuffer = await fetchToBuffer(
      `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      20_000
    );
    if (thumbBuffer.length > 0) {
      const { url: thumbUrl } = await uploadBufferToSpaces({
        key: `${keyBase}.jpg`,
        buffer: thumbBuffer,
        contentType: "image/jpeg",
        acl: "public-read",
      });
      thumbnailUrl = thumbUrl;
    }
  } catch (thumbError) {
    console.warn("Failed to fetch/upload YouTube thumbnail", thumbError);
  }

  return { videoUrl, thumbnailUrl };
}

export async function downloadAndHostClip(options: {
  submissionId: string;
  url: string;
}): Promise<HostedClip> {
  const { submissionId, url } = options;

  // YouTube is blocked for yt-dlp on datacenter IPs, so it takes the RapidAPI
  // route. Everything else (Instagram / TikTok / X) stays on yt-dlp.
  if (isYouTubeUrl(url)) {
    // Master switch: when YouTube hosting is OFF we spend no RapidAPI calls.
    // Callers skip YouTube clips before reaching here so they don't burn a
    // retry attempt; this is the defense-in-depth guard for any other caller.
    const hosting = await getYoutubeHostingConfig();
    if (!hosting.enabled) {
      throw new Error("YouTube clip hosting is turned off");
    }
    return downloadYouTubeViaRapidApi({
      submissionId,
      url,
      apiKey: hosting.apiKey,
    });
  }

  const workDir = await mkdtemp(join(tmpdir(), "clip-"));

  try {
    // -S sorts formats: prefer H.264 video + AAC audio FIRST (so mobile can
    // play it), then <=720p, then mp4 container. Putting vcodec:h264 ahead of
    // res avoids yt-dlp picking a VP9/AV1 rendition that iOS Safari can't
    // decode. A post-download normalize pass is the hard guarantee.
    // --write-thumbnail + --convert-thumbnails jpg gives a poster image.
    // --no-playlist guards against album/collection URLs.
    const args = [
      "--no-playlist",
      "--no-progress",
      "--no-warnings",
      "--restrict-filenames",
      "-S",
      "vcodec:h264,acodec:aac,res:720,ext:mp4:m4a",
      "--merge-output-format",
      "mp4",
      // Remux non-mp4 containers (webm/mkv/mov) into mp4 without re-encoding
      // when the codecs allow, so the stored file is genuinely mp4. When it
      // can't remux we still store under the real extension + content-type
      // below and the <video> element reads the served Content-Type, so
      // playback is correct either way.
      "--remux-video",
      "mp4",
      "--write-thumbnail",
      "--convert-thumbnails",
      "jpg",
      "--max-filesize",
      "200M",
      "-o",
      join(workDir, "clip.%(ext)s"),
    ];
    if (env.YTDLP_COOKIES_FILE) {
      args.push("--cookies", env.YTDLP_COOKIES_FILE);
    }
    args.push(url);

    await execFileAsync(env.YTDLP_PATH, args, {
      timeout: YTDLP_TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024,
    });

    const files = await readdir(workDir);
    const videoName = files.find(isVideoFile);
    if (!videoName) {
      throw new Error("yt-dlp produced no video file");
    }
    const thumbName = files.find(isThumbFile);

    // Normalize to an H.264/AAC mp4 with faststart so it plays on mobile
    // (iOS Safari can't decode VP9/AV1). h264/aac streams are copied, not
    // re-encoded, so this is cheap in the common case.
    const normalizedPath = join(workDir, "hosted.mp4");
    await normalizeToMobileMp4(join(workDir, videoName), normalizedPath);

    const videoBuffer = await readFile(normalizedPath);
    if (videoBuffer.length === 0 || videoBuffer.length > MAX_BYTES) {
      throw new Error(
        `Hosted video is an unexpected size (${videoBuffer.length} bytes)`
      );
    }

    // Always an mp4 now (the normalize step guarantees it).
    const keyBase = `${HOSTED_FOLDER}/${submissionId}-${randomUUID()}`;
    const { url: videoUrl } = await uploadBufferToSpaces({
      key: `${keyBase}.mp4`,
      buffer: videoBuffer,
      contentType: "video/mp4",
      acl: "public-read",
    });
    if (!videoUrl) {
      throw new Error("Spaces did not return a public URL for the video");
    }

    let thumbnailUrl: string | null = null;
    if (thumbName) {
      try {
        const thumbBuffer = await readFile(join(workDir, thumbName));
        if (thumbBuffer.length > 0) {
          const { url } = await uploadBufferToSpaces({
            key: `${keyBase}.jpg`,
            buffer: thumbBuffer,
            contentType: contentTypeFor(thumbName),
            acl: "public-read",
          });
          thumbnailUrl = url;
        }
      } catch (thumbError) {
        // A missing thumbnail is not fatal — the player can generate one.
        console.warn("Failed to upload clip thumbnail", thumbError);
      }
    }

    return { videoUrl, thumbnailUrl };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
