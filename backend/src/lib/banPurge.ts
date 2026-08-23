import { and, eq, gt, inArray, isNotNull, isNull, or, sql, sum } from "drizzle-orm";

import { db } from "./db";
import { reverseClawback } from "./reverseClawback";
import { revokeSubmissionReward } from "./revokeSubmissionReward";
import {
  balance_entries,
  banned_social_media_users,
  banned_users,
  campaigns,
  submissions,
  verified_users,
} from "./schema";

// ─────────────────────────────────────────────────────────────────────────
// Ban purge — "remove their clips' views and money from a campaign"
//
// Deliberately does NOT invent a new column. A clip that is `rejected`
// already falls out of all three places that matter:
//   1. finalizeCampaigns   — totals filter status='approved', so views and
//                            achieved both drop.
//   2. getQualifyingSubmissions — the 4-hour view cron skips it, so its view
//                            count stops moving.
//   3. getAllSubmissions   — the payout baseline only takes approved clips
//                            (or ones carrying a frozen snapshot).
//
// The one thing we must NOT do is set baseline_frozen_views. The normal
// approved→rejected path sets it so a clip's already-paid views keep
// propping up the payout baseline (the odometer-freeze fix). Here we want
// the opposite: the views must genuinely leave. Money is clawed back in the
// same pass, so there is nothing left for the baseline to protect.
// ─────────────────────────────────────────────────────────────────────────

// The balance_entries source_type a ban purge writes, and the one an unban
// repay writes to reverse it. Named constants because reverseClawback nets the
// two against each other — a typo in either string would silently re-credit
// money that was never taken, or fail to find money that was.
export const BAN_CLAWBACK_SOURCE_TYPE = "user_ban";
export const UNBAN_REPAY_SOURCE_TYPE = "user_unban_repay";

export interface PurgeCampaignResult {
  campaignId: string;
  campaignTitle: string;
  clips: number;
  viewsRemoved: number;
  rewardRemoved: number;
  clawedFromWallet: number;
  unrecovered: number;
  // The campaign's own odometer, before and after the purge.
  achievedBefore: number;
  achievedAfter: number;
  campaignViewsBefore: number;
  campaignViewsAfter: number;
}

// Recompute campaigns.achieved + campaigns.views from scratch, using EXACTLY
// the formula finalizeCampaigns uses (updateViewCounts.ts) — approved,
// non-deleted, non-category clips, plus manual adjustments explicitly flagged
// as campaign money.
//
// The purge calls this itself rather than waiting for the cron purely for
// immediacy: the next finalizeCampaigns run is up to 4 hours away, and a mod
// who just purged should see the number move now. The cron would reach the
// same answer on its own.
//
// LIVE campaigns ONLY — purgeUserClipsFromCampaigns skips ended ones before
// calling this, and it must stay that way. On an ended campaign `achieved`
// has been frozen since the day it ended while the ended-campaign cron kept
// flagging post-campaign takedowns as deleted without clawing anything back.
// Rebuilding the total there would restate a settled campaign's final spend
// downward by every one of those clips, across every clipper — real money
// that was genuinely paid, and it would never self-heal.
//
// Derives the totals rather than decrementing, so a double-run or a
// concurrent cron converges on the same answer.
// (revokeSubmissionReward writes its clawback ledger rows with a NULL
// campaign_id, so they are correctly invisible to the manual-adjustment sum
// below — the money leaves via submissions.reward going to 0, once.)
export async function recomputeCampaignTotals(campaignId: string): Promise<{
  achieved: number;
  views: number;
}> {
  const [clipTotals] = await db
    .select({
      totalReward: sum(submissions.reward),
      totalViews: sum(submissions.views),
    })
    .from(submissions)
    .where(
      and(
        eq(submissions.campaign_id, campaignId),
        or(isNull(submissions.category), eq(submissions.category, "")),
        eq(submissions.status, "approved"),
        isNull(submissions.deleted_at),
        // Must match finalizeCampaigns exactly. Without this, purging clipper
        // B re-adds already-banned clipper A's still-approved money back into
        // achieved — so a purge that REMOVED money could report the campaign
        // total going UP, and the inflated figure would squeeze honest
        // clippers through the budget clamp until the next cron pass.
        submissionOwnerInGoodStanding
      )
    );

  const [manualTotals] = await db
    .select({ total: sum(balance_entries.amount) })
    .from(balance_entries)
    .where(
      and(
        eq(balance_entries.campaign_id, campaignId),
        eq(balance_entries.type, "manual_adjustment"),
        eq(balance_entries.counts_toward_campaign, true)
      )
    );

  const achieved =
    Number(clipTotals?.totalReward ?? 0) + Number(manualTotals?.total ?? 0);
  const views = Number(clipTotals?.totalViews ?? 0);

  await db
    .update(campaigns)
    .set({ achieved, views })
    .where(eq(campaigns.id, campaignId));

  return { achieved, views };
}

