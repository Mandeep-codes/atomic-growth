import { useEffect, useMemo, useRef } from "react";

declare global {
  interface Window {
    twttr?: {
      widgets?: {
        load: (element?: HTMLElement) => void;
      };
    };
  }
}

interface TwitterEmbedProps {
  url: string;
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

const normaliseTweetUrl = (input: string): string | null => {
  const normalized = ensureProtocol(input);
  if (!normalized) {
    return null;
  }

  try {
    const url = new URL(normalized);
    const hostname = url.hostname.toLowerCase();
    const supportsEmbed =
      hostname.includes("twitter.com") || hostname.includes("x.com");

    if (!supportsEmbed) {
      return null;
    }

    const statusMatch = url.pathname.match(
      /\/(?:[a-zA-Z0-9_]+)\/status\/([0-9]+)/
    );

    if (!statusMatch) {
      return null;
    }

    const [, statusId] = statusMatch;
    const usernameMatch = url.pathname.match(/\/([a-zA-Z0-9_]+)\/status\//);
    const username = usernameMatch ? usernameMatch[1] : null;

    if (!username || !statusId) {
      return null;
    }

    return `https://twitter.com/${username}/status/${statusId}`;
  } catch (error) {
    console.warn("Unable to normalise Twitter URL", error);
    return null;
  }
};

export const TwitterEmbed = ({ url }: TwitterEmbedProps) => {
  const tweetUrl = useMemo(() => normaliseTweetUrl(url), [url]);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const scriptReadyRef = useRef(false);

  useEffect(() => {
    if (!tweetUrl) {
      return;
    }

    const scriptSelector =
      'script[src="https://platform.twitter.com/widgets.js"]';
    const handleScriptLoad = (event: Event) => {
      const scriptEl = event.currentTarget as HTMLScriptElement | null;
      if (scriptEl) {
        scriptEl.dataset.loaded = "true";
      }
      scriptReadyRef.current = true;
      window.twttr?.widgets?.load();
    };

    const existingScript =
      document.querySelector<HTMLScriptElement>(scriptSelector);

    if (existingScript) {
      if (existingScript.dataset.loaded === "true") {
        scriptReadyRef.current = true;
        window.twttr?.widgets?.load(containerRef.current || undefined);
        return;
      }

      existingScript.addEventListener("load", handleScriptLoad);
      return () => {
        existingScript.removeEventListener("load", handleScriptLoad);
      };
    }

    const script = document.createElement("script");
    script.src = "https://platform.twitter.com/widgets.js";
    script.async = true;
    script.charset = "utf-8";
    script.addEventListener("load", handleScriptLoad);
    document.body.appendChild(script);

    return () => {
      script.removeEventListener("load", handleScriptLoad);
    };
  }, [tweetUrl]);

  useEffect(() => {
    if (!tweetUrl || !scriptReadyRef.current) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      window.twttr?.widgets?.load(containerRef.current || undefined);
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [tweetUrl]);

  if (!tweetUrl) {
    const fallbackHref = ensureProtocol(url);
    if (!fallbackHref) {
      return null;
    }

    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border/60 bg-secondary/20 p-4 text-xs text-muted-foreground">
        <span>Twitter blocked this link from being embedded.</span>
        <a
          href={fallbackHref}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-primary underline"
        >
          Open the post on Twitter
        </a>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex w-full justify-center">
      <blockquote
        key={tweetUrl}
        className="twitter-tweet"
        data-align="center"
        data-dnt="true"
        data-theme="light"
      >
        <a href={tweetUrl}>Loading post…</a>
      </blockquote>
    </div>
  );
};
