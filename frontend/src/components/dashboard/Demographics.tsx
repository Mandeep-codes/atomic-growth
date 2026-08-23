import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Users, Globe, Loader2 } from "lucide-react";
import { demographicSchema, DemographicData } from "@/shared/demographics";

type CampaignDemographics = DemographicData | null | undefined;

interface DemographicsProps {
  demographics?: unknown;
  isLoading?: boolean;
  visibleCountries?: string[] | null;
}

export const Demographics = ({
  demographics,
  isLoading = false,
  visibleCountries,
}: DemographicsProps) => {
  const parsedDemographics = useMemo<CampaignDemographics>(() => {
    if (!demographics) return null;
    const parsed = demographicSchema.safeParse(demographics);
    return parsed.success ? parsed.data : null;
  }, [demographics]);

  const sortedCountries = useMemo(() => {
    if (!parsedDemographics?.countries) return [];
    const sorted = [...parsedDemographics.countries].sort(
      (a, b) => b.percentage - a.percentage
    );
    if (!visibleCountries || visibleCountries.length === 0) {
      return sorted;
    }
    const allowedCountries = new Set(visibleCountries);
    return sorted.filter((country) => allowedCountries.has(country.country));
  }, [parsedDemographics?.countries, visibleCountries]);

  const topCountries = sortedCountries.slice(0, 10);
  const remaining = Math.max(sortedCountries.length - topCountries.length, 0);
  const topCountry = topCountries[0];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5 text-primary" />
          Audience Demographics
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading demographics…
          </div>
        ) : topCountries.length > 0 ? (
          <div className="space-y-6">
            <div className="grid gap-4 rounded-lg bg-muted/60 p-4 sm:grid-cols-2">
              <div>
                <p className="text-xs uppercase text-muted-foreground">
                  Countries reported
                </p>
                <p className="text-2xl font-semibold">
                  {sortedCountries.length}
                </p>
              </div>
              {topCountry && (
                <div>
                  <p className="text-xs uppercase text-muted-foreground">
                    Top country
                  </p>
                  <p className="text-sm font-semibold">{topCountry.country}</p>
                  <p className="text-xs text-muted-foreground">
                    {topCountry.percentage.toFixed(1)}% share
                  </p>
                </div>
              )}
            </div>

            <div className="space-y-3">
              {topCountries.map((country) => (
                <div
                  key={country.country}
                  className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
                >
                  <div className="flex items-center gap-2">
                    <Globe className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="font-medium">{country.country}</span>
                  </div>
                  <Badge variant="secondary">
                    {country.percentage.toFixed(1)}%
                  </Badge>
                </div>
              ))}
            </div>

            {remaining > 0 && (
              <p className="text-xs text-muted-foreground">
                +{remaining} more {remaining === 1 ? "country" : "countries"} in
                the full report
              </p>
            )}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
            Demographics data has not been published for this campaign yet.
          </div>
        )}
      </CardContent>
    </Card>
  );
};
