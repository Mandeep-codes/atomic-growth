import { useAuth } from "./useAuth";
import { isFeatureEnabled, type FeatureFlagKey } from "@/lib/featureFlags";

/**
 * Hook to check if a feature flag is enabled for the current user
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { enabled: showNewFlow } = useFeatureFlag("NEW_SUBMISSION_FLOW");
 *
 *   if (showNewFlow) {
 *     return <NewSubmissionFlow />;
 *   }
 *   return <OldSubmissionFlow />;
 * }
 * ```
 */
export function useFeatureFlag(flagKey: FeatureFlagKey) {
  const { user, loading } = useAuth();
  const userEmail = user?.email || null;
  const enabled = isFeatureEnabled(flagKey, userEmail);

  return {
    enabled,
    isLoading: loading,
    userEmail,
  };
}

/**
 * Hook to check multiple feature flags at once
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const flags = useFeatureFlags(["NEW_SUBMISSION_FLOW", "REWARDS_V2"]);
 *
 *   if (flags.NEW_SUBMISSION_FLOW.enabled) {
 *     // ...
 *   }
 * }
 * ```
 */
export function useFeatureFlags(flagKeys: FeatureFlagKey[]) {
  const { user, loading } = useAuth();
  const userEmail = user?.email || null;

  const flags = flagKeys.reduce((acc, key) => {
    acc[key] = {
      enabled: isFeatureEnabled(key, userEmail),
      isLoading: loading,
    };
    return acc;
  }, {} as Record<FeatureFlagKey, { enabled: boolean; isLoading: boolean }>);

  return flags;
}
