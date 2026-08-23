import { useMemo, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { Loader2, LineChart as LineChartIcon } from "lucide-react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Metric = "views" | "submissions";
type Fidelity = "all" | "daily";

const metricCopy: Record<Metric, { label: string; helper: string }> = {
  views: {
    label: "Views delivered",
    helper: "Total views recorded on approved submissions",
  },
  submissions: {
    label: "Approved submissions",
    helper: "Number of live submissions contributing to the campaign",
  },
};

const formatNumber = (value: number) => {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString();
};

const formatDateLabel = (iso: string) => {
  const date = new Date(iso);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
};

export const SubmissionTrends = ({ campaignId }: { campaignId: string }) => {
  const [activeMetric, setActiveMetric] = useState<Metric>("views");
  const [fidelity, setFidelity] = useState<Fidelity>("daily");
  const { data, isLoading, error } =
    trpc.campaigns.getSubmissionSnapshots.useQuery(
      { campaignId },
      { enabled: Boolean(campaignId) }
    );

  const series =
    activeMetric === "views" ? data?.views ?? [] : data?.submissions ?? [];
  // Total-submissions series is only shown on the "submissions" tab — it's
  // the cumulative count of all submissions (pending + approved + rejected)
  // at each snapshot timestamp, derived from submissions.created_at.
  const totalSeries =
    activeMetric === "submissions" ? data?.totalSubmissions ?? [] : [];

  const collapseToDaily = <T extends { capturedAt: string }>(rows: T[]) => {
    if (fidelity === "all") return rows;
    const byDay = new Map<string, T>();
    for (const point of rows) {
      const dayKey = point.capturedAt.slice(0, 10);
      const current = byDay.get(dayKey);
      if (!current || current.capturedAt < point.capturedAt) {
        byDay.set(dayKey, point);
      }
    }
    return Array.from(byDay.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([, value]) => value);
  };

  const fidelitySeries = useMemo(() => collapseToDaily(series), [series, fidelity]);
  const fidelityTotalSeries = useMemo(
    () => collapseToDaily(totalSeries),
    [totalSeries, fidelity]
  );

  const chartData = useMemo(() => {
    // Merge the two series by capturedAt so each x-axis label has both
    // approved and total values when available.
    const totalsByCaptured = new Map(
      fidelityTotalSeries.map((p) => [p.capturedAt, p.value])
    );
    return fidelitySeries.map((point) => ({
      label: formatDateLabel(point.capturedAt),
      approved: point.value,
      total:
        activeMetric === "submissions"
          ? totalsByCaptured.get(point.capturedAt) ?? null
          : null,
      rawDate: point.capturedAt,
    }));
  }, [fidelitySeries, fidelityTotalSeries, activeMetric]);

  const lastPoint = chartData.at(-1);

  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle className="flex items-center gap-2">
          <LineChartIcon className="h-5 w-5 text-primary" />
          Submission trends
        </CardTitle>
        <CardDescription>
          Monitor how approved submissions and their total views evolve over
          time.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading trend data…
          </div>
        ) : error ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            Unable to load submission trends: {error.message}
          </div>
        ) : chartData.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            We have not captured any submission snapshots yet. Once views are
            refreshed, this chart will populate automatically.
          </div>
        ) : (
          <Tabs
            value={activeMetric}
            onValueChange={(value) => setActiveMetric(value as Metric)}
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <TabsList className="h-auto bg-muted/60">
                  <TabsTrigger value="views" className="px-4">
                    Views
                  </TabsTrigger>
                  <TabsTrigger value="submissions" className="px-4">
                    Submissions
                  </TabsTrigger>
                </TabsList>
                <Select
                  value={fidelity}
                  onValueChange={(value) => setFidelity(value as Fidelity)}
                >
                  <SelectTrigger className="w-[140px]">
                    <SelectValue placeholder="All snapshots" />
                  </SelectTrigger>
                  <SelectContent align="end">
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="daily">Daily</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="text-right text-xs text-muted-foreground">
                <p className="font-medium text-foreground">
                  {metricCopy[activeMetric].label}
                </p>
                <p>{metricCopy[activeMetric].helper}</p>
                {lastPoint && (
                  <p>Updated {new Date(lastPoint.rawDate).toLocaleString()}</p>
                )}
              </div>
            </div>

            <div className="h-64">
              <ResponsiveContainer>
                <LineChart
                  data={chartData}
                  margin={{ top: 16, right: 16, left: 0, bottom: 8 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="hsl(var(--border))"
                  />
                  <XAxis
                    dataKey="label"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    className="text-xs text-muted-foreground"
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value) => formatNumber(Number(value))}
                    width={60}
                    className="text-xs text-muted-foreground"
                  />
                  <Tooltip
                    // Match the tooltip row label to the actual line via
                    // dataKey (stable; the displayed `name` prop is mixed
                    // case and easy to typo). Without this, both rows in
                    // the tooltip showed the same label.
                    formatter={(
                      value: number | string,
                      _name: string,
                      item: { dataKey?: string | number }
                    ) => [
                      formatNumber(Number(value)),
                      item?.dataKey === "approved"
                        ? activeMetric === "submissions"
                          ? "Approved submissions"
                          : metricCopy[activeMetric].label
                        : "Total submissions",
                    ]}
                    // Order tooltip rows by value descending so the line
                    // that's visually higher at the hovered x-position is
                    // listed first — flips automatically if approved
                    // overtakes total at some point.
                    itemSorter={(item: { value?: number | string }) =>
                      -Number(item?.value ?? 0)
                    }
                    labelFormatter={(label) => label}
                    contentStyle={{
                      borderRadius: 12,
                      borderColor: "hsl(var(--border))",
                      backgroundColor: "hsl(var(--card))",
                      color: "hsl(var(--foreground))",
                    }}
                  />
                  {activeMetric === "submissions" ? (
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                  ) : null}
                  <Line
                    type="monotone"
                    dataKey="approved"
                    name={
                      activeMetric === "submissions"
                        ? "Approved"
                        : metricCopy[activeMetric].label
                    }
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    dot={{ r: 2 }}
                    activeDot={{ r: 4 }}
                  />
                  {activeMetric === "submissions" ? (
                    <Line
                      type="monotone"
                      dataKey="total"
                      name="Total (incl. pending + rejected)"
                      stroke="hsl(var(--muted-foreground))"
                      strokeDasharray="5 3"
                      strokeWidth={2}
                      dot={{ r: 2 }}
                      activeDot={{ r: 4 }}
                    />
                  ) : null}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Tabs>
        )}
      </CardContent>
    </Card>
  );
};
