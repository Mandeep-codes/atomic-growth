import { z } from "zod";

const withdrawalDetailSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("wise"),
    batchName: z.string(),
    batchGroupId: z.string(),
  }),
  z.object({
    type: z.literal("manual"),
    reason: z.string().nullable(),
  }),
]);

export const withdrawalMetadataSchema = z.object({
  version: z.literal("v1"),
  type: z.literal("withdrawal"),
  details: withdrawalDetailSchema.optional(),
  method: z.string().nullable().optional(),
  referenceId: z.string().nullable().optional(),
});

export const withdrawalRefundMetadataSchema = z.object({
  version: z.literal("v1"),
  type: z.literal("withdrawal_refund"),
  details: z
    .object({
      type: z.literal("wise"),
      status: z.string(),
      transferId: z.string().optional(),
      batchGroupId: z.string().optional(),
    })
    .optional(),
  reason: z.string().nullable().optional(),
});

export const referralRewardV2MetadataSchema = z.object({
  version: z.literal("v1"),
  type: z.literal("referral_reward_v2"),
  campaignId: z.string().nullable(),
  campaignTitle: z.string().nullable(),
  platform: z.string().nullable(),
  referredUserName: z.string(),
});

export const refereeRewardMetadataSchema = z.object({
  version: z.literal("v1"),
  type: z.literal("referee_reward"),
  campaignId: z.string().nullable(),
  campaignTitle: z.string().nullable(),
  platform: z.string().nullable(),
});

export const balanceEntryMetadataSchema = z.discriminatedUnion("type", [
  z.object({
    version: z.literal("v1"),
    type: z.literal("campaign_view_reward"),
    campaignId: z.string(),
    campaignTitle: z.string().nullable(),
    platform: z.string(),
    viewDelta: z.number(),
    totalViews: z.number(),
    cpm: z.number(),
  }),
  z.object({
    version: z.literal("v1"),
    type: z.literal("referral_reward"),
    campaignId: z.string().nullable(),
    campaignTitle: z.string().nullable(),
    platform: z.string().nullable(),
    referredUserId: z.string(),
    referredUserEmail: z.string().nullable(),
  }),
  z.object({
    version: z.literal("v1"),
    type: z.literal("manual_adjustment"),
    reason: z.string().nullable(),
  }),
  withdrawalMetadataSchema,
  withdrawalRefundMetadataSchema,
  referralRewardV2MetadataSchema,
  refereeRewardMetadataSchema,
]);
