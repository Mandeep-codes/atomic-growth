import { and, asc, count, eq, gt, isNotNull, isNull, ne } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { db as defaultDb } from "../../lib/db";
import { non_campaign_clips, submissions, verified_users } from "../../lib/schema";
import { isNcExemptClipper } from "../../lib/ncExemptClippers";

// Type for db / transaction so the helpers work both inside a `db.transaction`
// and on the top-level db instance. Keeps the surface tight without dragging
// drizzle's enormous generic types around.
type DBLike = typeof defaultDb;

/**
 * Find the OLDEST non-campaign clip belonging to this clipper on this campaign
 * AND on this specific verified account that still has at least one credit slot
 * free. Returns null if no credit is available — caller should then check the
 * per-account unredeemed cap before allowing a new campaign clip.
 *
 * Per-account scoping is the rule: a non-campaign clip posted on @handle_a
 * cannot redeem a campaign clip posted on @handle_b. The clipper must
 * submit a non-campaign clip from the SAME verified account.
 */
export async function findAvailableCredit(
  userId: string,
  campaignId: string,
  verifiedUserId: string,
  db: DBLike = defaultDb
): Promise<{ id: string; credit_remaining: number } | null> {
  const [row] = await db
    .select({
      id: non_campaign_clips.id,
      credit_remaining: non_campaign_clips.credit_remaining,
    })
    .from(non_campaign_clips)
    .where(
      and(
        eq(non_campaign_clips.user_id, userId),
        eq(non_campaign_clips.campaign_id, campaignId),
        eq(non_campaign_clips.verified_user_id, verifiedUserId),
        gt(non_campaign_clips.credit_remaining, 0),
        // Defense in depth: rejected non-campaign clips also have
        // credit_remaining = 0 set by cancelNonCampaignClip, but we
        // double-filter on status so a future code path can't accidentally
        // grant credit from a rejected clip.
        ne(non_campaign_clips.status, "rejected")
      )
    )
    .orderBy(asc(non_campaign_clips.created_at))
    .limit(1);
  return row ?? null;
}

/**
 * Atomically decrement credit_remaining by 1 on the given non-campaign clip.
 * Uses a guarded UPDATE so we don't race ourselves below zero — if the
 * decrement would underflow, the UPDATE matches 0 rows and the caller treats
 * it as "credit was claimed between our SELECT and our UPDATE."
 */
export async function consumeCredit(
  nonCampaignClipId: string,
  db: DBLike = defaultDb
): Promise<boolean> {
  const result = await db
    .update(non_campaign_clips)
    .set({
      credit_remaining: sql`${non_campaign_clips.credit_remaining} - 1`,
    })
    .where(
      and(
        eq(non_campaign_clips.id, nonCampaignClipId),
        gt(non_campaign_clips.credit_remaining, 0)
      )
    );
  // mysql2 returns affectedRows in a metadata payload that drizzle exposes
  // through the [ResultSetHeader] shape; treat any positive count as success.
  const affected =
    (result as unknown as [{ affectedRows?: number } | undefined])[0]
      ?.affectedRows ?? 0;
  return affected > 0;
}

/**
 * Increment credit_remaining by 1 on the given non-campaign clip. Called when
 * a redeemed campaign clip is rejected so the freed slot goes back into the
 * ledger and the next campaign submission can claim it. No upper bound check
 * here — the bump can never exceed N because we only ever bump back ones we
 * previously consumed.
 */
export async function returnCredit(
  nonCampaignClipId: string,
  db: DBLike = defaultDb
): Promise<void> {
  await db
    .update(non_campaign_clips)
    .set({
      credit_remaining: sql`${non_campaign_clips.credit_remaining} + 1`,
    })
    .where(eq(non_campaign_clips.id, nonCampaignClipId));
}

