import { clerkClient, verifyToken } from "@clerk/express";
import { initTRPC, TRPCError } from "@trpc/server";
import type { Request } from "express";
import superjson from "superjson";
import { db } from "./db";
import { env } from "./env";
import { getBannedUser } from "./banned-users";
import { getUserRoles } from "./roles";
import { getMaintenanceStatus } from "./maintenance";
import { DEV_AUTH_ENABLED, devUser } from "./dev-auth";
import { user_clerk } from "./schema";

// Create a context type
export interface Context {
  req?: Request;
  user?: {
    id: string;
    email: string;
    firstName?: string;
    lastName?: string;
    discordId: string | null;
    discordUsername?: string | null;
    role?: string | null;
    roles?: string[];
    clerkUserId: string;
    clerkUserCreatedAt: Date | null;
  };
}

// Create tRPC instance
const t = initTRPC.context<Context>().create({
  transformer: superjson,
});

// Export router, procedure, and middleware
export const router = t.router;
export const publicProcedure = t.procedure;
export const middleware = t.middleware;

// Clerk authentication middleware
const clerkAuthMiddleware = middleware(async ({ ctx, next }) => {
  if (DEV_AUTH_ENABLED) {
    return next({ ctx: { ...ctx, user: devUser } });
  }

  // Get the authorization header from the request
  const authHeader = ctx.req?.headers?.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "No authorization token provided",
    });
  }

  const token = authHeader.substring(7); // Remove 'Bearer ' prefix

  try {
    // Verify the Clerk token
    const payload = await verifyToken(token, {
      secretKey: env.CLERK_SECRET_KEY,
    });

    if (!payload) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Invalid token",
      });
    }

    // ✅ Fetch full user data from Clerk
    const clerkUser = await clerkClient.users.getUser(payload.sub);

    // Extract Discord ID if user connected Discord
    const discordAccount = clerkUser.externalAccounts.find(
      (acc: any) => acc.provider === "oauth_discord"
    );
    const discordId = discordAccount?.externalId || null;
    const userId = discordId || clerkUser.id;

    const isDev = env.NODE_ENV === "development";
    const bannedUser = await getBannedUser(userId, isDev);

    if (bannedUser) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "User is banned",
      });
    }

    const roleNames = await getUserRoles(userId, isDev);

    // ── SOS / maintenance kill-switch ──
    // When maintenance mode is on, block every request from users who don't
    // hold the "sos" role (god-mode is also exempt as a failsafe so admins are
    // never locked out). SOS/god-mode users pass through normally — crucially
    // this lets them still reach the /admin/sos panel to turn it back off.
    // The public getMaintenanceStatus endpoint has no auth middleware, so the
    // frontend can always read the flag to show the maintenance screen.
    const maintenance = await getMaintenanceStatus();
    if (
      maintenance.enabled &&
      !roleNames.includes("sos") &&
      !roleNames.includes("god-mode")
    ) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "MAINTENANCE_MODE",
      });
    }

    // Sync every 5min. Roles and user_clerk data as "cache"
    if (
      isDev ||
      !clerkUser.publicMetadata?.lastSyncedAt ||
      new Date(clerkUser.publicMetadata.lastSyncedAt as string) <
      new Date(Date.now() - 1000 * 60 * 5)
    ) {
      if (!discordId) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "A linked Discord account is required",
        });
      }

      await db
        .insert(user_clerk)
        .values({
          clerk_user_id: clerkUser.id,
          discord_id: discordId,
          discord_username: discordAccount?.username ?? null,
          email: clerkUser.primaryEmailAddress?.emailAddress ?? null,
          first_name: clerkUser.firstName ?? null,
          last_name: clerkUser.lastName ?? null,
          image_url: clerkUser.imageUrl ?? null,
        })
        .onDuplicateKeyUpdate({
          set: {
            email: clerkUser.primaryEmailAddress?.emailAddress ?? null,
            discord_username: discordAccount?.username ?? null,
            first_name: clerkUser.firstName ?? null,
            last_name: clerkUser.lastName ?? null,
            image_url: clerkUser.imageUrl ?? null,
            updated_at: new Date(),
          },
        });

      await clerkClient.users.updateUserMetadata(clerkUser.id, {
        publicMetadata: {
          ...clerkUser.publicMetadata,
          roles: roleNames,
          lastSyncedAt: new Date().toISOString() as string,
        },
      });
    }

    // Extract user information from the token payload
    const user = {
      id: userId,
      email: clerkUser.primaryEmailAddress?.emailAddress,
      firstName: clerkUser.firstName,
      lastName: clerkUser.lastName,
      roles: roleNames,
      discordId: discordId,
      discordUsername: discordAccount?.username,
      clerkUserId: clerkUser.id,
      clerkUserCreatedAt: clerkUser.createdAt
        ? new Date(clerkUser.createdAt)
        : null,
    };

    return next({
      ctx: {
        ...ctx,
        user: {
          ...user,
        },
      },
    });
  } catch (error) {
    // Preserve INTENTIONAL errors (maintenance FORBIDDEN, banned UNAUTHORIZED,
    // etc.) instead of masking them as a token failure. Masking maintenance
    // as "Token verification failed" made the frontend force-logout the user
    // (it treats that 401 message as an expired session). Only genuine,
    // unexpected verification errors should become UNAUTHORIZED here.
    if (error instanceof TRPCError) {
      throw error;
    }
    console.error("Clerk token verification failed:", error);
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Token verification failed",
    });
  }
});

