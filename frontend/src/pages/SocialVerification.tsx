import { AppLayout, useInsideAppLayout } from "@/components/AppLayout";
import { VerificationCard } from "@/components/VerificationCard";
import { Instagram, Music2, Twitter, Youtube } from "lucide-react";

const SocialVerification = () => {
  // The dashboard renders this page inline under its own "Connected accounts"
  // heading, which meant two stacked titles for the same block — "Connected
  // accounts" immediately followed by "Social verification". When nested, the
  // page drops its header and lets the dashboard's stand.
  const nested = useInsideAppLayout();

  const platforms = [
    { platform: "instagram" as const, name: "Instagram", icon: Instagram },
    { platform: "youtube" as const, name: "YouTube", icon: Youtube },
    { platform: "x" as const, name: "X", icon: Twitter },
    { platform: "tiktok" as const, name: "TikTok", icon: Music2 },
  ];

  return (
    <AppLayout>
      <div className="mx-auto max-w-7xl space-y-8 px-6 py-4">
        {!nested ? (
          <header className="space-y-2">
            <h1 className="display-heading text-3xl sm:text-4xl">
              Connected accounts
            </h1>
            <p className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
              Verify your accounts to start submitting clips
            </p>
          </header>
        ) : null}

        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          {platforms.map((platform) => (
            <VerificationCard
              key={platform.platform}
              platform={platform.platform}
              platformName={platform.name}
              platformIcon={platform.icon}
            />
          ))}
        </div>

        <div className="rounded-3xl border border-border/60 bg-card p-6">
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
            Why verify
          </p>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Verifying proves you own the account, which is what stops someone
            else submitting clips as you. It is required before you can submit
            to a campaign, and you can verify as many accounts per platform as
            you like.
          </p>
        </div>
      </div>
    </AppLayout>
  );
};

export default SocialVerification;