/**
 * Called when a mod rejects a non-campaign clip. Nulls the redemption
 * pointer on every campaign clip that was covered by this non-campaign
 * clip, so they go back to the unredeemed bucket. The campaign clips
 * then won't pay until the clipper submits a fresh non-campaign clip
 * from the same verified account that pops them again.
 *
 * Also zeroes the non-campaign clip's credit_remaining so no future
 * campaign clip can claim a slot from it.
 *
 * Returns the list of campaign clip submission_ids that lost their
 * cover, so the caller can revoke their rewards if any had been paid.
 */
export async function cancelNonCampaignClip(
  nonCampaignClipId: string,
  db: DBLike = defaultDb
): Promise<string[]> {
  const covered = await db
    .select({ id: submissions.id })
    .from(submissions)
    .where(eq(submissions.redeemed_by_non_campaign_clip_id, nonCampaignClipId));

  if (covered.length > 0) {
    // Un-cover the clips (drop them from the payout baseline). The
    // odometer-freeze snapshot that keeps their PAID contribution in the
    // baseline is set per-clip by the caller (uncoverAndClawbackNonCampaignClip)
    // — it must be computed sequentially and CLAMPED to the paid-through
    // amount, which a single bulk UPDATE here can't do.
    await db
      .update(submissions)
      .set({ redeemed_by_non_campaign_clip_id: null })
      .where(eq(submissions.redeemed_by_non_campaign_clip_id, nonCampaignClipId));
  }

  await db
    .update(non_campaign_clips)
    .set({ credit_remaining: 0 })
    .where(eq(non_campaign_clips.id, nonCampaignClipId));

  return covered.map((c) => c.id);
}

/**
 * Count campaign-clip submissions in the unredeemed bucket for this clipper
 * on this campaign AND on this specific verified account. Rejected submissions
 * don't count (they free their slot naturally), and active=false rows are
 * excluded too.
 *
 * This is the number that needs to stay < N (campaign.non_campaign_clips_per)
 * for the next campaign submission ON THE SAME ACCOUNT to be allowed.
 */
export async function countUnredeemed(
  userId: string,
  campaignId: string,
  verifiedUserId: string,
  db: DBLike = defaultDb
): Promise<number> {
  const [row] = await db
    .select({ c: count(submissions.id) })
    .from(submissions)
    .where(
      and(
        eq(submissions.user_id, userId),
        eq(submissions.campaign_id, campaignId),
        eq(submissions.verified_user_id, verifiedUserId),
        isNull(submissions.redeemed_by_non_campaign_clip_id),
        ne(submissions.status, "rejected"),
        // Deleted clips must never enter the redemption baseline: their
        // frozen views would become payable and clawed-back money would be
        // re-credited for a dead clip. `active` tracks campaign lifecycle,
        // not deletion, so it does not cover this.
        isNull(submissions.deleted_at),
        eq(submissions.active, true)
      )
    );
  return Number(row?.c ?? 0);
}

/**
 * The mirror of countUnredeemed: campaign clips on this account that a
 * non-campaign clip has ALREADY covered. Display only — nothing gates on it.
 *
 * Same filters as countUnredeemed apart from the redemption column, so the two
 * always add up to the clipper's live campaign-clip count on that account.
 */
export async function countCovered(
  userId: string,
  campaignId: string,
  verifiedUserId: string,
  db: DBLike = defaultDb
): Promise<number> {
  const [row] = await db
    .select({ c: count(submissions.id) })
    .from(submissions)
    .where(
      and(
        eq(submissions.user_id, userId),
        eq(submissions.campaign_id, campaignId),
        eq(submissions.verified_user_id, verifiedUserId),
        isNotNull(submissions.redeemed_by_non_campaign_clip_id),
        ne(submissions.status, "rejected"),
        isNull(submissions.deleted_at),
        eq(submissions.active, true)
      )
    );
  return Number(row?.c ?? 0);
}

/**
 * Find the N OLDEST unredeemed campaign-clip submissions for this clipper on
 * this campaign AND on this specific verified account. Used by
 * submitNonCampaignClip to figure out which campaign clips a freshly-submitted
 * non-campaign clip will cover.
 */
