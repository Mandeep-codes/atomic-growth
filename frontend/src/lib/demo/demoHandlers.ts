import {
  CAMPAIGNS,
  DEMO_USER,
  UNLOCKED_PRIVATE,
  accountById,
  applicationStatusOf,
  campaignById,
  claimable,
  earnedOf,
  getState,
  myCampaignIds,
  newId,
  rateFor,
  setState,
  statusOf,
  totalEarned,
  viewsOf,
  type DemoSubmission,
} from "./demoData";

// ─────────────────────────────────────────────────────────────────────────────
// HANDLERS
//
// Keyed by the exact tRPC path. A path with no entry here falls through to
// demoLink's "missing" branch, which warns and returns null rather than
// throwing — see demoLink.ts.
//
// COVERAGE IS THE CLIPPER JOURNEY, NOT THE WHOLE APP. The app calls 207
// distinct procedures; the ~20 admin panels are not fixtured, because a demo
// walks a clipper through joining, submitting, verifying and getting paid.
// Admin screens will render empty and log what they wanted.
// ─────────────────────────────────────────────────────────────────────────────

type Handler = (input: any) => unknown;

const pause = <T,>(value: T, ms = 260): Promise<T> =>
  new Promise((r) => setTimeout(() => r(value), ms));

const submissionOut = (s: DemoSubmission) => {
  const account = accountById(s.verifiedUserId);
  return {
    id: s.id,
    campaignId: s.campaignId,
    campaignTitle: s.campaignTitle,
    platform: s.platform,
    url: s.url,
    handle: s.handle,
    verifiedUserId: s.verifiedUserId,
    verified_user_id: s.verifiedUserId,
    status: statusOf(s),
    views: viewsOf(s),
    impressions: viewsOf(s),
    latestViewCount: viewsOf(s),
    amount: earnedOf(s),
    rejectedReason: s.rejectedReason ?? null,
    maxViewCap: s.maxViewCap ?? null,
    nonCampaignClip: false,
    nonCampaignClips: [],
    reviewerAssignmentUserId: null,
    clerkFirstName: DEMO_USER.displayName.split(" ")[0],
    usPercentage: account?.usPercentage ?? null,
    createdAt: new Date(s.submittedAtMs),
    created_at: new Date(s.submittedAtMs),
    submittedAt: new Date(s.submittedAtMs),
  };
};

