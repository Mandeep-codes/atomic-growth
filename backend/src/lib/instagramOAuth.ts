import { randomUUID } from "crypto";
import { env } from "./env";

const SESSION_TTL_MS = 1000 * 60 * 10; // 10 minutes
const INSTAGRAM_CONSENT_URL = "https://www.instagram.com/consent/";

interface OAuthSession {
  userId: string;
  createdAt: number;
}

const sessions = new Map<string, OAuthSession>();

export const createInstagramOAuthSession = (userId: string) => {
  const state = randomUUID();
  sessions.set(state, { userId, createdAt: Date.now() });

  const consentParams = {
    client_id: env.INSTAGRAM_APP_ID,
    redirect_uri: env.INSTAGRAM_OAUTH_REDIRECT_URI,
    response_type: "code",
    state,
    scope: [
      "instagram_business_basic",
      "instagram_business_manage_insights",
    ].join("-"),
    logger_id: randomUUID(),
    app_id: env.INSTAGRAM_APP_ID,
    platform_app_id: env.INSTAGRAM_APP_ID,
  } satisfies Record<string, string>;

  const url = new URL(INSTAGRAM_CONSENT_URL);
  url.searchParams.set("flow", "ig_biz_login_oauth");
  url.searchParams.set("params_json", JSON.stringify(consentParams));
  url.searchParams.set("source", "oauth_permissions_page_www");
  url.hash = "weblink";

  return { state, url: url.toString() };
};

export const consumeInstagramOAuthSession = (state: string) => {
  const session = sessions.get(state);
  if (!session) {
    return null;
  }

  sessions.delete(state);

  if (Date.now() - session.createdAt > SESSION_TTL_MS) {
    return null;
  }

  return session;
};
