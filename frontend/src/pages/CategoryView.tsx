import { useParams } from "react-router-dom";
import { Loader2, Tag } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { BountyProgress } from "@/components/dashboard/BountyProgress";
import { Leaderboard } from "@/components/dashboard/Leaderboard";
import { PlatformBreakdown } from "@/components/dashboard/PlatformBreakdown";
import { useCampaignData } from "@/hooks/useCampaignData";
import { useCampaignCategories } from "@/hooks/useCampaignCategories";
import { AppLayout } from "@/components/AppLayout";

const CategoryView = () => {
  const { campaignId, category } = useParams();

  const currentCampaignId =
    campaignId || "7cf3e7de-73b8-4591-9de6-864ff6bfdedb";
  const decodedCategory = decodeURIComponent(category || "");

  const { data: campaignInfo, isLoading: campaignLoading } =
    useCampaignData(currentCampaignId);
  const { data: categories, isLoading: categoriesLoading } =
    useCampaignCategories(currentCampaignId);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto px-6 py-6">
        <div className="text-left">
          {campaignLoading || categoriesLoading ? (
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-muted-foreground">Loading campaign...</span>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 mb-2">
                <Badge variant="secondary" className="gap-1">
                  <Tag className="h-3 w-3" />
                  {decodedCategory}
                </Badge>
              </div>
              <h2 className="text-xl font-semibold text-foreground">
                {campaignInfo?.campaign?.title || "Campaign Dashboard"} -{" "}
                {decodedCategory}
              </h2>
              <p className="text-sm text-muted-foreground">
                Active since{" "}
                {campaignInfo?.campaign?.created_at
                  ? formatDate(campaignInfo.campaign.created_at)
                  : "Unknown date"}
              </p>
            </>
          )}
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 pb-8">
        <div className="space-y-8">
          <BountyProgress
            campaignId={currentCampaignId}
            category={decodedCategory}
          />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="space-y-8">
              <Leaderboard
                campaignId={currentCampaignId}
                category={decodedCategory}
              />
            </div>
            <div className="space-y-8">
              <PlatformBreakdown
                campaignId={currentCampaignId}
                category={decodedCategory}
              />
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default CategoryView;
