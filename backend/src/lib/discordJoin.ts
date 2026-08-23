import axios from "axios";
import crypto from "crypto";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { discord_oauth_grants, user_clerk } from "./schema";
import { env } from "./env";
import { addMemberWithAccessToken } from "./discord";

// Path B: a per-clipper Discord OAuth grant for the ATOMS application (scoped to
// identify + guilds.join). Once a clipper authorizes, the Atoms bot can add
// their exact account to a private server on demand — no invite link, so
// nothing expires, gets used up, or can be shared. Everything here is a no-op
// unless the Atoms OAuth creds are configured.

const DISCORD_API = "https://discord.com/api/v10";
const SCOPES = "identify guilds.join";

export const isDiscordJoinConfigured = (): boolean =>
  Boolean(
    env.DISCORD_OAUTH_CLIENT_ID &&
      env.DISCORD_OAUTH_CLIENT_SECRET &&
      env.DISCORD_OAUTH_REDIRECT_URI
  );

// ── CSRF state: random state -> the clipper's user id, single-use, short TTL.
// In-memory to match the existing YouTube/Instagram OAuth flows.
const STATE_TTL_MS = 10 * 60 * 1000;
const stateStore = new Map<string, { userId: string; at: number }>();

export const createDiscordJoinState = (userId: string): string => {
  const state = crypto.randomBytes(24).toString("base64url");
  stateStore.set(state, { userId, at: Date.now() });
  return state;
};

export const consumeDiscordJoinState = (state: string): string | null => {
  const entry = stateStore.get(state);
  if (!entry) return null;
  stateStore.delete(state); // single-use
  if (Date.now() - entry.at > STATE_TTL_MS) return null;
  return entry.userId;
};

export const buildDiscordAuthorizeUrl = (state: string): string => {
  const u = new URL("https://discord.com/oauth2/authorize");
  u.searchParams.set("client_id", env.DISCORD_OAUTH_CLIENT_ID as string);
  u.searchParams.set("redirect_uri", env.DISCORD_OAUTH_REDIRECT_URI as string);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", SCOPES);
  u.searchParams.set("state", state);
  // Always show consent so a re-auth actually re-issues guilds.join.
  u.searchParams.set("prompt", "consent");
  return u.toString();
};

type DiscordTokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
};

type TokenResult =
  | { ok: true; token: DiscordTokenResponse }
  | { ok: false; detail: string };

const tokenRequest = async (
  params: Record<string, string>
): Promise<TokenResult> => {
  const body = new URLSearchParams({
    client_id: env.DISCORD_OAUTH_CLIENT_ID as string,
    client_secret: env.DISCORD_OAUTH_CLIENT_SECRET as string,
    ...params,
  }).toString();
  try {
    const res = await axios.post(`${DISCORD_API}/oauth2/token`, body, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      validateStatus: () => true,
      timeout: 10_000,
    });
    if (res.status !== 200) {
      // Discord's token-error BODY (error / error_description) is safe to log and
      // surface — it identifies the problem (invalid_client, invalid_grant, …) and
      // never contains our secret; only the REQUEST body does. So we log/return
      // only res.data's error fields, never the axios error object or res.config.
      const code = (res.data?.error as string | undefined) ?? "unknown_error";
      const desc = (res.data?.error_description as string | undefined) ?? "";
      console.error("[discord-join] token request failed", res.status, code);
      return {
        ok: false,
        detail: `HTTP ${res.status} ${code}${desc ? ` — ${desc}` : ""}`,
      };
    }
    return { ok: true, token: res.data as DiscordTokenResponse };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown error";
    console.error("[discord-join] token request errored", msg);
    return { ok: false, detail: `request error: ${msg}` };
  }
};

const upsertGrant = async (
  userId: string,
  discordId: string,
  token: DiscordTokenResponse
) => {
  const values = {
    user_id: userId,
    discord_id: discordId,
    access_token: token.access_token,
    refresh_token: token.refresh_token,
    scope: token.scope,
    expires_at: new Date(Date.now() + token.expires_in * 1000),
  };
  await db
    .insert(discord_oauth_grants)
    .values(values)
    .onDuplicateKeyUpdate({
      set: {
        discord_id: values.discord_id,
        access_token: values.access_token,
        refresh_token: values.refresh_token,
        scope: values.scope,
        expires_at: values.expires_at,
      },
    });
};

