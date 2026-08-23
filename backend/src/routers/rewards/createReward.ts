import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { ncRedemptionApplies } from "../../lib/ncExemptClippers";
import { isUserBannedFromEarning } from "../../lib/banPurge";
import { db } from "../../lib/db";
import {
  balance_entries,
  balances,
  campaign_view_rewards,
  campaigns,
  demographics_verification_v2,
  referral_codes_v2,
  referred_users_v2,
  submissions as submissions_table,
  user_clerk,
} from "../../lib/schema";
import {
  CampaignViewRewardMetadata,
  RefereeRewardMetadata,
  ReferralRewardV2Metadata,
} from "../../lib/zod-schemas/balanceMetadata";
import { getAllSubmissions, payableViews } from "./createCampaignViewRewards";
import { currentCycleStart } from "../../lib/demographic-cycles";
import { WEEKLY_HOLD_ENABLED } from "../../lib/geo-clearance";
import { recomputeCampaignDemographics } from "../demographicsVerification";

const MIN_REWARD_AMOUNT = 0.01;

export async function createReward({
  userId,
  campaign,
  submissions,
  platform,
  cpm,
  idempotencyKey,
  verifiedUserId = null,
  geoBonusCpm = 0,
}: {
  userId: string;
  campaign: typeof campaigns.$inferSelect;
  submissions: Awaited<ReturnType<typeof getAllSubmissions>>;
  platform: string;
  cpm: number;
  idempotencyKey: string;
  // ── Per-account payout grain ──
  // When set, this call prices ONE connected account: only that account's clips
  // count toward the view total, and the high-water mark is read and written on
  // that account's own odometer rows. Legacy rows (verified_user_id IS NULL)
  // are left untouched — they remain the paid-through baseline for views earned
  // before the cutover, which is what makes historical payouts final.
  //
  // When null (today's behaviour, and the behaviour while GEO_PAYOUT_ENABLED is
  // false), every account is summed into one odometer exactly as before.
  verifiedUserId?: string | null;
  // The geo portion of `cpm`, recorded separately so the clipper's earnings
  // screen can show base + extra instead of one blended number. Purely
  // informational here — `cpm` is already the full effective rate.
  geoBonusCpm?: number;
}) {
  if (cpm <= 0) {
    throw new Error("CPM is not valid");
  }

  // Redemption-ledger payout filter: when a campaign opts into the
  // non-campaign-clip flow (`campaign.non_campaign_clips_required > 0`),
  // a campaign clip is only payable if it has been redeemed by a
  // non-campaign clip (i.e. submissions.redeemed_by_non_campaign_clip_id
  // is non-null). Unredeemed clips stay in limbo until the clipper
  // submits a non-campaign clip to redeem them — and if they never do
  // (or claim payout first), those view counts simply never roll into
  // the reward calculation here.
  // Exempt clippers (ncExemptClippers.ts) are paid as if covered — the
  // requirement simply doesn't apply to them on any campaign.
  const redemptionEnabled = ncRedemptionApplies(
    userId,
    campaign.non_campaign_clips_required
  );

  // Per-clip payable contribution — payableViews is the single source of
  // truth (frozen-baseline snapshots for rejected/uncovered clips contribute
  // their frozen value, live approved+redeemed clips their live views), so a
  // clawed-back clip's views neither vanish (freeze) nor grow (re-pay).
  const viewCount = submissions.reduce((acc, submission) => {
    if (submission.submissions.platform !== platform) return acc;
    // Per-account grain: a clip only counts toward the account it was posted
    // from. Without this the bonus earned by ONE qualifying account would be
    // applied to every view the clipper has on that platform.
    if (
      verifiedUserId !== null &&
      submission.submissions.verified_user_id !== verifiedUserId
    ) {
      return acc;
    }
    return acc + payableViews(submission.submissions, redemptionEnabled);
  }, 0);

  if (viewCount <= 0) {
    return null;
  }

  const txResult = await db.transaction(async (tx) => {
    // Serialize all payout work for this user on their balances row — the
    // same lock anchor revokeSubmissionReward uses — so two concurrent
    // payout runs (cron + manual admin trigger) can't both read the same
    // high-water mark and double-pay the same view delta. Locking the
    // "latest reward row" instead would not work: the winner INSERTS a new
    // latest row the waiter never locked. Seed the anchor first: without a
    // real row, FOR UPDATE on the missing row takes only a gap lock, and the
    // four per-platform createReward calls for a first-time earner would
    // deadlock each other instead of serializing.
    await tx
      .insert(balances)
      .values({ user_id: userId, balance: 0, totalEarned: 0 })
      .onDuplicateKeyUpdate({
        set: { user_id: sql`${balances.user_id}` },
      });
    await tx
      .select({ user_id: balances.user_id })
      .from(balances)
      .where(eq(balances.user_id, userId))
      .for("update");

    // MAX(view_count), not "latest row by created_at": view_count is
    // monotone per user+campaign+platform by construction (including the
    // cap-clamp resume path), while created_at is second-precision and two
    // serialized runs can tie on it, making "latest" ambiguous.
    const [previousReward] = await tx
      .select({
        viewCount: sql<number>`COALESCE(MAX(${campaign_view_rewards.view_count}), 0)`,
      })
      .from(campaign_view_rewards)
      .where(
        and(
          eq(campaign_view_rewards.user_id, userId),
          eq(campaign_view_rewards.campaign_id, campaign.id),
          eq(campaign_view_rewards.platform, platform),
          // Per-account grain: read THIS account's odometer only. Legacy
          // aggregate rows (verified_user_id IS NULL) are deliberately excluded
          // — the cutover seeds each account a zero-amount row carrying its
          // paid-through views, so the baseline is already represented here and
          // counting the legacy total again would stall every account behind
          // the whole group's history.
          verifiedUserId !== null
            ? eq(campaign_view_rewards.verified_user_id, verifiedUserId)
            : isNull(campaign_view_rewards.verified_user_id)
        )
      );

    const previousViewCount = Number(previousReward?.viewCount ?? 0);

    // ── Cutover guard ──
    // The per-account odometer is only meaningful after geoCutover.ts --apply
    // has seeded each account its opening row. Run before that, this account's
    // odometer reads 0 while the legacy aggregate row says the group has
    // already been paid through N views — and the delta below would re-pay that
    // account's ENTIRE view history. Ordering was previously runbook-only;
    // nothing stopped GEO_PAYOUT_ENABLED being flipped first.
    //
    // The test is the same one the cutover script uses to decide what still
    // needs seeding: legacy money on this (user, campaign, platform) group, and
    // not one per-account row to show it was split. A brand-new account joining
    // an already-cut-over group passes — its siblings' opening rows exist.
    //
    // Skip, loudly, rather than throw: the payout batch must keep running for
    // everyone else, and nothing is lost — high-water marks mean this account
    // simply gets paid correctly on the next run once the cutover has been done.
    if (verifiedUserId !== null && previousViewCount === 0) {
      const [cutover] = await tx
        .select({
          legacyViewCount: sql<number>`COALESCE(MAX(CASE WHEN ${campaign_view_rewards.verified_user_id} IS NULL THEN ${campaign_view_rewards.view_count} END), 0)`,
          perAccountRows: sql<number>`COALESCE(SUM(CASE WHEN ${campaign_view_rewards.verified_user_id} IS NOT NULL THEN 1 ELSE 0 END), 0)`,
        })
        .from(campaign_view_rewards)
        .where(
          and(
            eq(campaign_view_rewards.user_id, userId),
            eq(campaign_view_rewards.campaign_id, campaign.id),
            eq(campaign_view_rewards.platform, platform)
          )
        );

      if (
        Number(cutover?.legacyViewCount ?? 0) > 0 &&
        Number(cutover?.perAccountRows ?? 0) === 0
      ) {
        console.error(
          `🛑 ODOMETER CUTOVER NOT RUN — skipping payout for user ${userId}, campaign ${campaign.id}, ${platform}, account ${verifiedUserId}. ` +
            `This group has ${cutover?.legacyViewCount} legacy paid-through views and no per-account opening rows; paying now would re-pay that history from zero. ` +
            `Run: npx tsx src/scripts/geoCutover.ts --apply`
        );
        return null;
      }
    }

    const viewDelta = viewCount - previousViewCount;

    if (viewDelta <= 0) {
      return null;
    }

    let rewardAmount = (viewDelta * cpm) / 1000;
    let paidViews = viewDelta;

    if (campaign.max_payout) {
      // Cap basis is NET money actually paid: prior reward rows MINUS
      // clawbacks (plus restores) for this user on this CAMPAIGN — across
      // every platform, not per platform.
      //
      // max_payout is "the most one clipper may take out of this campaign's
      // budget". Scoping the basis to a single platform handed them that
      // allowance FOUR times over — once each on YouTube, Instagram, X and
      // TikTok — so a 20% cap on a $3,333 budget capped nobody at $666.60,
      // it capped them at $666.60 per platform. Confirmed on Theo Browne,
      // where a clipper running Instagram + YouTube had been paid $680.87.
      //
      // The other half of the basis is unchanged. The old basis
      // (liveViewCount x current cpm) re-priced the whole history at today's
      // rate — raising a user's rate mid-campaign (levels / per-user
      // overrides) could trip the cap and silently freeze their payouts.
      // Ignoring clawbacks would be just as wrong in the other direction: a
      // deleted clip's returned money would consume cap headroom forever
      // (deletion must NOT eat a clipper's cap — see the clawback flows in
      // revokeSubmissionReward/reverseClawback).
      //
      // Concurrency: the four per-platform calls run under Promise.all but
      // every one of them takes the balances-row lock above before reading
      // this sum, so they serialise and each sees the previous one's
      // committed reward row. The cumulative cap holds across them.
      const maxPayoutCap = (campaign.max_payout / 100) * campaign.budget;
      const [paidSoFarRow] = await tx
        .select({
          total: sql<string>`COALESCE(SUM(${campaign_view_rewards.amount}), 0)`,
        })
        .from(campaign_view_rewards)
        .where(
          and(
            eq(campaign_view_rewards.user_id, userId),
            eq(campaign_view_rewards.campaign_id, campaign.id)
          )
        );
      // Clawbacks are negative entries, restores positive — summing both
      // nets out to the money the user actually kept from this campaign's
      // clips, on every platform.
      const [clawNetRow] = await tx
        .select({
          total: sql<string>`COALESCE(SUM(${balance_entries.amount}), 0)`,
        })
        .from(balance_entries)
        .innerJoin(
          submissions_table,
          eq(balance_entries.source_id, submissions_table.id)
        )
        .where(
          and(
            eq(balance_entries.user_id, userId),
            eq(submissions_table.campaign_id, campaign.id),
            inArray(balance_entries.source_type, [
              "clip_deletion",
              "submission_rejection",
              "noncampaign_uncovered",
              "handle_ban",
              "clip_restore",
              "noncampaign_recovered",
              "reward_restored_reapproval",
            ])
          )
        );
      const netPaid =
        Number(paidSoFarRow?.total ?? 0) + Number(clawNetRow?.total ?? 0);
      const remainingCap = maxPayoutCap - netPaid;

      if (remainingCap < MIN_REWARD_AMOUNT) {
        console.warn(
          "Max payout cap already reached for user, skipping reward"
        );
        return null;
      }

      if (rewardAmount > remainingCap) {
        // Clamp into the remaining headroom instead of skipping the whole
        // payment, and advance the view high-water mark only past the views
        // this clamped amount actually pays for — so if the cap or budget is
        // later raised, the unpaid remainder resumes from the right spot
        // instead of being silently forfeited. After flooring the views,
        // recompute the amount from them so amount == paidViews x cpm / 1000
        // holds exactly (no sub-cent dust paid now and again on resume).
        paidViews = Math.floor((remainingCap * 1000) / cpm);
        if (paidViews <= 0) {
          return null;
        }
        rewardAmount = (paidViews * cpm) / 1000;
      }
    }

    if (rewardAmount < MIN_REWARD_AMOUNT) {
      console.warn("Reward amount is too low, skipping reward");
      return null;
    }

    // On a cap-clamped payment, paidViews < viewDelta and the high-water mark
    // below advances only to the paid-through point.
    const paidThroughViewCount = previousViewCount + paidViews;

    const rewardMetadata = {
      version: "v1",
      type: "campaign_view_reward",
      campaignId: campaign.id,
      campaignTitle: campaign.title ?? null,
      platform,
      viewDelta: paidViews,
      totalViews: paidThroughViewCount,
      cpm,
    } satisfies CampaignViewRewardMetadata;

    const [balanceEntry] = await tx
      .insert(balance_entries)
      .values({
        user_id: userId,
        amount: rewardAmount,
        type: "reward",
        source_type: "campaign_view_rewards",
        // Spell out the split when a geo bonus applied, so the clipper's
        // earnings screen shows WHY this run paid more than the base rate
        // without having to re-derive it from demographics that may since
        // have changed.
        memo:
          geoBonusCpm > 0
            ? `Views reward on ${platform} for ${campaign.title} — base $${(
                cpm - geoBonusCpm
              ).toFixed(2)} + geo bonus $${geoBonusCpm.toFixed(2)} per 1,000`
            : `Views reward on ${platform} for ${campaign.title}`,
        metadata: rewardMetadata,
      })
      .$returningId();

    if (!balanceEntry) {
      throw new Error("Failed to create balance entry");
    }

    const [campaignViewReward] = await tx
      .insert(campaign_view_rewards)
      .values({
        user_id: userId,
        campaign_id: campaign.id,
        platform: platform,
        verified_user_id: verifiedUserId,
        cpm: cpm,
        geo_bonus_cpm: geoBonusCpm,
        // Held until the NEXT cycle's demographics are approved. When the hold
        // system is off this stays "cleared", which is the historical behaviour.
        clearance_state: WEEKLY_HOLD_ENABLED ? "held" : "cleared",
        cleared_at: WEEKLY_HOLD_ENABLED ? null : new Date(),
        amount: rewardAmount,
        view_count: paidThroughViewCount,
        view_delta: paidViews,
        idempotency_key: idempotencyKey,
        balance_entry_id: balanceEntry.id,
      })
      .$returningId();

    if (!campaignViewReward) {
      throw new Error("Failed to create campaign view reward");
    }

    // Held earnings land in pending_balance, NOT the spendable balance, and do
    // not count toward totalEarned until they clear — otherwise lifetime
    // earnings would include a bonus that may still be cancelled. Everything
    // moves across in runClearanceForUser once next week's report is approved.
    if (WEEKLY_HOLD_ENABLED) {
      await tx
        .insert(balances)
        .values({
          user_id: userId,
          balance: 0,
          pending_balance: rewardAmount,
          totalEarned: 0,
        })
        .onDuplicateKeyUpdate({
          set: {
            pending_balance: sql`${balances.pending_balance} + ${rewardAmount}`,
          },
        });
    } else {
      await tx
        .insert(balances)
        .values({
          user_id: userId,
          balance: rewardAmount,
          totalEarned: rewardAmount,
        })
        .onDuplicateKeyUpdate({
          set: {
            balance: sql`${balances.balance} + ${rewardAmount}`,
            totalEarned: sql`${balances.totalEarned} + ${rewardAmount}`,
          },
        });
    }

    await tx
      .update(balance_entries)
      .set({
        source_id: campaignViewReward.id,
      })
      .where(eq(balance_entries.id, balanceEntry.id))
      .limit(1);

    return {
      campaignViewRewardId: campaignViewReward.id,
      rewardAmount,
      viewDelta: paidViews,
    };
  });

  if (txResult) {
    // NOTE: no per-payout notification here. Payouts now run ~4×/day, so the
    // clipper-facing "you earned" notification is batched into ONE daily summary
    // sent at 7pm IST by the daily-earnings-summary cron.
    await Promise.all([
      // The reward tx has already committed; a demographics-write failure must
      // never reject this post-commit follow-up and re-book an already-paid
      // user as a payout failure. Swallow-and-log.
      createDemographicsVerification({
        submissions,
        platform,
        campaignId: campaign.id,
        userId,
      }).catch((error) => {
        console.error("createDemographicsVerification failed (non-fatal)", error);
      }),
      createReferralRewardV2({
        userId,
        campaign,
        platform,
        viewRewardAmount: txResult.rewardAmount,
        campaignViewRewardId: txResult.campaignViewRewardId,
      }),
    ]);
  }

  return;
}

