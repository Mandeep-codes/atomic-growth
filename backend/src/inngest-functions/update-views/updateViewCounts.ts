import { and, desc, eq, isNull, ne, or, sum } from "drizzle-orm";
import { db } from "../../lib/db";
import {
  balance_entries,
  campaign_cpm_group_members,
  campaign_cpm_groups,
  campaigns,
  non_campaign_clips,
  submissions,
  user_clerk,
  verified_users,
} from "../../lib/schema";
import { submissionOwnerInGoodStanding } from "../../lib/banPurge";
import { getPlatfromFromUrl } from "../../routers/submissions/helpers";
import {
  fetchRichAny,
  fetchRichByUrl,
  youtubeRichFromBatch,
  type YouTubeBatchRich,
} from "./getViewsRich";
import { revokeSubmissionReward } from "../../lib/revokeSubmissionReward";
import { uncoverAndClawbackNonCampaignClip } from "../../lib/noncampaignCascade";
import { ncRedemptionApplies } from "../../lib/ncExemptClippers";

// Fallback per-clip reward floors, used only if a campaign row somehow lacks
// its own (e.g. the migration hasn't run yet). The live values come from the
// campaign's youtube/insta/x/tiktok_min_views columns, editable per campaign
// in the admin campaign settings.
const DEFAULT_MIN_YOUTUBE_SUBMISSION_VIEWS = 1500;
const DEFAULT_MIN_TWITTER_SUBMISSION_VIEWS = 1500;
const DEFAULT_MIN_INSTAGRAM_SUBMISSION_VIEWS = 1500;
const DEFAULT_MIN_TIKTOK_SUBMISSION_VIEWS = 0;

const ALLOW_SKIP_OPTIMIZATION = true;
const MAX_SKIP_COUNT = 4;
const ZERO_DELTA_ATTEMPTS_THRESHOLD = 3;

// Feature 1: a clip must read "gone" on this many CONSECUTIVE successful
// (non-rate-limited) cron checks before it's flagged deleted + clawed back.
// Kills false positives from transient platform/scraper hiccups.
export const DELETION_STRIKE_THRESHOLD = 3;

// KILL-SWITCH. While false, the cron does normal view updates but does NOT
// strike / flag / clawback deleted clips (or accounts). Now ON: a deleted clip
// is handled like a rejected one — its money is removed via the SAME
// revokeSubmissionReward path rejection uses (amount = submissions.reward), but
// allowed to go negative (debt, recovered from future earnings) rather than
// capped at $0. Safe to enable now that the active+ended-campaign clawback bug
// is fixed and deleted clips are excluded from all view/progress/leaderboard
// totals. NOTE: deploying this starts real clawbacks platform-wide on the next
// cron cycles — verify on a test clipper first.
export const DELETION_HANDLING_ENABLED = true;

type CampaignTallies = Record<
  string,
  {
    views: number;
    rewards: number;
  }
>;

// Views beforehand for 754998644205158411 -> 1079222. Change to 180k
const BLOCKED_SUBMISSION_IDS = new Set(["submission_1773082752683"]);

export const isYouTubeUrl = (url: string) => {
  return url.includes("youtube.com") || url.includes("you");
};

// Per-clipper CPM overrides, keyed `${campaign_id}:${user_id}`. The scoreboard
// price (submissions.reward) MUST use the same effective rate the wallet pays,
// otherwise clawbacks (which debit submissions.reward), campaigns.achieved and
// the budget clamp are denominated in a different rate than the money that
// actually left the wallet.
export const getCampaignCpmOverridesMap = async () => {
  const rows = await db
    .select({
      campaign_id: campaign_cpm_group_members.campaign_id,
      user_id: campaign_cpm_group_members.user_id,
      cpm_per_1000: campaign_cpm_groups.cpm_per_1000,
    })
    .from(campaign_cpm_group_members)
    .innerJoin(
      campaign_cpm_groups,
      eq(campaign_cpm_group_members.group_id, campaign_cpm_groups.id)
    );

  return new Map(
    rows.map((row) => [
      `${row.campaign_id}:${row.user_id}`,
      Number(row.cpm_per_1000),
    ])
  );
};