export async function purgeUserClipsFromCampaigns(
  userId: string,
  campaignIds: string[]
): Promise<PurgeCampaignResult[]> {
  const results: PurgeCampaignResult[] = [];

  // Only ever touch campaigns this user actually has counting clips on.
  // The ids arrive from the client and are otherwise unvalidated, and the ban
  // dialog reads its target user from the URL — so hitting browser Back while
  // it is open swaps the user while the ticked ids still belong to the
  // previous one. Intersecting here means the worst case is a no-op instead
  // of purging an innocent clipper's campaign.
  const eligible = new Set(
    (await getBanPurgePreview(userId)).map((c) => c.campaignId)
  );
  const targets = campaignIds.filter((id) => eligible.has(id));

  for (const campaignId of targets) {
    const [campaign] = await db
      .select({
        id: campaigns.id,
        title: campaigns.title,
        ended: campaigns.ended,
        achieved: campaigns.achieved,
        views: campaigns.views,
      })
      .from(campaigns)
      .where(eq(campaigns.id, campaignId))
      .limit(1);
    if (!campaign) continue;

    // ENDED campaigns are left completely alone. Their achieved has been
    // frozen since the day they ended, and the ended-campaign cron keeps
    // flagging post-campaign takedowns as deleted WITHOUT clawing anything
    // back (by design — the campaign already paid out). So rebuilding the
    // total here would silently restate a settled campaign's final spend
    // downward by every post-end deleted clip belonging to EVERY clipper —
    // real money, nothing to do with this ban, and it would never self-heal.
    if (campaign.ended) continue;

    // Everything that still counts for this user on this campaign: live
    // clips, clips still holding money, and clips still holding a payout
    // baseline. Anything in those three buckets has to go.
    const clips = await db
      .select({
        id: submissions.id,
        views: submissions.views,
        reward: submissions.reward,
        status: submissions.status,
      })
      .from(submissions)
      .where(
        and(
          eq(submissions.user_id, userId),
          eq(submissions.campaign_id, campaignId),
          or(
            eq(submissions.status, "approved"),
            gt(submissions.reward, 0),
            isNotNull(submissions.baseline_frozen_views)
          )
        )
      );

    const result: PurgeCampaignResult = {
      campaignId,
      campaignTitle: campaign.title ?? "Untitled campaign",
      clips: clips.length,
      viewsRemoved: 0,
      rewardRemoved: 0,
      clawedFromWallet: 0,
      unrecovered: 0,
      achievedBefore: Number(campaign.achieved ?? 0),
      achievedAfter: Number(campaign.achieved ?? 0),
      campaignViewsBefore: Number(campaign.views ?? 0),
      campaignViewsAfter: Number(campaign.views ?? 0),
    };

    for (const clip of clips) {
      const reward = Number(clip.reward ?? 0);

      // ATOMIC CLAIM, before any money moves. Zero the reward in a single
      // conditional statement and only take money if THIS statement is the
      // one that found it non-zero.
      //
      // Without it the purge reads a clip's $X, then deducts $X, with no lock
      // in between. A request that times out mid-loop and gets retried (or two
      // mods banning at once) has both runs read the same $X and both deduct
      // it. Same shape as the deleted_clawed_back claim revokeSubmissionReward
      // uses for deletions, and it restores the ordering that function's own
      // comment documents: callers zero `reward` first, then revoke.
      //
      // Fails safe: dying between the claim and the revoke loses the clawback
      // rather than doubling it, and the clip can't re-accrue because the view
      // cron now skips banned owners.
      let claimedReward = 0;
      if (reward > 0) {
        const claim = await db
          .update(submissions)
          // deleted_clawed_back is set as part of the SAME claim. The deletion
          // cron reads reward + this flag in one batch select, then re-checks
          // ONLY the flag under its row lock — it never re-reads reward, using
          // the stale amount from its snapshot. So without setting it here,
          // a cron that snapshotted a clip at $5 just before the purge took
          // that $5 would enter its transaction, see the flag still false, and
          // take another $5. Safe against restore: restoreDeletedSubmission
          // reverses only 'clip_deletion' entries, and the purge writes
          // 'user_ban', so a later restore credits 0 rather than mis-refunding.
          .set({ reward: 0, deleted_clawed_back: true })
          .where(and(eq(submissions.id, clip.id), gt(submissions.reward, 0)));
        const affectedRows =
          (claim as unknown as [{ affectedRows?: number }])[0]?.affectedRows ??
          0;
        claimedReward = affectedRows > 0 ? reward : 0;
      }

      if (claimedReward > 0) {
        // allowNegative: the money has to leave the campaign whether or not
        // the clipper still holds it. If they already withdrew it the wallet
        // goes negative, which is the honest record for a banned account.
        const { deducted, shortfall } = await revokeSubmissionReward({
          submissionId: clip.id,
          userId,
          rewardAmount: claimedReward,
          memo: `Reward removed — user banned (${result.campaignTitle})`,
          reason: "Clips purged from campaign on user ban",
          sourceType: BAN_CLAWBACK_SOURCE_TYPE,
          allowNegative: true,
        });
        result.rewardRemoved += claimedReward;
        result.clawedFromWallet += deducted;
        result.unrecovered += shortfall;
      }

      // Only clips that were live were contributing views to the campaign.
      if (clip.status === "approved") {
        result.viewsRemoved += Number(clip.views ?? 0);
      }

      await db
        .update(submissions)
        .set({
          status: "rejected",
          rejected_reason: "User banned — clips removed from campaign",
          // Views must genuinely leave the payout baseline (see header).
          baseline_frozen_views: null,
          reward: 0,
          active: false,
          is_resubmit_prevented: true,
        })
        .where(eq(submissions.id, clip.id));
    }

    // Pull the money and views off the CAMPAIGN's own odometer. Must happen
    // here — no cron will do it for an ended campaign (see the function's
    // comment), so without this the purged money never leaves the campaign.
    const totals = await recomputeCampaignTotals(campaignId);
    result.achievedAfter = Number(totals.achieved.toFixed(2));
    result.campaignViewsAfter = totals.views;

    result.rewardRemoved = Number(result.rewardRemoved.toFixed(2));
    result.clawedFromWallet = Number(result.clawedFromWallet.toFixed(2));
    result.unrecovered = Number(result.unrecovered.toFixed(2));
    result.achievedBefore = Number(result.achievedBefore.toFixed(2));
    results.push(result);
  }

  return results;
}

