import { useMemo } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { trpc } from "@/lib/trpc";
import { AppLayout } from "@/components/AppLayout";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { LucideIcon } from "lucide-react";
import { Loader2, Youtube, Instagram, Video } from "lucide-react";
import DemographicsVerificationScreenshot from "./DemographicsVerificationScreenshot";
import DemographicsVerificationYouTube from "./DemographicsVerificationYouTube";
import DemographicsVerificationInstagram from "./DemographicsVerificationInstagram";
import { AlertTriangle } from "lucide-react";

type VerificationMethod = "api" | "screenshot" | "exemption";

interface VerificationOption {
  id: VerificationMethod;
  title: string;
  description: string;
  badge?: string;
  icon: LucideIcon;
}

const youtubeVerificationOptions: VerificationOption[] = [
  {
    id: "api",
    title: "Connect your YouTube account",
    description: "Securely share your channel's analytics via the YouTube API.",
    badge: "Recommended",
    icon: Youtube,
  },
  {
    id: "screenshot",
    title: "Submit a screen recording",
    description:
      "Record your screen showing today's date and your YouTube Studio analytics. Upload to YouTube as Unlisted and paste the link — a moderator will review.",
    icon: Video,
  },
  {
    id: "exemption",
    title: "Request Exemption",
    description:
      "Request an exemption if you don't have audience demographics on your account yet.",
    icon: AlertTriangle,
  },
];

const instagramVerificationOptions: VerificationOption[] = [
  {
    id: "api",
    title: "Connect your Instagram account",
    description: "Securely share your audience insights via the Instagram API.",
    badge: "Recommended",
    icon: Instagram,
  },
  {
    id: "screenshot",
    title: "Submit a screen recording",
    description:
      "Record your screen showing today's date and your Instagram analytics dashboard. Upload to YouTube as Unlisted and paste the link — a moderator will review.",
    icon: Video,
  },
  {
    id: "exemption",
    title: "Request Exemption",
    description:
      "Request an exemption if you don't have audience demographics on your account yet.",
    icon: AlertTriangle,
  },
];

const screenshotVerificationOptions: VerificationOption[] = [
  {
    id: "screenshot",
    title: "Submit a screen recording",
    description:
      "Record your screen showing today's date and your platform's analytics dashboard. Upload to YouTube as Unlisted and paste the link — a moderator will review.",
    icon: Video,
  },
  {
    id: "exemption",
    title: "Request Exemption",
    description:
      "Request an exemption if you don't have audience demographics on your account yet.",
    icon: AlertTriangle,
  },
];