export const getQualifyingSubmissions = async () => {
  const submissionResults = await db
    .selectDistinct({
      submission_id: submissions.id,
      url: submissions.url,
      views: submissions.views,
      view_delta_zero_attempts: submissions.view_delta_zero_attempts,
      view_delta_skip_count: submissions.view_delta_skip_count,
      category: submissions.category,
      platform: submissions.platform,
      max_view_cap: submissions.max_view_cap,
      budget: campaigns.budget,
      max_payout: campaigns.max_payout,
      achieved: campaigns.achieved,
      ended: campaigns.ended,
      sheet_id: campaigns.sheet_id,
      insta_per_1000: campaigns.insta_per_1000,
      x_per_1000: campaigns.x_per_1000,
      youtube_per_1000: campaigns.youtube_per_1000,
      tiktok_per_1000: campaigns.tiktok_per_1000,
      youtube_min_views: campaigns.youtube_min_views,
      insta_min_views: campaigns.insta_min_views,
      x_min_views: campaigns.x_min_views,
      tiktok_min_views: campaigns.tiktok_min_views,
      username: verified_users.username,
      discord_id: verified_users.discord_id,
      campaign_id: submissions.campaign_id,
      user_id: submissions.user_id,
      verified_user_id: submissions.verified_user_id,
      reward: submissions.reward,
      unavailable_strikes: submissions.unavailable_strikes,
      unavailable_since: submissions.unavailable_since,
      deleted_clawed_back: submissions.deleted_clawed_back,
      redeemed_by_non_campaign_clip_id:
        submissions.redeemed_by_non_campaign_clip_id,
      non_campaign_clips_required: campaigns.non_campaign_clips_required,
      // Per-clipper exemption from the per-clip minimum view floor. LEFT join
      // so a submission whose owner has no user_clerk row still qualifies —
      // it just isn't exempt.
      exempt_min_views: user_clerk.exempt_min_views,
    })
    .from(submissions)
    .innerJoin(
      verified_users,
      eq(submissions.verified_user_id, verified_users.id)
    )
    .innerJoin(campaigns, eq(submissions.campaign_id, campaigns.id))
    .leftJoin(user_clerk, eq(user_clerk.discord_id, submissions.user_id))
    .where(
      and(
        eq(submissions.status, "approved"),
        eq(campaigns.active, true),
        // A campaign with BOTH active=1 AND ended=1 counts as ENDED, not
        // active — so it drops out of this (active) cron and is handled by the
        // ended-campaigns cron instead (views + deletion FLAG, never clawback).
        // Without this, an active+ended campaign's deleted clips would get
        // clawed back even though the campaign already paid out.
        eq(campaigns.ended, false),
        // Skip clips already confirmed deleted (frozen until a mod "Restore"s
        // them, which clears deleted_at and lets them back into the cron).
        isNull(submissions.deleted_at),
        // A banned clipper's clips leave the cron entirely. Two reasons:
        //   1. Pricing them kept bumping campaigns.achieved, so a banned
        //      clipper ate the client's budget — and since the budget is
        //      clamped per run, it squeezed honest clippers' payouts in the
        //      same pass and could end the campaign early.
        //   2. Their views used to keep climbing while the paid-through
        //      odometer stayed frozen, so lifting a ban paid out the entire
        //      ban period in one lump. Nothing accrues now, so there is
        //      nothing stored up to release.
        submissionOwnerInGoodStanding
      )
    )
    .orderBy(desc(submissions.platform));

  return submissionResults.filter(
    (submission) => !BLOCKED_SUBMISSION_IDS.has(submission.submission_id)
  );
};