// What a purge WOULD remove, per campaign — drives the checkbox list in the
// ban dialog so a mod sees the damage before ticking anything.
export async function getBanPurgePreview(userId: string) {
  const rows = await db
    .select({
      campaignId: submissions.campaign_id,
      campaignTitle: campaigns.title,
      active: campaigns.active,
      ended: campaigns.ended,
      clips: sql<number>`COUNT(*)`,
      views: sql<number>`COALESCE(SUM(CASE WHEN ${submissions.status} = 'approved' THEN ${submissions.views} ELSE 0 END), 0)`,
      reward: sql<number>`COALESCE(SUM(${submissions.reward}), 0)`,
    })
    .from(submissions)
    .innerJoin(campaigns, eq(submissions.campaign_id, campaigns.id))
    .where(
      and(
        eq(submissions.user_id, userId),
        // Ended campaigns are not offered: the purge refuses to touch their
        // frozen totals (see recomputeCampaignTotals), so listing them would
        // be a checkbox that silently does nothing.
        eq(campaigns.ended, false),
        or(
          eq(submissions.status, "approved"),
          gt(submissions.reward, 0),
          isNotNull(submissions.baseline_frozen_views)
        )
      )
    )
    .groupBy(submissions.campaign_id, campaigns.title, campaigns.active, campaigns.ended)
    .orderBy(sql`SUM(${submissions.reward}) DESC`);

  return rows.map((r) => ({
    campaignId: r.campaignId,
    campaignTitle: r.campaignTitle ?? "Untitled campaign",
    isLive: Boolean(r.active) && !r.ended,
    clips: Number(r.clips),
    views: Number(r.views),
    reward: Number(Number(r.reward).toFixed(2)),
  }));
}

