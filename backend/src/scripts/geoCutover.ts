/**
 * PER-ACCOUNT ODOMETER CUTOVER
 *
 *   npx tsx src/scripts/geoCutover.ts          → DRY RUN, writes nothing
 *   npx tsx src/scripts/geoCutover.ts --apply  → performs the cutover
 *
 * MUST be run (and verified) before GEO_PAYOUT_ENABLED is turned on in
 * production. Until it has, createReward's per-account branch would read an
 * empty odometer for every account and re-pay that account's entire view
 * history from zero.
 *
 * That ordering is now also enforced in code: createReward refuses to pay a
 * per-account row whose group still has legacy paid-through views and no
 * opening rows, and logs "ODOMETER CUTOVER NOT RUN". So flipping the flag first
 * stalls those payouts instead of duplicating them — but it still stalls them,
 * so run this first anyway.
 *
 * ── What it does ──
 * Historically campaign_view_rewards tracked ONE odometer per
 * (user, campaign, platform), summing every connected account together. Geo
 * bonuses are per account, so the odometer had to split. Those legacy rows
 * (verified_user_id IS NULL) are never rewritten — they stand as the permanent
 * record of what was paid. This script seeds each ACCOUNT a zero-amount opening
 * row carrying its share of the paid-through view count, so the normal
 * high-water-mark arithmetic takes over cleanly from there.
 *
 * ── How the share is decided ──
 * The legacy odometer L says "these many views have been paid for" across the
 * whole group, but not WHICH account's. Views are allocated in proportion to
 * each account's current payable views, with the final account absorbing the
 * rounding so the parts sum to exactly L. Because the parts sum to L:
 *
 *   • nothing already paid can be paid again (the group's opening odometers
 *     account for every view the legacy odometer had already paid for), and
 *   • no payable view is forfeited (the unpaid remainder T − L stays unpaid
 *     and will be picked up by the next payout run at each account's own rate).
 *
 * If L exceeds current views (clips deleted or rejected since), the seeded
 * baseline is deliberately left ABOVE the account's live view count. That
 * account then earns nothing until it climbs back — which is exactly what the
 * aggregate odometer already did.
 *
 * Idempotent: a group that already has per-account rows is skipped.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../lib/db";
import { campaign_view_rewards, campaigns } from "../lib/schema";

const APPLY = process.argv.includes("--apply");

type Group = {
  userId: string;
  campaignId: string;
  platform: string;
  legacyViewCount: number;
};

async function main() {
  console.log(
    APPLY
      ? "⚠️  APPLY MODE — this will write opening odometer rows.\n"
      : "DRY RUN — nothing will be written. Re-run with --apply to perform it.\n"
  );

  // Groups that still have ONLY legacy rows. A group already carrying
  // per-account rows has been cut over, so it is skipped.
  const groups = (await db
    .select({
      userId: campaign_view_rewards.user_id,
      campaignId: campaign_view_rewards.campaign_id,
      platform: campaign_view_rewards.platform,
      legacyViewCount: sql<number>`MAX(${campaign_view_rewards.view_count})`,
    })
    .from(campaign_view_rewards)
    .where(isNull(campaign_view_rewards.verified_user_id))
    .groupBy(
      campaign_view_rewards.user_id,
      campaign_view_rewards.campaign_id,
      campaign_view_rewards.platform
    )) as Group[];

  console.log(`legacy groups found: ${groups.length}`);

  const redemptionByCampaign = new Map<string, boolean>();
  for (const row of await db
    .select({
      id: campaigns.id,
      required: campaigns.non_campaign_clips_required,
    })
    .from(campaigns)) {
    redemptionByCampaign.set(row.id, (row.required ?? 0) > 0);
  }

  let seeded = 0;
  let skipped = 0;
  let groupsDone = 0;
  let mismatches = 0;
  const samples: string[] = [];

  for (const group of groups) {
    const [already] = await db
      .select({ id: campaign_view_rewards.id })
      .from(campaign_view_rewards)
      .where(
        and(
          eq(campaign_view_rewards.user_id, group.userId),
          eq(campaign_view_rewards.campaign_id, group.campaignId),
          eq(campaign_view_rewards.platform, group.platform),
          sql`${campaign_view_rewards.verified_user_id} IS NOT NULL`
        )
      )
      .limit(1);

    if (already) {
      skipped += 1;
      continue;
    }

    // payableViews, in SQL, per connected account — the same rule
    // createReward applies: a frozen snapshot wins, else approved (and
    // redeemed, where the campaign requires it) live views, else nothing.
    const redemption = redemptionByCampaign.get(group.campaignId) ?? false;
    const redeemedClause = redemption
      ? sql`AND s.redeemed_by_non_campaign_clip_id IS NOT NULL`
      : sql``;

    const accounts = (await db.execute(sql`
      SELECT s.verified_user_id AS accountId,
             COALESCE(SUM(CASE
               WHEN s.baseline_frozen_views IS NOT NULL THEN s.baseline_frozen_views
               WHEN s.status = 'approved' ${redeemedClause} THEN s.views
               ELSE 0 END), 0) AS payableViews
      FROM submissions s
      WHERE s.user_id = ${group.userId}
        AND s.campaign_id = ${group.campaignId}
        AND s.platform = ${group.platform}
        AND s.verified_user_id IS NOT NULL
      GROUP BY s.verified_user_id
      HAVING payableViews > 0
    `)) as unknown as [
      { accountId: string; payableViews: string | number }[],
      unknown
    ];

    const rows = (accounts[0] ?? []).map((r) => ({
      accountId: r.accountId,
      views: Number(r.payableViews),
    }));

    if (rows.length === 0) {
      skipped += 1;
      continue;
    }

    const totalViews = rows.reduce((sum, r) => sum + r.views, 0);
    const legacy = Number(group.legacyViewCount);

    // Proportional split, last account absorbing the rounding remainder so the
    // parts sum to EXACTLY the legacy odometer.
    let allocated = 0;
    const baselines = rows.map((row, index) => {
      const isLast = index === rows.length - 1;
      const share = isLast
        ? legacy - allocated
        : Math.round((legacy * row.views) / totalViews);
      allocated += isLast ? 0 : share;
      return { ...row, baseline: Math.max(share, 0) };
    });

    const sum = baselines.reduce((s, b) => s + b.baseline, 0);
    if (sum !== legacy) {
      mismatches += 1;
      console.error(
        `❌ allocation mismatch for ${group.userId}/${group.campaignId}/${group.platform}: ${sum} != ${legacy}`
      );
      continue;
    }

    if (samples.length < 5) {
      samples.push(
        `${group.platform} ${group.campaignId.slice(0, 18)}… legacy=${legacy} views=${totalViews} → ` +
          baselines.map((b) => `${b.accountId.slice(0, 8)}:${b.baseline}`).join(" ")
      );
    }

    if (APPLY) {
      for (const b of baselines) {
        await db.insert(campaign_view_rewards).values({
          user_id: group.userId,
          campaign_id: group.campaignId,
          platform: group.platform,
          verified_user_id: b.accountId,
          cpm: 0,
          geo_bonus_cpm: 0,
          amount: 0,
          view_count: b.baseline,
          view_delta: 0,
          // Zero-amount opening rows are cleared by definition — they move no
          // money, so they must never sit in the weekly hold.
          clearance_state: "cleared",
          cleared_at: new Date(),
          idempotency_key: `cutover:${group.userId}:${group.campaignId}:${group.platform}:${b.accountId}`,
          balance_entry_id: "cutover",
        });
      }
    }

    seeded += baselines.length;
    groupsDone += 1;
  }

  console.log(`
──────────────── CUTOVER ${APPLY ? "APPLIED" : "PLAN"} ────────────────
groups needing cutover : ${groupsDone}
opening rows ${APPLY ? "written" : "to write"}  : ${seeded}
groups skipped         : ${skipped}  (already cut over, or no account views)
allocation mismatches  : ${mismatches}${mismatches ? "  ⚠️ INVESTIGATE" : ""}

sample allocations:
${samples.map((s) => "  " + s).join("\n") || "  (none)"}
${APPLY ? "" : "\nNothing was written. Re-run with --apply when this looks right."}`);

  process.exit(mismatches > 0 ? 1 : 0);
}

main();
