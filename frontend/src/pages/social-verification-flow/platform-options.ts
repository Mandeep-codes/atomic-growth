import { Instagram, Music2, Twitter, Youtube } from "lucide-react";

export const platformOptions = [
  {
    id: "instagram" as const,
    name: "Instagram",
    description: "For Reels and feed posts",
    icon: Instagram,
  },
  {
    id: "youtube" as const,
    name: "YouTube",
    description: "Channels and Shorts",
    icon: Youtube,
  },
  {
    id: "x" as const,
    name: "X (Twitter)",
    description: "Tweets and reposts",
    icon: Twitter,
  },
  {
    id: "tiktok" as const,
    name: "TikTok",
    description: "Clips and livestreams",
    icon: Music2,
  },
];

export type PlatformOption = (typeof platformOptions)[number];
export type PlatformId = PlatformOption["id"];

export const findPlatformOption = (
  platformId: string | null
): PlatformOption | null => {
  if (!platformId) return null;
  return platformOptions.find((option) => option.id === platformId) ?? null;
};

export const normalizeHandleInput = (rawHandle: string) =>
  rawHandle.trim().replace(/^@+/, "");
