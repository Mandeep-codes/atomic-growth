import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ExternalLink,
  Trophy,
  TrendingUp,
  TrendingDown,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Instagram,
  Youtube,
  Music2,
  Twitter,
  Globe,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useSubmissionsData } from "@/hooks/useSubmissionsData";
import { useState, useEffect } from "react";
import { trackEvent } from "@/lib/analytics";
import { AnimatedGradientText } from "@/components/ui/animated-gradient";
import { formatPlatformLabel } from "@/lib/utils";
import { Skeleton } from "../ui/skeleton";

export const Leaderboard = ({
  campaignId,
  category,
  limit,
}: {
  campaignId: string;
  category?: string;
  limit?: number;
}) => {
  const storageKey = `leaderboard:v1:${campaignId}:${category ?? "all"}:${limit ?? "none"
    }`;

  const readStoredState = () => {
    if (typeof window === "undefined") return null;

    try {
      const raw = window.sessionStorage.getItem(storageKey);
      if (!raw) return null;
      return JSON.parse(raw) as {
        currentPage?: number;
        platformFilter?: string;
      };
    } catch {
      return null;
    }
  };

  const [currentPage, setCurrentPage] = useState(() => {
    const stored = readStoredState();
    return stored?.currentPage && stored.currentPage > 0 ? stored.currentPage : 1;
  });

  const [platformFilter, setPlatformFilter] = useState<string>(() => {
    const stored = readStoredState();
    return stored?.platformFilter ? stored.platformFilter : "all";
  });

  const {
    data: leaderboardData,
    isLoading,
    error,
  } = useSubmissionsData(campaignId, category, limit, platformFilter);

  // If the campaign/category/limit changes without a full remount,
  // reload the persisted state for the new key.
  useEffect(() => {
    const stored = readStoredState();
    setCurrentPage(
      stored?.currentPage && stored.currentPage > 0 ? stored.currentPage : 1
    );
    setPlatformFilter(stored?.platformFilter ? stored.platformFilter : "all");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  const itemsPerPage = 10;
  const totalPages = Math.ceil((leaderboardData?.length ?? 0) / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const currentPageData = leaderboardData?.slice(startIndex, endIndex) || [];

  // If a refetch changes the total items, keep the current page in-range.
  useEffect(() => {
    if (totalPages === 0) return;
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  // Persist across navigation/unmount.
  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      window.sessionStorage.setItem(
        storageKey,
        JSON.stringify({ currentPage, platformFilter })
      );
    } catch {
      // Ignore storage failures (private mode, quota, etc.).
    }
  }, [currentPage, platformFilter, storageKey]);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-primary" />
            Top Performing Clips
          </CardTitle>
        </CardHeader>
        <CardContent className="py-8 space-y-2">
          {Array.from({ length: 10 }).map((_, index) => (
            <Skeleton key={index} className="h-10 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (error || !leaderboardData) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-primary" />
            Top Performing Clips
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center py-8">
          <p className="text-muted-foreground">
            Failed to load submissions data
          </p>
        </CardContent>
      </Card>
    );
  }

  const formatNumber = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  };

  const formatDay = (date?: Date | string | null) => {
    if (!date) return "—";
    const parsed = typeof date === "string" ? new Date(date) : date;
    if (Number.isNaN(parsed.getTime())) return "—";
    return parsed.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  };

  const platformIconMap: Record<string, LucideIcon> = {
    youtube: Youtube,
    instagram: Instagram,
    tiktok: Music2,
    twitter: Twitter,
    x: Twitter,
  };

  const getPlatformIcon = (platform?: string | null) => {
    const normalized = platform?.toLowerCase() || "";
    return platformIconMap[normalized] || Globe;
  };

  const getRankIcon = (rank: number) => {
    if (rank <= 3) {
      const palette = {
        1: "text-amber-500 bg-amber-500/15",
        2: "text-slate-400 bg-slate-400/15 dark:text-slate-300 dark:bg-slate-400/25",
        3: "text-orange-500 bg-orange-500/15",
      } as const;

      return (
        <div
          className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold ${palette[rank as 1 | 2 | 3]
            }`}
        >
          <Trophy className="h-3.5 w-3.5" />#{rank}
        </div>
      );
    }

    return (
      <span className="text-xs font-semibold text-muted-foreground">
        #{rank}
      </span>
    );
  };

  return (
    <Card className="border-border/70 shadow-sm">
      <CardHeader className="flex flex-col gap-3 pb-2 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Trophy className="h-5 w-5 text-primary" />
          Top Performing Clips
        </CardTitle>
        <Select
          value={platformFilter}
          onValueChange={(value) => {
            setCurrentPage(1);
            setPlatformFilter(value);
            trackEvent({
              event: "leaderboard_platform_filter_changed",
              properties: {
                campaignId,
                category,
                platform: value === "all" ? null : value,
              },
            });
          }}
        >
          <SelectTrigger className="w-full sm:w-[200px]">
            <SelectValue placeholder="All platforms" />
          </SelectTrigger>
          <SelectContent align="end">
            <SelectItem value="all">All platforms</SelectItem>
            <SelectItem value="tiktok">TikTok</SelectItem>
            <SelectItem value="instagram">Instagram</SelectItem>
            <SelectItem value="youtube">YouTube</SelectItem>
            {/* "Twitter" was a second option here alongside X. Nothing is ever
                stored under that platform value — every clip, account and
                non-campaign clip uses "x" — so picking it always returned an
                empty board. X is the only real option. */}
            <SelectItem value="x">X</SelectItem>
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent className="pt-2">
        {(leaderboardData?.length ?? 0) === 0 ? (
          <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
            {platformFilter === "all"
              ? "No submissions found for this campaign."
              : `No submissions found for ${formatPlatformLabel(platformFilter)}.`}
          </div>
        ) : (
          <div className="[&>div]:overflow-hidden md:[&>div]:overflow-x-auto">
            <Table className="text-sm w-full">
              <TableHeader>
                <TableRow className="border-b border-border/70">
                  <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Rank
                  </TableHead>
                  <TableHead className="hidden text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:table-cell">
                    Campaign
                  </TableHead>
                  {/* <TableHead>Creator</TableHead> */}
                  <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Platform
                  </TableHead>
                  <TableHead className="hidden text-xs font-semibold uppercase tracking-wide text-muted-foreground md:table-cell">
                    Added
                  </TableHead>
                  {/* <TableHead>Category</TableHead> */}
                  <TableHead className="text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Views
                  </TableHead>
                  {/* <TableHead className="text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Reward
              </TableHead> */}
                  {/* <TableHead className="text-right">24h Δ</TableHead> */}
                  <TableHead className="w-0 hidden sm:table-cell"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {currentPageData.map((clip) => {
                  const platformValue = clip.platform;
                  const Icon = getPlatformIcon(platformValue);
                  const platformLabel = formatPlatformLabel(platformValue);

                  return (
                    <TableRow
                      key={clip.id}
                      className="group border-b border-border/60 last:border-0 cursor-pointer transition-colors hover:bg-muted/60"
                      onClick={() => {
                        trackEvent({
                          event: "leaderboard_row_clicked",
                          properties: {
                            campaignId,
                            category,
                            submissionId: clip.id,
                            platform: clip.platform,
                          },
                        });
                        window.open(
                          clip.clipUrl,
                          "_blank",
                          "noopener,noreferrer"
                        );
                      }}
                    >
                      <TableCell className="py-2 align-middle whitespace-nowrap">
                        {getRankIcon(clip.rank)}
                      </TableCell>
                      <TableCell className="hidden py-2 text-sm text-muted-foreground sm:table-cell">
                        {clip.campaignTitle ?? "—"}
                      </TableCell>
                      {/* <TableCell>
                  <div className="font-medium">{clip.creator}</div>
                </TableCell> */}
                      <TableCell className="py-2 align-middle">
                        <Badge
                          variant="secondary"
                          className="gap-2 rounded-full border-transparent px-3 py-1 text-xs font-semibold capitalize"
                        >
                          <Icon className="h-3.5 w-3.5" />
                          {platformLabel}
                        </Badge>
                      </TableCell>
                      {/* <TableCell>
                  <Badge variant="secondary">
                    {clip.category === "0" ? "" : clip.category}
                  </Badge>
                </TableCell> */}
                      <TableCell className="hidden py-2 text-sm text-muted-foreground md:table-cell">
                        {formatDay(clip.createdAt as Date | string | null)}
                      </TableCell>
                      <TableCell className="py-2 text-right font-semibold tracking-tight">
                        {clip.viewCount > 1000000 ? (
                          <AnimatedGradientText className="text-base">
                            {formatNumber(clip.viewCount)}
                          </AnimatedGradientText>
                        ) : (
                          formatNumber(clip.viewCount)
                        )}
                      </TableCell>
                      {/* <TableCell className="py-2 text-right text-sm font-semibold text-foreground">
                    {clip.reward && clip.reward > 100 ? (
                      <AnimatedGradientText className="text-base">
                        {formatCurrencyValue(clip.reward)}
                      </AnimatedGradientText>
                    ) : (
                      formatCurrencyValue(clip.reward)
                    )}
                  </TableCell> */}
                      {/* <TableCell className="text-right">
                  <div className={`flex items-center justify-end gap-1 ${
                    clip.isPositiveVelocity ? 'text-green-600' : 'text-red-600'
                  }`}>
                    {clip.isPositiveVelocity ? (
                      <TrendingUp className="h-3 w-3" />
                    ) : (
                      <TrendingDown className="h-3 w-3" />
                    )}
                    <span className="text-xs font-medium">
                      {clip.isPositiveVelocity ? '+' : ''}{formatNumber(Math.abs(clip.velocityChange))}
                    </span>
                  </div>
                </TableCell> */}
                      <TableCell className="py-2 pl-0 text-right hidden sm:table-cell">
                        <a
                          href={clip.clipUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex text-muted-foreground transition-colors hover:text-foreground"
                          onClick={(e) => {
                            e.stopPropagation();
                            trackEvent({
                              event: "leaderboard_external_link_clicked",
                              properties: {
                                campaignId,
                                category,
                                submissionId: clip.id,
                                platform: clip.platform,
                              },
                            });
                          }}
                        >
                          <ExternalLink className="h-4 w-4 opacity-70 transition-opacity group-hover:opacity-100" />
                        </a>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-center mt-3 pt-3 border-t border-border/70">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                disabled={currentPage === 1}
              >
                <ChevronLeft className="h-4 w-4" />
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setCurrentPage((page) => Math.min(totalPages, page + 1))
                }
                disabled={currentPage === totalPages}
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
