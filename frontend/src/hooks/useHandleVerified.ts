import { trpc } from "@/lib/trpc";
import { SupportedPlatform } from "@/lib/types";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../backend/src/routers";

type RouterOutput = inferRouterOutputs<AppRouter>;
type VerifiedAccount =
  RouterOutput["verification"]["checkVerification"]["verifiedAccounts"][number];

export const useHandleVerified = ({
  platform,
  handle,
}: {
  platform?: SupportedPlatform;
  handle?: string;
}) => {
  const { data: userVerificationAccounts, isFetching: isVerificationFetching } =
    trpc.verification.checkVerification.useQuery(
      { platform },
      {
        enabled: Boolean(platform),
        refetchOnWindowFocus: false,
      }
    );

  const normalizedHandle = handle?.toLowerCase();
  const matchingAccount: VerifiedAccount | undefined = normalizedHandle
    ? userVerificationAccounts?.verifiedAccounts.find(
        (account) => account.handle.toLowerCase() === normalizedHandle
      )
    : undefined;

  const hasVerifiedHandle = Boolean(matchingAccount);

  return {
    hasVerifiedHandle,
    matchingAccount,
    isVerificationFetching,
  };
};
