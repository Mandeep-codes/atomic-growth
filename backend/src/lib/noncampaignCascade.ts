import { eq } from "drizzle-orm";
import { db } from "./db";
import { submissions } from "./schema";
import { cancelNonCampaignClip } from "../routers/submissions/redemptionLedger";
import { computeFrozenSnapshotViews } from "../routers/rewards/createCampaignViewRewards";
import { revokeSubmissionReward } from "./revokeSubmissionReward";
import { isNcExemptClipper } from "./ncExemptClippers";

// When a non-campaign clip is REJECTED or DELETED, un-cover the campaign clips
// it was unlocking and claw back their rewards via RESERVE mode (never drives
// the wallet negative — the shortfall becomes a collectible reserve). The
// memo names the offending non-campaign reel. The deducted money is added back
// and the reserve voided when a fresh non-campaign clip re-covers those
// campaign clips (see reverseClawback + voidOutstandingReserve
// "noncampaign_uncovered" in the submit flow).
//
// reasonLabel: "rejected" | "deleted (no longer available)"
export async function uncoverAndClawbackNonCampaignClip(
  nonCampaignClipId: string,
  nonCampaignClipUrl: string,
  reasonLabel: string
): Promise<string[]> {
  // Null out redeemed_by on the covered campaign clips, restore credit, etc.
  const revokedSubmissionIds = await cancelNonCampaignClip(nonCampaignClipId);

  // Redemption is enabled for the campaign whose clips these are (they were
  // covered, which only happens on redemption campaigns) — needed by the
  // snapshot clamp's baseline query.
  for (const subId of revokedSubmissionIds) {
    const [sub] = await db
      .select({
        id: submissions.id,
        userId: submissions.user_id,
        campaignId: submissions.campaign_id,
        url: submissions.url,
        platform: submissions.platform,
        views: submissions.views,
        reward: submissions.reward,
        frozen: submissions.baseline_frozen_views,
        deletedClawedBack: submissions.deleted_clawed_back,
      })
      .from(submissions)
      .where(eq(submissions.id, subId))
      .limit(1);
    if (!sub) continue;
    // Exempt clippers are paid WITHOUT coverage, so losing a cover changes
    // nothing about what they are owed — freezing/clawing here would take
    // back money their clips still legitimately earn. The clip stays
    // uncovered (already done above) and keeps paying.
    if (isNcExemptClipper(sub.userId)) continue;

    // Freeze the clip's PAID-THROUGH contribution into the baseline (clamped
    // so the total can never exceed the odometer — raw views would overpay
    // any unpaid growth on the next cron). Computed sequentially: each set
    // snapshot is visible to the next clip's clamp, so a multi-clip uncover
    // stays bounded by the odometer. Skip if already snapshotted.
    if (sub.frozen === null) {
      const snapshot = await computeFrozenSnapshotViews(
        {
          id: sub.id,
          user_id: sub.userId,
          campaign_id: sub.campaignId,
          platform: sub.platform,
          views: sub.views,
        },
        true // these clips were covered ⇒ redemption campaign
      );
      await db
        .update(submissions)
        .set({ baseline_frozen_views: snapshot })
        .where(eq(submissions.id, sub.id));
    }

    const rewardToRevoke = Number(sub.reward ?? 0);
    // Guard against double-deduction: a clip already clawed back via the
    // deletion path (deleted_clawed_back) must never be clawed again here,
    // even if some restore flow re-populated its reward. Normally reward=0
    // already blocks this; the flag makes the invariant structural.
    if (rewardToRevoke > 0 && !sub.deletedClawedBack) {
      await revokeSubmissionReward({
        submissionId: sub.id,
        userId: sub.userId,
        rewardAmount: rewardToRevoke,
        memo: `-$${rewardToRevoke.toFixed(2)} removed because the non-campaign clip covering this reel was ${reasonLabel}: ${nonCampaignClipUrl}`,
        reason: `Non-campaign clip ${reasonLabel}`,
        sourceType: "noncampaign_uncovered",
        reserveOnShortfall: {
          campaignId: sub.campaignId,
          url: sub.url,
          platform: sub.platform,
          views: sub.views ?? 0,
        },
      });
    }
  }

  return revokedSubmissionIds;
}
