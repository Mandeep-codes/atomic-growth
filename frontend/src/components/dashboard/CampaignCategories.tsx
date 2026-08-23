import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Tag, ArrowRight } from "lucide-react";
import { useCampaignCategories } from "@/hooks/useCampaignCategories";
import { Link } from "react-router-dom";

export const CampaignCategories = ({ campaignId }: { campaignId: string }) => {
  const {
    data: categories,
    isLoading,
    error,
  } = useCampaignCategories(campaignId);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Tag className="h-5 w-5 text-primary" />
            Campaign Categories
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin" />
        </CardContent>
      </Card>
    );
  }

  if (error || !categories) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Tag className="h-5 w-5 text-primary" />
            Campaign Categories
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center py-8">
          <p className="text-muted-foreground">Failed to load categories</p>
        </CardContent>
      </Card>
    );
  }

  if (categories.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Tag className="h-5 w-5 text-primary" />
          Campaign Categories
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {categories.map((category) => (
            <Button
              key={category.id}
              variant="outline"
              className="h-auto p-4 flex items-center justify-between hover:bg-primary/10 hover:border-primary/50"
              asChild
            >
              <Link
                to={`/campaign/${campaignId}/category/${encodeURIComponent(
                  category.category
                )}`}
              >
                <Badge variant="secondary">{category.category}</Badge>
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
              </Link>
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};
