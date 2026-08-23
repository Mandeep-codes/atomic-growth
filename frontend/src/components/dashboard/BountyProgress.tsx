import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  TrendingUp,
  DollarSign,
  Eye,
  Target,
  Loader2,
  Banknote,
} from "lucide-react";
import { useDashboardCampaignData } from "@/hooks/useCampaignData";

export const BountyProgress = ({
  campaignId,
  category,
  unlockPassword = null,
}: {
  campaignId: string;
  category?: string;
  // Set by the client dashboard once the campaign password has been verified.
  // Absent everywhere else (e.g. CategoryView, which has no auth gate at all).
  unlockPassword?: string | null;
}) => {
  // A private campaign's budget and CPM are teaser-stripped out of the public
  // getById, which zeroes Total Bounty / Views Promised / Value Delivered and
  // flatlines the progress bar. The shared hook routes staff and the
  // password-holding client to the real numbers, each authorized server-side.
  const {
    data: bountyData,
    isLoading,
    error,
  } = useDashboardCampaignData(campaignId, category, unlockPassword);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin" />
        </CardContent>
      </Card>
    );
  }

  if (error || !bountyData) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <p className="text-muted-foreground">Failed to load campaign data</p>
        </CardContent>
      </Card>
    );
  }

  const formatNumber = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  };

  // promisedViews is 0 when the CPM is unset or teaser-hidden (private
  // campaigns) — show 0%, not Infinity%.
  const viewsProgressPercentage =
    bountyData.promisedViews > 0
      ? (bountyData.deliveredViews / bountyData.promisedViews) * 100
      : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Target className="h-5 w-5 text-primary" />
          Bounty Progress
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {category ? (
          // Category view - with views progress
          <>
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
              <div className="text-center">
                <Banknote className="h-8 w-8 mx-auto text-primary mb-2" />
                <div className="text-2xl font-bold">
                  ${bountyData.totalBounty.toLocaleString()}
                </div>
                <div className="text-sm text-muted-foreground">Budget</div>
              </div>

              <div className="text-center">
                <Eye className="h-8 w-8 mx-auto text-primary mb-2" />
                <div className="text-2xl font-bold">
                  {formatNumber(bountyData.deliveredViews)}
                </div>
                <div className="text-sm text-muted-foreground">
                  Views Delivered
                </div>
              </div>

              <div className="text-center">
                <Target className="h-8 w-8 mx-auto text-primary mb-2" />
                <div className="text-2xl font-bold">
                  {formatNumber(bountyData.promisedViews)}
                </div>
                <div className="text-sm text-muted-foreground">
                  Views Promised
                </div>
              </div>

              <div className="text-center">
                <TrendingUp className="h-8 w-8 mx-auto text-primary mb-2" />
                <div className="text-2xl font-bold">
                  ${bountyData.monetaryProgress.toLocaleString()}
                </div>
                <div className="text-sm text-muted-foreground">
                  Value Delivered
                </div>
              </div>

              <div className="text-center">
                <DollarSign className="h-8 w-8 mx-auto text-primary mb-2" />
                <div className="text-2xl font-bold">
                  ${bountyData.externalCPM.toFixed(2)} CPM
                </div>
                <div className="text-sm text-muted-foreground">
                  per 1K views
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium">Views Progress</span>
                <span
                  className={`text-sm ${
                    viewsProgressPercentage > 100
                      ? "text-green-600 font-bold"
                      : "text-muted-foreground"
                  }`}
                >
                  {viewsProgressPercentage.toFixed(1)}% Complete
                  {viewsProgressPercentage > 100 && " 🎉"}
                </span>
              </div>
              <Progress
                value={Math.min(viewsProgressPercentage, 100)}
                className={`h-3 ${
                  viewsProgressPercentage > 100 ? "border border-green-500" : ""
                }`}
              />
              {viewsProgressPercentage > 100 && (
                <div className="text-xs text-green-600 font-medium text-center">
                  Over-delivered by {(viewsProgressPercentage - 100).toFixed(1)}
                  %!
                </div>
              )}
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>
                  {formatNumber(bountyData.deliveredViews)} views delivered
                </span>
                <span>
                  {formatNumber(bountyData.promisedViews)} views promised
                </span>
              </div>
            </div>
          </>
        ) : (
          // Main campaign view - full metrics with progress bar
          <>
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
              <div className="text-center">
                <DollarSign className="h-8 w-8 mx-auto text-primary mb-2" />
                <div className="text-2xl font-bold">
                  ${bountyData.totalBounty.toLocaleString()}
                </div>
                <div className="text-sm text-muted-foreground">
                  Total Bounty
                </div>
              </div>

              <div className="text-center">
                <Eye className="h-8 w-8 mx-auto text-primary mb-2" />
                <div className="text-2xl font-bold">
                  {formatNumber(bountyData.deliveredViews)}
                </div>
                <div className="text-sm text-muted-foreground">
                  Views Delivered
                </div>
              </div>

              <div className="text-center">
                <Target className="h-8 w-8 mx-auto text-primary mb-2" />
                <div className="text-2xl font-bold">
                  {formatNumber(bountyData.promisedViews)}
                </div>
                <div className="text-sm text-muted-foreground">
                  Views Promised
                </div>
              </div>

              <div className="text-center">
                <TrendingUp className="h-8 w-8 mx-auto text-primary mb-2" />
                <div className="text-2xl font-bold">
                  ${bountyData.monetaryProgress.toLocaleString()}
                </div>
                <div className="text-sm text-muted-foreground">
                  Value Delivered
                </div>
              </div>

              <div className="text-center">
                <DollarSign className="h-8 w-8 mx-auto text-primary mb-2" />
                <div className="text-2xl font-bold">
                  ${bountyData.externalCPM.toFixed(2)} CPM
                </div>
                <div className="text-sm text-muted-foreground">
                  per 1K views
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium">Views Progress</span>
                <span
                  className={`text-sm ${
                    viewsProgressPercentage > 100
                      ? "text-green-600 font-bold"
                      : "text-muted-foreground"
                  }`}
                >
                  {viewsProgressPercentage.toFixed(1)}% Complete
                  {viewsProgressPercentage > 100 && " 🎉"}
                </span>
              </div>
              <Progress
                value={Math.min(viewsProgressPercentage, 100)}
                className={`h-3 ${
                  viewsProgressPercentage > 100 ? "border border-green-500" : ""
                }`}
              />
              {viewsProgressPercentage > 100 && (
                <div className="text-xs text-green-600 font-medium text-center">
                  Over-delivered by {(viewsProgressPercentage - 100).toFixed(1)}
                  %!
                </div>
              )}
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>
                  {formatNumber(bountyData.deliveredViews)} views delivered
                </span>
                <span>
                  {formatNumber(bountyData.promisedViews)} views promised
                </span>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};
