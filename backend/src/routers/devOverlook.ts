import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { z } from "zod";
import { db } from "../lib/db";
import {
  TRACKED_DEVELOPERS,
  fetchCommits,
  fetchPullRequests,
  isGithubConfigured,
} from "../lib/githubActivity";
import { audit_log, user_clerk } from "../lib/schema";
import { protectedProcedure, router } from "../lib/trpc";

// Dev Overlook is PERSONAL, not role-based: hardcoded to Pranav
// (@channelprnv) so no user-roles admin can grant themselves access.
const DEV_OVERLOOK_DISCORD_IDS = new Set(["296884557972504577"]);

// The money-critical subset shown by the default "money only" filter.
const MONEY_TABLES = [
  "balances",
  "balance_entries",
  "campaign_view_rewards",
  "wise_withdrawals",
  "crypto_withdrawals",
  "crypto_payout_batches",
  "crypto_payout_methods",
  "wise_recipient",
  "bank_accounts",
  "deleted_clip_reserves",
  "campaigns",
  "campaign_cpm_groups",
  "campaign_cpm_group_members",
  "campaign_levels",
  "submissions",
  "invoices",
];

const isAllowed = (ctx: { user?: { id?: string; discordId?: string | null } | null }) => {
  const ids = [ctx.user?.id, ctx.user?.discordId].filter(Boolean) as string[];
  return ids.some((id) => DEV_OVERLOOK_DISCORD_IDS.has(id));
};

export const devOverlookRouter = router({
  // Code activity: who changed the codebase, what they touched, and whether
  // it was money code. The audit_log triggers only see changes made straight
  // to the database — a migration or a payout-cron edit leaves no audit row
  // until it actually runs in production, so this reads the other half.
  codeActivity: protectedProcedure
    .input(
      z.object({
        // GitHub login, e.g. "Argon-py". Omit for everyone.
        login: z.string().optional(),
        days: z.number().min(1).max(365).default(30),
        limit: z.number().min(1).max(100).default(50),
        includePullRequests: z.boolean().default(true),
      })
    )
    .query(async ({ ctx, input }) => {
      if (!isAllowed(ctx)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not for you." });
      }
      if (!isGithubConfigured()) {
        // Explicit, not an empty list: an empty feed would read as "nobody
        // changed anything", which is the opposite of the truth.
        return {
          configured: false as const,
          items: [],
          developers: TRACKED_DEVELOPERS,
        };
      }

      const since = new Date(
        Date.now() - input.days * 24 * 60 * 60 * 1000
      ).toISOString();

      const [commits, pulls] = await Promise.all([
        fetchCommits({ login: input.login, limit: input.limit, since }).catch(
          (error) => {
            console.error("devOverlook: commit fetch failed", error);
            return [];
          }
        ),
        input.includePullRequests
          ? fetchPullRequests({ login: input.login, limit: input.limit }).catch(
              (error) => {
                console.error("devOverlook: PR fetch failed", error);
                return [];
              }
            )
          : Promise.resolve([]),
      ]);

      const items = [...commits, ...pulls]
        .filter((item) => new Date(item.ts).getTime() >= Date.parse(since))
        .sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts));

      return {
        configured: true as const,
        items,
        developers: TRACKED_DEVELOPERS,
      };
    }),

  // Drives sidebar visibility. Everyone may ask; only Pranav gets true.
  canView: protectedProcedure.query(({ ctx }) => ({
    allowed: isAllowed(ctx),
  })),

  list: protectedProcedure
    .input(
      z.object({
        moneyOnly: z.boolean().default(true),
        dbUser: z.string().optional(), // prefix match on the username part
        tableName: z.string().optional(),
        action: z.enum(["INSERT", "UPDATE", "DELETE"]).optional(),
        limit: z.number().min(1).max(500).default(200),
        beforeId: z.number().optional(), // pagination cursor
      })
    )
    .query(async ({ ctx, input }) => {
      if (!isAllowed(ctx)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not for you." });
      }

      const filters = [
        input.moneyOnly ? inArray(audit_log.table_name, MONEY_TABLES) : undefined,
        input.tableName ? eq(audit_log.table_name, input.tableName) : undefined,
        input.action ? eq(audit_log.action, input.action) : undefined,
        input.beforeId ? lt(audit_log.id, input.beforeId) : undefined,
      ].filter(Boolean);

      let rows = await db
        .select()
        .from(audit_log)
        .where(filters.length ? and(...(filters as Parameters<typeof and>)) : undefined)
        .orderBy(desc(audit_log.id))
        .limit(input.limit);

      if (input.dbUser) {
        const needle = input.dbUser.toLowerCase();
        rows = rows.filter((r) => r.db_user.toLowerCase().startsWith(needle));
      }

      // Resolve any discord ids mentioned inside the change payloads so the
      // frontend can say "syedazhar's balance" instead of a raw snowflake.
      const discordIds = new Set<string>();
      for (const r of rows) {
        for (const blob of [r.old_data, r.new_data]) {
          if (blob && typeof blob === "object") {
            const uid = (blob as Record<string, unknown>)["user_id"];
            if (typeof uid === "string" && /^\d{15,20}$/.test(uid)) {
              discordIds.add(uid);
            }
          }
        }
      }
      const users = discordIds.size
        ? await db
            .select({
              discordId: user_clerk.discord_id,
              username: user_clerk.discord_username,
            })
            .from(user_clerk)
            .where(inArray(user_clerk.discord_id, [...discordIds]))
        : [];
      const usernames: Record<string, string> = {};
      for (const u of users) {
        if (u.username) usernames[u.discordId] = u.username;
      }

      return {
        rows: rows.map((r) => ({
          id: r.id,
          ts: r.ts,
          dbUser: r.db_user,
          action: r.action as "INSERT" | "UPDATE" | "DELETE",
          tableName: r.table_name,
          rowId: r.row_id,
          oldData: (r.old_data as Record<string, unknown> | null) ?? null,
          newData: (r.new_data as Record<string, unknown> | null) ?? null,
        })),
        usernames,
        moneyTables: MONEY_TABLES,
      };
    }),
});
