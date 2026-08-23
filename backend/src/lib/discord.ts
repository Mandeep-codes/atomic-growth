import axios from "axios";
import { clerkClient } from "@clerk/express";
import { env } from "./env";
import { db } from "./db";
import { site_settings } from "./schema";

// Discord integration for private campaigns. Two ways into the private
// server, tried in order when a mod approves an application:
//
//   1. "oauth"  — Clerk stores (and refreshes) the clipper's Discord OAuth
//      token. If the Discord provider in the Clerk dashboard includes the
//      guilds.join scope, the bot adds the user to the server directly via
//      PUT /guilds/{guild}/members/{user}. No invite link exists at all, so
//      nothing can leak.
//   2. "invite" — fallback when the token lacks guilds.join (e.g. users who
//      signed in before the scope was added). The bot mints a single-use,
//      7-day invite that is only ever shown inside the approved clipper's
//      dashboard.
//
// Bot requirements: the bot must be a member of each private campaign's
// server with the "Create Invite" permission (both paths need it).

const DISCORD_API = "https://discord.com/api/v10";
// Token resolution: the DISCORD_BOT_TOKEN env var wins; otherwise the
// site_settings row (stored there because the team can't edit the deploy's
// env vars). Cached briefly like the maintenance flag — the join runs only
// on approvals, but don't hit the DB for every retry inside one burst.
const TOKEN_TTL_MS = 60_000;
let tokenCache: { value: string | null; at: number } | null = null;

async function getBotToken(): Promise<string | null> {
  if (env.DISCORD_BOT_TOKEN) return env.DISCORD_BOT_TOKEN;
  if (tokenCache && Date.now() - tokenCache.at < TOKEN_TTL_MS) {
    return tokenCache.value;
  }
  try {
    const [row] = await db
      .select({ token: site_settings.discord_bot_token })
      .from(site_settings)
      .limit(1);
    const value = row?.token?.trim() || null;
    tokenCache = { value, at: Date.now() };
    return value;
  } catch {
    // Settings table unreadable — treat as unconfigured; the approval
    // itself must never fail because of Discord.
    return null;
  }
}

const botApi = (botToken: string) =>
  axios.create({
    baseURL: DISCORD_API,
    headers: { Authorization: `Bot ${botToken}` },
    // We branch on status codes ourselves — don't throw on 4xx.
    validateStatus: () => true,
    timeout: 10_000,
  });

async function getDiscordAccessToken(
  clerkUserId: string
): Promise<string | null> {
  try {
    const res = await clerkClient.users.getUserOauthAccessToken(
      clerkUserId,
      "oauth_discord"
    );
    return res.data[0]?.token ?? null;
  } catch {
    // No Discord connection / no token stored for this user.
    return null;
  }
}

export type DiscordJoinResult =
  | { method: "oauth" }
  | { method: "invite"; url: string }
  | { method: "none"; error: string };

// Trim Discord's error body to something that fits in a toast without
// leaking anything sensitive (these bodies are just code/message JSON).
const briefBody = (data: unknown) =>
  JSON.stringify(data ?? "").slice(0, 120);

// PUT a specific Discord account into a guild using an OAuth access token that
// was granted guilds.join for THIS bot's application. Shared by the Clerk-token
// path below and the Path-B stored-grant path (discordJoin.ts). Fetches the bot
// token itself so callers without one (the grant path) can use it directly.
export async function addMemberWithAccessToken(
  guildId: string,
  discordUserId: string,
  accessToken: string
): Promise<{ added: boolean; detail: string }> {
  const botToken = await getBotToken();
  if (!botToken) return { added: false, detail: "no bot token configured" };
  const res = await botApi(botToken).put(
    `/guilds/${guildId}/members/${discordUserId}`,
    { access_token: accessToken }
  );
  // 201 = added, 204 = already a member.
  if (res.status === 201 || res.status === 204) {
    return { added: true, detail: `HTTP ${res.status}` };
  }
  return { added: false, detail: `HTTP ${res.status} ${briefBody(res.data)}` };
}