export const HANDLERS: Record<string, Handler> = {
  // ── identity ───────────────────────────────────────────────────────────────
  "user.getProfile": () => {
    const s = getState();
    return pause({
      ...DEMO_USER,
      phoneNumber: s.phoneNumber,
      phoneCountryCode: s.phoneCountryCode,
    });
  },
  "user.updatePhoneNumber": (input: any) => {
    setState((s) => {
      s.phoneNumber = input?.phoneNumber ?? null;
      s.phoneCountryCode = input?.phoneCountryCode ?? null;
    });
    return pause({ success: true });
  },
  "user.getBankDetails": () => pause(null),
  "user.getActivity": () => pause([]),

  // Empty roles = a clipper, which is what the demo should show. Put
  // ["admin"] here to walk the staff side instead.
  "roles.getUserRoles": () => pause([]),
  "roles.getRoles": () => pause([]),
  "siteSettings.getMaintenanceStatus": () =>
    pause({ maintenanceMode: false, message: null }),

  // ── campaigns ──────────────────────────────────────────────────────────────
  "campaigns.getAll": () => pause(CAMPAIGNS),
  "campaigns.getById": (input: any) => pause(campaignById(input?.id) ?? null),
  "campaigns.getByIdPublic": (input: any) =>
    pause(campaignById(input?.id) ?? null),
  "campaigns.getByIdUnlocked": (input: any) =>
    pause(campaignById(input?.id) ?? null),
  "campaigns.getCampaignLevels": () => pause([]),
  "campaigns.getMyCpmGroupRates": () => pause([]),
  "campaigns.getCampaignCategories": () => pause([]),
  "campaigns.getTopClippers": () => pause([]),
  "campaigns.getCampaignImpact": () => pause(null),

  // ── submissions ────────────────────────────────────────────────────────────
  "submissions.getMySubmissions": () =>
    pause(getState().submissions.map(submissionOut)),
  "submissions.getMyNonCampaignClips": () => pause([]),
  "submissions.getMyStats": () => {
    const subs = getState().submissions;
    return pause({
      campaignsJoined: myCampaignIds().length,
      totalViews: subs.reduce((n, s) => n + viewsOf(s), 0),
      clipsSubmitted: subs.length,
      revenueEarned: totalEarned(),
      approvedCount: subs.filter((s) => statusOf(s) === "approved").length,
      pendingCount: subs.filter((s) => statusOf(s) === "pending").length,
      rejectedCount: subs.filter((s) => statusOf(s) === "rejected").length,
    });
  },
  "submissions.getPlatformBreakdown": () => {
    const subs = getState().submissions;
    const by: Record<string, number> = {};
    subs.forEach((s) => {
      by[s.platform] = (by[s.platform] ?? 0) + viewsOf(s);
    });
    return pause(
      Object.entries(by).map(([platform, views]) => ({ platform, views }))
    );
  },
  "submissions.getRedemptionProgress": () =>
    pause({ enabled: false, perAccount: [] }),
  "submissions.getNonCampaignStats": () => pause(null),
  "submissions.getAllTimeLeaderboard": () => pause([]),
  "submissions.previewClipUrl": (input: any) =>
    pause({
      valid: true,
      platform: /instagram/.test(input?.url ?? "")
        ? "instagram"
        : /tiktok/.test(input?.url ?? "")
        ? "tiktok"
        : "youtube",
      title: "Demo clip",
      thumbnailUrl: "",
    }),

  // Input is snake_case: { campaign_id, url, platform, is_user_generated_content,
  // verified_handle } - step-2-content.tsx:114.
  "submissions.createSubmission": (input: any) => {
    const campaignId = input?.campaign_id ?? input?.campaignId ?? CAMPAIGNS[0].id;
    const campaign = campaignById(campaignId);
    const handle = input?.verified_handle
      ? String(input.verified_handle).replace(/^@/, "")
      : null;
    const account =
      (handle && getState().accounts.find((a) => a.handle === handle)) ||
      getState().accounts.find((a) => a.platform === input?.platform) ||
      getState().accounts[0];
    const created: DemoSubmission = {
      id: newId("sub"),
      campaignId,
      campaignTitle: campaign?.title ?? "Campaign",
      platform: input?.platform ?? account?.platform ?? "youtube",
      url: input?.url ?? "https://youtube.com/shorts/demo",
      handle: account?.handle ?? "businesstalk023",
      verifiedUserId: account?.id ?? "acc_yt_1",
      submittedAtMs: Date.now(),
    };
    setState((s) => {
      s.submissions.unshift(created);
    });
    return pause(submissionOut(created), 600);
  },
  "submissions.createSubmission": (input: any) => {
    const campaign = campaignById(input?.campaignId);
    const account =
      accountById(input?.verifiedUserId) ?? getState().accounts[0];
    const created: DemoSubmission = {
      id: newId("sub"),
      campaignId: input?.campaignId ?? CAMPAIGNS[0].id,
      campaignTitle: campaign?.title ?? "Campaign",
      platform: input?.platform ?? account?.platform ?? "youtube",
      url: input?.url ?? "https://youtube.com/shorts/demo",
      handle: account?.handle ?? "businesstalk023",
      verifiedUserId: account?.id ?? "acc_yt_1",
      submittedAtMs: Date.now(),
    };
    setState((s) => {
      s.submissions.unshift(created);
    });
    return pause(submissionOut(created), 600);
  },
  "submissions.deleteSubmission": (input: any) => {
    setState((s) => {
      s.submissions = s.submissions.filter((x) => x.id !== input?.id);
    });
    return pause({ success: true });
  },

  // ── rewards / earnings ─────────────────────────────────────────────────────
  "rewards.getMyCampaignRewards": () => {
    const subs = getState().submissions;
    return pause(
      myCampaignIds().map((campaignId) => {
        const mine = subs.filter((s) => s.campaignId === campaignId);
        return {
          campaignId,
          campaignTitle: campaignById(campaignId)?.title ?? "Campaign",
          platform: mine[0]?.platform ?? "youtube",
          totalAmount: mine.reduce((n, s) => n + earnedOf(s), 0),
          latestViewCount: mine.reduce((n, s) => n + viewsOf(s), 0),
          totalViewDelta: mine.reduce((n, s) => n + viewsOf(s), 0),
          lastRewardAt: new Date(
            Math.max(...mine.map((s) => s.submittedAtMs))
          ),
        };
      })
    );
  },
  "rewards.getMyTotalEarnings": () => pause({ total: totalEarned() }),
  "rewards.getMyEarnings": () => {
    const subs = getState().submissions.filter(
      (s) => statusOf(s) === "approved"
    );
    return pause({
      claimable: claimable(),
      balance: claimable(),
      earned: totalEarned(),
      deducted: 0,
      paidOut: getState().claimedTotal,
      lifetime: totalEarned(),
      activity: subs.map((s) => ({
        id: `act_${s.id}`,
        type: "reward",
        title: `${s.campaignTitle} · @${s.handle}`,
        description: `${viewsOf(s).toLocaleString()} views at $${rateFor(
          s.campaignId,
          s.platform
        ).toFixed(2)} per 1,000`,
        amount: earnedOf(s),
        createdAt: new Date(s.submittedAtMs),
      })),
    });
  },

  // getClaimable feeds the wallet balance in the top bar.
  "demographicsVerification.getClaimable": () =>
    pause({ balance: claimable(), claimable: claimable() }),

  // ── social verification ────────────────────────────────────────────────────
  "verification.checkVerification": (input: any) => {
    const accounts = getState().accounts.filter(
      (a) => a.platform === input?.platform
    );
    return pause({
      verified: accounts.length > 0,
      verifiedAccounts: accounts,
    });
  },
  "verification.initializeVerification": () =>
    pause(
      { verifyCode: "atomik-verify-" + Math.random().toString(36).slice(2, 8) },
      500
    ),
  "verification.verifyUserBio": (input: any) => {
    // Read as result.verified (useAccountVerification.ts:55). NOT success.
    const created = {
      id: newId("acc"),
      platform: (input?.platform ?? "youtube") as any,
      handle: String(input?.handle ?? "new_channel").replace(/^@/, ""),
      created_at: new Date(),
      usPercentage: 21.4,
    };
    setState((s) => {
      if (!s.accounts.some((a) => a.handle === created.handle))
        s.accounts.push(created);
    });
    return pause({ verified: true, account: created }, 700);
  },
  "verification.verifyLoginCredentials": (input: any) => {
    // Read as result.success (login-verification.tsx:240). NOT verified.
    const created = {
      id: newId("acc"),
      platform: (input?.platform ?? "youtube") as any,
      handle: String(input?.handle ?? "new_channel").replace(/^@/, ""),
      created_at: new Date(),
      usPercentage: 18.9,
    };
    setState((s) => {
      if (!s.accounts.some((a) => a.handle === created.handle))
        s.accounts.push(created);
    });
    return pause({ success: true, message: null, account: created }, 700);
  },
  "verification.removeVerification": (input: any) => {
    setState((s) => {
      s.accounts = s.accounts.filter((a) => a.id !== input?.id);
    });
    return pause({ success: true });
  },

  // ── demographics ───────────────────────────────────────────────────────────
  // The real page is empty until a campaign ASKS. Seeding one ask is what makes
  // this screen demoable at all — see the note in the handover about
  // getCampaignAsks being the definition of outstanding.
  "demographicsVerification.getCampaignAsks": () => {
    const done = getState().demographicsSubmitted;
    const asks = myCampaignIds()
      .filter((id) => id !== "camp_slash")
      .map((campaignId) => ({
        campaignId,
        campaignTitle: campaignById(campaignId)?.title ?? "Campaign",
        satisfied: done.includes(campaignId),
        note:
          campaignId === "camp_nyne"
            ? "This campaign pays a US audience bonus on top of the base rate."
            : null,
        accounts: getState()
          .accounts.filter((a) =>
            getState().submissions.some(
              (s) => s.campaignId === campaignId && s.verifiedUserId === a.id
            )
          )
          .map((a) => ({
            id: a.id,
            handle: a.handle,
            platform: a.platform,
            verifiedUserId: a.id,
            submitted: done.includes(campaignId),
            approved: done.includes(campaignId),
            status: done.includes(campaignId) ? "approved" : "pending",
          })),
      }));
    return pause({ asks });
  },
  "demographicsVerification.listClaims": () => {
    const done = getState().demographicsSubmitted;
    return pause(
      done.map((campaignId) => ({
        id: `claim_${campaignId}`,
        campaignId,
        campaignTitle: campaignById(campaignId)?.title ?? "Campaign",
        campaignTitles: [campaignById(campaignId)?.title ?? "Campaign"],
        campaignCount: 1,
        status: "approved",
        approvalMethod: "screenshot",
        verifiedHandle: getState().accounts[0]?.handle ?? "businesstalk023",
        verifiedUsername: getState().accounts[0]?.handle ?? "businesstalk023",
        verifiedPlatform: getState().accounts[0]?.platform ?? "youtube",
        ownerEmail: DEMO_USER.email,
        userId: DEMO_USER.id,
        createdAt: new Date(),
        data: { US: 24.1, GB: 11.2, CA: 7.4, AU: 4.1, IN: 18.6 },
        viewsFromSnapshot: 41203,
      }))
    );
  },
  "demographicsVerification.getClaim": () => pause(null),
  "demographicsVerification.submitForCampaign": (input: any) => {
    setState((s) => {
      if (input?.campaignId && !s.demographicsSubmitted.includes(input.campaignId))
        s.demographicsSubmitted.push(input.campaignId);
    });
    return pause({ success: true }, 800);
  },
  "demographicsVerification.submitVideoLink": (input: any) => {
    setState((s) => {
      if (input?.campaignId && !s.demographicsSubmitted.includes(input.campaignId))
        s.demographicsSubmitted.push(input.campaignId);
    });
    return pause({ success: true }, 800);
  },
  "demographicsVerification.submitExemption": (input: any) => {
    setState((s) => {
      if (input?.campaignId && !s.demographicsSubmitted.includes(input.campaignId))
        s.demographicsSubmitted.push(input.campaignId);
    });
    return pause({ success: true }, 600);
  },
  "demographicsVerification.getUsDemographicsAccess": () =>
    pause({ hasAccess: false }),
  "uploads.uploadDemographicScreenshot": () =>
    pause({ url: "https://example.com/demo-screenshot.png" }, 900),

  // ── announcements ──────────────────────────────────────────────────────────
  "notifications.getAnnouncements": () => {
    const dismissed = getState().dismissedAnnouncements;
    return pause(
      [
        {
          id: "ann_1",
          title: "Payout run moves to Mondays",
          description:
            "From this week payouts clear on Monday mornings instead of Friday evenings. Nothing else changes — the 14-day window and the rates stay the same.",
          metadata: { type: "announcement" },
          createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
        },
        {
          id: "ann_2",
          title: "Airwallex: no logo thumbnails",
          description:
            "A few clips have been rejected for using the Airwallex logo as the thumbnail. Use a frame from the clip instead. Already-approved clips are unaffected.",
          metadata: { type: "announcement", campaignId: "camp_airwallex" },
          createdAt: new Date(Date.now() - 26 * 60 * 60 * 1000),
        },
        {
          id: "ann_3",
          title: "Instagram view counts are lagging",
          description:
            "Instagram's API is returning stale numbers for some accounts. Views will catch up automatically — no need to resubmit.",
          metadata: { type: "issue-alert" },
          createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
        },
      ].filter((a) => !dismissed.includes(a.id))
    );
  },
  "notifications.getMyNotifications": () => pause([]),
  "notifications.dismissAnnouncement": (input: any) => {
    setState((s) => s.dismissedAnnouncements.push(input?.id));
    return pause({ success: true });
  },
  "notifications.dismiss": (input: any) => {
    setState((s) => s.dismissedAnnouncements.push(input?.id));
    return pause({ success: true });
  },

  // ── referrals / payouts ────────────────────────────────────────────────────
  "referrals.getMyReferralCode": () =>
    pause({ code: "SHREE199", shareCardUrl: null }),
  "referrals.getMyReferralStatus": () =>
    pause({ referredBy: null, eligible: true }),
  "referrals.getMyReferredUsers": () => pause([]),
  "bankAccounts.getAll": () => pause([]),
  "leaderboard.isLeaderboardEnabled": () => pause({ enabled: false }),
  "leaderboard.getTopEarners": () => pause([]),

  // ── private campaigns ──────────────────────────────────────────────────────
  // apply() takes ONLY { campaignId } — the application collects nothing else,
  // by design ("mods judge the clipper on their whole history"). The demo
  // approves it after ~20s so the pending -> approved -> unlocked transition is
  // walkable without a moderator.
  "privateCampaigns.listPrivateCampaigns": () =>
    pause(CAMPAIGNS.filter((c) => c.visibility === "private")),

  "privateCampaigns.apply": (input: any) => {
    setState((s) => {
      if (input?.campaignId) s.applications[input.campaignId] = Date.now();
    });
    return pause({ status: "pending" }, 700);
  },

  "privateCampaigns.getApplicationState": (input: any) => {
    const campaignId = input?.campaignId;
    const status = campaignId ? applicationStatusOf(campaignId) : null;
    if (!status) return pause({ application: null, unlocked: null });
    return pause({
      application: {
        id: `app_${campaignId}`,
        campaignId,
        status,
        createdAt: new Date(getState().applications[campaignId]),
        reviewedAt: status === "approved" ? new Date() : null,
        rejectedReason: null,
        lastRejectedReason: null,
      },
      // unlocked is populated ONLY when approved — same rule as the server.
      unlocked:
        status === "approved"
          ? { campaignId, ...(UNLOCKED_PRIVATE[campaignId] ?? {}) }
          : null,
    });
  },

  "privateCampaigns.myUnlockedCampaigns": () =>
    pause(
      Object.keys(getState().applications)
        .filter((id) => applicationStatusOf(id) === "approved")
        .map((campaignId) => ({
          campaignId,
          ...(UNLOCKED_PRIVATE[campaignId] ?? {}),
        }))
    ),

  // Same filter apply() re-checks: verified, not deleted.
  "privateCampaigns.myVerifiedAccounts": () =>
    pause(
      getState().accounts.map((a) => ({
        id: a.id,
        handle: a.handle,
        platform: a.platform,
        verifiedUserId: a.id,
      }))
    ),

  "privateCampaigns.getApplicantStats": () => {
    const subs = getState().submissions;
    return pause({
      totalViews: subs.reduce((n, s) => n + viewsOf(s), 0),
      clipsSubmitted: subs.length,
      approvedCount: subs.filter((s) => statusOf(s) === "approved").length,
      campaignsJoined: myCampaignIds().length,
    });
  },

  "privateCampaigns.getDiscordJoinStatus": () =>
    pause({ joined: true, required: false, inviteUrl: null }),
  "privateCampaigns.getDiscordJoinAuthorizeUrl": () =>
    pause({ url: "https://discord.com/oauth2/authorize?demo=1" }),
  "privateCampaigns.joinPrivateDiscord": () => pause({ success: true }, 500),
  "privateCampaigns.listApplications": () => pause([]),

  // Called imperatively via utils.<proc>.fetch(), so an unmocked null gets read
  // straight off the result and throws, instead of degrading to an empty state.
  "verification.handleExists": (input: any) => {
    const handle = String(input?.handle ?? "").replace(/^@/, "");
    const taken = getState().accounts.some(
      (a) => a.handle.toLowerCase() === handle.toLowerCase()
    );
    return pause(
      taken
        ? { exists: true, email: null, password: null }
        : {
            exists: false,
            email: handle + ".atomik@atomikclips.com",
            password: "Ak-" + Math.random().toString(36).slice(2, 10),
          },
      500
    );
  },
  // SubmissionStep1.tsx:169-171 reads res.platform / res.username / res.url.
  // username (NOT handle) fills detectedHandle; without it the form says
  // "unable to detect your user handle" and stays locked.
  //
  // The username returned is always one of the clipper's OWN verified accounts
  // on the detected platform, so the handleMismatch guard (line 71) can never
  // trip. Any pasted link just works.
  "submissions.getPlatformMetadata": (input: any) => {
    const url = String(input?.url ?? "");
    const platform = /instagram\./i.test(url)
      ? "instagram"
      : /tiktok\./i.test(url)
      ? "tiktok"
      : /(twitter\.|x\.com)/i.test(url)
      ? "x"
      : "youtube";
    const accounts = getState().accounts;
    const mine = accounts.find((a) => a.platform === platform) ?? accounts[0];
    return pause({
      platform,
      username: mine?.handle ?? "businesstalk023",
      handle: mine?.handle ?? "businesstalk023",
      url,
      title: "Demo clip",
      thumbnailUrl: "",
      views: 0,
      valid: true,
    });
  },
  "submissions.getCampaignAccountDashboard": (input: any) => {
    const campaignId = input?.campaign_id ?? input?.campaignId;
    return pause({
      enabled: false,
      cap: 0,
      perAccount: getState().accounts.map((a) => ({
        verifiedUserId: a.id,
        handle: a.handle,
        platform: a.platform,
        cap: 0,
        covered: 0,
        unredeemed: 0,
        allowedRemaining: 99,
        mustRedeem: false,
        campaignId,
      })),
    });
  },
};
