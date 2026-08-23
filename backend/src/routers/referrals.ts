import { TRPCError } from "@trpc/server";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../lib/db";
import { env } from "../lib/env";
import {
  balance_entries,
  balances,
  referral_codes_v2,
  referred_users_v2,
  user_clerk,
} from "../lib/schema";
import { protectedProcedure, publicProcedure, router } from "../lib/trpc";
import { generateShareCardImageBuffer } from "../lib/generate-share-card/generateShareCardImageBuffer";
import { buildSpacesObjectKey, uploadBufferToSpaces } from "../lib/spaces";

const REFERRAL_FEATURE_RELEASE_DATE = new Date("2026-01-07T00:00:00Z");
const REFERRAL_NEW_USER_BONUS_DURATION_MS = 10 * 24 * 60 * 60 * 1000; // 10 days

const REFERRAL_CODE_CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const REFERRAL_CODE_LENGTH = 5;
const REFERRAL_CARD_FOLDER = "referrals/share-cards";
const REFERRAL_LINK_PARAM = "referral_code";

const normalizeReferralCode = (code: string) => code.trim();

const generateReferralCode = () => {
  let code = "";
  for (let index = 0; index < REFERRAL_CODE_LENGTH; index += 1) {
    const randomIndex = Math.floor(
      Math.random() * REFERRAL_CODE_CHARSET.length
    );
    code += REFERRAL_CODE_CHARSET[randomIndex];
  }
  return code;
};

const createUniqueReferralCode = async () => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = generateReferralCode();
    const [existing] = await db
      .select({ id: referral_codes_v2.id })
      .from(referral_codes_v2)
      .where(eq(referral_codes_v2.code, code))
      .limit(1);

    if (!existing) {
      return code;
    }
  }

  throw new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: "Failed to generate a unique referral code",
  });
};

const buildReferralLink = (code: string) => {
  const origin = env.CORS_ORIGIN.replace(/\/$/, "");
  const url = new URL(origin);
  url.searchParams.set(REFERRAL_LINK_PARAM, code);
  return url.toString();
};

const formatShareCardAmount = (amount: number) => {
  const minimumFractionDigits = amount >= 1000 ? 0 : 2;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits,
    maximumFractionDigits: minimumFractionDigits,
  }).format(amount);
};

const generateAndUploadShareCard = async ({
  userId,
  code,
  referralLink,
}: {
  userId: string;
  code: string;
  referralLink: string;
}) => {
  const [balanceRow] = await db
    .select({ totalEarned: balances.totalEarned })
    .from(balances)
    .where(eq(balances.user_id, userId))
    .limit(1);

  let shareCardUrl: string | null = null;
  const lifetimeEarned = Number(balanceRow?.totalEarned ?? 0);
  // TODO: give me a min
  if (lifetimeEarned >= 0) {
    const amountLabel = formatShareCardAmount(lifetimeEarned);

    const shareCardBuffer = await generateShareCardImageBuffer({
      qrURLCode: referralLink,
      amountLabel,
    });

    const shareCardKey = buildSpacesObjectKey(
      `${code}-referral-card.png`,
      REFERRAL_CARD_FOLDER
    );

    const uploadResult = await uploadBufferToSpaces({
      key: shareCardKey,
      buffer: shareCardBuffer,
      contentType: "image/png",
      acl: "public-read",
    });

    shareCardUrl = uploadResult.url ?? null;
    await db
      .update(referral_codes_v2)
      .set({ social_media_share_card_url: shareCardUrl })
      .where(eq(referral_codes_v2.code, code));
  }

  return {
    shareCardUrl,
    referralLink,
  } as const;
};

