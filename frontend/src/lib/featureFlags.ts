/**
 * Feature Flag Configuration
 *
 * Define feature flags and the email addresses that should have access to them.
 * Each feature flag can have:
 * - enabled: boolean - if true, all users have access
 * - emails: string[] - specific email addresses that have access
 * - Both can be used together (enabled=true means everyone, emails adds specific users)
 */

export type FeatureFlagKey =
  | "EARNINGS_FF"
  | "SOCIAL_LOGIN_VERIFICATION"
  | "TERMS_AND_CONDITIONS"
  | "DEMOGRAPHICS_VERIFICATION"
  | "DEMOGRAPHICS_ON_CAMPAIGN";

export interface FeatureFlagConfig {
  enabled: boolean;
  emails: string[];
  description?: string;
}

export const featureFlags: Record<FeatureFlagKey, FeatureFlagConfig> = {
  EARNINGS_FF: {
    enabled: false,
    emails: [
      "arthur@atomikgrowth.com",
      "hannaan@atomikgrowth.com",
      "suba@atomikgrowth.com",
      "seb@atomikgrowth.com",
      "manasgorivale007@gmail.com",
      "upratapsingh1608@gmail.com",
      "akhilbunny04@gmail.com",
      "prathamagarwal176@gmail.com",
      "belutogames2609@gmail.com",
      "10cdakshmane@gmail.com",
      "connectwabhishekhshrivastav@gmail.com",
      "arthur6ocdn@gmail.com",
      "rizwanmondal877@gmail.com",
      "sudhirgoriwale@gmail.com",
      "achuthmohan777@gmail.com",
      "sebruizufl@gmail.com",
      "hanaankith@gmail.com",
    ],
    description: "New earnings function with improved UX",
  },
  SOCIAL_LOGIN_VERIFICATION: {
    enabled: true,
    emails: [
      "arthur@atomikgrowth.com",
      "hannaan@atomikgrowth.com",
      "suba@atomikgrowth.com",
      "seb@atomikgrowth.com",
      "sebruizufl@gmail.com",
      "arthur6ocdn@gmail.com",
      "eshanthaldar06@gmail.com",
      "divyjee247@gmail.com",
      "akhilbunny04@gmail.com",
      "earlsean.business@gmail.com",
      "achuthmohan777@gmail.com",
      "belutogames2609@gmail.com",
    ],
    description: "Login-based verification flow",
  },
  TERMS_AND_CONDITIONS: {
    enabled: false,
    emails: [
      "arthur@atomikgrowth.com",
      "hannaan@atomikgrowth.com",
      "suba@atomikgrowth.com",
      "seb@atomikgrowth.com",
      "sebruizufl@gmail.com",
      "arthur6ocdn@gmail.com",
    ],
    description: "Terms and conditions for verification of a social profile",
  },
  DEMOGRAPHICS_VERIFICATION: {
    enabled: true,
    emails: [
      "arthur@atomikgrowth.com",
      "hannaan@atomikgrowth.com",
      "suba@atomikgrowth.com",
      "seb@atomikgrowth.com",
      "sebruizufl@gmail.com",
      "arthur6ocdn@gmail.com",
      "eshanthaldar06@gmail.com",
      "divyjee247@gmail.com",
      "akhilbunny04@gmail.com",
      "earlsean.business@gmail.com",
      "achuthmohan777@gmail.com",
      "belutogames2609@gmail.com",
      "sharma08oct@gmail.com", // Aviral
    ],
  },
  DEMOGRAPHICS_ON_CAMPAIGN: {
    enabled: false,
    emails: [
      "arthur@atomikgrowth.com",
      "hannaan@atomikgrowth.com",
      "suba@atomikgrowth.com",
      "seb@atomikgrowth.com",
      "sebruizufl@gmail.com",
      "arthur6ocdn@gmail.com",
    ],
  },
};

/**
 * Check if a feature flag is enabled for a given email address
 */
export function isFeatureEnabled(
  flagKey: FeatureFlagKey,
  userEmail: string | null | undefined
): boolean {
  const flag = featureFlags[flagKey];

  if (!flag) {
    return false;
  }

  // If globally enabled, everyone has access
  if (flag.enabled) {
    return true;
  }

  // If no user email, feature is disabled
  if (!userEmail) {
    return false;
  }

  // Check if user's email is in the allowed list
  return flag.emails.includes(userEmail);
}

/**
 * Get all enabled feature flags for a user
 */
export function getEnabledFeatures(
  userEmail: string | null | undefined
): FeatureFlagKey[] {
  return (Object.keys(featureFlags) as FeatureFlagKey[]).filter((key) =>
    isFeatureEnabled(key, userEmail)
  );
}
