import { useLocation, useNavigate } from "react-router-dom";
import { CheckCircle2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const ClaimConfirmationStep = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const state =
    (location.state as { amount?: number; currency?: string } | null) ?? null;

  const formattedAmount = state?.amount
    ? new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: state.currency ?? "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(state.amount)
    : null;

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex items-center gap-3">
          <CheckCircle2 className="h-6 w-6 text-primary" />
          <div>
            <CardTitle>Your claim is queued</CardTitle>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <p className="text-sm text-muted-foreground">
          We will payout your current balance in the next payment cycle. Please
          visit the Discord for more questions and details.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
          <Button onClick={() => navigate("/earnings")}>
            Back to earnings
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default ClaimConfirmationStep;
