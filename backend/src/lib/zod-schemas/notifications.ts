import { z } from "zod";

export const notificationMetadataSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("submission-approved"),
    alertType: z.literal("success"),
    submissionUrl: z.string(),
  }),
  z.object({
    type: z.literal("submission-rejected"),
    alertType: z.literal("warning"),
    submissionUrl: z.string(),
    rejectionReason: z.string().optional(),
    reviewer: z.string().optional(),
  }),
  z.object({
    type: z.literal("demographics-verification-reminder"),
    alertType: z.literal("info"),
  }),
  z.object({
    type: z.literal("earnings-update"),
    alertType: z.literal("success"),
    amount: z.number(),
    campaignTitle: z.string().optional(),
    views: z.number(),
  }),
  z.object({
    type: z.literal("payout-initiated"),
    alertType: z.literal("success"),
    amount: z.number(),
    currency: z.string(),
  }),
  z.object({
    type: z.literal("withdrawal-refunded"),
    alertType: z.literal("warning"),
    amount: z.number(),
    currency: z.string(),
  }),
  z.object({
    type: z.literal("issue-alert"),
    alertType: z.literal("warning"),
  }),
  z.object({
    type: z.literal("announcement"),
    alertType: z.literal("info"),
  }),
  // Rows written before alertType was added to these inserts lack the field —
  // .catch() supplies the default so they still parse. Keep in sync with
  // frontend/src/components/dashboard/notifications/NotificationSchema.ts.
  z.object({
    type: z.literal("private-campaign-application"),
    alertType: z.enum(["success", "warning", "info"]).catch("info"),
    campaignId: z.string(),
  }),
  z.object({
    type: z.literal("campaign-suspension"),
    alertType: z.enum(["success", "warning", "info"]).catch("warning"),
    campaignId: z.string(),
  }),
  z.object({
    type: z.literal("campaign-activity-grace"),
    alertType: z.enum(["success", "warning", "info"]).catch("warning"),
    campaignId: z.string(),
  }),
  z.object({
    type: z.literal("withdrawal-returned"),
    alertType: z.enum(["success", "warning", "info"]).catch("warning"),
  }),
]);

const notificationSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  createdAt: z.date(),
  dismissedAt: z.date().nullable(),
  metadata: notificationMetadataSchema,
});

export type NotificationMetadata = z.infer<typeof notificationMetadataSchema>;
export type Notification = z.infer<typeof notificationSchema>;
