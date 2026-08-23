export type SupportedPlatform = "youtube" | "instagram" | "tiktok" | "x";

const PLATFORM_LABELS: Record<SupportedPlatform, string> = {
  youtube: "YouTube",
  instagram: "Instagram",
  tiktok: "TikTok",
  x: "X",
};

function tokenToPlatform(token: string): SupportedPlatform | null {
  const normalized = token.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (normalized.includes("youtube")) {
    return "youtube";
  }

  if (normalized.includes("instagram")) {
    return "instagram";
  }

  if (normalized.includes("tiktok") || normalized.includes("tik tok")) {
    return "tiktok";
  }

  if (
    normalized === "x" ||
    normalized.includes("twitter") ||
    normalized.startsWith("x (")
  ) {
    return "x";
  }

  return null;
}

/**
 * Parses `campaigns.platforms` values like:
 * - "YouTube, Instagram, TikTok"
 * - "YouTube, Instagram, X, and TikTok"
 */
export function parseCampaignPlatforms(
  platforms: string | null | undefined
): SupportedPlatform[] {
  if (!platforms?.trim()) {
    return [];
  }

  const normalized = platforms
    .replace(/&/g, " and ")
    .replace(/\band\b/gi, ",")
    .replace(/[;|/]/g, ",");

  const tokens = normalized
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean);

  const result: SupportedPlatform[] = [];
  for (const token of tokens) {
    const platform = tokenToPlatform(token);
    if (platform && !result.includes(platform)) {
      result.push(platform);
    }
  }

  return result;
}

export function formatPlatformList(platforms: SupportedPlatform[]): string {
  return platforms.map((platform) => PLATFORM_LABELS[platform]).join(", ");
}

