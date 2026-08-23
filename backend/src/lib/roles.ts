import { eq } from "drizzle-orm";
import { db } from "./db";
import { roles } from "./schema";
import { user_roles } from "./schema";

const MAX_CACHE_SIZE = 200;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CacheEntry {
  roles: string[];
  timestamp: number;
}

const roleCache = new Map<string, CacheEntry>();

function getCachedRoles(userId: string): string[] | undefined {
  const cached = roleCache.get(userId);

  if (cached === undefined) {
    return undefined;
  }

  // Check if cache entry has expired (older than 5 minutes)
  const now = Date.now();
  if (now - cached.timestamp > CACHE_TTL_MS) {
    roleCache.delete(userId);
    return undefined;
  }

  // Move to end (LRU behavior)
  roleCache.delete(userId);
  roleCache.set(userId, cached);

  return cached.roles;
}

function setCachedRoles(userId: string, roleNames: string[]): void {
  roleCache.set(userId, {
    roles: roleNames,
    timestamp: Date.now(),
  });

  if (roleCache.size <= MAX_CACHE_SIZE) {
    return;
  }

  const firstKey = roleCache.keys().next().value;

  if (firstKey !== undefined) {
    roleCache.delete(firstKey);
  }
}

export async function getUserRoles(
  userId: string,
  isDev: boolean
): Promise<string[]> {
  const cachedRoles = getCachedRoles(userId);

  if (cachedRoles !== undefined && !isDev) {
    return cachedRoles;
  }

  const rolesRecords = await db
    .select({ roleName: roles.name })
    .from(user_roles)
    .innerJoin(roles, eq(user_roles.role_id, roles.id))
    .where(eq(user_roles.user_id, userId));

  const roleNames = rolesRecords.map((role) => role.roleName);

  setCachedRoles(userId, roleNames);

  return roleNames;
}

/**
 * Removes cached roles for a specific user.
 * Call this when a role is added or removed for a user.
 */
export function bustUserRoleCache(userId: string): void {
  roleCache.delete(userId);
}

/**
 * Clears all cached roles.
 * Call this when roles are changed and you don't know which users are affected.
 */
export function bustAllRoleCache(): void {
  roleCache.clear();
}
