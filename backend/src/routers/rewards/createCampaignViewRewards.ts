import { and, asc, eq, gt, isNotNull, isNull, ne, or, sql, sum } from "drizzle-orm";
import { ncRedemptionApplies } from "../../lib/ncExemptClippers";
import { db } from "../../lib/db";
import {
  getBannedUserIds,
  isUserBannedFromEarning,
} from "../../lib/banPurge";
import {
  banned_social_media_users,
  campaign_cpm_group_members,
  campaign_cpm_groups,
  campaign_levels,
  campaign_view_rewards,
  campaigns,
  submissions,
  verified_users,
} from "../../lib/schema";
import { createReward } from "./createReward";
import { buildGeoBonusResolver } from "../../lib/geo-payout";

export const createCampaignViewRewards = async ({
  campaignId,
  idempotencyKey,
  cpmBoostByUserIds,
}: {
  campaignId: string;
  idempotencyKey: string;
  cpmBoostByUserIds?: Map<string, number>;
}) => {
  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);

  if (!campaign) {
    throw new Error("Campaign not found");
  }

  const campaignLevels = await db
    .select({
      id: campaign_levels.id,
      level_threshold: campaign_levels.level_threshold,
      cpm_rate: campaign_levels.cpm_rate,
    })
    .from(campaign_levels)
    .where(eq(campaign_levels.campaign_id, campaignId))
    .orderBy(asc(campaign_levels.level_threshold));

  const cpmOverrides = await db
    .select({
      user_id: campaign_cpm_group_members.user_id,
      cpm_per_1000: campaign_cpm_groups.cpm_per_1000,
    })
    .from(campaign_cpm_group_members)
    .innerJoin(
      campaign_cpm_groups,
      eq(campaign_cpm_group_members.group_id, campaign_cpm_groups.id)
    )
    .where(eq(campaign_cpm_group_members.campaign_id, campaignId));
  const cpmOverrideByUserId = new Map(
    cpmOverrides.map((o) => [o.user_id, Number(o.cpm_per_1000)])
  );

  const resolveCpm = (baseCpm: number, totalViews: number, userId: string) => {
    // Disabled platform (rate 0) stays disabled for everyone — an override
    // must never resurrect a platform the campaign doesn't pay on.
    if (baseCpm <= 0) {
      return baseCpm;
    }

    // Per-user override is an ABSOLUTE rate: it replaces the base rate,
    // level tiers, and hot-streak boosts, so the number an admin types is
    // exactly the number paid.
    const override = cpmOverrideByUserId.get(userId);
    if (override !== undefined && override > 0) {
      return override;
    }

    let effectiveCpm = baseCpm;
    if (campaignLevels.length > 0) {
      for (const level of campaignLevels) {
        if (totalViews >= level.level_threshold && level.cpm_rate > 0) {
          effectiveCpm = level.cpm_rate;
        }
      }
    }

    if (cpmBoostByUserIds) {
      const cpmBoost = cpmBoostByUserIds.get(userId);
      if (cpmBoost != undefined) {
        effectiveCpm = effectiveCpm + cpmBoost;
      }
    }

    return effectiveCpm;
  };

  // Qualified users for view rewards
  const users = await db
    .select({
      userId: submissions.user_id,
      totalViews: sum(submissions.views).as("total_views"),
    })
    .from(submissions)
    .where(
      and(
        eq(submissions.campaign_id, campaignId),
        eq(submissions.status, "approved"),
        // Deleted clips' frozen views must NOT help a clipper clear the
        // min-payout threshold or reach a higher CPM tier. This sum feeds both
        // the .having() payout gate below and resolveCpm's level selection.
        isNull(submissions.deleted_at)
      )
    )
    .groupBy(submissions.user_id)
    .having(gt(sql`SUM(${submissions.views})`, campaign.min_payout));

  // One load per campaign, reused for every account below. Returns a no-op
  // resolver when GEO_PAYOUT_ENABLED is false or the campaign has no rules —
  // which is what keeps existing campaigns on exactly today's code path.
  const geoResolver = await buildGeoBonusResolver(campaignId);

  // A banned clipper never earns again. Banning used to block LOGIN only —
  // the payout cron had no idea the ban existed, so banned users kept
  // collecting on every 4-hour run ($2,572.30 across 66 of them before this
  // guard). One set lookup per campaign, so the cost is a single query.
  const bannedUserIds = await getBannedUserIds();
  const payableUsers = users.filter((u) => !bannedUserIds.has(u.userId));
  const skippedBanned = users.length - payableUsers.length;
  if (skippedBanned > 0) {
    console.log(
      `🚫 Campaign ${campaignId}: skipped ${skippedBanned} banned clipper(s) in payout`
    );
  }

  let successCount = 0;
  let failureCount = 0;
  let failedUserIdsSample: { userId: string; error: string }[] = [];
  for (const user of payableUsers) {
    const allSubmissions = await getAllSubmissions(user.userId, campaignId);
    const totalViews = Number(user.totalViews ?? 0);
    try {
      // Skip DISABLED platforms (resolved cpm <= 0) instead of letting
      // createReward throw "CPM is not valid" inside the Promise.all: that
      // throw rejected the batch EARLY while sibling payment transactions
      // were still in flight, so on any campaign with one disabled platform
      // every user counted as failed and the run returned with payments
      // still uncommitted (they landed as stragglers, saved only by the
      // HWM idempotency). Caught live by the local smoke test.
      const platformRates: [string, number][] = [
        ["youtube", campaign.youtube_per_1000],
        ["instagram", campaign.insta_per_1000],
        ["tiktok", campaign.tiktok_per_1000],
        ["x", campaign.x_per_1000],
      ];
      const enabledPlatforms = platformRates
        .map(([platform, baseCpm]) => ({
          platform,
          cpm: resolveCpm(baseCpm, totalViews, user.userId),
        }))
        .filter(({ cpm }) => cpm > 0);

      if (geoResolver.isNoop) {
        // Unchanged path: one odometer per (user, campaign, platform), every
        // account summed together. This is what runs for every campaign with no
        // geo rules, and for ALL campaigns while GEO_PAYOUT_ENABLED is false.
        await Promise.all(
          enabledPlatforms.map(({ platform, cpm }) =>
            createReward({
              userId: user.userId,
              campaign: campaign,
              submissions: allSubmissions,
              platform,
              cpm,
              idempotencyKey: `${user.userId}:${idempotencyKey}:${platform}`,
            })
          )
        );
      } else {
        // Per-account path. Each connected account is priced on its own
        // odometer at base + its own geo bonus, so two accounts of the same
        // clipper on one platform can and do pay different rates.
        //
        // A per-clipper manual CPM override stays ABSOLUTE — resolveCpm already
        // returned it, and stacking a geo bonus on top would silently override
        // the exact number an admin typed by hand.
        const hasManualOverride = cpmOverrideByUserId.has(user.userId);

        const calls: Promise<unknown>[] = [];
        for (const { platform, cpm } of enabledPlatforms) {
          // Only accounts that actually posted on THIS platform, so we don't
          // open empty odometers for unrelated accounts.
          const accountIds = new Set<string>();
          for (const row of allSubmissions) {
            if (row.submissions.platform !== platform) continue;
            if (row.submissions.verified_user_id) {
              accountIds.add(row.submissions.verified_user_id);
            }
          }

          for (const accountId of accountIds) {
            const bonus = hasManualOverride ? 0 : geoResolver.bonusFor(accountId);
            calls.push(
              createReward({
                userId: user.userId,
                campaign: campaign,
                submissions: allSubmissions,
                platform,
                cpm: cpm + bonus,
                geoBonusCpm: bonus,
                verifiedUserId: accountId,
                idempotencyKey: `${user.userId}:${idempotencyKey}:${platform}:${accountId}`,
              })
            );
          }
        }
        await Promise.all(calls);
      }
      successCount++;
    } catch (error) {
      console.warn(
        `Error creating reward for user id ${user.userId} and campaign id ${campaignId}: ${error}`
      );
      failureCount++;
      if (failedUserIdsSample.length < 10) {
        failedUserIdsSample.push({
          userId: user.userId,
          error: JSON.stringify(error),
        });
      }
    }
  }

  return {
    successCount,
    failureCount,
    failedUserIdsSample,
    skippedBanned,
  };
};

