#!/usr/bin/env bash
# Atomik Clips — install demo mode (mock data for the whole clipper journey).
# Run from the frontend/ directory:   bash apply-demo-mode.sh
set -euo pipefail

if [ ! -f package.json ] || [ ! -d src/components ]; then
  echo "ERROR: run this from the frontend/ directory (the one with package.json)."
  exit 1
fi

echo "Backing up -> *.bak"
for f in src/lib/trpc.ts src/components/AppLayout.tsx; do
  [ -f "$f" ] && cp "$f" "$f.bak"
done
echo

echo "writing src/lib/demo/demoData.ts"
mkdir -p "src/lib/demo"
cat > src/lib/demo/demoData.ts << 'ATOMIK_EOF'
// ─────────────────────────────────────────────────────────────────────────────
// DEMO DATA
//
// Seed fixtures plus a small mutable store so the demo behaves like an app
// rather than a set of screenshots: submit a clip and it appears as pending,
// then approves, then starts earning. Verify a channel and it shows up on the
// verification card. Claim and the balance moves.
//
// State persists in localStorage under DEMO_KEY, so a refresh does not wipe
// whatever the person just did. `resetDemo()` puts it back to seed.
//
// TIME-DERIVED STATE
// Nothing here runs a timer. A submission's status and view count are pure
// functions of how long ago it was submitted, so the numbers move on their own
// every time a query refetches and there is no interval to leak.
//
// SHAPES ARE INFERRED, NOT COPIED. There is no backend in this repo, so every
// object below was reconstructed from what the components actually read. The
// fields the UI touches are right; fields nothing renders may be missing. If a
// screen breaks on a property that is not here, add it — that is the expected
// way to extend this.
// ─────────────────────────────────────────────────────────────────────────────

const DEMO_KEY = "atomik-demo-state-v1";

export const DEMO_USER = {
  id: "user_demo_shree",
  clerkId: "user_demo_shree",
  email: "shree199@example.com",
  displayName: "Shreyas Patel",
  handle: "shree_199",
  phoneNumber: null as string | null,
  phoneCountryCode: null as string | null,
  createdAt: new Date("2026-01-04T10:00:00Z"),
};

const day = 24 * 60 * 60 * 1000;
const now = () => Date.now();
const ago = (ms: number) => new Date(now() - ms);

// ── campaigns ────────────────────────────────────────────────────────────────

const baseCampaign = {
  active: true,
  ended: false,
  visibility: "public",
  submissions_paused: false,
  is_hot_streak_enabled: false,
  non_campaign_clips_required: 0,
  private_show_rates: true,
  private_show_budget: true,
  private_show_description: true,
  external_budget: null,
  demographics_recording_period_days: 14,
  demographicsVisibleCountries: ["US", "GB", "CA", "AU", "IN"],
  isAllTime: false,
  youtube_min_views: 1000,
  insta_min_views: 1000,
  x_min_views: 1000,
  tiktok_min_views: 1000,
  pendingCount: 0,
  rejectedCount: 0,
};

export const CAMPAIGNS = [
  {
    ...baseCampaign,
    id: "camp_airwallex",
    title: "Airwallex x Atomik Clips",
    description:
      "Clip the founder interviews and product walkthroughs. Keep captions on, keep it under 60 seconds, and do not use the logo as a thumbnail.",
    imageUrl: "",
    platforms: ["youtube", "instagram", "tiktok"],
    budget: 12000,
    min_payout: 5,
    max_payout: 400,
    youtube_per_1000: 0.3,
    insta_per_1000: 0.25,
    x_per_1000: 0.2,
    tiktok_per_1000: 0.25,
    ratePerThousand: 0.3,
    achievementPercentage: 38,
    totalViews: 4_182_990,
    submissionCount: 214,
    totalSubmissions: 214,
    created_at: ago(72 * day),
    createdAt: ago(72 * day),
    end_date: new Date(now() + 40 * day),
    lastClipAt: ago(2 * day),
  },
  {
    ...baseCampaign,
    id: "camp_nyne",
    title: "Nyne AI x Atomik Clips",
    description:
      "Short-form cuts from the Nyne AI podcast. US-heavy audiences earn a geo bonus on top of the base rate.",
    imageUrl: "",
    platforms: ["youtube", "instagram"],
    budget: 8000,
    min_payout: 5,
    max_payout: 300,
    youtube_per_1000: 0.2,
    insta_per_1000: 0.2,
    x_per_1000: 0.15,
    tiktok_per_1000: 0.15,
    ratePerThousand: 0.2,
    achievementPercentage: 62,
    totalViews: 2_004_112,
    submissionCount: 96,
    totalSubmissions: 96,
    created_at: ago(30 * day),
    createdAt: ago(30 * day),
    end_date: new Date(now() + 55 * day),
    lastClipAt: ago(day),
  },
  {
    ...baseCampaign,
    id: "camp_slash",
    title: "Slash x Atomik Growth",
    description:
      "Finished campaign. Kept here so the ended state has something to render.",
    imageUrl: "",
    platforms: ["youtube", "instagram", "x"],
    active: false,
    ended: true,
    budget: 5000,
    min_payout: 5,
    max_payout: 250,
    youtube_per_1000: 0.25,
    insta_per_1000: 0.2,
    x_per_1000: 0.2,
    tiktok_per_1000: 0.2,
    ratePerThousand: 0.25,
    achievementPercentage: 100,
    totalViews: 1_337_500,
    submissionCount: 148,
    totalSubmissions: 148,
    created_at: ago(170 * day),
    createdAt: ago(170 * day),
    end_date: ago(52 * day),
    lastClipAt: ago(52 * day),
  },
];