const VerificationMethodSelect = ({
  onSelect,
  options,
  description,
}: {
  onSelect: (method: VerificationMethod) => void;
  options: VerificationOption[];
  description: string;
}) => (
  <AppLayout>
    <div className="min-h-screen bg-muted/40 py-10 px-4">
      <div className="mx-auto max-w-3xl">
        <Card className="w-full">
          <CardHeader>
            <CardTitle>Select how you want to verify</CardTitle>
            <CardDescription>{description}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {options.map((option) => {
              const Icon = option.icon;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => onSelect(option.id)}
                  className="flex flex-col gap-3 rounded-lg border bg-card p-4 text-left shadow-sm transition hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <Icon className="h-5 w-5" />
                      </span>
                      <div>
                        <p className="font-semibold text-foreground">
                          {option.title}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {option.description}
                        </p>
                      </div>
                    </div>
                    {option.badge ? (
                      <Badge
                        variant="secondary"
                        className="shrink-0 hidden md:block"
                      >
                        {option.badge}
                      </Badge>
                    ) : null}
                  </div>
                </button>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </div>
  </AppLayout>
);

const YoutubeVerificationMethodSelect = ({
  onSelect,
}: {
  onSelect: (method: VerificationMethod) => void;
}) => (
  <VerificationMethodSelect
    onSelect={onSelect}
    options={youtubeVerificationOptions}
    description="Connect your YouTube account automatically, submit a screen recording for moderator review, or request an exemption if demographics aren't available yet."
  />
);

const InstagramVerificationMethodSelect = ({
  onSelect,
}: {
  onSelect: (method: VerificationMethod) => void;
}) => (
  <VerificationMethodSelect
    onSelect={onSelect}
    options={instagramVerificationOptions}
    description="Connect your Instagram account automatically, submit a screen recording for moderator review, or request an exemption if demographics aren't available yet."
  />
);

const ScreenshotVerificationMethodSelect = ({
  onSelect,
}: {
  onSelect: (method: VerificationMethod) => void;
}) => (
  <VerificationMethodSelect
    onSelect={onSelect}
    options={screenshotVerificationOptions}
    description="Submit a screen recording of your analytics for moderator review, or request an exemption if demographics aren't available yet."
  />
);

const LoadingState = ({ message }: { message: string }) => (
  <AppLayout>
    <div className="min-h-screen bg-muted/40 py-10 px-4">
      <div className="mx-auto max-w-xl">
        <Card>
          <CardHeader>
            <CardTitle>Demographics verification</CardTitle>
            <CardDescription>{message}</CardDescription>
          </CardHeader>
          <CardContent className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            <span>Fetching your request…</span>
          </CardContent>
        </Card>
      </div>
    </div>
  </AppLayout>
);

const ErrorState = ({
  title,
  description,
}: {
  title: string;
  description: string;
}) => (
  <AppLayout>
    <div className="min-h-screen bg-muted/40 py-10 px-4">
      <div className="mx-auto max-w-xl">
        <Card>
          <CardHeader>
            <CardTitle>{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Try refreshing the page. If the issue continues, contact support.
          </CardContent>
        </Card>
      </div>
    </div>
  </AppLayout>
);

const DemographicsVerificationRouter = () => {
  const { id } = useParams<{ id: string }>();
  const claimId = id ?? "";
  const [searchParams, setSearchParams] = useSearchParams();

  const {
    data: claim,
    isLoading,
    error,
  } = trpc.demographicsVerification.getClaim.useQuery(
    { id: claimId },
    { enabled: Boolean(claimId) }
  );

  const normalizedPlatform = useMemo(
    () => claim?.verifiedPlatform?.toLowerCase() ?? "",
    [claim?.verifiedPlatform]
  );
  const shouldUseYoutubeFlow = normalizedPlatform.includes("youtube");
  const shouldUseInstagramFlow = normalizedPlatform.includes("instagram");

  const methodParam = searchParams.get("method")?.toLowerCase() ?? "";
  const selectedMethod =
    methodParam === "api" ||
    methodParam === "screenshot" ||
    methodParam === "exemption"
      ? (methodParam as VerificationMethod)
      : null;

  const handleSelectMethod = (method: VerificationMethod) => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("method", method);
    setSearchParams(nextParams);
  };

  if (!claimId) {
    return (
      <ErrorState
        title="Invalid verification"
        description="We couldn't determine which verification to load."
      />
    );
  }

  if (error) {
    return (
      <ErrorState
        title="Unable to load verification"
        description="Something went wrong while loading this request."
      />
    );
  }

  if (!claim) {
    return isLoading ? (
      <LoadingState message="Give us a moment while we load your verification." />
    ) : (
      <ErrorState
        title="Verification not found"
        description="We couldn’t find a demographics verification with this id."
      />
    );
  }

  const shouldShowMethodSelect = !selectedMethod;

  if (shouldShowMethodSelect) {
    if (shouldUseYoutubeFlow) {
      return <YoutubeVerificationMethodSelect onSelect={handleSelectMethod} />;
    }
    if (shouldUseInstagramFlow) {
      return <InstagramVerificationMethodSelect onSelect={handleSelectMethod} />;
    }
    return <ScreenshotVerificationMethodSelect onSelect={handleSelectMethod} />;
  }

  if (selectedMethod === "screenshot" || selectedMethod === "exemption") {
    return <DemographicsVerificationScreenshot method={selectedMethod} />;
  }

  if (shouldUseYoutubeFlow) {
    return <DemographicsVerificationYouTube />;
  }

  if (shouldUseInstagramFlow) {
    return <DemographicsVerificationInstagram />;
  }

  return <DemographicsVerificationScreenshot method={selectedMethod} />;
};

export default DemographicsVerificationRouter;