// Pay ONE user's pending view deltas at the rates in force RIGHT NOW —
// called by every rate-group mutation (add member, remove member, change
// group rate, delete group) immediately BEFORE the rate change takes
// effect, so views accrued up to this moment are settled at the old rate
// and the new rate provably applies only to views that arrive after it.
// Money-safe by construction: the balances-row lock serializes against a
// concurrent cron payout, and the view high-water mark makes a repeat call
// a no-op (delta 0). Users below the campaign's min_payout view gate are
// skipped, same as the cron (their backlog pays at whichever rate is in
// force when they first cross the gate).
export const settleUserCampaignViewRewards = async ({
  campaignId,
  userId,
}: {
  campaignId: string;
  userId: string;
}) => {
  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);

  if (!campaign) {
    throw new Error("Campaign not found");
  }

  // Mirror the payout cron's scope: paused/ended campaigns deliberately
  // never pay (ended ones keep accruing view counts via the ended-campaigns
  // cron, so their "backlog" must never be settled as a side effect of an
  // admin typing a rate).
  if (!campaign.active || campaign.ended) {
    return { settled: false, reason: "campaign is not paying (paused/ended)" };
  }

  // Same guard as the cron: a banned clipper's backlog is never settled, so
  // an admin touching a rate group can't accidentally pay one out.
  if (await isUserBannedFromEarning(userId)) {
    return { settled: false, reason: "clipper is banned" };
  }

  const [userTotals] = await db
    .select({
      totalViews: sum(submissions.views).as("total_views"),
    })
    .from(submissions)
    .where(
      and(
        eq(submissions.campaign_id, campaignId),
        eq(submissions.user_id, userId),
        eq(submissions.status, "approved"),
        isNull(submissions.deleted_at)
      )
    );

  const totalViews = Number(userTotals?.totalViews ?? 0);
  if (totalViews <= campaign.min_payout) {
    return { settled: false, reason: "below min payout gate" };
  }

  const campaignLevels = await db
    .select({
      level_threshold: campaign_levels.level_threshold,
      cpm_rate: campaign_levels.cpm_rate,
    })
    .from(campaign_levels)
    .where(eq(campaign_levels.campaign_id, campaignId))
    .orderBy(asc(campaign_levels.level_threshold));

  // Current group rate, if this is a rate CHANGE rather than a first grant —
  // the backlog then settles at the old group rate, which is exactly
  // "the rate in force until now".
  const [existingOverride] = await db
    .select({ cpm_per_1000: campaign_cpm_groups.cpm_per_1000 })
    .from(campaign_cpm_group_members)
    .innerJoin(
      campaign_cpm_groups,
      eq(campaign_cpm_group_members.group_id, campaign_cpm_groups.id)
    )
    .where(
      and(
        eq(campaign_cpm_group_members.campaign_id, campaignId),
        eq(campaign_cpm_group_members.user_id, userId)
      )
    )
    .limit(1);

  const resolveCurrentCpm = (baseCpm: number) => {
    if (baseCpm <= 0) return baseCpm;
    if (existingOverride && Number(existingOverride.cpm_per_1000) > 0) {
      return Number(existingOverride.cpm_per_1000);
    }
    let effectiveCpm = baseCpm;
    for (const level of campaignLevels) {
      if (totalViews >= level.level_threshold && level.cpm_rate > 0) {
        effectiveCpm = level.cpm_rate;
      }
    }
    return effectiveCpm;
  };

  const allSubmissions = await getAllSubmissions(userId, campaignId);
  const settleKey = `${userId}:settle-${campaignId}-${Date.now()}`;

  const platforms: [string, number][] = [
    ["youtube", campaign.youtube_per_1000],
    ["instagram", campaign.insta_per_1000],
    ["tiktok", campaign.tiktok_per_1000],
    ["x", campaign.x_per_1000],
  ];

  for (const [platform, baseCpm] of platforms) {
    const cpm = resolveCurrentCpm(baseCpm);
    if (cpm <= 0) continue; // disabled platform — nothing to settle
    await createReward({
      userId,
      campaign,
      submissions: allSubmissions,
      platform,
      cpm,
      idempotencyKey: `${settleKey}:${platform}`,
    });
  }

  // Verify the backlog ACTUALLY settled. If the max_payout cap clamped or
  // skipped a platform, the leftover views would silently reprice at the
  // NEW rate on the next payout — the exact thing the settle exists to
  // prevent. Refuse instead, so the admin sees it and can raise the cap
  // first. (Sub-nickel dust from MIN_REWARD/rounding is tolerated.)
  // Exempt clippers (ncExemptClippers.ts) are paid as if covered — the
  // requirement simply doesn't apply to them on any campaign.
  const redemptionEnabled = ncRedemptionApplies(
    userId,
    campaign.non_campaign_clips_required
  );
  const hwmRows = await db
    .select({
      platform: campaign_view_rewards.platform,
      hwm: sql<number>`COALESCE(MAX(${campaign_view_rewards.view_count}), 0)`,
    })
    .from(campaign_view_rewards)
    .where(
      and(
        eq(campaign_view_rewards.user_id, userId),
        eq(campaign_view_rewards.campaign_id, campaignId)
      )
    )
    .groupBy(campaign_view_rewards.platform);
  const hwmByPlatform = new Map(
    hwmRows.map((row) => [row.platform, Number(row.hwm)])
  );

  for (const [platform, baseCpm] of platforms) {
    const cpm = resolveCurrentCpm(baseCpm);
    if (cpm <= 0) continue;
    // Same baseline createReward uses: platform match + redemption filter,
    // deleted clips included (their frozen views sit inside the HWM).
    const platformViewCount = allSubmissions.reduce((acc, submission) => {
      if (submission.submissions.platform !== platform) return acc;
      return acc + payableViews(submission.submissions, redemptionEnabled);
    }, 0);
    const unsettled = platformViewCount - (hwmByPlatform.get(platform) ?? 0);
    if (unsettled > 0 && (unsettled * cpm) / 1000 >= 0.05) {
      throw new Error(
        `max_payout cap blocks settling ${unsettled} pending ${platform} views at the old rate — raise the cap or budget before changing this clipper's rate`
      );
    }
  }

  return { settled: true };
};

