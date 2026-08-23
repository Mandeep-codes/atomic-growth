import {
  CheckCircle2,
  Clock,
  Loader2,
  Lock,
  MessageCircle,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { useToast } from "@/hooks/use-toast";
import { trackEvent } from "@/lib/analytics";

// The OAuth callback popup is served by the BACKEND, so its postMessage arrives
// with the backend's origin — that's what we must validate against (not the
// SPA origin). Derived from the tRPC URL the app already talks to.
const CALLBACK_ORIGIN = (() => {
  try {
    return new URL(import.meta.env.VITE_TRPC_URL as string).origin;
  } catch {
    return window.location.origin;
  }
})();

type ApplicationState = {
  application: {
    id: string;
    status: string;
    rejectedReason: string | null;
    discordJoinMethod: string | null;
    discordInviteUrl: string | null;
    discordJoinedAt: Date | string | null;
    accounts: { verifiedUserId: string; platform: string; handle: string }[];
  } | null;
};

interface PrivateCampaignApplySectionProps {
  campaignId: string;
  campaignTitle: string | null;
  // Kept for compatibility with the caller; no longer used now that applying
  // is one click with no account selection.
  campaignPlatforms: string | null;
  applicationState: ApplicationState | undefined;
  isLoading: boolean;
  onApplied: () => void;
}

export const PrivateCampaignApplySection = ({
  campaignId,
  campaignTitle,
  applicationState,
  isLoading,
  onApplied,
}: PrivateCampaignApplySectionProps) => {
  const { toast } = useToast();

  // Applying requires at least one verified account on the profile — the
  // reviewing mod judges applicants by their real accounts.
  const accountsQuery = trpc.privateCampaigns.myVerifiedAccounts.useQuery();
  const hasConnectedAccount = (accountsQuery.data ?? []).length > 0;

  const applyMutation = trpc.privateCampaigns.apply.useMutation({
    onSuccess: () => {
      trackEvent({
        event: "private_campaign_applied",
        properties: { campaignId, campaignTitle },
      });
      toast({
        title: "Application submitted",
        description: "A moderator will review it — you'll get a notification.",
      });
      onApplied();
    },
    onError: (e) =>
      toast({
        title: "Couldn't submit application",
        description: e.message,
        variant: "destructive",
      }),
  });

  const application = applicationState?.application ?? null;

  // ── Discord one-click join (Path B) ──
  const isApproved = application?.status === "approved";
  const joinStatusQuery =
    trpc.privateCampaigns.getDiscordJoinStatus.useQuery(undefined, {
      enabled: isApproved,
    });
  const authorizeUrlMutation =
    trpc.privateCampaigns.getDiscordJoinAuthorizeUrl.useMutation();
  const joinMutation = trpc.privateCampaigns.joinPrivateDiscord.useMutation();
  const [joining, setJoining] = useState(false);

  const attemptJoin = async (): Promise<"joined" | "needs_auth"> => {
    const res = await joinMutation.mutateAsync({ campaignId });
    if (res.status === "joined") {
      toast({
        title: "You're in!",
        description:
          "Added to the private Discord server — find it in your server list.",
      });
      onApplied();
      joinStatusQuery.refetch();
    }
    return res.status;
  };

  // One-time consent runs in a popup; the backend callback postMessages back.
  const waitForConsent = (popup: Window | null) =>
    new Promise<boolean>((resolve) => {
      let settled = false;
      let poll: ReturnType<typeof setInterval> | undefined;
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        window.removeEventListener("message", onMessage);
        if (poll) clearInterval(poll);
        resolve(ok);
      };
      const onMessage = (event: MessageEvent) => {
        // Only trust messages from the backend that served the OAuth callback.
        if (event.origin !== CALLBACK_ORIGIN) return;
        if (event.data?.type !== "discord-join") return;
        if (event.data.success) finish(true);
        else {
          toast({
            title: "Couldn't connect Discord",
            description: String(event.data.error ?? "Please try again."),
            variant: "destructive",
          });
          finish(false);
        }
      };
      window.addEventListener("message", onMessage);
      // Popup blocked, or closed/cancelled before finishing → fail fast instead
      // of leaving the button spinning until the 5-min timeout.
      poll = setInterval(() => {
        if (!popup || popup.closed) finish(false);
      }, 500);
      setTimeout(() => finish(false), 5 * 60 * 1000);
    });

  const handleJoinClick = async () => {
    setJoining(true);
    try {
      if ((await attemptJoin()) === "needs_auth") {
        const { authorizeUrl } = await authorizeUrlMutation.mutateAsync();
        // No noopener — the callback needs window.opener to message us back.
        const popup = window.open(
          authorizeUrl,
          "discord-join",
          "width=500,height=850"
        );
        if (await waitForConsent(popup)) await attemptJoin();
      }
    } catch (error) {
      toast({
        title: "Join failed",
        description:
          error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setJoining(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-6 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading application…
      </div>
    );
  }

  // ── Approved ──
  if (application?.status === "approved") {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 rounded-2xl border border-green-500/30 bg-green-500/10 px-4 py-3">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-green-600" />
          <div>
            <p className="text-sm font-semibold text-green-700">
              You're in! Your application was approved.
            </p>
            <p className="text-xs text-muted-foreground">
              You can submit clips from any of your connected accounts.
            </p>
          </div>
        </div>
        {joinStatusQuery.data?.configured ? (
          application.discordJoinMethod === "oauth" &&
          application.discordJoinedAt ? (
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-border/60 bg-muted/30 px-4 py-3">
              <p className="text-sm text-muted-foreground">
                You've been added to the{" "}
                <span className="font-semibold text-foreground">
                  private Discord server
                </span>{" "}
                — find it in your server list. Not there?
              </p>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 rounded-full"
                onClick={handleJoinClick}
                disabled={joining}
              >
                {joining ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : null}
                Re-join
              </Button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-border/60 bg-muted/30 px-4 py-3">
              <p className="text-sm text-muted-foreground">
                Join the private Discord server — one click, and{" "}
                <span className="font-semibold text-foreground">
                  only your linked Discord account
                </span>{" "}
                can get in. Nothing to share or that expires.
              </p>
              <Button
                size="sm"
                className="shrink-0 rounded-full"
                onClick={handleJoinClick}
                disabled={joining}
              >
                {joining ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : null}
                {joinStatusQuery.data.hasGrant
                  ? "Join server"
                  : "Enable one-click join"}
              </Button>
            </div>
          )
        ) : (
          <p className="text-xs text-muted-foreground">
            Your private Discord access is being set up — check back shortly.
          </p>
        )}
      </div>
    );
  }

  // ── Pending ──
  if (application?.status === "pending") {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
          <Clock className="h-5 w-5 shrink-0 text-amber-600" />
          <div>
            <p className="text-sm font-semibold text-amber-700">
              Application pending review
            </p>
            <p className="text-xs text-muted-foreground">
              A moderator usually reviews within ~24 hours — you'll get a
              notification when it's decided.
            </p>
          </div>
        </div>

        {/* Set the expectation up front: joining the Discord happens right here,
            with a button, once they're approved — so they come back for it. */}
        <div className="rounded-2xl border border-border/60 bg-muted/30 px-4 py-3">
          <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <MessageCircle className="h-4 w-4" /> Come back here to join the
            Discord
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Once you're approved, reopen this campaign and tap the button below.
            You'll be added to the private Discord server in{" "}
            <span className="font-semibold text-foreground">one click</span>,
            using the Discord account linked to your profile — nothing to share,
            lose, or that expires.
          </p>
          <Button
            size="sm"
            disabled
            className="mt-3 rounded-full"
            title="Unlocks once your application is approved"
          >
            <Lock className="mr-1 h-3.5 w-3.5" />
            Enable one-click join
          </Button>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Unlocks after approval.
          </p>
        </div>
      </div>
    );
  }

  // ── Not applied yet (or rejected → re-apply) ──
  return (
    <div className="space-y-4">
      {application?.status === "rejected" && (
        <div className="flex items-center gap-2 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3">
          <XCircle className="h-5 w-5 shrink-0 text-red-600" />
          <div>
            <p className="text-sm font-semibold text-red-700">
              Your previous application wasn't approved
            </p>
            {application.rejectedReason && (
              <p className="text-xs text-muted-foreground">
                Reason: {application.rejectedReason}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              You can apply again below.
            </p>
          </div>
        </div>
      )}

      <div className="space-y-2">
        <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Lock className="h-4 w-4" /> This is a private campaign
        </p>
        <p className="text-sm text-muted-foreground">
          Apply in one click. A moderator will review your track record and
          approve or reject your application. Once you're approved, you can post
          from any of your connected accounts.
        </p>
      </div>

      {!accountsQuery.isLoading && !hasConnectedAccount && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
          <p className="text-sm font-semibold text-amber-700">
            Connect an account first
          </p>
          <p className="text-xs text-muted-foreground">
            You need at least one verified social media account on your
            profile to apply — that's what the moderator reviews. Connect one
            on the{" "}
            <Link to="/verification" className="underline underline-offset-2">
              verification page
            </Link>{" "}
            and come back.
          </p>
        </div>
      )}

      <Button
        className="h-12 w-full rounded-full text-base font-semibold shadow-md"
        disabled={
          applyMutation.isPending ||
          accountsQuery.isLoading ||
          !hasConnectedAccount
        }
        onClick={() => applyMutation.mutate({ campaignId })}
      >
        {applyMutation.isPending ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Submitting…
          </>
        ) : (
          "Apply"
        )}
      </Button>
    </div>
  );
};

export default PrivateCampaignApplySection;
