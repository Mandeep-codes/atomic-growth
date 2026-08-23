import { clerkClient, verifyToken } from "@clerk/express";
import { getBannedUser } from "./banned-users";
import { env } from "./env";
import { publicProcedure, middleware } from "./trpc";
import { DEV_AUTH_ENABLED, DEV_DISCORD_ID } from "./dev-auth";

// Auth that RESOLVES a viewer when there's a valid token but never rejects
// anonymous callers. For read-only surfaces that are public by default and
// show extra rows to a signed-in viewer (the home leaderboard: public
// campaigns for everyone, plus private campaigns the viewer is approved for).
//
// ctx.viewerId is the DISCORD id — the identity campaign_applications.user_id
// and submissions.user_id are keyed by — or null. Callers must treat it as
// "who is asking", never as an authorization decision on its own.
//
// Anything short of a confidently identified, non-banned viewer degrades to
// anonymous (public boards only) rather than throwing: a stale or forged
// token must still render the public leaderboard, never a private one.

const VIEWER_TTL_MS = 5 * 60 * 1000;
const VIEWER_CACHE_MAX = 5_000;
// clerk_user_id -> discord id (or null when no Discord is linked). Negatives
// are cached too, so a Discord-less signed-in user doesn't re-hit Clerk on
// every request.
const viewerCache = new Map<string, { at: number; discordId: string | null }>();

// Read the Discord id from CLERK, the same authority clerkAuthMiddleware uses
// (token subject -> that user's oauth_discord external account).
//
// Deliberately NOT read from our user_clerk table: its sync upserts on two
// unique columns (clerk_user_id, discord_id) and its onDuplicateKeyUpdate
// rewrites NEITHER, so a row can hold a stale pairing indefinitely — in both
// directions. Trusting it would (a) hide a clipper's own private board behind
// a stale miss, and worse (b) key the ban check below to an identity the
// viewer no longer uses, letting a banned clipper keep the board. The TTL
// cache keeps the common path off the network; 5 minutes matches the sync
// cadence clerkAuthMiddleware already tolerates.
async function resolveDiscordId(clerkUserId: string): Promise<string | null> {
  const hit = viewerCache.get(clerkUserId);
  if (hit && Date.now() - hit.at < VIEWER_TTL_MS) return hit.discordId;

  const clerkUser = await clerkClient.users.getUser(clerkUserId);
  const discordAccount = clerkUser.externalAccounts.find(
    (account) => account.provider === "oauth_discord"
  );
  const discordId = discordAccount?.externalId ?? null;

  if (viewerCache.size >= VIEWER_CACHE_MAX && !viewerCache.has(clerkUserId)) {
    const oldest = viewerCache.keys().next().value;
    if (oldest !== undefined) viewerCache.delete(oldest);
  }
  viewerCache.set(clerkUserId, { at: Date.now(), discordId });
  return discordId;
}

const optionalAuthMiddleware = middleware(async ({ ctx, next }) => {
  const anonymous = () =>
    next({ ctx: { ...ctx, viewerId: null as string | null } });

  if (DEV_AUTH_ENABLED) {
    return next({ ctx: { ...ctx, viewerId: DEV_DISCORD_ID as string | null } });
  }

  const authHeader = ctx.req?.headers?.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) return anonymous();

  try {
    const payload = await verifyToken(authHeader.substring(7), {
      secretKey: env.CLERK_SECRET_KEY,
    });
    if (!payload?.sub) return anonymous();

    const discordId = await resolveDiscordId(payload.sub);
    if (!discordId) return anonymous();

    // Banned clippers see exactly what a stranger sees. clerkAuthMiddleware
    // hard-throws on a ban, but a ban does NOT revoke the Clerk session or
    // touch campaign_applications — so without this check a banned clipper's
    // still-approved row would keep serving them a private campaign's real
    // title, top clips and every earner's name.
    const banned = await getBannedUser(
      discordId,
      env.NODE_ENV === "development"
    );
    if (banned) return anonymous();

    return next({ ctx: { ...ctx, viewerId: discordId as string | null } });
  } catch {
    return anonymous();
  }
});

export const optionalAuthProcedure = publicProcedure.use(optionalAuthMiddleware);
