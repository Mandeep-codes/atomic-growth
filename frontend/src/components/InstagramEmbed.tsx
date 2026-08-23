import { useEffect, useMemo, useRef } from "react";

declare global {
  interface Window {
    instgrm?: {
      Embeds: {
        process: () => void;
      };
    };
  }
}

interface InstagramEmbedProps {
  url: string;
}

interface InstagramEmbedData {
  postId: string;
  permalink: string;
  directUrl: string;
}

const ensureProtocol = (rawUrl: string | null | undefined): string | null => {
  if (!rawUrl) {
    return null;
  }

  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return null;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  if (trimmed.startsWith("//")) {
    return `https:${trimmed}`;
  }

  return `https://${trimmed}`;
};

const getInstagramEmbedData = (input: string): InstagramEmbedData | null => {
  const normalizedUrl = ensureProtocol(input);
  if (!normalizedUrl) {
    return null;
  }

  try {
    const parsed = new URL(normalizedUrl);
    const match = parsed.pathname.match(
      /\/(reel|reels|p|tv)\/([a-zA-Z0-9_-]+)/
    );

    if (!match) {
      return null;
    }

    const [, postTypeRaw, postId] = match;
    const postType = postTypeRaw === "reels" ? "reel" : postTypeRaw;

    parsed.pathname = `/${postType}/${postId}/`;
    parsed.search = "";
    parsed.hash = "";

    const permalinkBase = `${parsed.origin}${parsed.pathname}`;

    return {
      postId,
      permalink: `${permalinkBase}?utm_source=ig_embed&utm_campaign=loading`,
      directUrl: permalinkBase,
    };
  } catch (error) {
    console.warn("Unable to normalise Instagram URL", error);
    return null;
  }
};

export const InstagramEmbed = ({ url }: InstagramEmbedProps) => {
  const embedData = useMemo(() => getInstagramEmbedData(url), [url]);
  const postId = embedData?.postId;
  const permalink = embedData?.permalink;
  const directUrl = embedData?.directUrl;

  const scriptReadyRef = useRef(false);

  useEffect(() => {
    if (!postId) {
      return;
    }

    const scriptSelector = 'script[src="https://www.instagram.com/embed.js"]';
    const handleScriptLoad = (event: Event) => {
      const scriptEl = event.currentTarget as HTMLScriptElement | null;
      if (scriptEl) {
        scriptEl.dataset.loaded = "true";
      }
      scriptReadyRef.current = true;
      window.instgrm?.Embeds?.process();
    };

    const existingScript =
      document.querySelector<HTMLScriptElement>(scriptSelector);

    if (existingScript) {
      if (existingScript.dataset.loaded === "true") {
        scriptReadyRef.current = true;
        window.instgrm?.Embeds?.process();
        return;
      }

      existingScript.addEventListener("load", handleScriptLoad);
      return () => {
        existingScript.removeEventListener("load", handleScriptLoad);
      };
    }

    const script = document.createElement("script");
    script.src = "https://www.instagram.com/embed.js";
    script.async = true;
    script.addEventListener("load", handleScriptLoad);
    document.body.appendChild(script);

    return () => {
      script.removeEventListener("load", handleScriptLoad);
    };
  }, [postId]);

  useEffect(() => {
    if (!postId || !permalink || !scriptReadyRef.current) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      window.instgrm?.Embeds?.process();
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [permalink, postId]);

  if (!postId || !permalink || !directUrl) {
    const fallbackHref = ensureProtocol(url);
    if (!fallbackHref) {
      return null;
    }

    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border/60 bg-secondary/20 p-4 text-xs text-muted-foreground">
        <span>Instagram blocked this link from being embedded.</span>
        <a
          href={fallbackHref}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-primary underline"
        >
          Open the post on Instagram
        </a>
      </div>
    );
  }

  return (
    <div className="flex w-full justify-center">
      <blockquote
        key={postId}
        className="instagram-media"
        data-instgrm-captioned
        data-instgrm-permalink={permalink}
        data-instgrm-version="14"
        style={{
          background: "#FFF",
          border: 0,
          borderRadius: "3px",
          boxShadow:
            "0 0 1px 0 rgba(0,0,0,0.5),0 1px 10px 0 rgba(0,0,0,0.15)",
          margin: "1px",
          maxWidth: "540px",
          width: "100%",
        }}
      >
        <a
          href={directUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            color: "#3897f0",
            display: "block",
            fontFamily: "Arial,sans-serif",
            fontSize: "14px",
            fontStyle: "normal",
            fontWeight: 550,
            lineHeight: "18px",
            padding: "8px 0",
            textDecoration: "none",
          }}
        >
          View this post on Instagram
        </a>
      </blockquote>
    </div>
  );
};
