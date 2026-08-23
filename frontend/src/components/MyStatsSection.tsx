import { trpc } from "@/lib/trpc";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";

const numberFormatter = new Intl.NumberFormat("en-US");
const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

type StatKey = "posts" | "totalViews" | "totalEarnings";

interface StatConfig {
  key: StatKey;
  label: string;
  format: (value: number) => string;
}

const statsConfig: StatConfig[] = [
  {
    key: "posts",
    label: "Posts",
    format: (value: number) => numberFormatter.format(value),
  },
  {
    key: "totalViews",
    label: "Total Views",
    format: (value: number) => numberFormatter.format(value),
  },
];

export const MyStatsSection = () => {
  const { user } = useAuth();
  const isSignedIn = Boolean(user);

  const { data, isLoading, isError } = trpc.submissions.getMyStats.useQuery(
    undefined,
    {
      enabled: isSignedIn,
    }
  );

  const { data: earningsData, isLoading: isLoadingEarnings } =
    trpc.rewards.getMyTotalEarnings.useQuery(undefined, {
      enabled: isSignedIn,
    });

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-foreground">My Stats</h2>
          <p className="text-sm text-muted-foreground">
            Post clips and watch your stats grow.
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {isLoading && isSignedIn
          ? statsConfig.map((config) => (
              <div
                key={config.key}
                className="rounded-[24px] border border-border/50 bg-muted/40 p-6"
              >
                <Skeleton className="h-4 w-24" />
                <Skeleton className="mt-4 h-6 w-16" />
              </div>
            ))
          : statsConfig.map(({ key, label, format }) => {
              const rawValue = data?.[key] ?? 0;
              return (
                <div
                  key={key}
                  className="rounded-[24px] border border-border/50 bg-muted/40 p-6 shadow-sm"
                >
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                    {label}
                  </p>
                  <p className="mt-4 text-2xl font-semibold text-foreground">
                    {format(rawValue)}
                  </p>
                </div>
              );
            })}

        <div className="rounded-[24px] border border-border/50 bg-muted/40 p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Total Earned
          </p>
          <>
            {isLoadingEarnings && isSignedIn ? (
              <Skeleton className="mt-4 h-6 w-24" />
            ) : (
              <p className="mt-4 text-2xl font-semibold text-foreground">
                {currencyFormatter.format(earningsData ?? 0)}
              </p>
            )}
          </>
        </div>
      </div>

      {isError ? (
        <p className="text-sm text-destructive">
          Failed to load your stats. Please try again shortly.
        </p>
      ) : null}
    </section>
  );
};
