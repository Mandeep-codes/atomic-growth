import { ReactNode } from "react";
import { useParams, Link } from "react-router-dom";
import { Loader2, Lock } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { SubmissionProvider } from "@/components/SubmissionProvider";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";

interface SubmissionFlowLayoutProps {
  children: ReactNode;
}

// Guards every submission step: a private campaign's submit flow is only
// reachable with an approved application. Direct links land on an
// "apply first" screen instead of a confusing form (the backend rejects
// the submission anyway — this is the friendly layer). `standalone` wraps
// the gate screens in AppLayout for pages outside this flow's layout.
export const PrivateCampaignGate = ({
  children,
  standalone = false,
}: {
  children: ReactNode;
  standalone?: boolean;
}) => {
  const { campaignId } = useParams();
  const wrap = (node: ReactNode) =>
    standalone ? (
      <AppLayout>
        <div className="mx-auto flex min-h-[calc(100vh-3.5rem)] w-full max-w-5xl flex-col items-center justify-center px-6 py-10">
          {node}
        </div>
      </AppLayout>
    ) : (
      <>{node}</>
    );
  const { data: campaign, isLoading: campaignLoading } =
    trpc.campaigns.getByIdPublic.useQuery(
      { id: campaignId ?? "" },
      { enabled: Boolean(campaignId) }
    );
  const isPrivate = campaign?.visibility === "private";
  const { data: applicationState, isLoading: applicationLoading } =
    trpc.privateCampaigns.getApplicationState.useQuery(
      { campaignId: campaignId ?? "" },
      { enabled: Boolean(campaignId) && isPrivate }
    );

  if (campaignLoading || (isPrivate && applicationLoading)) {
    return wrap(
      <div className="flex items-center gap-2 py-20 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" /> Loading campaign…
      </div>
    );
  }

  if (isPrivate && applicationState?.application?.status !== "approved") {
    return wrap(
      <div className="flex max-w-md flex-col items-center gap-4 py-20 text-center">
        <Lock className="h-10 w-10 text-muted-foreground" />
        <h2 className="text-xl font-semibold text-foreground">
          This is a private campaign
        </h2>
        <p className="text-sm text-muted-foreground">
          {applicationState?.application?.status === "pending"
            ? "Your application is still being reviewed. You'll be able to submit clips once a moderator approves you."
            : "You need to apply and be approved before you can submit clips here. Open the campaign card and apply with the accounts you'll clip from."}
        </p>
        <Button asChild className="rounded-full">
          <Link to="/campaigns/active">Back to campaigns</Link>
        </Button>
      </div>
    );
  }

  return <>{children}</>;
};

export const SubmissionFlowLayout = ({
  children,
}: SubmissionFlowLayoutProps) => {
  return (
    <AppLayout>
      <SubmissionProvider>
        <div className="mx-auto flex min-h-[calc(100vh-3.5rem)] w-full max-w-5xl flex-col items-center justify-center px-6 py-10">
          <PrivateCampaignGate>{children}</PrivateCampaignGate>
        </div>
      </SubmissionProvider>
    </AppLayout>
  );
};

export default SubmissionFlowLayout;