const createDemographicsVerification = async ({
  submissions,
  platform,
  campaignId,
  userId,
}: {
  submissions: Awaited<ReturnType<typeof getAllSubmissions>>;
  platform: string;
  campaignId: string;
  userId: string;
}) => {
  const verifiedUserIds = new Set<string>();
  submissions
    .filter((submission) => submission.submissions.platform === platform)
    .forEach((submission) => {
      if (submission.verified_users) {
        verifiedUserIds.add(submission.verified_users.id);
      }
    });
  const allClaimPrerequirementsPromises = [...verifiedUserIds].map(
    async (verifiedUserId) => {
      const verifiedUserSubmissionViews = submissions
        .filter(
          (submission) => submission.verified_users?.id === verifiedUserId
        )
        .reduce((acc, submission) => acc + submission.submissions.views, 0);

      if (verifiedUserSubmissionViews <= 0) {
        return false;
      }

      const baseValues = {
        user_id: userId,
        campaign_id: campaignId,
        verified_user_id: verifiedUserId,
        views_from_submissions_snapshot: verifiedUserSubmissionViews,
        // Demographic rows are per weekly cycle now. The payout batch always
        // works against the cycle that is currently open — it must never
        // resurrect or overwrite a previous week's report, since that report
        // is what priced that week's geo bonus.
        cycle_start: currentCycleStart(),
      };

      // Inherit only lands on a genuinely NEW row — the onDuplicateKeyUpdate
      // below just bumps the views snapshot for an existing row. So only when
      // this (campaign, account) row doesn't exist yet do we look for an
      // approved audience elsewhere to carry over (and signal a cache
      // recompute). This keeps the ~4x/day batch from re-querying / recomputing
      // on every view-bump.
      const [existingRow] = await db
        .select({ id: demographics_verification_v2.id })
        .from(demographics_verification_v2)
        .where(
          and(
            eq(demographics_verification_v2.campaign_id, campaignId),
            eq(demographics_verification_v2.verified_user_id, verifiedUserId),
            // Scoped to the open cycle: without this, last week's row would
            // count as "already exists" and this week's report would never be
            // created, freezing the account on a stale audience forever.
            eq(demographics_verification_v2.cycle_start, currentCycleStart())
          )
        )
        .limit(1);

      let mintedApprovedRow = false;
      const [inherited] = existingRow
        ? [undefined]
        : await db
            .select({
              parsed_data: demographics_verification_v2.parsed_data,
              screenshot_file_url:
                demographics_verification_v2.screenshot_file_url,
              approval_method: demographics_verification_v2.approval_method,
              exemption_reason: demographics_verification_v2.exemption_reason,
            })
            .from(demographics_verification_v2)
            .where(
              and(
                eq(
                  demographics_verification_v2.verified_user_id,
                  verifiedUserId
                ),
                eq(demographics_verification_v2.user_id, userId),
                eq(demographics_verification_v2.status, "approved"),
                // SAME cycle only. Inheriting is meant to fan an approval
                // across the campaigns an account runs in DURING one week —
                // not to carry last week's approval into this one. Without
                // this bound the payout cron silently auto-approves every
                // clipper each new week, so nobody ever has to submit fresh
                // demographics and the weekly verification is bypassed
                // entirely. Caught in local testing: an account deliberately
                // seeded as "not submitted" came back approved after a payout.
                eq(
                  demographics_verification_v2.cycle_start,
                  currentCycleStart()
                )
              )
            )
            .orderBy(desc(demographics_verification_v2.updated_at))
            .limit(1);

      if (inherited) {
        mintedApprovedRow = true;
      }

      await db
        .insert(demographics_verification_v2)
        .values(
          inherited
            ? {
                ...baseValues,
                status: "approved" as const,
                parsed_data: inherited.parsed_data,
                screenshot_file_url: inherited.screenshot_file_url,
                approval_method: inherited.approval_method,
                exemption_reason: inherited.exemption_reason,
              }
            : { ...baseValues, status: "created" as const }
        )
        .onDuplicateKeyUpdate({
          set: {
            views_from_submissions_snapshot: verifiedUserSubmissionViews,
          },
        });

      return mintedApprovedRow;
    }
  );
  const results = await Promise.all(allClaimPrerequirementsPromises);

  // A new campaign that inherited an already-approved audience now contributes
  // an 'approved' row to that campaign's rollup — refresh its cached
  // demographics_json so the client dashboard isn't stale (best-effort, mirrors
  // the mod-approve path). Only fires on a genuine inherit, not view-bumps.
  if (results.some(Boolean)) {
    try {
      await recomputeCampaignDemographics(campaignId);
    } catch (error) {
      console.error("demographics recompute after inherit failed", error);
    }
  }
};

