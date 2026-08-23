import type { Request, Response } from "express";
import {
  getYoutubeOAuthClient,
  consumeYoutubeOAuthSession,
} from "./youtubeOAuth";
import { env } from "./env";

const FRONTEND_ORIGIN = env.CORS_ORIGIN;

const renderResponse = (res: Response, payload: Record<string, unknown>) => {
  const script = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>YouTube OAuth</title>
  <style>
    body { font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 2rem; }
  </style>
</head>
<body>
  <script>
    (function () {
      const payload = ${JSON.stringify(payload).replace(/</g, "\\u003c")};
      if (window.opener && '${FRONTEND_ORIGIN}') {
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

export const youtubeOAuthCallback = async (req: Request, res: Response) => {
  const { code, state, error } = req.query as Record<
    string,
    string | undefined
  >;

  if (error) {
    return renderResponse(res, {
      type: "youtube-oauth",
      success: false,
      state,
      error,
    });
  }

  if (!code || !state) {
    return renderResponse(res, {
      type: "youtube-oauth",
      success: false,
      state,
      error: "Missing authorization code or state",
    });
  }

  const session = consumeYoutubeOAuthSession(state);
  if (!session) {
    return renderResponse(res, {
      type: "youtube-oauth",
      success: false,
      state,
      error: "OAuth session expired or invalid",
    });
  }

  try {
    const oauth2Client = getYoutubeOAuthClient();
    const { tokens } = await oauth2Client.getToken(code);

    return renderResponse(res, {
      type: "youtube-oauth",
      success: true,
      state,
      userId: session.userId,
      tokens,
    });
  } catch (err) {
    console.error("YouTube OAuth callback failed", err);
    return renderResponse(res, {
      type: "youtube-oauth",
      success: false,
      state,
      error: err instanceof Error ? err.message : "Failed to exchange code",
    });
  }
};
