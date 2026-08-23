import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { usePlatformBreakdown } from "@/hooks/usePlatformBreakdown";
import { Skeleton } from "@/components/ui/skeleton";
import { Video, Eye } from "lucide-react";

interface PlatformBreakdownProps {
  campaignId: string;
  category?: string;
}

const formatNumber = (num: number): string => {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + "M";
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1) + "K";
  }
  return num.toString();
};

const getPlatformDisplayName = (platform: string): string => {
  const platformMap: Record<string, string> = {
    tiktok: "TikTok",
    youtube: "YouTube Shorts",
    // Kept as an alias, not a second platform: "x" is the only value ever
    // stored, but a legacy row must still render as X rather than falling
    // through to the raw key.
    twitter: "X",
    instagram: "Instagram Reels",
    x: "X",
  };

  return platformMap[platform.toLowerCase()] || platform;
};

export const PlatformBreakdown = ({
  campaignId,
  category,
}: PlatformBreakdownProps) => {
  const {
    data: platformData,
    isLoading,
    error,
  } = usePlatformBreakdown(campaignId, category);

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Platform Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-destructive">Failed to load platform breakdown</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Platform Breakdown</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {isLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center justify-between p-3 rounded-lg border"
              >
                <div className="space-y-1">
                  <Skeleton className="h-4 w-24" />
                  <div className="flex items-center gap-4">
                    <Skeleton className="h-3 w-16" />
                    <Skeleton className="h-3 w-20" />
                  </div>
                </div>
              </div>
            ))
          ) : platformData && platformData.length > 0 ? (
            platformData
              .filter((platform) => platform.platform !== "x")
              .map((platform) => (
                <div
                  key={platform.platform}
                  className="flex items-center justify-between p-3 rounded-lg border bg-muted/30"
                >
                  <div className="space-y-1">
                    <h4 className="font-medium text-sm">
                      {getPlatformDisplayName(platform.platform)}
                    </h4>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <Video className="h-3 w-3" />
                        <span>{platform.clips.toLocaleString()} clips</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Eye className="h-3 w-3" />
                        <span>{formatNumber(platform.views)} views</span>
                      </div>
                    </div>
                  </div>
                </div>
              ))
          ) : (
            <p className="text-muted-foreground text-center py-4">
              No submissions found for this campaign
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