// ─────────────────────────────────────────────────────────────────────────
// The always-on guard: a banned clipper never earns again.
//
// Before this, banning only blocked LOGIN. Clips kept being view-refreshed
// by the 4-hour cron and kept being paid by the payout cron — $2,572.30 went
// to 66 already-banned users. Both ban tables are honoured: the account ban
// (banned_users) and the per-handle ban (banned_social_media_users).
// ─────────────────────────────────────────────────────────────────────────

// SQL predicate: "this submission belongs to someone who is still in good
// standing" — the owner is not account-banned AND the handle it was posted
// from is not handle-banned. Self-contained (only needs `submissions` in
// scope) and aliased, so it can be dropped into any query without colliding
// with an outer join on verified_users.
//
// Used by the view cron and by the campaign-progress recompute. Without it a
// banned clipper's clips keep being priced into submissions.reward every 4
// hours, which lands directly on campaigns.achieved — so the banned clipper
// eats the client's budget and, because the budget is clamped per run,
// squeezes honest clippers' payouts in the same pass. It also stops the
// odometer gap widening during a ban, which is what made an unban pay out the
// whole ban period in one lump.
// The aliases are written out longhand rather than via drizzle's alias():
// inside a raw sql`` template an aliased table interpolates to just the alias
// NAME, producing `FROM \`vu_ban\`` — a table that doesn't exist. Caught by
// printing the generated SQL.
// Wrapped in its own parens: the body's top-level operator is AND, so an
// unwrapped version is fine inside and()/or() but silently WRONG under not()
// — `not(A AND B)` would compile to `(NOT A) AND B`.
export const submissionOwnerInGoodStanding = sql`(
  NOT EXISTS (
    SELECT 1 FROM ${banned_users}
    WHERE ${banned_users.user_id} = ${submissions.user_id}
  )
  AND NOT EXISTS (
    SELECT 1 FROM ${verified_users} AS vu_ban
    INNER JOIN ${banned_social_media_users} AS bsu_ban
      ON bsu_ban.platform = vu_ban.platform
     AND bsu_ban.handle = vu_ban.handle
    WHERE vu_ban.id = ${submissions.verified_user_id}
  )
)`;
// NO LOWER() on the handle comparison, deliberately. Both columns are
// utf8mb4_0900_ai_ci, so `=` is ALREADY case-insensitive and LOWER() changes
// no result — but wrapping the indexed column in a function makes
// banned_social_media_users_platform_handle_idx unusable, so MySQL scans all
// 296 ban rows for every submission this predicate touches.
//
// That is not theoretical: on the campaigns list, which applies this to a
// LEFT JOIN over ~85k submissions, the LOWER() form measured 13.4s against
// 0.5s without it — 27x, and the reason the campaign cards crawled after this
// predicate shipped. Verified against production that both forms match exactly
// the same 849 (account, ban) pairs.
//
// If a case-SENSITIVE collation is ever introduced on either column, this needs
// a functional index — `(platform, (LOWER(handle)))` — not a LOWER() here.

