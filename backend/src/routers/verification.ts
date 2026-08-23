import { TRPCError } from "@trpc/server";
import axios from "axios";
import { and, eq, isNull, ne } from "drizzle-orm";
import { google } from "googleapis";
import { z } from "zod";
import { generateCredentialPair } from "../lib/credentials";
import { db } from "../lib/db";
import { env } from "../lib/env";
import { ensureForwardEmailAlias } from "../lib/forwardEmail";
import { verified_login_credentials, verified_users } from "../lib/schema";
import { protectedProcedure, router, ROLES } from "../lib/trpc";
import { captureStableIdAndEnforceOneAccount } from "../lib/oneAccountRule";
import { resolvePlatformAccountId } from "../lib/platformAccountId";
import { isSanctionedSharedAccount } from "../lib/sharedSocialAccounts";

// ── One social account, one owner ──
// A (platform, handle) pair may only be linked to ONE clipper. Without this,
// two people can verify the same account and both earn on the same content.
//
// Enforced in the application layer rather than by a unique index, because
// production already contains 11 conflicting handles (37 rows) from before this
// rule existed — several with approved clips and real money attached. A unique
// index would fail to create against that data. Those existing conflicts need a
// human decision about who the rightful owner is; this check stops NEW ones
// from being created in the meantime. Add the DB-level unique index once the
// backlog is cleaned up, so the guarantee no longer depends on this code path
// being the only writer.
//
// An UNVERIFIED claim older than 24 hours does not hold the handle — it mirrors
// the existing expiry on stale login-flow credentials, and stops an abandoned
// half-finished verification from locking someone out of their own account
// forever.
//
// A handful of accounts are shared by agreement (sharedSocialAccounts.ts) and
// are exempt — but only between the specific clippers named there, so the
// exemption cannot be used to take over someone else's handle.
const STALE_UNVERIFIED_CLAIM_MS = 1000 * 60 * 60 * 24;

const assertHandleNotOwnedByAnother = async (
  platform: string,
  handle: string,
  discordId: string
) => {
  const rows = await db
    .select({
      discordId: verified_users.discord_id,
      handle: verified_users.handle,
      verified: verified_users.verified,
      createdAt: verified_users.created_at,
    })
    .from(verified_users)
    .where(
      and(
        eq(verified_users.platform, platform),
        isNull(verified_users.deleted_at)
      )
    );

  const comparison = handle.trim().toLowerCase();
  const conflict = rows.find(
    (row) =>
      row.discordId !== discordId &&
      (row.handle ?? "").trim().toLowerCase() === comparison &&
      (row.verified ||
        row.createdAt.getTime() > Date.now() - STALE_UNVERIFIED_CLAIM_MS) &&
      // Sanctioned share: both this clipper and the current holder are named
      // owners of this account, so the two of them co-owning it is the intended
      // state. Checked per row, so an unsanctioned third claimant still blocks.
      !isSanctionedSharedAccount(handle, discordId, row.discordId)
  );

  const display = handle.trim().replace(/^@+/, "");
  const alreadyLinked = () => {
    throw new TRPCError({
      code: "CONFLICT",
      message: `This ${platform} account (@${display}) is already linked to another clipper. Each social account can only be connected once — please use a different account, or contact a moderator if you believe this is your account.`,
    });
  };

  // Clippers type the handle both ways, so normalise rather than blindly
  // prefixing — otherwise the message reads "@@handle".
  if (conflict) alreadyLinked();

  // ── Second pass: the STABLE platform id ──
  // The handle check above is defeated by a rename or an alternate spelling of
  // the same channel. Resolving the platform's own account id catches those, and
  // doing it HERE means the clipper is told immediately instead of completing
  // the whole bio-verification flow first only to be rejected at the end.
  //
  // Best-effort by design: if the platform API can't resolve the handle right
  // now we do NOT block, because an outage must not stop people connecting
  // accounts. captureStableIdAndEnforceOneAccount re-checks the same id at
  // verification time, so a transient failure here is caught there.
  // skipSearchFallback keeps this to a 1-unit lookup rather than the 100-unit
  // search fallback.
  let outcome;
  try {
    outcome = await resolvePlatformAccountId(platform, handle, {
      skipSearchFallback: true,
    });
  } catch {
    return;
  }
  if (outcome.status !== "ok") return;

  const idRows = await db
    .select({
      discordId: verified_users.discord_id,
      verified: verified_users.verified,
      createdAt: verified_users.created_at,
    })
    .from(verified_users)
    .where(
      and(
        eq(verified_users.platform, platform),
        eq(verified_users.platform_account_id, outcome.id),
        ne(verified_users.discord_id, discordId),
        isNull(verified_users.deleted_at)
      )
    );

  const idConflict = idRows.find(
    (row) =>
      (row.verified ||
        row.createdAt.getTime() > Date.now() - STALE_UNVERIFIED_CLAIM_MS) &&
      // Same carve-out as the handle pass. The stable-id pass exists to catch
      // renames, and a renamed shared account is still the shared account —
      // without this the exemption would only survive until someone renamed it.
      !isSanctionedSharedAccount(handle, discordId, row.discordId)
  );

  if (idConflict) alreadyLinked();
};

