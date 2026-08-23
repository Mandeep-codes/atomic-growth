import type { Request, Response } from "express";
import { consumeInstagramOAuthSession } from "./instagramOAuth";
import { env } from "./env";

const FRONTEND_ORIGIN = env.CORS_ORIGIN;
const TOKEN_EXCHANGE_URL =
  "https://graph.facebook.com/v21.0/oauth/access_token";

const renderResponse = (res: Response, payload: Record<string, unknown>) => {
  const script = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Instagram OAuth</title>
  <style>
    body { font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 2rem; }
  </style>
</head>
<body>
  <script>
    (function () {
      const payload = ${JSON.stringify(payload).replace(/</g, "\\u003c")};
      if (window.opener && '${FRONTEND_ORIGIN}') {
        console.log('posting message', payload);
        window.opener.postMessage(payload, '${FRONTEND_ORIGIN}');
      }
    })();
  </script>
  <p>You can close this window and return to Atomik Clips.</p>
</body>
</html>`;

  res.setHeader("Content-Type", "text/html");
  res.send(script);
};

export const instagramOAuthCallback = async (req: Request, res: Response) => {
  const { code, state, error } = req.query as Record<
    string,
    string | undefined
  >;

  if (error) {
    return renderResponse(res, {
      type: "instagram-oauth",
      success: false,
      state,
      error,
    });
  }

  if (!code || !state) {
    return renderResponse(res, {
      type: "instagram-oauth",
      success: false,
      state,
      error: "Missing authorization code or state",
    });
  }

  const session = consumeInstagramOAuthSession(state);
  if (!session) {
    return renderResponse(res, {
      type: "instagram-oauth",
      success: false,
      state,
      error: "OAuth session expired or invalid",
    });
  }

  try {
    const response = await fetch(
      "https://api.instagram.com/oauth/access_token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: env.INSTAGRAM_APP_ID,
          client_secret: env.INSTAGRAM_APP_SECRET,
          redirect_uri: env.INSTAGRAM_OAUTH_REDIRECT_URI,
          code,
          grant_type: "authorization_code",
        }),
      }
    );
    const tokens = await response.json();

    if (!response.ok) {
      throw new Error(
        tokens?.error?.message ||
          "Failed to exchange Instagram authorization code"
      );
    }

    return renderResponse(res, {
      type: "instagram-oauth",
      success: true,
      state,
      userId: session.userId,
      tokens,
    });
  } catch (err) {
    console.error("Instagram OAuth callback failed", err);
    return renderResponse(res, {
      type: "instagram-oauth",
      success: false,
      state,
      error: err instanceof Error ? err.message : "Failed to exchange code",
    });
  }
};