// Feature 1: a clip read "gone" on a successful check. Increment its strike;
// once it crosses the threshold, flag it deleted and claw back its reward
// (once — deleted_clawed_back guards re-clawback). Never called on a
// rate-limited/transient "error" read.
const handleGoneSubmission = async (
  submission: Awaited<ReturnType<typeof getQualifyingSubmissions>>[number]
) => {
  const strikes = (submission.unavailable_strikes ?? 0) + 1;
  const updates: Record<string, unknown> = { unavailable_strikes: strikes };
  if (!submission.unavailable_since) updates.unavailable_since = new Date();

  let clawedBack = 0;
  const confirmed = strikes >= DELETION_STRIKE_THRESHOLD;
  if (confirmed) {
    updates.deleted_at = new Date();
    const reward = Number(submission.reward ?? 0);
    // Only claw back money that was ACTUALLY credited to the wallet. In a
    // redemption campaign an UNREDEEMED clip carries a scoreboard `reward` but
    // was never paid (createReward skips unredeemed clips), so clawing it would
    // push the clipper into debt for money they never received.
    // Exempt clippers are paid WITHOUT coverage, so an uncovered clip of
    // theirs was in fact paid — treating it as neverPaid would skip the
    // clawback and let them keep money for a deleted clip.
    const redemptionEnabled = ncRedemptionApplies(
      submission.user_id,
      submission.non_campaign_clips_required
    );
    const neverPaid =
      redemptionEnabled && !submission.redeemed_by_non_campaign_clip_id;
    if (reward > 0 && !submission.deleted_clawed_back && !neverPaid) {
      // Reserve mode: never push the wallet negative. Take what's there now
      // (down to zero) and open a reserve for any shortfall, which a mod
      // collects later from the "Deleted clips" panel once the clipper earns
      // more. clawedBack reflects the amount actually taken right now.
      const result = await revokeSubmissionReward({
        submissionId: submission.submission_id,
        userId: submission.user_id,
        rewardAmount: reward,
        memo: `-$${reward.toFixed(2)} removed because this reel was deleted/taken down on ${submission.platform}: ${submission.url}`,
        reason: "Clip deleted or taken down",
        sourceType: "clip_deletion",
        reserveOnShortfall: {
          campaignId: submission.campaign_id,
          url: submission.url,
          platform: submission.platform,
          views: Number(submission.views ?? 0),
        },
      });
      updates.deleted_clawed_back = true;
      clawedBack = result.deducted;
    }
  }

  await db
    .update(submissions)
    .set(updates)
    .where(eq(submissions.id, submission.submission_id));

  console.log(
    `🗑️ Submission ${submission.submission_id} gone (strike ${strikes}/${DELETION_STRIKE_THRESHOLD})${
      confirmed ? ` — flagged deleted, clawed back $${clawedBack.toFixed(2)}` : ""
    }`
  );
  return { submissionId: submission.submission_id, gone: true, strikes, deleted: confirmed, clawedBack };
};

