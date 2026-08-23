import { createId } from "@paralleldrive/cuid2";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { db } from "../lib/db";
import { notification_announcements, notifications } from "../lib/schema";
import {
  notificationAnnouncementsAdminRoleProcedure,
  protectedProcedure,
  router,
} from "../lib/trpc";
import { NotificationMetadata } from "../lib/zod-schemas/notifications";

const ANNOUNCEMENT_LIMIT = 10;
const announcementTypeSchema = z.enum(["issue-alert", "announcement"]);

export const notificationsRouter = router({
  getMyNotifications: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.user?.id;

    if (!userId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "User not authenticated",
      });
    }

    const rows = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.user_id, userId),
          isNull(notifications.dismissed_at)
        )
      )
      .orderBy(desc(notifications.created_at))
      .limit(ANNOUNCEMENT_LIMIT);

    const existingSubmissionUrls = new Set<string>();
    return rows
      .filter((notification) => {
        if (!notification.metadata) {
          return false;
        }

        if (notification.expires_minutes) {
          const expiresAt = new Date(
            notification.created_at.getTime() +
              notification.expires_minutes * 60000
          );
          if (expiresAt < new Date()) {
            return false;
          }
        }

        const metadata = notification.metadata as NotificationMetadata;
        if (
          metadata &&
          (metadata.type === "submission-approved" ||
            metadata.type === "submission-rejected")
        ) {
          if (existingSubmissionUrls.has(metadata.submissionUrl)) {
            return false;
          }
          existingSubmissionUrls.add(metadata.submissionUrl);
        }

        return true;
      })
      .sort((a, b) => {
        const aMetadata = a.metadata as NotificationMetadata;
        const bMetadata = b.metadata as NotificationMetadata;

        if (
          aMetadata.type === "earnings-update" &&
          bMetadata.type === "earnings-update"
        ) {
          return bMetadata.amount - aMetadata.amount;
        }

        return b.created_at.getTime() - a.created_at.getTime();
      })
      .map((notification) => ({
        id: notification.id,
        title: notification.title,
        description: notification.description,
        metadata: notification.metadata,
        createdAt: notification.created_at,
        dismissedAt: notification.dismissed_at,
      }));
  }),
  getAnnouncements: protectedProcedure.query(async () => {
    const rows = await db
      .select()
      .from(notification_announcements)
      .where(isNull(notification_announcements.dismissed_at))
      .orderBy(desc(notification_announcements.created_at))
      .limit(ANNOUNCEMENT_LIMIT);

    const now = new Date();

    return rows
      .filter((announcement) => {
        if (!announcement.metadata) {
          return false;
        }

        if (announcement.expires_minutes) {
          const expiresAt = new Date(
            announcement.created_at.getTime() +
              announcement.expires_minutes * 60000
          );
          if (expiresAt < now) {
            return false;
          }
        }

        return true;
      })
      .map((announcement) => ({
        id: announcement.id,
        title: announcement.title,
        description: announcement.description,
        metadata: announcement.metadata as NotificationMetadata,
        createdAt: announcement.created_at,
        dismissedAt: announcement.dismissed_at,
      }));
  }),
  dismiss: protectedProcedure
    .input(
      z.object({
        notificationId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user?.id;

      if (!userId) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "User not authenticated",
        });
      }

      const dismissedAt = new Date();
      await db
        .update(notifications)
        .set({ dismissed_at: dismissedAt })
        .where(
          and(
            eq(notifications.id, input.notificationId),
            eq(notifications.user_id, userId)
          )
        );

      return { dismissedAt };
    }),
  listAnnouncements: notificationAnnouncementsAdminRoleProcedure.query(
    async () => {
      const announcements = await db
        .select()
        .from(notification_announcements)
        .orderBy(desc(notification_announcements.created_at));

      return announcements.map((announcement) => ({
        id: announcement.id,
        title: announcement.title,
        description: announcement.description,
        metadata: announcement.metadata as NotificationMetadata,
        createdAt: announcement.created_at,
        dismissedAt: announcement.dismissed_at,
        expiresMinutes: announcement.expires_minutes ?? null,
      }));
    }
  ),
  createAnnouncement: notificationAnnouncementsAdminRoleProcedure
    .input(
      z.object({
        title: z.string().min(3, "Title is required"),
        description: z.string().min(10, "Description is required"),
        type: announcementTypeSchema,
        expiresMinutes: z
          .number()
          .int()
          .positive()
          .max(60 * 24 * 7)
          .optional(),
      })
    )
    .mutation(async ({ input }) => {
      const id = createId();
      const metadata: NotificationMetadata =
        input.type === "issue-alert"
          ? { type: "issue-alert", alertType: "warning" }
          : { type: "announcement", alertType: "info" };

      await db.insert(notification_announcements).values({
        id,
        title: input.title,
        description: input.description,
        metadata,
        expires_minutes: input.expiresMinutes ?? null,
      });

      const [created] = await db
        .select()
        .from(notification_announcements)
        .where(eq(notification_announcements.id, id))
        .limit(1);

      if (!created) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create announcement",
        });
      }

      return {
        id: created.id,
        title: created.title,
        description: created.description,
        metadata: created.metadata as NotificationMetadata,
        createdAt: created.created_at,
        dismissedAt: created.dismissed_at,
        expiresMinutes: created.expires_minutes ?? null,
      };
    }),
  dismissAnnouncement: notificationAnnouncementsAdminRoleProcedure
    .input(z.object({ announcementId: z.string() }))
    .mutation(async ({ input }) => {
      const existing = await db
        .select()
        .from(notification_announcements)
        .where(eq(notification_announcements.id, input.announcementId))
        .limit(1);

      if (existing.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Announcement not found",
        });
      }

      const dismissedAt = new Date();
      await db
        .update(notification_announcements)
        .set({ dismissed_at: dismissedAt })
        .where(eq(notification_announcements.id, input.announcementId));

      return { dismissedAt };
    }),
});