// SQL predicate for any table carrying a discord user id: "this row does not
// belong to a banned user". Drop into the payout-selection queries on both
// rails so a banned clipper can never be picked, batched, or paid.
//
// Belt and braces alongside cancelling their claims at ban time: the cancel
// only catches rows that are 'requested' at that instant, and Wise's
// revertClaims can flip a row back to 'requested' after a ban has already
// swept. The picker itself has to refuse them.
export const userNotBanned = (userIdColumn: unknown) => sql`
  NOT EXISTS (
    SELECT 1 FROM ${banned_users}
    WHERE ${banned_users.user_id} = ${userIdColumn}
  )
`;

export async function getBannedUserIds(): Promise<Set<string>> {
  const rows = await db
    .select({ userId: banned_users.user_id })
    .from(banned_users);
  return new Set(rows.map((r) => r.userId));
}

export async function isUserBannedFromEarning(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ userId: banned_users.user_id })
    .from(banned_users)
    .where(eq(banned_users.user_id, userId))
    .limit(1);
  return Boolean(row);
}


// ─────────────────────────────────────────────────────────────────────────
// Unban repay — the exact mirror of the purge above
//
// A ban purge marks a clipper's clips `rejected`, zeroes submissions.reward,
// and debits the wallet with source_type = 'user_ban'. When the ban turns out
// to have been wrong, or is lifted on appeal, this puts that back — but only
// for the campaigns a moderator explicitly picks. Reinstatement is a
// judgement call per campaign, not an all-or-nothing switch: a clipper may
// have been legitimately removed from one campaign and unfairly from another.
//
// Money is re-credited through reverseClawback, the same helper the deleted-
// clip Restore button uses. It re-credits the NET still owed (ban debits minus
// any repayments already made), so a repeated purge → repay → purge cycle can
// never double-credit, and pressing the button twice is a no-op the second
// time.
//
// Deliberately does NOT unban the user. Reinstating clips and lifting a ban
// are separate decisions, and a mod may want to return money for work already
// done while keeping the account closed.
// ─────────────────────────────────────────────────────────────────────────

export interface RepayCampaignResult {
  campaignId: string;
  campaignTitle: string;
  clips: number;
  rewardRestored: number;
  achievedBefore: number;
  achievedAfter: number;
}

/**
 * Campaigns where this clipper has clips that a ban purge removed, with the
 * amount that would come back. Drives the campaign picker on the unban dialog.
 */
export async function getUnbanRepayPreview(userId: string) {
  const rows = await db
    .select({
      campaignId: submissions.campaign_id,
      campaignTitle: campaigns.title,
      active: campaigns.active,
      ended: campaigns.ended,
      clips: sql<number>`COUNT(DISTINCT ${submissions.id})`,
      // Ban debits are negative; flip the sign so the UI shows what comes back.
      // Repayments already made are positive under the reverse source type, so
      // summing both nets out to what is still owed.
      owed: sql<number>`COALESCE(-SUM(${balance_entries.amount}), 0)`,
    })
    .from(submissions)
    .innerJoin(campaigns, eq(submissions.campaign_id, campaigns.id))
    .innerJoin(
      balance_entries,
      eq(balance_entries.source_id, submissions.id)
    )
    .where(
      and(
        eq(submissions.user_id, userId),
        // Ended campaigns are excluded for the same reason the purge excludes
        // them: their totals are frozen and recomputeCampaignTotals refuses to
        // touch them, so offering the checkbox would do nothing.
        eq(campaigns.ended, false),
        inArray(balance_entries.source_type, [
          BAN_CLAWBACK_SOURCE_TYPE,
          UNBAN_REPAY_SOURCE_TYPE,
        ])
      )
    )
    .groupBy(
      submissions.campaign_id,
      campaigns.title,
      campaigns.active,
      campaigns.ended
    )
    .having(sql`COALESCE(-SUM(${balance_entries.amount}), 0) > 0`)
    .orderBy(sql`COALESCE(-SUM(${balance_entries.amount}), 0) DESC`);

  return rows.map((r) => ({
    campaignId: r.campaignId,
    campaignTitle: r.campaignTitle ?? "Untitled campaign",
    isLive: Boolean(r.active) && !r.ended,
    clips: Number(r.clips),
    reward: Number(Number(r.owed).toFixed(2)),
  }));
}

