import {
  bigint,
  boolean,
  date,
  decimal,
  float,
  foreignKey,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";
import { relations, sql } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";

const channelEnumValues = [
  "welcome_channel_id",
  "leaderboard_channel_id",
  "live_stats_channel_id",
  "your_account_channel_id",
  "user_commands_channel_id",
  "demographics_verification_channel_id",
  "admin_commands_channel_id",
  "admin_role_id",
  "staff_role_id",
  "verified_role_id",
  "campaign_staff_review_channel_id",
  "clip_submissions_channel_id",
  "user_registrations_channel_id",
  "past_campaigns_channel_id",
  "demographics_staff_review_channel_id",
] as const;

export const channel_enum = mysqlEnum("channel_enum", channelEnumValues);
export type TChannelEnum = (typeof channelEnumValues)[number];

export const guild_settings = mysqlTable("guild_settings", {
  id: varchar({ length: 128 })
    .$defaultFn(() => createId())
    .primaryKey(),
  guild_id: varchar("guild_id", { length: 50 }).notNull(),
  channel_enum: channel_enum.notNull(),
  channel_id: varchar("channel_id", { length: 50 }).notNull().unique(),
  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type TGuildSettings = typeof guild_settings.$inferSelect;

// export const users = mysqlTable(
//   'users',
//   {
//     id: varchar({ length: 128 })
//       .$defaultFn(() => createId())
//       .primaryKey(),
//     discord_id: varchar('discord_id', { length: 50 }).notNull().unique(),
//     username: varchar('username', { length: 100 }).notNull(),
//     paypal: varchar('paypal', { length: 255 }),
//     upi: varchar('upi', { length: 255 }),
//     created_at: timestamp('created_at').notNull().defaultNow(),
//   },
//   (table) => [uniqueIndex('users_discord_id_idx').on(table.discord_id)]
// );

export const verified_users = mysqlTable(
  "verified_users",
  {
    id: varchar({ length: 128 })
      .$defaultFn(() => createId())
      .primaryKey(),
    discord_id: varchar("discord_id", { length: 50 }).notNull(),
    guild_id: varchar("guild_id", { length: 50 }).notNull(),
    username: varchar("username", { length: 100 }).notNull(),
    platform: varchar("platform", { length: 255 }).notNull(),
    handle: varchar("handle", { length: 100 }).notNull(),
    verify_code: varchar("verify_code", { length: 20 }).notNull(),
    verified: boolean("verified").default(false),
    verified_login_credentials_id: varchar("verified_login_credentials_id", {
      length: 128,
    }),
    // Stable, rename-proof platform account ID (Feature 0). The @handle above
    // changes when a user renames; THIS does not. Captured at link time and
    // from the view cron's API responses, backfilled for existing rows.
    //   youtube  -> channelId (UC...)        instagram -> numeric user pk
    //   tiktok   -> numeric user id          x         -> user rest_id
    platform_account_id: varchar("platform_account_id", { length: 255 }),
    // Secondary stable id where a platform has two (TikTok secUid — long).
    platform_account_secondary_id: varchar("platform_account_secondary_id", {
      length: 512,
    }),
    platform_account_id_resolved_at: timestamp(
      "platform_account_id_resolved_at"
    ),
    // Account-level deletion/ban tracking (Feature 2). Strikes increment on
    // consecutive "profile gone" reads; account_deleted_at is set once the
    // strike threshold is hit. Cleared on manual revert.
    account_unavailable_strikes: int("account_unavailable_strikes")
      .notNull()
      .default(0),
    account_deleted_at: timestamp("account_deleted_at"),
    account_last_checked_at: timestamp("account_last_checked_at"),
    deleted_at: timestamp("deleted_at"),
    created_at: timestamp("created_at").notNull().defaultNow(),
    updated_at: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("verified_users_guild_discord_platform_idx").on(
      table.guild_id,
      table.discord_id,
      table.platform,
      table.handle
    ),
    index("verified_users_discord_platform_idx").on(
      table.discord_id,
      table.platform
    ),
    // Drives the one-account-rule lookup + stable-ID duplicate detection.
    index("verified_users_platform_account_id_idx").on(
      table.platform,
      table.platform_account_id
    ),
  ]
);

export const verified_login_credentials = mysqlTable(
  "verified_login_credentials",
  {
    id: varchar({ length: 128 })
      .$defaultFn(() => createId())
      .primaryKey(),
    user_id: varchar("user_id", { length: 255 }).notNull(),
    email: varchar("email", { length: 255 }),
    password: varchar("password", { length: 255 }),
    // Mod-generated forwarders get one password per platform the alias will
    // be used to register on; real clipper credentials keep using `password`.
    youtube_password: varchar("youtube_password", { length: 255 }),
    instagram_password: varchar("instagram_password", { length: 255 }),
    // Free-text label a mod attaches to a generated batch ("client X drop").
    mod_alias_tag: varchar("mod_alias_tag", { length: 100 }),
    platform: varchar("platform", { length: 255 }).notNull(),
    handle: varchar("handle", { length: 100 }).notNull(),
    forwarding_email: varchar("forwarding_email", { length: 255 }),
    login_creds_manually_verified_at: timestamp(
      "login_creds_manually_verified_at"
    ),
    verification_method: mysqlEnum("verification_method", [
      "login-flow",
      "manual",
    ])
      .notNull()
      .default("login-flow"),
    verified_at: timestamp("verified_at"),
    created_at: timestamp("created_at").notNull().defaultNow(),
    updated_at: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("vlc_email_idx").on(table.email),
    index("verified_login_credentials_platform_handle_idx").on(
      table.platform,
      table.user_id,
      table.email
    ),
  ]
);

export const banned_users = mysqlTable(
  "banned_users",
  {
    id: varchar({ length: 128 })
      .$defaultFn(() => createId())
      .primaryKey(),
    user_id: varchar("user_id", { length: 255 }).notNull(),
    reason: text("reason"),
    created_by: varchar("created_by", { length: 255 }),
    created_at: timestamp("created_at").notNull().defaultNow(),
    updated_at: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex("banned_users_user_id_idx").on(table.user_id)]
);

export const banned_social_media_users = mysqlTable(
  "banned_social_media_users",
  {
    id: varchar({ length: 128 })
      .$defaultFn(() => createId())
      .primaryKey(),
    platform: varchar("platform", { length: 255 }).notNull(),
    handle: varchar("handle", { length: 255 }).notNull(),
    reason: text("reason"),
    created_by: varchar("created_by", { length: 255 }),
    created_at: timestamp("created_at").notNull().defaultNow(),
    updated_at: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("banned_social_media_users_platform_handle_idx").on(
      table.platform,
      table.handle
    ),
  ]
);

// Per-campaign suspension (distinct from the platform-wide banned_users).
// A clipper who stops posting for a full Mon–Sun week during a campaign can be
// manually suspended from THAT campaign only. `inactive_week_start/end` record
// which week's inactivity triggered it (audit). A row is "active" while
// unsuspended_at IS NULL; the submissions router blocks new submissions for the
// campaign while an active suspension exists.
export const campaign_suspensions = mysqlTable(
  "campaign_suspensions",
  {
    id: varchar({ length: 128 })
      .$defaultFn(() => createId())
      .primaryKey(),
    campaign_id: varchar("campaign_id", { length: 255 }).notNull(),
    user_id: varchar("user_id", { length: 255 }).notNull(),
    reason: text("reason"),
    inactive_week_start: timestamp("inactive_week_start"),
    inactive_week_end: timestamp("inactive_week_end"),
    suspended_by: varchar("suspended_by", { length: 255 }),
    unsuspended_at: timestamp("unsuspended_at"),
    unsuspended_by: varchar("unsuspended_by", { length: 255 }),
    created_at: timestamp("created_at").notNull().defaultNow(),
    updated_at: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("campaign_suspensions_campaign_idx").on(table.campaign_id),
    index("campaign_suspensions_user_idx").on(table.user_id),
    index("campaign_suspensions_campaign_user_idx").on(
      table.campaign_id,
      table.user_id
    ),
  ]
);

// One-week inactivity grace: instead of suspending an inactive clipper, a mod
// can grant one more week. While a grace is active (expires_at > now) the
// clipper is not flagged as suspendable in the Clipper Activity panel, and
// they get a "last warning" notification. If they still post nothing by the
// time it expires, they show up as suspendable again.
export const campaign_activity_graces = mysqlTable(
  "campaign_activity_graces",
  {
    id: varchar({ length: 128 })
      .$defaultFn(() => createId())
      .primaryKey(),
    campaign_id: varchar("campaign_id", { length: 255 }).notNull(),
    user_id: varchar("user_id", { length: 255 }).notNull(),
    // The inactive week being forgiven (audit trail, mirrors
    // campaign_suspensions.inactive_week_*).
    inactive_week_start: timestamp("inactive_week_start"),
    inactive_week_end: timestamp("inactive_week_end"),
    // End of the grace window — start of the week after the current one.
    expires_at: timestamp("expires_at").notNull(),
    granted_by: varchar("granted_by", { length: 255 }).notNull(),
    note: text("note"),
    created_at: timestamp("created_at").notNull().defaultNow(),
    updated_at: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("campaign_activity_graces_campaign_user_idx").on(
      table.campaign_id,
      table.user_id
    ),
    index("campaign_activity_graces_expires_idx").on(table.expires_at),
  ]
);

export type TCampaignActivityGrace =
  typeof campaign_activity_graces.$inferSelect;

// A clipper's application to join a private campaign. One row per
// (campaign, clipper); re-applying after a rejection resets the same row back
// to pending. The verified accounts they'll clip from live in
// campaign_application_accounts.
export const campaign_applications = mysqlTable(
  "campaign_applications",
  {
    id: varchar({ length: 128 })
      .$defaultFn(() => createId())
      .primaryKey(),
    campaign_id: varchar("campaign_id", { length: 255 }).notNull(),
    user_id: varchar("user_id", { length: 255 }).notNull(),
    status: varchar("status", { length: 20 }).notNull().default("pending"), // pending | approved | rejected
    reviewed_by: varchar("reviewed_by", { length: 255 }),
    reviewed_at: timestamp("reviewed_at"),
    rejected_reason: text("rejected_reason"),
    // How the approved clipper got into the campaign's private Discord
    // server. "oauth" = the bot added them directly via the guilds.join
    // scope (nothing to leak). "invite" = single-use, 7-day invite link
    // stored below as the fallback.
    discord_join_method: varchar("discord_join_method", { length: 20 }),
    discord_invite_url: text("discord_invite_url"),
    discord_joined_at: timestamp("discord_joined_at"),
    // Re-application history. Re-applying resets this same row back to
    // pending, which used to erase the previous verdict — these preserve it
    // so a reviewing mod can see it's a repeat applicant and why they were
    // turned down before.
    apply_count: int("apply_count").notNull().default(1),
    last_rejected_reason: text("last_rejected_reason"),
    last_rejected_at: timestamp("last_rejected_at"),
    created_at: timestamp("created_at").notNull().defaultNow(),
    updated_at: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("campaign_applications_campaign_user_idx").on(
      table.campaign_id,
      table.user_id
    ),
    index("campaign_applications_campaign_status_idx").on(
      table.campaign_id,
      table.status
    ),
    index("campaign_applications_user_idx").on(table.user_id),
  ]
);

export type TCampaignApplication = typeof campaign_applications.$inferSelect;

// The verified accounts a clipper committed to clipping from in their
// application. Submissions to the private campaign are restricted to these
// accounts once approved.
export const campaign_application_accounts = mysqlTable(
  "campaign_application_accounts",
  {
    id: varchar({ length: 128 })
      .$defaultFn(() => createId())
      .primaryKey(),
    application_id: varchar("application_id", { length: 128 }).notNull(),
    verified_user_id: varchar("verified_user_id", { length: 128 }).notNull(),
    created_at: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("campaign_application_accounts_app_account_idx").on(
      table.application_id,
      table.verified_user_id
    ),
    index("campaign_application_accounts_app_idx").on(table.application_id),
  ]
);

export type TCampaignApplicationAccount =
  typeof campaign_application_accounts.$inferSelect;

export const campaigns = mysqlTable(
  "campaigns",
  {
    id: varchar({ length: 128 })
      .$defaultFn(() => createId())
      .primaryKey(),
    guild_id: varchar("guild_id", { length: 50 }).notNull(),
    title: varchar("title", { length: 255 }),
    clips: text("clips"),
    budget: int("budget").default(0).notNull(),
    external_budget: int("external_budget").default(0).notNull(),
    external_password: varchar("external_password", { length: 255 }),
    allowed_verification_methods: json("allowed_verification_methods")
      .$type<("login-flow" | "manual" | "OTP")[]>()
      .notNull()
      .default(["OTP", "login-flow", "manual"]),
    cpm: float("cpm").default(0).notNull(),
    imageUrl: text("image_url"),
    description: text("description"),
    sopEmbedUrl: text("sop_embed_url"),
    max_payout: float("max_payout"),
    min_payout: float("min_payout").default(0).notNull(),
    // Per-clip reward floor, per platform: a clip below this many views counts
    // as 0 views for reward purposes (it stays live, it just doesn't pay)
    // until it crosses the floor. 0 = no floor. Defaults preserve the
    // historical hardcoded behavior: 1500 for YT/IG/X, none for TikTok.
    youtube_min_views: int("youtube_min_views").default(1500).notNull(),
    insta_min_views: int("insta_min_views").default(1500).notNull(),
    x_min_views: int("x_min_views").default(1500).notNull(),
    tiktok_min_views: int("tiktok_min_views").default(0).notNull(),
    // How clippers get paid, shown on the campaign card ("bank" | "crypto" |
    // "paypal"). Display-only — does not gate the actual payout rails.
    // Null/empty = the card shows no payment-methods row.
    payment_methods: json("payment_methods").$type<string[] | null>(),
    views: int("views").default(0),
    active: boolean("active").default(true),
    // Pause switch for NEW submissions only: when true the campaign stays
    // live (views + payouts on existing clips keep flowing) but
    // createSubmission rejects any new clip for this campaign.
    submissions_paused: boolean("submissions_paused").notNull().default(false),
    channel_id: varchar("channel_id", { length: 50 }).notNull(),
    sheet_id: varchar("sheet_id", { length: 255 }),
    achieved: float("achieved").default(0),
    ended: boolean("ended").default(false),
    excel_link: text("excel_link"),
    demographics_json: json("demographics_json"),
    demographicsVisibleCountries: json("demographics_visible_countries").$type<
      string[] | null
    >(),
    demographicsVerificationEnabled: boolean(
      "demographics_verification_enabled"
    )
      .notNull()
      .default(false),
    // Campaign demographics rollup method. false (default) = NEW method:
    // the "Other" (uncalculated) audience bucket stays in the denominator,
    // so named countries reflect their real share. true = OLD method:
    // "Other" is dropped and the named countries are re-normalized to 100%,
    // which inflates every named country (incl. US). Toggled per campaign
    // from the "US Demographics" admin panel.
    demographics_use_old_method: boolean("demographics_use_old_method")
      .notNull()
      .default(false),
    // Screen-recording window a clipper must show in their analytics when
    // verifying demographics: 7, 28, or 90 days (the buckets every platform
    // actually offers). NULL = no specific window (existing behaviour — the
    // API pulls the campaign lifetime and the manual flow shows no period).
    demographics_recording_period_days: int(
      "demographics_recording_period_days"
    ),
    // ── Demographics qualification threshold ──
    // A clipper is only asked for — and only allowed to submit — demographics
    // on this campaign once their COMBINED views across every account they ran
    // here reach this number. Combined, not per account: a clipper running
    // three accounts that add up to the threshold qualifies, and then reports
    // on all three separately as usual.
    //
    // Distinct from min_payout (the combined-views gate on EARNING) and from
    // the per-platform *_min_views (per-clip floors). Kept separate so a
    // moderator can demand verification at a different point from where money
    // starts, in either direction, without one silently moving the other.
    //
    // 0 = no threshold, which is the default and the existing behaviour: every
    // participating clipper is asked as soon as the request opens.
    demographics_min_views: int("demographics_min_views")
      .default(0)
      .notNull(),
    insta_per_1000: float("insta_per_1000").default(0).notNull(),
    x_per_1000: float("x_per_1000").default(0).notNull(),
    youtube_per_1000: float("youtube_per_1000").default(0).notNull(),
    tiktok_per_1000: float("tiktok_per_1000").default(0).notNull(),
    referalPercentage: float("referal-percentage").default(5).notNull(),
    maxReferalBonus: float("max-referal-bonus").default(50).notNull(),
    platforms: varchar("platforms", { length: 255 }),
    verify_demography: varchar("verify_demography", { length: 255 }).default(
      "No"
    ),
    is_hot_streak_enabled: boolean("is_hot_streak_enabled").default(false),
    // Weekly clipper-activity tracking (Clipper Activity admin panel +
    // inactivity suspensions/graces). Off = this campaign doesn't require
    // clippers to stay active week to week: hidden from the panel, no new
    // suspensions or graces, and existing suspensions stop blocking
    // submissions. Default on preserves the original all-campaigns behavior.
    clipper_activity_enabled: boolean("clipper_activity_enabled")
      .notNull()
      .default(true),
    // Non-campaign-clip RATIO. The clipper must post `non_campaign_clips_required`
    // non-campaign clips for every `non_campaign_clips_per` campaign clips,
    // submitted together as one batch.
    //   - non_campaign_clips_required = numerator (how many non-campaign clips)
    //   - non_campaign_clips_per      = denominator (per how many campaign clips)
    // NULL/0 numerator = disabled (legacy campaigns). Denominator defaults to 1,
    // which reproduces the old "N non-campaign clips per single campaign clip"
    // behavior. Example "1 non-campaign per 3 campaign" => required=1, per=3.
    non_campaign_clips_required: int("non_campaign_clips_required"),
    non_campaign_clips_per: int("non_campaign_clips_per").default(1),
    // Soft-delete of the campaign CARD only — NOT the campaign or its data.
    // When set, the card is hidden from all listings, but the campaign and
    // every submission / reward / clip tied to it stay fully intact and
    // functional. Recoverable from the "Recover deleted campaign cards" panel.
    card_deleted_at: timestamp("card_deleted_at"),
    card_deleted_by: varchar("card_deleted_by", { length: 255 }),
    // Manually-entered campaign end date (Feature 4). Distinct from the `ended`
    // boolean: this is the date the campaign is considered over, after which we
    // watch its clips for deletion for 3 months (reels must stay up that long).
    end_date: timestamp("end_date"),
    // ── Private campaigns ──
    // "public" (default) keeps today's behavior: anyone can submit clips.
    // "private" turns the card into a teaser: clippers must apply with the
    // verified accounts they'll clip from and be approved by a mod before
    // they can submit. The private_show_* flags control which details the
    // teaser reveals to clippers who aren't approved yet (name + image are
    // always shown).
    visibility: varchar("visibility", { length: 20 })
      .notNull()
      .default("public"),
    private_show_budget: boolean("private_show_budget")
      .notNull()
      .default(false),
    private_show_rates: boolean("private_show_rates").notNull().default(false),
    // Show the view requirements (min_payout total + per-clip floors) on the
    // locked teaser even when rates are hidden. Off = bundled with rates,
    // exactly the pre-existing behavior.
    private_show_min_views: boolean("private_show_min_views")
      .notNull()
      .default(false),
    private_show_description: boolean("private_show_description")
      .notNull()
      .default(true),
    // Optional teaser identity: when set, unapproved clippers see THIS name
    // and image instead of the real ones (e.g. "Secret Campaign #1"). The
    // real title/image are revealed on approval. Null = show the real ones.
    private_teaser_title: varchar("private_teaser_title", { length: 255 }),
    private_teaser_image_url: text("private_teaser_image_url"),
    // Teaser details: when set, unapproved clippers see THIS text in the
    // details section instead of the real description. Null = fall back to
    // the private_show_description toggle (real description or nothing).
    private_teaser_description: text("private_teaser_description"),
    // Discord server approved clippers get pulled into. Distinct from
    // guild_id (the main community server): each private campaign can have
    // its own invite-locked server.
    private_discord_guild_id: varchar("private_discord_guild_id", {
      length: 50,
    }),
    created_at: timestamp("created_at").notNull().defaultNow(),
    updated_at: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("campaigns_guild_active_idx").on(table.guild_id, table.active),
    index("campaigns_ended_idx").on(table.ended),
    index("campaigns_channel_id_idx").on(table.channel_id),
    index("campaigns_card_deleted_idx").on(table.card_deleted_at),
  ]
);

export type TCampaign_ = typeof campaigns.$inferSelect;

// Single-row global site configuration. Currently holds the maintenance /
// "SOS" kill-switch: when maintenance_mode_enabled is true, every non-SOS
// (and non-god-mode) user is blocked from the site and shown a maintenance
// screen. Toggled from the /admin/sos panel by users with the "sos" role.
// Per-clipper Discord OAuth grant for the Atoms application, scoped to
// identify + guilds.join. Lets the Atoms bot add EXACTLY the clipper's own
// Discord account to a private campaign server on demand — no shareable invite
// link, so nothing to expire, consume, or steal. Keyed by user_id (the
// clipper's Discord id / app identity); discord_id is the account that actually
// authorized and MUST equal user_id (verified at callback time). Tokens are
// short-lived Discord tokens plus a refresh_token so re-joins work indefinitely.
export const discord_oauth_grants = mysqlTable(
  "discord_oauth_grants",
  {
    id: varchar({ length: 128 })
      .$defaultFn(() => createId())
      .primaryKey(),
    user_id: varchar("user_id", { length: 255 }).notNull(),
    discord_id: varchar("discord_id", { length: 255 }).notNull(),
    access_token: text("access_token").notNull(),
    refresh_token: text("refresh_token"),
    scope: varchar("scope", { length: 255 }),
    expires_at: timestamp("expires_at").notNull(),
    created_at: timestamp("created_at").notNull().defaultNow(),
    updated_at: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex("discord_oauth_grants_user_idx").on(table.user_id)]
);

export const site_settings = mysqlTable("site_settings", {
  id: varchar({ length: 128 })
    .$defaultFn(() => createId())
    .primaryKey(),
  maintenance_mode_enabled: boolean("maintenance_mode_enabled")
    .notNull()
    .default(false),
  maintenance_mode_message: text("maintenance_mode_message"),
  maintenance_enabled_at: timestamp("maintenance_enabled_at"),
  maintenance_enabled_by: varchar("maintenance_enabled_by", { length: 255 }),
  // Discord bot token for private-campaign auto-join/invites. DB-stored
  // because the team doesn't have DigitalOcean env access; the
  // DISCORD_BOT_TOKEN env var takes precedence when set. Server-side only —
  // never return this through any endpoint (getMaintenanceStatus already
  // whitelists its fields).
  discord_bot_token: text("discord_bot_token"),
  // Leaderboard YouTube clip hosting. DB-stored (like discord_bot_token) so the
  // team can flip it on/off and set a key from the admin UI without needing
  // DigitalOcean env access. Default OFF: YouTube clips are only fetched (via a
  // paid RapidAPI downloader) once this is switched on. youtube_rapidapi_key,
  // when set, is used INSTEAD of the RAPIDAPI_KEY env var, so a SEPARATE
  // RapidAPI account can power just YouTube. Server-side only — the key is never
  // returned through any endpoint.
  youtube_hosting_enabled: boolean("youtube_hosting_enabled")
    .notNull()
    .default(false),
  youtube_rapidapi_key: text("youtube_rapidapi_key"),
  // Master switch for the whole home-page leaderboard (both the top-clips and
  // top-earners boards). Default ON (it already ships live); flipping it off
  // hides the entire section and stops the clip-hosting cron.
  leaderboard_enabled: boolean("leaderboard_enabled").notNull().default(true),
  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type TSiteSettings = typeof site_settings.$inferSelect;

export type TCampaign = typeof campaigns.$inferSelect;

export const campaign_levels = mysqlTable(
  "campaign_levels",
  {
    id: varchar({ length: 128 })
      .$defaultFn(() => createId())
      .primaryKey(),
    campaign_id: varchar("campaign_id", { length: 255 })
      .notNull()
      .references(() => campaigns.id),
    level_threshold: int("level_threshold").notNull(),
    cpm_rate: float("cpm_rate").notNull(),
    additional_rewards_description: text("additional_rewards_description"),
    created_at: timestamp("created_at").notNull().defaultNow(),
    updated_at: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    campaignIdx: index("campaign_levels_campaign_idx").on(table.campaign_id),
    thresholdIdx: index("campaign_levels_threshold_idx").on(
      table.level_threshold
    ),
  })
);

export type TCampaignLevel = typeof campaign_levels.$inferSelect;

// CPM groups: a named group per campaign (e.g. "Big Boys") carrying ONE
// absolute rate; members inherit it. Changing the group's rate changes every
// member's rate in one edit — the mutations settle each member's pending
// views at the OLD rate first, so rate changes are always forward-only.
// A member's effective CPM on every ENABLED platform (campaign rate > 0) is
// exactly the group's cpm_per_1000 — replacing the base rate, campaign_levels
// tiers, and hot-streak boosts. Disabled platforms (rate 0) never pay.
// Applied in BOTH pricing paths (wallet: createCampaignViewRewards.resolveCpm;
// scoreboard: updateViewCountsForSubmission) so clawbacks, campaigns.achieved,
// and the budget clamp stay denominated in the same rate the wallet paid.
export const campaign_cpm_groups = mysqlTable(
  "campaign_cpm_groups",
  {
    id: varchar({ length: 128 })
      .$defaultFn(() => createId())
      .primaryKey(),
    campaign_id: varchar("campaign_id", { length: 255 })
      .notNull()
      .references(() => campaigns.id),
    name: varchar("name", { length: 60 }).notNull(),
    cpm_per_1000: decimal("cpm_per_1000", {
      precision: 8,
      scale: 4,
    }).notNull(),
    created_by: varchar("created_by", { length: 255 }),
    created_at: timestamp("created_at").notNull().defaultNow(),
    updated_at: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    campaignIdx: index("campaign_cpm_groups_campaign_idx").on(
      table.campaign_id
    ),
  })
);

export const campaign_cpm_group_members = mysqlTable(
  "campaign_cpm_group_members",
  {
    id: varchar({ length: 128 })
      .$defaultFn(() => createId())
      .primaryKey(),
    group_id: varchar("group_id", { length: 128 })
      .notNull()
      .references(() => campaign_cpm_groups.id),
    // Denormalized from the group so ONE unique index can guarantee a
    // clipper is never in two rate groups on the same campaign (the reward
    // engine needs exactly one rate per user per campaign).
    campaign_id: varchar("campaign_id", { length: 255 }).notNull(),
    // Discord id — the same identity submissions.user_id uses.
    user_id: varchar("user_id", { length: 255 }).notNull(),
    created_at: timestamp("created_at").notNull().defaultNow(),
    updated_at: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    campaignUserIdx: uniqueIndex(
      "campaign_cpm_group_members_campaign_user_idx"
    ).on(table.campaign_id, table.user_id),
    groupIdx: index("campaign_cpm_group_members_group_idx").on(table.group_id),
    userIdx: index("campaign_cpm_group_members_user_idx").on(table.user_id),
  })
);

export type TCampaignCpmGroup = typeof campaign_cpm_groups.$inferSelect;
export type TCampaignCpmGroupMember =
  typeof campaign_cpm_group_members.$inferSelect;

// ── Geo-based payout rules ──
// A rule names a set of countries with a percentage requirement, and pays a
// BONUS cpm on top of the campaign's base rate to any connected social account
// whose latest APPROVED demographic report satisfies it.
//
// Grain is per (campaign, verified account) — NOT per user. The same clipper
// can hold different rates on different connected accounts inside one campaign,
// so evaluation happens against a verified_users row, never a user_id.
//
// match_mode decides how `countries` is read:
//   "combined" — the countries' percentages are SUMMED and compared once to
//                min_combined_percentage. ("US+UK together >= 30%")
//   "each"     — every country carries its OWN minimum in the countries blob
//                and ALL must be met. ("US >= 45% AND UK >= 20%")
//
// bonus_cpm_per_1000 is ADDITIVE: effective rate = base rate + this. A rule
// paying 0.25 on a $1.00 campaign yields $1.25 per 1,000 views. Stored as
// decimal (not float) so a threshold comparison can't fail on binary
// representation and so it rounds identically to campaign_cpm_groups.
//
// A campaign with no rows here behaves EXACTLY as it does today.
export const campaign_geo_rules = mysqlTable(
  "campaign_geo_rules",
  {
    id: varchar({ length: 128 })
      .$defaultFn(() => createId())
      .primaryKey(),
    campaign_id: varchar("campaign_id", { length: 255 })
      .notNull()
      .references(() => campaigns.id),
    // Admin-facing label, e.g. "Tier 1 English-speaking".
    name: varchar("name", { length: 60 }),
    // "combined" -> [{ country }]; the shared threshold lives in
    // min_combined_percentage. "each" -> [{ country, min_percentage }] and
    // min_combined_percentage is ignored. Country values come from
    // countrySchema in lib/zod-schemas/demographic.ts.
    countries: json("countries")
      .$type<{ country: string; min_percentage?: number }[]>()
      .notNull(),
    // "each" is the default: admins author criteria as a threshold PER country
    // ("USA 30%, UK 15%"), which is how every worked example has been given.
    // "combined" remains for a single summed threshold across the set.
    match_mode: mysqlEnum("match_mode", ["combined", "each"])
      .notNull()
      .default("each"),
    // Percentage points, 0-100. Only read when match_mode = "combined".
    min_combined_percentage: decimal("min_combined_percentage", {
      precision: 5,
      scale: 2,
      mode: "number",
    })
      .notNull()
      .default(0),
    // The EXTRA cpm added to the campaign base rate for a qualifying account.
    bonus_cpm_per_1000: decimal("bonus_cpm_per_1000", {
      precision: 8,
      scale: 4,
      mode: "number",
    }).notNull(),
    created_by: varchar("created_by", { length: 255 }),
    created_at: timestamp("created_at").notNull().defaultNow(),
    updated_at: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("campaign_geo_rules_campaign_idx").on(table.campaign_id),
  ]
);

export type TCampaignGeoRule = typeof campaign_geo_rules.$inferSelect;

export const submissions = mysqlTable(
  "submissions",
  {
    id: varchar({ length: 128 })
      .$defaultFn(() => createId())
      .primaryKey(),
    user_id: varchar("user_id", { length: 255 }).notNull(),
    verified_user_id: varchar("verified_user_id", { length: 255 }),
    reviewed_by: varchar("reviewed_by", { length: 255 }).default("unknown"),
    reviewer_assignment_user_id: varchar("reviewer_assignment_user_id", {
      length: 255,
    }),
    campaign_id: varchar("campaign_id", { length: 255 }).notNull(),
    url: text("url").notNull(),
    category: text("category"),
    platform: varchar("platform", { length: 50 }).notNull(),
    country: varchar("country", { length: 100 }),
    status: varchar("status", { length: 20 }),
    views: int("views").default(0).notNull(),
    views_api_response: int("views_api_response").default(0).notNull(),
    max_view_cap: int("max_view_cap"),
    view_delta_zero_attempts: int("view_delta_zero_attempts")
      .default(0)
      .notNull(),
    view_delta_skip_count: int("view_delta_skip_count")
      .default(0)
      .notNull(),
    message_id: varchar("message_id", { length: 255 }),
    reward: float("reward").default(0).notNull(),
    rejected_reason: text("rejected_reason"),
    active: boolean("active").default(true),
    is_user_generated_content: boolean("is_user_generated_content")
      .notNull()
      .default(false),
    is_resubmit_prevented: boolean("is_resubmit_prevented")
      .notNull()
      .default(false),
    // Non-campaign-clip redemption: when set, this campaign clip has been
    // "covered" by the non-campaign clip with this id. Each non-campaign
    // clip can cover up to N campaign clips (N = campaign.non_campaign_clips_per).
    // Only submissions with a non-null value here get paid out. A campaign
    // clip in the unredeemed bucket (null here) does NOT pay until a
    // non-campaign clip is submitted and pops it. ON DELETE SET NULL so
    // the audit trail survives mod cleanup of non-campaign rows.
    redeemed_by_non_campaign_clip_id: varchar(
      "redeemed_by_non_campaign_clip_id",
      { length: 128 }
    ),
    // Odometer freeze fix: when a clip whose views were already paid leaves
    // the live payable baseline (rejection, or its non-campaign cover dying),
    // this snapshot keeps contributing EXACTLY this many views to the payout
    // baseline in its place. The paid odometer then never towers over the
    // baseline, so the clipper isn't frozen earning $0 to re-climb views
    // whose money was already clawed back — and because the snapshotted
    // views never LEAVE the baseline, they can never be re-earned either.
    // Set on approved->rejected/pending transitions and on NC-uncover;
    // cleared when the clip re-enters live payout (re-approval on
    // non-redemption campaigns, or re-cover on redemption campaigns).
    // Null = normal live behavior. Mirrors the deleted-clip design (deleted
    // clips' frozen views stay in the baseline via their approved status).
    baseline_frozen_views: int("baseline_frozen_views"),
    // Deletion detection (Feature 1). The view cron increments
    // unavailable_strikes when a SUCCESSFUL (non-rate-limited) fetch says the
    // clip is gone; after enough consecutive strikes deleted_at is set and the
    // reward is clawed back (deleted_clawed_back guards against double-clawback).
    // A mod "Restore" clears deleted_at + zeroes strikes so views resume.
    unavailable_strikes: int("unavailable_strikes").notNull().default(0),
    unavailable_since: timestamp("unavailable_since"),
    deleted_at: timestamp("deleted_at"),
    deleted_clawed_back: boolean("deleted_clawed_back").notNull().default(false),
    // Self-hosted copy for the public leaderboards. The host-top-clips cron
    // pulls the video with yt-dlp, stores it on Spaces, and fills these so
    // the leaderboard plays the clip on OUR player with no link back to the
    // source post. A non-null hosted_video_url means "already downloaded" —
    // the video is immutable, so we never re-fetch it. hosting_attempts caps
    // retries on clips that keep failing to download.
    hosted_video_url: text("hosted_video_url"),
    hosted_thumbnail_url: text("hosted_thumbnail_url"),
    hosted_at: timestamp("hosted_at"),
    hosting_attempts: int("hosting_attempts").notNull().default(0),
    created_at: timestamp("created_at").notNull().defaultNow(),
    updated_at: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("submissions_user_campaign_idx").on(table.user_id, table.campaign_id),
    index("submissions_campaign_status_active_idx").on(
      table.campaign_id,
      table.status,
      table.active
    ),
    index("submissions_message_id_idx").on(table.message_id),
    index("submissions_assignment_idx").on(table.reviewer_assignment_user_id),
    // Used by the redemption flow to count unredeemed clips per (user, campaign).
    index("submissions_redeemed_by_idx").on(
      table.redeemed_by_non_campaign_clip_id
    ),
  ]
);

// Stores the "non-campaign" clips a clipper has submitted to earn
// the right to keep posting campaign clips. Each row carries a
// credit_remaining counter — when a clipper posts a campaign clip, we
// find one of their non-campaign clips with credit > 0 and decrement it;
// when a redeemed campaign clip is rejected, we bump that non-campaign
// clip's credit_remaining back up. See the createSubmission router for
// the full ledger logic.
//
// (platform, video_id) is globally unique across all clippers — a reel
// ID can NEVER be reused, even by its original owner.
export const non_campaign_clips = mysqlTable(
  "non_campaign_clips",
  {
    id: varchar({ length: 128 })
      .$defaultFn(() => createId())
      .primaryKey(),
    // Legacy linkage from the original batch-submission model. New rows in
    // the redemption flow leave this NULL — the relationship between a
    // non-campaign clip and the campaign clips it covers lives on
    // submissions.redeemed_by_non_campaign_clip_id instead. Kept nullable
    // so old rows continue to render correctly in mod tools.
    submission_id: varchar("submission_id", { length: 128 }),
    // Which campaign this non-campaign clip earns credit for. New rows MUST
    // set this; backfilled from submission_id's parent campaign for legacy rows.
    campaign_id: varchar("campaign_id", { length: 128 }).notNull(),
    user_id: varchar("user_id", { length: 255 }).notNull(),
    // Which verified account this non-campaign clip was posted from
    // (e.g. Instagram @handle_a vs @handle_b for a clipper who has
    // multiple verified pages). The ledger scopes by this so a clip on
    // @handle_a can only redeem campaign clips on @handle_a. Nullable
    // because legacy rows (pre-redemption flow, if any backfilled from
    // the original batch model) didn't carry this. New rows MUST set it.
    verified_user_id: varchar("verified_user_id", { length: 128 }),
    // Stores the canonical resolved URL the clipper submitted (helpful for
    // the mod-review UI which surfaces it as a clickable link).
    url: varchar("url", { length: 512 }).notNull(),
    // Platform's own video/reel ID extracted from the URL (e.g., YouTube
    // video ID, Instagram shortcode, TikTok video ID). This is what uniqueness
    // is enforced on — not the raw URL — so trivial URL variants
    // (trailing slash, ?si= tracking params, http vs https, instagram /reel/
    // vs /reels/) don't dodge the rule.
    //
    // IMPORTANT: this column MUST use a case-sensitive collation
    // (`utf8mb4_bin`). YouTube IDs are case-sensitive — `dQw4w9WgXcQ` and
    // `dqw4w9wgxcq` are two completely different videos. The migration
    // applies the right collation; Drizzle doesn't expose a per-column
    // collation option, so if you regenerate the migration without
    // hand-editing it the case-sensitivity will silently regress.
    video_id: varchar("video_id", { length: 255 }).notNull(),
    platform: varchar("platform", { length: 50 }).notNull(),
    // Live view count for this non-campaign clip — populated by the same
    // view-update cron path the main submissions table uses, so mods can
    // see at a glance how the clipper's non-campaign content is performing.
    // Defaults to 0 until the cron picks it up.
    views: int("views").default(0).notNull(),
    // Remaining cover slots: starts at N (campaign.non_campaign_clips_per)
    // minus however many unredeemed clips this clip popped at insert time.
    // Goes down by 1 whenever a new campaign clip claims this credit, and
    // back up by 1 when a covered campaign clip is rejected. Always >= 0.
    credit_remaining: int("credit_remaining").default(0).notNull(),
    // Mod review state for the non-campaign clip itself. Default 'approved'
    // is chosen so legacy rows (created before this column existed) stay
    // valid — otherwise every legacy campaign clip they covered would flip
    // to unredeemed overnight. New non-campaign clips submitted via
    // submitNonCampaignClip should be set to 'pending' (TODO: flip the
    // default in a follow-up migration after the submit path opts in).
    status: mysqlEnum("status", ["pending", "approved", "rejected"])
      .notNull()
      .default("approved"),
    rejected_reason: varchar("rejected_reason", { length: 1024 }),
    reviewed_by: varchar("reviewed_by", { length: 255 }),
    reviewer_assignment_user_id: varchar("reviewer_assignment_user_id", {
      length: 255,
    }),
    reviewed_at: timestamp("reviewed_at"),
    // Deletion detection (Feature 1) — same semantics as on submissions.
    unavailable_strikes: int("unavailable_strikes").notNull().default(0),
    unavailable_since: timestamp("unavailable_since"),
    deleted_at: timestamp("deleted_at"),
    deleted_clawed_back: boolean("deleted_clawed_back").notNull().default(false),
    created_at: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    // The hard uniqueness rule: same (platform, video_id) pair can never
    // exist twice. This is what blocks clippers from re-using a reel
    // anywhere in the system once it's tied to a live campaign submission.
    uniqueIndex("non_campaign_clips_platform_video_id_unique").on(
      table.platform,
      table.video_id
    ),
    index("non_campaign_clips_submission_idx").on(table.submission_id),
    index("non_campaign_clips_user_idx").on(table.user_id),
    // Used by the redemption credit-lookup query (find oldest non-campaign
    // clip with credit_remaining > 0 for this user+campaign+verified_account).
    index("non_campaign_clips_user_campaign_verified_idx").on(
      table.user_id,
      table.campaign_id,
      table.verified_user_id
    ),
    // Used by the mod-side non-campaign review queue (pending status by campaign).
    index("non_campaign_clips_campaign_status_idx").on(
      table.campaign_id,
      table.status
    ),
  ]
);

export type TNonCampaignClip = typeof non_campaign_clips.$inferSelect;

export const snapshot_submission_count = mysqlTable(
  "snapshot_submission_count",
  {
    id: varchar({ length: 128 })
      .$defaultFn(() => createId())
      .primaryKey(),
    campaign_id: varchar("campaign_id", { length: 255 }).notNull(),
    submission_count: int("submission_count").notNull().default(0),
    created_at: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("snapshot_submission_count_campaign_idx").on(table.campaign_id),
  ]
);

export const snapshot_submission_views = mysqlTable(
  "snapshot_submission_views",
  {
    id: varchar({ length: 128 })
      .$defaultFn(() => createId())
      .primaryKey(),
    campaign_id: varchar("campaign_id", { length: 255 }).notNull(),
    views: int("views").notNull().default(0),
    created_at: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("snapshot_submission_views_campaign_idx").on(table.campaign_id),
  ]
);

// Non-campaign-clip equivalents of the two snapshot tables above. Captured by
// the same view-update cron so the NC stats dashboard can draw a views/clips
// trend line over time, mirroring the campaign "Submission trends" chart.
export const snapshot_nc_count = mysqlTable(
  "snapshot_nc_count",
  {
    id: varchar({ length: 128 })
      .$defaultFn(() => createId())
      .primaryKey(),
    campaign_id: varchar("campaign_id", { length: 255 }).notNull(),
    clip_count: int("clip_count").notNull().default(0),
    created_at: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [index("snapshot_nc_count_campaign_idx").on(table.campaign_id)]
);

export const snapshot_nc_views = mysqlTable(
  "snapshot_nc_views",
  {
    id: varchar({ length: 128 })
      .$defaultFn(() => createId())
      .primaryKey(),
    campaign_id: varchar("campaign_id", { length: 255 }).notNull(),
    views: int("views").notNull().default(0),
    created_at: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [index("snapshot_nc_views_campaign_idx").on(table.campaign_id)]
);

export const invoices = mysqlTable(
  "invoices",
  {
    id: varchar({ length: 128 })
      .$defaultFn(() => createId())
      .primaryKey(),
    user_id: varchar("user_id", { length: 255 }),
    views: int("views"),
    payout: float("payout"),
    upi_id: varchar("upi_id", { length: 255 }),
    reference_id: varchar("reference_id", { length: 255 }),
    paid: boolean("paid").default(false),
    created_at: timestamp("created_at").notNull().defaultNow(),
    updated_at: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    pk: { columns: [table.user_id, table.created_at], name: "invoices_pk" },
    userPaidIdx: index("invoices_user_paid_idx").on(table.user_id, table.paid),
    referenceIdIdx: index("invoices_reference_id_idx").on(table.reference_id),
  })
);

export const staff = mysqlTable("staff", {
  discord_id: varchar("discord_id", { length: 50 }).primaryKey(),
  role: mysqlEnum("role", ["admin", "staff"]).notNull(),
  added_at: timestamp("added_at").notNull().defaultNow(),
  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const demographics_verifications = mysqlTable(
  "demographics_verifications",
  {
    id: varchar({ length: 128 })
      .$defaultFn(() => createId())
      .primaryKey(),
    user_id: varchar("user_id", { length: 255 }).notNull(),
    account_name: varchar("account_name", { length: 255 }).notNull(),
    file_type: varchar("file_type", { length: 50 }),
    country: varchar("country", { length: 100 }).notNull(),
    status: mysqlEnum("status", ["pending", "approved", "rejected"])
      .notNull()
      .default("pending"),
    created_at: timestamp("created_at").notNull().defaultNow(),
    updated_at: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("demographics_user_status_idx").on(table.user_id, table.status),
  ]
);

export const bank_accounts = mysqlTable(
  "bank_accounts",
  {
    id: varchar({ length: 128 })
      .$defaultFn(() => createId())
      .primaryKey(),
    user_id: varchar("user_id", { length: 255 }).notNull(),
    bank_name: varchar("bank_name", { length: 255 }),
    account_number: varchar("account_number", { length: 50 }),
    ifsc_code: varchar("ifsc_code", { length: 20 }),
    account_holder: varchar("account_holder", { length: 255 }),
    branch_name: varchar("branch_name", { length: 255 }),
    name: varchar("name", { length: 255 }),
    recipient_email: varchar("recipient_email", { length: 255 }),
    receiver_type: varchar("receiver_type", { length: 255 }),
    amount_currency: varchar("amount_currency", { length: 255 }),
    source_currency: varchar("source_currency", { length: 255 }),
    target_currency: varchar("target_currency", { length: 255 }),
    address_country_code: varchar("address_country_code", { length: 10 }),
    address_city: varchar("address_city", { length: 255 }),
    address_first_line: varchar("address_first_line", { length: 255 }),
    address_post_code: varchar("address_post_code", { length: 20 }),

    created_at: timestamp("created_at").notNull().defaultNow(),
    updated_at: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("bank_accounts_user_id_idx").on(table.user_id)]
);

export const campaigncategories = mysqlTable(
  "campaign_categories",
  {
    id: varchar({ length: 128 })
      .$defaultFn(() => createId())
      .primaryKey(),
    campaign_id: varchar("campaign_id", { length: 255 }).notNull(),
    guild_id: varchar("guild_id", { length: 255 }).notNull(),
    category: varchar("category", { length: 255 }).notNull(),
    platform: varchar("platform", { length: 255 }).notNull(),
    rate_per_1000: decimal("rate_per_1000", {
      precision: 10,
      scale: 2,
    }).notNull(),
    budget: float("budget").default(0).notNull(),
    category_specific_max_payout: float("category_specific_max_payout")
      .default(0)
      .notNull(),
    created_at: timestamp("created_at").notNull().defaultNow(),
    updated_at: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("campaigncategories_campaign_platform_idx").on(
      table.campaign_id,
      table.platform
    ),
    index("campaigncategories_guild_active_idx").on(table.guild_id),
  ]
);
// keep track of all invites so we can determain which one was used within guildMemberAdd
export const invites = mysqlTable("invites", {
  id: varchar({ length: 128 })
    .$defaultFn(() => createId())
    .primaryKey(),
  code: varchar("code", { length: 50 }).notNull().unique(),
  guild_id: varchar("guild_id", { length: 50 }).notNull(),
  discord_id: varchar("discord_id", { length: 50 }).default("Unknown"), // discord id of user who created invite, if available.
  uses: int("uses").default(0).notNull(),
  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const referals = mysqlTable("referals", {
  // this stores info about the discord user who started the flow by using /refer
  id: varchar({ length: 128 })
    .$defaultFn(() => createId())
    .primaryKey(),
  active: boolean("active").notNull().default(true),
  guild_id: varchar("guild_id", { length: 50 }).notNull(),
  campaign_id: varchar("campaign_id", { length: 50 })
    .notNull()
    .references(() => campaigns.id),
  discord_id: varchar("discord_id", { length: 50 }).notNull(),
  referrer_id: varchar("referrer_id", { length: 50 })
    .notNull()
    .references(() => verified_users.id),
  code: varchar("code", { length: 50 }).notNull(),
  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const refered_users = mysqlTable("refered_users", {
  id: varchar({ length: 128 })
    .$defaultFn(() => createId())
    .primaryKey(),
  guild_id: varchar("guild_id", { length: 50 }).notNull(),
  discord_id: varchar("discord_id", { length: 50 }).notNull(),
  referal_id: varchar("referal_id", { length: 128 }).references(
    () => referals.id
  ),

  referalCompleted: boolean("referalCompleted").default(false), // the user reached the final step and verified a social media handle within the bot.
  reward: float("reward").default(0).notNull(), // referal reward.
  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// Effectively a cache of the SUM (minus withdrawals) of the balance_entries table.
// `balance` is SPENDABLE money — what a clipper can withdraw. `pending_balance`
// is earned-but-unconfirmed money held until the next cycle's demographics are
// approved (see campaign_view_rewards.clearance_state). Keeping them in
// separate columns means every existing read of `balance` stays correct without
// modification: held money simply isn't in it yet.
export const balances = mysqlTable(
  "balances",
  {
    id: varchar({ length: 128 })
      .$defaultFn(() => createId())
      .primaryKey(),
    user_id: varchar("user_id", { length: 255 }).notNull(),
    balance: decimal("balance", { precision: 12, scale: 4, mode: "number" })
      .default(0)
      .notNull(),
    // Earned but NOT yet withdrawable — awaiting the next cycle's demographic
    // approval. Never included in `balance`, so withdrawal logic needs no
    // changes to stay correct.
    pending_balance: decimal("pending_balance", {
      precision: 12,
      scale: 4,
      mode: "number",
    })
      .default(0)
      .notNull(),
    totalEarned: decimal("totalEarned", {
      precision: 12,
      scale: 4,
      mode: "number",
    })
      .default(0)
      .notNull(),
    created_at: timestamp("created_at").notNull().defaultNow(),
    updated_at: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex("balances_user_id_idx").on(table.user_id)]
);

// Snapshots of the public "top earners" leaderboard. A cron writes 10 rows
// (rank 1..10) per run with the same snapshot_at; the public endpoint reads
// the newest snapshot. We rank on balances.totalEarned (per-user, no channel
// breakdown) and store ONLY the username + amount — never any account/handle,
// so the board can't reveal which channels earned the money.
export const earner_leaderboard_snapshots = mysqlTable(
  "earner_leaderboard_snapshots",
  {
    id: varchar({ length: 128 })
      .$defaultFn(() => createId())
      .primaryKey(),
    // One id per snapshot RUN, shared by that run's 10 rows. The read path
    // selects the newest run's batch_id and returns exactly those rows, so
    // two runs landing in the same clock second can never mix into a 20-row
    // board with duplicate ranks.
    batch_id: varchar("batch_id", { length: 128 }).notNull(),
    rank: int("rank").notNull(),
    user_id: varchar("user_id", { length: 255 }).notNull(),
    username: varchar("username", { length: 255 }),
    total_earned: decimal("total_earned", {
      precision: 12,
      scale: 4,
      mode: "number",
    }).notNull(),
    snapshot_at: timestamp("snapshot_at").notNull(),
    created_at: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("earner_leaderboard_snapshots_snapshot_at_idx").on(
      table.snapshot_at
    ),
    index("earner_leaderboard_snapshots_batch_idx").on(table.batch_id),
  ]
);

export type TEarnerLeaderboardSnapshot =
  typeof earner_leaderboard_snapshots.$inferSelect;

export const wise_withdrawals = mysqlTable(
  "wise_withdrawals",
  {
    id: varchar({ length: 128 })
      .$defaultFn(() => createId())
      .primaryKey(),
    external_recipient_id: varchar("external_recipient_id", {
      length: 255,
    }).notNull(),
    external_id: varchar("external_id", { length: 255 }).unique().notNull(), // Wise customer transaction ID
    // Wise transfer ID. Stored as varchar (not int) because Wise IDs can
    // exceed int32 range. Matches migration 0023 which converted this
    // column from int → varchar; schema.ts was previously left out of sync.
    external_transfer_id: varchar("external_transfer_id", { length: 255 }),
    external_quote_id: varchar("external_quote_id", { length: 255 }), // Wise quote ID
    external_status: varchar("external_status", { length: 255 }), // Wise transfer status
    external_batch_id: varchar("external_batch_id", { length: 255 }), // Wise batch group ID
    user_id: varchar("user_id", { length: 255 }).notNull(),
    balance_entry_id: varchar("balance_entry_id", { length: 128 }).notNull(),
    amount: decimal("amount", { precision: 12, scale: 4, mode: "number" })
      .default(0)
      .notNull(),
    currency: varchar("currency", { length: 255 }).default("USD"),
    status: mysqlEnum("status", [
      "requested",
      "pending",
      "failed",
      "completed",
      "cancelled",
      // Admin "return to balance": the queued withdrawal was closed and its
      // amount credited back to the clipper's platform balance. Only ever set
      // while status was "requested" (never after a Wise transfer exists).
      "returned",
    ])
      .notNull()
      .default("requested"),
    created_at: timestamp("created_at").notNull().defaultNow(),
    updated_at: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("wise_withdrawals_user_id_idx").on(table.user_id),
    index("wise_withdrawals_balance_entry_id_idx").on(table.balance_entry_id),
    index("wise_withdrawals_external_id_idx").on(table.external_id),
  ]
);

export const wise_recipient = mysqlTable(
  "wise_recipient",
  {
    id: varchar({ length: 128 })
      .$defaultFn(() => createId())
      .primaryKey(),
    user_id: varchar("user_id", { length: 255 }).notNull(),
    recipient_id: varchar("recipient_id", { length: 255 }).notNull(),
  },
  (table) => [
    index("wise_recipient_user_id_idx").on(table.user_id),
    index("wise_recipient_recipient_id_idx").on(table.recipient_id),
  ]
);

// ── Crypto payouts (NOWPayments) ────────────────────────────────────────────
// Pilot scoped to payment mods ("rewards-modifier"); the flow mirrors Wise:
// claim debits the full balance into a "requested" crypto_withdrawals row,
// an admin batches requested rows to NOWPayments, a 2FA code verifies the
// batch, and a sync pass settles per-item statuses.

// A clipper's saved crypto destination. np_currency is the NOWPayments ticker
// (e.g. "usdtbsc" = USDT on BNB Smart Chain); the allowed set lives in
// shared/cryptoPayoutOptions.ts — ERC-20 and TRC-20 are deliberately excluded
// (fee cost), and only USD-pegged stablecoins are allowed because withdrawal
// amounts are sent 1:1 from the USD balance with no FX conversion.
export const crypto_payout_methods = mysqlTable(
  "crypto_payout_methods",
  {
    id: varchar({ length: 128 })
      .$defaultFn(() => createId())
      .primaryKey(),
    user_id: varchar("user_id", { length: 255 }).notNull(),
    np_currency: varchar("np_currency", { length: 32 }).notNull(),
    address: varchar("address", { length: 255 }).notNull(),
    // Destination tag / memo for networks that require one (e.g. TON).
    memo: varchar("memo", { length: 255 }),
    label: varchar("label", { length: 255 }),
    // NOWPayments address whitelisting is dashboard-only (no API): admins
    // export new addresses as CSV from the Crypto Whitelist panel, upload the
    // file to NOWPayments, then mark rows whitelisted here. Batch creation
    // refuses destinations that aren't marked whitelisted.
    whitelist_exported_at: timestamp("whitelist_exported_at"),
    whitelisted_at: timestamp("whitelisted_at"),
    created_at: timestamp("created_at").notNull().defaultNow(),
    updated_at: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("crypto_payout_methods_user_id_idx").on(table.user_id),
    index("crypto_payout_methods_address_idx").on(table.address),
  ]
);

export type TCryptoPayoutMethod = typeof crypto_payout_methods.$inferSelect;

// One admin-initiated NOWPayments mass-payout call. The title is ours only —
// NOWPayments has no batch-name field, so np_batch_id is the join key to
// what their dashboard shows.
export const crypto_payout_batches = mysqlTable(
  "crypto_payout_batches",
  {
    id: varchar({ length: 128 })
      .$defaultFn(() => createId())
      .primaryKey(),
    title: varchar("title", { length: 255 }).notNull(),
    np_batch_id: varchar("np_batch_id", { length: 255 }),
    // created | awaiting_verification | sent | finished | failed
    // (varchar per newer-status-column convention; see wise_withdrawals for
    // the enum-based older style)
    status: varchar("status", { length: 32 }).notNull().default("created"),
    created_by: varchar("created_by", { length: 255 }).notNull(),
    created_at: timestamp("created_at").notNull().defaultNow(),
    updated_at: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("crypto_payout_batches_np_batch_id_idx").on(table.np_batch_id)]
);

export type TCryptoPayoutBatch = typeof crypto_payout_batches.$inferSelect;

// Mirrors wise_withdrawals: "requested" rows hold the debited balance until an
// admin batch flips them to "pending"; sync settles them to completed/failed
// (failed re-credits the balance). Destination fields are frozen copies taken
// at claim time so later edits to the method can't redirect in-flight money.
export const crypto_withdrawals = mysqlTable(
  "crypto_withdrawals",
  {
    id: varchar({ length: 128 })
      .$defaultFn(() => createId())
      .primaryKey(),
    user_id: varchar("user_id", { length: 255 }).notNull(),
    method_id: varchar("method_id", { length: 128 }).notNull(),
    np_currency: varchar("np_currency", { length: 32 }).notNull(),
    address: varchar("address", { length: 255 }).notNull(),
    memo: varchar("memo", { length: 255 }),
    amount: decimal("amount", { precision: 12, scale: 4, mode: "number" })
      .default(0)
      .notNull(),
    currency: varchar("currency", { length: 255 }).default("USD"),
    balance_entry_id: varchar("balance_entry_id", { length: 128 }).notNull(),
    // Our idempotency key for the NOWPayments call (mirrors Wise external_id).
    external_id: varchar("external_id", { length: 255 }).unique().notNull(),
    batch_id: varchar("batch_id", { length: 128 }),
    // NOWPayments per-withdrawal id + raw status (WAITING/SENDING/FINISHED/…)
    np_payout_id: varchar("np_payout_id", { length: 255 }),
    np_status: varchar("np_status", { length: 64 }),
    // requested | pending | failed | completed | returned — same lifecycle as
    // wise_withdrawals ("returned" = admin return-to-balance while requested)
    status: varchar("status", { length: 20 }).notNull().default("requested"),
    created_at: timestamp("created_at").notNull().defaultNow(),
    updated_at: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("crypto_withdrawals_user_id_idx").on(table.user_id),
    index("crypto_withdrawals_status_idx").on(table.status),
    index("crypto_withdrawals_batch_id_idx").on(table.batch_id),
    index("crypto_withdrawals_external_id_idx").on(table.external_id),
  ]
);

export type TCryptoWithdrawal = typeof crypto_withdrawals.$inferSelect;

export const balance_entries = mysqlTable(
  "balance_entries",
  {
    id: varchar({ length: 128 })
      .$defaultFn(() => createId())
      .primaryKey(),
    user_id: varchar("user_id", { length: 255 }).notNull(),
    amount: decimal("amount", { precision: 12, scale: 4, mode: "number" })
      .default(0)
      .notNull(),
    currency: varchar("currency", { length: 255 }).default("USD"),
    type: mysqlEnum("type", [
      "reward",
      "manual_adjustment",
      "withdrawal",
      "withdrawal_cancellation",
      "withdrawal_refund",
    ]).notNull(),
    source_type: varchar("source_type", { length: 255 }), // campaign_view_reward, withdrawal, etc
    source_id: varchar("source_id", { length: 128 }),
    memo: text("memo"),
    metadata: json("metadata"),
    // Manual adjustments only: which campaign this money belongs to, and
    // whether it counts toward that campaign's achieved/budget meter
    // (admin checkbox, default ON in the UI). DB default is FALSE so all
    // historical rows stay excluded. Rewards/withdrawals ignore these —
    // rewards already reach the meter through submissions.reward, and
    // adding them here would double-count.
    campaign_id: varchar("campaign_id", { length: 255 }),
    counts_toward_campaign: boolean("counts_toward_campaign")
      .default(false)
      .notNull(),
    created_at: timestamp("created_at").notNull().defaultNow(),
    updated_at: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("balance_entries_user_id_idx").on(table.user_id),
    index("balance_entries_user_source_type_idx").on(
      table.user_id,
      table.source_type
    ),
    index("balance_entries_campaign_idx").on(table.campaign_id),
  ]
);

// Deleted-clip clawback RESERVES (deferred debt). When a deleted clip's
// reward is clawed back but the wallet can't cover it, we take only what's
// there (never below zero) and record the shortfall here as an outstanding
// reserve tied to that specific clip. A mod later collects it from the
// "Deleted clips" panel once the clipper has earned more — partial or full,
// their choice — and each collection is a balance_entries row for audit.
//   total_owed    = the clip's reward we needed to reclaim
//   clawed_amount = how much has actually been taken so far (deletion + all
//                   later collections). remaining = total_owed - clawed_amount
//   status        = "outstanding" until clawed_amount reaches total_owed,
//                   then "recovered". Voided on clip restore.
export const deleted_clip_reserves = mysqlTable(
  "deleted_clip_reserves",
  {
    id: varchar({ length: 128 })
      .$defaultFn(() => createId())
      .primaryKey(),
    submission_id: varchar("submission_id", { length: 128 }).notNull(),
    user_id: varchar("user_id", { length: 255 }).notNull(),
    campaign_id: varchar("campaign_id", { length: 255 }).notNull(),
    // Snapshot of the reel at deletion time so the panel can show it even if
    // the underlying submission changes.
    url: text("url"),
    platform: varchar("platform", { length: 50 }),
    views: int("views").default(0).notNull(),
    total_owed: decimal("total_owed", {
      precision: 12,
      scale: 4,
      mode: "number",
    }).notNull(),
    clawed_amount: decimal("clawed_amount", {
      precision: 12,
      scale: 4,
      mode: "number",
    })
      .notNull()
      .default(0),
    status: varchar("status", { length: 20 }).notNull().default("outstanding"),
    // Why the reserve was opened — the clawback source_type that created it:
    // "clip_deletion" | "submission_rejection" | "noncampaign_uncovered".
    // Null = legacy row (all legacy reserves are deletions). Used so the
    // panel labels it correctly, so collections write the matching
    // balance_entries source_type (restore/re-approval reverseClawback nets
    // by source_type), and so re-approval/re-cover void only their own kind.
    reason: varchar("reason", { length: 40 }),
    created_at: timestamp("created_at").notNull().defaultNow(),
    updated_at: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // One reserve per deleted clip.
    uniqueIndex("deleted_clip_reserves_submission_idx").on(table.submission_id),
    index("deleted_clip_reserves_user_idx").on(table.user_id),
    index("deleted_clip_reserves_status_idx").on(table.status),
  ]
);

export type TDeletedClipReserve = typeof deleted_clip_reserves.$inferSelect;

export const campaign_view_rewards = mysqlTable(
  "campaign_view_rewards",
  {
    id: varchar("id", { length: 128 })
      .$defaultFn(() => createId())
      .primaryKey(),
    user_id: varchar("user_id", { length: 255 }).notNull(),
    campaign_id: varchar("campaign_id", { length: 255 }).notNull(),
    platform: varchar("platform", { length: 255 }).notNull(),
    // ── Per-account payout odometer ──
    // Geo rules qualify a CONNECTED ACCOUNT, not a clipper, so two accounts of
    // the same person on one campaign+platform can carry different rates. The
    // old (user, campaign, platform) grain physically cannot express that: it
    // sums every account's views into one number and multiplies by one cpm.
    //
    // NULL marks a LEGACY aggregate row written before the split. Those rows are
    // never rewritten — they stand as the paid-through baseline for their group,
    // which is what keeps historical payouts final and makes double-payment
    // impossible. Per-account rows carry a real id and accrue only views earned
    // after the cutover.
    verified_user_id: varchar("verified_user_id", { length: 255 }),
    cpm: float("cpm").default(0).notNull(),
    // The geo bonus portion of `cpm`, recorded so the clipper's earnings screen
    // can show "base + extra" rather than one opaque blended rate, and so an
    // audit can reconstruct which rate applied without re-deriving it from
    // demographics that have since changed. 0 = no geo bonus applied.
    geo_bonus_cpm: float("geo_bonus_cpm").default(0).notNull(),
    amount: decimal("amount", { precision: 12, scale: 4, mode: "number" })
      .default(0)
      .notNull(),
    view_count: int("view_count").default(0).notNull(),
    view_delta: int("view_delta").default(0).notNull(),
    // ── Weekly hold / clearance ──
    // A week's earnings are not spendable until the NEXT cycle's demographics
    // are approved. Until then the row sits "held" and its money lives in
    // balances.pending_balance rather than balances.balance.
    //
    //   held      — earned, not yet confirmed, cannot be withdrawn
    //   cleared   — confirmed; base (and geo bonus, if the account still
    //               qualified) moved into the spendable balance
    //   cancelled — the geo portion was withdrawn because the account no longer
    //               qualified. The base portion of a cancelled row still clears.
    //
    // DEFAULT 'cleared' is deliberate and load-bearing: every row written before
    // this feature existed was already paid into the spendable balance, so
    // defaulting to 'held' would retroactively freeze ~23k historical payouts.
    clearance_state: mysqlEnum("clearance_state", [
      "held",
      "cleared",
      "cancelled",
    ])
      .notNull()
      .default("cleared"),
    cleared_at: timestamp("cleared_at"),
    idempotency_key: varchar("idempotency_key", { length: 255 }).notNull(),
    balance_entry_id: varchar("balance_entry_id", { length: 128 }).notNull(),
    created_at: timestamp("created_at").notNull().defaultNow(),
    updated_at: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("campaign_view_rewards_idempotency_key_idx").on(
      table.idempotency_key
    ),
    index("campaign_view_rewards_user_campaign_idx").on(
      table.user_id,
      table.campaign_id
    ),
    // Serves the per-account high-water-mark lookup, which runs inside the
    // payout transaction for every account on every run. Deliberately only two
    // columns: all four of (user_id, campaign_id, platform, verified_user_id)
    // are varchar(255), and under utf8mb4 that index is 4080 bytes — past
    // MySQL's 3072-byte limit, so it fails to create. Paired with the existing
    // user_campaign index this still narrows the lookup effectively.
    index("campaign_view_rewards_account_idx").on(
      table.campaign_id,
      table.verified_user_id
    ),
  ]
);

export const user_clerk = mysqlTable(
  "user_clerk",
  {
    id: varchar({ length: 128 })
      .$defaultFn(() => createId())
      .primaryKey(),
    clerk_user_id: varchar("clerk_user_id", { length: 255 }).notNull().unique(),
    discord_id: varchar("discord_id", { length: 255 }).notNull().unique(),
    discord_username: varchar("discord_username", { length: 255 }),
    email: varchar("email", { length: 255 }),
    phone_number: varchar("phone_number", { length: 32 }),
    phone_country_code: varchar("phone_country_code", { length: 8 }),
    first_name: varchar("first_name", { length: 255 }),
    last_name: varchar("last_name", { length: 255 }),
    image_url: text("image_url"),
    // Per-clipper exemption from the campaign's per-clip minimum view floor
    // (campaigns.*_min_views). Normally a clip below the floor has its view
    // count recorded as 0 — it stays live, it just never counts and never
    // pays. With this set, the clipper's clips record their real views at any
    // size and are paid accordingly.
    //
    // Deliberately a per-USER flag rather than a campaign setting: lowering
    // the floor on the campaign would change the deal for everyone on it.
    // Off for everyone by default, so it can only ever be granted explicitly.
    exempt_min_views: boolean("exempt_min_views").notNull().default(false),
    // Normally demographics are only requested for accounts a clipper actually
    // EARNS from (has approved clips on). With this set, every connected,
    // non-deleted account is asked every cycle, whether or not it has ever
    // been used for a clip — so an account can be verified before it is used
    // rather than after. Off by default; granted per person.
    always_request_demographics: boolean("always_request_demographics")
      .notNull()
      .default(false),
    created_at: timestamp("created_at").notNull().defaultNow(),
    updated_at: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("user_clerk_clerk_id_idx").on(table.clerk_user_id),
    uniqueIndex("user_clerk_discord_id_idx").on(table.discord_id),
  ]
);

export const roles = mysqlTable(
  "roles",
  {
    id: varchar({ length: 128 })
      .$defaultFn(() => createId())
      .primaryKey(),
    name: varchar("name", { length: 64 }).notNull(),
    description: varchar("description", { length: 255 }),
    created_at: timestamp("created_at").notNull().defaultNow(),
    updated_at: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex("roles_name_idx").on(table.name)]
);

export const user_roles = mysqlTable(
  "user_roles",
  {
    id: varchar({ length: 128 })
      .$defaultFn(() => createId())
      .primaryKey(),
    user_id: varchar("user_id", { length: 255 }).notNull(),
    role_id: varchar("role_id", { length: 128 }).notNull(),
    assigned_at: timestamp("assigned_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("user_roles_user_role_idx").on(table.user_id, table.role_id),
    index("user_roles_user_idx").on(table.user_id),
  ]
);

export const demographics_verification_v2 = mysqlTable(
  "demographics_verifications_v2",
  {
    id: varchar({ length: 128 })
      .$defaultFn(() => createId())
      .primaryKey(),
    campaign_id: varchar("campaign_id", { length: 255 }).notNull(),
    user_id: varchar("user_id", { length: 255 }).notNull(),
    verified_user_id: varchar("verified_user_id", { length: 255 }).notNull(),
    views_from_submissions_snapshot: int(
      "views_from_submissions_snapshot"
    ).notNull(),
    parsed_data: json("parsed_data"),
    screenshot_file_url: text("file_url"),
    // ── Weekly demographic cycles ──
    // Demographics are re-submitted every week, so a report is versioned by the
    // MONDAY (UTC) of the week it covers rather than overwritten. Qualification
    // for geo payout rules is re-evaluated per cycle: an account that misses the
    // criteria one week and meets it the next earns the bonus only for the week
    // it qualified, which is impossible to express if a resubmission clobbers
    // the previous row. Legacy rows are backfilled to the Monday of their
    // created_at, so existing history stays readable and unique.
    // mode: "string" (YYYY-MM-DD), not a JS Date. A Date would be converted by
    // the driver against the process timezone, which can shift a report into the
    // adjacent week — and the week decides which geo bonus rate applied. A plain
    // string is timezone-inert end to end. SQL type is unchanged.
    cycle_start: date("cycle_start", { mode: "string" }).notNull(),
    // The clipper's proof for this cycle: a pasted video link (YouTube et al)
    // showing the last 7 days of in-platform analytics. Distinct from
    // screenshot_file_url, which holds the legacy UPLOADED evidence — keeping
    // them separate means old rows stay interpretable and a mod reviewing an
    // old submission isn't shown a link field that was never filled.
    evidence_video_url: text("evidence_video_url"),
    status: mysqlEnum("status", [
      "created",
      "active",
      "pending",
      "approved",
      "needs-human-review",
      "rejected",
      "cancelled",
    ])
      .notNull()
      .default("created"),
    approval_method: mysqlEnum("approval_method", ["user", "mod", "api"]),
    exemption_reason: text("exemption_reason"),
    created_at: timestamp("created_at").notNull().defaultNow(),
    updated_at: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("demographics_verifications_v2_user_idx").on(table.user_id),
    // Was (campaign_id, verified_user_id) — exactly ONE report per account per
    // campaign, forever, which made weekly resubmission overwrite the very
    // history the payout decision rests on. Now scoped by cycle so each week
    // is its own row and "the latest APPROVED report" is a real query.
    uniqueIndex("demographics_verifications_v2_campaign_verified_user_idx").on(
      table.campaign_id,
      table.verified_user_id,
      table.cycle_start
    ),
    // Serves the inherit-on-create lookup (verified_user_id + user_id + status,
    // newest first) so the payout batch seek is tight, no filesort.
    index("demographics_verifications_v2_account_status_idx").on(
      table.verified_user_id,
      table.user_id,
      table.status,
      table.updated_at
    ),
  ]
);

// ── Demographics reset requests (per campaign) ──
//
// A moderator asks ONE campaign's clippers for fresh audience demographics.
// Until now the ask was implicit and global: every clipper owed a report for
// every account they had ever earned from, on a fixed weekly clock. That meant
// a clipper with ten connected accounts was asked about all ten even when only
// two had ever posted to the campaign being reviewed.
//
// A request makes the ask explicit and scopes it: only the accounts that
// actually posted to THIS campaign and generated views are asked, and only this
// campaign's earnings are held back until they answer. Everything the clipper
// earned elsewhere stays claimable.
//
// One OPEN request per campaign at a time (closed_at IS NULL). Requesting again
// closes the previous one and opens a new round, which is what lets a moderator
// re-ask mid-week after a bad batch of reports.
//
// The reports themselves are unchanged — they stay keyed by
// (campaign_id, verified_user_id, cycle_start). A request records WHICH cycle it
// is asking for, so "has this clipper answered THIS request" is a lookup on that
// cycle rather than a new column on every report row.
export const demographics_reset_requests = mysqlTable(
  "demographics_reset_requests",
  {
    id: varchar({ length: 128 })
      .$defaultFn(() => createId())
      .primaryKey(),
    campaign_id: varchar("campaign_id", { length: 255 }).notNull(),
    // The cycle the reports being asked for belong to. Resolved when the request
    // is opened and then frozen: if the week rolls over while a request is still
    // open, the clipper must not silently start owing a different week's report
    // than the one the moderator asked for.
    cycle_start: date("cycle_start", { mode: "string" }).notNull(),
    requested_by: varchar("requested_by", { length: 255 }),
    // Free-text shown to the clipper in the notification, e.g. why this round is
    // being re-asked. Optional.
    note: text("note"),
    // How many clippers were notified when this request opened. Recorded rather
    // than recomputed: participation changes as clips are approved or removed,
    // so the number a moderator saw at the time is not reproducible later.
    notified_user_count: int("notified_user_count").default(0).notNull(),
    // NULL = open, and open is what holds this campaign's money back. Set when a
    // newer request supersedes it or a moderator cancels the ask.
    closed_at: timestamp("closed_at"),
    created_at: timestamp("created_at").notNull().defaultNow(),
    updated_at: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // Serves "is this campaign currently asking?", which runs for every campaign
    // a clipper earned from on every balance read.
    index("demographics_reset_requests_campaign_open_idx").on(
      table.campaign_id,
      table.closed_at
    ),
  ]
);

export const notifications = mysqlTable(
  "notifications",
  {
    id: varchar({ length: 128 })
      .$defaultFn(() => createId())
      .primaryKey(),
    user_id: varchar("user_id", { length: 255 }).notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    description: text("description").notNull(),
    metadata: json("metadata"),
    expires_minutes: int("expires_minutes"),
    dismissed_at: timestamp("dismissed_at"),
    created_at: timestamp("created_at").notNull().defaultNow(),
    updated_at: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("notifications_user_id_idx").on(table.user_id)]
);

export const notification_announcements = mysqlTable(
  "notification_announcements",
  {
    id: varchar({ length: 128 })
      .$defaultFn(() => createId())
      .primaryKey(),
    title: varchar("title", { length: 255 }).notNull(),
    description: text("description").notNull(),
    metadata: json("metadata"),
    expires_minutes: int("expires_minutes"),
    dismissed_at: timestamp("dismissed_at"),
    created_at: timestamp("created_at").notNull().defaultNow(),
    updated_at: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  }
);

export const referral_codes_v2 = mysqlTable(
  "referral_codes_v2",
  {
    id: varchar({ length: 128 })
      .$defaultFn(() => createId())
      .primaryKey(),
    code: varchar("code", { length: 255 }).notNull(),
    user_id: varchar("user_id", { length: 255 }).notNull(),
    social_media_share_card_url: text("social_media_share_card_url"),
    created_at: timestamp("created_at").notNull().defaultNow(),
    updated_at: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("referral_codes_v2_code_idx").on(table.code),
    uniqueIndex("referral_codes_v2_user_idx").on(table.user_id),
  ]
);

export const referred_users_v2 = mysqlTable("referred_users_v2", {
  id: varchar({ length: 128 })
    .$defaultFn(() => createId())
    .primaryKey(),
  referral_code_id: varchar("referral_code_id", { length: 128 }).references(
    () => referral_codes_v2.id
  ),
  referred_user_id: varchar("user_id", { length: 255 }).notNull(),
  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const influencer_campaigns = mysqlTable("influencer_campaigns", {
  id: varchar({ length: 128 })
    .$defaultFn(() => createId())
    .primaryKey(),
  title: varchar("title", { length: 255 }).notNull(),
  end_date: timestamp("end_date"),
  external_password: varchar("external_password", { length: 255 }),
  demographics_json: json("demographics_json"),
  twitter_total_impressions: int("twitter_total_impressions").notNull().default(0),
  twitter_total_replies: int("twitter_total_replies").notNull().default(0),
  twitter_total_quotes: int("twitter_total_quotes").notNull().default(0),
  twitter_total_retweets: int("twitter_total_retweets").notNull().default(0),
  twitter_total_bookmarks: int("twitter_total_bookmarks").notNull().default(0),
  linkedin_total_impressions: int("linkedin_total_impressions").notNull().default(0),
  linkedin_total_likes: int("linkedin_total_likes").notNull().default(0),
  linkedin_total_comments: int("linkedin_total_comments").notNull().default(0),
  linkedin_total_reposts: int("linkedin_total_reposts").notNull().default(0),
  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at").notNull().defaultNow().$onUpdate(() => new Date()),
});

export const influencer_twitter_submission = mysqlTable("influencer_twitter_submission", {
  id: varchar({ length: 128 })
    .$defaultFn(() => createId())
    .primaryKey(),
  influencer_campaign_id: varchar("influencer_campaign_id", { length: 128 }),
  link: text("link").notNull(),
  platform: varchar("platform", { length: 255 }).notNull(),
  handle: varchar("handle", { length: 255 }).notNull(),
  submitted_by: varchar("submitted_by", { length: 255 }).notNull(),
  submitted_at: timestamp("submitted_at").notNull().defaultNow(),
  demographics_parsed: json("parsed_demographics"),
  demographics_screenshot_url: text("demographics_screenshot_url"),

  // Twitter metrics
  impressions: int("views").notNull().default(0),
  bookmarkCount: int("bookmark_count").notNull().default(0),
  replyCount: int("reply_count").notNull().default(0),
  quoteCount: int("quote_count").notNull().default(0),
  favoriteCount: int("favorite_count").notNull().default(0),
  retweetCount: int("retweet_count").notNull().default(0),

  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at").notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  foreignKey({
    name: "twitter_influencer_campaign_fk",
    columns: [table.influencer_campaign_id],
    foreignColumns: [influencer_campaigns.id],
  }),
  index("submissions_influencers_campaign_idx").on(table.influencer_campaign_id),
]);


export const influencer_linkedin_submission = mysqlTable("influencer_linkedin_submission", {
  id: varchar({ length: 128 })
    .$defaultFn(() => createId())
    .primaryKey(),
  influencer_campaign_id: varchar("influencer_campaign_id", { length: 128 }),
  link: text("link").notNull(),
  platform: varchar("platform", { length: 255 }).notNull(),
  handle: varchar("handle", { length: 255 }).notNull(),
  submitted_by: varchar("submitted_by", { length: 255 }).notNull(),
  submitted_at: timestamp("submitted_at").notNull().defaultNow(),
  demographics_parsed: json("parsed_demographics"),
  demographics_screenshot_url: text("demographics_screenshot_url"),

  // LinkedIn metrics
  impressions: int("impressions").notNull().default(0),
  likes: int("likes").notNull().default(0),
  comments: int("comments").notNull().default(0),
  reposts: int("reposts").notNull().default(0),

  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at").notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  foreignKey({
    name: "linkedin_influencer_campaign_fk",
    columns: [table.influencer_campaign_id],
    foreignColumns: [influencer_campaigns.id],
  }),
  index("submissions_influencers_campaign_idx").on(table.influencer_campaign_id),
]);

// Relations

// Referals relations

export const verifiedUsersRelations = relations(verified_users, ({ many }) => ({
  referrals: many(referals),
}));

export const referralsRelations = relations(referals, ({ one, many }) => ({
  referrer: one(verified_users, {
    fields: [referals.referrer_id],
    references: [verified_users.id],
  }),

  campaign: one(campaigns, {
    fields: [referals.campaign_id],
    references: [campaigns.id],
  }),

  referredUsers: many(refered_users),
}));

export const guildSettingsRelations = relations(guild_settings, ({ many }) => ({
  campaigns: many(campaigns),
  campaignCategories: many(campaigncategories),
}));

export const usersRelations = relations(verified_users, ({ many }) => ({
  verifiedAccounts: many(verified_users, { relationName: "userVerifications" }),
  submissions: many(submissions),
  invoices: many(invoices),
  demographicsVerifications: many(demographics_verifications),
  bankAccounts: many(bank_accounts),
  balances: many(balances),
}));

export const campaignsRelations = relations(campaigns, ({ one, many }) => ({
  guildSettings: one(guild_settings, {
    fields: [campaigns.guild_id],
    references: [guild_settings.guild_id],
  }),
  submissions: many(submissions),
  categories: many(campaigncategories),
  levels: many(campaign_levels),
}));

export const submissionsRelations = relations(submissions, ({ one }) => ({
  campaign: one(campaigns, {
    fields: [submissions.campaign_id],
    references: [campaigns.id],
  }),
  user: one(verified_users, {
    fields: [submissions.user_id],
    references: [verified_users.discord_id],
  }),
}));

export const balancesRelations = relations(balances, ({ one }) => ({
  user: one(verified_users, {
    fields: [balances.user_id],
    references: [verified_users.discord_id],
  }),
}));

export const balanceEntriesRelations = relations(
  balance_entries,
  ({ many }) => ({
    wiseWithdrawals: many(wise_withdrawals),
    campaignViewRewards: many(campaign_view_rewards),
  })
);

export const wiseWithdrawalsRelations = relations(
  wise_withdrawals,
  ({ one }) => ({
    balanceEntry: one(balance_entries, {
      fields: [wise_withdrawals.balance_entry_id],
      references: [balance_entries.id],
    }),
  })
);

export const demographicsVerificationsRelations = relations(
  demographics_verifications,
  ({ one }) => ({
    user: one(verified_users, {
      fields: [demographics_verifications.user_id],
      references: [verified_users.discord_id],
    }),
  })
);

export const bankAccountsRelations = relations(bank_accounts, ({ one }) => ({
  user: one(verified_users, {
    fields: [bank_accounts.user_id],
    references: [verified_users.discord_id],
  }),
}));

export const campaignCategoriesRelations = relations(
  campaigncategories,
  ({ one }) => ({
    campaign: one(campaigns, {
      fields: [campaigncategories.campaign_id],
      references: [campaigns.id],
    }),
    guildSettings: one(guild_settings, {
      fields: [campaigncategories.guild_id],
      references: [guild_settings.guild_id],
    }),
  })
);

export const campaignLevelsRelations = relations(
  campaign_levels,
  ({ one }) => ({
    campaign: one(campaigns, {
      fields: [campaign_levels.campaign_id],
      references: [campaigns.id],
    }),
  })
);

// export type TUserSelect = typeof verified_users.$inferSelect;

// Immutable audit trail written by DATABASE TRIGGERS (aud_* on every table in
// prod). Records every INSERT/UPDATE/DELETE made by any human database user;
// connections as doadmin (the app + crons) are filtered out inside the
// triggers via SESSION_USER(). db_user therefore looks like "achuth@1.2.3.4"
// — username plus the IP the change came from. The app only ever READS this
// table (Dev Overlook panel); writing to it is the triggers' job.
export const audit_log = mysqlTable(
  "audit_log",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    ts: timestamp("ts", { fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    db_user: varchar("db_user", { length: 128 }).notNull(),
    action: varchar("action", { length: 10 }).notNull(),
    table_name: varchar("table_name", { length: 64 }).notNull(),
    row_id: varchar("row_id", { length: 255 }),
    old_data: json("old_data"),
    new_data: json("new_data"),
  },
  (table) => [
    index("audit_ts_idx").on(table.ts),
    index("audit_user_idx").on(table.db_user),
    index("audit_table_idx").on(table.table_name),
  ]
);

export type TAuditLog = typeof audit_log.$inferSelect;
