import express from "express";
import cors from "cors";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { migrate } from "drizzle-orm/mysql2/migrator";
import path from "path";
import { appRouter } from "./routers";
import { env } from "./lib/env";
import { db } from "./lib/db";
import { reconcileLegacyDrizzleMigrations } from "./lib/baseline-migrations";
import { seedSosRole } from "./lib/seed-sos-role";
import { setupInboundWebhook } from "./inbound-webhook";
import { inngest } from "./lib/inngest";
import { serve } from "inngest/express";
import { functions } from "./inngest-functions";
import { youtubeOAuthCallback } from "./lib/youtubeOAuthCallback";
import { instagramOAuthCallback } from "./lib/instagramOAuthCallback";
import { discordJoinCallback } from "./lib/discordJoinCallback";

const app: express.Application = express();
const PORT = env.PORT;

// Middleware
app.use(
  cors({
    origin: [
      env.CORS_ORIGIN,
      "http://localhost:8080",
      "http://localhost:5173",
      "http://localhost:3001",
    ],
    credentials: true,
  })
);

app.use(express.json({ limit: "5mb" }));

app.get("/auth/youtube/callback", youtubeOAuthCallback);
app.get("/auth/instagram/callback", instagramOAuthCallback);
app.get("/auth/discord/join/callback", discordJoinCallback);

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    environment: env.NODE_ENV,
  });
});

// Inbound (https://inbound.new)
setupInboundWebhook(app);

// Inngest
app.use(
  "/api/inngest",
  serve({
    client: inngest,
    functions,
    signingKey: env.INNGEST_SIGNING_KEY,
    serveHost: env.INNGEST_SERVE_HOST ?? `http://localhost:${PORT}`,
    servePath: env.INNGEST_SERVE_PATH ?? "/api/inngest",
  })
);

// tRPC middleware
app.use(
  "/trpc",
  createExpressMiddleware({
    router: appRouter,
    createContext: ({ req }) => {
      // Return context with request object for authentication
      return {
        req,
      };
    },
  })
);

// Error handling middleware
app.use(
  (
    err: Error,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    console.error("Error:", err);
    res.status(500).json({
      error: "Internal server error",
      message:
        env.NODE_ENV === "development" ? err.message : "Something went wrong",
    });
  }
);

// 404 handler
app.use("*", (req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.log("SIGTERM received, shutting down gracefully");
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("SIGINT received, shutting down gracefully");
  process.exit(0);
});

// Apply any pending Drizzle migrations BEFORE serving traffic.
//
// Two phases:
//   1. reconcileLegacyDrizzleMigrations — rewrites legacy "tag-as-hash" rows
//      in __drizzle_migrations (left over from older drizzle-kit versions)
//      to use the sha256 format current drizzle-orm expects. Without this,
//      the migrator below would falsely think historical migrations are
//      unapplied and try to re-run them against tables that already exist,
//      crashing startup. (Idempotent: a no-op once reconciled.)
//   2. drizzle's migrate() — applies any genuinely new migrations.
//
// On failure the process exits non-zero. DigitalOcean App Platform treats
// a failed start as a deploy failure, keeps the previous container live,
// and shows the error in the deploy log.
async function start() {
  const migrationsFolder = path.resolve(process.cwd(), "drizzle");
  try {
    console.log(`📦 Reconciling migration baseline against ${migrationsFolder}…`);
    await reconcileLegacyDrizzleMigrations(db, migrationsFolder);
    console.log(`📦 Running pending migrations…`);
    await migrate(db, { migrationsFolder });
    console.log("✅ Migrations up to date");
  } catch (err) {
    console.error("❌ Migration failed — aborting startup", err);
    process.exit(1);
  }

  // Ensure the SOS role + its grants exist. Idempotent + self-guarded; never
  // throws, so it can't abort startup.
  await seedSosRole();

  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📊 Health check: http://localhost:${PORT}/health`);
    console.log(`🔗 tRPC endpoint: http://localhost:${PORT}/trpc`);
    console.log(`🌍 Environment: ${env.NODE_ENV}`);
  });
}

void start();

export { app };
