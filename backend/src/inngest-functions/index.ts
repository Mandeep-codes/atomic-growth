import { createRewards } from "./createRewards";
import { helloWorld } from "./helloWorld";
import { updateViews } from "./update-views";
import { updateInfluencerSubmissions } from "./update-influencer-submissions";
import { updateEndedCampaignViews } from "./ended-campaign-views";
import { checkAccounts } from "./check-accounts";
import { dailyEarningsSummary } from "./daily-earnings-summary";
import { hostTopClips } from "./host-top-clips";

export const functions = [
  createRewards,
  helloWorld,
  updateViews,
  updateInfluencerSubmissions,
  updateEndedCampaignViews,
  checkAccounts,
  dailyEarningsSummary,
  hostTopClips,
];
