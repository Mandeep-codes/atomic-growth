import { useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ShieldCheck, KeyRound } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SocialVerificationFlowLayout } from "./social-verification-flow-layout";
import { useFeatureFlag } from "@/hooks/useFeatureFlag";

interface VerificationOption {
  id: string;
  title: string;
  description: string;
  badge?: string;
  icon: typeof ShieldCheck;
  route: string;
}

const verificationOptions: VerificationOption[] = [
  {
    id: "login",
    title: "Create Login",
    description: "Use an Atomik Clips email + password to get started quickly.",
    badge: "Recommended",
    icon: KeyRound,
    route: "/verification/flow/create-login",
  },
  {
    id: "bio",
    title: "Profile Verification",
    description: "Add a code to your social bio and we’ll verify ownership.",
    icon: ShieldCheck,
    route: "/verification/flow/bio",
  },
];

const SocialVerificationSelectMethodStep = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryString = searchParams.toString();
  const { enabled: loginVerificationEnabled, isLoading: loginFlagLoading } =
    useFeatureFlag("SOCIAL_LOGIN_VERIFICATION");

  const visibleVerificationOptions = useMemo(() => {
    return verificationOptions.filter((option) => {
      if (option.id === "login" && !loginVerificationEnabled) {
        return loginFlagLoading;
      }
      return true;
    });
  }, [loginVerificationEnabled, loginFlagLoading]);

  return (
    <SocialVerificationFlowLayout
      title="Verify your accounts"
      description="Choose how you want to confirm ownership before you submit."
      currentStep={1}
      totalSteps={2}
    >
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Select how you want to verify</CardTitle>
          <CardDescription>
            Pick a method to continue—both work for every platform.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-1">
          {visibleVerificationOptions.map((option) => {
            const Icon = option.icon;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() =>
                  navigate(
                    queryString
                      ? `${option.route}?${queryString}`
                      : option.route
                  )
                }
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
    </SocialVerificationFlowLayout>
  );
};

export default SocialVerificationSelectMethodStep;
