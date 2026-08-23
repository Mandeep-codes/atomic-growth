import { and, gt, inArray, eq, isNull, or } from "drizzle-orm";
import { inngest } from "../../lib/inngest";
import { db } from "../../lib/db";
import {
    influencer_campaigns,
    influencer_twitter_submission,
    influencer_linkedin_submission,
} from "../../lib/schema";
import { getLinkedInLikes } from "./getLinkedIn";
import { getTwitterMetrics } from "./getTwitter";
import { env } from "../../lib/env";

const CHUNK_SIZE = 20;

export const updateInfluencerSubmissions = inngest.createFunction(
    { id: "update-influencer-submissions" },
    { cron: "TZ=America/New_York 0 */4 * * *" }, // every 4 hours
    async ({ event, step, logger }) => {

        if (env.NODE_ENV !== "production") {
            logger.info("Skipping update-influencer-submissions in non-production");
            return;
        }

        logger.info("Starting influencer submissions updater", { eventId: event.id });

        const now = new Date();
        const activeCampaigns = await db
            .select({ id: influencer_campaigns.id })
            .from(influencer_campaigns)
            .where(
                or(gt(influencer_campaigns.end_date, now), isNull(influencer_campaigns.end_date))
            );

        if (activeCampaigns.length === 0) {
            logger.info("No active influencer campaigns");
            return;
        }

        const campaignIds = activeCampaigns.map((campaign) => campaign.id);

        const twitterSubmissions = await db
            .select({
                id: influencer_twitter_submission.id,
                link: influencer_twitter_submission.link,
            })
            .from(influencer_twitter_submission)
            .where(
                inArray(influencer_twitter_submission.influencer_campaign_id, campaignIds)
            );

        const linkedinSubmissions = await db
            .select({
                id: influencer_linkedin_submission.id,
                link: influencer_linkedin_submission.link,
            })
            .from(influencer_linkedin_submission)
            .where(
                inArray(influencer_linkedin_submission.influencer_campaign_id, campaignIds)
            );

        for (let i = 0; i < twitterSubmissions.length; i += CHUNK_SIZE) {
            const chunk = twitterSubmissions.slice(i, i + CHUNK_SIZE);
            await step.run(`update-twitter-influencer-${i}`, async () => {
                await Promise.all(
                    chunk.map(async (submission) => {
                        try {
                            const metrics = await getTwitterMetrics(submission.link);
                            console.log('metrics', metrics);
                            await db
                                .update(influencer_twitter_submission)
                                .set({
                                    impressions: metrics.views,
                                    bookmarkCount: metrics.bookmarkCount,
                                    replyCount: metrics.replyCount,
                                    quoteCount: metrics.quoteCount,
                                    favoriteCount: metrics.favoriteCount,
                                    retweetCount: metrics.retweetCount,
                                    updated_at: new Date(),
                                })
                                .where(eq(influencer_twitter_submission.id, submission.id));
                        } catch (error) {
                            logger.error("Failed to update Twitter submission", {
                                submissionId: submission.id,
                                error: error instanceof Error ? error.message : error,
                            });
                        }
                    })
                );
            });
        }

        for (let i = 0; i < linkedinSubmissions.length; i += CHUNK_SIZE) {
            const chunk = linkedinSubmissions.slice(i, i + CHUNK_SIZE);
            await step.run(`update-linkedin-influencer-${i}`, async () => {
                await Promise.all(
                    chunk.map(async (submission) => {
                        try {
                            const metrics = await getLinkedInLikes(submission.link);
                            await db
                                .update(influencer_linkedin_submission)
                                .set({
                                    likes: metrics.likes,
                                    comments: metrics.comments,
                                    impressions: metrics.shares,
                                    reposts: metrics.reposts,
                                    updated_at: new Date(),
                                })
                                .where(eq(influencer_linkedin_submission.id, submission.id));
                        } catch (error) {
                            logger.error("Failed to update LinkedIn submission", {
                                submissionId: submission.id,
                                error: error instanceof Error ? error.message : error,
                            });
                        }
                    })
                );
                //sleep for 1 minute to avoid rate limiting
                await step.sleep("sleep-1-minute", "1m");
            });
        }

        logger.info("Completed influencer submissions update");
    }
);