export const getAllSubmissions = async (userId: string, campaignId: string) => {
  // Redemption-ledger filter: only payable campaign clips have a non-null
  // redeemed_by_non_campaign_clip_id (or live on a campaign with the
  // requirement disabled — handled separately by the campaign opting in).
  // The cleanest predicate here is "skip rows that are unredeemed", which
  // we encode as `(redeemed_by_non_campaign_clip_id IS NOT NULL) OR (campaign disabled)`.
  // But since this function is per-campaign, we can short-circuit: if the
  // campaign has the requirement disabled, every approved submission stays
  // payable; if enabled, only redeemed ones pay.
  //
  // To keep the SQL simple and avoid joining campaigns here, we filter by
  // `(redeemed_by IS NOT NULL OR redeemed_by IS NULL)` — wait, that's
  // tautological. Better: drop the filter here and let downstream code or
  // a follow-up handle it. For now, gate ONLY rows where the campaign
  // opted in but the row isn't redeemed.
  //
  // Simplest implementation: filter at the call site after this fn returns
  // by checking campaign.non_campaign_clips_required. Done in createReward.
  return await db
    .select()
    .from(submissions)
    .leftJoin(
      verified_users,
      eq(submissions.verified_user_id, verified_users.id)
    )
    .where(
      and(
        eq(submissions.user_id, userId),
        eq(submissions.campaign_id, campaignId),
        // Approved clips pay live; clips with a frozen-baseline snapshot
        // (rejected / NC-uncovered after being paid) keep contributing their
        // snapshot regardless of status — see payableViews below.
        or(
          eq(submissions.status, "approved"),
          isNotNull(submissions.baseline_frozen_views)
        ),
        // A clip posted from a BANNED handle contributes nothing. banHandle
        // zeroes the reward once, but the clip stayed approved and simply
        // re-earned on the next cron — $1,053.30 leaked back out that way.
        // Dropping it from the baseline leaves the odometer above the
        // baseline, which is exactly "never pays again".
        // No LOWER(): both handle columns are utf8mb4_0900_ai_ci, so `=` is
        // already case-insensitive, and wrapping the indexed column kills
        // banned_social_media_users_platform_handle_idx. Same reasoning (and the
        // same measurement) as submissionOwnerInGoodStanding in lib/banPurge.ts.
        sql`NOT EXISTS (
          SELECT 1 FROM ${banned_social_media_users}
          WHERE ${banned_social_media_users.platform} = ${verified_users.platform}
            AND ${banned_social_media_users.handle} = ${verified_users.handle}
        )`,
        // ── A TERMINATED channel contributes nothing ──
        //
        // The ban guard above covers handles WE banned. Nothing covered a
        // channel the platform itself terminated, so those clips stayed in the
        // baseline and kept earning: 7,220 submissions across 454 clippers,
        // and 169 of them still had their views refreshed in the last week.
        //
        // A terminated channel's clips are gone — they cannot be watched, so
        // they cannot deliver anything new to a campaign. Paying on them is
        // paying for views that will never happen again.
        //
        // isNull is correct on this LEFT JOIN: a submission with no
        // verified_users row at all has a NULL here and keeps paying exactly
        // as it does today. This only removes accounts we positively know were
        // terminated.
        isNull(verified_users.account_deleted_at)
      )
    );
};