export const updateViewCountsForSubmission = async (
  submission: Awaited<ReturnType<typeof getQualifyingSubmissions>>[number],
  options?: {
    youtubeBatch?: YouTubeBatchRich;
    cpmOverrides?: Map<string, number>;
  }
) => {
  const maxViewCap = submission.max_view_cap;
  const existingViews = submission.views || 0;
  const currentViews =
    typeof maxViewCap === "number"
      ? Math.min(existingViews, maxViewCap)
      : existingViews;
  let newViews = currentViews;
  let newViewsApiResponse = currentViews;
  const youtubeBatch = options?.youtubeBatch;

  // Skip-backoff only applies to HEALTHY clips (no active deletion strikes) —
  // we never want to skip a clip mid-way through deletion confirmation.
  if (
    ALLOW_SKIP_OPTIMIZATION &&
    (submission.unavailable_strikes ?? 0) === 0 &&
    submission.view_delta_zero_attempts >= ZERO_DELTA_ATTEMPTS_THRESHOLD &&
    submission.view_delta_skip_count < MAX_SKIP_COUNT
  ) {
    const totalSkips = submission.view_delta_skip_count + 1;
    await db
      .update(submissions)
      .set({ view_delta_skip_count: totalSkips })
      .where(eq(submissions.id, submission.submission_id));

    console.log(
      `⏭️ Skipping submission ${submission.submission_id} due to view backoff; setting total skips to: ${totalSkips}`
    );

    return {
      submissionId: submission.submission_id,
      skipped: true,
      totalSkips,
    };
  }

  // ── One rich fetch: views + availability + owner stable id ──
  let rich;
  try {
    rich = isYouTubeUrl(submission.url)
      ? youtubeRichFromBatch(submission.url, youtubeBatch)
      : await fetchRichByUrl(submission.url);
  } catch (err) {
    console.warn(
      `⚠️ Failed to fetch views for ${submission.submission_id}:`,
      err instanceof Error ? err.message : "Unknown error"
    );
    return;
  }

  // ERROR (rate-limited / transient / unparseable): touch nothing.
  if (rich.state === "error") {
    return { submissionId: submission.submission_id, skipped: true, reason: "fetch-error" };
  }

  // GONE: strike (and clawback once confirmed).
  if (rich.state === "gone") {
    if (!DELETION_HANDLING_ENABLED) {
      return { submissionId: submission.submission_id, skipped: true, reason: "deletion-handling-disabled" };
    }
    return handleGoneSubmission(submission);
  }

  // LIVE: clear any transient strikes, capture the owner's stable id (free,
  // from this same response — Feature 0), then run the normal view/reward path.
  if ((submission.unavailable_strikes ?? 0) > 0 || submission.unavailable_since) {
    await db
      .update(submissions)
      .set({ unavailable_strikes: 0, unavailable_since: null })
      .where(eq(submissions.id, submission.submission_id));
  }
  if (rich.ownerId && submission.verified_user_id) {
    await db
      .update(verified_users)
      .set({
        platform_account_id: rich.ownerId,
        platform_account_secondary_id: rich.ownerSecondaryId,
        platform_account_id_resolved_at: new Date(),
      })
      .where(
        and(
          eq(verified_users.id, submission.verified_user_id),
          isNull(verified_users.platform_account_id)
        )
      );
  }

  newViews = rich.views;
  newViewsApiResponse = rich.views;
  // Per-clip view floor for REWARD purposes (a live-but-low clip stays
  // "live", it just doesn't pay — this is the "why is it 0" distinction).
  // The floor is per campaign + platform (campaigns.*_min_views); 0 = none.
  //
  // EXEMPT CLIPPERS skip the floor entirely: their clips record real views at
  // any size and are paid for them. Granted per person (user_clerk
  // .exempt_min_views), because dropping the floor on the campaign itself
  // would silently change the deal for everyone else on it.
  const exemptFromViewFloor = submission.exempt_min_views === true;
  if (exemptFromViewFloor) {
    // no floor — fall through with the real view count
  } else if (
    submission.url.includes("instagram.com") ||
    submission.url.includes("inst")
  ) {
    const floor =
      submission.insta_min_views ?? DEFAULT_MIN_INSTAGRAM_SUBMISSION_VIEWS;
    if (newViews < floor) newViews = 0;
  } else if (isYouTubeUrl(submission.url)) {
    const floor =
      submission.youtube_min_views ?? DEFAULT_MIN_YOUTUBE_SUBMISSION_VIEWS;
    if (newViews < floor) newViews = 0;
  } else if (
    submission.url.includes("x.com") ||
    submission.url.includes("twitter.com")
  ) {
    const floor =
      submission.x_min_views ?? DEFAULT_MIN_TWITTER_SUBMISSION_VIEWS;
    if (newViews < floor) newViews = 0;
  } else if (submission.url.includes("tiktok")) {
    const floor =
      submission.tiktok_min_views ?? DEFAULT_MIN_TIKTOK_SUBMISSION_VIEWS;
    if (newViews < floor) newViews = 0;
  }

  const normalizedNewViews =
    typeof maxViewCap === "number"
      ? Math.min(newViews, maxViewCap)
      : newViews;
  const viewDelta = normalizedNewViews - currentViews;
  let finalReward = 0;

  if (viewDelta > 0) {
    const platform = await getPlatfromFromUrl(submission.url);

    let ratePer1000 = 0;
    if (platform === "instagram") {
      ratePer1000 = submission.insta_per_1000 || 0;
    } else if (platform === "x") {
      ratePer1000 = submission.x_per_1000 || 0;
    } else if (platform === "youtube") {
      ratePer1000 = submission.youtube_per_1000 || 0;
    } else if (platform === "tiktok") {
      ratePer1000 = submission.tiktok_per_1000 || 0;
    }

    // Per-clipper CPM override: same absolute rate the wallet pays
    // (createCampaignViewRewards.resolveCpm), so submissions.reward — which
    // prices clawbacks and feeds campaigns.achieved — matches the wallet.
    // Disabled platforms (rate 0) stay 0. When the caller didn't preload the
    // overrides map, fall back to a single indexed lookup — only reached when
    // this clip actually gained views.
    if (ratePer1000 > 0) {
      let override = options?.cpmOverrides?.get(
        `${submission.campaign_id}:${submission.user_id}`
      );
      if (override === undefined && !options?.cpmOverrides) {
        const [row] = await db
          .select({ cpm_per_1000: campaign_cpm_groups.cpm_per_1000 })
          .from(campaign_cpm_group_members)
          .innerJoin(
            campaign_cpm_groups,
            eq(campaign_cpm_group_members.group_id, campaign_cpm_groups.id)
          )
          .where(
            and(
              eq(
                campaign_cpm_group_members.campaign_id,
                submission.campaign_id
              ),
              eq(campaign_cpm_group_members.user_id, submission.user_id)
            )
          )
          .limit(1);
        if (row) override = Number(row.cpm_per_1000);
      }
      if (override !== undefined && override > 0) {
        ratePer1000 = override;
      }
    }

    // FORWARD-ONLY pricing: score only the NEW views at the current effective
    // rate and add them to the reward already banked. The old formula
    // (normalizedNewViews x current rate) repriced the clip's ENTIRE history
    // whenever a rate changed — a mid-campaign rate edit or per-user override
    // would inflate/deflate submissions.reward away from what the wallet
    // actually paid (wallet pays deltas at the rate in force), corrupting
    // every clawback amount and campaigns.achieved. Delta-based accumulation
    // keeps the scoreboard denominated in the same money as the wallet.
    const previousReward = Number(submission.reward ?? 0);
    const rewardIncrement = (viewDelta / 1000) * ratePer1000;
    // max_payout 0/NULL means NO per-clip cap — the wallet path reads it the
    // same way (`if (campaign.max_payout)` skips the cap block). The old
    // scoreboard treated it as a $0 cap and zeroed every reward, silently
    // diverging from the money the wallet actually paid.
    const submissionMax =
      (submission.max_payout ?? 0) > 0
        ? ((submission.budget ?? 0) * (submission.max_payout ?? 0)) / 100
        : Number.POSITIVE_INFINITY;

    // Category clips draw from a SEPARATE per-category budget
    // (campaign_categories.budget) that this cron does not track, and
    // finalizeCampaigns EXCLUDES them from campaigns.achieved. So they keep the
    // legacy snapshot clamp and DON'T touch campaigns.achieved — bumping it here
    // would reopen global headroom the non-category cap below just closed. A true
    // per-category hard cap is a separate follow-up (needs category rate + a
    // per-category ledger).
    const isCategoryClip = Boolean(
      submission.category && submission.category !== ""
    );

    if (isCategoryClip) {
      const remainingBudget = Math.max(
        Number(submission.budget) - Number(submission.achieved),
        0
      );
      finalReward = Math.max(
        previousReward,
        Math.min(
          previousReward + Math.min(rewardIncrement, remainingBudget),
          submissionMax
        )
      );
      await db
        .update(submissions)
        .set({
          views: normalizedNewViews,
          views_api_response: newViewsApiResponse,
          reward: finalReward,
          view_delta_zero_attempts: 0,
          view_delta_skip_count: 0,
        })
        .where(eq(submissions.id, submission.submission_id));
    } else {
      // HARD BUDGET CAP for non-category clips — exactly the money
      // finalizeCampaigns totals into campaigns.achieved. The old code clamped
      // each clip's increment against a per-RUN snapshot of achieved shared by
      // every clip in the batch, so N clips could each spend the same remaining
      // headroom and blow past budget in one cron cycle. Instead, reserve budget
      // atomically under a campaign row lock, against the LIVE achieved, bumping
      // it as we bank. Every non-category clip of a campaign serializes on this
      // lock, so their summed reward can NEVER exceed budget — across concurrent
      // clips, chunks, or Inngest step re-invocations. finalizeCampaigns still
      // recomputes achieved = SUM(non-category reward) + manual adjustments at
      // run end, so the running value stays authoritative and self-heals.
      finalReward = await db.transaction(async (tx) => {
        const [camp] = await tx
          .select({ budget: campaigns.budget, achieved: campaigns.achieved })
          .from(campaigns)
          .where(eq(campaigns.id, submission.campaign_id))
          .for("update");
        const budget = Number(camp?.budget ?? 0);
        const liveAchieved = Number(camp?.achieved ?? 0);
        const remainingBudget = Math.max(budget - liveAchieved, 0);

        // Clamp the increment to remaining budget, then the cumulative total to
        // the per-clip cap. Never reduce an already-banked reward — receded/
        // repriced history is handled by clawback flows only.
        const newReward = Math.max(
          previousReward,
          Math.min(
            previousReward + Math.min(rewardIncrement, remainingBudget),
            submissionMax
          )
        );
        const actualGrant = Math.max(newReward - previousReward, 0);

        await tx
          .update(submissions)
          .set({
            views: normalizedNewViews,
            views_api_response: newViewsApiResponse,
            reward: newReward,
            view_delta_zero_attempts: 0,
            view_delta_skip_count: 0,
          })
          .where(eq(submissions.id, submission.submission_id));

        // Reserve the spend immediately so the next clip of this campaign sees
        // less headroom. Guarded by the row lock above, so it's race-free.
        if (actualGrant > 0) {
          await tx
            .update(campaigns)
            .set({ achieved: liveAchieved + actualGrant })
            .where(eq(campaigns.id, submission.campaign_id));
        }

        return newReward;
      });
    }
  } else if (ALLOW_SKIP_OPTIMIZATION) {
    let zeroDeltaAttempts = Math.min(
      submission.view_delta_zero_attempts + 1,
      ZERO_DELTA_ATTEMPTS_THRESHOLD
    );

    // reset skips
    const skips =
      submission.view_delta_skip_count >= MAX_SKIP_COUNT
        ? 0
        : submission.view_delta_skip_count;

    await db
      .update(submissions)
      .set({
        view_delta_zero_attempts: zeroDeltaAttempts,
        view_delta_skip_count: skips,
      })
      .where(eq(submissions.id, submission.submission_id));
  }

  const res = {
    submissionId: submission.submission_id,
    oldViews: submission.views,
    newViews,
    finalReward,
    viewDelta,
  };

  console.log("Updated submission", res);
  return res;
};

