import { clerkClient } from "@clerk/express";
import { TRPCError } from "@trpc/server";
import {
  and,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  isNotNull,
  like,
  or,
  sql,
} from "drizzle-orm";
import { z } from "zod";
import {
  BannedUserMetadata,
  bustBannedUserCache,
  getBannedUser,
} from "../lib/banned-users";
import {
  PurgeCampaignResult,
  getBanPurgePreview,
  getUnbanRepayPreview,
  purgeUserClipsFromCampaigns,
  repayUserClipsForCampaigns,
} from "../lib/banPurge";
import { db } from "../lib/db";
import { env } from "../lib/env";
import { revokeSubmissionReward } from "../lib/revokeSubmissionReward";
import { wiseApi, WiseApiError } from "../lib/wise";
import { restoreDeletedSubmission } from "../lib/restoreDeletedSubmission";
import {
  balance_entries,
  balances,
  bank_accounts,
  banned_social_media_users,
  banned_users,
  campaign_cpm_group_members,
  campaigns,
  crypto_withdrawals,
  demographics_verification_v2,
  non_campaign_clips,
  submissions,
  user_clerk,
  wise_withdrawals,
  verified_login_credentials,
  verified_users,
  wise_recipient,
} from "../lib/schema";
import {
  payoutsAdminRoleProcedure,
  protectedProcedure,
  rewardsModeratorRoleProcedure,
  router,
  userActivityRoleProcedure,
  ROLES,
} from "../lib/trpc";
import { WithdrawalCancellationMetadata } from "../lib/zod-schemas/withdrawalMetadata";
export const userRouter = router({
  discordStatus: protectedProcedure.query(({ ctx }) => {
    return {
      connected: !!ctx.user.discordId,
      username: ctx.user.discordUsername ?? null,
    };
  }),

  getProfile: protectedProcedure.query(async ({ ctx }) => {
    const discordId = ctx.user?.discordId;
    if (!discordId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "A linked Discord account is required",
      });
    }

    const record = await db.query.user_clerk.findFirst({
      where: eq(user_clerk.discord_id, discordId),
    });

    if (!record) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "User was not found",
      });
    }

    return {
      discordId: record.discord_id,
      firstName: record.first_name,
      lastName: record.last_name,
      email: record.email,
      phoneNumber: record.phone_number,
      phoneCountryCode: record.phone_country_code,
      imageUrl: record.image_url,
      createdAt: record.created_at,
    };
  }),

  updatePhoneNumber: protectedProcedure
    .input(
      z.object({
        phoneNumber: z
          .string()
          .trim(),
        phoneCountryCode: z
          .string()
          .min(1, "Country code is required")
          .max(8, "Country code is too long")
          .trim(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const discordId = ctx.user?.discordId;
      if (!discordId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "A linked Discord account is required",
        });
      }

      const cleaned = input.phoneNumber.replace(/\s+/g, " ");
      const countryCode = input.phoneCountryCode.trim();

      const record = await db.query.user_clerk.findFirst({
        where: eq(user_clerk.discord_id, discordId),
      });

      if (!record) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User was not found",
        });
      }

      await db
        .update(user_clerk)
        .set({
          phone_number: cleaned,
          phone_country_code: countryCode,
          updated_at: new Date(),
        })
        .where(eq(user_clerk.discord_id, discordId));

      return { phoneNumber: cleaned, phoneCountryCode: countryCode };
    }),

  getActivity: userActivityRoleProcedure
    .input(z.object({ userId: z.string().min(1, "User is required") }))
    .query(async ({ input }) => {
      const { userId } = input;
      const isDev = env.NODE_ENV === "development";

      const userRecord = await db.query.user_clerk.findFirst({
        where: eq(user_clerk.discord_id, userId),
      });

      if (!userRecord) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User was not found",
        });
      }

      const userBan = await getBannedUser(userId, isDev);

      const handles = await db
        .select({
          id: verified_users.id,
          platform: verified_users.platform,
          handle: verified_users.handle,
          username: verified_users.username,
          verified: verified_users.verified,
          updatedAt: verified_users.updated_at,
          accountDeletedAt: verified_users.account_deleted_at,
          accountUnavailableStrikes: verified_users.account_unavailable_strikes,
          verificationMethod: verified_login_credentials.verification_method,
          loginCredsUserId: verified_login_credentials.user_id,
          loginCredsEmail: verified_login_credentials.email,
          loginCredsPassword: verified_login_credentials.password,
          loginCredsForwardingEmail:
            verified_login_credentials.forwarding_email,
          loginCredsManuallyVerifiedAt:
            verified_login_credentials.login_creds_manually_verified_at,
        })
        .from(verified_users)
        .leftJoin(
          verified_login_credentials,
          eq(
            verified_users.verified_login_credentials_id,
            verified_login_credentials.id
          )
        )
        .where(
          and(
            eq(verified_users.discord_id, userId),
            isNull(verified_users.deleted_at)
          )
        )
        .orderBy(desc(verified_users.updated_at))
        .limit(50);

      const normalizedHandlePairs = handles.map((handle) => ({
        normalized: handle.handle.toLowerCase(),
        platform: handle.platform,
      }));

      const uniqueHandles = Array.from(
        new Set(normalizedHandlePairs.map((pair) => pair.normalized))
      );
      const uniquePlatforms = Array.from(
        new Set(normalizedHandlePairs.map((pair) => pair.platform))
      );

      const bannedHandleRecords =
        normalizedHandlePairs.length === 0
          ? []
          : await db
            .select({
              id: banned_social_media_users.id,
              handle: banned_social_media_users.handle,
              platform: banned_social_media_users.platform,
              reason: banned_social_media_users.reason,
              createdAt: banned_social_media_users.created_at,
              createdBy: banned_social_media_users.created_by,
            })
            .from(banned_social_media_users)
            .where(
              and(
                inArray(banned_social_media_users.handle, uniqueHandles),
                inArray(banned_social_media_users.platform, uniquePlatforms)
              )
            );

      const bannedHandleMap = new Map(
        bannedHandleRecords.map((record) => [
          `${record.platform}:${record.handle}`,
          record,
        ])
      );

      const submissionsData = await db
        .select({
          id: submissions.id,
          url: submissions.url,
          platform: submissions.platform,
          status: submissions.status,
          views: submissions.views,
          reward: submissions.reward,
          createdAt: submissions.created_at,
          campaignTitle: campaigns.title,
          deletedAt: submissions.deleted_at,
          unavailableStrikes: submissions.unavailable_strikes,
          // Feature 5: the non-campaign clip that redeems this campaign clip
          // (only meaningful on campaigns that require NC clips). Lets a mod see
          // the linked NC clip + its review status right on the activity page.
          campaignNcRequired: campaigns.non_campaign_clips_required,
          ncUrl: non_campaign_clips.url,
          ncPlatform: non_campaign_clips.platform,
          ncStatus: non_campaign_clips.status,
          ncRejectedReason: non_campaign_clips.rejected_reason,
        })
        .from(submissions)
        .leftJoin(campaigns, eq(submissions.campaign_id, campaigns.id))
        .leftJoin(
          non_campaign_clips,
          eq(submissions.redeemed_by_non_campaign_clip_id, non_campaign_clips.id)
        )
        .where(eq(submissions.user_id, userId))
        .orderBy(desc(submissions.created_at))
        .limit(100);

      // Feature 4: reels deleted AFTER their campaign's end_date — i.e. the
      // clipper took a reel down inside the "must stay live 3 months after the
      // campaign ends" window. Surfaced for a ban decision.
      const postCampaignDeletedClips = await db
        .select({
          id: submissions.id,
          url: submissions.url,
          platform: submissions.platform,
          views: submissions.views,
          reward: submissions.reward,
          deletedClawedBack: submissions.deleted_clawed_back,
          campaignTitle: campaigns.title,
          endDate: campaigns.end_date,
          deletedAt: submissions.deleted_at,
        })
        .from(submissions)
        .innerJoin(campaigns, eq(submissions.campaign_id, campaigns.id))
        .where(
          and(
            eq(submissions.user_id, userId),
            isNotNull(submissions.deleted_at),
            isNotNull(campaigns.end_date),
            gt(submissions.deleted_at, campaigns.end_date)
          )
        )
        .orderBy(desc(submissions.deleted_at));

      const [submissionsCountRow] = await db
        .select({ total: count(submissions.id) })
        .from(submissions)
        .where(eq(submissions.user_id, userId));

      // Count autoreject submissions across the user's full history (not just
      // the 100 most-recent in submissionsData). Surfaces the bulk-requeue
      // action even when the autoreject clips are older than the visible page.
      const [autoRejectCountRow] = await db
        .select({ total: count(submissions.id) })
        .from(submissions)
        .where(
          and(
            eq(submissions.user_id, userId),
            eq(submissions.status, "autoreject")
          )
        );

      const [balanceRow] = await db
        .select({
          balance: balances.balance,
          totalEarned: balances.totalEarned,
        })
        .from(balances)
        .where(eq(balances.user_id, userId))
        .limit(1);

      const entries = await db
        .select({
          id: balance_entries.id,
          amount: balance_entries.amount,
          type: balance_entries.type,
          memo: balance_entries.memo,
          currency: balance_entries.currency,
          createdAt: balance_entries.created_at,
          metadata: balance_entries.metadata,
        })
        .from(balance_entries)
        .where(
          and(
            eq(balance_entries.user_id, userId),
            gt(balance_entries.created_at, new Date("2025-11-17T15:51:00Z"))
          )
        )
        .orderBy(desc(balance_entries.created_at));

      const demographicsVerifications = await db
        .select({
          id: demographics_verification_v2.id,
          campaignId: demographics_verification_v2.campaign_id,
          campaignTitle: campaigns.title,
          status: demographics_verification_v2.status,
          approvalMethod: demographics_verification_v2.approval_method,
          screenshotFileUrl: demographics_verification_v2.screenshot_file_url,
          createdAt: demographics_verification_v2.created_at,
          updatedAt: demographics_verification_v2.updated_at,
          verifiedHandle: verified_users.handle,
          verifiedUsername: verified_users.username,
          verifiedPlatform: verified_users.platform,
          viewsFromSubmissionsSnapshot:
            demographics_verification_v2.views_from_submissions_snapshot,
          exemptionReason: demographics_verification_v2.exemption_reason,
        })
        .from(demographics_verification_v2)
        .leftJoin(
          campaigns,
          eq(demographics_verification_v2.campaign_id, campaigns.id)
        )
        .leftJoin(
          verified_users,
          eq(demographics_verification_v2.verified_user_id, verified_users.id)
        )
        .where(eq(demographics_verification_v2.user_id, userId))
        .orderBy(desc(demographics_verification_v2.created_at));

      const totalSubmissions = Number(submissionsCountRow?.total ?? 0);

      const handlesWithBan = handles.map((handle) => {
        const normalizedHandle = handle.handle.toLowerCase();
        const banRecord = bannedHandleMap.get(
          `${handle.platform}:${normalizedHandle}`
        );

        return {
          ...handle,
          verified: Boolean(handle.verified),
          banStatus: banRecord
            ? {
              reason: banRecord.reason ?? null,
              createdAt: banRecord.createdAt,
              createdBy: banRecord.createdBy ?? null,
            }
            : null,
        };
      });

      return {
        user: {
          discordId: userRecord.discord_id,
          firstName: userRecord.first_name,
          lastName: userRecord.last_name,
          email: userRecord.email,
          phoneNumber: userRecord.phone_number,
          phoneCountryCode: userRecord.phone_country_code,
          imageUrl: userRecord.image_url,
          discordUsername: userRecord.discord_username,
          createdAt: userRecord.created_at,
          banStatus: userBan
            ? {
              reason: userBan.reason ?? null,
              createdAt: userBan.created_at,
              createdBy: userBan.created_by ?? null,
            }
            : null,
        },
        handles: handlesWithBan,
        submissions: submissionsData.map(
          ({
            campaignNcRequired,
            ncUrl,
            ncPlatform,
            ncStatus,
            ncRejectedReason,
            ...submission
          }) => ({
            ...submission,
            views: Number(submission.views ?? 0),
            reward: Number(submission.reward ?? 0),
            // Whether this clip's campaign requires non-campaign clips at all.
            ncRequired: (campaignNcRequired ?? 0) > 0,
            // The linked NC clip (null if none / campaign doesn't require NC).
            nonCampaignClip:
              (campaignNcRequired ?? 0) > 0 && ncUrl
                ? {
                    url: ncUrl,
                    platform: ncPlatform,
                    status: ncStatus,
                    rejectedReason: ncRejectedReason ?? null,
                  }
                : null,
          })
        ),
        postCampaignDeletedClips: postCampaignDeletedClips.map((c) => ({
          ...c,
          views: Number(c.views ?? 0),
          reward: Number(c.reward ?? 0),
          deletedClawedBack: Boolean(c.deletedClawedBack),
        })),
        totalSubmissions,
        autoRejectCount: Number(autoRejectCountRow?.total ?? 0),
        earnings: {
          currentBalance: Number(balanceRow?.balance ?? 0),
          totalEarned: Number(balanceRow?.totalEarned ?? 0),
          entries: entries.map((entry) => ({
            id: entry.id,
            amount: Number(entry.amount ?? 0),
            type: entry.type,
            memo: entry.memo ?? null,
            currency: entry.currency ?? "USD",
            createdAt: entry.createdAt,
            metadata: entry.metadata ?? null,
          })),
        },
        demographicsVerifications: demographicsVerifications.map(
          (verification) => ({
            ...verification,
            viewsFromSubmissionsSnapshot: Number(
              verification.viewsFromSubmissionsSnapshot ?? 0
            ),
          })
        ),
      };
    }),

  // Feature 7: a clipper's bank/payout details for the user page. Gated to
  // payouts-admin only, and the account number is masked to the last 4.
  // Visible to anyone who can see the User Activity page (same gate as the page
  // itself). The account number is masked to last-4 below, so this is safe to
  // surface to all user-activity mods. (Was wrongly behind payoutsAdminRoleProcedure,
  // which also checks the wrong role — see trpc.ts — so mods couldn't see it.)
  getBankDetails: userActivityRoleProcedure
    .input(z.object({ userId: z.string().min(1, "User is required") }))
    .query(async ({ input }) => {
      const [acct] = await db
        .select()
        .from(bank_accounts)
        .where(eq(bank_accounts.user_id, input.userId))
        .orderBy(desc(bank_accounts.created_at))
        .limit(1);
      if (!acct) return null;

      const maskAccount = (n: string | null) => {
        if (!n) return null;
        const s = String(n);
        return s.length > 4 ? `•••• ${s.slice(-4)}` : s;
      };

      return {
        accountHolder: acct.account_holder ?? acct.name ?? null,
        bankName: acct.bank_name ?? null,
        accountNumberMasked: maskAccount(acct.account_number),
        ifscCode: acct.ifsc_code ?? null,
        branchName: acct.branch_name ?? null,
        recipientEmail: acct.recipient_email ?? null,
        targetCurrency: acct.target_currency ?? null,
        addressCity: acct.address_city ?? null,
        addressCountryCode: acct.address_country_code ?? null,
        createdAt: acct.created_at,
      };
    }),

  // Live bank details straight from Wise.
  //
  // getBankDetails above reads bank_accounts, which is a snapshot that stopped
  // being written in Nov 2025 — 246 rows against 967 Wise recipients — so mods
  // were shown an account holder the clipper may not have used for months.
  // This pulls the CURRENT recipient from Wise, refreshes the cached row so the
  // plain query improves too, and returns the same shape getBankDetails does.
  refreshBankDetails: userActivityRoleProcedure
    .input(z.object({ userId: z.string().min(1, "User is required") }))
    .mutation(async ({ input }) => {
      const [recipient] = await db
        .select({ recipientId: wise_recipient.recipient_id })
        .from(wise_recipient)
        .where(eq(wise_recipient.user_id, input.userId))
        .limit(1);

      if (!recipient?.recipientId) {
        return {
          ok: false as const,
          reason: "no-recipient" as const,
          message:
            "This clipper has no Wise recipient yet — they haven't set up payout details.",
          details: null,
        };
      }

      let acct;
      try {
        acct = await wiseApi.getRecipientAccount(recipient.recipientId);
      } catch (error) {
        const status =
          error instanceof WiseApiError ? error.status : undefined;
        return {
          ok: false as const,
          reason: "wise-error" as const,
          message:
            status === 404
              ? `Wise no longer has recipient ${recipient.recipientId} — it was deleted on their side.`
              : `Couldn't reach Wise${status ? ` (HTTP ${status})` : ""}. Try again in a moment.`,
          details: null,
        };
      }

      const d = (acct.details ?? {}) as Record<string, any>;
      const addr = (d.address ?? {}) as Record<string, any>;
      const accountNumber =
        d.accountNumber ?? d.iban ?? d.bankCode ?? null;

      // Refresh the cache so the non-live view stops showing stale data too.
      const row = {
        user_id: input.userId,
        name: acct.accountHolderName ?? null,
        account_holder: acct.accountHolderName ?? null,
        account_number: accountNumber ? String(accountNumber) : null,
        ifsc_code: d.ifscCode ?? null,
        bank_name: d.bankName ?? null,
        recipient_email: d.email ?? null,
        target_currency: acct.currency ?? null,
        address_country_code: addr.countryCode ?? acct.country ?? null,
        address_city: addr.city ?? null,
        address_first_line: addr.firstLine ?? null,
        address_post_code: addr.postCode ?? null,
      };
      const [existing] = await db
        .select({ id: bank_accounts.id })
        .from(bank_accounts)
        .where(eq(bank_accounts.user_id, input.userId))
        .orderBy(desc(bank_accounts.created_at))
        .limit(1);
      if (existing) {
        await db
          .update(bank_accounts)
          .set(row)
          .where(eq(bank_accounts.id, existing.id));
      } else {
        await db.insert(bank_accounts).values(row);
      }

      const masked = accountNumber
        ? String(accountNumber).length > 4
          ? `•••• ${String(accountNumber).slice(-4)}`
          : String(accountNumber)
        : null;

      return {
        ok: true as const,
        reason: null,
        message: null,
        details: {
          accountHolder: acct.accountHolderName ?? null,
          bankName: d.bankName ?? null,
          accountNumberMasked: masked,
          ifscCode: d.ifscCode ?? null,
          branchName: d.branchName ?? null,
          recipientEmail: d.email ?? null,
          targetCurrency: acct.currency ?? null,
          addressCity: addr.city ?? null,
          addressCountryCode: addr.countryCode ?? acct.country ?? null,
          wiseRecipientId: String(recipient.recipientId),
          fetchedAt: new Date().toISOString(),
        },
      };
    }),

  lookupByHandle: userActivityRoleProcedure
    .input(z.object({ handle: z.string().min(1, "Handle is required") }))
    .query(async ({ input }) => {
      const normalizedHandle = input.handle.trim().replace(/^@/, "");

      if (!normalizedHandle) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Enter a handle to search",
        });
      }

      const record = await db
        .select({
          handleId: verified_users.id,
          handle: verified_users.handle,
          username: verified_users.username,
          platform: verified_users.platform,
          verified: verified_users.verified,
          updatedAt: verified_users.updated_at,
          discordId: verified_users.discord_id,
          user: {
            discordId: user_clerk.discord_id,
            firstName: user_clerk.first_name,
            lastName: user_clerk.last_name,
            email: user_clerk.email,
            imageUrl: user_clerk.image_url,
          },
        })
        .from(verified_users)
        .leftJoin(
          user_clerk,
          eq(user_clerk.discord_id, verified_users.discord_id)
        )
        .where(eq(verified_users.handle, normalizedHandle))
        .orderBy(desc(verified_users.updated_at))
        .limit(1);

      const [match] = record;
      if (!match) {
        return null;
      }

      return {
        handle: {
          id: match.handleId,
          handle: match.handle,
          username: match.username,
          platform: match.platform,
          verified: Boolean(match.verified),
          updatedAt: match.updatedAt,
          discordId: match.discordId,
        },
        user: match.user?.discordId
          ? {
            discordId: match.user.discordId,
            firstName: match.user.firstName,
            lastName: match.user.lastName,
            email: match.user.email,
            imageUrl: match.user.imageUrl,
          }
          : null,
      };
    }),

  listUsers: userActivityRoleProcedure
    .input(
      z.object({
        query: z
          .string()
          .trim()
          .min(2, "Enter at least 2 characters to search")
          .max(200),
        limit: z.number().min(1).max(50).optional(),
      })
    )
    .query(async ({ input }) => {
      const limit = input.limit ?? 20;
      const query = input.query.trim();
      const escapedQuery = query.replace(/[\\%_]/g, (char) => `\\${char}`);
      const likePattern = `%${escapedQuery}%`;
      const fullNameExpr = sql<string>`concat_ws(' ', ${user_clerk.first_name}, ${user_clerk.last_name})`;

      // Phone search: strip the query to digits only and match it against
      // a digits-only normalization of `phone_country_code + phone_number`
      // so users can search "9039331407", "+919039331407", "+91 9039331407",
      // "+91-9039331407" — all hit the same row.
      // We only enable phone matching when the digits substring is at least
      // 4 chars to avoid matching tons of rows on a 1-2 digit query.
      const digitsOnlyQuery = query.replace(/\D/g, "");
      const phoneFilter =
        digitsOnlyQuery.length >= 4
          ? sql`REGEXP_REPLACE(CONCAT(IFNULL(${user_clerk.phone_country_code},''), IFNULL(${user_clerk.phone_number},'')), '[^0-9]', '') LIKE ${`%${digitsOnlyQuery}%`}`
          : null;

      const filters = or(
        like(user_clerk.discord_id, likePattern),
        like(user_clerk.discord_username, likePattern),
        like(user_clerk.email, likePattern),
        like(user_clerk.first_name, likePattern),
        like(user_clerk.last_name, likePattern),
        like(fullNameExpr, likePattern),
        ...(phoneFilter ? [phoneFilter] : [])
      );

      const users = await db
        .select({
          discordId: user_clerk.discord_id,
          discordUsername: user_clerk.discord_username,
          email: user_clerk.email,
          firstName: user_clerk.first_name,
          lastName: user_clerk.last_name,
          imageUrl: user_clerk.image_url,
          createdAt: user_clerk.created_at,
        })
        .from(user_clerk)
        .where(filters)
        .orderBy(desc(user_clerk.created_at))
        .limit(limit);

      return users;
    }),

  listBannedUsers: userActivityRoleProcedure.query(async () => {
    const bannedUsersList = await db
      .select({
        id: banned_users.id,
        userId: banned_users.user_id,
        reason: banned_users.reason,
        createdAt: banned_users.created_at,
        updatedAt: banned_users.updated_at,
        createdBy: banned_users.created_by,
        user: {
          discordId: user_clerk.discord_id,
          firstName: user_clerk.first_name,
          lastName: user_clerk.last_name,
          email: user_clerk.email,
          imageUrl: user_clerk.image_url,
          discordUsername: user_clerk.discord_username,
        },
      })
      .from(banned_users)
      .leftJoin(user_clerk, eq(banned_users.user_id, user_clerk.discord_id))
      .orderBy(desc(banned_users.created_at));

    return bannedUsersList.map((record) => ({
      ...record,
      user: record.user?.discordId
        ? {
          discordId: record.user.discordId,
          firstName: record.user.firstName,
          lastName: record.user.lastName,
          email: record.user.email,
          imageUrl: record.user.imageUrl,
          discordUsername: record.user.discordUsername,
        }
        : null,
    }));
  }),

  listBannedHandles: userActivityRoleProcedure.query(async () => {
    return db
      .select({
        id: banned_social_media_users.id,
        platform: banned_social_media_users.platform,
        handle: banned_social_media_users.handle,
        reason: banned_social_media_users.reason,
        createdAt: banned_social_media_users.created_at,
        updatedAt: banned_social_media_users.updated_at,
        createdBy: banned_social_media_users.created_by,
      })
      .from(banned_social_media_users)
      .orderBy(desc(banned_social_media_users.created_at));
  }),

  // What a ban purge would strip out, per campaign. Read-only — drives the
  // campaign checkboxes in the ban dialog so a mod sees the damage first.
  banPurgePreview: userActivityRoleProcedure
    .input(z.object({ userId: z.string().min(1, "User ID is required") }))
    .query(async ({ input }) => getBanPurgePreview(input.userId)),

  banUser: userActivityRoleProcedure
    .input(
      z.object({
        userId: z.string().min(1, "User ID is required"),
        reason: z.string().trim().min(1, "A reason is required to ban").max(500),
        // Campaigns to strip this user out of entirely: their clips are
        // rejected (so views + reward leave the campaign totals and the view
        // cron stops touching them) and the money is clawed back. Empty =
        // ban them going forward only, leave history alone.
        purgeCampaignIds: z.array(z.string().min(1)).default([]),
      })
    )
    .mutation(async ({ input, ctx }) => {
      await db
        .insert(banned_users)
        .values({
          user_id: input.userId,
          reason: input.reason ?? null,
          created_by: ctx.user?.id ?? null,
        })
        .onDuplicateKeyUpdate({
          set: {
            reason: input.reason ?? null,
            created_by: ctx.user?.id ?? null,
            updated_at: new Date(),
          },
        });

      const bannedRecord = await db.query.banned_users.findFirst({
        where: eq(banned_users.user_id, input.userId),
      });

      await syncClerkBanMetadata(input.userId, {
        reason: bannedRecord?.reason ?? null,
        createdAt: bannedRecord?.created_at?.toISOString?.() ?? null,
        createdBy: bannedRecord?.created_by ?? null,
      });

      bustBannedUserCache(input.userId);

      try {
        await cancelRequestedWithdrawalsForUser(input.userId);
      } catch (error) {
        console.error("Failed to cancel requested withdrawals", error);
      }

      // Surfaced to the mod rather than swallowed. A failure here leaves a
      // live 'requested' claim on the account: the payout picker's ban filter
      // stops it being paid, but that also hides it from admins, so it sits
      // there holding a debited balance with nobody aware. Same for a claim
      // skipped because it is already in a batch — that one needs a human to
      // check whether the crypto actually went out.
      let cryptoClaimsCancelled = 0;
      let cryptoClaimsNeedingReview: string[] = [];
      let cryptoCancelFailed = false;
      try {
        const res = await cancelRequestedCryptoWithdrawalsForUser(input.userId);
        cryptoClaimsCancelled = res.cancelled;
        cryptoClaimsNeedingReview = res.skippedInFlight;
      } catch (error) {
        console.error("Failed to cancel requested crypto claims", error);
        cryptoCancelFailed = true;
      }

      // A banned user must not keep collecting a negotiated premium rate —
      // drop their CPM-group memberships so any submissions that later get
      // (re-)approved pay at the campaign base rate, not the group rate.
      try {
        await db
          .delete(campaign_cpm_group_members)
          .where(eq(campaign_cpm_group_members.user_id, input.userId));
      } catch (error) {
        console.error(
          "Failed to remove CPM group memberships for banned user",
          error
        );
      }

      // Optional purge. Runs AFTER the ban row exists so the payout guard is
      // already live — a cron firing mid-purge can't re-pay what we just took.
      //
      // Gated on the MONEY role, not the ban role. banUser sits behind
      // USER_ACTIVITY_READ, and the purge debits wallets with allowNegative.
      // restoreAccount above is deliberately gated on rewards-moderator so a
      // read-only user-activity mod "can't batch-re-credit wallets through
      // here" — leaving the purge ungated would open the exact inverse, a
      // read-role mod batch-DEBITING wallets into the negative. Banning stays
      // available to user-activity mods; only the money half is restricted.
      let purged: PurgeCampaignResult[] = [];
      if (input.purgeCampaignIds.length > 0) {
        if (!ctx.user?.roles?.includes(ROLES.REWARDS_MODERATOR)) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message:
              "Removing clips and money from campaigns needs the rewards-moderator role. The ban itself has been applied.",
          });
        }
        purged = await purgeUserClipsFromCampaigns(
          input.userId,
          input.purgeCampaignIds
        );
      }

      return {
        success: true,
        purged,
        cryptoClaimsCancelled,
        cryptoClaimsNeedingReview,
        cryptoCancelFailed,
      };
    }),

  // Restore a social ACCOUNT that was auto-flagged deleted (the channel came
  // back). Clears the deletion flag + strikes (and re-checks it next cron pass),
  // then restores every one of that account's deleted / at-risk clips — which
  // reverses their clawbacks and re-credits the clipper. restoreDeletedSubmission
  // is safe for clips that were only striked (never clawed): the clawback
  // reversal nets to zero.
  // Gated to the rewards-moderator (money) role — the SAME gate as the
  // per-clip submissions.restoreDeletedSubmission it calls in a loop — so a
  // read-only user-activity mod can't batch-re-credit wallets through here.
  restoreAccount: rewardsModeratorRoleProcedure
    .input(z.object({ verifiedUserId: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const [acc] = await db
        .select({ id: verified_users.id })
        .from(verified_users)
        .where(eq(verified_users.id, input.verifiedUserId))
        .limit(1);
      if (!acc) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Account not found" });
      }
      await db
        .update(verified_users)
        .set({
          account_deleted_at: null,
          account_unavailable_strikes: 0,
          account_last_checked_at: new Date(),
        })
        .where(eq(verified_users.id, input.verifiedUserId));

      const clips = await db
        .select({ id: submissions.id })
        .from(submissions)
        .where(
          and(
            eq(submissions.verified_user_id, input.verifiedUserId),
            or(
              isNotNull(submissions.deleted_at),
              gt(submissions.unavailable_strikes, 0)
            )
          )
        );
      let restored = 0;
      for (const clip of clips) {
        try {
          await restoreDeletedSubmission(clip.id);
          restored += 1;
        } catch (e) {
          console.error(`restoreAccount: failed to restore clip ${clip.id}`, e);
        }
      }
      return { restoredClips: restored, consideredClips: clips.length };
    }),

  // Manually claw back a deleted clip's reward from the clipper's balance.
  // For post-campaign deletions the auto-clawback no longer runs (the campaign
  // is settled), so a mod triggers this from the Clips Status panel. Reuses the
  // same revokeSubmissionReward (debt mode — can go negative) + the
  // deleted_clawed_back guard so a clip can never be clawed twice. Reversible
  // via the existing restore flow (it sums "clip_deletion" entries).
  manualClawbackDeletedClip: userActivityRoleProcedure
    .input(
      z.object({ submissionId: z.string().min(1, "Submission is required") })
    )
    .mutation(async ({ input }) => {
      const [sub] = await db
        .select({
          id: submissions.id,
          userId: submissions.user_id,
          campaignId: submissions.campaign_id,
          reward: submissions.reward,
          views: submissions.views,
          deletedAt: submissions.deleted_at,
          deletedClawedBack: submissions.deleted_clawed_back,
          url: submissions.url,
          platform: submissions.platform,
        })
        .from(submissions)
        .where(eq(submissions.id, input.submissionId))
        .limit(1);

      if (!sub) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Submission not found",
        });
      }
      if (!sub.deletedAt) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Only deleted clips can be clawed back here",
        });
      }
      if (sub.deletedClawedBack) {
        return { success: true, clawedBack: 0, alreadyClawedBack: true };
      }

      const reward = Number(sub.reward ?? 0);
      let clawedBack = reward;
      if (reward > 0) {
        // Reserve mode: cap at zero, open a reserve for any shortfall so it
        // shows in the Deleted clips panel for later collection.
        const result = await revokeSubmissionReward({
          submissionId: sub.id,
          userId: sub.userId,
          rewardAmount: reward,
          memo: `-$${reward.toFixed(2)} removed because this reel was deleted (after campaign end) on ${sub.platform}: ${sub.url}`,
          reason: "Manual deleted-clip clawback",
          sourceType: "clip_deletion",
          reserveOnShortfall: {
            campaignId: sub.campaignId,
            url: sub.url,
            platform: sub.platform,
            views: Number(sub.views ?? 0),
          },
        });
        clawedBack = result.deducted;
      }

      await db
        .update(submissions)
        .set({ deleted_clawed_back: true })
        .where(eq(submissions.id, sub.id));

      return { success: true, clawedBack };
    }),

  // Unlink a connected social account on a clipper's behalf.
  //
  // verification.removeVerification only ever lets a clipper unlink their OWN
  // account (it 404s on anyone else's), so until now a moderator had no way to
  // detach an account at all — the only options were banning the whole clipper
  // or editing the database by hand.
  //
  // Soft delete, exactly as the self-service path does: deleted_at is set and
  // verified cleared, which drops the account out of the view cron, the payout
  // baseline and the geo evaluator, while leaving its clips and their history
  // intact. It also frees the handle, so the same account can be re-linked
  // later through the normal verification flow.
  //
  // Deliberately does NOT touch money. Removing earnings is what the ban purge
  // is for, and conflating the two would make an unlink silently financial.
  adminUnlinkAccount: userActivityRoleProcedure
    .input(
      z.object({
        verifiedUserId: z.string().min(1, "Account is required"),
        reason: z.string().trim().max(500).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const [account] = await db
        .select({
          id: verified_users.id,
          handle: verified_users.handle,
          platform: verified_users.platform,
          discordId: verified_users.discord_id,
        })
        .from(verified_users)
        .where(
          and(
            eq(verified_users.id, input.verifiedUserId),
            isNull(verified_users.deleted_at)
          )
        )
        .limit(1);

      if (!account) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Account not found, or already unlinked.",
        });
      }

      await db
        .update(verified_users)
        .set({ deleted_at: new Date(), verified: false })
        .where(
          and(
            eq(verified_users.id, input.verifiedUserId),
            isNull(verified_users.deleted_at)
          )
        );

      console.log(
        `🔌 ${ctx.user?.id ?? "unknown"} unlinked ${account.platform}/@${account.handle} from ${account.discordId}${
          input.reason ? ` — ${input.reason}` : ""
        }`
      );

      return {
        success: true,
        handle: account.handle,
        platform: account.platform,
      };
    }),

  // Campaigns where a ban purge removed this clipper's clips, and what would
  // come back. Read-only — drives the campaign picker on the unban dialog.
  unbanRepayPreview: userActivityRoleProcedure
    .input(z.object({ userId: z.string().min(1, "User ID is required") }))
    .query(async ({ input }) => getUnbanRepayPreview(input.userId)),

  unbanUser: userActivityRoleProcedure
    .input(
      z.object({
        userId: z.string().min(1, "User ID is required"),
        // Campaigns to reinstate clips and money for. Empty (the default)
        // lifts the ban and returns nothing — reinstatement is a separate
        // judgement from unbanning, and a mod may want the account open again
        // without giving back money for work that was genuinely removed.
        repayCampaignIds: z.array(z.string()).default([]),
      })
    )
    .mutation(async ({ input }) => {
      await db
        .delete(banned_users)
        .where(eq(banned_users.user_id, input.userId));

      await syncClerkBanMetadata(input.userId, null);

      bustBannedUserCache(input.userId);

      // Repay AFTER the ban row is gone: reverseClawback re-credits the wallet,
      // and leaving the ban in place while money moves would mean the very next
      // payout run still treats the clipper as banned.
      //
      // Best-effort so a repay failure can't leave the account banned. The ban
      // has already been lifted at this point, and repay is idempotent — it
      // re-credits only the net still owed — so it can safely be retried from
      // the panel.
      let repaid: Awaited<ReturnType<typeof repayUserClipsForCampaigns>> = [];
      if (input.repayCampaignIds.length > 0) {
        try {
          repaid = await repayUserClipsForCampaigns(
            input.userId,
            input.repayCampaignIds
          );
        } catch (error) {
          console.error("Unban repay failed after lifting ban", error);
        }
      }

      return { success: true, repaid };
    }),

  banHandle: userActivityRoleProcedure
    .input(
      z.object({
        platform: z.enum(["youtube", "instagram", "tiktok", "x"]),
        handle: z.string().min(1, "Handle is required"),
        reason: z.string().trim().min(1, "A reason is required to ban").max(500),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const normalizedHandle = input.handle.trim().toLowerCase();

      await db
        .insert(banned_social_media_users)
        .values({
          platform: input.platform,
          handle: normalizedHandle,
          reason: input.reason ?? null,
          created_by: ctx.user?.id ?? null,
        })
        .onDuplicateKeyUpdate({
          set: {
            reason: input.reason ?? null,
            created_by: ctx.user?.id ?? null,
            updated_at: new Date(),
          },
        });

      await removeRewardsForHandle(input.platform, normalizedHandle);

      return { success: true };
    }),

  unbanHandle: userActivityRoleProcedure
    .input(
      z.object({
        platform: z.enum(["youtube", "instagram", "tiktok", "x"]),
        handle: z.string().min(1, "Handle is required"),
      })
    )
    .mutation(async ({ input }) => {
      const normalizedHandle = input.handle.trim().toLowerCase();

      await db
        .delete(banned_social_media_users)
        .where(
          and(
            eq(banned_social_media_users.platform, input.platform),
            eq(banned_social_media_users.handle, normalizedHandle)
          )
        );

      return { success: true };
    }),

  // Bulk-flips this user's `autoreject` submissions back to `pending` so they
  // reappear in the moderator queue. Used to recover clips the external
  // Discord bot auto-rejected — see the autoreject triggers on prod's
  // submissions table.
  requeueAutoRejectedSubmissions: userActivityRoleProcedure
    .input(z.object({ userId: z.string().min(1, "User ID is required") }))
    .mutation(async ({ input }) => {
      const targets = await db
        .select({ id: submissions.id })
        .from(submissions)
        .where(
          and(
            eq(submissions.user_id, input.userId),
            eq(submissions.status, "autoreject")
          )
        );

      if (targets.length === 0) {
        return { updatedCount: 0 };
      }

      await db
        .update(submissions)
        .set({
          status: "pending",
          rejected_reason: null,
          reviewed_by: "unknown",
          reviewer_assignment_user_id: null,
          is_resubmit_prevented: false,
        })
        .where(
          and(
            eq(submissions.user_id, input.userId),
            eq(submissions.status, "autoreject")
          )
        );

      return { updatedCount: targets.length };
    }),
});

