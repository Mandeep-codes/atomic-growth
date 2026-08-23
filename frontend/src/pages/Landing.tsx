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
  const liveCount = (campaigns ?? []).filter(
    (campaign) => campaign.active && !campaign.ended
  ).length;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <TopNav showSidebarTrigger={false} />

      <main className="flex min-h-[calc(100vh-5rem)] flex-col items-center justify-center px-6 py-16">
        <div className="flex w-full max-w-4xl flex-col items-center gap-6 text-center">
          <img
            src="/atomik.png"
            alt=""
            aria-hidden="true"
            className="h-24 w-24 object-contain drop-shadow-[0_0_40px_rgba(255,255,255,0.15)] invert dark:invert-0 sm:h-32 sm:w-32"
          />

          <h1 className="display-heading text-5xl leading-none sm:text-7xl lg:text-8xl">
            Atomik Clips
          </h1>

          {liveCount > 0 ? (
            <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
              {liveCount} {liveCount === 1 ? "campaign" : "campaigns"} live now
            </p>
          ) : null}

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
