import { Badge, Card, Label, Loading } from "@/components/ds";
import { useAuth } from "@/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Check, Instagram, Music2, Plus, Twitter, Youtube } from "lucide-react";
import { Link } from "react-router-dom";

// ─────────────────────────────────────────────────────────────────────────────
// CONNECTED ACCOUNTS
//
// One row per platform the app supports, with its state and the connect
// action. The action is a LINK INTO THE EXISTING FLOW:
//
//     /verification/flow?platform=<platform>
//
// which is the exact href VerificationCard.tsx:303 already uses. Nothing here
// initialises, verifies or removes an account — the bio-code flow, the OAuth
// paths, the one-account-per-handle rule and the shared-account allowlist all
// stay where they are and run unchanged.
//
// Accounts come from privateCampaigns.myVerifiedAccounts, whose filter is
// `verified = true AND deleted_at IS NULL AND account_deleted_at IS NULL` —
// deliberately the same filter the private-campaign apply mutation re-checks,
// so "connected" here means the same thing it means when eligibility is
// decided.
// ─────────────────────────────────────────────────────────────────────────────

const PLATFORMS = [
  { id: "youtube", name: "YouTube", icon: Youtube },
  { id: "instagram", name: "Instagram", icon: Instagram },
  { id: "tiktok", name: "TikTok", icon: Music2 },
  { id: "x", name: "X", icon: Twitter },
] as const;

export const ConnectedAccounts = () => {
  const { user } = useAuth();
  const accounts = trpc.privateCampaigns.myVerifiedAccounts.useQuery(
    undefined,
    { enabled: Boolean(user) }
  );

  if (!user) return null;
  if (accounts.isLoading) return <Loading label="Loading your accounts" />;

  const all = accounts.data ?? [];

  return (
    <div className="space-y-3">
      {PLATFORMS.map(({ id, name, icon: Icon }) => {
        const mine = all.filter(
          (a) => (a.platform ?? "").toLowerCase() === id
        );
        const connected = mine.length > 0;

        return (
          <Card key={id} className="p-5">
            <div className="flex flex-wrap items-center gap-4">
              <span
                className={cn(
                  "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border",
                  connected
                    ? "border-foreground/30 bg-muted"
                    : "border-border bg-muted/40"
                )}
              >
                <Icon
                  className={cn(
                    "h-5 w-5",
                    connected ? "text-foreground" : "text-muted-foreground"
                  )}
                />
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-base font-semibold">{name}</span>
                  {connected ? (
                    <Badge tone="positive">
                      <Check className="h-2.5 w-2.5" />
                      {mine.length} verified
                    </Badge>
                  ) : (
                    <Badge>Not connected</Badge>
                  )}
                </div>

                {connected ? (
                  <p className="mt-1 truncate text-[11px] text-muted-foreground">
                    {mine.map((a) => `@${a.handle}`).join(" · ")}
                  </p>
                ) : (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Verify an account to submit clips on {name}.
                  </p>
                )}
              </div>

              {/* The existing flow, entered exactly as VerificationCard does. */}
              <Link
                to={`/verification/flow?platform=${id}`}
                className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-border px-4 py-2.5 font-mono text-[10px] font-bold uppercase tracking-[0.16em] transition-colors hover:border-foreground/40"
              >
                <Plus className="h-3.5 w-3.5" />
                {connected ? "Add another" : "Connect"}
              </Link>
            </div>
          </Card>
        );
      })}

      <p className="text-[11px] text-muted-foreground">
        You can verify multiple accounts per platform. Removing an account is
        done from the full verification screen.
      </p>
    </div>
  );
};

export default ConnectedAccounts;