export const finalizeCampaigns = async () => {
  const campaignTallies: CampaignTallies = {};
  const campaignResults = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.ended, false));

  let finalResult = {
    campaignsEnded: [] as string[],
  };
  for (const campaign of campaignResults) {
    const totals = await db
      .select({
        totalReward: sum(submissions.reward),
        totalViews: sum(submissions.views),
      })
      .from(submissions)
      .where(
        and(
          eq(submissions.campaign_id, campaign.id),
          or(isNull(submissions.category), eq(submissions.category, "")),
          eq(submissions.status, "approved"),
          // Deleted clips no longer count toward campaign progress or total views.
          isNull(submissions.deleted_at),
          // Nor do a banned clipper's clips. The cron above stops pricing
          // them, but whatever they had already accrued would otherwise sit
          // in achieved forever, still eating the client's budget.
          submissionOwnerInGoodStanding
        )
      );

    // Manual adjustments the admin flagged as campaign money (checkbox on
    // the manual-rewards page, default ON). Sign is preserved: a negative
    // adjustment reduces achieved. Only type=manual_adjustment can carry the
    // flag — rewards reach achieved through submissions.reward already.
    const [manualTotals] = await db
      .select({
        total: sum(balance_entries.amount),
      })
      .from(balance_entries)
      .where(
        and(
          eq(balance_entries.campaign_id, campaign.id),
          eq(balance_entries.type, "manual_adjustment"),
          eq(balance_entries.counts_toward_campaign, true)
        )
      );

    const totalAchieved =
      Number(totals[0]?.totalReward || 0) + Number(manualTotals?.total || 0);
    const totalViews = Number(totals[0]?.totalViews || 0);

    campaignTallies[campaign.id] = {
      rewards: totalAchieved,
      views: totalViews,
    };

    await db
      .update(campaigns)
      .set({ achieved: totalAchieved, views: totalViews })
      .where(eq(campaigns.id, campaign.id));

    console.log(
      `📈 Campaign ${campaign.id} updated: ₹${totalAchieved.toFixed(
        2
      )} earned, ${totalViews} views`
    );

    // ❌ End campaign if budget is fully used (including gloabl and category specific budgets)
    if (Number(totalAchieved) >= Number(campaign.budget)) {
      await db
        .update(campaigns)
        .set({ ended: true, active: false })
        .where(eq(campaigns.id, campaign.id));

      await db
        .update(submissions)
        .set({ active: false })
        .where(eq(submissions.campaign_id, campaign.id));

      finalResult.campaignsEnded.push(
        campaign.title ?? "Untitled Campaign" + " - " + campaign.id
      );

      console.log(
        `🚫 Campaign ${campaign.title} ended — budget $${campaign.budget} exhausted`
      );
    }
  }

  return finalResult;
};