// ── mutable state ────────────────────────────────────────────────────────────

export type DemoSubmission = {
  id: string;
  campaignId: string;
  campaignTitle: string;
  platform: string;
  url: string;
  handle: string;
  verifiedUserId: string;
  submittedAtMs: number;
  /** Set only when a reviewer (or the demo) forces a terminal state. */
  forcedStatus?: "approved" | "rejected";
  rejectedReason?: string | null;
  maxViewCap?: number | null;
  seedViews?: number;
};

export type DemoAccount = {
  id: string;
  platform: "youtube" | "instagram" | "tiktok" | "x";
  handle: string;
  created_at: Date;
  login_creds_email?: string | null;
  login_creds_password?: string | null;
  login_cred_forwarding_email?: string | null;
  usPercentage: number;
};

export type DemoState = {
  accounts: DemoAccount[];
  submissions: DemoSubmission[];
  /** Campaign ids whose demographics ask has been satisfied. */
  demographicsSubmitted: string[];
  claimedTotal: number;
  phoneNumber: string | null;
  phoneCountryCode: string | null;
  dismissedAnnouncements: string[];
};

const seed = (): DemoState => ({
  accounts: [
    {
      id: "acc_yt_1",
      platform: "youtube",
      handle: "businesstalk023",
      created_at: ago(120 * day),
      login_creds_email: "businesstalk023@gmail.com",
      login_creds_password: "demo-password-not-real",
      login_cred_forwarding_email: "shree199@example.com",
      usPercentage: 30.6,
    },
    {
      id: "acc_yt_2",
      platform: "youtube",
      handle: "f.business",
      created_at: ago(95 * day),
      usPercentage: 13.2,
    },
    {
      id: "acc_ig_1",
      platform: "instagram",
      handle: "fintechbreakdown2",
      created_at: ago(60 * day),
      usPercentage: 24.1,
    },
  ],
  submissions: [
    {
      id: "sub_seed_1",
      campaignId: "camp_airwallex",
      campaignTitle: "Airwallex x Atomik Clips",
      platform: "youtube",
      url: "https://youtube.com/shorts/demo1",
      handle: "businesstalk023",
      verifiedUserId: "acc_yt_1",
      submittedAtMs: now() - 6 * day,
      forcedStatus: "approved",
      seedViews: 24_180,
    },
    {
      id: "sub_seed_2",
      campaignId: "camp_airwallex",
      campaignTitle: "Airwallex x Atomik Clips",
      platform: "instagram",
      url: "https://instagram.com/reel/demo2",
      handle: "fintechbreakdown2",
      verifiedUserId: "acc_ig_1",
      submittedAtMs: now() - 3 * day,
      forcedStatus: "approved",
      seedViews: 12_940,
    },
    {
      id: "sub_seed_3",
      campaignId: "camp_nyne",
      campaignTitle: "Nyne AI x Atomik Clips",
      platform: "youtube",
      url: "https://youtube.com/shorts/demo3",
      handle: "f.business",
      verifiedUserId: "acc_yt_2",
      submittedAtMs: now() - 30 * 60 * 1000,
    },
    {
      id: "sub_seed_4",
      campaignId: "camp_slash",
      campaignTitle: "Slash x Atomik Growth",
      platform: "youtube",
      url: "https://youtube.com/shorts/demo4",
      handle: "businesstalk023",
      verifiedUserId: "acc_yt_1",
      submittedAtMs: now() - 60 * day,
      forcedStatus: "rejected",
      rejectedReason: "Clip was longer than the 60 second limit for this campaign.",
    },
  ],
  demographicsSubmitted: [],
  claimedTotal: 0,
  phoneNumber: null,
  phoneCountryCode: null,
  dismissedAnnouncements: [],
});

