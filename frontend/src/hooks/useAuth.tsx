import { useUser, useAuth as useClerkAuth } from "@clerk/clerk-react";
import { useToast } from "@/hooks/use-toast";

// Clerk-based auth hook
export const useAuth = () => {
  const { user, isLoaded } = useUser();
  const { signOut: clerkSignOut } = useClerkAuth();
  const { toast } = useToast();

  // Transform Clerk user for application use
  const transformedUser = user
    ? {
        id: user.id,
        email: user.primaryEmailAddress?.emailAddress || "",
        publicMetadata: user.publicMetadata ?? {},
        user_metadata: {
          display_name:
            user.fullName ||
            user.firstName ||
            user.primaryEmailAddress?.emailAddress?.split("@")[0] ||
            "",
        },
        created_at: user.createdAt?.toISOString() || "",
        updated_at: user.updatedAt?.toISOString() || "",
      }
    : null;

  const signUp = async (
    email: string,
    password: string,
    displayName?: string
  ) => {
    // Clerk handles sign up through their components, so this is mainly for compatibility
    toast({
      title: "Sign up",
      description: "Please use the sign up button to create an account.",
    });
    return { error: null };
  };

  const signIn = async (email: string, password: string) => {
    // Clerk handles sign in through their components, so this is mainly for compatibility
    toast({
      title: "Sign in",
      description: "Please use the sign in button to authenticate.",
    });
    return { error: null };
  };

  const signOut = async () => {
    try {
      await clerkSignOut();
      return { error: null };
    } catch (error: any) {
      toast({
        title: "Sign out failed",
        description: error.message,
        variant: "destructive",
      });
      return { error };
    }
  };

  const resetPassword = async (email: string) => {
    // Clerk handles password reset through their components
    toast({
      title: "Password reset",
      description:
        "Please use the 'Forgot password?' link on the sign in page.",
    });
    return { error: null };
  };

  const updatePassword = async (password: string) => {
    // Clerk handles password updates through their user profile
    toast({
      title: "Password update",
      description: "Please update your password through your user profile.",
    });
    return { error: null };
  };

  return {
    user: transformedUser,
    session: user ? { user: transformedUser } : null,
    loading: !isLoaded,
    signUp,
    signIn,
    signOut,
    resetPassword,
    updatePassword,
  };
};

// AuthProvider is no longer needed with Clerk, but we keep it for compatibility
export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  return <>{children}</>;
};