export const verificationRouter = router({
  // Initialize verification - Generate verification code
  initializeVerification: protectedProcedure
    .input(
      z.object({
        platform: z.enum(["youtube", "instagram", "tiktok", "x"]),
        handle: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const guildId = "default_guild";
      const normalizedHandle = input.handle.trim();
      const handleComparison = normalizedHandle.toLowerCase();

      // Load all records for this user/platform and match handle case-insensitively
      const existingUsers = await db
        .select()
        .from(verified_users)
        .where(
          and(
            eq(verified_users.discord_id, ctx.user.id),
            eq(verified_users.platform, input.platform)
          )
        );

      const matchedUser = existingUsers.find(
        (user) => user.handle.toLowerCase() === handleComparison
      );

      if (matchedUser?.deleted_at) {
        await db
          .update(verified_users)
          .set({ deleted_at: null })
          .where(eq(verified_users.id, matchedUser.id));
      }

      // ── One social account, one owner ──
      // Only enforced for a genuinely NEW link: the lookup above is scoped to
      // THIS clipper, so without this check a handle already verified by
      // someone else could be linked a second time and both clippers would earn
      // on the same account. Production already contains cases of exactly this.
      if (!matchedUser) {
        await assertHandleNotOwnedByAnother(
          input.platform,
          normalizedHandle,
          ctx.user.id
        );
      }

      let verifyCode = "";
      let isNewRecord = false;
      let handleToUse = normalizedHandle;

      if (!matchedUser) {
        // Create new verification record with random code
        verifyCode = Math.random().toString(36).substring(2, 8).toUpperCase();
        isNewRecord = true;

        await db.insert(verified_users).values({
          discord_id: ctx.user.id,
          guild_id: guildId,
          username: ctx.user.discordUsername || "",
          platform: input.platform,
          handle: normalizedHandle,
          verify_code: verifyCode,
          verified: false, // Start as unverified
        });
      } else {
        verifyCode = matchedUser.verify_code;
        handleToUse = matchedUser.handle;

        // If not yet verified, user can retry with same code
        if (!matchedUser.verified) {
          // Optionally generate a new code
          verifyCode = Math.random().toString(36).substring(2, 8).toUpperCase();
          await db
            .update(verified_users)
            .set({
              verify_code: verifyCode,
              verified: false,
            })
            .where(eq(verified_users.id, matchedUser.id));
        }
      }

      return {
        verifyCode,
        handle: handleToUse,
        platform: input.platform,
        isNewRecord,
        message: `Add "${verifyCode}" to your ${input.platform} bio, then click verify.`,
      };
    }),

  // Check if user is verified for a platform - returns ALL verified accounts
  checkVerification: protectedProcedure
    .input(
      z.object({
        platform: z.enum(["youtube", "instagram", "tiktok", "x"]),
      })
    )
    .query(async ({ input, ctx }) => {
      // Get all verified accounts for this platform
      const verifiedAccountsQuery = await db
        .select()
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
            eq(verified_users.discord_id, ctx.user.id),
            eq(verified_users.platform, input.platform),
            eq(verified_users.verified, true),
            isNull(verified_users.deleted_at)
          )
        );

      const verifiedAccounts = verifiedAccountsQuery.map(
        ({
          verified_users: user,
          verified_login_credentials: credentials,
        }) => ({
          ...user,
          verification_method: credentials?.verification_method ?? "OTP",
          login_creds_email: credentials?.email ?? null,
          login_creds_password: credentials?.password ?? null,
          login_cred_forwarding_email: credentials?.forwarding_email ?? null,
          login_creds_manually_verified_at:
            credentials?.login_creds_manually_verified_at ?? null,
        })
      );

      return {
        verified: verifiedAccounts.length > 0,
        verifiedAccounts,
        // Keep backward compatibility
        verifiedUser: verifiedAccounts[0] || null,
      };
    }),

  // Check if handle exists on platform API
  handleExists: protectedProcedure
    .input(
      z.object({
        platform: z.enum(["youtube", "instagram", "tiktok", "x"]),
        handle: z.string().min(1, "Handle is required"),
        forwardEmail: z.string().email("Invalid email address"),
      })
    )
    .query(async ({ input, ctx }) => {
      const normalizedHandle = input.handle.trim();

      const [existingLoginCredentials] = await db
        .select()
        .from(verified_login_credentials)
        .where(
          and(
            eq(verified_login_credentials.user_id, ctx.user.id),
            eq(verified_login_credentials.platform, input.platform),
            eq(verified_login_credentials.handle, normalizedHandle)
          )
        );

      if (existingLoginCredentials) {
        if (existingLoginCredentials.user_id === ctx.user.id) {
          return {
            exists: false, // a bit hacky on the semantics, but basically means "no it doesn't exist for someone else"
            platform: input.platform,
            handle: normalizedHandle,
            email: existingLoginCredentials.email,
            password: existingLoginCredentials.password,
          };
        }
        // expire those from 1 day ago
        if (
          !existingLoginCredentials.verified_at &&
          existingLoginCredentials.verification_method === "login-flow" &&
          existingLoginCredentials.created_at <
            new Date(Date.now() - 1000 * 60 * 60 * 24)
        ) {
          await db
            .delete(verified_login_credentials)
            .where(
              eq(verified_login_credentials.id, existingLoginCredentials.id)
            );
        } else {
          return {
            exists: true,
            platform: input.platform,
          };
        }
      }

      const existsOnPlatform = await checkHandleExists(
        input.platform,
        normalizedHandle
      );

      if (existsOnPlatform) {
        return {
          exists: true,
          platform: input.platform,
        };
      }

      const pair = generateCredentialPair(normalizedHandle);
      if (!pair) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to generate credential pair",
        });
      }

      await db.insert(verified_login_credentials).values({
        user_id: ctx.user.id,
        email: pair.email,
        handle: normalizedHandle,
        platform: input.platform,
        password: pair.password,
        forwarding_email: input.forwardEmail,
        verification_method: "login-flow",
      });

      await ensureForwardEmailAlias(pair.email, [input.forwardEmail]);

      return {
        exists: false,
        platform: input.platform,
        handle: normalizedHandle,
        email: pair.email,
        password: pair.password,
      };
    }),

  verifyLoginCredentials: protectedProcedure
    .input(
      z.object({
        platform: z.enum(["youtube", "instagram", "tiktok", "x"]),
        handle: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const normalizedHandle = input.handle.trim();

      const [loginCredentials] = await db
        .select()
        .from(verified_login_credentials)
        .where(
          and(
            eq(verified_login_credentials.user_id, ctx.user.id),
            eq(verified_login_credentials.platform, input.platform),
            eq(verified_login_credentials.handle, normalizedHandle)
          )
        );

      if (!loginCredentials) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Login credentials not found",
        });
      }

      // const existsOnPlatform = await checkHandleExists(
      //   loginCredentials.platform,
      //   loginCredentials.handle
      // );

      // if (!existsOnPlatform) {
      //   return {
      //     success: false,
      //     message: `Login credentials not valid`,
      //   };
      // }

      await db
        .update(verified_login_credentials)
        .set({
          verification_method: "login-flow",
          verified_at: new Date(),
        })
        .where(eq(verified_login_credentials.id, loginCredentials.id));

      return {
        success: true,
        message: "Login credentials verified successfully!",
      };
    }),

  // Verify user bio - Check bio and update verified from 0 to 1
  verifyUserBio: protectedProcedure
    .input(
      z.object({
        platform: z.enum(["youtube", "instagram", "tiktok", "x"]),
        handle: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const normalizedHandle = input.handle.trim();
      const handleComparison = normalizedHandle.toLowerCase();
      const isGodMode = ctx.user.roles?.includes(ROLES.GOD_MODE) ?? false;

      // Get existing verification record for this specific handle (case-insensitive)
      const verifiedUsersForPlatform = await db
        .select()
        .from(verified_users)
        .where(
          and(
            eq(verified_users.discord_id, ctx.user.id),
            eq(verified_users.platform, input.platform),
            isNull(verified_users.deleted_at)
          )
        );

      const existingUser = verifiedUsersForPlatform.find(
        (user) => user.handle.toLowerCase() === handleComparison
      );

      if (!existingUser) {
        throw new Error(
          "No verification record found. Please initialize verification first."
        );
      }

      const verifyCode = existingUser.verify_code;

      // Check if already verified
      if (existingUser.verified) {
        return {
          success: true,
          verified: true,
          message: "Account already verified!",
        };
      }

      if (isGodMode) {
        const [loginCredentials] = await db
          .select()
          .from(verified_login_credentials)
          .where(
            and(
              eq(verified_login_credentials.user_id, ctx.user.id),
              eq(verified_login_credentials.platform, input.platform),
              eq(verified_login_credentials.handle, normalizedHandle)
            )
          );

        // Feature 0 capture (+ Feature 6 one-account rule, currently OFF).
        await captureStableIdAndEnforceOneAccount({
          verifiedUserId: existingUser.id,
          discordId: ctx.user.id,
          platform: input.platform,
          handle: existingUser.handle,
        });

        await db
          .update(verified_users)
          .set({
            verified: true,
            verified_login_credentials_id:
              loginCredentials?.id ?? existingUser.verified_login_credentials_id,
          })
          .where(eq(verified_users.id, existingUser.id));

        return {
          success: true,
          verified: true,
          message: "Account verified via god-mode bypass.",
        };
      }

      // Check bio for verification code
      const bioMatches = await checkBio(
        input.platform,
        existingUser.handle,
        verifyCode
      );

      if (bioMatches) {
        // Update verified from 0 to 1 for this specific account

        const [loginCredentials] = await db
          .select()
          .from(verified_login_credentials)
          .where(
            and(
              eq(verified_login_credentials.user_id, ctx.user.id),
              eq(verified_login_credentials.platform, input.platform),
              eq(verified_login_credentials.handle, normalizedHandle)
            )
          );

        // Feature 0 capture (+ Feature 6 one-account rule, currently OFF).
        await captureStableIdAndEnforceOneAccount({
          verifiedUserId: existingUser.id,
          discordId: ctx.user.id,
          platform: input.platform,
          handle: existingUser.handle,
        });

        await db
          .update(verified_users)
          .set({
            verified: true,
            verified_login_credentials_id: loginCredentials?.id,
          })
          .where(eq(verified_users.id, existingUser.id));

        return {
          success: true,
          verified: true,
          message: "Account verified successfully!",
        };
      }

      return {
        success: false,
        verified: false,
        verifyCode,
        message: `Code "${verifyCode}" not found in bio. Please add it and try again.`,
      };
    }),

  removeVerification: protectedProcedure
    .input(
      z.object({
        id: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const records = await db
        .select({
          id: verified_users.id,
          discord_id: verified_users.discord_id,
        })
        .from(verified_users)
        .where(
          and(
            eq(verified_users.id, input.id),
            isNull(verified_users.deleted_at)
          )
        )
        .limit(1);

      const record = records[0];

      if (!record || record.discord_id !== ctx.user.id) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Verification record not found",
        });
      }

      await db
        .update(verified_users)
        .set({ deleted_at: new Date(), verified: false })
        .where(
          and(
            eq(verified_users.id, input.id),
            isNull(verified_users.deleted_at)
          )
        );

      return {
        success: true,
      };
    }),

  validateLoginCredentials: protectedProcedure
    .input(
      z.object({
        platform: z.enum(["youtube", "instagram", "tiktok", "x"]),
        handle: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const normalizedHandle = input.handle.trim();

      const existsOnPlatform = await checkHandleExists(
        input.platform,
        normalizedHandle
      );

      if (!existsOnPlatform) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Handle not found",
        });
      }

      // TODO: check emails forwarded
    }),
});

