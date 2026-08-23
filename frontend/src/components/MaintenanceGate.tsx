import { ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { trpc } from "@/lib/trpc";
import { useRole } from "@/hooks/useRole";
import { useAuth } from "@/hooks/useAuth";
import { MaintenanceScreen } from "./MaintenanceScreen";

// Wraps the whole app. When maintenance mode is ON, any AUTHENTICATED user who
// is not an SOS (or god-mode) holder is shown the maintenance screen instead of
// the app. We deliberately do NOT gate unauthenticated visitors or the auth
// pages, so SOS users can still log in to reach /admin/sos and turn it off.
// The backend independently blocks non-SOS API calls, so this is purely the UX
// layer.
const ALWAYS_ALLOWED_PATHS = ["/auth", "/reset-password", "/privacy"];

export const MaintenanceGate = ({ children }: { children: ReactNode }) => {
  const location = useLocation();
  const { user } = useAuth();
  const { roles, isRolesLoaded } = useRole();

  const { data: maintenance } = trpc.siteSettings.getMaintenanceStatus.useQuery(
    undefined,
    {
      // Poll so a blocked user's screen lifts automatically when SOS turns it
      // off, and a logged-in user gets gated within ~20s of it turning on.
      refetchInterval: 20_000,
      refetchOnWindowFocus: true,
      staleTime: 0,
    }
  );

  const onAllowedPath = ALWAYS_ALLOWED_PATHS.some((p) =>
    location.pathname.startsWith(p)
  );

  const isPrivileged =
    roles.includes("sos") || roles.includes("god-mode");

  if (
    maintenance?.enabled &&
    user &&
    isRolesLoaded &&
    !isPrivileged &&
    !onAllowedPath
  ) {
    return <MaintenanceScreen message={maintenance.message} />;
  }

  return <>{children}</>;
};
