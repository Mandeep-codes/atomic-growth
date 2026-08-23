import { z } from "zod";
import { env } from "../../lib/env";

const linkedInResponseSchema = z.object({
    data: z
        .object({
            activity: z
                .object({
                    num_likes: z.number().optional().nullable(),
                    num_comments: z.number().optional().nullable(),
                    num_shares: z.number().optional().nullable(),
                })
                .optional(),
        })
        .optional(),
});

const linkedInRepostsResponseSchema = z.object({
    total: z.number().optional().nullable(),
});

async function fetchLinkedInRepostsCount(postId: string) {
    try {
        const response = await fetch(
            `https://fresh-linkedin-scraper-api.p.rapidapi.com/api/v1/post/reposts?post_id=${postId}`,
            {
                method: "GET",
                headers: {
                    "x-rapidapi-key": env.RAPIDAPI_KEY,
                    "x-rapidapi-host": "fresh-linkedin-scraper-api.p.rapidapi.com",
                },
            }
        );

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const json = await response.json();
        const parsed = linkedInRepostsResponseSchema.safeParse(json);

        if (!parsed.success) {
            console.warn("LinkedIn repost response parsing failed", parsed.error);
            return 0;
        }

        return parsed.data.total ?? 0;
    } catch (error) {
        console.error("Error getting LinkedIn reposts:", (error as Error).message);
        return 0;
    }
}

export async function getLinkedInLikes(url: string) {
    let repostsPromise: Promise<number> | null = null;
    try {
        const postId = url.match(/activity-(\d+)/)?.[1];

        if (!postId) {
            throw new Error("Invalid LinkedIn URL");
        }

        repostsPromise = fetchLinkedInRepostsCount(postId);

        const response = await fetch(`https://fresh-linkedin-scraper-api.p.rapidapi.com/api/v1/post/detail?post_id=${postId}`, {
            method: "GET",
            headers: {
                "x-rapidapi-key": env.RAPIDAPI_KEY,
                "x-rapidapi-host": "fresh-linkedin-scraper-api.p.rapidapi.com",
            },
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const json = await response.json();
        const parsed = linkedInResponseSchema.safeParse(json);

        if (!parsed.success) {
            console.warn("LinkedIn response parsing failed", parsed.error);
            const reposts = repostsPromise ? await repostsPromise : 0;
            return { likes: 0, comments: 0, shares: 0, reposts };
        }

        const activity = parsed.data.data?.activity;
        const reposts = repostsPromise ? await repostsPromise : 0;
        return {
            likes: activity?.num_likes ?? 0,
            comments: activity?.num_comments ?? 0,
            shares: activity?.num_shares ?? 0,
            reposts,
        };
    } catch (error) {
        console.error("Error getting LinkedIn likes:", (error as Error).message);
        const reposts = repostsPromise ? await repostsPromise : 0;
        return { likes: 0, comments: 0, shares: 0, reposts };
    }
}
