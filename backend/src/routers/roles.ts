import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, userRolesAdminRoleProcedure } from "../lib/trpc";
import { db } from "../lib/db";
import { roles, user_roles, user_clerk, verified_users } from "../lib/schema";
import { eq, desc, asc, and, isNull } from "drizzle-orm";
import { bustUserRoleCache } from "../lib/roles";

export const rolesRouter = router({
  getRoles: userRolesAdminRoleProcedure.query(async () => {
    return db
      .select({
        id: roles.id,
        name: roles.name,
        description: roles.description,
        createdAt: roles.created_at,
      })
      .from(roles)
      .orderBy(asc(roles.name));
  }),
  getAssignableUsers: userRolesAdminRoleProcedure.query(async () => {
    return db
      .select({
        id: user_clerk.id,
        discordId: user_clerk.discord_id,
        clerkUserId: user_clerk.clerk_user_id,
        email: user_clerk.email,
        firstName: user_clerk.first_name,
        lastName: user_clerk.last_name,
        imageUrl: user_clerk.image_url,
        createdAt: user_clerk.created_at,
      })
      .from(user_clerk)
      .orderBy(asc(user_clerk.first_name), asc(user_clerk.last_name));
  }),
  getUserRoles: userRolesAdminRoleProcedure.query(async () => {
    return db
      .select({
        id: user_roles.id,
        userId: user_roles.user_id,
        roleId: user_roles.role_id,
        roleName: roles.name,
        assignedAt: user_roles.assigned_at,
        email: user_clerk.email,
        firstName: user_clerk.first_name,
        lastName: user_clerk.last_name,
        imageUrl: user_clerk.image_url,
      })
      .from(user_roles)
      .innerJoin(roles, eq(user_roles.role_id, roles.id))
      .leftJoin(user_clerk, eq(user_clerk.discord_id, user_roles.user_id))
      .orderBy(desc(user_roles.assigned_at));
  }),
  assignRole: userRolesAdminRoleProcedure
    .input(
      z.object({
        userId: z.string().min(1, "User ID is required"),
        roleId: z.string().min(1, "Role is required"),
      })
    )
    .mutation(async ({ input }) => {
      try {
        await db.insert(user_roles).values({
          user_id: input.userId,
          role_id: input.roleId,
        });
      } catch (error: any) {
        if (error?.code === "ER_DUP_ENTRY") {
          throw new TRPCError({
            code: "CONFLICT",
            message: "User already has this role",
          });
        }
        throw error;
      }

      const [assignment] = await db
        .select({
          id: user_roles.id,
          userId: user_roles.user_id,
          roleId: user_roles.role_id,
          roleName: roles.name,
          assignedAt: user_roles.assigned_at,
          userHandle: verified_users.handle,
          userPlatform: verified_users.platform,
          email: user_clerk.email,
          firstName: user_clerk.first_name,
          lastName: user_clerk.last_name,
          imageUrl: user_clerk.image_url,
        })
        .from(user_roles)
        .innerJoin(roles, eq(user_roles.role_id, roles.id))
        .leftJoin(
          verified_users,
          and(
            eq(verified_users.discord_id, user_roles.user_id),
            isNull(verified_users.deleted_at)
          )
        )
        .leftJoin(user_clerk, eq(user_clerk.discord_id, user_roles.user_id))
        .where(eq(user_roles.user_id, input.userId))
        .orderBy(desc(user_roles.assigned_at))
        .limit(1);

      // Bust cache for the user whose role was added
      bustUserRoleCache(input.userId);

      return assignment;
    }),
  removeUserRole: userRolesAdminRoleProcedure
    .input(
      z.object({
        userRoleId: z.string().min(1, "Assignment ID is required"),
      })
    )
    .mutation(async ({ input }) => {
      // Get the userId before deleting so we can bust the cache
      const [userRole] = await db
        .select({ userId: user_roles.user_id })
        .from(user_roles)
        .where(eq(user_roles.id, input.userRoleId))
        .limit(1);

      await db.delete(user_roles).where(eq(user_roles.id, input.userRoleId));

      // Bust cache for the user whose role was removed
      if (userRole) {
        bustUserRoleCache(userRole.userId);
      }

      return { success: true };
    }),
});
