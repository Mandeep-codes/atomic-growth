import { z } from "zod";
import { and, count, eq, isNull } from "drizzle-orm";
import { db } from "../lib/db";
import { verified_users } from "../lib/schema";
import { router, userRolesAdminRoleProcedure } from "../lib/trpc";
import { resolvePlatformAccountId } from "../lib/platformAccountId";

// Feature 0 backfill — resumable, admin-triggered. Each call resolves a batch
// of verified accounts that have never been resolved and stores their stable
// platform ID. Unresolvable rows (deleted/renamed/private) get stamped
// platform_account_id_resolved_at so they're not retried forever (the view
// cron + daily check will pick them up if they ever come back). Call
// repeatedly (or let the UI loop) until `remaining` hits 0.
export const stableIdRouter = router({
  backfillStatus: userRolesAdminRoleProcedure.query(async () => {
    const [resolved] = await db
      .select({ c: count() })
      .from(verified_users)
      .where(
        and(
          eq(verified_users.verified, true),
          isNull(verified_users.deleted_at),
          // resolved = has an id
          // (drizzle: count rows where platform_account_id is not null)
        )
      );
    const [remaining] = await db
      .select({ c: count() })
      .from(verified_users)
      .where(
        and(
          eq(verified_users.verified, true),
          isNull(verified_users.deleted_at),
          isNull(verified_users.platform_account_id),
          isNull(verified_users.platform_account_id_resolved_at)
        )
      );
    return {
      totalVerified: Number(resolved?.c ?? 0),
      remaining: Number(remaining?.c ?? 0),
    };
  }),

  backfillStableIds: userRolesAdminRoleProcedure
    .input(z.object({ batchSize: z.number().min(1).max(300).optional() }))
    .mutation(async ({ input }) => {
      const batchSize = input.batchSize ?? 150;
      const rows = await db
        .select({
          id: verified_users.id,
          platform: verified_users.platform,
          handle: verified_users.handle,
        })
        .from(verified_users)
        .where(
          and(
            eq(verified_users.verified, true),
            isNull(verified_users.deleted_at),
            isNull(verified_users.platform_account_id),
            isNull(verified_users.platform_account_id_resolved_at)
          )
        )
        .limit(batchSize);

      let resolved = 0;
      let notFound = 0;
      let errored = 0;
      for (const row of rows) {
        // skipSearchFallback: the search.list fallback costs 100 quota units
        // per forHandle miss — a single 150-row batch of unresolvable
        // YouTube handles demanded ~15k units, more than the whole 10k/day
        // quota in one click. Unresolvable rows stay unresolved (the daily
        // check still covers them by handle); resolve manually if needed.
        const outcome = await resolvePlatformAccountId(row.platform, row.handle, {
          skipSearchFallback: true,
        });
        if (outcome.status === "ok") {
          await db
            .update(verified_users)
            .set({
              platform_account_id: outcome.id,
              platform_account_secondary_id: outcome.secondaryId,
              platform_account_id_resolved_at: new Date(),
            })
            .where(eq(verified_users.id, row.id));
          resolved++;
        } else {
          // mark attempted so we don't loop on unresolvable rows
          await db
            .update(verified_users)
            .set({ platform_account_id_resolved_at: new Date() })
            .where(eq(verified_users.id, row.id));
          if (outcome.status === "not_found") notFound++;
          else errored++;
        }
      }

      const [rem] = await db
        .select({ c: count() })
        .from(verified_users)
        .where(
          and(
            eq(verified_users.verified, true),
            isNull(verified_users.deleted_at),
            isNull(verified_users.platform_account_id),
            isNull(verified_users.platform_account_id_resolved_at)
          )
        );

      return {
        processed: rows.length,
        resolved,
        notFound,
        errored,
        remaining: Number(rem?.c ?? 0),
      };
    }),
});
