import { FormEvent, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { trpc } from "@/lib/trpc";
import { useRole } from "@/hooks/useRole";
import {
  Loader2,
  ExternalLink,
  PieChart as PieChartIcon,
  Eye,
  EyeOff,
} from "lucide-react";
import { demographicSchema } from "@/shared/demographics";
import { AdminInfluencerCampaignMetricsDialog } from "./AdminInfluencerCampaignMetricsDialog";
import {
  ResponsiveContainer,
  PieChart as RechartsPieChart,
  Pie,
  Cell,
  Tooltip,
} from "recharts";

const formatDate = (value: Date | string | null | undefined) => {
  if (!value) return "No end date";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "Invalid date";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

const parseDemographics = (value: unknown) => {
  if (!value) return null;
  const parsed = demographicSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
};

const TWITTER_PAGE_SIZE = 10;
const LINKEDIN_PAGE_SIZE = 10;

export const AdminInfluencerCampaignDetails = () => {
  const { campaignId } = useParams();
  const {
    data,
    isLoading,
    isError,
  } = trpc.influencerSubmissions.getCampaignDetails.useQuery(
    { campaignId: campaignId ?? "" },
    { enabled: Boolean(campaignId) }
  );
  const verifyCampaignPassword =
    trpc.influencerSubmissions.verifyCampaignPassword.useMutation();
  const { roles, isRolesLoaded } = useRole();
  const hasOverrideAccess = roles.includes("submission-reviewer");

  const totals = data?.totals;
  const [metricsModal, setMetricsModal] = useState<{
    open: boolean;
    platform: "twitter" | "linkedin";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    submission: any;
  }>({ open: false, platform: "twitter", submission: null });
  const [twitterPage, setTwitterPage] = useState(0);
  const [linkedinPage, setLinkedinPage] = useState(0);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    setTwitterPage(0);
  }, [data?.twitter.length]);

  useEffect(() => {
    setLinkedinPage(0);
  }, [data?.linkedin.length]);

  useEffect(() => {
    setIsUnlocked(false);
    setPassword("");
    setPasswordError(null);
    setShowPassword(false);
  }, [campaignId]);

  useEffect(() => {
    if (hasOverrideAccess) {
      setIsUnlocked(true);
      return;
    }

    if (data?.campaign?.hasPassword === false) {
      setIsUnlocked(true);
    }
  }, [data?.campaign?.hasPassword, hasOverrideAccess]);

  const handlePasswordSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPasswordError(null);

    if (!campaignId) {
      setPasswordError("Campaign ID missing");
      return;
    }

    if (!password.trim()) {
      setPasswordError("Enter the password to continue.");
      return;
    }

    try {
      const result = await verifyCampaignPassword.mutateAsync({
        campaignId,
        password,
      });

      if (result.valid) {
        setIsUnlocked(true);
        setPassword("");
      } else {
        setPasswordError("Incorrect password. Try again.");
      }
    } catch (error) {
      setPasswordError(
        error instanceof Error ? error.message : "Unable to verify password"
      );
    }
  };

  const renderDemographics = (
    submission:
      | (typeof data.twitter)[number]
      | (typeof data.linkedin)[number]
  ) => {
    const demographics = parseDemographics(submission.demographicsParsed);
    if (!demographics) {
      return <span className="text-xs text-muted-foreground">No upload</span>;
    }

    const sorted = [...demographics.countries].sort(
      (a, b) => b.percentage - a.percentage
    );
    const top = sorted[0];

    return (
      <div className="space-y-1 text-xs">
        {top ? (
          <div className="flex items-center justify-between">
            <span>{top.country}</span>
            <span className="text-muted-foreground">{top.percentage}%</span>
          </div>
        ) : null}
        <p className="text-muted-foreground">
          {demographics.countries.length} countries
        </p>
        {submission.demographicsScreenshotUrl ? (
          <a
            href={submission.demographicsScreenshotUrl}
            target="_blank"
            rel="noreferrer"
            className="text-primary underline"
          >
            View screenshot
          </a>
        ) : null}
      </div>
    );
  };

  let body: React.ReactNode;

  if (isLoading) {
    body = (
      <div className="flex justify-center py-20">
        <span className="inline-flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading campaign…
        </span>
      </div>
    );
  } else if (isError || !data) {
    body = (
      <Card>
        <CardContent className="py-8 text-center text-sm text-destructive">
          Unable to load this campaign. Please try again.
        </CardContent>
      </Card>
    );
  } else {
    const campaignDemographics = parseDemographics(data.campaign.demographics);
    const twitterPageCount = Math.max(
      1,
      Math.ceil(data.twitter.length / TWITTER_PAGE_SIZE)
    );
    const safeTwitterPage = Math.min(twitterPage, twitterPageCount - 1);
    const twitterPageData = data.twitter.slice(
      safeTwitterPage * TWITTER_PAGE_SIZE,
      safeTwitterPage * TWITTER_PAGE_SIZE + TWITTER_PAGE_SIZE
    );
    const linkedinPageCount = Math.max(
      1,
      Math.ceil(data.linkedin.length / LINKEDIN_PAGE_SIZE)
    );
    const safeLinkedinPage = Math.min(linkedinPage, linkedinPageCount - 1);
    const linkedinPageData = data.linkedin.slice(
      safeLinkedinPage * LINKEDIN_PAGE_SIZE,
      safeLinkedinPage * LINKEDIN_PAGE_SIZE + LINKEDIN_PAGE_SIZE
    );

    const showTwitterAggregate = (totals?.twitter?.impressions ?? 0) > 0;
    const showLinkedinAggregate = (totals?.linkedin?.impressions ?? 0) > 0;

    body = (
      <div className="mx-auto my-6 grid gap-6 px-3 lg:px-10 lg:grid-cols-2">

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{data.campaign.title}</CardTitle>
              {data.campaign.end_date && <CardDescription>
                Ends: <span className="font-medium">{formatDate(data.campaign.end_date ?? null)}</span>
              </CardDescription>}
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-xs uppercase text-muted-foreground">Total posts</p>
                <p className="text-2xl font-semibold">
                  {data.twitter.length + data.linkedin.length}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase text-muted-foreground">
                  Total impressions
                </p>
                <p className="text-2xl font-semibold">
                  {(totals?.totalImpressions ?? 0).toLocaleString()}
                </p>
              </div>
            </CardContent>
          </Card>
          {showTwitterAggregate ? (
            <PlatformAggregateCard
              title="X aggregate"
              metrics={[
                { label: "Impressions", value: totals?.twitter?.impressions ?? 0 },
                { label: "Replies", value: totals?.twitter?.replies ?? 0 },
                { label: "Quotes", value: totals?.twitter?.quotes ?? 0 },
                { label: "Retweets", value: totals?.twitter?.retweets ?? 0 },
                { label: "Bookmarks", value: totals?.twitter?.bookmarks ?? 0 },
              ]}
            />
          ) : null}

          {showLinkedinAggregate ? (
            <PlatformAggregateCard
              title="LinkedIn aggregate"
              metrics={[
                { label: "Impressions", value: totals?.linkedin?.impressions ?? 0 },
                { label: "Likes", value: totals?.linkedin?.likes ?? 0 },
                { label: "Comments", value: totals?.linkedin?.comments ?? 0 },
                { label: "Reposts", value: totals?.linkedin?.reposts ?? 0 },
              ]}
            />
          ) : null}

          <CampaignDemographicsCard demographics={campaignDemographics} />
        </div>

        <div className="space-y-6">
          <div className="grid gap-6">
            {data.twitter.length > 0 ? (
              <Card className="overflow-hidden">
                <CardHeader>
                  <CardTitle>X submissions</CardTitle>
                  <CardDescription>Individual X/Twitter posts.</CardDescription>
                </CardHeader>
                <CardContent className="px-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="min-w-[160px]">Handle</TableHead>
                          <TableHead className="hidden sm:table-cell">Link</TableHead>
                          <TableHead className="hidden sm:table-cell">Impressions</TableHead>
                          <TableHead className="hidden sm:table-cell">Likes</TableHead>
                          <TableHead className="w-[120px]">Details</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.twitter.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={4} className="py-6 text-center text-sm">
                              No Twitter submissions yet.
                            </TableCell>
                          </TableRow>
                        ) : (
                          twitterPageData.map((submission) => (
                            <TableRow key={submission.id}>
                              <TableCell>@{submission.handle}</TableCell>
                              <TableCell className="hidden sm:table-cell">
                                <a
                                  href={submission.link}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1 text-primary underline"
                                >
                                  View
                                  <ExternalLink className="h-3.5 w-3.5" />
                                </a>
                              </TableCell>
                              <TableCell className="hidden sm:table-cell">
                                {submission.impressions.toLocaleString()}
                              </TableCell>
                              <TableCell className="hidden sm:table-cell">
                                {submission.favoriteCount.toLocaleString()}
                              </TableCell>
                              <TableCell>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() =>
                                    setMetricsModal({
                                      open: true,
                                      platform: "twitter",
                                      submission,
                                    })
                                  }
                                >
                                  Details
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                  {data.twitter.length > TWITTER_PAGE_SIZE ? (
                    <div className="flex items-center justify-between border-t px-4 py-3 text-xs text-muted-foreground">
                      <span>
                        Page {safeTwitterPage + 1} of {twitterPageCount}
                      </span>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setTwitterPage((prev) => Math.max(prev - 1, 0))}
                          disabled={safeTwitterPage === 0}
                        >
                          Previous
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            setTwitterPage((prev) =>
                              Math.min(prev + 1, twitterPageCount - 1)
                            )
                          }
                          disabled={safeTwitterPage >= twitterPageCount - 1}
                        >
                          Next
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            ) : null}

            {data.linkedin.length > 0 ? (
              <Card className="overflow-hidden">
                <CardHeader>
                  <CardTitle>LinkedIn submissions</CardTitle>
                  <CardDescription>Individual LinkedIn posts.</CardDescription>
                </CardHeader>
                <CardContent className="px-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="min-w-[160px]">Handle</TableHead>
                          <TableHead className="hidden sm:table-cell">Link</TableHead>
                          <TableHead className="hidden sm:table-cell">Impressions</TableHead>
                          <TableHead className="hidden sm:table-cell">Likes</TableHead>
                          <TableHead className="w-[120px]">Details</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {linkedinPageData.map((submission) => (
                          <TableRow key={submission.id}>
                            <TableCell>@{submission.handle}</TableCell>
                            <TableCell className="hidden sm:table-cell">
                              <a
                                href={submission.link}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-primary underline"
                              >
                                View
                                <ExternalLink className="h-3.5 w-3.5" />
                              </a>
                            </TableCell>
                            <TableCell className="hidden sm:table-cell">
                              {submission.impressions.toLocaleString()}
                            </TableCell>
                            <TableCell className="hidden sm:table-cell">
                              {submission.likes.toLocaleString()}
                            </TableCell>
                            <TableCell>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                  setMetricsModal({
                                    open: true,
                                    platform: "linkedin",
                                    submission,
                                  })
                                }
                              >
                                Details
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  {data.linkedin.length > LINKEDIN_PAGE_SIZE ? (
                    <div className="flex items-center justify-between border-t px-4 py-3 text-xs text-muted-foreground">
                      <span>
                        Page {safeLinkedinPage + 1} of {linkedinPageCount}
                      </span>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setLinkedinPage((prev) => Math.max(prev - 1, 0))}
                          disabled={safeLinkedinPage === 0}
                        >
                          Previous
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            setLinkedinPage((prev) =>
                              Math.min(prev + 1, linkedinPageCount - 1)
                            )
                          }
                          disabled={safeLinkedinPage >= linkedinPageCount - 1}
                        >
                          Next
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            ) : null}
          </div>
        </div>



      </div>
    );
  }

  const shouldShowPasswordGate =
    !isLoading &&
    !isError &&
    Boolean(data?.campaign?.hasPassword) &&
    !isUnlocked &&
    !hasOverrideAccess;

  // Closes the modal more elegantly
  useEffect(() => {
    if (!metricsModal.open) {
      const timeout = window.setTimeout(() => {
        setMetricsModal((prev) => ({ ...prev, submission: null }));
      }, 200);

      return () => window.clearTimeout(timeout);
    }

    return undefined;
  }, [metricsModal.open]);

  if (!isRolesLoaded) {
    return (
      <AppLayout>
        <div className="flex justify-center py-20">
          <span className="inline-flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" /> Loading…
          </span>
        </div>
      </AppLayout>
    );
  }

  if (shouldShowPasswordGate) {
    return (
      <AppLayout>
        <div className="mx-auto flex min-h-[60vh] max-w-lg flex-col justify-center gap-6 px-6 py-10">
          <div className="space-y-2 text-center">
            <h2 className="text-2xl font-semibold text-foreground">
              Enter Password
            </h2>
            <p className="text-sm text-muted-foreground">
              Enter the password provided by the campaign owner to view live
              performance data.
            </p>
          </div>
          <form
            onSubmit={handlePasswordSubmit}
            className="space-y-4 rounded-2xl border border-border/70 bg-card/80 p-6 shadow-sm"
          >
            <div className="space-y-2">
              <Label htmlFor="campaign-password">Password</Label>
              <div className="relative">
                <Input
                  id="campaign-password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  autoComplete="current-password"
                  onChange={(event) => setPassword(event.target.value)}
                  disabled={verifyCampaignPassword.isPending}
                />
                <button
                  type="button"
                  className="absolute inset-y-0 right-3 flex items-center text-muted-foreground"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={
                    showPassword
                      ? "Hide campaign password"
                      : "Show campaign password"
                  }
                  disabled={verifyCampaignPassword.isPending}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
              {passwordError && (
                <p className="text-sm text-destructive">{passwordError}</p>
              )}
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={verifyCampaignPassword.isPending}
            >
              {verifyCampaignPassword.isPending ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" /> Unlocking…
                </span>
              ) : (
                "Unlock dashboard"
              )}
            </Button>
          </form>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      {body}
      <AdminInfluencerCampaignMetricsDialog
        open={metricsModal.open}
        onOpenChange={(open) =>
          setMetricsModal((prev) => ({ ...prev, open }))
        }
        platform={metricsModal.platform}
        submission={metricsModal.submission}
      />
    </AppLayout>
  );
};

export default AdminInfluencerCampaignDetails;

const chartColorVariables = [
  "--chart-1",
  "--chart-2",
  "--chart-3",
  "--chart-4",
  "--chart-5",
];

const PlatformAggregateCard = ({
  title,
  metrics,
}: {
  title: string;
  metrics: { label: string; value: number }[];
}) => (
  <Card>
    <CardHeader>
      <CardTitle className="text-base">{title}</CardTitle>
    </CardHeader>
    <CardContent className="grid gap-3 sm:grid-cols-2">
      {metrics.map((metric) => (
        <div key={metric.label}>
          <p className="text-[0.65rem] uppercase tracking-wide text-muted-foreground">
            {metric.label}
          </p>
          <p className="text-lg font-semibold">
            {metric.value.toLocaleString()}
          </p>
        </div>
      ))}
    </CardContent>
  </Card>
);

type ChartSlice = {
  key: string;
  label: string;
  value: number;
  color: string;
};

const CampaignDemographicsCard = ({
  demographics,
}: {
  demographics: ReturnType<typeof parseDemographics>;
}) => {
  const chartData: ChartSlice[] = useMemo(() => {
    if (!demographics?.countries?.length) return [];
    const sorted = [...demographics.countries].sort(
      (a, b) => b.percentage - a.percentage
    );
    const topSlices = sorted.slice(0, 5);
    const remainder = sorted
      .slice(5)
      .reduce((sum, item) => sum + item.percentage, 0);

    const slices = topSlices.map((country, index) => ({
      key: `${country.country}-${index}`,
      label: country.country,
      value: Number(country.percentage.toFixed(2)),
    }));

    if (remainder > 0) {
      slices.push({
        key: "other",
        label: "Other",
        value: Number(remainder.toFixed(2)),
      });
    }

    return slices.map((slice, index) => {
      const paletteIndex = index % chartColorVariables.length;
      const variable = chartColorVariables[paletteIndex];
      const color =
        slice.label === "Other"
          ? "hsl(var(--muted-foreground))"
          : `hsl(var(${variable}))`;
      return { ...slice, color };
    });
  }, [demographics?.countries]);

  const totalCountries = demographics?.countries?.length ?? 0;
  const hasData = chartData.length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PieChartIcon className="h-5 w-5 text-primary" />
          Demographics
        </CardTitle>
      </CardHeader>
      <CardContent>
        {hasData ? (
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center">
            <div className="h-64 w-full lg:flex-1">
              <ResponsiveContainer width="100%" height="100%">
                <RechartsPieChart>
                  <Pie
                    data={chartData}
                    dataKey="value"
                    nameKey="label"
                    innerRadius={70}
                    outerRadius={100}
                    stroke="hsl(var(--background))"
                    strokeWidth={1.5}
                    paddingAngle={2}
                  >
                    {chartData.map((slice) => (
                      <Cell key={slice.key} fill={slice.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value: number | string, name) => [
                      `${Number(value).toFixed(1)}%`,
                      name as string,
                    ]}
                    contentStyle={{
                      borderRadius: 12,
                      borderColor: "hsl(var(--border))",
                      backgroundColor: "hsl(var(--card))",
                      color: "hsl(var(--foreground))",
                    }}
                  />
                </RechartsPieChart>
              </ResponsiveContainer>
            </div>
            <div className="w-full space-y-3 lg:w-1/3">
              {chartData.map((slice) => (
                <div
                  key={slice.key}
                  className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: slice.color }}
                    />
                    <span>{slice.label}</span>
                  </div>
                  <span className="font-semibold">
                    {slice.value.toFixed(1)}%
                  </span>
                </div>
              ))}
              <p className="text-xs text-muted-foreground">
                {totalCountries > 0
                  ? `${totalCountries} countries reported`
                  : "No audience insights uploaded yet."}
              </p>
            </div>
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