type SocialPlatform = "youtube" | "instagram" | "tiktok" | "x";

async function removeRewardsForHandle(
  platform: SocialPlatform,
  normalizedHandle: string
) {
  const submissionsToAdjust = await db
    .select({
      id: submissions.id,
      userId: submissions.user_id,
      reward: submissions.reward,
    })
    .from(submissions)
    .innerJoin(
      verified_users,
      eq(verified_users.id, submissions.verified_user_id)
    )
    .where(
      and(
        eq(verified_users.platform, platform),
        eq(sql<string>`LOWER(${verified_users.handle})`, normalizedHandle),
        gt(submissions.reward, 0),
        isNull(verified_users.deleted_at)
      )
    );

  if (submissionsToAdjust.length === 0) {
    return;
  }

  for (const submission of submissionsToAdjust) {
    await revokeSubmissionReward({
      submissionId: submission.id,
      userId: submission.userId,
      rewardAmount: Number(submission.reward ?? 0),
      memo: "Submission reward removed after handle ban",
      reason: "Submission reward removed after handle ban",
      sourceType: "handle_ban",
    });
  }
}

// Crypto claims used to survive a ban completely — cancelRequestedWithdrawals
// only ever queried wise_withdrawals, so a banned clipper's crypto claim kept
// status 'requested' with a null batch_id, which is exactly what the payout
// picker selects. It could be batched, exported to CSV and hand-sent, and a
// paid crypto claim can never be returned. Refunds to balance the same way an
// admin "return to balance" does, so the ban purge can then take it back.
// Returns the claims it deliberately left alone, so the caller can surface
// them for manual reconciliation instead of failing silently.
async function cancelRequestedCryptoWithdrawalsForUser(
  userId: string
): Promise<{ cancelled: number; skippedInFlight: string[] }> {
  // UNLOCKED snapshot first, exactly like the Wise twin below. The earlier
  // version took a locking read over `user_id = ? AND status = 'requested'`,
  // a RANGE predicate on non-unique indexes — under REPEATABLE READ that
  // takes gap locks EVEN WHEN IT MATCHES NOTHING, which is the common case
  // for most bans. requestMyWithdrawal locks balances→crypto_withdrawals
  // while this locked crypto_withdrawals→balances, so a mod banning while
  // the clipper clicked Claim deadlocked, and InnoDB killed one at random.
  // Snapshot unlocked, then lock each row BY PRIMARY KEY: record locks only,
  // no gaps, and the lock order can no longer invert.
  const candidates = await db
    .select({ id: crypto_withdrawals.id })
    .from(crypto_withdrawals)
    .where(
      and(
        eq(crypto_withdrawals.user_id, userId),
        eq(crypto_withdrawals.status, "requested")
      )
    );

  const skippedInFlight: string[] = [];
  let cancelled = 0;

  for (const candidate of candidates) {
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`select 1 from ${crypto_withdrawals} where ${crypto_withdrawals.id} = ${candidate.id} for update`
      );
      const [row] = await tx
        .select()
        .from(crypto_withdrawals)
        .where(eq(crypto_withdrawals.id, candidate.id))
        .limit(1);
      // Re-check under the lock: the snapshot above was unlocked, so the
      // clipper's own cancel or an admin return may already have settled it.
      if (!row || row.status !== "requested") return;

      // NEVER refund a claim that is already in a batch. Crypto payment is
      // manual — an admin batches, exports CSV, sends by hand, and only then
      // calls markPaid. Between "sent" and "marked paid" the row is still
      // 'requested', just with a batch_id. Refunding it would hand back money
      // that has already left, and the clipper keeps both. The clipper's own
      // cancel refuses this case too ("This claim is being processed for
      // payment"); this path just has no human in the loop, so it must be
      // stricter, not looser.
      if (row.batch_id) {
        skippedInFlight.push(row.id);
        return;
      }

      await tx.execute(
        sql`select 1 from ${balances} where ${balances.user_id} = ${row.user_id} for update`
      );
      await tx
        .update(balances)
        .set({ balance: sql`${balances.balance} + ${row.amount}` })
        .where(eq(balances.user_id, row.user_id));
      await tx.insert(balance_entries).values({
        user_id: row.user_id,
        amount: row.amount,
        type: "withdrawal_refund",
        source_type: "crypto_withdrawal_return",
        source_id: row.id,
        memo: "Crypto claim cancelled — user banned",
      });
      await tx
        .update(crypto_withdrawals)
        .set({ status: "returned", batch_id: null })
        .where(eq(crypto_withdrawals.id, row.id));
      cancelled += 1;
    });
  }

  return { cancelled, skippedInFlight };
}