// DM a clipper as the bot. Used for moderation notices (inactivity final
// warnings) so the clipper hears about it where they actually are, not only in
// the dashboard. Discord has no way to send a DM *as* a moderator's own
// account — automating a user account is against their ToS — so the bot is the
// sender and the notice is signed by the moderation team, not the individual
// mod who clicked.
//
// Requires only that the bot shares a server with the clipper. Common failure
// is HTTP 403 when the clipper blocks DMs from server members; callers must
// treat a false here as "tell the mod to reach out manually", never as an
// error that undoes the moderation action itself.
export async function sendDiscordDm(
  discordUserId: string,
  content: string
): Promise<{ sent: boolean; detail: string }> {
  const botToken = await getBotToken();
  if (!botToken) return { sent: false, detail: "no bot token configured" };
  try {
    const api = botApi(botToken);
    const channelRes = await api.post("/users/@me/channels", {
      recipient_id: discordUserId,
    });
    if (channelRes.status !== 200 || !channelRes.data?.id) {
      return {
        sent: false,
        detail: `dm channel HTTP ${channelRes.status} ${briefBody(channelRes.data)}`,
      };
    }
    const messageRes = await api.post(
      `/channels/${channelRes.data.id}/messages`,
      // Discord rejects anything over 2000 characters outright.
      { content: content.slice(0, 2000) }
    );
    if (messageRes.status !== 200 && messageRes.status !== 201) {
      return {
        sent: false,
        detail: `send HTTP ${messageRes.status} ${briefBody(messageRes.data)}`,
      };
    }
    return { sent: true, detail: "ok" };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Discord request failed";
    return { sent: false, detail: message };
  }
}

async function addMemberViaOauth(
  _botToken: string,
  guildId: string,
  discordUserId: string,
  clerkUserId: string
): Promise<{ added: boolean; detail: string }> {
  const accessToken = await getDiscordAccessToken(clerkUserId);
  if (!accessToken) {
    return { added: false, detail: "oauth: no Discord token from Clerk" };
  }
  // 403 missing guilds.join scope, 404 unknown guild, … falls through to invite.
  const result = await addMemberWithAccessToken(
    guildId,
    discordUserId,
    accessToken
  );
  return { added: result.added, detail: `oauth: ${result.detail}` };
}

async function createSingleUseInvite(
  botToken: string,
  guildId: string,
  discordUserId: string
): Promise<{ url: string | null; detail: string }> {
  const api = botApi(botToken);
  const channelsRes = await api.get(`/guilds/${guildId}/channels`);
  if (channelsRes.status !== 200 || !Array.isArray(channelsRes.data)) {
    return {
      url: null,
      detail: `invite: channel list HTTP ${channelsRes.status} ${briefBody(channelsRes.data)}`,
    };
  }
  // Invites are created on a channel; use the first regular text channel.
  const textChannel = channelsRes.data.find(
    (channel: { type: number }) => channel.type === 0
  );
  if (!textChannel) {
    return { url: null, detail: "invite: server has no text channel" };
  }
  const inviteRes = await api.post(
    `/channels/${textChannel.id}/invites`,
    { max_uses: 1, max_age: 7 * 24 * 60 * 60, unique: true },
    {
      headers: {
        "X-Audit-Log-Reason": `Private campaign approval for user ${discordUserId}`,
      },
    }
  );
  if (inviteRes.status !== 200 || !inviteRes.data?.code) {
    return {
      url: null,
      detail: `invite: create HTTP ${inviteRes.status} ${briefBody(inviteRes.data)}`,
    };
  }
  return { url: `https://discord.gg/${inviteRes.data.code}`, detail: "ok" };
}

export async function joinApprovedClipperToGuild(options: {
  guildId: string;
  discordUserId: string;
  clerkUserId: string | null;
}): Promise<DiscordJoinResult> {
  const { guildId, discordUserId, clerkUserId } = options;
  const botToken = await getBotToken();
  if (!botToken) {
    return {
      method: "none",
      error:
        "Discord bot not configured (no DISCORD_BOT_TOKEN env var and no token in site_settings)",
    };
  }
  try {
    let oauthDetail = "oauth: skipped (no Clerk user)";
    if (clerkUserId) {
      const oauth = await addMemberViaOauth(
        botToken,
        guildId,
        discordUserId,
        clerkUserId
      );
      if (oauth.added) return { method: "oauth" };
      oauthDetail = oauth.detail;
    }
    const invite = await createSingleUseInvite(
      botToken,
      guildId,
      discordUserId
    );
    if (invite.url) return { method: "invite", url: invite.url };
    // Surface the per-step HTTP statuses — "check the bot's permissions" was
    // undebuggable when the real cause was environmental.
    const error = `Couldn't add the member or create an invite (${oauthDetail}; ${invite.detail})`;
    console.error(
      `[discord] join failed — guild ${guildId}, user ${discordUserId}: ${error}`
    );
    return { method: "none", error };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Discord request failed";
    console.error(
      `[discord] join threw — guild ${guildId}, user ${discordUserId}:`,
      error
    );
    return { method: "none", error: message };
  }
}
