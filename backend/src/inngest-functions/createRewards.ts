import { db } from "../lib/db";
import { inngest } from "../lib/inngest";
import { campaign_view_rewards, campaigns } from "../lib/schema";
import { and, eq, gte, lt } from "drizzle-orm";
import { createCampaignViewRewards } from "../routers/rewards/createCampaignViewRewards";
import { env } from "../lib/env";

export const createRewards = inngest.createFunction(
  { id: "create-rewards" },
  // Triggered the MOMENT the view cron finishes (update-views emits this event
  // after writing fresh view counts) so payouts always run on up-to-date views,
  // in lockstep with the 4-hourly view cron — no guessed buffer, no race. The
  // hour-bucketed idempotency key below keeps each run distinct + the
  // campaign_view_rewards unique index blocks any duplicate run.
  { event: "rewards/create.requested" },
  async ({ event, step, logger }) => {
    if (env.NODE_ENV !== "production") {
      logger.info(
        "Skipping create-rewards function in non-production environment"
      );
      return;
    }
    logger.info("Starting create-rewards function", { eventId: event.id });

    const activeCampaigns = await db
      .select()
      .from(campaigns)
      .where(and(eq(campaigns.active, true), eq(campaigns.ended, false)));

    for (const campaign of activeCampaigns) {
      let cpmBoostByUserIds: Map<string, number> | undefined;
      if (campaign.is_hot_streak_enabled) {
        cpmBoostByUserIds = new Map<string, number>();
        const topUsers = await step.run("get-hot-streak-users", async () => {
          return await getHotStreakUsers();
        });

        for (const [idx, user] of topUsers.entries()) {
          const rank = idx + 1;
          if (rank === 1) cpmBoostByUserIds.set(user.userId, 0.1);
          if (rank >= 2 && rank <= 3) cpmBoostByUserIds.set(user.userId, 0.05);
          if (rank >= 4 && rank <= 10) cpmBoostByUserIds.set(user.userId, 0.03);
        }
      }

      // current date and hour as idempotency key
      const idempotencyKey = `${campaign.title}-${
        new Date().toISOString().split("T")[0]
      }-${new Date().getHours()}`;
      await step.run(`create-rewards-${campaign.title}`, async () => {
        return {
          inputs: {
            campaignId: campaign.id,
            idempotencyKey,
            cpmBoostByUserIds,
          },
          output: await createCampaignViewRewards({
            campaignId: campaign.id,
            idempotencyKey,
            cpmBoostByUserIds,
          }),
        };
      });
    }
  }
);

const getHotStreakUsers = async () => {
  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  );
  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);

  const yesterdayRewards = await db
    .select({
      userId: campaign_view_rewards.user_id,
      viewDelta: campaign_view_rewards.view_delta,
    })
    .from(campaign_view_rewards)
    .where(
      and(
        gte(campaign_view_rewards.created_at, startOfYesterday),
        lt(campaign_view_rewards.created_at, startOfToday)
      )
    );

  const totalsByUser = new Map<string, number>();
  for (const reward of yesterdayRewards) {
    const previousViews = totalsByUser.get(reward.userId) ?? 0;
    totalsByUser.set(
      reward.userId,
      previousViews + Number(reward.viewDelta ?? 0)
    );
  }

  const topUsers = Array.from(totalsByUser.entries())
    .map(([userId, totalViews]) => ({ userId, totalViews }))
    .filter(({ totalViews }) => totalViews > 0)
    .sort((a, b) => b.totalViews - a.totalViews)
    .slice(0, 10);

  return topUsers;
};