/**
 * Put back the clips and the money a ban purge removed, for the chosen
 * campaigns only.
 */
export async function repayUserClipsForCampaigns(
  userId: string,
  campaignIds: string[]
): Promise<RepayCampaignResult[]> {
  const results: RepayCampaignResult[] = [];

  // Same guard the purge uses: intersect the requested ids with what this user
  // actually has to repay. The dialog reads its target user from the URL, so
  // navigating back with checkboxes still ticked could otherwise aim them at a
  // different clipper. Worst case here is a no-op.
  const eligible = new Set(
    (await getUnbanRepayPreview(userId)).map((c) => c.campaignId)
  );
  const targets = campaignIds.filter((id) => eligible.has(id));

  for (const campaignId of targets) {
    const [campaign] = await db
      .select({
        id: campaigns.id,
        title: campaigns.title,
        ended: campaigns.ended,
        achieved: campaigns.achieved,
      })
      .from(campaigns)
      .where(eq(campaigns.id, campaignId))
      .limit(1);
    if (!campaign || campaign.ended) continue;

    const result: RepayCampaignResult = {
      campaignId,
      campaignTitle: campaign.title ?? "Untitled campaign",
      clips: 0,
      rewardRestored: 0,
      achievedBefore: Number(campaign.achieved ?? 0),
      achievedAfter: Number(campaign.achieved ?? 0),
    };

    // Every clip of this user on this campaign that carries a ban debit.
    const clips = await db
      .selectDistinct({ id: submissions.id })
      .from(submissions)
      .innerJoin(balance_entries, eq(balance_entries.source_id, submissions.id))
      .where(
        and(
          eq(submissions.user_id, userId),
          eq(submissions.campaign_id, campaignId),
          eq(balance_entries.source_type, BAN_CLAWBACK_SOURCE_TYPE)
        )
      );

    for (const clip of clips) {
      // reverseClawback re-credits the net still owed and reinstates
      // submissions.reward, so the campaign dashboard recovers too. Returns 0
      // when this clip has already been repaid.
      const { restored } = await reverseClawback({
        submissionId: clip.id,
        clawbackSourceType: BAN_CLAWBACK_SOURCE_TYPE,
        reverseSourceType: UNBAN_REPAY_SOURCE_TYPE,
        memo: `Reward restored — ban lifted for this campaign (${result.campaignTitle})`,
        reinstateReward: true,
      });

      if (restored > 0) {
        result.clips += 1;
        result.rewardRestored += restored;
      }

      // Put the clip back in the payout baseline. deleted_clawed_back is
      // cleared so a future deletion clawback can claim it again — leaving it
      // set would let a genuinely deleted clip keep its money.
      await db
        .update(submissions)
        .set({ status: "approved", deleted_clawed_back: false })
        .where(eq(submissions.id, clip.id));
    }

    // Fold the restored clips back into campaigns.achieved / views. Same helper
    // the purge uses, so both directions agree on how totals are derived.
    const totals = await recomputeCampaignTotals(campaignId);
    result.achievedAfter = totals.achieved;
    result.rewardRestored = Number(result.rewardRestored.toFixed(2));

    results.push(result);
  }

  return results;
}
