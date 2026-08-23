#!/usr/bin/env bash
# Atomik Clips — calm down the Social Verification screen.
# Run from the frontend/ directory:   bash apply-verification-ui.sh
set -euo pipefail

if [ ! -f package.json ] || [ ! -d src/components ]; then
  echo "ERROR: run this from the frontend/ directory (the one with package.json)."
  exit 1
fi

echo "Backing up -> *.bak"
for f in src/components/VerificationCard.tsx src/pages/SocialVerification.tsx; do
  [ -f "$f" ] && cp "$f" "$f.bak"
done
echo

echo "writing src/components/VerificationCard.tsx"
mkdir -p "src/components"
cat > src/components/VerificationCard.tsx << 'ATOMIK_EOF'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { trackEvent } from "@/lib/analytics";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import {
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  MoreHorizontal,
  Plus,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

interface VerificationCardProps {
  platform: "youtube" | "instagram" | "tiktok" | "x";
  platformName: string;
  platformIcon: LucideIcon;
  className?: string;
}

type VerifiedAccount = {
  id: string;
  handle: string;
  created_at: Date;
  login_creds_email?: string | null;
  login_creds_password?: string | null;
  login_cred_forwarding_email?: string | null;
};

interface VerifiedAccountRowProps {
  account: VerifiedAccount;
  isRemoving: boolean;
  onRemove: (account: VerifiedAccount) => void;
}

/**
 * One connected account.
 *
 * Was an accordion whose expanded body was, for most accounts, nothing but a
 * full-width destructive button — so every row rendered a red bar, and with
 * every row expanded by default a clipper with six channels met six of them
 * stacked down the page. Destroying a connection was the loudest and most
 * reachable thing on the screen, and adding one was the quietest.
 *
 * Now: a plain row. Remove lives in the ⋯ menu behind the same confirm dialog
 * it always had, and the primary action on the card is Add. Login credentials
 * still show, but only for the accounts that have them, and only on request —
 * a password should not be sitting on screen by default.
 */
const VerifiedAccountRow = ({
  account,
  isRemoving,
  onRemove,
}: VerifiedAccountRowProps) => {
  const [showCreds, setShowCreds] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const email = account.login_creds_email ?? undefined;
  const password = account.login_creds_password ?? undefined;
  const forwarding = account.login_cred_forwarding_email ?? undefined;
  const hasCreds = Boolean(email || password || forwarding);

  return (
    <li
      className={cn(
        "rounded-xl border border-border/60 bg-muted/20 transition-opacity",
        isRemoving && "opacity-50"
      )}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        {/* The only colour left on the row. A dot carries "verified" as well
            as a tinted card, badge and two icons did, without repainting
            everything around it. */}
        <span
          aria-hidden="true"
          className="h-2 w-2 shrink-0 rounded-full bg-emerald-400 ring-4 ring-emerald-400/15"
        />

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">
            @{account.handle}
          </p>
          <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            Verified {new Date(account.created_at).toLocaleDateString()}
            {hasCreds ? " · login saved" : ""}
          </p>
        </div>

        {isRemoving ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={`Options for @${account.handle}`}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              {hasCreds ? (
                <>
                  <DropdownMenuItem
                    className="cursor-pointer text-sm"
                    onSelect={(e) => {
                      e.preventDefault();
                      setShowCreds((v) => !v);
                    }}
                  >
                    <KeyRound className="mr-2 h-4 w-4 text-muted-foreground" />
                    {showCreds ? "Hide login details" : "Show login details"}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              ) : null}
              <DropdownMenuItem
                className="cursor-pointer text-sm text-destructive focus:text-destructive"
                onSelect={() => onRemove(account)}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Remove account
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {showCreds && hasCreds ? (
        <div className="space-y-3 border-t border-border/60 px-4 py-3">
          {email ? (
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                Login email
              </p>
              <p className="break-all font-mono text-sm text-foreground">
                {email}
              </p>
            </div>
          ) : null}

          {password ? (
            <div>
              <div className="flex items-center gap-1.5">
                <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  Password
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowPassword((v) => !v)}
                >
                  {showPassword ? (
                    <EyeOff className="h-3.5 w-3.5" />
                  ) : (
                    <Eye className="h-3.5 w-3.5" />
                  )}
                  <span className="sr-only">
                    {showPassword ? "Hide" : "Show"} password
                  </span>
                </Button>
              </div>
              <p className="break-all font-mono text-sm text-foreground">
                {showPassword ? password : "••••••••••••"}
              </p>
            </div>
          ) : null}

          {forwarding ? (
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                Forwarding email
              </p>
              <p className="break-all font-mono text-sm text-foreground">
                {forwarding}
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
};

export const VerificationCard = ({
  platform,
  platformName,
  platformIcon,
  className,
}: VerificationCardProps) => {
  const Icon = platformIcon;
  const { toast } = useToast();
  const [removingAccountId, setRemovingAccountId] = useState<string | null>(
    null
  );
  const [accountToRemove, setAccountToRemove] = useState<{
    id: string;
    handle: string;
  } | null>(null);

  const {
    data: verificationStatus,
    refetch: refetchVerification,
    isLoading: isStatusLoading,
  } = trpc.verification.checkVerification.useQuery({ platform });

  const removeVerificationMutation =
    trpc.verification.removeVerification.useMutation();

  const handleRemoveAccount = async (accountId: string, handle: string) => {
    trackEvent({
      event: "social_verification_remove_account_clicked",
      properties: { platform, accountId, handle },
    });
    setRemovingAccountId(accountId);
    try {
      await removeVerificationMutation.mutateAsync({ id: accountId });
      toast({
        title: "Account removed",
        description: `@${handle} has been disconnected.`,
      });
      await refetchVerification();
      trackEvent({
        event: "social_verification_remove_account_result",
        properties: { platform, accountId, handle, status: "success" },
      });
    } catch (error) {
      toast({
        title: "Unable to remove account",
        description:
          error instanceof Error ? error.message : "Please try again shortly.",
        variant: "destructive",
      });
      trackEvent({
        event: "social_verification_remove_account_result",
        properties: {
          platform,
          accountId,
          handle,
          status: "error",
          errorMessage:
            error instanceof Error ? error.message : "Unknown error",
        },
      });
    } finally {
      setRemovingAccountId(null);
    }
  };

  const accounts = verificationStatus?.verified
    ? verificationStatus.verifiedAccounts ?? []
    : [];

  return (
    <Card className={cn("rounded-3xl border-border/60", className)}>
      <CardHeader>
        <div className="flex items-center gap-3">
          {/* Squared tile, not a circle — the redesign uses rounded squares for
              every platform/campaign mark. */}
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border/60 bg-muted/60 text-foreground">
            <Icon className="h-5 w-5" />
          </span>
          <div>
            <CardTitle className="display-heading text-xl">
              {platformName}
            </CardTitle>
            <CardDescription className="font-mono text-[10px] uppercase tracking-[0.14em]">
              {isStatusLoading
                ? "Fetching status…"
                : accounts.length > 0
                ? `${accounts.length} account${
                    accounts.length !== 1 ? "s" : ""
                  } connected`
                : "Not connected"}
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {isStatusLoading ? (
          <div className="space-y-2">
            {[1, 2].map((key) => (
              <div
                key={key}
                className="h-14 w-full animate-pulse rounded-xl bg-muted/60"
              />
            ))}
          </div>
        ) : accounts.length > 0 ? (
          // overflow-y-auto, not -scroll: a permanent scrollbar gutter was
          // showing on cards with two accounts that never needed to scroll.
          <ul className="max-h-[420px] space-y-2 overflow-y-auto">
            {accounts.map((account) => (
              <VerifiedAccountRow
                key={account.id}
                account={account}
                isRemoving={removingAccountId === account.id}
                onRemove={(acct) =>
                  setAccountToRemove({ id: acct.id, handle: acct.handle })
                }
              />
            ))}
          </ul>
        ) : (
          <p className="rounded-xl border border-dashed border-border/60 px-4 py-6 text-center text-sm text-muted-foreground">
            No {platformName} account connected yet.
          </p>
        )}

        {/* The inverted CTA the redesign uses for every primary action. This is
            the action people come to this card for, so it stays the loudest
            thing on it. */}
        <Link
          to={`/verification/flow?platform=${platform}`}
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-foreground py-3.5 font-mono text-xs font-extrabold uppercase tracking-[0.18em] text-background transition-transform duration-200 hover:scale-[0.98]"
        >
          <Plus className="h-4 w-4" />
          Add account
        </Link>
      </CardContent>

      <AlertDialog
        open={Boolean(accountToRemove)}
        onOpenChange={(open) => {
          if (!open) setAccountToRemove(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this connected account?</AlertDialogTitle>
            <AlertDialogDescription>
              {accountToRemove
                ? `This will disconnect @${accountToRemove.handle} from Atomik Clips. Clips already submitted from it keep earning. You can re-verify it later.`
                : "This will disconnect the selected account from Atomik Clips."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removingAccountId !== null}>
              Keep account
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (!accountToRemove) return;
                const { id, handle } = accountToRemove;
                setAccountToRemove(null);
                await handleRemoveAccount(id, handle);
              }}
              disabled={removingAccountId !== null}
            >
              Remove account
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
};
ATOMIK_EOF

echo "writing src/pages/SocialVerification.tsx"
mkdir -p "src/pages"
cat > src/pages/SocialVerification.tsx << 'ATOMIK_EOF'
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
ATOMIK_EOF


echo
echo "--- verify (each should print OK) ---"
check () { if grep -q "$2" "$1" 2>/dev/null; then echo "OK    $1"; else echo "FAIL  $1"; fi; }
check src/components/VerificationCard.tsx "Options for @"
check src/pages/SocialVerification.tsx    "useInsideAppLayout"
echo
echo "--- these should print 0 ---"
echo -n 'destructive full-width buttons: '
grep -c 'variant="destructive"' src/components/VerificationCard.tsx || true
echo -n 'emerald tinting:                '
grep -c 'emerald-50\|emerald-200\|emerald-700\|emerald-900' src/components/VerificationCard.tsx || true
echo
echo "Vite will hot-reload. If not: rm -rf node_modules/.vite && pnpm dev"
