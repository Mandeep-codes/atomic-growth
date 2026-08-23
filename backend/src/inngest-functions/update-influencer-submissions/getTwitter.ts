import { z } from "zod";
import { env } from "../../lib/env";

const twitterResponseSchema = z.object({
    result: z
        .object({
            tweetResult: z
                .object({
                    result: z.object({
                        views: z
                            .object({
                                count: z.union([z.string(), z.number()]).optional().nullable(),
                            })
                            .optional(),
                        bookmark_count: z.number().optional().nullable(),
                        reply_count: z.number().optional().nullable(),
                        quote_count: z.number().optional().nullable(),
                        favorite_count: z.number().optional().nullable(),
                        retweet_count: z.number().optional().nullable(),
                        legacy: z
                            .object({
                                bookmark_count: z.number().optional().nullable(),
                                reply_count: z.number().optional().nullable(),
                                quote_count: z.number().optional().nullable(),
                                favorite_count: z.number().optional().nullable(),
                                retweet_count: z.number().optional().nullable(),
                            })
                            .optional(),
                    }),
                })
                .optional(),
        })
        .optional(),
});

type TwitterMetrics = {
    views: number;
    bookmarkCount: number;
    replyCount: number;
    quoteCount: number;
    favoriteCount: number;
    retweetCount: number;
};

const defaultTwitterMetrics: TwitterMetrics = {
    views: 0,
    bookmarkCount: 0,
    replyCount: 0,
    quoteCount: 0,
    favoriteCount: 0,
    retweetCount: 0,
};

export async function getTwitterMetrics(url: string): Promise<TwitterMetrics> {
    try {
        const tweetId = url.match(/\/status\/(\d+)/)?.[1];
        if (!tweetId) {
            throw new Error("Invalid Twitter URL");
        }

        const options: RequestInit = {
            method: "GET",
            headers: {
                "x-rapidapi-key": env.RAPIDAPI_KEY,
                "x-rapidapi-host": "twitter241.p.rapidapi.com",
            },
        };

        const response = await fetch(
            `https://twitter241.p.rapidapi.com/tweet-v2?pid=${tweetId}`,
            options
        );

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const json = await response.json();
        const parsed = twitterResponseSchema.safeParse(json);

        if (!parsed.success) {
            console.warn("Twitter response parsing failed", parsed.error);
            return defaultTwitterMetrics;
        }

        const tweet = parsed.data.result?.tweetResult?.result;
        if (!tweet) {
            return defaultTwitterMetrics;
        }

        const legacy = tweet.legacy;

        const viewsRaw = tweet.views?.count;
        const views = typeof viewsRaw === "string" ? parseInt(viewsRaw, 10) : viewsRaw ?? 0;

        const pickMetric = (
            direct: number | null | undefined,
            legacyValue: number | null | undefined
        ) => direct ?? legacyValue ?? 0;

        return {
            views: Number.isFinite(views) ? views : 0,
            bookmarkCount: pickMetric(tweet.bookmark_count, legacy?.bookmark_count),
            replyCount: pickMetric(tweet.reply_count, legacy?.reply_count),
            quoteCount: pickMetric(tweet.quote_count, legacy?.quote_count),
            favoriteCount: pickMetric(tweet.favorite_count, legacy?.favorite_count),
            retweetCount: pickMetric(tweet.retweet_count, legacy?.retweet_count),
        };
    } catch (error) {
        console.error("Error getting Twitter metrics:", (error as Error).message);
        return defaultTwitterMetrics;
    }
}