const createReferralRewardV2 = async ({
  userId,
  campaign,
  platform,
  viewRewardAmount,
  campaignViewRewardId,
}: {
  userId: string;
  campaign: typeof campaigns.$inferSelect;
  platform: string;
  viewRewardAmount: number;
  campaignViewRewardId: string;
}) => {
  const [referral] = await db
    .select()
    .from(referred_users_v2)
    .where(eq(referred_users_v2.referred_user_id, userId))
    .innerJoin(
      referral_codes_v2,
      eq(referred_users_v2.referral_code_id, referral_codes_v2.id)
    )
    .leftJoin(user_clerk, eq(referral_codes_v2.user_id, user_clerk.discord_id))
    .limit(1);

  // A banned REFERRER earns nothing. The payout guard filters the clipper who
  // earned, but says nothing about who referred them — so a banned user who
  // owns a referral code with any still-active referee kept collecting 10% on
  // every 4-hourly cron run, forever, with no human involved.
  //
  // Scoped to the REFERRER's half only. There is a SECOND 10% further down
  // paid to the referred clipper themselves; an early return here would have
  // silently cancelled an innocent, unbanned clipper's own bonus just because
  // whoever referred them got banned.
  //
  // Swallow lookup failures: the sibling call in createReward has its own
  // .catch(), and this one runs inside a Promise.all where a rejection would
  // book an ALREADY-PAID clipper as a payout failure. Failing closed (skip the
  // referrer's cut) is the safe direction.
  let referrerIsBanned = false;
  if (referral?.referral_codes_v2?.user_id) {
    try {
      referrerIsBanned = await isUserBannedFromEarning(
        referral.referral_codes_v2.user_id
      );
    } catch (error) {
      console.error("Referrer ban lookup failed; skipping referrer cut", error);
      referrerIsBanned = true;
    }
  }

  if (referral) {
    const referredUserName =
      referral.user_clerk?.discord_username ??
      referral.user_clerk?.email ??
      referral.referred_users_v2.referred_user_id;

    //create a balance entry for the referrer
    const referrerReward = viewRewardAmount * 0.1;

    if (referrerIsBanned) {
      // Referrer's cut only. The referee's own boost below is untouched —
      // they are not banned and did nothing wrong.
      console.warn("Referrer is banned, skipping referrer reward");
    } else if (referrerReward < MIN_REWARD_AMOUNT) {
      console.warn("Referrer reward is too low, skipping reward");
    } else {
      const referralMetadata = {
        version: "v1",
        type: "referral_reward_v2",
        campaignId: campaign.id,
        campaignTitle: campaign.title ?? null,
        platform,
        referredUserName,
      } satisfies ReferralRewardV2Metadata;

      await db.transaction(async (tx) => {
        const updatedBalanceEntry = tx.insert(balance_entries).values({
          user_id: referral.referral_codes_v2.user_id,
          amount: referrerReward,
          type: "reward",
          source_type: "campaign_view_rewards",
          source_id: campaignViewRewardId,
          memo: `Referral reward for user ${referredUserName} on ${platform} for ${campaign.title}`,
          metadata: referralMetadata,
        });

        const updateBalance = tx
          .insert(balances)
          .values({
            user_id: referral.referral_codes_v2.user_id,
            balance: referrerReward,
            totalEarned: referrerReward,
          })
          .onDuplicateKeyUpdate({
            set: {
              balance: sql`${balances.balance} + ${referrerReward}`,
              totalEarned: sql`${balances.totalEarned} + ${referrerReward}`,
            },
          });

        await Promise.all([updatedBalanceEntry, updateBalance]);
      });
    }

    // Referree reward
    const referreeReward = viewRewardAmount * 0.1;

    const tenDaysAfterReferral = new Date(
      referral.referred_users_v2.created_at.getTime() + 10 * 24 * 60 * 60 * 1000
    );

    if (
      new Date() < tenDaysAfterReferral &&
      referreeReward >= MIN_REWARD_AMOUNT
    ) {
      const referreeMetadata = {
        version: "v1",
        type: "referee_reward",
        campaignId: campaign.id,
        campaignTitle: campaign.title ?? null,
        platform,
      } satisfies RefereeRewardMetadata;

      await db.transaction(async (tx) => {
        const updatedBalanceEntry = tx.insert(balance_entries).values({
          user_id: userId,
          amount: referreeReward,
          type: "reward",
          source_type: "campaign_view_rewards",
          source_id: campaignViewRewardId,
          memo: `Referred user boost reward on ${platform} for ${campaign.title}`,
          metadata: referreeMetadata,
        });

        const updateBalance = tx
          .insert(balances)
          .values({
            user_id: userId,
            balance: referreeReward,
            totalEarned: referreeReward,
          })
          .onDuplicateKeyUpdate({
            set: {
              balance: sql`${balances.balance} + ${referreeReward}`,
              totalEarned: sql`${balances.totalEarned} + ${referreeReward}`,
            },
          });

        await Promise.all([updatedBalanceEntry, updateBalance]);
      });
    }
  }
};
