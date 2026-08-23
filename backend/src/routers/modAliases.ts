import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db } from "../lib/db";
import { generateStrongPassword } from "../lib/credentials";
import { verified_login_credentials } from "../lib/schema";
import { router, staffProcedure, ROLES } from "../lib/trpc";
import {
  MOD_ALIAS_PLATFORM,
  ensureForwardEmailAlias,
  deleteForwardEmailAlias,
  balancedAliasDomains,
} from "../lib/forwardEmail";

const NAME_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const randomAliasName = (length = 10) => {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += NAME_ALPHABET[Math.floor(Math.random() * NAME_ALPHABET.length)];
  }
  return out;
};

// Self-serve forwarder generator for staff. Creates ForwardEmail aliases on a
// random ALIAS_DOMAINS entry that forward to one or more recipients, and
// records them in verified_login_credentials under the MOD_ALIAS_PLATFORM
// sentinel so they stay distinguishable from real clipper accounts.
export const modAliasesRouter = router({
  generate: staffProcedure
    .input(
      z.object({
        count: z.number().int().min(1).max(50),
        recipients: z.array(z.string().email()).min(1).max(10),
        tag: z.string().trim().max(100).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const recipients = [
        ...new Set(input.recipients.map((r) => r.trim().toLowerCase())),
      ];
      const tag = input.tag?.trim() || null;
      // Assign domains up front so a batch spreads evenly across the pool
      // instead of clumping the way per-alias random picks would.
      const domains = balancedAliasDomains(input.count);
      const results: {
        email: string;
        youtubePassword: string;
        instagramPassword: string;
        ok: boolean;
      }[] = [];

      for (let i = 0; i < input.count; i++) {
        const name = randomAliasName();
        const email = `${name}@${domains[i]}`;
        const youtubePassword = generateStrongPassword();
        const instagramPassword = generateStrongPassword();
        const ok = await ensureForwardEmailAlias(email, recipients);

        await db.insert(verified_login_credentials).values({
          user_id: ctx.user.id,
          email,
          handle: name,
          platform: MOD_ALIAS_PLATFORM,
          forwarding_email: recipients.join(", "),
          youtube_password: youtubePassword,
          instagram_password: instagramPassword,
          mod_alias_tag: tag,
          verification_method: "manual",
          verified_at: new Date(),
        });

        results.push({ email, youtubePassword, instagramPassword, ok });
      }

      return {
        created: results,
        recipients,
        failedCount: results.filter((r) => !r.ok).length,
      };
    }),

  list: staffProcedure.query(async ({ ctx }) => {
    return db
      .select({
        id: verified_login_credentials.id,
        email: verified_login_credentials.email,
        recipients: verified_login_credentials.forwarding_email,
        youtubePassword: verified_login_credentials.youtube_password,
        instagramPassword: verified_login_credentials.instagram_password,
        tag: verified_login_credentials.mod_alias_tag,
        createdAt: verified_login_credentials.created_at,
      })
      .from(verified_login_credentials)
      .where(
        and(
          eq(verified_login_credentials.user_id, ctx.user.id),
          eq(verified_login_credentials.platform, MOD_ALIAS_PLATFORM)
        )
      )
      .orderBy(desc(verified_login_credentials.created_at));
  }),

  delete: staffProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const [row] = await db
        .select()
        .from(verified_login_credentials)
        .where(
          and(
            eq(verified_login_credentials.id, input.id),
            eq(verified_login_credentials.platform, MOD_ALIAS_PLATFORM)
          )
        );

      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Alias not found" });
      }

      const isGodMode = ctx.user.roles?.includes(ROLES.GOD_MODE) ?? false;
      if (row.user_id !== ctx.user.id && !isGodMode) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You can only delete aliases you created",
        });
      }

      if (row.email) await deleteForwardEmailAlias(row.email);
      await db
        .delete(verified_login_credentials)
        .where(eq(verified_login_credentials.id, row.id));

      return { success: true };
    }),
});
