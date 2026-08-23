import { router } from "../lib/trpc";
import { campaignsRouter } from "./campaigns";
import { submissionsRouter } from "./submissions";
import { verificationRouter } from "./verification";
import { userRouter } from "./user";
import { bankAccountsRouter } from "./bankAccounts";
import { rewardsRouter } from "./rewards";
import { rolesRouter } from "./roles";
import { wiseRouter } from "./wise";
import { wiseRecipientsRouter } from "./wiseRecipients";
import { cryptoPayoutsRouter } from "./cryptoPayouts";
import { uploadsRouter } from "./uploads";
import { demographicsVerificationRouter } from "./demographicsVerification";
import { notificationsRouter } from "./notifications";
import { youtubeOAuthRouter } from "./youtubeOAuth";
import { instagramOAuthRouter } from "./instagramOAuth";
import { referralsRouter } from "./referrals";
import { influencerSubmissionsRouter } from "./influencerSubmissions";
import { clipperActivityRouter } from "./clipperActivity";
import { privateCampaignsRouter } from "./privateCampaigns";
import { siteSettingsRouter } from "./siteSettings";
import { stableIdRouter } from "./stableIdBackfill";
import { leaderboardRouter } from "./leaderboard";
import { modAliasesRouter } from "./modAliases";
import { devOverlookRouter } from "./devOverlook";

export const appRouter = router({
  devOverlook: devOverlookRouter,
  clipperActivity: clipperActivityRouter,
  privateCampaigns: privateCampaignsRouter,
  leaderboard: leaderboardRouter,
  modAliases: modAliasesRouter,
  campaigns: campaignsRouter,
  submissions: submissionsRouter,
  verification: verificationRouter,
  user: userRouter,
  bankAccounts: bankAccountsRouter,
  rewards: rewardsRouter,
  roles: rolesRouter,
  wise: wiseRouter,
  wiseRecipients: wiseRecipientsRouter,
  cryptoPayouts: cryptoPayoutsRouter,
  uploads: uploadsRouter,
  demographicsVerification: demographicsVerificationRouter,
  notifications: notificationsRouter,
  youtubeOAuth: youtubeOAuthRouter,
  instagramOAuth: instagramOAuthRouter,
  referrals: referralsRouter,
  influencerSubmissions: influencerSubmissionsRouter,
  siteSettings: siteSettingsRouter,
  stableId: stableIdRouter,
});

export type AppRouter = typeof appRouter;
