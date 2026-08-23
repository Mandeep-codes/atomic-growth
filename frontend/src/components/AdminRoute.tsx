import { ReactNode } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useRole } from "@/hooks/useRole";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Shield, User, Loader2 } from "lucide-react";
import { UserButton } from "@clerk/clerk-react";

interface AdminRouteProps {
  children: ReactNode;
  requiredRole?: string;
  // If provided, access is granted when the user holds ANY of these roles.
  requiredAnyRole?: string[];
}

export const AdminRoute = ({
  children,
  requiredRole,
  requiredAnyRole,
}: AdminRouteProps) => {
  const { user } = useAuth();
  const { roles } = useRole();

  const allowed = requiredAnyRole
    ? requiredAnyRole.some((role) => roles.includes(role))
    : requiredRole
      ? roles.includes(requiredRole)
      : false;

  if (!allowed) {
    return (
      <div className="min-h-screen bg-background">
        <header className="border-b bg-card">
          <div className="max-w-7xl mx-auto px-6 py-4">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold text-foreground">
                  Atomik Clips
                </h1>
                <p className="text-sm text-muted-foreground">Access Denied</p>
              </div>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <User className="h-4 w-4" />
                  {user?.email}
                </div>
                <UserButton afterSignOutUrl="/" />
              </div>
            </div>
          </div>
        </header>

        <div className="max-w-2xl mx-auto px-6 py-12">
          <Card>
            <CardHeader className="text-center">
              <div className="mx-auto w-12 h-12 bg-destructive/10 rounded-full flex items-center justify-center mb-4">
                <Shield className="h-6 w-6 text-destructive" />
              </div>
              <CardTitle className="text-xl">Access Restricted</CardTitle>
            </CardHeader>
            <CardContent className="text-center space-y-4">
              <p className="text-muted-foreground">
                You don't have the necessary permissions to access this area.
                This section is restricted to administrators only.
              </p>
              <p className="text-sm text-muted-foreground">
                If you believe this is an error, please contact your system
                administrator.
              </p>
              <div className="pt-4">
                <UserButton afterSignOutUrl="/" />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};
