import { randomUUID } from "crypto";
import { google } from "googleapis";
import { env } from "./env";

const SESSION_TTL_MS = 1000 * 60 * 10; // 10 minutes

interface OAuthSession {
  userId: string;
  createdAt: number;
}

const sessions = new Map<string, OAuthSession>();

const createOAuthClient = () =>
  new google.auth.OAuth2(
    env.GOOGLE_OAUTH_CLIENT_ID,
    env.GOOGLE_OAUTH_CLIENT_SECRET,
    env.GOOGLE_OAUTH_REDIRECT_URI
  );

export const createYoutubeOAuthSession = (userId: string) => {
  const state = randomUUID();
  sessions.set(state, { userId, createdAt: Date.now() });

  const oauth2Client = createOAuthClient();
  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [
      "https://www.googleapis.com/auth/youtube.readonly",
      "https://www.googleapis.com/auth/yt-analytics.readonly",
    ],
    state,
  });

  return { state, url };
};

export const consumeYoutubeOAuthSession = (state: string) => {
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

export const getYoutubeOAuthClient = createOAuthClient;
