import { and, eq, isNull, ne } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db } from "./db";
import { verified_users } from "./schema";
import { resolvePlatformAccountId } from "./platformAccountId";
import { isSanctionedSharedAccount } from "./sharedSocialAccounts";

// FEATURE 6 — ENABLED.
// Turned on after the existing duplicate links were cleaned up: 286 duplicate
// social accounts across 131 channels were soft-deleted on 2026-07-01, leaving
// each channel unlinked. Enforces one social account per web-app account —
// verifying a channel already linked to a different account is blocked; the
// first clipper to re-verify each cleared channel reclaims it.
export const ONE_ACCOUNT_RULE_ENABLED = true;

// Run when an account is verified. Resolves + stores the stable platform ID
// (Feature 0 capture). When the one-account rule is ON, also blocks if that
// stable ID is already linked to a DIFFERENT web-app (discord) account — the
// thrown error message is what the clipper sees ("already linked elsewhere").
export async function captureStableIdAndEnforceOneAccount(params: {
  verifiedUserId: string;
  discordId: string;
  platform: string;
  handle: string;
}) {
  const { verifiedUserId, discordId, platform, handle } = params;

  // skipSearchFallback: on the normal path the bio check already resolved
  // this handle via the 1-unit forHandle lookup, so the 100-unit search.list
  // fallback only ever fires on the god-mode branch — pure quota risk for
  // zero coverage. Unresolved ids get captured by the daily check later.
  const outcome = await resolvePlatformAccountId(platform, handle, {
    skipSearchFallback: true,
  });
  if (outcome.status !== "ok") {
    // Couldn't resolve right now — the view cron / daily check will capture it
    // later. Don't block verification on a transient resolver failure.
    return;
  }

  if (ONE_ACCOUNT_RULE_ENABLED) {
    const holders = await db
      .select({ discord_id: verified_users.discord_id })
      .from(verified_users)
      .where(
        and(
          eq(verified_users.platform, platform),
          eq(verified_users.platform_account_id, outcome.id),
          ne(verified_users.discord_id, discordId),
          eq(verified_users.verified, true),
          isNull(verified_users.deleted_at)
        )
      );
    // Accounts shared by agreement (sharedSocialAccounts.ts) are exempt, but
    // only between the clippers named there. Filtered rather than excluded in
    // SQL so an unsanctioned holder of the same account still blocks. The same
    // carve-out is applied in verification.ts; it has to be here too, or the
    // clipper is told the link is fine and then rejected at the last step.
    const conflict = holders.filter(
      (row) => !isSanctionedSharedAccount(handle, discordId, row.discord_id)
    );
    if (conflict.length > 0) {
      throw new TRPCError({
        code: "CONFLICT",
        message:
          "This social account is already linked to another Atomik account. Each social account can only be connected to one web-app account.",
      });
    }
  }

  await db
    .update(verified_users)
    .set({
      platform_account_id: outcome.id,
      platform_account_secondary_id: outcome.secondaryId,
      platform_account_id_resolved_at: new Date(),
    })
    .where(eq(verified_users.id, verifiedUserId));
}
