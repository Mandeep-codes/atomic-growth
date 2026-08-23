import { Badge, Button, Card, Label } from "@/components/ds";
import { useToast } from "@/hooks/use-toast";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Clock,
  Link2,
  Lock,
  X,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";

// ─────────────────────────────────────────────────────────────────────────────
// CAMPAIGN ELIGIBILITY
//
// Presents the eligibility the server already enforces. It decides nothing:
// every gate below is re-checked by privateCampaigns.apply and, at the point
// that actually matters, by submissions.createSubmission
// (`submissions/index.ts:511-528`). This panel can only ever be a preview of
// that answer — it must never be the thing that lets someone through.
//
// Procedures used, unchanged:
//   privateCampaigns.getApplicationState → { application | null, unlocked | null }
//       `unlocked` is populated ONLY when status === "approved".
//   privateCampaigns.myVerifiedAccounts  → verified && !deleted && !account_deleted
//       Deliberately the same filter apply() re-checks.
//   privateCampaigns.apply               → { status: "pending" }, input is just
//       { campaignId }. THE APPLICATION COLLECTS NOTHING ELSE — one click, by
//       design: "Mods judge the clipper on their whole history."
//
// Server error strings are surfaced verbatim rather than reworded, so what a
// clipper reports matches what the code throws.
// ─────────────────────────────────────────────────────────────────────────────

type Props = {
  campaignId: string;
  isPrivate: boolean;
  ended: boolean;
};

const Row = ({
  ok,
  icon: Icon,
  children,
}: {
  ok: boolean | null;
  icon: typeof Check;
  children: React.ReactNode;
}) => (
  <li className="flex items-start gap-2.5 text-sm">
    <span
      className={cn(
        "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full",
        ok === true && "text-emerald-600 dark:text-emerald-400",
        ok === false && "text-destructive",
        ok === null && "text-muted-foreground"
      )}
    >
      <Icon className="h-3.5 w-3.5" />
    </span>
    <span className={cn(ok === false ? "text-foreground" : "text-foreground/80")}>
      {children}
    </span>
  </li>
);

export const EligibilityPanel = ({ campaignId, isPrivate, ended }: Props) => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const utils = trpc.useUtils();

  const state = trpc.privateCampaigns.getApplicationState.useQuery(
    { campaignId },
    { enabled: isPrivate && Boolean(campaignId) }
  );
  const accounts = trpc.privateCampaigns.myVerifiedAccounts.useQuery(
    undefined,
    { enabled: isPrivate }
  );

  const apply = trpc.privateCampaigns.apply.useMutation({
    onSuccess: () => {
      utils.privateCampaigns.getApplicationState.invalidate({ campaignId });
      toast({
        title: "Application sent",
        description: "A moderator will review it and you'll be notified.",
      });
    },
    // The server's message IS the explanation — PRECONDITION_FAILED for no
    // verified account, BAD_REQUEST for ended, and the already-applied cases.
    onError: (error) =>
      toast({
        title: "Could not apply",
        description: error.message,
        variant: "destructive",
      }),
  });

  // A public campaign has no application step at all.
  if (!isPrivate) return null;

  const application = state.data?.application ?? null;
  const unlocked = Boolean(state.data?.unlocked);
  const status = application?.status ?? null;
  const verifiedCount = accounts.data?.length ?? 0;
  const hasAccount = verifiedCount > 0;

  return (
    <Card className="space-y-4 p-5">
      <div className="flex items-center justify-between gap-3">
        <Label>Eligibility</Label>
        {unlocked ? (
          <Badge tone="positive">Approved</Badge>
        ) : status === "pending" ? (
          <Badge tone="warning">Under review</Badge>
        ) : status === "rejected" ? (
          <Badge tone="danger">Not approved</Badge>
        ) : (
          <Badge>
            <Lock className="h-2.5 w-2.5" /> Private
          </Badge>
        )}
      </div>

      {/* Requirements, in the order the server checks them. */}
      <ul className="space-y-2">
        <Row ok={!ended} icon={ended ? X : Check}>
          {ended ? "This campaign has ended." : "Campaign is open"}
        </Row>
        <Row
          ok={accounts.isLoading ? null : hasAccount}
          icon={hasAccount ? Check : Link2}
        >
          {accounts.isLoading
            ? "Checking your connected accounts…"
            : hasAccount
            ? `${verifiedCount} verified ${
                verifiedCount === 1 ? "account" : "accounts"
              } connected`
            : "Connect at least one social media account to your profile before applying."}
        </Row>
        <Row
          ok={unlocked ? true : status === "rejected" ? false : null}
          icon={unlocked ? Check : status === "pending" ? Clock : AlertTriangle}
        >
          {unlocked
            ? "A moderator approved you — you can submit clips."
            : status === "pending"
            ? "You've already applied — a moderator will review your application."
            : status === "rejected"
            ? application?.rejectedReason ||
              "Your application wasn't approved."
            : "Moderator approval required before you can submit."}
        </Row>
      </ul>

      {/* Action, matched to state. */}
      {ended ? null : unlocked ? (
        <Button block onClick={() => navigate(`/campaign/${campaignId}/submit`)}>
          Submit clip
          <ArrowRight className="h-4 w-4" />
        </Button>
      ) : status === "pending" ? (
        <Button block disabled>
          <Clock className="h-4 w-4" />
          Waiting on review
        </Button>
      ) : !hasAccount ? (
        <Button variant="secondary" block asChild={false} onClick={() => navigate("/verification")}>
          Connect an account
          <ArrowRight className="h-4 w-4" />
        </Button>
      ) : (
        <>
          <Button
            block
            loading={apply.isPending}
            onClick={() => apply.mutate({ campaignId })}
          >
            {status === "rejected" ? "Apply again" : "Apply to this campaign"}
            <ArrowRight className="h-4 w-4" />
          </Button>
          {/* One click, no form — stated so nobody hunts for fields. */}
          <p className="text-center text-[11px] text-muted-foreground">
            One click. Moderators review your whole clipping history, so there
            is nothing to fill in.
          </p>
        </>
      )}

      {!hasAccount && !accounts.isLoading ? (
        <Link
          to="/verification"
          className="block text-center font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground underline underline-offset-4 hover:text-foreground"
        >
          Manage verified accounts
        </Link>
      ) : null}
    </Card>
  );
};

export default EligibilityPanel;
