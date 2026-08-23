import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function timeAgo(value: Date | string | null | undefined) {
  if (!value) return "Just now";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "Just now";

  const diff = Date.now() - date.getTime();
  const minutes = Math.floor(diff / (1000 * 60));
  if (minutes < 60) return `${Math.max(minutes, 1)}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(months / 12);
  return `${years}y ago`;
}

export function formatPlatformLabel(platform?: string | null) {
  if (!platform) return "Unknown";
  const normalized = platform.toLowerCase();
  if (normalized === "youtube") {
    return "YouTube";
  }

  if (normalized === "tiktok") {
    return "TikTok";
  }

  if (normalized === "linkedin") {
    return "LinkedIn";
  }

  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}
