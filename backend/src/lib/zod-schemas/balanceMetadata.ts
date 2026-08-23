export type CampaignViewRewardMetadata = {
  version: "v1";
  type: "campaign_view_reward";
  campaignId: string;
  campaignTitle: string | null;
  platform: string;
  viewDelta: number;
  totalViews: number;
  cpm: number;
};

export type ReferralRewardMetadata = {
  version: "v1";
  type: "referral_reward";
  campaignId: string | null;
  campaignTitle: string | null;
  platform: string | null;
  referredUserId: string;
  referredUserEmail: string | null;
};

export type ReferralRewardV2Metadata = {
  version: "v1";
  type: "referral_reward_v2";
  campaignId: string | null;
  campaignTitle: string | null;
  platform: string | null;
  referredUserName: string;
};

export type RefereeRewardMetadata = {
  version: "v1";
  type: "referee_reward";
  campaignId: string | null;
  campaignTitle: string | null;
  platform: string | null;
};

export type CampaignYoutubeSlashMetadata = {
  version: "v1";
  type: "campaign_youtube_slash";
  campaignId: string;
  campaignTitle: string | null;
  reductionRate: number;
  youtubeShare: number;
  youtubeSubmissions: number;
  totalSubmissions: number;
  triggeredBy: string | null;
};
