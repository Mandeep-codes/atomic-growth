import { and, eq, isNull, lt, or } from "drizzle-orm";
import { db } from "../lib/db";
import { banned_social_media_users, verified_users } from "../lib/schema";
import { inngest } from "../lib/inngest";
import { env } from "../lib/env";
import {
  checkYouTubeChannelsByIds,
  resolvePlatformAccountId,
} from "../lib/platformAccountId";
import { DELETION_STRIKE_THRESHOLD, DELETION_HANDLING_ENABLED } from "./update-views/updateViewCounts";

// Feature 2: once a day, check whether each linked social account still exists
// (deleted / banned / suspended). Same strike + rate-limit-guard pattern as the
// reel detection — only a definitive "not found" strikes, transient/rate-limit
// is ignored. After the threshold the account is flagged account_deleted_at
// (surfaced on the user page; the per-reel clawback handles the money side).
//
// YouTube accounts with a stored stable id are checked BY ID, which is
// rename-proof: a renamed channel still answers by UC… id (we then self-heal
// the stored handle to the channel's current one), so a strike means the
// channel is actually gone — banned/terminated/self-deleted. Handle-based
// checking remains for accounts without a stable id and for the other
// platforms, where a rename still reads "not found" and the flag stays a
// SIGNAL for a human, not an automatic money action.
const CHUNK = 20;

const strikeAccount = async (
  accId: string,
  currentStrikes: number,
  now: Date
) => {
  if (!DELETION_HANDLING_ENABLED) return;
  const strikes = (currentStrikes ?? 0) + 1;
  const updates: Record<string, unknown> = {
    account_unavailable_strikes: strikes,
    account_last_checked_at: now,
  };
  if (strikes >= DELETION_STRIKE_THRESHOLD) updates.account_deleted_at = now;
  await db
    .update(verified_users)
    .set(updates)
    .where(eq(verified_users.id, accId));
};

// Only trust the id path for values that look like a real channel id — a
// junk/truncated stored id would read "not found" forever and daily-strike
// an alive account (the exact false-flag class this change removes).
const YT_CHANNEL_ID = /^UC[0-9A-Za-z_-]{22}$/;

const cleanStoredHandle = (h: string) =>
  (h ?? "").trim().replace(/^@/, "").toLowerCase();

// Bans are keyed by (platform, LOWER(handle)). If a banned channel renames,
// carry the ban to the new handle BEFORE healing, or every ban touchpoint
// (leaderboard exclusions, mod badge, submit-time check on the detected
// handle) would stop matching — rename would equal unban.
const propagateBanToNewHandle = async (
  platform: string,
  oldHandle: string,
  newHandle: string
) => {
  const [ban] = await db
    .select()
    .from(banned_social_media_users)
    .where(
      and(
        eq(banned_social_media_users.platform, platform),
        eq(banned_social_media_users.handle, oldHandle)
      )
    )
    .limit(1);
  if (!ban) return;
  const [existing] = await db
    .select({ id: banned_social_media_users.id })
    .from(banned_social_media_users)
    .where(
      and(
        eq(banned_social_media_users.platform, platform),
        eq(banned_social_media_users.handle, newHandle)
      )
    )
    .limit(1);
  if (existing) return;
  await db.insert(banned_social_media_users).values({
    platform,
    handle: newHandle,
    reason: `${ban.reason ? `${ban.reason} — ` : ""}carried over from banned @${oldHandle} after channel rename (auto)`,
    created_by: ban.created_by,
  });
};

