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
    imageUrl: "https://picsum.photos/seed/atomik-airwallex/1600/900",
    platforms: "youtube,instagram,tiktok",
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
    imageUrl: "https://picsum.photos/seed/atomik-nyne/1600/900",
    platforms: "youtube,instagram",
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
    id: "camp_parloa",
    title: "Parloa x Atomik Clips",
    description:
      "We are promoting Parloa by distributing high-performing short-form clips across social platforms.",
    imageUrl: "https://picsum.photos/seed/atomik-parloa/1600/900",
    platforms: "youtube,instagram",
    visibility: "private",
    // Teaser values — what an UNapproved clipper sees. Once the application is
    // approved, myUnlockedCampaigns overlays the real numbers on top, which is
    // exactly how the private flow works in the real app.
    private_show_rates: false,
    private_show_budget: false,
    private_show_description: true,
    budget: 0,
    min_payout: 0,
    max_payout: 0,
    youtube_per_1000: 0,
    insta_per_1000: 0,
    x_per_1000: 0,
    tiktok_per_1000: 0,
    ratePerThousand: 0,
    youtube_min_views: 1500,
    insta_min_views: 1500,
    achievementPercentage: 0,
    totalViews: 0,
    submissionCount: 0,
    totalSubmissions: 0,
    created_at: ago(2 * day),
    createdAt: ago(2 * day),
    end_date: new Date(now() + 60 * day),
    lastClipAt: null,
  },
  {
    ...baseCampaign,
    id: "camp_slash",
    title: "Slash x Atomik Growth",
    description:
      "Finished campaign. Kept here so the ended state has something to render.",
    imageUrl: "https://picsum.photos/seed/atomik-slash/1600/900",
    platforms: "youtube,instagram,x",
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
  /** campaignId -> when the private application was submitted. */
  applications: Record<string, number>;
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
  applications: {},
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

// A private application approves itself after a beat so the demo can walk
// straight through pending -> approved without a moderator.
const APPLICATION_APPROVE_AFTER_MS = 20_000;

export const applicationStatusOf = (campaignId: string) => {
  const at = state.applications[campaignId];
  if (at == null) return null;
  return now() - at > APPLICATION_APPROVE_AFTER_MS ? "approved" : "pending";
};

/** The real rates a private campaign reveals once you are approved. */
export const UNLOCKED_PRIVATE: Record<string, Record<string, unknown>> = {
  camp_parloa: {
    title: "Parloa x Atomik Clips",
    imageUrl: "https://picsum.photos/seed/atomik-c4/1600/900",
    budget: 9000,
    min_payout: 5,
    max_payout: 350,
    insta_per_1000: 0.28,
    x_per_1000: 0.2,
    youtube_per_1000: 0.35,
    tiktok_per_1000: 0.25,
    youtube_min_views: 1500,
    insta_min_views: 1500,
    x_min_views: 1500,
    tiktok_min_views: 1500,
    achievementPercentage: 12,
  },
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
