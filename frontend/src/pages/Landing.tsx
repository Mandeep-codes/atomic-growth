import { TopNav } from "@/components/TopNav";
import { trpc } from "@/lib/trpc";
import { ArrowRight, Compass, LogIn } from "lucide-react";
import { Link } from "react-router-dom";

/**
 * The signed-out home screen: brand, and the only two things a visitor can do
 * — look at the campaigns, or sign in with Discord.
 *
 * Public on purpose. Everything on this page and on /explore reads
 * campaigns.getAll, which is a publicProcedure, so a visitor can see what is
 * running before they have an account. Nothing here exposes a private
 * campaign's budget or rates — getAll strips those server-side.
 */
const Landing = () => {
  const { data: campaigns } = trpc.campaigns.getAll.useQuery();
  // Platform-wide, including private campaigns. Falls back to the getAll maths
  // below while this is loading or if the backend predates the procedure, so
  // the page never shows an empty band.
  const { data: totals } = trpc.stats.getPublicTotals.useQuery();
  const liveCount = (campaigns ?? []).filter(
    (campaign) => campaign.active && !campaign.ended
  ).length;

  // Real numbers beat a slogan. Every clipping platform that recruits well
  // leads with what it has actually paid - Vues publishes total paid, approved
  // clips and top-earner figures publicly, and it is the strongest recruiting
  // tool the category has.
  //
  // Derived from campaigns.getAll, already loaded above, so this costs no extra
  // request and no backend work. achievementPercentage is the share of a bounty
  // already paid out, so budget x that = money actually delivered.
  //
  // SCOPE: getAll returns what THIS viewer may see, so signed out these are
  // public-campaign totals, not whole-platform ones. The copy says "across
  // public campaigns" for that reason - do not widen the claim without a
  // procedure that actually aggregates everything.
  const rows = campaigns ?? [];
  const totalPaid = rows.reduce(
    (sum, c) =>
      sum +
      ((Number(c.budget) || 0) * (Number(c.achievementPercentage) || 0)) / 100,
    0
  );
  const totalViews = rows.reduce((sum, c) => sum + (Number(c.totalViews) || 0), 0);
  const totalClips = rows.reduce(
    (sum, c) => sum + (Number(c.submissionCount) || Number(c.totalSubmissions) || 0),
    0
  );

  const compact = (n: number) =>
    n >= 1_000_000
      ? `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`
      : n >= 1_000
      ? `${Math.round(n / 1_000)}K`
      : String(n);

  const stats = [
    {
      label: "Paid to clippers",
      value: `$${compact(Math.round(totals?.totalPaid ?? totalPaid))}`,
    },
    { label: "Views tracked", value: compact(totals?.totalViews ?? totalViews) },
    {
      label: "Clips approved",
      value: compact(totals?.clipsApproved ?? totalClips),
    },
    {
      label: "Campaigns live",
      value: String(totals?.campaignsLive ?? liveCount),
    },
  ].filter((stat) => stat.value !== "0" && stat.value !== "$0");

  return (
    <div className="min-h-screen bg-background text-foreground">
      <TopNav showSidebarTrigger={false} />

      <main className="relative flex min-h-[calc(100vh-5rem)] flex-col items-center justify-center overflow-hidden px-6 py-16">
        {/* Background showreel.
            muted + playsInline are REQUIRED, not stylistic: every browser blocks
            autoplay on anything with audible sound, and without playsInline iOS
            Safari takes the video fullscreen on play.
            aria-hidden and no controls: it is decoration, so it stays out of the
            accessibility tree entirely.
            motion-reduce:hidden respects the OS "reduce motion" setting - the
            solid background shows through instead. */}
        <video
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 h-full w-full object-cover motion-reduce:hidden"
        >
          <source src="/atomic_demo_web.mp4" type="video/mp4" />
        </video>

        {/* Two layers so the copy stays legible over any frame: a flat scrim
            for overall contrast, and a vertical fade that anchors the text. */}
        <div aria-hidden="true" className="absolute inset-0 bg-background/25" />
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-gradient-to-b from-background/85 via-background/10 to-background/90"
        />

        <div className="relative z-10 flex w-full max-w-4xl flex-col items-center gap-6 text-center [text-shadow:0_2px_24px_rgba(0,0,0,0.75)]">
          <img
            src="/atomik.png"
            alt=""
            aria-hidden="true"
            className="h-24 w-24 object-contain drop-shadow-[0_0_40px_rgba(255,255,255,0.15)] invert dark:invert-0 sm:h-32 sm:w-32"
          />

          <h1 className="display-heading text-5xl leading-none sm:text-7xl lg:text-8xl">
            Atomik Clips
          </h1>

          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            Get paid for the views your clips get. No follower minimum.
          </p>

          {stats.length ? (
            <div className="grid w-full grid-cols-2 gap-3 pt-2 sm:grid-cols-4">
              {stats.map((stat) => (
                <div
                  key={stat.label}
                  className="rounded-2xl border border-border bg-card px-4 py-4"
                >
                  <div className="font-mono text-2xl font-bold leading-none">
                    {stat.value}
                  </div>
                  <div className="mt-2 font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
                    {stat.label}
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground/70">
            Across public campaigns
          </p>

          <div className="flex w-full flex-col items-center justify-center gap-4 pt-4 sm:w-auto sm:flex-row">
            <Link
              to="/explore"
              className="group flex w-full items-center justify-center gap-3 rounded-2xl bg-foreground px-8 py-4 font-mono text-xs font-extrabold uppercase tracking-[0.18em] text-background shadow-2xl transition-all duration-200 hover:opacity-90 active:scale-95 sm:w-auto"
            >
              <Compass className="h-4 w-4 transition-transform duration-300 group-hover:rotate-45" />
              <span>Browse campaigns</span>
              <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
            </Link>

            {/* Straight into the onboarding flow — Discord is its first step,
                so this is the same door, just with the rest of setup behind
                it rather than dropping people on a bare dashboard. */}
            <Link
              to="/onboarding"
              className="flex w-full items-center justify-center gap-3 rounded-2xl border border-border bg-card px-8 py-4 font-mono text-xs font-extrabold uppercase tracking-[0.18em] text-foreground shadow-xl transition-all duration-200 hover:border-foreground/40 active:scale-95 sm:w-auto"
            >
              <LogIn className="h-4 w-4 text-muted-foreground" />
              <span>Sign up / Discord login</span>
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
};

export default Landing;