let state: DemoState = load();

function load(): DemoState {
  try {
    const raw = window.localStorage.getItem(DEMO_KEY);
    if (!raw) return seed();
    const parsed = JSON.parse(raw) as DemoState;
    // Dates do not survive JSON. Rehydrate the ones the UI formats.
    parsed.accounts = (parsed.accounts ?? []).map((a) => ({
      ...a,
      created_at: new Date(a.created_at),
    }));
    return { ...seed(), ...parsed };
  } catch {
    return seed();
  }
}

function persist() {
  try {
    window.localStorage.setItem(DEMO_KEY, JSON.stringify(state));
  } catch {
    /* private browsing — demo still works, just does not survive reload */
  }
}

export const getState = () => state;

export const setState = (fn: (s: DemoState) => void) => {
  fn(state);
  persist();
};

export const resetDemo = () => {
  state = seed();
  persist();
  window.location.reload();
};

// ── derived: a submission's status and views are functions of elapsed time ────

const APPROVE_AFTER_MS = 25_000;

export const statusOf = (s: DemoSubmission) => {
  if (s.forcedStatus) return s.forcedStatus;
  return now() - s.submittedAtMs > APPROVE_AFTER_MS ? "approved" : "pending";
};

/**
 * Views climb on a decaying curve — fast for the first day, then flattening,
 * which is roughly how a short actually behaves. Deterministic, so two
 * components rendering the same clip never disagree.
 */
export const viewsOf = (s: DemoSubmission) => {
  if (statusOf(s) !== "approved") return 0;
  if (s.seedViews != null) {
    const extraHours = Math.max(
      0,
      (now() - s.submittedAtMs) / 3_600_000 - 24
    );
    return Math.round(s.seedViews + extraHours * 140);
  }
  const hours = Math.max(0, (now() - s.submittedAtMs - APPROVE_AFTER_MS) / 3_600_000);
  return Math.round(9000 * (1 - Math.exp(-hours / 8)) + hours * 60);
};

export const rateFor = (campaignId: string, platform: string) => {
  const c = CAMPAIGNS.find((x) => x.id === campaignId);
  if (!c) return 0.2;
  const key = (
    {
      youtube: "youtube_per_1000",
      instagram: "insta_per_1000",
      tiktok: "tiktok_per_1000",
      x: "x_per_1000",
    } as Record<string, keyof typeof c>
  )[platform];
  return (key ? (c[key] as number) : c.ratePerThousand) ?? 0.2;
};

export const earnedOf = (s: DemoSubmission) =>
  (viewsOf(s) / 1000) * rateFor(s.campaignId, s.platform);

export const totalEarned = () =>
  state.submissions.reduce((sum, s) => sum + earnedOf(s), 0);

export const claimable = () =>
  Math.max(0, totalEarned() - state.claimedTotal);

/** The campaigns this clipper is in — defined by having submitted to them. */
export const myCampaignIds = () => [
  ...new Set(state.submissions.map((s) => s.campaignId)),
];

export const accountById = (id: string) =>
  state.accounts.find((a) => a.id === id);

export const campaignById = (id: string) =>
  CAMPAIGNS.find((c) => c.id === id);

