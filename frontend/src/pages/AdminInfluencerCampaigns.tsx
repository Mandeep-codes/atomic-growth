import { Link } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { Loader2, Calendar } from "lucide-react";

const formatDate = (value: string | Date | null | undefined) => {
  if (!value) return "No end date";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "Invalid date";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

const AdminInfluencerCampaigns = () => {
  const { data: campaigns, isLoading, isError } =
    trpc.influencerSubmissions.listCampaigns.useQuery();

  return (
    <AppLayout>
      <div className="mx-auto max-w-6xl space-y-6 px-6 py-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold text-foreground">
              Influencer campaigns
            </h1>
            <p className="text-muted-foreground">
              Track the campaigns currently running for sourced influencers.
            </p>
          </div>
          <Button asChild>
            <Link to="/admin/influencer-campaigns/new">Create campaign</Link>
          </Button>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-20">
            <span className="inline-flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" /> Loading campaigns…
            </span>
          </div>
        ) : isError ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-destructive">
              Unable to load campaigns. Please try again.
            </CardContent>
          </Card>
        ) : campaigns && campaigns.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2">
            {campaigns.map((campaign) => (
              <Card key={campaign.id} className="flex h-full flex-col">
                <CardHeader>
                  <CardTitle className="flex items-center justify-between gap-3">
                    <span>{campaign.title}</span>
                    <Badge variant="secondary">{campaign.submissionCount} clips</Badge>
                  </CardTitle>
                  <CardDescription className="flex items-center gap-2 text-xs">
                    <Calendar className="h-3 w-3" />
                    Ends: <span className="font-medium">{formatDate(campaign.end_date ?? null)}</span>
                  </CardDescription>
                </CardHeader>
                <CardFooter className="flex flex-wrap items-center justify-end gap-2">
                  <Button variant="outline" asChild>
                    <Link to={`/admin/influencer-campaigns/${campaign.id}/edit`}>
                      Edit campaign
                    </Link>
                  </Button>
                  <Button asChild>
                    <Link to={`/influencer-campaigns/${campaign.id}`}>
                      View campaign
                    </Link>
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              No influencer campaigns yet. Once campaigns are configured, they’ll
              appear here.
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
};

export default AdminInfluencerCampaigns;
