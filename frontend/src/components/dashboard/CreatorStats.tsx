import { Card, Label, Loading, Numeric, SectionTitle } from "@/components/ds";
import { useAuth } from "@/hooks/useAuth";
import { formatCurrency } from "@/lib/formatCurrency";
import { trpc } from "@/lib/trpc";
import { Coins, Eye, Layers, Video } from "lucide-react";
import { useMemo } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// CREATOR STATISTICS
//
// Four figures, all from procedures that already exist. Nothing is recomputed:
//
//   clips submitted  submissions.getMyStats  → posts
//   total views      submissions.getMyStats  → totalViews
//                    (already net of frozen views from deleted clips — that
//                     subtraction happens server-side, not here)
//   total revenue    rewards.getMyEarnings   → totalEarned
//   campaigns joined DERIVED: distinct campaign ids across the clipper's own
//                    submissions. There is no procedure that returns this —
//                    getMyStats does not include it — so it is counted from
//                    getMySubmissions, which the app already fetches. Counting
//                    distinct ids in a list is presentation, not a new metric,
//                    but it is worth knowing it is derived rather than served.
// ─────────────────────────────────────────────────────────────────────────────

const nf = new Intl.NumberFormat("en-US");

const StatCard = ({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof Eye;
  label: string;
  value: React.ReactNode;
  hint?: string;
}) => (
  <Card className="space-y-4 p-5">
    <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-muted">
      <Icon className="h-4 w-4" />
    </span>
    <div className="space-y-1">
      <Label>{label}</Label>
      <Numeric size="lg">{value}</Numeric>
      {hint ? (
        <span className="block text-[11px] text-muted-foreground">{hint}</span>
      ) : null}
    </div>
  </Card>
);

export const CreatorStats = () => {
  const { user } = useAuth();
  const enabled = Boolean(user);

  const stats = trpc.submissions.getMyStats.useQuery(undefined, { enabled });
  const earnings = trpc.rewards.getMyEarnings.useQuery(undefined, { enabled });
  const submissions = trpc.submissions.getMySubmissions.useQuery(undefined, {
    enabled,
  });

  const campaignsJoined = useMemo(() => {
    const rows = submissions.data ?? [];
    const ids = new Set<string>();
    for (const row of rows as Array<{ campaign_id?: string | null }>) {
      if (row.campaign_id) ids.add(row.campaign_id);
    }
    return ids.size;
  }, [submissions.data]);

  if (!enabled) return null;

  const loading = stats.isLoading || earnings.isLoading;

  return (
    <section className="space-y-6">
      <SectionTitle>Creator stats</SectionTitle>

      {loading ? (
        <Loading label="Loading your stats" />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            icon={Layers}
            label="Campaigns joined"
            value={
              submissions.isLoading ? "—" : nf.format(campaignsJoined)
            }
          />
          <StatCard
            icon={Eye}
            label="Views generated"
            value={nf.format(Number(stats.data?.totalViews ?? 0))}
            hint="excludes views on deleted clips"
          />
          <StatCard
            icon={Video}
            label="Clips submitted"
            value={nf.format(Number(stats.data?.posts ?? 0))}
          />
          <StatCard
            icon={Coins}
            label="Revenue earned"
            value={formatCurrency(Number(earnings.data?.totalEarned ?? 0))}
            hint="all time"
          />
        </div>
      )}
    </section>
  );
};

export default CreatorStats;
