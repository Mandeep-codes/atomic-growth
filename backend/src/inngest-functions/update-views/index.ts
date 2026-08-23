import { env } from "../../lib/env";
import { inngest } from "../../lib/inngest";
import { getYouTubeVideoId } from "./getYouTubeViews";
import { getYouTubeBatchRich } from "./getViewsRich";
import {
  finalizeCampaigns,
  getCampaignCpmOverridesMap,
  getQualifyingNonCampaignClips,
  getQualifyingSubmissions,
  updateViewCountsForNonCampaignClip,
  updateViewCountsForSubmission,
} from "./updateViewCounts";
import { viewsSnapshot } from "./viewsSnapshot";

// Try not to exceed RapidAPI rate limits
const CHUNK_SIZE = 25;
export const updateViews = inngest.createFunction(
  { id: "update-views" },
  { cron: "TZ=America/New_York 0 */4 * * *" },
  async ({ event, logger, step }) => {
    if (env.NODE_ENV !== "production") {
      logger.info("Skipping update-views in non-production");
      return;
    }

    logger.info("Starting update-views function", { eventId: event.id });

    const qualifyingSubmissions = await getQualifyingSubmissions();

    logger.info(
      "Number of qualifying submissions",
      qualifyingSubmissions.length
    );

    // One load per run: per-clipper CPM overrides so the scoreboard prices
    // submissions.reward at the same rate the wallet pays.
    const cpmOverrides = await getCampaignCpmOverridesMap();

    for (let i = 0; i < qualifyingSubmissions.length; i += CHUNK_SIZE) {
      const chunk = qualifyingSubmissions.slice(i, i + CHUNK_SIZE);

      await step.run(`update-views-chunk-${i}`, async () => {
        const youtubeBatch = await batchedYouTubeViewsById(chunk);

        await Promise.all(
          chunk.map((submission) =>
            updateViewCountsForSubmission(submission, {
              youtubeBatch,
              cpmOverrides,
            })
          )
        );
        return {
          outputs: {
            success: true,
          },
        };
      });
    }

    // Also refresh non-campaign clip view counts. Non-campaign clips don't
    // earn rewards, so we don't need the per-platform throttle the campaign
    // path uses — just fetch and write. Same chunk size to share rate-limit
    // budget with the submissions loop above.
    const qualifyingNonCampaignClips = await getQualifyingNonCampaignClips();
    logger.info(
      "Number of qualifying non-campaign clips",
      qualifyingNonCampaignClips.length
    );

    for (
      let i = 0;
      i < qualifyingNonCampaignClips.length;
      i += CHUNK_SIZE
    ) {
      const chunk = qualifyingNonCampaignClips.slice(i, i + CHUNK_SIZE);
      await step.run(`update-nc-views-chunk-${i}`, async () => {
        // One videos.list call for the chunk's YouTube clips (1 quota unit
        // per 50 ids) — same batch pattern as the submissions loop above.
        const youtubeBatch = await getYouTubeBatchRich(
          chunk
            .map((clip) =>
              clip.url.includes("youtube.com") || clip.url.includes("you")
                ? getYouTubeVideoId(clip.url)
                : null
            )
            .filter((id): id is string => Boolean(id))
        );
        await Promise.all(
          chunk.map((clip) =>
            updateViewCountsForNonCampaignClip(clip, { youtubeBatch })
          )
        );
        return { outputs: { success: true } };
      });
    }

    const finalizeResult = await step.run("finalize-campaigns", async () => {
      return finalizeCampaigns();
    });

    await step.run("views-snapshot", () => viewsSnapshot());

    // View counts are now fresh — trigger the payout run so it stays in lockstep
    // with the view cron (fires the moment this finishes, not on a guessed
    // timer). Dedicated step so it isn't re-sent if an earlier step retries.
    await step.run("trigger-create-rewards", () =>
      inngest.send({ name: "rewards/create.requested" })
    );

    return finalizeResult;
  }
);

const batchedYouTubeViewsById = async (
  submissions: Awaited<ReturnType<typeof getQualifyingSubmissions>>
) => {
  const youtubeVideoIds = submissions
    .map((submission) => {
      if (
        submission.url.includes("youtube.com") ||
        submission.url.includes("you")
      ) {
        return getYouTubeVideoId(submission.url);
      }
      return null;
    })
    .filter((id): id is string => Boolean(id));

  // Rich batch: views + channelId per id, and absence => deleted/private.
  return getYouTubeBatchRich(youtubeVideoIds);
};
