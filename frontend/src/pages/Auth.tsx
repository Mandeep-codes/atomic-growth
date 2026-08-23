import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  SignedIn,
  SignedOut,
  SignInButton,
  SignUpButton,
} from "@clerk/clerk-react";
import { Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import type { LucideIcon } from "lucide-react";
import { CalendarPlus, Wallet, BarChart3 } from "lucide-react";

const differentiators: Array<{
  title: string;
  description: string;
  icon: LucideIcon;
}> = [
    {
      title: "Campaigns every month",
      description:
        "New creator campaigns roll out regularly, so there's always something active to clip and post.",
      icon: CalendarPlus,
    },
    // {
    //   title: "Track earnings in real time",
    //   description:
    //     "See exactly how much you've earned across campaigns with our rewards engine.",
    //   icon: Wallet,
    // },
    {
      title: "Daily views and earnings updates",
      description:
        "Rewards are calculated daily, so you always know where you stand — no guesswork.",
      icon: Wallet,
    },
  ];

const stats = [
  // { value: "Rewards", label: "Over $55k in rewards paid out" },
  // { value: "Views", label: "Over 10M views generated" },
];

const AuthPanel = () => (
  <Card>
    <CardHeader className="text-center">
      <CardTitle className="text-2xl">
        <span className="bg-gradient-to-r from-indigo-400 to-purple-400 dark:from-indigo-300 dark:to-purple-300 bg-clip-text text-transparent">
          Atomik
        </span>
        <span className="text-foreground ml-2">Clips</span>
      </CardTitle>
      <CardDescription>Sign in to access Atomik Clips</CardDescription>
    </CardHeader>

    <CardContent className="space-y-4">
      <SignedOut>
        <div className="space-y-3">
          <SignInButton mode="redirect">
            <button className="w-full bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2 rounded-md font-medium transition-colors">
              Sign In
            </button>
          </SignInButton>
          <SignUpButton mode="redirect">
            <button className="w-full border border-input bg-background hover:bg-accent hover:text-accent-foreground h-10 px-4 py-2 rounded-md font-medium transition-colors">
              Sign Up
            </button>
          </SignUpButton>
        </div>
      </SignedOut>

      <SignedIn>
        <div className="text-center text-muted-foreground">
          You are already signed in. Redirecting...
        </div>
      </SignedIn>
    </CardContent>
    <CardFooter className="flex-col space-y-1 text-center text-xs text-muted-foreground">
      <span>By continuing you agree to our</span>
      <Link to="/privacy" className="text-primary underline-offset-4 hover:underline">
        Privacy Policy
      </Link>
    </CardFooter>
  </Card>
);

const Auth = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirectUrl = searchParams.get("redirect");

  // Redirect authenticated users to campaigns page or redirect URL
  useEffect(() => {
    if (user) {
      navigate(redirectUrl || "/");
    }
  }, [user, navigate, redirectUrl]);

  return (
    <div className="relative min-h-screen bg-background">
      <div className="pointer-events-none absolute inset-0 -z-10 opacity-60">
        <div className="absolute left-1/2 top-0 h-96 w-96 -translate-x-1/2 rounded-full bg-purple-500/30 blur-[120px]" />
        <div className="absolute bottom-0 right-0 h-72 w-72 translate-x-1/3 rounded-full bg-indigo-500/20 blur-[120px]" />
      </div>
      <div className="relative mx-auto flex min-h-screen max-w-6xl flex-col justify-center px-6 py-12">
        <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,0.8fr)]">
          <div className="order-2 space-y-8 lg:order-1">

            <div className="space-y-4">
              <h1 className="text-4xl font-bold leading-tight tracking-tight text-foreground sm:text-5xl">
                Get paid for posting content on social media.
              </h1>
              <p className="text-lg text-muted-foreground">
                Turn short-form posts into real payouts from brands and campaigns.
              </p>
            </div>

            <div className="lg:hidden">
              <div className="w-full rounded-3xl bg-white/80 p-1 shadow-xl backdrop-blur dark:bg-slate-900/60">
                <AuthPanel />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {differentiators.map((item) => (
                <div
                  key={item.title}
                  className="rounded-xl border border-white/10 bg-background/80 p-4 shadow-sm backdrop-blur"
                >
                  <item.icon className="h-6 w-6 text-primary" />
                  <h3 className="mt-3 text-base font-semibold text-foreground">
                    {item.title}
                  </h3>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {item.description}
                  </p>
                </div>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {stats.map((stat) => (
                <div
                  key={stat.label}
                  className="rounded-xl border border-dashed border-white/15 bg-white/60 p-4 text-center shadow dark:bg-white/5"
                >
                  <p className="text-2xl font-semibold text-foreground">
                    {stat.value}
                  </p>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    {stat.label}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="hidden w-full max-w-md justify-self-center rounded-3xl bg-white/80 p-1 shadow-xl backdrop-blur dark:bg-slate-900/60 lg:block">
            <AuthPanel />
          </div>
        </div>
      </div>
    </div>
  );
};

export default Auth;