const checkAccountInner = async (
  acc: {
    id: string;
    platform: string;
    handle: string;
    account_unavailable_strikes: number;
    platform_account_id: string | null;
  },
  // Pre-fetched batch for this chunk's YouTube stable ids: one channels.list
  // call covers up to 50 channels (1 quota unit) instead of one call per
  // account. batch.ok=false means the CALL itself failed (quota/transient) —
  // every account in the chunk reads "error" and nothing is ever flagged.
  ytBatch: Awaited<ReturnType<typeof checkYouTubeChannelsByIds>>
) => {
  const now = new Date();
  const stableId = (acc.platform_account_id ?? "").trim();

  // ── Rename-proof path: YouTube with a stored, well-formed stable id ──
  if (
    acc.platform?.toLowerCase() === "youtube" &&
    YT_CHANNEL_ID.test(stableId)
  ) {
    const hit = ytBatch.byId.get(stableId);
    const byId:
      | { status: "ok"; currentHandle: string | null }
      | { status: "not_found" }
      | { status: "error" } = !ytBatch.ok
      ? { status: "error" }
      : hit
        ? { status: "ok", currentHandle: hit.currentHandle }
        : { status: "not_found" };
    if (byId.status === "error") return; // transient — never flag

    if (byId.status === "ok") {
      const updates: Record<string, unknown> = { account_last_checked_at: now };
      if ((acc.account_unavailable_strikes ?? 0) > 0) {
        updates.account_unavailable_strikes = 0;
      }
      // Channel alive but renamed: heal the stored handle so the one-account
      // rule, bio re-verification and mod tooling all see the real handle.
      // Compare cleaned forms — stored handles may carry an "@" prefix.
      const storedClean = cleanStoredHandle(acc.handle);
      const healedHandle = byId.currentHandle;
      const current = healedHandle?.toLowerCase() ?? null;
      if (healedHandle && current && current !== storedClean) {
        await propagateBanToNewHandle(acc.platform, storedClean, current);
        try {
          await db
            .update(verified_users)
            .set({ ...updates, handle: healedHandle })
            .where(eq(verified_users.id, acc.id));
          return;
        } catch {
          // Unique index (guild, discord, platform, handle) collision — an
          // old soft-deleted or re-verified row already holds the new
          // handle. Skip the heal but still reset strikes below.
          console.warn(
            `check-accounts: handle heal collision for ${acc.id} (@${acc.handle} -> @${byId.currentHandle}); strikes reset without heal`
          );
        }
      }
      await db
        .update(verified_users)
        .set(updates)
        .where(eq(verified_users.id, acc.id));
      return;
    }

    // not_found BY STABLE ID = the channel itself is gone from YouTube.
    await strikeAccount(acc.id, acc.account_unavailable_strikes, now);
    return;
  }

  // ── Handle-based path (no stable id, or non-YouTube platform) ──
  // skipSearchFallback: search.list costs 100 units/call; on a DAILY check of
  // known handles it adds nothing but can burn the whole YouTube quota and
  // starve the view cron sharing the key.
  const outcome = await resolvePlatformAccountId(acc.platform, acc.handle, {
    skipSearchFallback: true,
  });

  if (outcome.status === "error") return; // transient — never flag

  if (outcome.status === "ok") {
    const updates: Record<string, unknown> = { account_last_checked_at: now };
    if ((acc.account_unavailable_strikes ?? 0) > 0) {
      updates.account_unavailable_strikes = 0;
    }
    // Capture the stable id for free if we don't have it yet (Feature 0).
    if (!acc.platform_account_id) {
      updates.platform_account_id = outcome.id;
      updates.platform_account_secondary_id = outcome.secondaryId;
      updates.platform_account_id_resolved_at = now;
    }
    await db
      .update(verified_users)
      .set(updates)
      .where(eq(verified_users.id, acc.id));
    return;
  }

  // not_found -> strike, flag once confirmed
  await strikeAccount(acc.id, acc.account_unavailable_strikes, now);
};

// One bad row (API hiccup, index collision) must cost that row's check, not
// the whole chunk — a throw here rejects the step's Promise.all, fails the
// Inngest run after retries, and silently skips every later chunk daily.
const checkAccount: typeof checkAccountInner = async (acc, ytBatch) => {
  try {
    await checkAccountInner(acc, ytBatch);
  } catch (e) {
    console.error(`check-accounts: failed for ${acc.id} (@${acc.handle})`, e);
  }
};

export const checkAccounts = inngest.createFunction(
  { id: "check-accounts" },
  { cron: "TZ=America/New_York 0 7 * * *" }, // daily, 7 AM ET
  async ({ logger, step }) => {
    if (env.NODE_ENV !== "production") {
      logger.info("Skipping check-accounts in non-production");
      return;
    }

    const cutoff = new Date(Date.now() - 20 * 60 * 60 * 1000);
    const accounts = await db
      .select({
        id: verified_users.id,
        platform: verified_users.platform,
        handle: verified_users.handle,
        account_unavailable_strikes: verified_users.account_unavailable_strikes,
        platform_account_id: verified_users.platform_account_id,
      })
      .from(verified_users)
      .where(
        and(
          eq(verified_users.verified, true),
          isNull(verified_users.deleted_at),
          isNull(verified_users.account_deleted_at),
          or(
            isNull(verified_users.account_last_checked_at),
            lt(verified_users.account_last_checked_at, cutoff)
          )
        )
      );

    logger.info("Accounts to check", accounts.length);

    for (let i = 0; i < accounts.length; i += CHUNK) {
      const chunk = accounts.slice(i, i + CHUNK);
      await step.run(`check-accounts-${i}`, async () => {
        // One batched channels.list for the chunk's stable-id YouTube
        // accounts (1 quota unit) — the per-account path reads from it.
        const ytIds = chunk
          .filter(
            (a) =>
              a.platform?.toLowerCase() === "youtube" &&
              YT_CHANNEL_ID.test((a.platform_account_id ?? "").trim())
          )
          .map((a) => (a.platform_account_id ?? "").trim());
        const ytBatch = await checkYouTubeChannelsByIds(ytIds);
        await Promise.all(chunk.map((acc) => checkAccount(acc, ytBatch)));
        return { ok: true };
      });
    }

    return { checked: accounts.length };
  }
);
