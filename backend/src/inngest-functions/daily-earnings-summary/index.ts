import { gte, sql } from "drizzle-orm";
import { db } from "../../lib/db";
import { inngest } from "../../lib/inngest";
import { campaign_view_rewards, notifications } from "../../lib/schema";
import { NotificationMetadata } from "../../lib/zod-schemas/notifications";
import { env } from "../../lib/env";

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

// Sends ONE "you earned today" notification per clipper at 7pm IST, summing that
// clipper's view rewards credited in the LAST 24 HOURS. Payouts run ~4×/day and
// are SILENT — this is the single daily clipper-facing earnings ping. A clipper
// who earned nothing in the last 24h gets NO notification (only positive earners
// are included). Mirrors the old per-payout `earnings-update` notification shape
// so the frontend renders it unchanged.
export const dailyEarningsSummary = inngest.createFunction(
  { id: "daily-earnings-summary" },
  { cron: "TZ=Asia/Kolkata 0 19 * * *" }, // 7 PM IST
  async ({ step, logger }) => {
    if (env.NODE_ENV !== "production") {
      logger.info("Skipping daily-earnings-summary in non-production");
      return;
    }

    // Whole insert loop in one step so an Inngest retry won't double-notify
    // (the step's successful output is memoized).
    const notified = await step.run("send-daily-earnings", async () => {
      const since = new Date(new Date().getTime() - TWENTY_FOUR_HOURS_MS);

      const rows = await db
        .select({
          userId: campaign_view_rewards.user_id,
          totalAmount: sql<number>`SUM(${campaign_view_rewards.amount})`,
          totalViews: sql<number>`SUM(${campaign_view_rewards.view_delta})`,
        })
        .from(campaign_view_rewards)
        .where(gte(campaign_view_rewards.created_at, since))
        .groupBy(campaign_view_rewards.user_id);

      // Only clippers with positive earnings in the window get a notification.
      const earners = rows.filter((r) => Number(r.totalAmount) > 0);
      if (earners.length === 0) return 0;

      await db.insert(notifications).values(
        earners.map((r) => ({
          user_id: r.userId,
          title: "Earnings",
          description: "Here's what you earned today 🎉",
          expires_minutes: 1 * 24 * 60, // 1 day
          metadata: {
            type: "earnings-update",
            alertType: "success",
            amount: Number(r.totalAmount),
            views: Number(r.totalViews ?? 0),
          } satisfies NotificationMetadata,
        }))
      );
      return earners.length;
    });

    logger.info("daily-earnings-summary sent", { count: notified });
    return { notified };
  }
);