// Exchange the callback code, VERIFY the authorized account is the clipper's
// own linked Discord account, and store the grant.
export const exchangeCodeAndStoreGrant = async (
  code: string,
  expectedUserId: string
): Promise<{ ok: true } | { ok: false; error: string }> => {
  const tokenRes = await tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: env.DISCORD_OAUTH_REDIRECT_URI as string,
  });
  if (!tokenRes.ok) {
    // Surface Discord's own reason so a misconfig (bad secret → invalid_client,
    // wrong redirect → invalid_grant) is diagnosable straight from the UI.
    return {
      ok: false,
      error: `Discord rejected the authorization (${tokenRes.detail}).`,
    };
  }
  const token = tokenRes.token;

  const me = await axios.get(`${DISCORD_API}/users/@me`, {
    headers: { Authorization: `Bearer ${token.access_token}` },
    validateStatus: () => true,
    timeout: 10_000,
  });
  const discordId = me.status === 200 ? String(me.data?.id ?? "") : "";
  if (!discordId) {
    return {
      ok: false,
      error: `Couldn't read your Discord account (HTTP ${me.status}).`,
    };
  }

  // The linchpin of "only their own account": the account that authorized MUST
  // be the one tied to their web-app profile (ctx.user.id is their Discord id).
  // Name both accounts so the clipper knows exactly which one to use.
  if (discordId !== expectedUserId) {
    const [profile] = await db
      .select({ username: user_clerk.discord_username })
      .from(user_clerk)
      .where(eq(user_clerk.discord_id, expectedUserId))
      .limit(1);
    const expected = profile?.username
      ? `@${profile.username}`
      : "the Discord account linked to your profile";
    const authorized = me.data?.username
      ? `@${me.data.username}`
      : "a different account";
    return {
      ok: false,
      error: `You authorized ${authorized}, but your Atomik profile is linked to ${expected}. Switch Discord accounts and authorize with ${expected}.`,
    };
  }
  await upsertGrant(expectedUserId, discordId, token);
  return { ok: true };
};

// A currently-valid access token for the user, refreshing if it's near expiry.
const getValidGrantAccessToken = async (
  userId: string
): Promise<string | null> => {
  const [grant] = await db
    .select()
    .from(discord_oauth_grants)
    .where(eq(discord_oauth_grants.user_id, userId))
    .limit(1);
  if (!grant) return null;
  if (grant.expires_at.getTime() - Date.now() > 60_000) return grant.access_token;

  // Expired: try to refresh. A dead refresh token (clipper deauthorized "Atoms",
  // changed their Discord password, or was inactive too long) can't be revived —
  // DROP the row so hasDiscordJoinGrant() returns false and the UI routes them
  // back to re-consent, instead of a permanent "grant exists but broken" error.
  const refreshed = grant.refresh_token
    ? await tokenRequest({
        grant_type: "refresh_token",
        refresh_token: grant.refresh_token,
      })
    : null;
  if (!refreshed || !refreshed.ok) {
    await db
      .delete(discord_oauth_grants)
      .where(eq(discord_oauth_grants.user_id, userId));
    return null;
  }
  await upsertGrant(userId, grant.discord_id, refreshed.token);
  return refreshed.token.access_token;
};

export const hasDiscordJoinGrant = async (userId: string): Promise<boolean> => {
  const [g] = await db
    .select({ id: discord_oauth_grants.id })
    .from(discord_oauth_grants)
    .where(eq(discord_oauth_grants.user_id, userId))
    .limit(1);
  return Boolean(g);
};

// Add the clipper's own account to a guild using their stored grant. Idempotent
// (Discord returns 204 if they're already in), so it doubles as "re-join".
export const joinGuildViaGrant = async (
  userId: string,
  guildId: string
): Promise<{ added: boolean; detail: string }> => {
  // Never throws — a Discord/network error must not unwind the caller (e.g. the
  // approval mutation must still persist even if the join fails).
  try {
    const accessToken = await getValidGrantAccessToken(userId);
    if (!accessToken) {
      return {
        added: false,
        detail: "no valid Discord join grant for this user",
      };
    }
    return await addMemberWithAccessToken(guildId, userId, accessToken);
  } catch (err) {
    console.error(
      "[discord-join] join via grant errored",
      err instanceof Error ? err.message : "unknown error"
    );
    return { added: false, detail: "join errored" };
  }
};
