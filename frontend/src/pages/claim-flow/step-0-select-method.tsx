import { useNavigate } from "react-router-dom";
import { Banknote, Wallet } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface PayoutOption {
  id: string;
  title: string;
  description: string;
  badge?: string;
  icon: typeof Banknote;
  route: string;
}

const payoutOptions: PayoutOption[] = [
  {
    id: "bank",
    title: "Bank account",
    description: "Send funds to your linked Wise recipient in INR.",
    badge: "Recommended",
    icon: Banknote,
    route: "/earnings/claim/bank/details",
  },
];

// Crypto payout is open to every clipper: USDT/USDC on low-fee networks,
// paid out manually by an admin.
const cryptoPayoutOption: PayoutOption = {
  id: "crypto",
  title: "Crypto wallet",
  description: "Get paid in USDT/USDC on low-fee networks (BSC, Solana, Polygon, TON, Base).",
  icon: Wallet,
  route: "/earnings/claim/crypto/details",
};

const ClaimSelectMethodStep = () => {
  const navigate = useNavigate();
  const visibleOptions = [...payoutOptions, cryptoPayoutOption];

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Select how you want to claim your balance</CardTitle>
        <CardDescription>Pick a payout method to continue.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-1">
        {visibleOptions.map((option) => {
          const Icon = option.icon;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => navigate(option.route)}
              className="flex flex-col gap-3 rounded-lg border bg-card p-4 text-left shadow-sm transition hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60"
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
  );
};

export default ClaimSelectMethodStep;