export const newId = (prefix: string) =>
  `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
ATOMIK_EOF

echo "writing src/lib/demo/demoHandlers.ts"
mkdir -p "src/lib/demo"
cat > src/lib/demo/demoHandlers.ts << 'ATOMIK_EOF'
import {
  CAMPAIGNS,
  DEMO_USER,
  accountById,
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
  "submissions.getRedemptionProgress": () => pause(null),
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

  // Submitting is also how a clipper JOINS — there is no campaigns.join
  // procedure anywhere in this app. Membership is derived from having
  // submitted, which is what rewards.getMyCampaignRewards reflects.
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
    pause({ code: "atomik-verify-demo-4417" }, 500),
  "verification.verifyUserBio": (input: any) => {
    const created = {
      id: newId("acc"),
      platform: (input?.platform ?? "youtube") as any,
      handle: (input?.handle ?? "new_channel").replace(/^@/, ""),
      created_at: new Date(),
      usPercentage: 21.4,
    };
    setState((s) => {
      s.accounts.push(created);
    });
    return pause({ success: true, account: created }, 700);
  },
  "verification.verifyLoginCredentials": (input: any) => {
    const created = {
      id: newId("acc"),
      platform: (input?.platform ?? "youtube") as any,
      handle: (input?.handle ?? "new_channel").replace(/^@/, ""),
      created_at: new Date(),
      login_creds_email: input?.email ?? null,
      login_creds_password: input?.password ?? null,
      usPercentage: 18.9,
    };
    setState((s) => {
      s.accounts.push(created);
    });
    return pause({ success: true, account: created }, 700);
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
};
ATOMIK_EOF

echo "writing src/lib/demo/demoLink.ts"
mkdir -p "src/lib/demo"
cat > src/lib/demo/demoLink.ts << 'ATOMIK_EOF'
import { TRPCClientError, type TRPCLink } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import type { AppRouter } from "../../../../backend/src/routers";
import { HANDLERS } from "./demoHandlers";

export const DEMO_MODE = import.meta.env.VITE_DEMO === "true";

/**
 * Every path the app asked for that has no handler. Read it in the console
 * with `__DEMO_MISSING__` — that list is exactly what needs adding to
 * demoHandlers.ts to extend coverage to another screen.
 */
const missing = new Set<string>();

declare global {
  // eslint-disable-next-line no-var
  var __DEMO_MISSING__: string[];
}

const recordMissing = (path: string) => {
  if (missing.has(path)) return;
  missing.add(path);
  globalThis.__DEMO_MISSING__ = [...missing].sort();
  // eslint-disable-next-line no-console
  console.warn(
    `[demo] no handler for "${path}" — returning null. ` +
      `Full list so far in __DEMO_MISSING__`
  );
};

/**
 * Short-circuits every tRPC call in demo mode, so no page, hook or component
 * needs to know the backend is absent.
 *
 * An unmocked path resolves to null rather than throwing. A thrown error would
 * surface as a red toast or an error boundary and break the walkthrough; null
 * lets components fall through to their own empty states, which is what the
 * ~20 unfixtured admin screens will do.
 */
export function demoLink(): TRPCLink<AppRouter> {
  return () =>
    ({ op }) =>
      observable((observer) => {
        const handler = HANDLERS[op.path];

        if (!handler) {
          recordMissing(op.path);
          observer.next({ result: { type: "data", data: null } });
          observer.complete();
          return;
        }

        let cancelled = false;
        Promise.resolve()
          .then(() => handler(op.input as any))
          .then((data) => {
            if (cancelled) return;
            observer.next({ result: { type: "data", data } });
            observer.complete();
          })
          .catch((error) => {
            if (cancelled) return;
            observer.error(TRPCClientError.from(error as Error));
          });

        return () => {
          cancelled = true;
        };
      });
}
ATOMIK_EOF

echo "writing src/lib/trpc.ts"
mkdir -p "src/lib"
cat > src/lib/trpc.ts << 'ATOMIK_EOF'
import { createTRPCReact } from "@trpc/react-query";
import { httpLink } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "../../../backend/src/routers";
import { useAuth } from "@clerk/clerk-react";
import { env } from "./env";
import { DEMO_MODE, demoLink } from "./demo/demoLink";

export const trpc = createTRPCReact<AppRouter>();

// In demo mode demoLink is terminating — it never calls next(), so the http
// link below it is never reached and no request leaves the browser. Outside
// demo mode the array is just the http link, exactly as before.
const linksFor = (http: ReturnType<typeof httpLink>) =>
  DEMO_MODE ? [demoLink(), http] : [http];

export const trpcClient = trpc.createClient({
  links: linksFor(
    httpLink({
      url: env.VITE_TRPC_URL,
      fetch(url, options) {
        return fetch(url, {
          ...options,
          credentials: "include",
        });
      },
    })
  ),
  transformer: superjson,
});

// Hook to create tRPC client with Clerk authentication
export const useAuthenticatedTrpcClient = () => {
  const { getToken } = useAuth();

  return trpc.createClient({
    links: linksFor(
      httpLink({
        url: env.VITE_TRPC_URL,
        async fetch(url, options) {
          const token = await getToken();

          return fetch(url, {
            ...options,
            headers: {
              ...options?.headers,
              ...(token && { Authorization: `Bearer ${token}` }),
            },
            credentials: "include",
          });
        },
      })
    ),
    transformer: superjson,
  });
};
ATOMIK_EOF

echo "writing src/components/DemoBanner.tsx"
mkdir -p "src/components"
cat > src/components/DemoBanner.tsx << 'ATOMIK_EOF'
import { DEMO_MODE } from "@/lib/demo/demoLink";
import { resetDemo } from "@/lib/demo/demoData";
import { RotateCcw } from "lucide-react";

/**
 * A thin strip so nobody mistakes the walkthrough for live data, plus the
 * reset that puts the fixtures back — needed between demos, since submitting
 * clips and verifying channels persists to localStorage on purpose.
 */
export const DemoBanner = () => {
  if (!DEMO_MODE) return null;

  return (
    <div className="flex items-center justify-center gap-3 border-b border-border/60 bg-muted/40 px-4 py-1.5">
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        Demo mode · sample data · nothing is saved to a server
      </span>
      <button
        type="button"
        onClick={resetDemo}
        className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground"
      >
        <RotateCcw className="h-3 w-3" />
        Reset
      </button>
    </div>
  );
};

export default DemoBanner;
ATOMIK_EOF

echo "writing src/components/AppLayout.tsx"
mkdir -p "src/components"
cat > src/components/AppLayout.tsx << 'ATOMIK_EOF'
import { ReactNode, createContext, useContext } from "react";
import { DemoBanner } from "./DemoBanner";
import { TopNav } from "./TopNav";

interface AppLayoutProps {
  children: ReactNode;
}

// Every clipper page wraps ITSELF in <AppLayout>. That is fine while each one
// owns a route, but the single-page dashboard renders those same pages as
// sections — which would nest a top bar and a <main> inside another one.
// Rather than strip the wrapper out of seven large pages (and risk breaking
// their standalone routes, which still need to work for deep links), a nested
// AppLayout detects the outer one and renders its children bare.
const InsideAppLayout = createContext(false);

// True when this page is being rendered as a SECTION of another page rather
// than as its own route. A page that redirects on mount must check this: the
// dashboard stacks whole pages inline, so an unguarded redirect fires while the
// user is on "/" and drags the entire app to that page's route.
export const useInsideAppLayout = () => useContext(InsideAppLayout);

/**
 * THE SIDEBAR IS GONE.
 *
 * It used to render for staff only (`roles.length > 0`), so clippers already
 * saw nothing but this bar — worth knowing, because the confusion the client
 * reported can only have come from a staff or dev account. Either way it is
 * removed for everyone now, and TopNav carries navigation instead: four links
 * inline, the rest behind a menu, the admin tree behind its own.
 *
 * Removed with it: SidebarProvider, AppSidebar, MobileFloatingNav, and the
 * open/showSidebar state that existed only to drive them. AppSidebar.tsx and
 * MobileFloatingNav.tsx are now unreferenced and can be deleted; the nav model
 * they held lives in lib/navItems.ts.
 */
export function AppLayout({ children }: AppLayoutProps) {
  const nested = useContext(InsideAppLayout);

  if (nested) {
    return <>{children}</>;
  }

  return (
    <InsideAppLayout.Provider value={true}>
      <div className="flex min-h-screen w-full flex-col">
        <DemoBanner />
        <TopNav />
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </InsideAppLayout.Provider>
  );
}
ATOMIK_EOF


# Turn demo mode on without clobbering an existing .env.local
touch .env.local
if grep -q '^VITE_DEMO=' .env.local; then
  echo "VITE_DEMO already set in .env.local — leaving it alone"
else
  echo "VITE_DEMO=true" >> .env.local
  echo "added VITE_DEMO=true to .env.local"
fi
echo

echo "--- verify (each should print OK) ---"
check () { if grep -q "$2" "$1" 2>/dev/null; then echo "OK    $1"; else echo "FAIL  $1"; fi; }
check src/lib/demo/demoData.ts      "export const CAMPAIGNS"
check src/lib/demo/demoHandlers.ts  "submissions.createSubmission"
check src/lib/demo/demoLink.ts      "export function demoLink"
check src/lib/trpc.ts               "DEMO_MODE ? \[demoLink()"
check src/components/DemoBanner.tsx "Demo mode"
check src/components/AppLayout.tsx  "<DemoBanner />"
echo
echo "handlers wired: $(grep -c '": (input' src/lib/demo/demoHandlers.ts || true) with input, plus no-arg ones"
echo
echo "RESTART REQUIRED (.env.local changed):"
echo "  rm -rf node_modules/.vite && pnpm dev"
echo
echo "To switch demo mode off again: remove VITE_DEMO from .env.local and restart."
