import { ReactNode } from "react";
import { useLocation, Navigate } from "react-router-dom";
import { useUser } from "@clerk/clerk-react";
import { Loader2 } from "lucide-react";

interface ProtectedRouteProps {
  children: ReactNode;
}

export const ProtectedRoute = ({ children }: ProtectedRouteProps) => {
  const { isLoaded, isSignedIn } = useUser();
  const location = useLocation();

  if (!isLoaded) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isSignedIn) {
    const redirectPath = `${location.pathname}${location.search}${location.hash}`;
    const redirectParam = encodeURIComponent(redirectPath || "/");

    return <Navigate to={`/auth?redirect=${redirectParam}`} replace />;
  }

  return <>{children}</>;
};