// Helper function to retry API calls
async function retry<T>(
  fn: () => Promise<T>,
  retries = 3,
  delay = 1000
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (retries <= 0) throw error;
    await new Promise((resolve) => setTimeout(resolve, delay));
    return retry(fn, retries - 1, delay * 2);
  }
}

// Bio verification function
async function checkBio(
  platform: string,
  handle: string,
  code: string
): Promise<boolean> {
  try {
    if (platform === "instagram") {
      return await retry(async () => {
        const options = {
          method: "GET",
          url: "https://social-media-data-api1.p.rapidapi.com/v1/user/by/username",
          params: { username: handle },
          headers: {
            "x-access-key": env.RAPIDAPI_KEY,
            "x-rapidapi-host": "social-media-data-api1.p.rapidapi.com",
            "x-rapidapi-key": env.RAPIDAPI_KEY,
          },
        };

        const response = await axios.request(options);
        const bio = response.data?.biography || "";
        console.log(`📄 Instagram bio for @${handle}: "${bio}"`);
        const match = bio.includes(code);
        console.log(
          `📌 Code "${code}" ${match ? "FOUND" : "NOT found"} in Instagram bio.`
        );
        return match;
      });
    }

    if (platform === "youtube") {
      return await retry(async () => {
        const youtube = google.youtube({
          version: "v3",
          auth: env.YOUTUBE_API_KEY,
        });

        const channelResponse = await youtube.channels.list({
          forHandle: handle.replace(/^@/, ""),
          part: ["brandingSettings"],
        });

        const channel = channelResponse.data.items?.[0];
        if (!channel) {
          console.log("❌ Channel not found.");
          return false;
        }

        const description =
          channel.brandingSettings?.channel?.description || "";
        console.log("📄 YouTube description:", description);
        return description.includes(code);
      });
    }

    if (platform === "x") {
      return await retry(async () => {
        const options = {
          method: "GET",
          url: "https://twitter241.p.rapidapi.com/user",
          params: { username: handle },
          headers: {
            "X-RapidAPI-Key": env.RAPIDAPI_KEY,
            "X-RapidAPI-Host": "twitter241.p.rapidapi.com",
          },
        };

        const response = await axios.request(options);
        const bio =
          response.data?.result?.data?.user?.result?.legacy?.description || "";
        return bio.includes(code);
      });
    }

    if (platform === "tiktok") {
      return await retry(async () => {
        const options = {
          method: "GET",
          url: "https://tiktok-api23.p.rapidapi.com/api/user/info",
          params: { uniqueId: handle },
          headers: {
            "x-rapidapi-key": env.RAPIDAPI_KEY,
            "x-rapidapi-host": "tiktok-api23.p.rapidapi.com",
          },
        };

        const response = await axios.request(options);
        const user = response.data?.userInfo?.user;
        if (!user) {
          console.error("❌ TikTok user not found");
          return false;
        }

        const bio = user.signature || "";
        const match = bio.includes(code);
        console.log(
          `📌 Code "${code}" ${match ? "FOUND" : "NOT found"} in TikTok bio.`
        );
        return match;
      });
    }

    return false;
  } catch (err) {
    console.error("❌ Final Error:", (err as Error).message);
    return false;
  }
}

