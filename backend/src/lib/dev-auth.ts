import { env } from "./env";

// ─────────────────────────────────────────────────────────────────────────────
// LOCAL DEV AUTH BYPASS
//
// Normally this app cannot run without Clerk: the frontend needs a publishable
// key just to mount, and every protected tRPC route verifies a Clerk-issued
// JWT. With no Clerk credentials there is no way to reach any authenticated
// surface — which makes local work impossible.
//
// When LOCAL_DEV_NO_AUTH=true, the auth middlewares short-circuit to the
// synthetic user below instead of calling Clerk. It holds every role, so admin
// surfaces are reachable. The matching frontend half is a stubbed
// @clerk/clerk-react — see frontend/src/lib/dev-clerk.tsx.
//
// TWO SAFETY PROPERTIES, both deliberate:
//
//   1. It can never run in production. The hard throw below aborts startup if
//      NODE_ENV=production, so a stray env var cannot silently deploy an
//      unauthenticated API.
//
//   2. It never WRITES to the database. Roles are injected in memory rather
//      than read from user_roles, and no user_clerk row is created. That makes
//      it safe to point a local checkout at a shared or production database
//      for read-only inspection without seeding rows into it.
// ─────────────────────────────────────────────────────────────────────────────

if (env.LOCAL_DEV_NO_AUTH && env.NODE_ENV === "production") {
  throw new Error(
    "LOCAL_DEV_NO_AUTH=true is not allowed with NODE_ENV=production — refusing to start with authentication disabled."
  );
}

export const DEV_AUTH_ENABLED =
  env.LOCAL_DEV_NO_AUTH && env.NODE_ENV !== "production";

// Every role in trpc.ts ROLES. Kept as literals rather than importing ROLES to
// avoid a circular import (trpc.ts imports this module). If a role is added
// there, add it here too.
const DEV_ROLES = [
  "god-mode",
  "user-roles-admin",
  "campaign-editor",
  "rewards-modifier",
  "submission-reviewer",
  "payouts-admin",
  "demographics-reviewer",
  "user-activity-read",
  "notification-announcements-admin",
  "influencer-submission-editor",
  "influencer-campaign-editor",
  "submission-view-cap-manager",
  "sos",
];

// The identity the bypass assumes. user_id across this codebase is the DISCORD
// id, so that is what this must look like.
//
// Set LOCAL_DEV_USER_ID to an EXISTING clipper's Discord id to browse the app
// as that person — the only way the dashboards show real rows when pointed at
// a populated database. Left unset, you get a synthetic id that owns no data,
// so submissions/earnings screens render empty. Neither option writes anything.
export const DEV_DISCORD_ID = env.LOCAL_DEV_USER_ID ?? "000000000000000001";

// LOCAL_DEV_ROLES=clipper drops every admin role, so the app renders exactly
// what a normal clipper sees — no admin nav, no moderator-only surfaces. The
// role set is the ONLY difference; the identity and data stay the same, which
// is what makes it a faithful preview rather than a separate mode.
const DEV_AS_CLIPPER = env.LOCAL_DEV_ROLES === "clipper";
const activeRoles = DEV_AS_CLIPPER ? [] : DEV_ROLES;

export const devUser = {
  id: DEV_DISCORD_ID,
  email: "local-dev@example.com",
  firstName: "Local",
  lastName: "Dev",
  roles: activeRoles,
  discordId: DEV_DISCORD_ID,
  discordUsername: "local-dev",
  clerkUserId: "user_localdev",
  clerkUserCreatedAt: new Date("2024-01-01T00:00:00.000Z"),
};

if (DEV_AUTH_ENABLED) {
  console.warn(
    `🔓 LOCAL_DEV_NO_AUTH is ON — auth is bypassed. Acting as Discord id ${DEV_DISCORD_ID} ${
      DEV_AS_CLIPPER ? "as a PLAIN CLIPPER (no admin roles)" : "with all roles"
    }. Never use this against a production deployment.`
  );
}
