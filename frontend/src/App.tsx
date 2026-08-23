import { BrowserRouter, Routes, Route } from "react-router-dom";
import { useUser } from "@clerk/clerk-react";
import { Loader2 } from "lucide-react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/useAuth";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AdminRoute } from "@/components/AdminRoute";
import { TrpcProvider } from "@/components/TrpcProvider";
import { PageViewTracker } from "@/components/PageViewTracker";
import { ReferralTracker } from "@/components/ReferralTracker";
import { MaintenanceGate } from "@/components/MaintenanceGate";
import AdminSOS from "./pages/AdminSOS";
import AdminStableId from "./pages/AdminStableId";
import Index from "./pages/Index";
import Campaigns from "./pages/Campaigns";
import UserCampaigns from "./pages/Home";
import ExploreCampaigns from "./pages/ExploreCampaigns";
import Landing from "./pages/Landing";
import Onboarding from "./pages/Onboarding";
import Profile from "./pages/Profile";
import ActiveCampaigns from "./pages/ChooseCampaigns";
import CampaignEdit from "./pages/CampaignEdit";
import CampaignStats from "./pages/CampaignStats";
import CategoryView from "./pages/CategoryView";
import Submissions from "./pages/Submissions";
import BankAccounts from "./pages/BankAccounts";
import SocialVerification from "./pages/SocialVerification";
import Auth from "./pages/Auth";
import ResetPassword from "./pages/ResetPassword";
import NotFound from "./pages/NotFound";
import AdminSubmissions from "./pages/AdminSubmissions";
import AdminReviewClipV2 from "./pages/AdminReviewClipV2";
import AdminRewards from "./pages/AdminRewards";
import AdminManualRewards from "./pages/AdminManualRewards";
import AdminUserActivity from "./pages/AdminUserActivity";
import AdminDevOverlook from "./pages/AdminDevOverlook";
import AdminUserRoles from "./pages/AdminUserRoles";
import AdminBannedEntities from "./pages/AdminBannedEntities";
import AdminInfluencerSubmissions from "./pages/AdminInfluencerSubmissions";
import AdminInfluencerSubmissionLog from "./pages/AdminInfluencerSubmissionLog";
import AdminInfluencerCampaigns from "./pages/AdminInfluencerCampaigns";
import AdminInfluencerCampaignDetails from "./pages/AdminInfluencerCampaignDetails";
import AdminInfluencerCampaignEditor from "./pages/AdminInfluencerCampaignEditor";
import Earnings from "./pages/Earnings";
import AdminDemographicsVerification from "./pages/AdminDemographicsVerification";
import AdminUSDemographics from "./pages/AdminUSDemographics";
import AdminClipperActivity from "./pages/AdminClipperActivity";
import AdminLeaderboardTools from "./pages/AdminLeaderboardTools";
import AdminDeletedClipReserves from "./pages/AdminDeletedClipReserves";
import AdminPrivateCampaigns from "./pages/AdminPrivateCampaigns";
import AdminAliasGenerator from "./pages/AdminAliasGenerator";
import Step2 from "./pages/submission-flow/step-2-content";
import Step1 from "./pages/submission-flow/step-1-sop";
import Step3Finish from "./pages/submission-flow/step-3-finish";
import SubmitDashboard from "./pages/submission-flow/submit-dashboard";
import NonCampaignClipSubmit from "./pages/NonCampaignClipSubmit";
import { SubmissionFlowLayout } from "./pages/submission-flow/submission-flow-layout";
import AdminPayouts from "./pages/AdminPayouts";
import AdminCryptoPayouts from "./pages/AdminCryptoPayouts";
import AdminNotifications from "./pages/AdminNotifications";
import { ClaimFlowLayout } from "./pages/claim-flow/claim-flow-layout";
import ClaimSelectMethodStep from "./pages/claim-flow/step-0-select-method";
import ClaimBankDetailsStep from "./pages/claim-flow/step-1-bank-details";
import ClaimCryptoDetailsStep from "./pages/claim-flow/step-1-crypto-details";
import ClaimConfirmationStep from "./pages/claim-flow/step-2-confirmation";
import SocialVerificationSelectMethodStep from "./pages/social-verification-flow/step-0-select-method";
import SocialVerificationBio from "./pages/social-verification-flow/bio-verification";
import SocialVerificationLogin from "./pages/social-verification-flow/login-verification";
import DemographicsVerification from "./pages/DemographicsVerification";
import DemographicsVerificationList from "./pages/DemographicsVerificationList";
import WeeklyDemographics from "./pages/WeeklyDemographics";
import Privacy from "./pages/Privacy";
import InstagramOauthTest from "./pages/InstagramOauthTest";
import ReferralCodePage from "./pages/ReferralCode";

