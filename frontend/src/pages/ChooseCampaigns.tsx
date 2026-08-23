import { useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { useCampaignsData } from "@/hooks/useCampaignsData";
import { Loader2 } from "lucide-react";
import {
  ActiveCampaignsSection,
  type Campaign,
} from "@/components/ActiveCampaignsSection";
import { CampaignDetailDialog } from "@/components/CampaignDetailDialog";

const ActiveCampaignsPage = () => {
  const { data: campaigns, isLoading, error } = useCampaignsData();
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(
    null
  );
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  if (isLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center py-12">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span>Loading active campaigns…</span>
          </div>
        </div>
      </AppLayout>
    );
  }

  if (error) {
    return (
      <AppLayout>
        <div className="max-w-6xl mx-auto px-6 py-8">
          <div className="flex items-center justify-center py-12">
            <p className="text-destructive">
              We couldn’t load the active campaigns. Please try again.
            </p>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto px-6 py-10 space-y-10">
        <ActiveCampaignsSection
          campaigns={campaigns ?? []}
          onSelectCampaign={(campaign) => {
            setSelectedCampaign(campaign);
            setIsDialogOpen(true);
          }}
          title="Choose a campaign"
        />
      </div>

      <CampaignDetailDialog
        open={isDialogOpen}
        campaign={selectedCampaign}
        onOpenChange={(open) => {
          setIsDialogOpen(open);
          if (!open) {
            setSelectedCampaign(null);
          }
        }}
        actionLabel="Add Clip"
      />
    </AppLayout>
  );
};

export default ActiveCampaignsPage;
