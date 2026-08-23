// Helpers for parsing and embedding YouTube URLs.
// Handles four URL shapes: watch?v=, youtu.be/, /shorts/, /embed/.

export type YouTubeVideo = {
  id: string;
  isShort: boolean;
  embedUrl: string;
};

const HOST_PATTERN = /^(?:www\.|m\.)?(?:youtube\.com|youtu\.be)$/i;

export function parseYouTubeUrl(rawUrl: string): YouTubeVideo | null {
  if (!rawUrl) return null;

  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return null;
  }

  if (!HOST_PATTERN.test(url.hostname)) return null;

  let id: string | null = null;
  let isShort = false;

  if (url.hostname.toLowerCase().endsWith("youtu.be")) {
    id = url.pathname.replace(/^\/+/, "").split("/")[0] ?? null;
  } else {
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments[0] === "watch") {
      id = url.searchParams.get("v");
    } else if (segments[0] === "shorts" && segments[1]) {
      id = segments[1];
      isShort = true;
    } else if (segments[0] === "embed" && segments[1]) {
      id = segments[1];
    }
  }

  if (!id || !/^[\w-]{6,}$/.test(id)) return null;

  return {
    id,
    isShort,
    embedUrl: `https://www.youtube.com/embed/${id}`,
  };
}

export function isValidYouTubeUrl(rawUrl: string): boolean {
  return parseYouTubeUrl(rawUrl) !== null;
}