// Splits "/" by session instead of guarding it. ProtectedRoute redirects to
// /auth, which is right for every other clipper route but would make the
// public home screen unreachable.
const HomeOrLanding = () => {
  const { isLoaded, isSignedIn } = useUser();
  if (!isLoaded) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  return isSignedIn ? <UserCampaigns /> : <Landing />;
};

const App = () => {
  return (
    <TrpcProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <PageViewTracker />
          <ReferralTracker />
          <AuthProvider>
            <MaintenanceGate>
            <Routes>
              <Route path="/auth" element={<Auth />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              {/* Signed out, "/" is the public home screen rather than a
                  bounce to /auth: a visitor should be able to see what Atomik
                  Clips is and browse the campaigns before creating anything.
                  Signed in it is the clipper dashboard, unchanged. */}
              <Route path="/" element={<HomeOrLanding />} />
              <Route path="/explore" element={<ExploreCampaigns />} />
              <Route path="/onboarding" element={<Onboarding />} />
              <Route
                path="/profile"
                element={
                  <ProtectedRoute>
                    <Profile />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/campaigns/active"
                element={
                  <ProtectedRoute>
                    <ActiveCampaigns />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin"
                element={
                  <ProtectedRoute>
                    <AdminRoute requiredRole="campaign-editor">
                      <Campaigns />
                    </AdminRoute>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/submissions"
                element={
                  <ProtectedRoute>
                    <AdminRoute requiredRole="submission-reviewer">
                      <AdminSubmissions />
                    </AdminRoute>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/review-clip-v2"
                element={
                  <ProtectedRoute>
                    <AdminRoute requiredRole="submission-reviewer">
                      <AdminReviewClipV2 />
                    </AdminRoute>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/private-campaigns"
                element={
                  <ProtectedRoute>
                    <AdminRoute requiredRole="submission-reviewer">
                      <AdminPrivateCampaigns />
                    </AdminRoute>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/alias-generator"
                element={
                  <ProtectedRoute>
                    <AdminRoute
                      requiredAnyRole={[
                        "god-mode",
                        "user-roles-admin",
                        "campaign-editor",
                        "rewards-modifier",
                        "submission-reviewer",
                        "payouts-admin",
                        "demographics-reviewer",
                        "user-activity-read",
                        "notification-announcements-admin",
                        "influencer-submission-editor",
                        "influencer-campaign-editor",
                        "submission-view-cap-manager",
                        "sos",
                      ]}
                    >
                      <AdminAliasGenerator />
                    </AdminRoute>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/influencer-submissions"
                element={
                  <ProtectedRoute>
                    <AdminRoute requiredRole="submission-reviewer">
                      <AdminInfluencerSubmissions />
                    </AdminRoute>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/influencer-submissions-log"
                element={
                  <ProtectedRoute>
                    <AdminRoute requiredRole="submission-reviewer">
                      <AdminInfluencerSubmissionLog />
                    </AdminRoute>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/influencer-campaigns"
                element={
                  <ProtectedRoute>
                    <AdminRoute requiredRole="submission-reviewer">
                      <AdminInfluencerCampaigns />
                    </AdminRoute>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/influencer-campaigns/new"
                element={
                  <ProtectedRoute>
                    <AdminRoute requiredRole="submission-reviewer">
                      <AdminInfluencerCampaignEditor />
                    </AdminRoute>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/influencer-campaigns/:campaignId"
                element={<AdminInfluencerCampaignDetails />}
              />
              <Route
                path="/influencer-campaigns/:campaignId"
                element={<AdminInfluencerCampaignDetails />}
              />
              <Route
                path="/admin/influencer-campaigns/:campaignId/edit"
                element={
                  <ProtectedRoute>
                    <AdminRoute requiredRole="submission-reviewer">
                      <AdminInfluencerCampaignEditor />
                    </AdminRoute>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/demographics-verification"
                element={
                  <ProtectedRoute>
                    <AdminRoute requiredRole="submission-reviewer">
                      <AdminDemographicsVerification />
                    </AdminRoute>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/us-demographics"
                element={
                  <ProtectedRoute>
                    <AdminRoute requiredRole="demographics-reviewer">
                      <AdminUSDemographics />
                    </AdminRoute>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/clipper-activity"
                element={
                  <ProtectedRoute>
                    <AdminRoute requiredRole="demographics-reviewer">
                      <AdminClipperActivity />
                    </AdminRoute>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/leaderboard-tools"
                element={
                  <ProtectedRoute>
                    <AdminRoute requiredRole="campaign-editor">
                      <AdminLeaderboardTools />
                    </AdminRoute>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/deleted-clip-reserves"
                element={
                  <ProtectedRoute>
                    <AdminRoute requiredRole="demographics-reviewer">
                      <AdminDeletedClipReserves />
                    </AdminRoute>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/rewards"
                element={
                  <ProtectedRoute>
                    <AdminRoute requiredRole="rewards-modifier">
                      <AdminRewards />
                    </AdminRoute>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/rewards/manual"
                element={
                  <ProtectedRoute>
                    <AdminRoute requiredRole="rewards-modifier">
                      <AdminManualRewards />
                    </AdminRoute>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/user-activity"
                element={
                  <ProtectedRoute>
                    <AdminRoute requiredRole="user-activity-read">
                      <AdminUserActivity />
                    </AdminRoute>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/dev-overlook"
                element={
                  <ProtectedRoute>
                    <AdminDevOverlook />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/bans"
                element={
                  <ProtectedRoute>
                    <AdminRoute requiredRole="user-activity-read">
                      <AdminBannedEntities />
                    </AdminRoute>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/user-roles"
                element={
                  <ProtectedRoute>
                    <AdminRoute requiredRole="user-roles-admin">
                      <AdminUserRoles />
                    </AdminRoute>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/payouts"
                element={
                  <ProtectedRoute>
                    <AdminRoute requiredRole="rewards-modifier">
                      <AdminPayouts />
                    </AdminRoute>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/crypto-payouts"
                element={
                  <ProtectedRoute>
                    <AdminRoute requiredRole="rewards-modifier">
                      <AdminCryptoPayouts />
                    </AdminRoute>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/notifications"
                element={
                  <ProtectedRoute>
                    <AdminRoute requiredRole="notification-announcements-admin">
                      <AdminNotifications />
                    </AdminRoute>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/sos"
                element={
                  <ProtectedRoute>
                    <AdminRoute requiredRole="sos">
                      <AdminSOS />
                    </AdminRoute>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/stable-id"
                element={
                  <ProtectedRoute>
                    <AdminRoute requiredRole="user-roles-admin">
                      <AdminStableId />
                    </AdminRoute>
                  </ProtectedRoute>
                }
              />
              <Route path="/campaign/:campaignId" element={<Index />} />
              <Route path="/privacy" element={<Privacy />} />
              <Route
                path="/campaign/:campaignId/category/:category"
                element={<CategoryView />}
              />
              <Route
                path="/campaign/:campaignId/edit"
                element={
                  <ProtectedRoute>
                    <AdminRoute requiredRole="campaign-editor">
                      <CampaignEdit />
                    </AdminRoute>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/campaign/:campaignId/stats"
                element={
                  <ProtectedRoute>
                    <AdminRoute requiredRole="campaign-editor">
                      <CampaignStats />
                    </AdminRoute>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/campaign/:campaignId/submit"
                element={
                  <SubmissionFlowLayout>
                    <SubmitDashboard />
                  </SubmissionFlowLayout>
                }
              />
              <Route
                path="/campaign/:campaignId/step-1"
                element={
                  <SubmissionFlowLayout>
                    <Step1 />
                  </SubmissionFlowLayout>
                }
              />
              <Route
                path="/campaign/:campaignId/step-2"
                element={
                  <SubmissionFlowLayout>
                    <Step2 />
                  </SubmissionFlowLayout>
                }
              />
              <Route
                path="/campaign/:campaignId/step-3"
                element={
                  <SubmissionFlowLayout>
                    <Step3Finish />
                  </SubmissionFlowLayout>
                }
              />
              <Route
                path="/campaign/:campaignId/non-campaign"
                element={
                  <ProtectedRoute>
                    <NonCampaignClipSubmit />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/earnings/claim"
                element={
                  <ProtectedRoute>
                    <ClaimFlowLayout
                      title="Claim your earnings"
                      description="Select how you’d like to receive your payout."
                      currentStep={1}
                      totalSteps={3}
                    >
                      <ClaimSelectMethodStep />
                    </ClaimFlowLayout>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/earnings/claim/bank/details"
                element={
                  <ProtectedRoute>
                    <ClaimFlowLayout
                      title="Claim your earnings"
                      description="Confirm or update where we should send your payout."
                      currentStep={2}
                      totalSteps={3}
                    >
                      <ClaimBankDetailsStep />
                    </ClaimFlowLayout>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/earnings/claim/bank/confirmation"
                element={
                  <ProtectedRoute>
                    <ClaimFlowLayout
                      title="Claim your earnings"
                      description="We’ll process it during the next payment cycle."
                      currentStep={3}
                      totalSteps={3}
                    >
                      <ClaimConfirmationStep />
                    </ClaimFlowLayout>
                  </ProtectedRoute>
                }
              />
              {/* Crypto claim (NOWPayments pilot). Only linked for
                  rewards-modifier users; the backend enforces the role. */}
              <Route
                path="/earnings/claim/crypto/details"
                element={
                  <ProtectedRoute>
                    <ClaimFlowLayout
                      title="Claim your earnings"
                      description="Choose the crypto address we should pay."
                      currentStep={2}
                      totalSteps={3}
                    >
                      <ClaimCryptoDetailsStep />
                    </ClaimFlowLayout>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/earnings/claim/crypto/confirmation"
                element={
                  <ProtectedRoute>
                    <ClaimFlowLayout
                      title="Claim your earnings"
                      description="We’ll process it with the next crypto batch."
                      currentStep={3}
                      totalSteps={3}
                    >
                      <ClaimConfirmationStep />
                    </ClaimFlowLayout>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/submissions"
                element={
                  <ProtectedRoute>
                    <Submissions />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/bank-accounts"
                element={
                  <ProtectedRoute>
                    <BankAccounts />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/referrals"
                element={
                  <ProtectedRoute>
                    <ReferralCodePage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/earnings"
                element={
                  <ProtectedRoute>
                    <Earnings />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/verification"
                element={
                  <ProtectedRoute>
                    <SocialVerification />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/verification/flow"
                element={
                  <ProtectedRoute>
                    <SocialVerificationSelectMethodStep />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/verification/flow/bio"
                element={
                  <ProtectedRoute>
                    <SocialVerificationBio />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/verification/flow/create-login"
                element={
                  <ProtectedRoute>
                    <SocialVerificationLogin />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/demographics-verification"
                element={
                  <ProtectedRoute>
                    <DemographicsVerificationList />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/demographics-verification/weekly"
                element={
                  <ProtectedRoute>
                    <WeeklyDemographics />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/demographics-verify/:id"
                element={
                  <ProtectedRoute>
                    <DemographicsVerification />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/test-instagram-auth"
                element={
                  <ProtectedRoute>
                    <InstagramOauthTest />
                  </ProtectedRoute>
                }
              />
              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
            </MaintenanceGate>
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </TrpcProvider>
  );
};

export default App;
