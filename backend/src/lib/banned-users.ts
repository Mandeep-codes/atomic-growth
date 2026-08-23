import { eq } from "drizzle-orm";
import { db } from "./db";
import { banned_users } from "./schema";

const MAX_CACHE_SIZE = 200;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export type BannedUserRecord = typeof banned_users.$inferSelect;

export interface BannedUserMetadata {
  reason: string | null;
  createdAt: string | null;
  createdBy: string | null;
}

interface CacheEntry {
  record: BannedUserRecord | null;
  timestamp: number;
}

const bannedUserCache = new Map<string, CacheEntry>();

function getCachedBan(userId: string): BannedUserRecord | null | undefined {
  const cached = bannedUserCache.get(userId);

  if (cached === undefined) {
    return undefined;
  }

  if (Date.now() - cached.timestamp > CACHE_TTL_MS) {
    bannedUserCache.delete(userId);
    return undefined;
  }

  bannedUserCache.delete(userId);
  bannedUserCache.set(userId, cached);

  return cached.record;
}

function setCachedBan(
  userId: string,
  record: BannedUserRecord | null
): BannedUserRecord | null {
  bannedUserCache.set(userId, {
    record,
    timestamp: Date.now(),
  });

  if (bannedUserCache.size > MAX_CACHE_SIZE) {
    const firstKey = bannedUserCache.keys().next().value;
    if (firstKey !== undefined) {
      bannedUserCache.delete(firstKey);
    }
  }

  return record;
}

export async function getBannedUser(
  userId: string,
  isDev: boolean
): Promise<BannedUserRecord | null> {
  const cached = getCachedBan(userId);

  if (cached !== undefined && !isDev) {
    return cached;
  }

  const bannedUser = await db.query.banned_users.findFirst({
    where: eq(banned_users.user_id, userId),
  });

  return setCachedBan(userId, bannedUser ?? null);
}

export function bustBannedUserCache(userId: string): void {
  bannedUserCache.delete(userId);
}

export function bustAllBannedUserCache(): void {
  bannedUserCache.clear();
}
