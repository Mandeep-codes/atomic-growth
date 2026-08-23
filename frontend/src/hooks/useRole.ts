import { useUser } from "@clerk/clerk-react";

export const useRole = () => {
  const { user, isLoaded } = useUser();

  const roles = (user?.publicMetadata?.roles as string[]) ?? [];

  return {
    roles,
    isRolesLoaded: isLoaded,
  };
};