// ── Non-campaign clip view tracking ──
// Same 4-hour cron also updates non_campaign_clips.views. Mirrors the
// submissions path but simpler: NC clips don't earn rewards or pay out,
// so we just fetch and write the view count back. We process every NC clip
// that isn't rejected (status pending OR approved).
export const getQualifyingNonCampaignClips = async () => {
  return db
    .select({
      id: non_campaign_clips.id,
      url: non_campaign_clips.url,
      platform: non_campaign_clips.platform,
      views: non_campaign_clips.views,
      unavailable_strikes: non_campaign_clips.unavailable_strikes,
      unavailable_since: non_campaign_clips.unavailable_since,
      deleted_clawed_back: non_campaign_clips.deleted_clawed_back,
    })
    .from(non_campaign_clips)
    .where(
      and(
        ne(non_campaign_clips.status, "rejected"),
        // Frozen once confirmed deleted — until restored.
        isNull(non_campaign_clips.deleted_at)
      )
    );
};

export const updateViewCountsForNonCampaignClip = async (
  clip: {
    id: string;
    url: string;
    platform: string;
    views: number;
    unavailable_strikes?: number;
    unavailable_since?: Date | null;
    deleted_clawed_back?: boolean;
  },
  // Pre-fetched YouTube batch for the chunk (1 quota unit per 50 clips vs
  // 1 per clip). When absent, falls back to the single-clip fetch — same
  // data, just 50x the quota; only the cron passes the batch.
  opts?: { youtubeBatch?: YouTubeBatchRich }
) => {
  let rich;
  try {
    const isYouTube =
      clip.url.includes("youtube.com") || clip.url.includes("you");
    rich =
      isYouTube && opts?.youtubeBatch
        ? youtubeRichFromBatch(clip.url, opts.youtubeBatch)
        : await fetchRichAny(clip.url);
  } catch (err) {
    console.warn(
      `⚠️ Failed to fetch views for non-campaign clip ${clip.id}:`,
      err instanceof Error ? err.message : "Unknown error"
    );
    return;
  }

  // ERROR (rate-limited / transient): touch nothing.
  if (rich.state === "error") return;

  // GONE: strike; once confirmed, flag deleted + cascade-uncover the campaign
  // clips this NC clip was unlocking (same as rejecting it) — their rewards
  // are clawed back as debt, restored when a new NC clip re-covers them.
  if (rich.state === "gone") {
    if (!DELETION_HANDLING_ENABLED) return;
    const strikes = (clip.unavailable_strikes ?? 0) + 1;
    const updates: Record<string, unknown> = { unavailable_strikes: strikes };
    if (!clip.unavailable_since) updates.unavailable_since = new Date();
    if (strikes >= DELETION_STRIKE_THRESHOLD) {
      updates.deleted_at = new Date();
      await uncoverAndClawbackNonCampaignClip(
        clip.id,
        clip.url,
        "deleted (no longer available)"
      );
      updates.deleted_clawed_back = true;
    }
    await db
      .update(non_campaign_clips)
      .set(updates)
      .where(eq(non_campaign_clips.id, clip.id));
    console.log(
      `🗑️ Non-campaign clip ${clip.id} gone (strike ${strikes}/${DELETION_STRIKE_THRESHOLD})`
    );
    return;
  }

  // LIVE: clear any transient strikes; write views if changed.
  if ((clip.unavailable_strikes ?? 0) > 0 || clip.unavailable_since) {
    await db
      .update(non_campaign_clips)
      .set({ unavailable_strikes: 0, unavailable_since: null })
      .where(eq(non_campaign_clips.id, clip.id));
  }
  if (rich.views !== clip.views) {
    await db
      .update(non_campaign_clips)
      .set({ views: rich.views })
      .where(eq(non_campaign_clips.id, clip.id));
    console.log(`📈 Non-campaign clip ${clip.id}: ${clip.views} → ${rich.views}`);
  }
};