async function cancelRequestedWithdrawalsForUser(userId: string) {
  const requestedWithdrawals = await db
    .select()
    .from(wise_withdrawals)
    .where(
      and(
        eq(wise_withdrawals.user_id, userId),
        eq(wise_withdrawals.status, "requested")
      )
    );

  if (requestedWithdrawals.length === 0) {
    return;
  }

  await db.transaction(async (tx) => {
    for (const withdrawal of requestedWithdrawals) {
      // Lock + re-check inside the tx: the snapshot above is unlocked, so a
      // concurrent user cancel could have already deleted-and-refunded this
      // row. Skip any row that is no longer "requested" to avoid crediting
      // the refund twice.
      await tx.execute(
        sql`select 1 from ${wise_withdrawals} where ${wise_withdrawals.id} = ${withdrawal.id} for update`
      );
      const [locked] = await tx
        .select({ status: wise_withdrawals.status })
        .from(wise_withdrawals)
        .where(eq(wise_withdrawals.id, withdrawal.id))
        .limit(1);
      if (!locked || locked.status !== "requested") {
        continue;
      }

      await tx
        .delete(wise_withdrawals)
        .where(eq(wise_withdrawals.id, withdrawal.id));

      const refundMetadata: WithdrawalCancellationMetadata = {
        version: "v1",
        type: "withdrawal_cancellation",
      };

      const [refundEntry] = await tx
        .insert(balance_entries)
        .values({
          user_id: userId,
          amount: withdrawal.amount,
          currency: withdrawal.currency ?? "USD",
          type: "withdrawal_cancellation",
          memo: "Withdrawal cancelled due to ban",
          source_type: "withdrawal_cancellation",
          source_id: withdrawal.id,
          metadata: refundMetadata,
        })
        .$returningId();

      if (!refundEntry) {
        throw new Error("Failed to create refund balance entry");
      }

      await tx
        .insert(balances)
        .values({
          user_id: userId,
          balance: withdrawal.amount,
        })
        .onDuplicateKeyUpdate({
          set: {
            balance: sql`${balances.balance} + ${withdrawal.amount}`,
          },
        });
    }
  });
}

async function syncClerkBanMetadata(
  clerkUserId: string,
  metadata: BannedUserMetadata | null
): Promise<void> {
  try {
    await clerkClient.users.updateUserMetadata(clerkUserId, {
      publicMetadata: {
        banStatus: metadata,
      },
    });
  } catch (error) {
    console.error(
      "Failed to sync Clerk ban metadata",
      clerkUserId,
      (error as Error)?.message ?? error
    );
  }
}