async function checkHandleExists(
  platform: string,
  handle: string
): Promise<boolean> {
  try {
    if (platform === "instagram") {
      return await retry(async () => {
        const options = {
          method: "GET",
          url: "https://social-media-data-api1.p.rapidapi.com/v1/user/by/username",
          params: { username: handle },
          headers: {
            "x-access-key": env.RAPIDAPI_KEY,
            "x-rapidapi-host": "social-media-data-api1.p.rapidapi.com",
            "x-rapidapi-key": env.RAPIDAPI_KEY,
          },
        };

        const response = await axios.request(options);
        return Boolean(response.data?.username || response.data?.pk);
      });
    }

    if (platform === "youtube") {
      return await retry(async () => {
        const youtube = google.youtube({
          version: "v3",
          auth: env.YOUTUBE_API_KEY,
        });

        const channelResponse = await youtube.channels.list({
          forHandle: handle.replace(/^@/, ""),
          part: ["id"],
        });

        const channel = channelResponse.data.items?.[0];
        return Boolean(channel?.id);
      });
    }

    if (platform === "x") {
      return await retry(async () => {
        const options = {
          method: "GET",
          url: "https://twitter241.p.rapidapi.com/user",
          params: { username: handle },
          headers: {
            "X-RapidAPI-Key": env.RAPIDAPI_KEY,
            "X-RapidAPI-Host": "twitter241.p.rapidapi.com",
          },
        };

        const response = await axios.request(options);
        return Boolean(
          response.data?.result?.data?.user?.result?.rest_id ||
            response.data?.result?.data?.user?.result?.legacy
        );
      });
    }

    if (platform === "tiktok") {
      return await retry(async () => {
        const options = {
          method: "GET",
          url: "https://tiktok-api23.p.rapidapi.com/api/user/info",
          params: { uniqueId: handle },
          headers: {
            "x-rapidapi-key": env.RAPIDAPI_KEY,
            "x-rapidapi-host": "tiktok-api23.p.rapidapi.com",
          },
        };

        const response = await axios.request(options);
        const user = response.data?.userInfo?.user;
        return Boolean(user?.id || user?.uniqueId);
      });
    }

    return false;
  } catch (error) {
    console.error("handleExists error", (error as Error).message);
    return false;
  }
}
