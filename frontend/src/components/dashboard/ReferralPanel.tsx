import { Badge, Button, Card, Label, Loading, Numeric, Stat } from "@/components/ds";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { trpc } from "@/lib/trpc";
import { Check, Copy, Gift, Share2, Users } from "lucide-react";
import { useState } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// REFERRALS
//
// Presentation over the existing referral system. Procedures, unchanged:
//   referrals.getMyReferralCode   → { code, createdAt, shareCardUrl } | null
//                                   (null means "not created yet", not an error)
//   referrals.getMyReferredUsers  → who signed up with the code
//   referrals.getMyReferralStatus → who referred THIS clipper, and the boost
//   referrals.createReferralCode  → mints the code
//
// Nothing here calculates the boost, decides eligibility, or writes a code by
// any other route. The share/copy behaviour mirrors the existing page,
// including the detail that a cancelled native share (AbortError) is silent
// rather than an error.
// ─────────────────────────────────────────────────────────────────────────────

export const ReferralPanel = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const enabled = Boolean(user);
  const [copied, setCopied] = useState(false);

  const codeQuery = trpc.referrals.getMyReferralCode.useQuery(undefined, {
    enabled,
  });
  const referred = trpc.referrals.getMyReferredUsers.useQuery(undefined, {
    enabled,
  });

  const create = trpc.referrals.createReferralCode.useMutation({
    onSuccess: async (result) => {
      toast({
        title: "Referral code created",
        description: `Your code ${result.code} is ready to share.`,
      });
      await codeQuery.refetch();
    },
    onError: (error) =>
      toast({
        title: "Couldn't create your code",
        description: error.message,
        variant: "destructive",
      }),
  });

  if (!user) return null;
  if (codeQuery.isLoading) return <Loading label="Loading your referral code" />;

  const code = codeQuery.data?.code ?? null;
  const link = code
    ? `${window.location.origin}/?ref=${encodeURIComponent(code)}`
    : null;
  const count = referred.data?.length ?? 0;

  const copy = async (value: string, label: string) => {
    if (!navigator.clipboard) {
      toast({
        title: "Clipboard unavailable",
        description: "Copy this manually from the text field.",
        variant: "destructive",
      });
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
      toast({ title: `${label} copied`, description: value });
    } catch {
      toast({
        title: "Copy failed",
        description: "Please try again.",
        variant: "destructive",
      });
    }
  };

  const share = async () => {
    if (!link) return;
    if (!navigator.share) return copy(link, "Referral link");
    try {
      await navigator.share({
        title: "Join me on Atomik Clips",
        text: "Use my referral link to sign up",
        url: link,
      });
      toast({ title: "Referral link shared" });
    } catch (error) {
      // A cancelled share is not a failure — same as the existing page.
      if (error instanceof Error && error.name === "AbortError") return;
      toast({
        title: "Share unavailable",
        description: "Copy the link instead.",
        variant: "destructive",
      });
      copy(link, "Referral link");
    }
  };

  return (
    <Card className="space-y-5 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-muted">
            <Gift className="h-4 w-4" />
          </span>
          <div>
            <Label>Refer a clipper</Label>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Earn 10% of what they make.
            </p>
          </div>
        </div>
        {count > 0 ? (
          <Badge tone="positive">
            <Users className="h-2.5 w-2.5" /> {count} referred
          </Badge>
        ) : null}
      </div>

      {code ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <code className="flex-1 truncate rounded-xl border border-border bg-muted/40 px-4 py-3 font-mono text-base font-bold tracking-wider">
              {code}
            </code>
            <Button
              variant="secondary"
              onClick={() => copy(code, "Referral code")}
            >
              {copied ? (
                <Check className="h-4 w-4" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
              Copy
            </Button>
            <Button onClick={share}>
              <Share2 className="h-4 w-4" />
              Share
            </Button>
          </div>

          {link ? (
            <p className="truncate font-mono text-[10px] text-muted-foreground">
              {link}
            </p>
          ) : null}

          <div className="grid grid-cols-2 gap-3 border-t border-border pt-4">
            <Stat
              label="Clippers referred"
              value={<Numeric size="sm">{count}</Numeric>}
            />
            <Stat
              label="Your share"
              value={<Numeric size="sm">10%</Numeric>}
              hint="of their earnings"
            />
          </div>
        </>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            You haven't created a referral code yet.
          </p>
          <Button
            block
            loading={create.isPending}
            onClick={() => create.mutate()}
          >
            Generate referral code
          </Button>
        </div>
      )}
    </Card>
  );
};

export default ReferralPanel;
