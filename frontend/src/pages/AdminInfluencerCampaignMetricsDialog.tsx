import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { demographicSchema, type DemographicData } from "@/shared/demographics";
import { Loader2 } from "lucide-react";

type TwitterSubmission = {
  id: string;
  handle: string;
  link: string;
  impressions: number;
  bookmarkCount: number;
  replyCount: number;
  quoteCount: number;
  favoriteCount: number;
  retweetCount: number;
  demographicsParsed: unknown;
};

type LinkedInSubmission = {
  id: string;
  handle: string;
  link: string;
  impressions: number;
  likes: number;
  comments: number;
  reposts: number;
  demographicsParsed: unknown;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  platform: "twitter" | "linkedin";
  submission: TwitterSubmission | LinkedInSubmission | null;
};

const parseDemographics = (value: unknown): DemographicData | null => {
  if (!value) return null;
  const parsed = demographicSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
};

export const AdminInfluencerCampaignMetricsDialog = ({
  open,
  onOpenChange,
  platform,
  submission,
}: Props) => {
  const demographics = submission ? parseDemographics(submission.demographicsParsed) : null;
  const postUrl = submission?.link ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl lg:max-w-4xl">
        <DialogHeader>
          <DialogTitle>
            {platform === "twitter" ? "X/Twitter metrics" : "LinkedIn metrics"} for
            @{submission?.handle ?? ""}
          </DialogTitle>
          <DialogDescription>
            Detailed metrics captured from the latest ingestion for this clip.
          </DialogDescription>
        </DialogHeader>

        {submission ? (
          <div className="max-h-[80vh] overflow-y-auto pr-2">
            <div className="flex flex-col gap-4 lg:flex-row">
              <div className="flex-1 space-y-4">
                <MetricRow label="Impressions" value={submission.impressions} primary />
                {platform === "twitter" ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <MetricRow label="Bookmarks" value={(submission as TwitterSubmission).bookmarkCount} />
                    <MetricRow label="Replies" value={(submission as TwitterSubmission).replyCount} />
                    <MetricRow label="Quotes" value={(submission as TwitterSubmission).quoteCount} />
                    <MetricRow label="Likes" value={(submission as TwitterSubmission).favoriteCount} />
                    <MetricRow label="Retweets" value={(submission as TwitterSubmission).retweetCount} />
                  </div>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <MetricRow label="Likes" value={(submission as LinkedInSubmission).likes} />
                    <MetricRow label="Comments" value={(submission as LinkedInSubmission).comments} />
                    <MetricRow label="Reposts" value={(submission as LinkedInSubmission).reposts} />
                  </div>
                )}

                <div>
                  <p className="text-xs font-semibold text-muted-foreground">Demographics</p>
                  {demographics ? (
                    <div className="mt-2 space-y-1 text-sm">
                      {[...demographics.countries]
                        .sort((a, b) => b.percentage - a.percentage)
                        .map((country) => (
                          <div key={country.country} className="flex items-center justify-between">
                            <span>{country.country}</span>
                            <Badge variant="outline">{country.percentage}%</Badge>
                          </div>
                        ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">No demographics present.</p>
                  )}
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground">Post</p>
                  <ButtonLink href={submission.link} label="View post" />
                </div>
              </div>

              <div className="hidden flex-1 lg:block">
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground">
                    Post preview
                  </p>
                  {postUrl ? (
                    platform === "twitter" ? (
                      <TwitterEmbed url={postUrl} />
                    ) : (
                      <LinkedInEmbed url={postUrl} />
                    )
                  ) : (
                    <p className="text-xs text-muted-foreground">Preview unavailable.</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
};

const TwitterEmbed = ({ url }: { url: string }) => {
  const tweetId = extractTweetId(url);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isLoading, setIsLoading] = useState(Boolean(tweetId));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tweetId || !containerRef.current) return undefined;

    let cancelled = false;
    const currentContainer = containerRef.current;

    const renderTweet = async () => {
      setIsLoading(true);
      setError(null);
      await loadTwitterScript();
      if (cancelled || !currentContainer) return;
      currentContainer.innerHTML = "";
      try {
        await window.twttr?.widgets?.createTweet(tweetId, currentContainer, {
          align: "center",
          dnt: true,
        });
        if (!cancelled) {
          setIsLoading(false);
        }
      } catch (err) {
        console.error("Unable to render tweet", err);
        if (!cancelled) {
          setError("Unable to display tweet preview");
          setIsLoading(false);
        }
      }
    };

    void renderTweet();

    return () => {
      cancelled = true;
      if (currentContainer) {
        currentContainer.innerHTML = "";
      }
    };
  }, [tweetId]);

  if (!tweetId) {
    return (
      <div className="rounded-lg border border-dashed bg-muted/30 p-3 text-xs text-muted-foreground">
        Unable to embed this tweet. The link may be private.
      </div>
    );
  }

  return (
    <div className="relative rounded-lg border bg-background p-3">
      {isLoading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-background/80">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      )}
      {error ? (
        <div className="p-4 text-center text-xs text-muted-foreground">{error}</div>
      ) : null}
      <div
        ref={containerRef}
        className={`min-h-[200px] ${isLoading ? "opacity-0" : "opacity-100 transition-opacity"}`}
      />
    </div>
  );
};

const LinkedInEmbed = ({ url }: { url: string }) => {
  const activityId = extractLinkedInActivityId(url);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  if (!activityId) {
    return (
      <div className="rounded-lg border border-dashed bg-muted/30 p-3 text-xs text-muted-foreground">
        Unable to embed this LinkedIn post. The link may be private.
      </div>
    );
  }

  const embedUrl = `https://www.linkedin.com/embed/feed/update/urn:li:activity:${activityId}`;

  return (
    <div className="relative overflow-hidden rounded-lg border bg-background">
      {isLoading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      )}
      {error ? (
        <div className="p-4 text-center text-xs text-muted-foreground">{error}</div>
      ) : null}
      <iframe
        title="LinkedIn post preview"
        src={embedUrl}
        className="h-[420px] w-full"
        allowFullScreen
        onLoad={() => setIsLoading(false)}
        onError={() => {
          setIsLoading(false);
          setError("Unable to display LinkedIn preview");
        }}
      />
    </div>
  );
};

const MetricRow = ({
  label,
  value,
  primary,
}: {
  label: string;
  value: number;
  primary?: boolean;
}) => (
  <div
    className={`rounded-md border bg-muted/30 p-3 text-sm ${primary ? "border-primary/40 bg-primary/5" : ""
      }`}
  >
    <p className="text-xs uppercase text-muted-foreground">{label}</p>
    <p className="text-lg font-semibold">{value.toLocaleString()}</p>
  </div>
);

const ButtonLink = ({ href, label }: { href: string; label: string }) => (
  <div>
    <Button variant="outline" asChild className="w-full">
      <a href={href} target="_blank" rel="noreferrer">
        {label}
      </a>
    </Button>
  </div>
);

const TWEET_STATUS_REGEX = /status(?:es)?\/(\d+)/i;
const LINKEDIN_ACTIVITY_REGEX = /activity-(\d+)/i;

function extractTweetId(url: string) {
  try {
    const parsed = new URL(url);
    const match = parsed.pathname.match(TWEET_STATUS_REGEX);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

function extractLinkedInActivityId(url: string) {
  const match = url.match(LINKEDIN_ACTIVITY_REGEX);
  return match?.[1] ?? null;
}

let twitterScriptPromise: Promise<void> | null = null;

function loadTwitterScript() {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.twttr?.widgets) {
    return Promise.resolve();
  }

  if (!twitterScriptPromise) {
    twitterScriptPromise = new Promise((resolve) => {
      const script = document.createElement("script");
      script.src = "https://platform.twitter.com/widgets.js";
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => resolve();
      document.body.appendChild(script);
    });
  }

  return twitterScriptPromise;
}

declare global {
  interface Window {
    twttr?: {
      widgets?: {
        load: (element?: HTMLElement) => void;
        createTweet: (
          tweetId: string,
          element: HTMLElement,
          options?: Record<string, unknown>
        ) => Promise<unknown>;
      };
    };
  }
}