export async function findUnredeemedToCover(
  userId: string,
  campaignId: string,
  verifiedUserId: string,
  limit: number,
  db: DBLike = defaultDb
): Promise<Array<{ id: string }>> {
  if (limit <= 0) return [];
  return db
    .select({ id: submissions.id })
    .from(submissions)
    .where(
      and(
        eq(submissions.user_id, userId),
        eq(submissions.campaign_id, campaignId),
        eq(submissions.verified_user_id, verifiedUserId),
        isNull(submissions.redeemed_by_non_campaign_clip_id),
        ne(submissions.status, "rejected"),
        // See countUnredeemed: deleted clips must never be covered/re-credited.
        isNull(submissions.deleted_at),
        eq(submissions.active, true)
      )
    )
    .orderBy(asc(submissions.created_at))
    .limit(limit);
}

/**
 * Resolves the effective ratio N for a campaign: how many campaign clips one
 * non-campaign clip can cover. Defaults to 1 (= every campaign clip needs its
 * own non-campaign clip) if the campaign hasn't set this.
 */
export function getRatio(campaign: {
  non_campaign_clips_required?: number | null;
  non_campaign_clips_per?: number | null;
}): number {
  const required = campaign.non_campaign_clips_required ?? 0;
  if (required <= 0) return 0; // disabled — no redemption required
  const per = campaign.non_campaign_clips_per ?? 1;
  return Math.max(1, per);
}

export type PerAccountProgress = {
  verifiedUserId: string;
  handle: string;
  platform: string;
  unredeemed: number;
  cap: number;
  mustRedeem: boolean;
  allowedRemaining: number;
  // Campaign clips on this account ALREADY covered by a non-campaign clip.
  // Purely for display: `unredeemed` alone is indistinguishable from "we never
  // recorded your clip" once a clip is instantly consumed by leftover credit,
  // which is exactly how clippers have been reading it.
  covered: number;
};

/**
 * Returns ALL verified accounts the clipper owns on this campaign's allowed
 * platforms, regardless of whether they have submissions yet. Used by the
 * new submit-dashboard page so the clipper sees a card for every account
 * (including ones with 0 activity), not just ones already in the ledger.
 */
export async function getCampaignAccountDashboard(
  userId: string,
  campaignId: string,
  campaign: {
    non_campaign_clips_required?: number | null;
    non_campaign_clips_per?: number | null;
    platforms?: string | null;
  },
  allowedPlatforms: string[],
  db: DBLike = defaultDb
): Promise<{
  enabled: boolean;
  cap: number;
  perAccount: PerAccountProgress[];
}> {
  // Exempt clippers (ncExemptClippers.ts) never owe a non-campaign clip, so
  // the requirement reads as 'not applicable': cap 0 => enabled false, no
  // mustRedeem, and the UI hides the whole panel and its Submit
  // non-campaign button. Only the caller's OWN status crosses the wire —
  // the allowlist itself never ships to the browser.
  const cap = isNcExemptClipper(userId) ? 0 : getRatio(campaign);
  // Even when the campaign hasn't opted into the redemption flow, the
  // dashboard still wants to show the accounts (just with empty state).
  if (allowedPlatforms.length === 0) {
    return { enabled: cap > 0, cap, perAccount: [] };
  }

  const verifiedRows = await db
    .select({
      id: verified_users.id,
      handle: verified_users.handle,
      platform: verified_users.platform,
    })
    .from(verified_users)
    .where(
      and(
        eq(verified_users.discord_id, userId),
        eq(verified_users.verified, true),
        isNull(verified_users.deleted_at),
        sql`${verified_users.platform} IN (${sql.join(
          allowedPlatforms.map((p) => sql`${p}`),
          sql`, `
        )})`
      )
    );

  const perAccount: PerAccountProgress[] = [];
  for (const v of verifiedRows) {
    const unredeemed =
      cap > 0
        ? await countUnredeemed(userId, campaignId, v.id, db)
        : 0;
    const covered =
      cap > 0 ? await countCovered(userId, campaignId, v.id, db) : 0;
    perAccount.push({
      verifiedUserId: v.id,
      handle: v.handle,
      platform: v.platform,
      unredeemed,
      covered,
      cap,
      mustRedeem: cap > 0 && unredeemed >= cap,
      allowedRemaining: cap > 0 ? Math.max(0, cap - unredeemed) : Infinity,
    });
  }

  return { enabled: cap > 0, cap, perAccount };
}

