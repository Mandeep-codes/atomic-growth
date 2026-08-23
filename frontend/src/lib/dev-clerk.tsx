import type { ReactNode } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// LOCAL DEV STUB FOR @clerk/clerk-react
//
// The real ClerkProvider refuses to mount without a valid publishable key, so
// with no Clerk credentials the app doesn't render at all — not "you can't log
// in", the whole tree fails. This module stands in for the package so the UI
// boots and behaves as a signed-in user.
//
// vite.config.ts aliases "@clerk/clerk-react" to this file ONLY when
// VITE_LOCAL_DEV=true, so a normal build still imports the real SDK. Its
// backend counterpart is lib/dev-auth.ts (LOCAL_DEV_NO_AUTH).
//
// Only the surface this app actually consumes is implemented. If a component
// starts using another Clerk export, add it here or the build breaks with a
// missing-export error — which is the loud failure we want, not a silent one.
// ─────────────────────────────────────────────────────────────────────────────

// Mirrors trpc.ts ROLES so every admin route is reachable. useRole() reads
// publicMetadata.roles, and AdminRoute gates on it.
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

// VITE_LOCAL_DEV_ROLES=clipper renders the app as a plain clipper sees it —
// no admin nav, no moderator surfaces. Must be set alongside the backend's
// LOCAL_DEV_ROLES=clipper: this half hides the UI, that half actually refuses
// the admin procedures, and reviewing the clipper experience with only one of
// them set would show admin links that 403 (or hide links that still work).
const AS_CLIPPER = import.meta.env.VITE_LOCAL_DEV_ROLES === "clipper";
const ACTIVE_ROLES = AS_CLIPPER ? [] : DEV_ROLES;

const devUser = {
  id: "user_localdev",
  firstName: "Local",
  lastName: "Dev",
  fullName: "Local Dev",
  username: "local-dev",
  imageUrl: "",
  primaryEmailAddress: { emailAddress: "local-dev@example.com" },
  emailAddresses: [{ emailAddress: "local-dev@example.com" }],
  publicMetadata: { roles: ACTIVE_ROLES } as Record<string, unknown>,
  externalAccounts: [{ provider: "oauth_discord", externalId: "000000000000000001" }],
  createdAt: new Date("2024-01-01T00:00:00.000Z"),
  updatedAt: new Date("2024-01-01T00:00:00.000Z"),
};

// Accepts (and ignores) the real provider's props — publishableKey,
// afterSignOutUrl, appearance — so main.tsx needs no changes.
export const ClerkProvider = ({
  children,
}: {
  children: ReactNode;
  [key: string]: unknown;
}) => <>{children}</>;

// VITE_LOCAL_DEV_SIGNED_OUT=true pretends nobody is logged in, so the public
// landing page and /explore can be reviewed the way a visitor sees them.
// Local scaffolding only — this whole file is swapped in for @clerk/clerk-react
// by vite.config.ts and never ships.
// Completing the onboarding flow flips this off, so a demo can be walked
// end to end: landing (signed out) -> explore -> onboarding -> dashboard.
// Onboarding does a full page load on finish, which re-evaluates this module.
// Clear it with localStorage.removeItem("dev-onboarded") to start over.
const SIGNED_OUT =
  (import.meta.env.VITE_LOCAL_DEV_SIGNED_OUT === "true" &&
    (typeof window === "undefined" ||
      window.localStorage.getItem("dev-onboarded") !== "true")) ||
  // ── Sign out has to actually do something locally ──
  // It was a no-op, so pressing Log out left you signed in and "/" just
  // re-rendered the dashboard — the button looked broken and the signed-out
  // journey could not be walked without editing .env and restarting Vite.
  // Same localStorage trick the onboarding flag above already uses.
  // Clear it with localStorage.removeItem("dev-signed-out").
  (typeof window !== "undefined" &&
    window.localStorage.getItem("dev-signed-out") === "true");

export const useUser = () => ({
  user: SIGNED_OUT ? null : devUser,
  isLoaded: true,
  isSignedIn: !SIGNED_OUT,
});

export const useAuth = () => ({
  // The backend ignores this value entirely when LOCAL_DEV_NO_AUTH=true — it
  // short-circuits before token verification. It's returned only so the tRPC
  // link sends a well-formed Authorization header.
  getToken: async () => "local-dev-token",
  signOut: async () => {
    // Full page load, not a router navigation: SIGNED_OUT is evaluated once
    // when this module loads, so an in-app navigate would still read the old
    // value and land back on the dashboard.
    if (typeof window !== "undefined") {
      window.localStorage.setItem("dev-signed-out", "true");
      window.localStorage.removeItem("dev-onboarded");
      window.location.assign("/");
    }
  },
  isSignedIn: !SIGNED_OUT,
  isLoaded: true,
  userId: SIGNED_OUT ? null : devUser.id,
  sessionId: "sess_localdev",
});

export const useClerk = () => ({
  signOut: async () => {
    // Full page load, not a router navigation: SIGNED_OUT is evaluated once
    // when this module loads, so an in-app navigate would still read the old
    // value and land back on the dashboard.
    if (typeof window !== "undefined") {
      window.localStorage.setItem("dev-signed-out", "true");
      window.localStorage.removeItem("dev-onboarded");
      window.location.assign("/");
    }
  },
  user: devUser,
});

export const SignedIn = ({ children }: { children: ReactNode }) =>
  SIGNED_OUT ? null : <>{children}</>;

export const SignedOut = ({ children }: { children: ReactNode }) =>
  SIGNED_OUT ? <>{children}</> : null;

// Clerk's real buttons accept mode="modal" | "redirect" and either wrap a child
// or render their own. Locally we're always signed in, so these just render
// whatever they were given (or a inert placeholder) without navigating.
const PassthroughButton = ({
  children,
  label,
}: {
  children?: ReactNode;
  label: string;
}) => {
  if (children) return <>{children}</>;
  return (
    <button type="button" disabled title="Disabled — auth is stubbed locally">
      {label}
    </button>
  );
};

export const SignInButton = ({
  children,
}: {
  children?: ReactNode;
  mode?: "modal" | "redirect";
  [key: string]: unknown;
}) => <PassthroughButton label="Sign in">{children}</PassthroughButton>;

export const SignUpButton = ({
  children,
}: {
  children?: ReactNode;
  mode?: "modal" | "redirect";
  [key: string]: unknown;
}) => <PassthroughButton label="Sign up">{children}</PassthroughButton>;

export const UserButton = (_: { afterSignOutUrl?: string; [key: string]: unknown }) => (
  <div
    title="Local Dev — auth is stubbed"
    style={{
      width: 28,
      height: 28,
      borderRadius: "50%",
      background: "#6c5ce7",
      color: "#fff",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: 12,
      fontWeight: 600,
      userSelect: "none",
    }}
  >
    LD
  </div>
);