export const ROLES = {
  GOD_MODE: "god-mode",
  USER_ROLES_ADMIN: "user-roles-admin",
  CAMPAIGNS_EDITOR: "campaign-editor",
  REWARDS_MODERATOR: "rewards-modifier",
  REVIEWER: "submission-reviewer",
  PAYOUTS_ADMIN: "payouts-admin",
  DEMOGRAPHICS_REVIEWER: "demographics-reviewer",
  USER_ACTIVITY_READ: "user-activity-read",
  NOTIFICATION_ANNOUNCEMENTS_ADMIN: "notification-announcements-admin",
  INFLUENCER_SUBMISSION_EDITOR: "influencer-submission-editor",
  INFLUENCER_CAMPAIGN_EDITOR: "influencer-campaign-editor",
  SUBMISSION_VIEW_CAP_MANAGER: "submission-view-cap-manager",
  SOS: "sos",
};

// Every defined role counts as "staff"; a regular clipper holds none of these.
const STAFF_ROLES: string[] = Object.values(ROLES);

// Passes for any user holding at least one staff role (i.e. not a plain clipper).
export const staffProcedure = t.procedure
  .use(clerkAuthMiddleware)
  .use(({ ctx, next }) => {
    if (ctx.user.roles?.some((role) => STAFF_ROLES.includes(role)))
      return next({ ctx });
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "User not authorized",
    });
  });

// Authenticated procedure that verifies Clerk tokens
export const userRolesAdminRoleProcedure = t.procedure
  .use(clerkAuthMiddleware)
  .use(({ ctx, next }) => {
    if (ctx.user.roles?.includes(ROLES.USER_ROLES_ADMIN)) return next({ ctx });
    else
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "User not authorized",
      });
  });

export const campaignsEditorRoleProcedure = t.procedure
  .use(clerkAuthMiddleware)
  .use(({ ctx, next }) => {
    if (ctx.user.roles?.includes(ROLES.CAMPAIGNS_EDITOR)) return next({ ctx });
    else
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "User not authorized",
      });
  });

export const rewardsModeratorRoleProcedure = t.procedure
  .use(clerkAuthMiddleware)
  .use(({ ctx, next }) => {
    if (ctx.user.roles?.includes(ROLES.REWARDS_MODERATOR)) return next({ ctx });
    else
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "User not authorized",
      });
  });

export const reviewerRoleProcedure = t.procedure
  .use(clerkAuthMiddleware)
  .use(({ ctx, next }) => {
    if (ctx.user.roles?.includes(ROLES.REVIEWER)) return next({ ctx });
    else
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "User not authorized",
      });
  });

export const submissionViewCapRoleProcedure = t.procedure
  .use(clerkAuthMiddleware)
  .use(({ ctx, next }) => {
    if (ctx.user.roles?.includes(ROLES.SUBMISSION_VIEW_CAP_MANAGER))
      return next({ ctx });
    else
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "User not authorized",
      });
  });

export const demographicsReviewerRoleProcedure = t.procedure
  .use(clerkAuthMiddleware)
  .use(({ ctx, next }) => {
    if (ctx.user.roles?.includes(ROLES.DEMOGRAPHICS_REVIEWER))
      return next({ ctx });
    else
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "User not authorized",
      });
  });

export const payoutsAdminRoleProcedure = t.procedure
  .use(clerkAuthMiddleware)
  .use(({ ctx, next }) => {
    if (ctx.user.roles?.includes(ROLES.REWARDS_MODERATOR)) return next({ ctx });
    else
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "User not authorized",
      });
  });

export const notificationAnnouncementsAdminRoleProcedure = t.procedure
  .use(clerkAuthMiddleware)
  .use(({ ctx, next }) => {
    if (ctx.user.roles?.includes(ROLES.NOTIFICATION_ANNOUNCEMENTS_ADMIN))
      return next({ ctx });
    else
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "User not authorized",
      });
  });

export const userActivityRoleProcedure = t.procedure
  .use(clerkAuthMiddleware)
  .use(({ ctx, next }) => {
    if (ctx.user.roles?.includes(ROLES.USER_ACTIVITY_READ))
      return next({ ctx });
    else
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "User not authorized",
      });
  });

export const influencerSubmissionEditorRoleProcedure = t.procedure
  .use(clerkAuthMiddleware)
  .use(({ ctx, next }) => {
    if (ctx.user.roles?.includes(ROLES.INFLUENCER_SUBMISSION_EDITOR))
      return next({ ctx });
    else
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "User not authorized",
      });
  });

export const influencerCampaignEditorRoleProcedure = t.procedure
  .use(clerkAuthMiddleware)
  .use(({ ctx, next }) => {
    if (ctx.user.roles?.includes(ROLES.INFLUENCER_CAMPAIGN_EDITOR))
      return next({ ctx });
    else
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "User not authorized",
      });
  });

export const sosRoleProcedure = t.procedure
  .use(clerkAuthMiddleware)
  .use(({ ctx, next }) => {
    if (ctx.user.roles?.includes(ROLES.SOS)) return next({ ctx });
    else
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "User not authorized",
      });
  });

export const protectedProcedure = t.procedure.use(clerkAuthMiddleware);