/**
 * Returns redemption progress per verified account that the clipper has
 * activity on for this campaign. Used by the clipper UI to render a small
 * per-account table at the top of the submit page so the clipper knows
 * which of their verified handles is at the cap.
 *
 * The list includes every verified account the clipper has submitted from
 * (campaign clip OR non-campaign clip) on this campaign. If the campaign
 * doesn't have the redemption flow enabled, returns an empty array.
 */
export async function getRedemptionProgressByAccount(
  userId: string,
  campaignId: string,
  campaign: {
    non_campaign_clips_required?: number | null;
    non_campaign_clips_per?: number | null;
  },
  db: DBLike = defaultDb
): Promise<{ enabled: boolean; perAccount: PerAccountProgress[] }> {
  // Exempt clippers (ncExemptClippers.ts) never owe a non-campaign clip, so
  // the requirement reads as 'not applicable': cap 0 => enabled false, no
  // mustRedeem, and the UI hides the whole panel and its Submit
  // non-campaign button. Only the caller's OWN status crosses the wire —
  // the allowlist itself never ships to the browser.
  const cap = isNcExemptClipper(userId) ? 0 : getRatio(campaign);
  if (cap === 0) return { enabled: false, perAccount: [] };

  // Find every verified account the clipper has touched on this campaign
  // (either via a campaign clip submission or a non-campaign clip).
  const subAccounts = await db
    .selectDistinct({ verifiedUserId: submissions.verified_user_id })
    .from(submissions)
    .where(
      and(
        eq(submissions.user_id, userId),
        eq(submissions.campaign_id, campaignId)
      )
    );
  const ncAccounts = await db
    .selectDistinct({ verifiedUserId: non_campaign_clips.verified_user_id })
    .from(non_campaign_clips)
    .where(
      and(
        eq(non_campaign_clips.user_id, userId),
        eq(non_campaign_clips.campaign_id, campaignId)
      )
    );

  const accountIds = Array.from(
    new Set(
      [...subAccounts, ...ncAccounts]
        .map((r) => r.verifiedUserId)
        .filter((v): v is string => Boolean(v))
    )
  );

  if (accountIds.length === 0) return { enabled: true, perAccount: [] };

  // Fetch handle/platform for the verified accounts found.
  const verifiedRows = await db
    .select({
      id: verified_users.id,
      handle: verified_users.handle,
      platform: verified_users.platform,
    })
    .from(verified_users)
    .where(
      and(
        // Drizzle's inArray is the standard pattern, but accountIds is
        // already deduped above and typically tiny (1-3 accounts), so
        // a per-row lookup loop is also fine. Use inArray for cleanliness.
        // (verified_users.id IN (...accountIds))
        // We construct the predicate via raw SQL to avoid importing
        // inArray here — keeps the helper module small.
        sql`${verified_users.id} IN (${sql.join(
          accountIds.map((id) => sql`${id}`),
          sql`, `
        )})`
      )
    );
  const handleByVu = new Map(
    verifiedRows.map((r) => [r.id, { handle: r.handle, platform: r.platform }])
  );

  const perAccount: PerAccountProgress[] = [];
  for (const verifiedUserId of accountIds) {
    const unredeemed = await countUnredeemed(
      userId,
      campaignId,
      verifiedUserId,
      db
    );
    const covered = await countCovered(userId, campaignId, verifiedUserId, db);
    const info = handleByVu.get(verifiedUserId);
    perAccount.push({
      verifiedUserId,
      handle: info?.handle ?? "",
      platform: info?.platform ?? "",
      unredeemed,
      covered,
      cap,
      mustRedeem: unredeemed >= cap,
      allowedRemaining: Math.max(0, cap - unredeemed),
    });
  }
  return { enabled: true, perAccount };
}
