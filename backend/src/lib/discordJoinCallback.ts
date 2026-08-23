import type { Request, Response } from "express";
import {
  consumeDiscordJoinState,
  exchangeCodeAndStoreGrant,
} from "./discordJoin";
import { env } from "./env";

const FRONTEND_ORIGIN = env.CORS_ORIGIN;

const renderResponse = (res: Response, payload: Record<string, unknown>) => {
  const script = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Discord</title>
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
      window.close();
    })();
  </script>
  <p>You can close this window and return to Atomik Clips.</p>
</body>
</html>`;
  res.setHeader("Content-Type", "text/html");
  res.send(script);
};

export const discordJoinCallback = async (req: Request, res: Response) => {
  const { code, state, error } = req.query as Record<
    string,
    string | undefined
  >;

  if (error) {
    return renderResponse(res, { type: "discord-join", success: false, error });
  }
  if (!code || !state) {
    return renderResponse(res, {
      type: "discord-join",
      success: false,
      error: "Missing authorization code or state",
    });
  }

  // Ties the callback to the clipper who started the flow (CSRF-safe, single-use).
  const userId = consumeDiscordJoinState(state);
  if (!userId) {
    return renderResponse(res, {
      type: "discord-join",
      success: false,
      error: "This link expired — please start the Discord connect again.",
    });
  }

  try {
    const result = await exchangeCodeAndStoreGrant(code, userId);
    if (!result.ok) {
      return renderResponse(res, {
        type: "discord-join",
        success: false,
        error: result.error,
      });
    }
    return renderResponse(res, { type: "discord-join", success: true });
  } catch (err) {
    console.error("Discord join callback failed", err);
    return renderResponse(res, {
      type: "discord-join",
      success: false,
      error: err instanceof Error ? err.message : "Failed to connect Discord",
    });
  }
};