// THE payable-baseline rule — the single source of truth shared by
// createReward's per-platform sum and the settle-verification guard. Keep
// them identical or the guard spuriously throws / the payout mis-pays.
//
// Order matters:
// 1. A frozen-baseline snapshot wins over everything: the clip contributes
//    exactly the views that were in the baseline when it left live payout
//    (its money was clawed back then). Frozen views can't grow (no re-pay)
//    and never leave (no freeze).
// 2. Otherwise only approved clips contribute (deleted-but-approved clips
//    stay in — their frozen views sit under the odometer by design).
// 3. On redemption campaigns, unredeemed clips contribute nothing (they've
//    never been paid).
export const payableViews = (
  submission: {
    status: string | null;
    views: number | null;
    baseline_frozen_views: number | null;
    redeemed_by_non_campaign_clip_id: string | null;
  },
  redemptionEnabled: boolean
): number => {
  if (submission.baseline_frozen_views !== null) {
    return submission.baseline_frozen_views;
  }
  if (submission.status !== "approved") return 0;
  if (redemptionEnabled && !submission.redeemed_by_non_campaign_clip_id) {
    return 0;
  }
  return submission.views ?? 0;
};

// THE correct frozen-snapshot value for a clip about to leave live payout
// (rejection / NC-uncover). NOT its raw live views — its PAID-THROUGH
// contribution, clamped so the total baseline can never exceed the odometer
// (MAX view_count). Without the clamp, a clip carrying views the odometer
// never paid — unpaid growth since the last cron, or views held back by the
// max_payout/budget cap — would get that excess PAID on the next cron even
// though the clip is now rejected/uncovered (the confirmed overshoot bug).
// Never freezes more than the clip's own views. Callers must have already
// applied any snapshot on SIBLING clips being frozen in the same operation
// (process sequentially) so `otherBaseline` reflects them.
export const computeFrozenSnapshotViews = async (
  clip: {
    id: string;
    user_id: string;
    campaign_id: string;
    platform: string;
    views: number | null;
  },
  redemptionEnabled: boolean
): Promise<number> => {
  const clipViews = clip.views ?? 0;
  if (clipViews <= 0) return 0;

  const [odo] = await db
    .select({
      v: sql<number>`COALESCE(MAX(${campaign_view_rewards.view_count}), 0)`,
    })
    .from(campaign_view_rewards)
    .where(
      and(
        eq(campaign_view_rewards.user_id, clip.user_id),
        eq(campaign_view_rewards.campaign_id, clip.campaign_id),
        eq(campaign_view_rewards.platform, clip.platform)
      )
    );
  const odometer = Number(odo?.v ?? 0);

  // payableViews of every OTHER clip for this (user, campaign, platform),
  // in SQL — snapshot wins, else approved(+redeemed) live views, else 0.
  const redeemedClause = redemptionEnabled
    ? sql`AND ${submissions.redeemed_by_non_campaign_clip_id} IS NOT NULL`
    : sql``;
  const [others] = await db
    .select({
      v: sql<number>`COALESCE(SUM(CASE
        WHEN ${submissions.baseline_frozen_views} IS NOT NULL
          THEN ${submissions.baseline_frozen_views}
        WHEN ${submissions.status} = 'approved' ${redeemedClause}
          THEN ${submissions.views}
        ELSE 0 END), 0)`,
    })
    .from(submissions)
    .where(
      and(
        eq(submissions.user_id, clip.user_id),
        eq(submissions.campaign_id, clip.campaign_id),
        eq(submissions.platform, clip.platform),
        ne(submissions.id, clip.id)
      )
    );
  const otherBaseline = Number(others?.v ?? 0);

  return Math.min(clipViews, Math.max(0, odometer - otherBaseline));
};