export const referralsRouter = router({
  getMyReferralCode: protectedProcedure.query(async ({ ctx }) => {
    const discordId = ctx.user?.discordId;

    if (!discordId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "A linked Discord account is required",
      });
    }

    const [record] = await db
      .select({
        id: referral_codes_v2.id,
        code: referral_codes_v2.code,
        createdAt: referral_codes_v2.created_at,
        shareCardUrl: referral_codes_v2.social_media_share_card_url,
      })
      .from(referral_codes_v2)
      .where(eq(referral_codes_v2.user_id, discordId))
      .orderBy(desc(referral_codes_v2.created_at))
      .limit(1);

    return record
      ? {
          code: record.code,
          createdAt: record.createdAt,
          shareCardUrl: record.shareCardUrl ?? null,
        }
      : null;
  }),

  getMyReferredUsers: protectedProcedure.query(async ({ ctx }) => {
    const discordId = ctx.user?.discordId;

    if (!discordId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "A linked Discord account is required",
      });
    }

    const referredUsers = await db
      .select({
        id: referred_users_v2.id,
        referredUserId: referred_users_v2.referred_user_id,
        referredAt: referred_users_v2.created_at,
        discordUsername: user_clerk.discord_username,
        email: user_clerk.email,
      })
      .from(referral_codes_v2)
      .innerJoin(
        referred_users_v2,
        eq(referred_users_v2.referral_code_id, referral_codes_v2.id)
      )
      .leftJoin(
        user_clerk,
        eq(user_clerk.discord_id, referred_users_v2.referred_user_id)
      )
      .where(eq(referral_codes_v2.user_id, discordId))
      .orderBy(desc(referred_users_v2.created_at));

    return referredUsers.map((record) => ({
      id: record.id,
      referredUserId: record.referredUserId,
      referredAt: record.referredAt,
      discordUsername: record.discordUsername ?? null,
      email: record.email ?? null,
    }));
  }),

  getMyReferralStatus: protectedProcedure.query(async ({ ctx }) => {
    const discordId = ctx.user?.discordId;

    if (!discordId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "A linked Discord account is required",
      });
    }

    const [record] = await db
      .select({
        code: referral_codes_v2.code,
        referrerDiscordId: referral_codes_v2.user_id,
        referrerDiscordUsername: user_clerk.discord_username,
        referrerEmail: user_clerk.email,
        referredAt: referred_users_v2.created_at,
      })
      .from(referred_users_v2)
      .innerJoin(
        referral_codes_v2,
        eq(referred_users_v2.referral_code_id, referral_codes_v2.id)
      )
      .leftJoin(
        user_clerk,
        eq(user_clerk.discord_id, referral_codes_v2.user_id)
      )
      .where(eq(referred_users_v2.referred_user_id, discordId))
      .limit(1);

    if (!record) {
      return null;
    }

    return {
      code: record.code,
      referrerDiscordId: record.referrerDiscordId,
      referrerDiscordUsername: record.referrerDiscordUsername ?? null,
      referrerEmail: record.referrerEmail ?? null,
      referredAt: record.referredAt,
      boostEndsAt: new Date(
        record.referredAt.getTime() + REFERRAL_NEW_USER_BONUS_DURATION_MS
      ),
    };
  }),

  createReferralCode: protectedProcedure.mutation(async ({ ctx }) => {
    const discordId = ctx.user?.discordId;

    if (!discordId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "A linked Discord account is required",
      });
    }

    const [existingCode] = await db
      .select({ id: referral_codes_v2.id })
      .from(referral_codes_v2)
      .where(eq(referral_codes_v2.user_id, discordId))
      .limit(1);

    if (existingCode) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "You already created a referral code",
      });
    }

    const code = await createUniqueReferralCode();

    await db.insert(referral_codes_v2).values({
      user_id: discordId,
      code,
    });

    const referralLink = buildReferralLink(code);

    let shareCardUrl: string | null = null;
    try {
      const result = await generateAndUploadShareCard({
        userId: discordId,
        code,
        referralLink,
      });

      shareCardUrl = result.shareCardUrl;
    } catch (error) {
      console.error("Failed to generate share card", error);
    }

    return {
      code,
      shareCardUrl,
      referralLink,
    };
  }),

  regenerateShareCard: protectedProcedure.mutation(async ({ ctx }) => {
    const discordId = ctx.user?.discordId;

    if (!discordId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "A linked Discord account is required",
      });
    }

    const [existingCode] = await db
      .select({ code: referral_codes_v2.code })
      .from(referral_codes_v2)
      .where(eq(referral_codes_v2.user_id, discordId))
      .limit(1);

    if (!existingCode) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Create a referral code first",
      });
    }

    const referralLink = buildReferralLink(existingCode.code);
    const result = await generateAndUploadShareCard({
      userId: discordId,
      code: existingCode.code,
      referralLink,
    });

    return {
      code: existingCode.code,
      shareCardUrl: result.shareCardUrl,
      referralLink: result.referralLink,
    };
  }),

  validateCode: publicProcedure
    .input(z.object({ code: z.string().min(1).max(255) }))
    .mutation(async ({ input }) => {
      const code = normalizeReferralCode(input.code);
      if (!code) {
        return { isValid: false };
      }

      const [record] = await db
        .select({ id: referral_codes_v2.id })
        .from(referral_codes_v2)
        .where(eq(referral_codes_v2.code, code))
        .limit(1);

      return { isValid: Boolean(record) };
    }),

  attachReferralToUser: protectedProcedure
    .input(z.object({ code: z.string().min(1).max(255) }))
    .mutation(async ({ ctx, input }) => {
      const code = normalizeReferralCode(input.code);
      if (!code) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Referral code is required",
        });
      }

      const userId = ctx.user?.discordId;
      if (!userId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "A linked Discord account is required",
        });
      }

      const clerkUserCreatedAt = ctx.user?.clerkUserCreatedAt;
      if (!clerkUserCreatedAt) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Unable to verify account age",
        });
      }

      if (clerkUserCreatedAt < REFERRAL_FEATURE_RELEASE_DATE) {
        return { attached: false, reason: "FEATURE_NOT_ELIGIBLE" as const };
      }

      const [existingRewards] = await db
        .select({ id: balance_entries.id })
        .from(balance_entries)
        .where(eq(balance_entries.user_id, userId))
        .limit(1);

      if (existingRewards) {
        return { attached: false, reason: "HAS_REWARDS" as const };
      }

      const [codeRecord] = await db
        .select({
          id: referral_codes_v2.id,
          userId: referral_codes_v2.user_id,
        })
        .from(referral_codes_v2)
        .where(eq(referral_codes_v2.code, code))
        .limit(1);

      if (!codeRecord) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Referral code not found",
        });
      }

      if (codeRecord.userId === userId) {
        return { attached: false, reason: "SELF_REFERRAL" as const };
      }

      const [existingRecord] = await db
        .select({ id: referred_users_v2.id })
        .from(referred_users_v2)
        .where(eq(referred_users_v2.referred_user_id, userId))
        .limit(1);

      if (existingRecord) {
        return { attached: false, reason: "ALREADY_ATTACHED" as const };
      }

      await db.insert(referred_users_v2).values({
        referral_code_id: codeRecord.id,
        referred_user_id: userId,
      });

      return { attached: true as const };
    }),
});
