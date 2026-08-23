# Atomik Clips — Redesign Implementation Map

**Status:** read-only audit of `C:/Users/Zain Khan/Desktop/atomik-upstream` as it exists today.
**Scope:** everything a designer-developer needs to rebuild a screen without opening the backend.
**This document describes what EXISTS. It contains no proposals, no mock data, and no redesign suggestions.**

---

## 1. How to read this document, and the one rule

### The one rule

> **Presentation may change. Product logic may not.**

Concretely, for every screen in this map:

| You MAY change | You MAY NOT change |
| --- | --- |
| Layout, spacing, typography, colour, iconography | Which tRPC procedure is called, with what input |
| Component composition and file structure — *as long as the behaviours below survive* | Which condition controls whether a piece of UI renders |
| Copy that is purely decorative (headings, section labels) | Any string that states a rule, a consequence, or a money outcome |
| Loading/empty/error *styling* | Whether a loading/empty/error state exists at all, or which branch it falls into |
| Where a control sits on the page | Whether a control is enabled, and what its `disabled` expression is |
| — | Query `enabled:` flags, `staleTime`, `retry`, `refetchInterval` overrides |
| — | What is invalidated (or deliberately not invalidated) after a mutation |
| — | Where a navigation lands, and whether it is `replace` or `push` |
| — | localStorage / sessionStorage / URL-param keys |

**If you cannot tell whether something is presentation or logic, it is logic.** Section 4 (Cross-cutting invariants) and Section 5 (Risk register) list the specific things that look cosmetic and are not.

### How each subsystem section is organised

1. **Flow** — step by step, as it works today.
2. **Procedures** — exact `router.procedure` names, kind, auth, and input schema.
3. **Fields collected** — every field, its type, whether required, and where it lives.
4. **Validation** — every rule, where enforced, and the exact error text.
5. **Visibility** — every condition that gates a piece of UI.
6. **After submit** — navigation, invalidation, toasts, status changes.
7. **Ineligible / incomplete / already-completed**.
8. **Loading, empty and error states as they exist today.**

### Conventions

- `file.ts:123` = file path and line number as read during the audit. Line numbers are from the working copy audited; treat them as a strong hint, not a guarantee after any edit.
- **Quoted strings are exact.** Do not reword, re-punctuate or re-case them. Punctuation inconsistency between neighbouring messages is real and is called out where it exists.
- ⚠️ **DISPUTED / UNVERIFIED** marks a claim where the readers disagreed or could not confirm from code. These are *not* resolved here. Do not pick a side; check the code.
- **NOT DETERMINABLE FROM CODE** is a valid entry and appears in Section 6.

### The four biggest surprises, up front

1. **Plain clippers have no sidebar and no mobile nav.** `showSidebar = isSignedIn && roles.length > 0` (`frontend/src/components/AppLayout.tsx:30`). A clipper has zero roles. Their entire app is one page — `/` — with six real page components inlined into it. Every screenshot showing a nav drawer was taken on a staff account.
2. **`/onboarding` writes nothing.** It is a UI shell that makes zero tRPC calls and persists nothing (`frontend/src/pages/Onboarding.tsx:16-30`). Its "Send code" button is a local `setState`. There is no SMS provider anywhere in the repo.
3. **Feature flags are hardcoded in a client file**, resolved against the user's email (`frontend/src/lib/featureFlags.ts`). Two of five are on for everyone; three are on only for a named list. Branches you never see in testing are live for six people.
4. **Money is held per campaign, and released on APPROVAL, not on submission** (`backend/src/lib/demographics-reset.ts`). Several UI strings imply otherwise; they are quoted verbatim below and must not be "corrected".

---

## 2. Route map

Every route below is registered in `frontend/src/App.tsx`. Guards: `<ProtectedRoute>` = Clerk session required (`frontend/src/components/ProtectedRoute.tsx:14-27`, spinner while `!isLoaded`, then `<Navigate to={/auth?redirect=<encoded pathname+search+hash>} replace/>`). `<AdminRoute requiredRole=...>` = role gate that renders a full **page**, not a redirect (`frontend/src/components/AdminRoute.tsx:30-77`).

All routes sit inside `<MaintenanceGate>` (`App.tsx:102`).

### 2.1 Clipper-facing routes

| Path | Page component | Guard | Purpose |
| --- | --- | --- | --- |
| `/` | `HomeOrLanding` (App.tsx:80-90) → `pages/Home.tsx` (imported as `UserCampaigns`, App.tsx:18) signed in; `pages/Landing.tsx` signed out | **None** — session split, deliberately (App.tsx:77-79) | The clipper's entire app. Bento grid + six inlined page sections. |
| `/explore` | `pages/ExploreCampaigns.tsx` (App.tsx:111) | None | Public campaign catalogue. Own card design + `CampaignPreviewModal`. |
| `/onboarding` | `pages/Onboarding.tsx` (App.tsx:112) | **None** | 4-step wizard. **Persists nothing.** |
| `/auth` | `pages/Auth.tsx` (App.tsx:104) | None | Clerk hand-off. In `ALWAYS_ALLOWED_PATHS`. |
| `/reset-password` | `pages/ResetPassword.tsx` (App.tsx:105) | None (self-guards on `useAuth().user`) | **Dead/vestigial.** Nothing links to it; its submit is a stub. |
| `/privacy` | `pages/Privacy.tsx` (App.tsx:404) | None | In `ALWAYS_ALLOWED_PATHS`. |
| `/campaigns/active` | `pages/ChooseCampaigns.tsx` (imported as `ActiveCampaigns`, App.tsx:22; route 113-120) | ProtectedRoute | Card grid + `CampaignDetailDialog actionLabel="Add Clip"`. |
| `/campaign/:campaignId` | `pages/Index.tsx` (App.tsx:403) | **None** at route level; in-page gate `isUnlocked \|\| roles.includes("campaign-editor")` (Index.tsx:84) | Password-gated **client** dashboard. |
| `/campaign/:campaignId/category/:category` | `pages/CategoryView.tsx` (App.tsx:405-408) | None | Category drill-down from the client dashboard. |
| `/campaign/:campaignId/submit` | `submission-flow/submit-dashboard.tsx` (App.tsx:429-436) | `SubmissionFlowLayout` → `PrivateCampaignGate` only. **No ProtectedRoute.** | Per-account submit dashboard + non-campaign ledger. |
| `/campaign/:campaignId/step-1` | `submission-flow/step-1-sop.tsx` (App.tsx:437-444) | Same | SOP page. **Auto-skips itself** when the campaign has no SOP. |
| `/campaign/:campaignId/step-2` | `submission-flow/step-2-content.tsx` (App.tsx:445-452) | Same | **The actual submit form.** 3–4 inline steps. |
| `/campaign/:campaignId/step-3` | `submission-flow/step-3-finish.tsx` (App.tsx:453-460) | Same | Confetti success page. Makes no query; renders unconditionally. |
| `/campaign/:campaignId/non-campaign` | `pages/NonCampaignClipSubmit.tsx` (App.tsx:461-468) | **ProtectedRoute** + its own `<PrivateCampaignGate standalone>` | Non-campaign clip redemption form. |
| `/earnings` | `pages/Earnings.tsx` (App.tsx:570-577) | ProtectedRoute | Balance, hold panel, queued withdrawal, history. |
| `/earnings/claim` | `ClaimFlowLayout` step 1/3 → `claim-flow/step-0-select-method.tsx` (App.tsx:469-483) | ProtectedRoute | Bank vs crypto picker. **No eligibility re-check.** |
| `/earnings/claim/bank/details` | `claim-flow/step-1-bank-details.tsx` (App.tsx:484-498) | ProtectedRoute | Wise recipient CRUD + claim. |
| `/earnings/claim/bank/confirmation` | `claim-flow/step-2-confirmation.tsx` (App.tsx:499-513) | ProtectedRoute | Terminal card. Renders standalone. |
| `/earnings/claim/crypto/details` | `claim-flow/step-1-crypto-details.tsx` (App.tsx:514-530) | ProtectedRoute | Crypto address + amount. |
| `/earnings/claim/crypto/confirmation` | Same `ClaimConfirmationStep` (App.tsx:531-545) | ProtectedRoute | Same component as the bank confirmation. |
| `/submissions` | `pages/Submissions.tsx` (App.tsx:546-553) | ProtectedRoute | "My Campaigns" — grouped clip list. |
| `/bank-accounts` | `pages/BankAccounts.tsx` (App.tsx:554-561) | ProtectedRoute | Page H1 is "Receive Payments". Wise card + `CryptoPaymentsPanel`. |
| `/referrals` | `pages/ReferralCode.tsx` (App.tsx:562-569) | ProtectedRoute | Referral code, share card, referred users, "Were you referred?". |
| `/verification` | `pages/SocialVerification.tsx` (App.tsx:578-585) | ProtectedRoute | Four platform cards. |
| `/verification/flow` | `social-verification-flow/step-0-select-method.tsx` (App.tsx:586-593) | ProtectedRoute | Method chooser. Preserves the whole query string forward. |
| `/verification/flow/bio` | `social-verification-flow/bio-verification.tsx` (App.tsx:594-601) | ProtectedRoute | Bio/OTP flow. |
| `/verification/flow/create-login` | `social-verification-flow/login-verification.tsx` (App.tsx:602-609) | ProtectedRoute | Credential-generation flow. **Route is not flag-gated**, only the entry card is. |
| `/demographics-verification` | `pages/DemographicsVerificationList.tsx` (App.tsx:610-617) | ProtectedRoute | Outstanding per-claim requests. |
| `/demographics-verification/weekly` | `pages/WeeklyDemographics.tsx` (App.tsx:618-625) | ProtectedRoute | **The campaign-scoped ask + money-hold screen.** Not in the sidebar. |
| `/demographics-verify/:id` | `pages/DemographicsVerification.tsx` (App.tsx:626-633) | ProtectedRoute | Method router → YouTube / Instagram / Screenshot. |
| `/test-instagram-auth` | `pages/InstagramOauthTest.tsx` (App.tsx:634-641) | ProtectedRoute | Instagram OAuth scratch page. |
| `*` | `NotFound` (App.tsx:643) | None | Catch-all. |

### 2.2 Admin routes (context only — not part of the clipper redesign)

All are `<ProtectedRoute>` + `<AdminRoute requiredRole=...>` unless noted. Listed because several of them write state the clipper *feels* but never sees.

`/admin` (campaign-editor) · `/admin/submissions` (submission-reviewer) · `/admin/review-clip-v2` (submission-reviewer) · `/admin/private-campaigns` (submission-reviewer) · `/admin/alias-generator` (`requiredAnyRole` = 13 roles inline, App.tsx:166-180) · `/admin/influencer-submissions` · `/admin/influencer-submissions-log` · `/admin/influencer-campaigns` · `/admin/influencer-campaigns/new` · `/admin/influencer-campaigns/:campaignId` **(NO guard)** · `/influencer-campaigns/:campaignId` **(NO guard)** · `/admin/influencer-campaigns/:campaignId/edit` · `/admin/demographics-verification` (submission-reviewer) · `/admin/us-demographics` (demographics-reviewer + **server owner lock**) · `/admin/clipper-activity` (demographics-reviewer) · `/admin/leaderboard-tools` (campaign-editor) · `/admin/deleted-clip-reserves` · `/admin/rewards` · `/admin/rewards/manual` · `/admin/user-activity` · `/admin/dev-overlook` (**ProtectedRoute only**, server owner lock) · `/admin/bans` · `/admin/user-roles` · `/admin/payouts` · `/admin/crypto-payouts` · `/admin/notifications` · `/admin/sos` · `/admin/stable-id` · `/campaign/:campaignId/edit` (campaign-editor) · `/campaign/:campaignId/stats` (campaign-editor)

**Three admin pages silently drive clipper behaviour:**
- `/admin/clipper-activity` → `clipperActivity.suspend` writes the `campaign_suspensions` row that makes clip submission throw. The clipper's only other signal is a 14-day notification.
- `/admin/demographics-verification` → `requestCampaignReset` opens the ask that freezes a campaign's earnings.
- `/admin/sos` → `siteSettings.setMaintenanceMode` replaces the whole app for non-privileged users.

### 2.3 The app shell

`frontend/src/main.tsx`: `StrictMode` > `ThemeProvider(defaultTheme="dark", storageKey="atomik-clips-theme")` > `ThemedClerkProvider` > `App`.

`frontend/src/App.tsx:94-102`, in exactly this order:

```
TrpcProvider
  TooltipProvider
    Toaster        (shadcn)
    Sonner         (second, independent toast system)
    BrowserRouter
      PageViewTracker
      ReferralTracker
        AuthProvider          (pass-through fragment — provides no context)
          MaintenanceGate
            Routes
```

**Hard dependencies (do not reorder):**
- `TrpcProvider` must stay inside `ClerkProvider` — it calls `useAuth()` from `@clerk/clerk-react` (`TrpcProvider.tsx:14`).
- `MaintenanceGate` needs both `TrpcProvider` (query at `MaintenanceGate.tsx:21`) and `BrowserRouter` (`useLocation` at `:17`).
- `ReferralTracker` needs `TrpcProvider`, `BrowserRouter`, and to sit below `<Toaster/>`.
- `PageViewTracker` needs only `BrowserRouter`.
- `AuthProvider` (`hooks/useAuth.tsx:96-98`) is `return <>{children}</>`. Its position is decorative — but the `useAuth` hook exported from the same file is used everywhere.

**`AppLayout` and the nesting context** — `frontend/src/components/AppLayout.tsx`:

```
showSidebar = isSignedIn && roles.length > 0          // :30
nested      = useContext(InsideAppLayout)             // :19, :24
if (nested) return <>{children}</>                    // :38-40
```

`InsideAppLayout` is a module-private context (never exported). Every clipper page wraps *itself* in `<AppLayout>`; a nested one renders bare. **This is the only reason `Home.tsx` can inline six full page components.** Removing it renders seven nested sidebars/top bars.

Structure when not nested (`:43-51`): `InsideAppLayout.Provider` > `SidebarProvider(open, onOpenChange)` > `div.flex.min-h-screen` > `{showSidebar && <AppSidebar/>}` > `<main className="flex-1 overflow-auto">` containing `{showSidebar && <MobileFloatingNav/>}`, `<TopNav showSidebarTrigger={showSidebar}/>`, `<div className="flex-1">{children}</div>`.

`AppLayout` issues **no** tRPC calls and has **no** loading or error state. It reads only `user` and `roles`, so "still loading" and "clipper with no roles" are indistinguishable to it.

**`roles` is not a query.** `frontend/src/hooks/useRole.ts` (12 lines): `const roles = (user?.publicMetadata?.roles as string[]) ?? []`. It comes from Clerk publicMetadata, which the **backend** writes during token verification on a ~5-minute cadence (`backend/src/lib/trpc.ts:148-154`). There is no "my roles" procedure.

**`TopNav`** (`frontend/src/components/TopNav.tsx`) is the only chrome a clipper sees: `<SidebarTrigger/>` when `showSidebarTrigger`, logo + "Atomik Clips" wordmark linking to `/`, and — only when `user` — "Wallet balance" (`formatCurrency(claimable.balance)`, or the literal `—`, `:65`) plus an initials avatar linking to `/earnings` (`:70`).

⚠️ `showSidebarTrigger` exists because `Landing.tsx:23`, `ExploreCampaigns.tsx:219` and `Onboarding.tsx:108` render `<TopNav>` **outside** any `SidebarProvider`. Making the trigger unconditional throws `useSidebar must be used within a SidebarProvider.` (`ui/sidebar.tsx:39-43`) and white-screens the landing page.

### 2.4 Data plumbing — `frontend/src/components/TrpcProvider.tsx`

- Transport: **`httpLink`, not `httpBatchLink`** (`:72`). Each query is its own HTTP request.
- `transformer: superjson` at the client top level (`:94`), matching `backend/src/lib/trpc.ts:31-33`.
- `credentials: "include"` on every request (`:83`).
- `Authorization: Bearer ${token}` attached only when Clerk `getToken()` returns truthy (`:75, :81`). Signed out, the header is omitted — which is why the backend says `"No authorization token provided"` rather than a token-failure message.
- `new QueryClient()` with **no default options** (`:16`). react-query is **4.41.0**, so the inherited defaults are: `staleTime 0`, `cacheTime 5min`, queries retry **3×** with backoff, mutations retry 0, `refetchOnWindowFocus/Mount/Reconnect: true`.
- Only ~20 call sites in the whole frontend override any timing option.

**The 401 discrimination** (`:34-65, :86-88`) — this is the single most dangerous piece of plumbing:

```
on HTTP 401:
  if content-type is not JSON            -> do nothing        (:37-41)
  extract messages from the body         (:108-131)
  if any matches /token verification failed|invalid token/i
      -> await signOut(); window.location.href = "/auth"      (:30, :53-59)
  else -> do nothing; the calling component owns the error
```

Deliberately **not** matched, with a comment at `:46-52`: `"No authorization token provided"`. Also unmatched (by omission): `"User is banned"` and `"A linked Discord account is required"`.

`isSigningOutRef` (`:15, :19-20`) makes force-logout at most once per page. The redirect is a **full document navigation** — the QueryClient cache and all state are destroyed — and it does **not** carry a `?redirect=` param, unlike `ProtectedRoute`.

`forceLogout`'s `window.location.href` is in a `finally`, so it fires even if `signOut()` throws (`:29-31`).

### 2.5 `MaintenanceGate` — `frontend/src/components/MaintenanceGate.tsx`

```
maintenance?.enabled && user && isRolesLoaded && !isPrivileged && !onAllowedPath
  -> <MaintenanceScreen message={maintenance.message}/>
```
- `isPrivileged = roles.includes("sos") || roles.includes("god-mode")` (`:36-37`).
- `ALWAYS_ALLOWED_PATHS = ["/auth", "/reset-password", "/privacy"]`, matched by **`startsWith`** (`:14, :32-34`).
- `siteSettings.getMaintenanceStatus` polls `refetchInterval: 20_000`, `staleTime: 0`, `refetchOnWindowFocus: true` (`:21-30`). This is what makes the screen lift automatically.
- **Signed-out visitors are never gated.**
- Server side: every authed procedure throws `FORBIDDEN "MAINTENANCE_MODE"` (`backend/src/lib/trpc.ts:100-110`), and intentional `TRPCError`s are rethrown unmasked (`:186-193`) precisely so maintenance is never mistaken for a token failure.

### 2.6 `ReferralTracker` — `frontend/src/components/ReferralTracker.tsx`

Renders `null`. Mounted globally at `App.tsx:100`, outside every route and guard.

- Reads three query-param aliases: `referral_code`, `referralCode`, `ref` (`:8`).
- Validates via `referrals.validateCode`; on valid, writes localStorage key **`referral_code_v2`** (`:7, :30, :37, :44`) and toasts `"Referral applied"` / `"We'll apply this referral once your account is ready."`.
- On invalid: destructive toast `"Invalid referral link"` / `"The referral code in this link is no longer valid."` Nothing is stored.
- Once Clerk reports signed in, calls `referrals.attachReferralToUser` (`:117`).
- Reason strings (`:149-169`): `FEATURE_NOT_ELIGIBLE` → `"Referral codes only work for accounts created after the referral program launched."`; `HAS_REWARDS` → `"Referral codes must be applied before earning any rewards."`; `SELF_REFERRAL` → `"You can't refer yourself."`; `ALREADY_ATTACHED` → `"Your account already has a referral associated with it."`
- Success: `"Referral connected"` / `"Thanks for joining through a referral!"`, and the localStorage code is cleared.
- On throw: code cleared, `failedAttachCodeRef` set so it is never retried this session, toast `"Couldn't apply referral"` / `"Please try entering the referral code manually."`

⚠️ **UNVERIFIED:** `ReferralTracker.tsx:54` destructures `isPending` from a `useMutation` result, but the installed react-query is 4.41.0 where the flag is `isLoading`. If `isPending` is genuinely `undefined`, the in-flight guard at `:127` never trips. Do not "fix" this blind.

### 2.7 Feature flags — `frontend/src/lib/featureFlags.ts`

**Hardcoded in client source. Not server-driven. Not env-driven.** Verified by grep: no `featureFlag|feature_flag|FEATURE_FLAG` anywhere in `backend/src`, and no flag var in `frontend/src/lib/env.ts`.

`isFeatureEnabled(flagKey, userEmail)` (`:112-134`):
1. unknown key → `false` (`:118-120`)
2. `if (flag.enabled) return true` — **short-circuits before the email check** (`:122-125`)
3. `if (!userEmail) return false` (`:127-130`)
4. `return flag.emails.includes(userEmail)` — exact, case-**sensitive**, no trim (`:132-133`)

| Key | `enabled` | emails | Consumers |
| --- | --- | --- | --- |
| `EARNINGS_FF` | `false` (:26) | 17 | **NONE.** Zero call sites repo-wide. |
| `SOCIAL_LOGIN_VERIFICATION` | `true` (:49) | 12 (inert) | `social-verification-flow/step-0-select-method.tsx:46-56` |
| `TERMS_AND_CONDITIONS` | `false` (:67) | 6 | `SubmissionStep2.tsx:130-132`, `VerificationCardVerifyBio.tsx:36-38` |
| `DEMOGRAPHICS_VERIFICATION` | `true` (:79) | 13 (inert) | `AppSidebar.tsx:233-235`, `Earnings.tsx:46-48` |
| `DEMOGRAPHICS_ON_CAMPAIGN` | `false` (:97) | 6 | `Index.tsx:30-32` — **bound and never read again. Dead.** |

`useFeatureFlag(key)` returns `{ enabled, isLoading, userEmail }` (`hooks/useFeatureFlag.ts:19-29`). `isLoading` is consumed at **exactly one** of six call sites (`step-0-select-method.tsx:52`, which keeps the card visible during load to avoid a flash). The other five ignore it.

Email comes from `useAuth().user.email` = `primaryEmailAddress?.emailAddress || ""` (`hooks/useAuth.tsx:14`), coerced to `null` at `useFeatureFlag.ts:21`. Local dev (`VITE_LOCAL_DEV=true`) hardcodes `local-dev@example.com` (`lib/dev-clerk.tsx:53`) — on **no** allow-list.

> **Security note for the client, not a redesign item:** all 54 email addresses across the five lists are compiled verbatim into the public JS bundle, and flag resolution is entirely client-side with no server enforcement.

---

# 3. Subsystems

---

## 3.A Auth & Discord identity

### Flow

1. Signed-out visitor hits a `ProtectedRoute` → `<Navigate to={/auth?redirect=<encodeURIComponent(pathname+search+hash)>} replace/>` (`ProtectedRoute.tsx:22-27`).
2. `/auth` renders `AuthPanel` **twice** — mobile copy at `Auth.tsx:127-131`, desktop at `:166-168`. Card title "Atomik" + "Clips", description `"Sign in to access Atomik Clips"`.
3. `<SignedOut>` shows two buttons: "Sign In" (`<SignInButton mode="redirect">`, `Auth.tsx:67`) and "Sign Up" (`<SignUpButton mode="redirect">`, `:72`). **These hand off to Clerk's hosted portal.** The actual sign-in form is not in this repo.
4. `<SignedIn>` shows the text `"You are already signed in. Redirecting..."` (`:80-84`) while a `useEffect` runs `navigate(redirectUrl || "/")` (`:102-106`).
5. Footer: `"By continuing you agree to our"` + `<Link to="/privacy">Privacy Policy</Link>`.
6. On return, every tRPC request carries `Authorization: Bearer <Clerk token>`. `clerkAuthMiddleware` (`backend/src/lib/trpc.ts:41-195`) verifies it, resolves the **Discord id** as the app identity, checks bans, checks maintenance, loads roles, and — at most once per 5 minutes per user — upserts the `user_clerk` row and writes `publicMetadata.roles` + `lastSyncedAt` back to Clerk.

**Identity model:** `ctx.user.id` is the **Discord id** when one is linked, else the Clerk user id (`backend/src/lib/trpc.ts:75-79`). `user_roles.user_id` and `banned_users.user_id` are Discord ids.

### Discord server one-click join (the only Discord UI in the app)

Lives entirely in `frontend/src/components/PrivateCampaignApplySection.tsx`. Only reachable inside `CampaignDetailDialog` for a private campaign where the caller's application is **approved**.

State machine (`:194-246`):
- `getDiscordJoinStatus.data.configured === false` → the single line `"Your private Discord access is being set up — check back shortly."` No button.
- `application.discordJoinMethod === "oauth" && application.discordJoinedAt` → muted card `"You've been added to the private Discord server — find it in your server list. Not there?"` + outline **"Re-join"**.
- else button label = `hasGrant ? "Join server" : "Enable one-click join"` (`:236-238`).

Click handler `handleJoinClick` (`:97-169`): `setJoining(true)` → `joinPrivateDiscord`. If `{status:"joined"}` → toast `"You're in!"` / `"Added to the private Discord server — find it in your server list."`, then `onApplied()` + `joinStatusQuery.refetch()`. If `{status:"needs_auth"}` → `getDiscordJoinAuthorizeUrl` → `window.open(authorizeUrl, "discord-join", "width=500,height=850")` (**no `noopener` — deliberate**, `:151-156`) → `await waitForConsent` → on true, retry the join. `finally setJoining(false)`. **Never navigates.**

`waitForConsent` (`:112-144`): listens for `postMessage` where `event.origin === CALLBACK_ORIGIN` and `event.data.type === "discord-join"`. `CALLBACK_ORIGIN = new URL(import.meta.env.VITE_TRPC_URL).origin` (`:19-25`) — the **backend** origin, not the SPA origin. Also polls `popup.closed` every 500 ms and resolves `false` immediately so the button stops spinning; 5-minute timeout.

Backend callback (`backend/src/lib/discordJoinCallback.ts`, mounted `backend/src/index.ts:39` at `GET /auth/discord/join/callback`) always returns an HTML page that `postMessage`s `{type:"discord-join", success, error?}` to `window.opener` at `env.CORS_ORIGIN` then `window.close()`. Visible body text: `"You can close this window and return to Atomik Clips."`

### Procedures

| Procedure | Kind | Auth | Input | Returns / purpose |
| --- | --- | --- | --- | --- |
| `privateCampaigns.getDiscordJoinStatus` | query | protected | none | `{configured, hasGrant}`. `hasGrant` short-circuits to `false` when unconfigured. `privateCampaigns.ts:178-183` |
| `privateCampaigns.getDiscordJoinAuthorizeUrl` | mutation | protected | none | `{authorizeUrl}`; single-use CSRF state bound to `ctx.user.id`. `:187-196` |
| `privateCampaigns.joinPrivateDiscord` | mutation | protected + approved | `{campaignId: z.string().min(1)}` | `{status:"joined"}` or `{status:"needs_auth"}`. Idempotent (Discord 204). `:201-260` |
| `user.getProfile` | query | protected | none | `{discordId, firstName, lastName, email, phoneNumber, phoneCountryCode, imageUrl, createdAt}`. `user.ts:67-97` |
| `user.discordStatus` | query | protected | none | `{connected, username}`. **No frontend caller.** `user.ts:60-65` |
| `siteSettings.getMaintenanceStatus` | query | **public** (deliberately, `trpc.ts:98-99`) | none | Lets the SPA read the flag while every authed call is 403'd. |
| `roles.getRoles` / `getUserRoles` / `assignRole` / `removeUserRole` / `getAssignableUsers` | query/mutation | `userRolesAdminRoleProcedure` | see `backend/src/routers/roles.ts` | Admin role console. |
| `devOverlook.canView` | query | protected + hardcoded Discord id | none | `{allowed}`. Sidebar gate only. |
| `demographicsVerification.getUsDemographicsAccess` | query | protected + hardcoded owner | none | `{isOwner}`. Sidebar gate only. |

### Fields collected

**None in this repo for sign-in/sign-up.** `<SignInButton mode="redirect">` / `<SignUpButton mode="redirect">` (`Auth.tsx:67, 72`) hand off to Clerk's hosted account portal. Which providers are offered, what fields are collected, and the reset-password email flow are **configured in the Clerk dashboard and are NOT DETERMINABLE FROM CODE.** The only styling this repo applies is `appearance.baseTheme = @clerk/themes dark` when the app theme is dark (`main.tsx:19-21`).

`/reset-password` (dead) collects: `password` (`#password`, label "New Password", placeholder "Enter new password", `required`, `minLength={6}`) and `confirmPassword` (`#confirm-password`, label "Confirm Password", placeholder "Confirm new password", same constraints). Both disabled while `isLoading`.

### Validation

| Rule | Where | Exact message |
| --- | --- | --- |
| Bearer token present | server `trpc.ts:49-54` | `UNAUTHORIZED "No authorization token provided"` |
| Token verifies | server `trpc.ts:60-69, 186-194` | `UNAUTHORIZED "Invalid token"` / `UNAUTHORIZED "Token verification failed"` |
| Intentional TRPCErrors not masked | server `trpc.ts:180-188` | `if (error instanceof TRPCError) throw error;` |
| Banned | server `trpc.ts:82-89` | `UNAUTHORIZED "User is banned"` |
| Maintenance | server `trpc.ts:100-110` | `FORBIDDEN "MAINTENANCE_MODE"` |
| Discord link required (sync path only) | server `trpc.ts:119-124` | `UNAUTHORIZED "A linked Discord account is required"` |
| Role check (all 11 `*RoleProcedure` + `staffProcedure`) | server `trpc.ts:217-365` | `FORBIDDEN "User not authorized"` — **identical string for every role** |
| `LOCAL_DEV_NO_AUTH` in production | server, import time | `throw new Error("LOCAL_DEV_NO_AUTH=true is not allowed with NODE_ENV=production — refusing to start with authentication disabled.")` (`dev-auth.ts:28-32`) |
| Clerk key required | client `env.ts:9-12` | `"VITE_CLERK_PUBLISHABLE_KEY is required"` |
| Discord join configured | server `privateCampaigns.ts:188-193` | `PRECONDITION_FAILED "One-click Discord join isn't configured yet."` |
| Only approved may join | server `privateCampaigns.ts:214-219` | `FORBIDDEN "Only approved clippers can join the server."` |
| Campaign has a guild | server `privateCampaigns.ts:226-231` | `BAD_REQUEST "This campaign has no Discord server configured."` |
| Guild add failed | server `privateCampaigns.ts:255-259` | `INTERNAL_SERVER_ERROR \`Couldn't add you to the server: ${join.detail}\`` |
| Callback needs code+state | server `discordJoinCallback.ts:46-52` | postMessage `{success:false, error:"Missing authorization code or state"}` |
| CSRF state single-use, 10 min | server `discordJoin.ts:27-42` | `"This link expired — please start the Discord connect again."` |
| **Identity linchpin** — the Discord account that authorized must equal the caller's linked id | server `discordJoin.ts:166-182` | `` `You authorized ${authorized}, but your Atomik profile is linked to ${expected}. Switch Discord accounts and authorize with ${expected}.` `` where `expected` = `'@'+discord_username` or the literal `the Discord account linked to your profile`, `authorized` = `'@'+username` or `a different account` |
| Discord rejected the exchange | server `discordJoin.ts:81-99, 140-147` | `` `Discord rejected the authorization (HTTP ${status} ${code} — ${description}).` `` |
| Unreadable Discord identity | server `discordJoin.ts:157-161` | `` `Couldn't read your Discord account (HTTP ${me.status}).` `` |
| postMessage origin | client `PrivateCampaignApplySection.tsx:123-126` | silently ignored |

### Visibility

| UI | Condition | File |
| --- | --- | --- |
| Maintenance screen vs the app | `maintenance?.enabled && user && isRolesLoaded && !isPrivileged && !onAllowedPath` | `MaintenanceGate.tsx:32-47` |
| `/` dashboard vs landing | `useUser().isSignedIn`; `!isLoaded` → spinner | `App.tsx:80-90` |
| Any `AdminRoute` child | `requiredAnyRole ? some(includes) : requiredRole ? includes : false` — **with neither prop it always denies** | `AdminRoute.tsx:24-28` |
| Sidebar + MobileFloatingNav | `isSignedIn && roles.length > 0` | `AppLayout.tsx:26-30, 46-48` |
| Sidebar "Demographic Verification" | `+ useFeatureFlag("DEMOGRAPHICS_VERIFICATION").enabled` | `AppSidebar.tsx:297-305` |
| Sidebar Admin group | `filteredAdminMenuItems.length > 0` | `AppSidebar.tsx:333-336` |
| Sidebar "US Demographics" | `usDemoAccess?.isOwner === true` (**not** role-based) | `AppSidebar.tsx:278-283` |
| Sidebar "Dev Overlook" | `devOverlookAccess?.allowed === true` | `AppSidebar.tsx:352-363` |
| Both owner queries fire at all | `enabled: isAuthenticated` | `AppSidebar.tsx:269-277` |
| TopNav identity block | `user` truthy | `TopNav.tsx:58-77` |
| Home ban alert | `user?.publicMetadata?.banStatus` truthy | `Home.tsx:111-115, 188-200` |
| Discord join block vs "being set up" | `joinStatusQuery.data?.configured` | `PrivateCampaignApplySection.tsx:194, 242-246` |
| "Re-join" vs join CTA | `discordJoinMethod === "oauth" && discordJoinedAt` | `:194-241` |
| `getDiscordJoinStatus` fires | `enabled: isApproved` | `:87-91` |

### State stored

- Clerk session/JWT, `publicMetadata.roles` (backend-written), `publicMetadata.lastSyncedAt`, `publicMetadata.banStatus`.
- MySQL: `user_clerk` (`schema.ts:1702-1745`; `onDuplicateKeyUpdate` rewrites email/username/names/image/updated_at — **not** `clerk_user_id` or `discord_id`), `roles` (`:1747`), `user_roles` (`:1764`, unique on `(user_id, role_id)`), `banned_users` (`:180`), `discord_oauth_grants` (`:564`, one row per clipper, deleted when a refresh fails so the UI falls back to re-consent).
- Backend process memory: role cache (200 entries / 5 min, bypassed in dev, `roles.ts`), ban cache (same shape, `banned-users.ts`), optional-auth viewer cache (5000 / 5 min, `optionalAuth.ts`), Discord CSRF states (single-use / 10 min, **not persisted** — a server restart mid-consent invalidates the in-flight state, `discordJoin.ts:27-42`).
- localStorage: `atomik-clips-theme`, `dismissedAnnouncements`, `dev-onboarded` (local dev only).
- Local component: `joining` in `PrivateCampaignApplySection` (`:95`).

### After submit

| Action | Result |
| --- | --- |
| Sign in / sign up | Full redirect to Clerk and back; `Auth.tsx` `useEffect` sees `user` → `navigate(redirectUrl \|\| "/")`. No toast. |
| Sign out | `trackEvent('sidebar_sign_out_clicked')` fires first (`AppSidebar.tsx:237-242`). **Three different destinations coexist:** sidebar `<UserButton afterSignOutUrl="/auth">`, `AdminRoute` `<UserButton afterSignOutUrl="/">`, `ClerkProvider afterSignOutUrl="/"`. On throw: toast `"Sign out failed"` + `error.message`, destructive. |
| 401 matching the token regex | `signOut()` then hard `window.location.href = "/auth"`. Cache discarded. At most once. |
| Successful token verification (≤ once / 5 min) | Server upserts `user_clerk` and writes `publicMetadata {roles, lastSyncedAt}`. No invalidation, no toast. This is why `/admin/user-roles` says `"Changes sync to Clerk on a short cache. It can take a few minutes for new assignments to appear there."` (`AdminUserRoles.tsx:195-198`). |
| `joinPrivateDiscord` → joined | Server sets `campaign_applications.discord_join_method='oauth'`, `discord_invite_url=null`, `discord_joined_at=now` (`privateCampaigns.ts:236-248`) — this is what flips the UI to "Re-join". |
| OAuth callback completes | `discord_oauth_grants` upserted; popup postMessages and self-closes. **The SPA never navigates.** |
| `/reset-password` submit | Client validation only, then `updatePassword()` — a stub that toasts `"Password update"` / `"Please update your password through your user profile."` and returns `{error:null}` — then `navigate('/campaigns')`, **which is not a registered route** → NotFound. Nothing is changed anywhere. |

### Ineligible / incomplete / already-completed

- **Wrong role on an admin route:** no redirect. Full-page shell — header "Atomik Clips" / "Access Denied" + the user's email + a `<UserButton/>`, then a Card with a Shield icon, title **"Access Restricted"**, body `"You don't have the necessary permissions to access this area. This section is restricted to administrators only."` and `"If you believe this is an error, please contact your system administrator."`, plus a second `<UserButton/>` (`AdminRoute.tsx:30-77`). No AppLayout, no sidebar.
- ⚠️ `AdminRoute` **does not wait for `isRolesLoaded`** (`:21-30`). With `roles === []` on the first tick the denial screen can flash. `ProtectedRoute` masks this in the common case but not for a Clerk user whose publicMetadata has not yet been written.
- **Owner-locked panels:** roles are irrelevant. Links are simply absent. Direct navigation → `FORBIDDEN "This panel is restricted."` (`demographicsVerification.ts:1694-1705`, owner `US_DEMOGRAPHICS_OWNER_DISCORD_ID = "296884557972504577"`) / `FORBIDDEN "Not for you."` (`devOverlook.ts:38-41, 59-60`). `/admin/dev-overlook` has **no `AdminRoute` wrapper at all**, so a non-owner sees page chrome with failing queries.
- **Banned user:** every protected procedure throws `UNAUTHORIZED "User is banned"` — which does **not** match the force-logout regex, so the session stays alive and each component shows its own error. The only dedicated UI is the dashboard Alert (`"Your account is banned"` + reason or `"You cannot submit clips right now."` + `"• Banned on <date>"`). Optional-auth surfaces silently downgrade a banned viewer to anonymous (`optionalAuth.ts:76-85`).
- **Signed-in Clerk user with no linked Discord:** two behaviours. Inside the 5-minute sync branch → `UNAUTHORIZED "A linked Discord account is required"`. Outside it, the request proceeds with `userId = clerkUser.id` and `discordId = null`, so role/ban lookups key off an id that will never match `user_roles.user_id`. **There is NO "link your Discord" UI anywhere in the frontend.**
- **Approved clipper who never granted OAuth:** button reads "Enable one-click join"; clicking calls `joinPrivateDiscord` first, gets `needs_auth`, opens consent, retries automatically.
- **Already joined:** "Re-join" variant; `joinGuildViaGrant` is idempotent so it produces the same `"You're in!"` toast.
- **Already signed in on `/auth`:** `"You are already signed in. Redirecting..."` while the effect navigates.
- **Wrong Discord account authorized:** popup posts back the message naming both accounts; rendered as a destructive toast `"Couldn't connect Discord"`.
- **Dead grant:** `getValidGrantAccessToken` DELETEs the row so `hasGrant` returns false and the UI routes back to re-consent (`discordJoin.ts:199-214`).
- **Popup blocked/closed:** `waitForConsent` resolves false, button stops spinning, **nothing is toasted** for a user-cancel.

### Loading / empty / error states

- **Session not resolved:** full-viewport `<div className="flex h-screen items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground"/></div>` — identical markup in `ProtectedRoute.tsx:15-19` and `App.tsx:83-88`.
- **Private application loading:** centred muted row, spinner + `"Loading application…"` (`PrivateCampaignApplySection.tsx:171-177`).
- **Discord join in flight:** `joining` disables the button and prepends `<Loader2 className="mr-1 h-3.5 w-3.5 animate-spin"/>`.
- **`/auth` marketing stats grid renders nothing** — the `stats` array is empty (both entries commented out, `Auth.tsx:47-50`). The `differentiators` array has 2 of 3 entries (one commented out, `:33-38`).
- **Expired session:** no visible error — silent sign-out and hard navigation.
- **Access denied:** a full page, not a toast, not a redirect.
- **Maintenance:** entire route tree replaced by `<MaintenanceScreen message={...}/>`.
- **OAuth popup page:** minimal system-font page reading `"You can close this window and return to Atomik Clips."`, visible for a moment.

---

## 3.B Onboarding & phone

### The headline

**`/onboarding` is a UI shell. It calls ZERO tRPC procedures and persists nothing.** The file header states this verbatim (`frontend/src/pages/Onboarding.tsx:16-30`), including that when wired the Discord step must use Clerk OAuth + `privateCampaigns.getDiscordJoinAuthorizeUrl`.

**There is no SMS/OTP provider anywhere in the repo.** Exhaustive grep for `twilio|nodemailer|sendgrid|sms|messagebird|vonage|plivo` returns nothing. ForwardEmail exists (`backend/src/lib/forwardEmail.ts`) but is an email-alias service used only for staff mod-alias generation — nothing to do with phone numbers. There is no OTP table, no code-generation, no verification procedure.

The string `OTP` in this codebase means a **social-account** verification method (`"OTP" | "login-flow" | "manual"`, `SubmissionStep2.tsx:33`), labelled `"Profile Verification"` in the UI (`:42`). shadcn's `ui/input-otp.tsx` exists and is imported by **nothing**.

**Nothing forces a signed-in user through onboarding.** There is no global gate; `ProtectedRoute` sends unauthenticated users to `/auth`, never to `/onboarding`. A brand-new signed-in user lands on the dashboard.

### The real phone step

`frontend/src/components/SubmissionPhoneStep.tsx` (198 lines), rendered inline as **step 4** inside the step-2 submit form (`step-2-content.tsx:281-285`). It is the **only** production consumer of `user.updatePhoneNumber` — there is no other way for a clipper to edit their phone number anywhere in the app.

| Procedure | Kind | Auth | Input |
| --- | --- | --- | --- |
| `user.updatePhoneNumber` | mutation | protected; also throws `BAD_REQUEST "A linked Discord account is required"` when `ctx.user.discordId` is falsy (`user.ts:113-119`) | `z.object({ phoneNumber: z.string().trim(), phoneCountryCode: z.string().min(1,"Country code is required").max(8,"Country code is too long").trim() })` |
| `user.getProfile` | query | protected | none; called with `{refetchOnWindowFocus:false}` (`step-2-content.tsx:63`) |

**`phoneNumber` has NO min length, NO regex, NO max on the server** (`user.ts:102-104`) — an empty string passes zod; only the client blocks it. Server normalisation is `input.phoneNumber.replace(/\s+/g, " ")` (`user.ts:121`) — it collapses whitespace runs, it does **not** strip spaces, dashes, parens or leading zeros. The DB column is `varchar(32)` with no app-level length guard (`schema.ts:1712`). There is **no** `phone_verified` column and no verification table anywhere in `schema.ts`.

### Fields collected (the real step)

| Field | Type | Required | Where | Constraints |
| --- | --- | --- | --- | --- |
| `phoneNumber` | string | yes | `<Input id="submission-phone" placeholder="Enter your phone" autoComplete="tel" inputMode="tel" required/>` (`SubmissionPhoneStep.tsx:154-163`) | client: `!phoneInput.trim()` only |
| `phoneCountryCode` | string dial code e.g. `"+91"` | yes | shadcn `<Select>` in a `sm:w-52` wrapper, placeholder `"Select country"`, options rendered `{country} ({code})` (`:137-151`) | default `"+91"` (`:45`) with **no geo detection**; options sorted by `a.country.localeCompare(b.country)` in a useMemo (`:60-64`) — the raw array is not alphabetical |

`PHONE_COUNTRY_CODES` (`frontend/src/lib/phoneCountryCodes.ts`) is 228 entries of `{code, country}`. No flags, no ISO codes, no dial-length metadata.

⚠️ **Duplicate dial codes are used as both React `key` and Select `value`** (`SubmissionPhoneStep.tsx:146-147`): `+1` → Canada (`:40`) and United States (`:41`); `+7` → Kazakhstan (`:109`) and Russia (`:175`); `+590` → Guadeloupe (`:85`) and Saint Barthélemy (`:177`). Nothing compensates for this.

The server never validates the code against the list — any ≤8-char string is accepted, and `PHONE_COUNTRY_CODES` lives only in the frontend.

### Validation

| Rule | Where | Exact message |
| --- | --- | --- |
| Phone non-empty after trim | **client only**, `SubmissionPhoneStep.tsx:95-98` | `"Enter your phone number before continuing."` in `<p className="text-xs text-destructive" role="alert">` |
| Country code truthy | **client only**, `:99-102` | `"Select your country code."` — practically unreachable, the state defaults to `"+91"` |
| `phoneCountryCode` length | server zod | `"Country code is required"` / `"Country code is too long"` |
| Discord link | server | `BAD_REQUEST "A linked Discord account is required"` |
| `user_clerk` row exists | server | `NOT_FOUND "User was not found"` |
| Phone format/length/digits | **NOWHERE** | — |

### Visibility

| UI | Condition |
| --- | --- |
| `<SubmissionPhoneStep step={4}/>` rendered at all | `requiresPhoneNumber = Boolean(!profileQuery.isLoading && !profileQuery.isError && !profileQuery.data?.phoneNumber)` (`step-2-content.tsx:158-162`) — **hidden while loading, hidden on error, hidden once a number exists** |
| Phone inputs vs the greyed placeholder | `stepStatus`: `!step3Complete → "pending"` (children replaced by `disabledMessage` `"Complete the previous steps to continue."` and `pointer-events-none select-none opacity-70`), else `phoneStepComplete → "complete"`, else `"current"` (`SubmissionPhoneStep.tsx:116-120` + `StepSection.tsx:92-104`) |
| Save button label | `isSaving → spinner + "Saving"`; else `phoneStepComplete → "Update number"`; else `"Save number"` (`:183-192`) |
| Inline error | `errorMessage !== null` (`:171-175`) |
| Submit Clip enabled | see 3.D — `isPhoneStepBlocking = profileQuery.isLoading \|\| !isPhoneStepComplete` |
| "Profile unavailable" Alert | `profileQuery.isError` (`step-2-content.tsx:318-328`) |

### After submit

**Success:** `setPhoneStepComplete(true)` → the react-query cache for `user.getProfile` is **PATCHED IN PLACE** via `utils.user.getProfile.setData` (`:70-78`) — no invalidate, no refetch → `toast({title:"Phone number saved"})`, title only, no description, default variant → `setErrorMessage(null)`. **No navigation.**

⚠️ Because `requiresPhoneNumber` is computed from `profileQuery.data` and `setData` patches that data, **the phone step unmounts itself on the render after a successful save.** The user sees a toast and the step disappears. This also makes the `"Update number"` label effectively dead code.

**Failure:** `errorMessage` = raw `error.message` or `"Unable to save your phone number."` (`:84-90`). Inline `<p role="alert">`, **no toast**. `phoneStepComplete` stays false so Submit stays disabled.

### Ineligible / incomplete / already-completed

- **No linked Discord:** `getProfile` fails → `profileQuery.isError` → `requiresPhoneNumber` becomes **false** → the phone step is HIDDEN and the submit button is **UNBLOCKED**, while a destructive Alert shows `"Profile unavailable"` with the fallback body `"We couldn't confirm your phone number. You can still submit your clip."` **This fails open on purpose.**
- **Not yet saved:** Submit Clip is disabled with **no toast, no scroll-to, and no message explaining why**.
- **Already has a phone on file:** `<SubmissionPhoneStep>` is **never rendered**, `isPhoneStepComplete` short-circuits true. The clipper never sees step 4 and there is no way to edit their number from this flow — or anywhere else.
- **Step numbering:** hardcoded `step={4}` (`step-2-content.tsx:282`). Steps 1–3 always render; step 4 conditionally. The visible step count silently changes 4 → 3.
- **Enter key in the phone input:** `handleKeyDown` calls `preventDefault()` then `handleSave()` (`:109-114`) — this exists specifically to stop Enter submitting the enclosing `<form onSubmit={handleSubmit}>` at `step-2-content.tsx:186`. The country `<Select>` has no equivalent.
- **Double-click:** button disabled on `updatePhone.isPending` only. No debounce, no server rate limit.

### The `/onboarding` shell (for reference — it saves nothing)

Four local steps: `discord` / `payout` / `experience` / `phone` (`Onboarding.tsx:32-39`). Entered from `Landing.tsx:58` ("Sign up / Discord login") and `CampaignPreviewModal.tsx:252` (signed-out "Sign in to submit").

| Step | Fields | Gate | Persistence |
| --- | --- | --- | --- |
| discord | `joinedDiscord` boolean, set true by clicking an external link | `disabled={!joinedDiscord}`; label flips `"Join the server first"` → `"Continue"` (`:177-180`) | none |
| payout | `payoutMethod: "bank"\|"crypto"\|null`; bank shows 4 **uncontrolled** inputs (Account holder name / Account number / IFSC or routing / Country), crypto shows 2 (Network / Wallet address) — **no `value`, no `onChange`** (`:220-231`) | `disabled={!payoutMethod}` but a "Skip for now" button calls the same `next()` unconditionally (`:239-245`) | none |
| experience | `years`, `platforms[]` (hardcoded `["YouTube","Instagram","TikTok","X"]`, `:264`), `clipsPerWeek` | none — Continue is unconditional | **none.** Header comment `:27-28`: "NO BACKING COLUMNS YET. Needs a schema decision before it can store anything; kept local-only on purpose." Confirmed: no such column in `schema.ts`. |
| phone | `phone.country` (**free-text**, not a Select, does not use `PHONE_COUNTRY_CODES`), `phone.number`, `phone.code` | "Send code" `disabled={phone.number.trim().length < 6}`; "Verify and finish" `disabled={phone.code.length < 4}` — **labelled "6-digit code" but accepts 4, and accepts letters** | none |

`setCodeSent(true)` (`:350`) is a pure local state flip. **No network request. No SMS. No timer, resend, cooldown or expiry. The code is never sent and never checked.**

`finish()` (`:92-103`): if `import.meta.env.VITE_LOCAL_DEV_SIGNED_OUT === "true"` → `localStorage.setItem('dev-onboarded','true')` + hard `window.location.href = "/"` (so the dev-clerk stub re-evaluates as signed in); otherwise `navigate("/")`. **Nothing is saved either way.** No confirmation UI.

`localStorage['dev-onboarded']` is the only "onboarding state" that exists anywhere, and it is dev scaffolding that never ships (`lib/dev-clerk.tsx:78-81`).

Refresh mid-flow loses everything — `step` resets to 0.

The Discord link at `Onboarding.tsx:166` is `https://discord.com/channels/1395157211839201400/1395362775534014525` — a **channel deep-link, not an invite**. Whether that is intentional is NOT DETERMINABLE FROM CODE.

`/onboarding` is **not** in `ALWAYS_ALLOWED_PATHS`, so it is replaced by the maintenance screen for authenticated non-privileged users.

---

## 3.C Campaigns & eligibility

### Flow

Three independent campaign-card designs and two detail modals exist today:

| Surface | Card | Modal | Data hook |
| --- | --- | --- | --- |
| `/` and `/campaigns/active` | `ActiveCampaignsSection.tsx` | `CampaignDetailDialog.tsx` | `useCampaignsData` = `campaigns.getAll` merged with `privateCampaigns.myUnlockedCampaigns` |
| `/explore` | local `CampaignCard` inside `ExploreCampaigns.tsx:55-198` (full-bleed 160px thumbnail, Private/Closed corner pills) | `CampaignPreviewModal.tsx` | `campaigns.getAll` only |
| `/admin` | card inside `Campaigns.tsx` | — | `campaigns.getAllAdmin` |

**Private-campaign application is one click, no fields.** `privateCampaigns.ts:346-349` states it: *"One click — no account selection. Mods judge the clipper on their whole history."* The legacy `campaign_application_accounts` table is no longer written and is DELETED on re-apply (`:445-449`).

### Procedures

| Procedure | Kind | Auth | Input | Notes |
| --- | --- | --- | --- | --- |
| `campaigns.getAll` | query | **public** | none | Whole list + metrics, then `.map(sanitizePrivateCampaign)`. `WHERE card_deleted_at IS NULL`, `ORDER BY created_at DESC`. Carries `levels[]` and `achievementPercentage`. `campaigns.ts:406-409` |
| `campaigns.getById` | query | public | `{id, category?}` | `buildCampaignByIdResponse(stripPrivateCampaignRow(row))`. Throws a **plain `new Error("Campaign not found")`** → surfaces as INTERNAL_SERVER_ERROR, not NOT_FOUND (`:300-302`) |
| `campaigns.getByIdUnlocked` | query | public | `{id, category?, password?: z.string().min(1)}` | Re-verifies the password hash **on every call**. Wrong/absent password **degrades to the teaser row rather than throwing** (`:442-463`) |
| `campaigns.getByIdPublic` | query | public | `{id}` | Slim projection for the submit flow. Throws `TRPCError NOT_FOUND "Campaign not found"`. **Forces `sopEmbedUrl = null` for private campaigns** (`:523`). Does not select rates, so does **not** honour `private_show_rates` |
| `campaigns.getCampaignCategories` | query | public | `{campaignId}` | Zeroes rate/max-payout when `!private_show_rates`, budget when `!private_show_budget`, `guild_id` always null. **Deduplicates by category name keeping the FIRST occurrence** (`:582-590`) |
| `campaigns.getMyCpmGroupRates` | query | protected | none | `[{campaignId, cpmPer1000, groupName}]` — caller's rows only (`:1524-1543`) |
| `campaigns.verifyExternalPassword` | mutation | public | `{campaignId, password: z.string().min(1)}` | Returns `{valid}` — **does not throw on a wrong password** (`:2041-2077`) |
| `privateCampaigns.myVerifiedAccounts` | query | protected | none | `verified = true AND deleted_at IS NULL AND account_deleted_at IS NULL`. Deliberately the same filter the apply mutation re-checks (`:89-106`) |
| `privateCampaigns.getApplicationState` | query | protected | `{campaignId: z.string().min(1)}` | `{application \| null, unlocked \| null}`. `unlocked` is populated **only** when status === `"approved"` (`:110-173`) |
| `privateCampaigns.myUnlockedCampaigns` | query | protected | none | Every **private**, non-card-deleted campaign with an approved application (`:269-344`) |
| `privateCampaigns.apply` | mutation | protected | `{campaignId: z.string().min(1)}` | Returns `{status:"pending"}` (`:350-458`) |
| `privateCampaigns.review` | mutation | `reviewerRoleProcedure` | `{applicationId, action: 'approve'\|'reject'\|'pending', rejectedReason?: trimmed max 500}` | No-ops when already in the target state (`:928-930`) |
| `submissions.createSubmission` | mutation | protected | see 3.D | **Where eligibility is actually enforced.** |

### Fields collected

| Field | Type | Required | Where | Constraints |
| --- | --- | --- | --- | --- |
| `campaignId` | string | yes | never typed — from the card the clipper opened (`PrivateCampaignApplySection.tsx:356`) | `z.string().min(1)` |
| *(nothing else)* | — | — | The private application collects **NOTHING** else. | — |
| `password` | string | yes | `<Input id="campaign-password" type={showPassword?'text':'password'} autoComplete="current-password">` (`Index.tsx:119-126`) | client `!password.trim()`; server `z.string().min(1)` |
| `showPassword` | boolean | no | eye toggle, `aria-label` `"Show campaign password"` / `"Hide campaign password"` (`Index.tsx:131-135`) | — |

### Validation

| Rule | Where | Exact message |
| --- | --- | --- |
| Campaign exists / not card-deleted | server apply | `NOT_FOUND "Campaign not found"` |
| Must be private | server apply | `BAD_REQUEST "This campaign doesn't require an application"` |
| Not ended | server apply; mirrored client-side (dialog renders `"This campaign has ended."` **instead of** the whole apply section) | `BAD_REQUEST "This campaign has ended"` |
| ≥1 verified social account | server apply + client (disabled button + amber card) | `PRECONDITION_FAILED "Connect at least one social media account to your profile before applying."` |
| No re-apply while pending/approved | server apply | `"You're already approved for this campaign."` / `"You've already applied — a moderator will review your application."` |
| Private campaign requires approval to submit | server `submissions/index.ts:511-528` (**plain Error**) | `"This is a private campaign. Apply from the campaign card and wait for a moderator to approve you before submitting clips."` |
| Campaign active | server | `"Campaign is not active"` |
| Not paused | server | `"This campaign is not accepting new submissions right now."` |
| Inactivity suspension | server `:488-505` | `"You've been suspended from this campaign for inactivity (no clips posted for a full week). Contact a moderator to be reinstated."` |
| Platform allowed | server `:541-550` | `` `This campaign only accepts submissions from: ${formatPlatformList(allowedPlatforms)}.` `` |
| Verified account on that platform | server `:567-570` | `` `You must verify your ${input.platform} account before submitting. Please complete verification first.` `` |
| Password non-empty | client `Index.tsx:51-54` | `"Enter the password to continue."` (`<p className="text-sm text-destructive">`) |
| Password matches | server returns `{valid}`; **client** turns false into the message | `"Incorrect password. Try again."` — **client string; the server does not throw** |
| Campaign is password-protected | server | `UNAUTHORIZED "Campaign is not password protected"` |

### Visibility

| UI | Condition | File |
| --- | --- | --- |
| Card grid membership | `campaigns.filter(c => !c.ended)`. Card-deleted filtered server-side. | `ActiveCampaignsSection.tsx:94` |
| Private violet lock badge | `visibility === "private"` — shown regardless of unlock | `:124, 180-187` |
| Paused amber badge | `submissions_paused` | `:188-195` |
| Teaser treatment | `teased = isPrivate && !unlockedForMe`; then `hideBudget = teased && !private_show_budget`, `hideRates = teased && !private_show_rates`, `hideDescription = teased && !private_show_description` | `:125-128` |
| Card "Reward rate" | `hideRates → "Hidden"`; no positive rate → `"Not set"`; else `$X.XX / 1k`. Label is `"Rate up to"` when positive rates differ, else `"Reward rate"` | `:232-257` |
| Card progress bar | `!hideBudget && progress !== null`, where `progress = Number.isFinite(achievementPercentage) ? value : null` — **the NaN guard**. Bar width clamped 0–100; **the label prints the raw value**, so `>100%` is possible on the card | `:135-137, 273-292` |
| Card CTA | `teased && !unlockedForMe ? "Apply to unlock" : "Review campaign"` | `:300-303` |
| Fiery card + `CpmBoostBadge` | `cpmGroupRates.has(campaign.id)` adds class `cpm-boost-card` | `:157, 308` |
| **Dialog `hideBudget` / `hideRates`** | `isPrivate && !private_show_* && !unlocked && !unlockedForMe` — **BOTH unlock signals must be absent** | `CampaignDetailDialog.tsx:98-101` |
| **Dialog `hideMinViews`** | `isPrivate && !private_show_rates && !private_show_min_views && !unlocked && !unlockedForMe` — view floors have their **own** toggle | `:109-114` |
| Min-views breakdown format | `floorsAllEqual` compares **every raw floor including zeros** — TikTok at 0 with the rest at 1500 forces the per-platform breakdown. All-zero → `"None"` / `"Every clip counts, no per-clip minimum"` | `:116-140, 291-312` |
| Total-minimum line | `displayMinPayout > 0 ? "<n> in total" + "Combined across ALL your clips to get paid — not per clip" : "No total minimum"` | `:313-325` |
| Payment methods tile | filtered to keys of `{bank:'Bank transfer', crypto:'Crypto', paypal:'PayPal'}`; **empty falls back to a HARDCODED "Bank" / "Direct transfer"** | `:141-148, 242-262` |
| Payouts section | `displayPlatformRates.length > 0`; consolidates into one "All Platforms" card when every displayed rate equals the first; values shown **per 1M views** = `rate * 1000` | `:155-186, 330-408` |
| Level boosts | `campaignLevels.length > 0`, from `campaign.levels` on the **getAll row only** | `:152-154, 409-441` |
| Hot Streaks | `campaign.is_hot_streak_enabled`. Tier copy/values **HARDCODED in the component**: Flameholder +$0.10 "Most views yesterday", Heatwave +$0.05 "Next two view leaders", Embers +$0.03 "Remaining top creators", images `/images/hot-streak-*.svg` | `:49-68, 442-484` |
| Details fallback | strips to empty → `isPrivate && !private_show_description && !unlocked` ? `"Details are revealed once your application is approved."` : `"No additional details provided."` | `:493-511` |
| SOP section | `displaySopEmbedUrl` → "Open in new tab"; else `isPrivate && !unlocked` → `"The SOP is revealed once your application is approved."`; else **nothing** (the heading still renders, empty) | `:522-549` |
| Dialog footer branch | `ended` → `"This campaign has ended."` \| `isPrivate` → `<PrivateCampaignApplySection>` + (approved ? (paused ? pausedNotice : CTA) : —) \| `!isPrivate && paused` → pausedNotice \| else CTA | `:552-617` |
| Apply section branch | `approved` / `pending` / `rejected` / not-applied — each an early return; rejected falls into the apply block with a red banner above | `PrivateCampaignApplySection.tsx:180, 252, 302` |
| "Connect an account first" amber card | `!accountsQuery.isLoading && accounts.length === 0` — links to `/verification`, Apply disabled | `:332-355` |
| Index password screen | `!isAuthorized` where `isAuthorized = isUnlocked \|\| roles.includes("campaign-editor")` | `Index.tsx:84, 99` |
| Index Demographics panel | `Boolean(demographics_json) && Boolean(demographicsVerificationEnabled)` — **both SERVER fields** | `Index.tsx:167-169` |
| `CampaignCategories` | returns `null` when `categories.length === 0` — no empty state at all | `dashboard/CampaignCategories.tsx:46-48` |
| `CampaignPreviewModal` CTA | ended → `"Campaign closed"` pill \| paused → `"Not accepting submissions"` pill \| `user` → `"Submit clip"` → `/campaign/:id/submit` \| signed out → `"Sign in to submit"` → **`/onboarding`** | `CampaignPreviewModal.tsx:228-256` |

### State stored

- MySQL: `campaigns` (`schema.ts:373-549` — all `private_show_*` flags, teaser fields, `external_password` hash, `card_deleted_at`), `campaign_levels` (`:627-653`), `campaign_cpm_groups` + `campaign_cpm_group_members` (`:665-721`), `campaign_applications` (`:301-344`, unique on `(campaign_id, user_id)`, carries `apply_count`, `last_rejected_reason`, `last_rejected_at`, `discord_*`), `campaign_application_accounts` (`:351-368`, legacy), `campaign_categories` (`:1162-1193`).
- react-query, default options.
- Local: `selectedCampaign` / `isDialogOpen` (`Home.tsx:57-60`, `ChooseCampaigns.tsx:13-16`), `selected` (`ExploreCampaigns.tsx:207`), `joining`, `CpmBoostBadge` dialog open.
- **`unlockPassword` lives in React state ONLY** (`Index.tsx:21-28`) — never localStorage/sessionStorage — and is re-sent to `getByIdUnlocked` on every query so the server re-authorizes each time. A refresh loses the unlock. The comment at `campaigns.ts:436-441` states this is so the unlock flag can never be the thing that authorizes real numbers.
- localStorage `dismissedAnnouncements` (JSON string[]) — the only localStorage usage in this area (`Home.tsx:77, 135-138`), parsed defensively with `console.warn("Failed to parse dismissed announcements")`.

### After submit

| Action | Result |
| --- | --- |
| `privateCampaigns.apply` succeeds | **No navigation, dialog stays open.** `trackEvent('private_campaign_applied')`; toast `"Application submitted"` / `"A moderator will review it — you'll get a notification."`; then `onApplied()` = `applicationQuery.refetch()` (`CampaignDetailDialog.tsx:565`). **No invalidation** — the card grid's `getAll`/`myUnlockedCampaigns` are NOT refreshed. |
| apply fails | Destructive toast `"Couldn't submit application"` + raw `e.message`. |
| Mod approves | status → `approved`, `reviewed_by`/`reviewed_at` set, `rejected_reason` cleared; best-effort Discord direct-add. Notification: title `"You're in! Private campaign application approved"`, body `` `Your application to "${campaignTitle}" was approved. You can now submit clips from any of your connected accounts.` `` + a Discord line, `expires_minutes 20160`. **The REAL title is used here.** |
| Mod rejects | status → `rejected`, all `discord_*` cleared. Notification: `"Private campaign application update"`, `` `Your application to "${teaserTitle}" wasn't approved this time.` `` + optional `` ` Reason: …` `` + `" You can apply again from the campaign card."`. **The TEASER title is used — a rejected clipper never learns the real client.** |
| Mod resets to pending | everything nulled. **No notification.** |
| `verifyExternalPassword` → `{valid:true}` | `setIsUnlocked(true)`, `setUnlockPassword(password)`, `setPassword('')`. **No navigation** — the same route re-renders as the dashboard. |
| `{valid:false}` | Inline destructive text `"Incorrect password. Try again."` **No toast, no lockout, no attempt counter anywhere.** |
| Card click | `trackEvent('campaign_card_selected')` then `onSelectCampaign(campaign)`. |
| Dialog primary CTA | `trackEvent('campaign_detail_primary_action_clicked')`, `onOpenChange(false)`, `<Link>` to `/campaign/${id}/submit`. |
| SOP link | `trackEvent('campaign_sop_link_clicked')`; `target=_blank rel=noopener noreferrer`. |

### Ineligible / incomplete / already-completed

- **Signed out:** `getAll` is public and already teaser-stripped. `myUnlockedCampaigns` and `getMyCpmGroupRates` are `enabled: Boolean(user)` so they never fire. `useMyUnlockedCampaigns` deliberately uses `isInitialLoading` rather than `isLoading` because a disabled v4 query still reports `isLoading: true`.
- **Approved clipper loading the grid:** the teaser→real flash is deliberately prevented — `useCampaignsData` reports `isLoading = query.isLoading || unlocked.isPending`, holding the skeleton until the unlock check lands. `myUnlockedCampaigns` uses `retry: 1` so a failure degrades to the teaser in ~1 retry instead of ~7 s.
- **Zero-budget campaign:** `achievementPercentage` is `NaN`. Cards guard with `Number.isFinite`; **`CampaignDetailDialog.tsx:235` calls `.toFixed(2)` unguarded**, so the Created tile can literally read `"NaN% paid out"`.
- **Private campaign with budget hidden:** `sanitizePrivateCampaign` sets `achievementPercentage = 0`, so the dialog reads `"0.00% paid out"` rather than `"Hidden"` — inconsistent with the Bounty tile beside it, which does say Hidden.
- **`"Hidden"` vs `"Not set"` are different states** — teaser vs a public campaign with no rate configured. There is an explicit code comment at `ActiveCampaignsSection.tsx:236-239`.
- **Progress > 100%:** the card clamps the bar but prints the raw label (`"134.2% full"`). `/explore` and `CampaignPreviewModal` clamp **both**.
- **Deep link to `/campaign/:id/submit` on an unapproved private campaign:** `PrivateCampaignGate` shows a Lock icon, `"This is a private campaign"`, and either `"Your application is still being reviewed. You'll be able to submit clips once a moderator approves you."` (pending) or `"You need to apply and be approved before you can submit clips here. Open the campaign card and apply with the accounts you'll clip from."`, plus a rounded-full `"Back to campaigns"` button → `/campaigns/active`. The backend rejects it anyway.
- **Rejected applicant re-applies:** allowed. The SAME row resets to pending with `apply_count + 1` and `last_rejected_reason`/`last_rejected_at` preserved for the mod. UI shows a red `"Your previous application wasn't approved"` banner with the reason, then `"You can apply again below."`
- **Approved clipper on a paused campaign:** approved banner still renders, CTA replaced by the amber pill `"Not accepting submissions right now"`.
- **Approved clipper on a campaign with no guild:** `getDiscordJoinStatus` reports **global** configuration only, so the Join button still shows; clicking it hits `BAD_REQUEST "This campaign has no Discord server configured."` → toast `"Join failed"`.
- **Pending applicant + Discord panel:** a permanently **disabled** `"Enable one-click join"` button with a Lock icon, `title` attribute `"Unlocks once your application is approved"`, and caption `"Unlocks after approval."` Deliberate expectation-setting.
- **Zero verified accounts:** amber `"Connect an account first"` card linking to `/verification`; Apply disabled; server independently throws the same rule.
- **Correct password then refresh:** unlock lost, password screen returns.
- **`getByIdUnlocked` with a wrong/absent password:** does **not** throw — silently returns the teaser-stripped row, so the dashboard degrades to zeros.
- **`campaign-editor` visits `/campaign/:id`:** `isAuthorized` immediately true; `useDashboardCampaignData` routes to `getByIdAdmin`. Precedence: **editor > password-unlocked > public** (`useCampaignData.ts:73-95`).
- **Duplicate category names:** `getCampaignCategories` dedupes by name keeping the first — a category with several platform rows collapses to one tile with one platform's rate.
- **`MIN_VIEW_DISPLAY_THRESHOLDS`** (`backend/src/lib/campaignDisplayRules.ts:17-20`) is a hardcoded per-campaign display map, currently `{ campaign_1783258985456: 3000 }`. Clips below it are excluded from **displayed** progress/views/rankings only — **never from actual payouts.**
- **Card soft-deleted:** disappears from `getAll`, `getAllAdmin` and `myUnlockedCampaigns`, but `getById`/`getByIdPublic` still resolve it, so a deep link and the submit flow keep working.
- **Campaign description containing HTML:** `CampaignDetailDialog` renders it with `dangerouslySetInnerHTML` inside a `.prose` block (after stripping tags to test emptiness); **`CampaignPreviewModal` renders the same field as PLAIN TEXT**, so raw markup would show there.

### Loading / empty / error states

| Surface | Loading | Empty | Error |
| --- | --- | --- | --- |
| Card grid | 2 × `<Skeleton className="h-[340px] rounded-3xl"/>` in `grid gap-6 md:grid-cols-2` | dashed rounded-3xl box, py-16, `"No active campaigns available right now."` | — |
| Home | `Loader2 h-6 w-6` + `"Loading campaigns..."` (gated on `isUserLoading`, **not** the campaign query) | — | whole page → `"Failed to load campaigns"` in `text-destructive` |
| `/campaigns/active` | `Loader2 h-5 w-5` + `"Loading active campaigns…"` | — | `"We couldn't load the active campaigns. Please try again."` |
| `/explore` | 3 × `<Skeleton className="h-[420px] rounded-3xl"/>` | `"No campaigns are running right now — check back soon."` | **NONE** — `error` is never read (`:206`), so a failure renders the empty state |
| Apply section | spinner + `"Loading application…"`, py-6 | — | destructive toasts |
| Apply button | `Loader2` + `"Submitting…"` | — | — |
| Submit-flow gate | `Loader2 h-5 w-5` + `"Loading campaign…"`, py-20 | — | — |
| Index dashboard | `Loader2 h-4 w-4` + `"Loading..."` (while `campaignLoading \|\| !isRolesLoaded`) | — | inline `<p className="text-sm text-destructive">` under the password field, **no toast** |
| Index unlock button | `Loader2` + `"Unlocking…"` replacing `"Unlock dashboard"` | — | — |
| `BountyProgress` | Card + centred `Loader2 h-8 w-8`, py-8 | — | `"Failed to load campaign data"` |
| `CampaignCategories` | Card "Campaign Categories" + Tag icon + `Loader2 h-8 w-8` | **returns null — the block vanishes, no message** | `"Failed to load categories"` (on error OR `!categories`) |

**Locked/teaser copy:** `"Hidden"` in muted text for budget/rates/min-views; `"Revealed once you're approved"` captions; `"Apply to unlock"` card CTA; `"Details are revealed once your application is approved."`; `"The SOP is revealed once your application is approved."`

---

## 3.D Clip submission & the redemption ledger

> This is the flow that produces every submission and therefore all revenue. It is also the most heavily gated surface in the app.

### 3.D.1 Shape of the flow

Four routes, each mounting its **own** `<SubmissionFlowLayout>` element in `App.tsx:429-459`:

```
SubmissionFlowLayout  =  AppLayout > SubmissionProvider > centered div(max-w-5xl) > PrivateCampaignGate > children
```

⚠️ **Because the layout is instantiated separately per route, React remounts `SubmissionProvider` on every step navigation. All ten context values reset between routes.** The flow works only because everything that matters happens inside `/step-2` in a single mount.

| Route | Purpose | Auto-navigation |
| --- | --- | --- |
| `/submit` | Per-account dashboard | `navigate('/campaign/:id/step-1', {replace:true})` when `dashboard.enabled === false` (`submit-dashboard.tsx:55-61`) |
| `/step-1` | SOP | `navigate('/campaign/:id/step-2' + location.search, {replace:true, state:{campaignTitle}})` when `campaignData && !campaignData.sopEmbedUrl` (`step-1-sop.tsx:70-79`) |
| `/step-2` | **The form** | on success → `navigate('/campaign/:id/step-3')` (push) |
| `/step-3` | Confetti | none; renders unconditionally with no guard and no query |

A feature-off campaign with no SOP therefore takes the clipper from `/submit` straight to `/step-2` through two `replace` navigations.

**None of the four routes is wrapped in `ProtectedRoute`.** The signed-out redirect is done ad hoc inside `SubmissionStep1.tsx:96-103`, on the URL input's `onChange`, using the **global** `window.location` (the file does not import `useLocation`): `navigate('/auth?redirect=' + encodeURIComponent(location.pathname + location.search))`. The comment at `:99-102` explains it exists because `getPlatformMetadata` is a `protectedProcedure` that would otherwise throw an unhandled UNAUTHORIZED.

`/campaign/:campaignId/non-campaign` **is** wrapped in `ProtectedRoute` (`App.tsx:464-466`), plus its own `<PrivateCampaignGate standalone>`, and is **not** inside `SubmissionProvider`.

### 3.D.2 The step state machine

All state lives in `frontend/src/components/SubmissionProvider.tsx:10-22` — ten `useState` values, **no persistence anywhere** (no localStorage, no sessionStorage, no URL, no server):

`contentUrl`, `detectedPlatform`, `detectedHandle`, `hasVerifiedHandle(false)`, `isUserGeneratedContent(false)`, `loadingSocialDetection(false)`, `step1Complete(false)`, `step2Complete(false)`, `step3Complete(false)`, `phoneStepComplete(false)`.

Every consumer throws if the context is missing: `"Step2 must be used within SubmissionProvider"` (`step-2-content.tsx:43`), `"SubmissionStep1 must be used within SubmissionProvider"` (`:34`), `"SubmissionStep2 must be used within SubmissionProvider"` (`:56`), `"SubmissionStep3 must be used within SubmissionProvider"` (`:16`), `"SubmissionPhoneStep must be used within SubmissionProvider"` (`:35`).

**Step 1 → `step1Complete`** (`SubmissionStep1.tsx:66-84`): `Boolean(detectedPlatform && detectedHandle && isValidContentUrl)`. When it goes false it **force-clears** `step2Complete`, `step3Complete` and `hasVerifiedHandle` (`:71-75`).

⚠️ Any change to the URL input clears `detectedPlatform`/`detectedHandle`/`hasVerifiedHandle`/`contentUrl` and sets `step2Complete=false`, `step3Complete=false`, `isUserGeneratedContent=false` **before** the metadata fetch (`:105-111`). Editing a single character sends the user back to a fully un-verified state.

**Step 2 → `step2Complete`** only via an explicit user click: `handleContinue` (requires `canContinue = Boolean(hasVerifiedHandle) && !loadingVerificationCheck`) or a successful `handleVerify` with `"OTP"` in `allowedMethods`. **Both paths also set `step3Complete(true)`** (`SubmissionStep2.tsx:152-153, 173-174`).

⚠️ Consequence: **step 3's "Approve" button (`SubmissionStep3.tsx:147-168`) almost never renders**, because step 2 already completed it.

**Step 3 → `isUserGeneratedContent`** — the only control that sets it, the Switch at `SubmissionStep3.tsx:125-145`, is **commented out**. It is therefore always `false` at submit time.

**Step 4 (phone)** — see 3.B.

**Submit button** (`step-2-content.tsx:293-299`):
```
disabled = isSubmitting || !step1Complete || !step2Complete || !step3Complete || isPhoneStepBlocking
isPhoneStepBlocking = profileQuery.isLoading || !isPhoneStepComplete          // :164
isPhoneStepComplete = requiresPhoneNumber ? phoneStepComplete : true          // :163
```
**None of the server-side rejection conditions** (suspension, private, paused, banned handle, redemption cap) is represented here. The button is fully enabled right up to the throw.

### 3.D.3 Procedures

| Procedure | Kind | Auth | Input | Notes |
| --- | --- | --- | --- | --- |
| `submissions.getCampaignAccountDashboard` | query | protected | `{campaign_id: z.string()}` | `{enabled, cap, perAccount[]}`. Enumerates **every** verified, non-deleted account on the campaign's allowed platforms, **including zero-activity ones** (`redemptionLedger.ts:269-286`). Throws plain `new Error("Campaign not found")` (`index.ts:1185`). |
| `submissions.getRedemptionProgress` | query | protected | `{campaign_id: z.string()}` | `{enabled, perAccount[]}` — **no `cap` field** (step-2 reads `perAccount[0]?.cap`). Lists only accounts that have **already touched** the ledger (`redemptionLedger.ts:337-362`). Returns `{enabled:false,perAccount:[]}` when cap===0, `{enabled:true,perAccount:[]}` when there is no activity yet. |
| `submissions.getPlatformMetadata` | query | protected (comment `index.ts:1326-1328`: *"each call can cost 2 YouTube quota units"*) | `{url: z.string().url("Please provide a valid content URL")}` | Two call sites: **imperative, uncached, on EVERY keystroke** via `utils.…fetch({url:value})` (`SubmissionStep1.tsx:118-120`, guarded only by `validateContentUrl(value)===null`, with a literal `// TODO: debounce` at `:113`); and a **declarative query** in `SubmissionStep3.tsx:43-49` with `{enabled: previewIsValid && step2Complete && Boolean(contentUrl), retry:false}`. Returns `{url, platform: 'youtube'\|'instagram'\|'tiktok'\|'x'\|'linkedin'\|null, username, videoId, viewCount, embedUrl, thumbnailUrl, title, success, error?}`. **`embedUrl` is null for instagram and x by design.** |
| `submissions.createSubmission` | mutation | protected | `{campaign_id: z.string(), url: z.string().url("Please enter a valid URL"), platform: z.enum(["youtube","instagram","tiktok","x"], {errorMap: () => ({message:"Please select a valid platform"})}), category?: z.string().optional(), country?: z.string().optional(), is_user_generated_content?: z.boolean().optional()}` | The client sends only `campaign_id`, `url`, `platform`, `is_user_generated_content`. **`category` and `country` are dead fields — no UI exists for them.** |
| `submissions.previewClipUrl` | query | protected | `{url: z.string().min(1), campaign_id: z.string().optional()}` | Live pre-submit check for the non-campaign form. **Never throws** — failures come back as `ok:false` with reason `'empty'` / `'unknown-platform'`; a handle-resolution failure is swallowed and yields `handle:null`. Returns `{ok, reason, platform, videoId, handle, matchedVerifiedAccount, alreadySubmitted, alreadySubmittedKind: null\|'campaign'\|'non-campaign', resubmitOfRejectedNonCampaign}`. |
| `submissions.submitNonCampaignClip` | mutation | protected | `{campaign_id: z.string(), url: z.string().url("Please enter a valid URL"), platform: z.enum([...])}` | Returns `{id, coveredCount, creditRemaining, resubmitted}`. The page discards `id`. |
| `campaigns.getByIdPublic` | query | public | `{id}` | Called **twice** per tree — `PrivateCampaignGate` and `useSubmissionFlowCampaign` — same query key, one request. |
| `privateCampaigns.getApplicationState` | query | protected | `{campaignId}` | Same key in both places; supplies `unlocked`. |
| `user.getProfile` | query | protected | none | `{refetchOnWindowFocus:false}`. Its loading/error state directly gates the submit button. |
| `campaigns.getAll` | — | — | — | **Invalidated only**, in `createSubmission.onSuccess` (`step-2-content.tsx:56-61`). This is the ONLY invalidation. |

`useSubmissionFlowCampaign` (`useSubmissionFlowCampaign.ts:10-50`) merges `getApplicationState.unlocked` over the teaser fields `title/imageUrl/budget/description/sopEmbedUrl` (`:35-42`) and **returns `data: undefined` while `unlockedPending`** (`:33`) — specifically so step-1's SOP auto-skip cannot fire on a stripped `sopEmbedUrl`.

### 3.D.4 Fields collected

| Field | Type | Required | Where | Constraints |
| --- | --- | --- | --- | --- |
| content URL | string, `inputMode="url"`, HTML `required` | yes | `<Input id="content-url" label="Content URL">` (`SubmissionStep1.tsx:214-223`) | Held in **local** state `inputUrl` (`:55`), **not** context. Only the server-normalised `res.url` is written to `ctx.contentUrl` (`:153`). Must pass `validateContentUrl` (`:291-306`): non-empty after trim, `new URL(value)` parses, protocol starts with `http`. |
| `platform` | `'youtube'\|'instagram'\|'tiktok'\|'x'` | yes | **NOT user-entered** — derived from `res.platform` (`:122-123, 151`) | rejected if not in `SUPPORTED_PLATFORMS` or not in `campaignData.allowedPlatforms` |
| `detectedHandle` | string \| undefined | yes | derived: `ctx.setDetectedHandle(res.username ?? undefined)` (`:152`) | **NOT sent to createSubmission.** The backend re-derives it from the URL (`index.ts:646-651`). |
| `is_user_generated_content` | boolean | no | `ctx.isUserGeneratedContent` (`step-2-content.tsx:121`) | **Always `false`** — the only control is commented out and `SubmissionStep1.tsx:111` resets it on every URL change. |
| `category` / `country` | string | no | **no UI exists** | persisted as `input.x \|\| null` |
| non-campaign URL | string, `type="url"` | yes | `<Input id="non-campaign-url" label="Non-campaign clip URL" placeholder="https://">` (`NonCampaignClipSubmit.tsx:325-334`) | local `url` (`:96`), mirrored to `debouncedUrl` **600 ms** later (`:110-113`); submitted as `url.trim()`; disabled while `submitMutation.isPending` |
| non-campaign platform | enum | yes | **NOT user-entered** — `guessPlatform(url)` regexes (`:24-33`): `/youtu(be\.com\|\.be)\//i`, `/instagram\.com\//i`, `/tiktok\.com\//i`, `/(x\|twitter)\.com\//i`. **There is no platform picker.** | server re-derives and rejects a mismatch |
| `?verifiedHandle=` / `?platform=` | query params | no | written by the dashboard links (`submit-dashboard.tsx:225-227, 243-245`), read at `step-2-content.tsx:37-39` and `NonCampaignClipSubmit.tsx:51-53`, forwarded verbatim by step-1 (`step-1-sop.tsx:52`) | **PURELY COSMETIC.** Comment at `step-2-content.tsx:34-36`: *"the backend still derives the account from the pasted URL, which is the source of truth."* |
| `location.state.campaignTitle` | string \| null | no | set by `step-1-sop.tsx:59-63, 74-77`; read at `step-2-content.tsx:32` | falls back to `campaignData?.title`, then the literal `"Submit your clip"` / `"Campaign SOP"`. Lost on hard refresh. |

### 3.D.5 Validation — the full rejection vocabulary

**Every server throw below surfaces verbatim** in the step-2 destructive Alert titled `"Unable to continue"` (`step-2-content.tsx:151-153, 311-317`). There is **no `errorFormatter`** on the backend tRPC instance (`backend/src/lib/trpc.ts:31-33`), so plain `new Error(...)` messages reach the browser unmasked.

**Client, before the mutation:**

| Rule | Message |
| --- | --- |
| URL parses + http protocol | `"The URL is not valid. Please enter a valid URL."` (`SubmissionStep1.tsx:234-237`). The validator's own strings are never rendered. |
| Platform supported | `"This link is from an unsupported platform. Please submit a link from YouTube, Instagram, TikTok, or X."` (`:129`) |
| Platform allowed by the campaign | `` `This campaign only accepts submissions from: ${allowedLabelList}.` `` — labels `YouTube / Instagram / TikTok / X` (`:145-147`) |
| Handle detected (display only) | `"We're unable to detect your user handle from your link"` (`:242`) |
| Guard inside `handleSubmit` | `"Missing submission details. Please follow the steps again."` (`step-2-content.tsx:112-113`) |

**Server — `createSubmission` (`backend/src/routers/submissions/index.ts:445-834`), in evaluation order:**

| # | Rule | Message | Line |
| --- | --- | --- | --- |
| 1 | Campaign exists | `Campaign not found` | 468-470 |
| 2 | `campaign.active` | `Campaign is not active` | 473-475 |
| 3 | `!submissions_paused` | `This campaign is not accepting new submissions right now.` | 476-480 |
| 4 | No open `campaign_suspensions` row. **Only when `!isGodMode && campaign.clipper_activity_enabled`** — turning that column off lifts every existing suspension without deleting rows. | `You've been suspended from this campaign for inactivity (no clips posted for a full week). Contact a moderator to be reinstated.` | 488-505 |
| 5 | Private campaign approved (skipped for god-mode) | `This is a private campaign. Apply from the campaign card and wait for a moderator to approve you before submitting clips.` | 511-528 |
| 6 | Platform in `parseCampaignPlatforms(campaign.platforms)` (skipped when the list is empty or god-mode) | `` This campaign only accepts submissions from: ${formatPlatformList(allowedPlatforms)}. `` | 541-550 |
| 7 | ≥1 `verified_users` row for `(discord_id, platform, verified=true, deleted_at IS NULL)`. **No god-mode bypass.** | `` You must verify your ${input.platform} account before submitting. Please complete verification first. `` — **`platform` is the raw lowercase enum value**, so it reads "your tiktok account" | 555-571 |
| 8 | `extractVideoIdFromUrl` yields an id (deliberately before the external lookup, comment `:579-582`) | `Could not extract video ID from URL` | 583-587 |
| 9 | No `non_campaign_clips` row with the same `(platform, video_id)` — unless `isBigBoysNcBackfillToReplit` | `This clip has already been submitted as a non-campaign clip and can't be reused as a campaign clip.` | 589-615 |
| 10 | `!is_resubmit_prevented` — **checked BEFORE the own-rejected test, so it wins even for the clipper's own rejected clip** | `Resubmissions for this clip have been disabled.` | 632-635 |
| 11 | No matching `submissions` row unless it is the caller's own `status==='rejected'` | `This clip has already been submitted.` **(with period)** | 636-641 |
| 12 | `getPlatformMetadata(url).username` resolves | `Could not extract username from the URL` | 646-651 |
| 13 | Handle not in `banned_social_media_users`. No god-mode bypass. | `This handle is banned from submitting` **(no period)** | 653-666 |
| 14 | Handle matches one of the caller's verified handles. No god-mode bypass. | `` This link appears to belong to <${detectedHandle}>. Please submit content from a verified handle. `` — **the angle brackets are literal characters** and render as plain text | 668-681 |
| 15 | Redemption cap — `TRPCError PRECONDITION_FAILED` | `` You've submitted ${ratioN} campaign clips from @${verifiedAccount?.handle ?? "this account"} without redeeming. Submit a non-campaign clip from the same account to continue. `` | 692-713 (fresh) / 759-770 (resubmit) |
| 16 | `consumeCredit` race — `PRECONDITION_FAILED` | `Credit was claimed by another submission. Please retry.` | 750-757, 795-806 |
| — | **DEAD BRANCH** at `:788-790` re-checks a predicate the early guard already enforced | `This clip has already been submitted` **(NO trailing period — a second variant of the same string)** | 788-790 |

**God mode bypasses exactly three gates:** #4 suspension, #5 private, #6 platform. It does **not** bypass campaign-not-found/inactive/paused, verification, duplicates, handle ban, handle mismatch, or the redemption cap.

**Server — `submitNonCampaignClip` (`:843-1143`):**

| Rule | Message | Line |
| --- | --- | --- |
| Campaign exists | `Campaign not found` | 859 |
| Private approved | *(same string as #5)* | 865-885 |
| `getRatio(campaign) > 0` — ⚠️ **NOT wrapped in `isNcExemptClipper`**, unlike `createSubmission:536` | `This campaign does not require non-campaign clips. Submit a campaign clip instead.` | 887-892 |
| URL platform == submitted platform | `` This URL looks like ${detectedPlatform ?? "an unrecognized platform"}, not ${input.platform}. Pick the right platform. `` | 896-901 |
| Verified account on that platform | `` You must verify your ${input.platform} account first before submitting a non-campaign clip there. `` | 919-923 |
| Reel id extractable | `Could not detect a reel ID in your URL. Make sure it's a full post URL.` | 930-934 |
| `(platform, video_id)` unique — unless it is the caller's **own rejected** row, which is revived in place | `This clip has already been submitted as a non-campaign clip and cannot be reused.` | 956-964 |
| Own-rejected row not platform-deleted | `This clip was detected as deleted on its platform and can't be resubmitted. Submit a different clip.` | 965-969 |
| No non-rejected `submissions` row with that video id — unless `isBigBoysReplitReuse` | `This clip has already been submitted as a campaign clip and cannot be reused as a non-campaign clip.` | 972-997 |
| Handle resolves | `Could not extract the handle from your URL.` | 1001-1003 |
| Handle is one of the caller's verified accounts | `` This URL belongs to @${detectedHandle}, which isn't one of your verified accounts on ${input.platform}. Submit a non-campaign clip from one of your verified handles. `` | 1007-1011 |
| Handle not banned (added to close a clawback-reversal money path, comment `:1013-1018`) | `This handle is banned from submitting` | 1019-1031 |
| Insert race | `/duplicate\|unique/i` → `This reel was just submitted by someone else. Try a different one.`; else `Could not save your non-campaign clip. Try again.` | 1087-1095 |

**Client, non-campaign page:**

| Rule | Message |
| --- | --- |
| Platform detected | inline hint `"Couldn't detect platform — must be YouTube, Instagram, TikTok, or X."` (`:346-351`); on submit `"We couldn't detect the platform from your URL. Make sure it's a full YouTube / Instagram / TikTok / X post URL."` (`:131-136`) |
| Already submitted | branches on `alreadySubmittedKind`: `"This URL has already been submitted as a campaign clip. Each clip can only be submitted once."` / `"This URL has already been submitted as a non-campaign clip. Each clip can only be submitted once."` (`:139-146`). ⚠️ The early return happens **before** `setSubmitError(null)` at `:147`. |
| URL parses | `"That doesn't look like a valid URL."` (`:335-338`) + `aria-invalid` |

⚠️ **Zod input errors are not readable copy.** With no `errorFormatter`, a `BAD_REQUEST` zod failure arrives as the stringified `ZodError` issue array and is dumped verbatim into the same `"Unable to continue"` Alert.

### 3.D.6 The redemption ledger

`backend/src/routers/submissions/redemptionLedger.ts`. `getRatio(campaign)` (`:216-224`) returns `0` when `non_campaign_clips_required <= 0`, else `max(1, non_campaign_clips_per ?? 1)`.

`PerAccountProgress` (`:226-234`): `{verifiedUserId, handle, platform, unredeemed, cap, mustRedeem, allowedRemaining}`.

**Colour rule — duplicated identically in two files** (`submit-dashboard.tsx:159-170`, `step-2-content.tsx:222-229`):
```
blocked  = enabled && acc.mustRedeem                 -> red-300/red-50     (dark red-900/red-950)
oneAway  = enabled && acc.allowedRemaining === 1     -> amber-300/amber-50 (dark amber-900/amber-950)
else                                                 -> emerald-200/emerald-50 (dark emerald-800/emerald-950)
```

**The counter is clamped**: `Math.min(acc.unredeemed, acc.cap)` (`submit-dashboard.tsx:161-165`, `step-2-content.tsx:240`) because the raw bucket legitimately exceeds the cap after a non-campaign clip is rejected. The comment at `:162-164` notes the gate is `mustRedeem`, not the printed number.

⚠️ The **success screen on the non-campaign page uses the RAW `a.unredeemed`** (`NonCampaignClipSubmit.tsx:216`), not the clamped value.

**Blocked CTA:** `"Submit campaign clip on @X"` is rendered as a **non-navigating `<span className="cursor-not-allowed opacity-60">`** (`submit-dashboard.tsx:218-222`). The `disabled={blocked}` on the wrapping Button is **inert** — `asChild` resolves to a Radix `Slot` (`ui/button.tsx:44`), so `disabled` lands on a `<span>` where neither DOM semantics nor Tailwind's `disabled:` variants apply. The blocked look comes **only** from those two inline classes.

**Step-2 does NOT block the form.** The comment at `step-2-content.tsx:77-80` states why: the target account is unknown until the URL is pasted. `anyAtCap` only renders `"⚠ At least one of your accounts is at the cap…"` (`:261-267`).

`NC_EXEMPT_USER_IDS` (`backend/src/lib/ncExemptClippers.ts:21-23`, currently one Discord id) gives `cap = 0` in `createSubmission` (`:536-538`) — which forces `enabled:false` and therefore the redirect out of `/non-campaign`.

### 3.D.7 Visibility

| UI | Condition | File |
| --- | --- | --- |
| Whole flow → private lock screen | `isPrivate && applicationState?.application?.status !== 'approved'` | `submission-flow-layout.tsx:56-73` |
| `/submit` body → "Not accepting submissions right now" Alert | `campaignData?.submissionsPaused` — checked **after** loading, so it wins over everything except loading. ⚠️ **`/step-1` and `/step-2` do NOT check this.** | `submit-dashboard.tsx:77-98` |
| Dashboard NC rule alert / progress line / NC button | `dashboard?.enabled ?? false` | `:122-135, 192-207, 236-251` |
| Dashboard "No verified account" Alert | `perAccount.length === 0` | `:138-154` |
| Dashboard "AT CAP" badge vs green check | `blocked` / `enabled` | `:184-190` |
| Bottom "At least one account is at the cap" Alert | `enabled && perAccount.some(a => a.mustRedeem)` | `:258-268` |
| Step-1 SOP iframe vs Notion link-out vs "SOP not available" | `sopEmbedUrl` truthy; `isNotionLink` = hostname ends `notion.so`/`notion.site`, falling back to `sopEmbedUrl.includes('notion.')` when URL parsing throws | `step-1-sop.tsx:40-48, 117-165` |
| Step-2 "Submitting on @X" Sparkles Alert | `searchParams.get('verifiedHandle')` present | `step-2-content.tsx:189-202` |
| Step-2 ledger panel | `enabled && perAccount.length > 0` | `:206-269` |
| Any `StepSection` body vs `disabledMessage` | `status === 'pending'` → children replaced, `pointer-events-none select-none opacity-70`. Messages: step2 `"Add a content URL so we can detect your account."`; step3 `"Verify your handle to unlock this step."`; phone `"Complete the previous steps to continue."`; fallback `"Complete the previous step to continue."` | `StepSection.tsx:92-105` |
| Step-2 OTP panel vs amber "needs further verification" panel | `!hasVerifiedHandle && !isVerificationFetching &&` then `allowedMethods.includes('OTP')` or not | `SubmissionStep2.tsx:277-331, 333-367` |
| Step-2 "Continue" button | `hasVerifiedHandle && !isVerificationFetching && !step2Complete` | `:256-275` |
| TermsDialog intercepts Verify | `useFeatureFlag('TERMS_AND_CONDITIONS').enabled` | `:130-132, 312-318` |
| Step-3 embed variant | `isInstagram` → `<InstagramEmbed>`; `isTwitter` → `<TwitterEmbed>`; else `embedUrl` → `<iframe>`; else the "Open post in new tab" fallback with `"This platform limits embeds. Open the post to double-check."` | `SubmissionStep3.tsx:53-54, 89-124` |
| "Unable to continue" Alert | `submissionError && ctx.step3Complete` — and a `useEffect` **nulls `submissionError` whenever `step3Complete` goes false** (`:92-96`) | `step-2-content.tsx:311-317` |
| Non-campaign page exists | `progress.enabled !== false`; the effect waits out `isLoading` and `isError` before deciding, so an errored query leaves the form visible | `NonCampaignClipSubmit.tsx:76-82` |
| Non-campaign preview panel | `validUrl && guessedPlatform && debouncedUrl` | `:356` |
| Non-campaign submit disabled | `submitMutation.isPending \|\| !validUrl \|\| !guessedPlatform \|\| preview?.alreadySubmitted === true`. ⚠️ A not-yet-run or in-flight preview leaves it **enabled**. ⚠️ A handle mismatch does **not** disable it. | `:434-439` |
| Non-campaign success variant | `progress?.enabled && anyAccountAtCap` → destructive `"Submitted — but you still owe more"`; else neutral `"Submitted"` | `:202-257` |

⚠️ **Unreachable UI in `SubmissionStep1`:** the blue "How this campaign works" box and the extra "Campaign reel #N" inputs are gated on `showInstructions = isBatch || nonCampaignRequired > 0`, but the props default to `campaignReelCount=1` / `nonCampaignRequired=0` and the **only** call site (`step-2-content.tsx:271-273`) passes neither. Dead in the current flow.

### 3.D.8 After submit

**Campaign clip — success:**
1. `utils.campaigns.getAll.invalidate()` — **the only invalidation**. `getRedemptionProgress` and `getCampaignAccountDashboard` are deliberately left stale.
2. Context wiped: all of `contentUrl`, `detectedPlatform`, `detectedHandle`, `hasVerifiedHandle`, `isUserGeneratedContent`, `step1Complete`, `step2Complete`, `step3Complete` (`:123-130`). **`phoneStepComplete` is NOT reset.**
3. `trackEvent({event:'submission_step2_submit_success', properties:{campaignTitle, campaignId, submissionId: s?.id}})`.
4. `navigate('/campaign/${campaignId}/step-3')` — a **push**, not replace. **No toast.**

**Campaign clip — failure:** `trackEvent('submission_step2_submit_error', {campaignTitle, campaignId, error, contentUrl})`; `submissionPhase` → `'idle'`; `setSubmissionError(error.message ?? 'Please try again shortly.')`. The user stays on `/step-2`; **context is NOT cleared**, so the form stays populated. The Alert does show, because `step3Complete` is still true on this path.

> ⚠️ `submissionPhase`'s union is `'idle' | 'submitting' | 'success'` but **`'success'` is never assigned** — the handler navigates away instead. There is no success toast anywhere in step-2.

**Server-side effect (fresh):** inserts a `submissions` row id `` `submission_${Date.now()}` `` with `status 'pending'`, `views 0`, `reward 0`, `active true`, `url = resolvedUrl` (not the raw pasted URL), `verified_user_id`, `redeemed_by_non_campaign_clip_id = claimedCreditId` (`:808-824`), then re-selects and returns it.

**Server-side effect (the SILENT RESUBMIT path, `:731-787`):** **no new row.** The clipper's own rejected submission is UPDATEd in place — `status → 'pending'`, `rejected_reason → null`, `reviewed_by → null`, `is_resubmit_prevented → false`, `redeemed_by_non_campaign_clip_id = resubmitClaimedCreditId` — and then **`return existingSubmission`**, the PRE-UPDATE snapshot fetched at `:721-729`. So the returned object still carries `status 'rejected'` and the OLD submission id.

> ⚠️ The UI never reads `status` (only `s?.id` at `:136`), so **a resubmit is completely indistinguishable from a create.** There is no "your rejected clip was resubmitted" copy anywhere on the campaign-clip path — unlike the non-campaign page, which does have it.

**`/step-3`:** confetti on mount and again after 400 ms (`step-3-finish.tsx:36-41`); clicking the Atomik logo re-fires it (`:57`). Three cards: "Submit another" → `/campaign/:id/submit` (falls back to `/` when `campaignId` is absent, `:88-94`); "My Campaigns" → `/submissions` (`:114`); "Open Discord" → `window.open('https://discord.com/channels/1395157211839201400/1395362775534014525','_blank')` (`:137-142`).

**Non-campaign clip — success:** `setSuccess({coveredCount, creditRemaining, resubmitted})` then `await utils.submissions.getRedemptionProgress.invalidate({campaign_id})` (`:154-163`). **No navigation, no toast** — the success screen replaces the form in place. The url input is NOT cleared until the user clicks "Submit another…".

Copy branches:
- `resubmitted` → `"Your previously rejected non-campaign clip was resubmitted and is back in the review queue."`; else `"Your non-campaign clip is in."`
- `coveredCount > 0` → `"It covered <b>{n}</b> campaign clip(s) you'd already submitted (they're now eligible for payout)."`; else `"You didn't have any unredeemed campaign clips — this one will cover your next campaign submission(s)."`
- `creditRemaining > 0` → `"You can now submit <b>{n}</b> more campaign clip(s) before needing another non-campaign clip."`; else `"You'll need another non-campaign clip before your next campaign submission."`
- Always: `"Once a moderator accepts this clip, any campaign-clip earnings that were paused by an earlier rejection are restored automatically — within 24 hours of acceptance."`

**Non-campaign server effect:** inserts (or revives in place, `:1049-1069`) a `non_campaign_clips` row with `status 'pending'` and `credit_remaining = ratioN - toCover.length`; then in one UPDATE sets `redeemed_by_non_campaign_clip_id` and **nulls `baseline_frozen_views`** on the up-to-N oldest unredeemed campaign clips (`:1103-1115`); then per covered clip calls `reverseClawback({clawbackSourceType:'noncampaign_uncovered', reverseSourceType:'noncampaign_recovered', reinstateReward:true})` and `voidOutstandingReserve(id,'noncampaign_uncovered')` (`:1121-1134`). Coverage is **oldest-first, same verified account** (`redemptionLedger.ts:184-209`).

### 3.D.9 Ineligible / incomplete / already-completed

- **Suspended for inactivity:** nothing on step-2 warns them. Every step completes, the button is enabled, and only on click does the message appear. The only other surface is the notification created at suspend time (`metadata.type 'campaign-suspension'`, `expires_minutes 14*24*60`, title `"Suspended from campaign"`, body `` `You've been suspended from "${campaignTitle}" for not posting any clips for a full week (inactivity). You can no longer submit clips to this campaign until a moderator reinstates you.` ``). **No frontend query anywhere reads `campaign_suspensions` for the clipper's own state.**
- **Campaign paused:** no pre-check on step-1/step-2 — a deep-linked clipper gets the full form and only discovers the block on submit.
- **Handle banned:** no client surface at all.
- **Method not allowed by the campaign:** purely client-side — `SubmissionStep2` forces `step2Complete`/`step3Complete` false (`:123-128`) and renders an amber panel: `"This account needs further verification to enter this campaign. Consider creating a new account with a different verification method. Reach out in Discord if you need more help."` plus `"This account was verified using <Profile Verification|login verification|manual verification>."` and a "Go to social verification" button → `/verification/flow`. No server counterpart.
- **At the cap:** dashboard card red + AT CAP badge + non-link CTA; step-2 advisory only; server throws PRECONDITION_FAILED. The `PRECONDITION_FAILED` **code is never read client-side**, so the message lands in the same generic Alert with no "go submit a non-campaign clip" affordance on the error itself.
- **Duplicate clip:** campaign path has **no client-side duplicate check at all**. Non-campaign path surfaces it before submit.
- **Own rejected clip:** campaign path = silent resubmit (above). Non-campaign path = explicitly signposted with the amber `"↻ This clip was rejected before. Submitting it again sends it back to the moderators for a fresh review."`
- **Already verified handle at step 2 start:** `useHandleVerified` sets `hasVerifiedHandle` via effect, the green `"We've confirmed ownership of this handle."` box + Continue appear, but `step2Complete` does **not** auto-set — the clipper must click Continue. `startVerification` is nevertheless fired (`:88-93`), so a bio code is generated **even for already-verified accounts**.
- **Landing on `/step-3` without submitting:** nothing stops it.
- **Navigating back to `/step-1` or refreshing:** the provider remounts, everything is lost, no warning, and the pasted URL is gone too (it is local to `SubmissionStep1`).
- **Signed out on `/step-2`:** the page renders; the redirect only fires on the first keystroke. Meanwhile `getRedemptionProgress` and `user.getProfile` are already erroring.
- **`getPlatformMetadata` throws while typing:** `handleContentUrlChange` has a `try/finally` with **no `catch`** (`:117-156`) — the rejection propagates as an unhandled promise rejection from an async onChange. **Nothing is displayed;** the field simply never populates.
- **`success:false` / `platform: null`** (e.g. a LinkedIn URL — `'linkedin'` is in the metadata union but not in `SUPPORTED_PLATFORMS`) → the unsupported-platform branch.
- **`user.getProfile` errors:** see 3.B — fails open, submit unblocked, `"Profile unavailable"` Alert.
- **NC-exempt clipper on a campaign that requires NC clips:** `createSubmission` sets `ratioN = 0` so no gate fires; `submitNonCampaignClip` does **not** apply the exemption, but the page's own `enabled===false` redirect covers it.
- **NC feature off / clipper exempt on `/non-campaign`:** redirect to `/submit`, which then redirects to `/step-1` — a two-hop chain.
- **Batch/admin picks up a queued crypto claim:** see 3.G.

### 3.D.10 Loading / empty / error states

| Surface | Behaviour |
| --- | --- |
| `/submit` loading | Card whose title is the literal `"Loading…"` and whose body is a spinning `Loader2 h-5 w-5` (`submit-dashboard.tsx:63-74`) |
| `PrivateCampaignGate` | `Loader2` + `"Loading campaign…"`, py-20 |
| `/step-1` | centred `Loader2 h-6 w-6` over `"Loading campaign details..."` |
| URL detection | `loadingSocialDetection` adds `pr-10`, sets `aria-busy`, renders an absolutely-positioned `Loader2` at `right-3 top-1/3` |
| Verification | `"Checking…"` next to the platform badge; `"Generating your verification code…"` in a dashed box; Verify button `"Checking…"` |
| Content preview | dashed box + `"Fetching preview…"` |
| Submit button | `Loader2` + the word `"Submitting"` (no ellipsis) |
| NC preview | `Loader2` + `"Checking URL…"` |
| Empty: no verified accounts | destructive Alert `"No verified account"` / `"You haven't verified a {allowedPlatforms.join(' / ') ?? 'supported'} account for this campaign yet. Verify one to start submitting clips."` + button to `/verification` |
| Empty: ledger with no activity | the whole panel is hidden — **no empty-state copy** |
| Empty: no SOP | Alert `"SOP not available"` / `"The campaign has not provided an SOP embed yet. Please reach out to the campaign manager for the latest instructions."` — effectively unreachable because of the auto-skip |
| Empty: step-2 before platform | `"We'll detect the platform and handle automatically once the link loads."`; platform known, handle not → `"We're still reading the handle from your link."` |
| Empty: step-3 | `"We'll load a preview automatically once the link finishes processing."`, or nothing |
| Empty: NC preview box | renders **empty** when `ok:false` with an unknown platform (all three branches false) |
| Error: `/step-1` | Alert `"Unable to load campaign"` / `"We couldn't fetch the campaign details. Please try again."` |
| Error: submit | Alert `"Unable to continue"`, `className="my-2 max-w-xl mx-auto"`, rendered **below** the submit button, inside the `<form>` but after `<CardFooter>` |
| Error: preview | dashed red box `"We couldn't load a preview for this link."` + `previewError.message`. `retry:false`, exactly one attempt |
| Error: NC submit | Alert `"Submission failed"` with AlertCircle, rendered **inside CardContent above the footer** — the opposite side from step-2 |
| Toasts in this flow | Only from `useAccountVerification` (`"Unable to start verification"`, `"Account verified"` / `"You're all set!"`, `"Verification needed"`, `"Verification failed"`) and the phone step (`"Phone number saved"`). **No toast on successful clip submission.** |

Static informational blocks always present on the NC form: `"Paste a public post URL from your own account — same account as the campaign clips you've been posting. Each non-campaign clip URL can only be used once across all clippers."` and an Alert titled `"Restoring paused earnings?"`, plus a back-link `"Back to submission dashboard"` with an ArrowLeft.

---

## 3.E Social account verification

> **Scope correction from the audit:** `routers/youtubeOAuth.ts` and `routers/instagramOAuth.ts` are **NOT** part of account connection. They belong to demographics (3.F). **No social account is ever linked or verified via OAuth in this codebase.** Account linking is 100% bio-code based, with an optional credential-generation pre-step. There is no `frontend/src/pages/verification-flow/` directory — only `social-verification-flow/`.

### Flow

**Hub** — `/verification` (`pages/SocialVerification.tsx`). H1 "Social Verification", sub "Verify your social media accounts to start submitting content". Grid `grid-cols-1 md:grid-cols-2 gap-6` of four `<VerificationCard>` in order **instagram, youtube, x, tiktok** (`:8-29`). Static footer "Why verify your accounts?" with four bullets: `"Verify ownership of your social media accounts"`, `"Prevent impersonation and fraud"`, `"Required before submitting content to campaigns"`, `"You can verify multiple accounts per platform"`.

⚠️ The same component is **also rendered inline** as a Home dashboard section (`Home.tsx:265`).

**Method chooser** — `/verification/flow` (`step-0-select-method.tsx`). Card "Select how you want to verify" / "Pick a method to continue—both work for every platform." Two options (`:24-40`):
- `login` → "Create Login" / "Use an Atomik Clips email + password to get started quickly." / badge "Recommended" (`hidden md:block`) / icon KeyRound / `/verification/flow/create-login`
- `bio` → "Profile Verification" / "Add a code to your social bio and we'll verify ownership." / icon ShieldCheck / `/verification/flow/bio`

Navigating on preserves the **entire** query string (`:80-85`), which is how `?platform=` reaches the next step.

**Bio flow** — `/verification/flow/bio`. Optional platform picker (only when there is no valid `?platform=`), then a StepSection "Add verification code" hosting `<VerificationCardVerifyBio key={platform.id} refetchVerification={() => {}}/>`.

⚠️ **`refetchVerification` is a NO-OP here** (`bio-verification.tsx:145`). The list only refreshes because of the `navigate('/verification')` that follows.

**Login flow** — `/verification/flow/create-login`. 4 or 5 StepSections: (platform picker) → email → username + "Next" (generates credentials) → review + "Validate" → OTP + "Verify OTP".

### Procedures

| Procedure | Kind | Auth | Input | Notes |
| --- | --- | --- | --- | --- |
| `verification.checkVerification` | query | protected | `{platform: z.enum(["youtube","instagram","tiktok","x"])}` | `verified_users` LEFT JOIN `verified_login_credentials`, `WHERE discord_id = ctx.user.id AND platform AND verified = true AND deleted_at IS NULL`. Returns `{verified, verifiedAccounts[…, verification_method (credentials?.verification_method ?? "OTP"), login_creds_email, login_creds_password, login_cred_forwarding_email, login_creds_manually_verified_at], verifiedUser: [0] \|\| null}`. ⚠️ **`"OTP"` is NOT a DB enum member** — the column enum is only `'login-flow'\|'manual'` (`schema.ts:157-162`); it is what the API reports when there is no linked credentials row. `verification.ts:230-278` |
| `verification.initializeVerification` | mutation | protected | `{platform, handle: z.string()}` — **no min length; an empty string passes zod** | Loads ALL rows for `(discord_id, platform)` **without a `deleted_at` filter**, matches handle case-insensitively. Soft-deleted match → **UNDELETED** (`:164-169`). No match → `assertHandleNotOwnedByAnother` then INSERT with `guild_id='default_guild'`, `username = ctx.user.discordUsername \|\| ""`, `verify_code = Math.random().toString(36).substring(2,8).toUpperCase()` (6 uppercase alphanumerics), `verified=false`. Match but unverified → **a BRAND NEW code is generated and written** (`:207-217`) and the old one stops working. Match already verified → the EXISTING code is returned unchanged and nothing is written. Returns `{verifyCode, handle, platform, isNewRecord, message: \`Add "${verifyCode}" to your ${platform} bio, then click verify.\`}` |
| `verification.verifyUserBio` | mutation | protected | `{platform, handle: z.string()}` | Missing row → **plain `new Error("No verification record found. Please initialize verification first.")`** → INTERNAL_SERVER_ERROR. Already verified → `{success:true, verified:true, message:"Account already verified!"}`, **writes nothing, does not re-check the bio**. `god-mode` bypasses the bio check entirely and returns `"Account verified via god-mode bypass."`. On match: `captureStableIdAndEnforceOneAccount` (may THROW CONFLICT), then `verified = true` + `verified_login_credentials_id`. **On no match it returns HTTP 200** with `{success:false, verified:false, verifyCode, message: \`Code "${verifyCode}" not found in bio. Please add it and try again.\`}`. `:429-560` |
| `verification.handleExists` | query, called imperatively via `utils.…fetch` | protected | `{platform, handle: z.string().min(1,"Handle is required"), forwardEmail: z.string().email("Invalid email address")}` | ⚠️ **Despite the name this is the credential GENERATOR with heavy side effects.** Existing row for `(user_id, platform, handle)` (exact, case-sensitive) → `{exists:false, platform, handle, email, password}` — the comment at `:306` calls the semantics *"a bit hacky"*: `exists:false` means "does not exist for someone ELSE". The `else` branch at `:313-330` is **UNREACHABLE** (it sits inside the `else` of `user_id === ctx.user.id`, but the query already filtered on that). Then `checkHandleExists` on the platform API: exists → `{exists:true, platform}`. Otherwise generates a pair, inserts `verified_login_credentials` with `verification_method 'login-flow'`, calls `ensureForwardEmailAlias`. `:281-372` |
| `verification.verifyLoginCredentials` | mutation | protected | `{platform, handle: z.string()}` | Sets `verification_method='login-flow'` and `verified_at=now`; returns `{success:true, message:"Login credentials verified successfully!"}`. ⚠️ **It performs NO actual validation** — the `checkHandleExists` call that would return `"Login credentials not valid"` is **commented out** (`:402-412`). Today it can only succeed or 404. `:374-426` |
| `verification.validateLoginCredentials` | mutation | protected | `{platform, handle}` | Throws `NOT_FOUND "Handle not found"` or returns undefined. Contains a `// TODO: check emails forwarded`. **DEAD CODE — zero frontend callers.** `:607-630` |
| `verification.removeVerification` | mutation | protected | `{id: z.string()}` | **Soft delete**: `deleted_at = now` AND `verified = false`. Missing OR not the caller's → `NOT_FOUND "Verification record not found"` (ownership failure is deliberately indistinguishable from not-found). **Does NOT touch the credentials row and does NOT delete the ForwardEmail alias.** `:562-605` |

### Fields collected

| Field | Type | Required | Where | Constraints |
| --- | --- | --- | --- | --- |
| `platform` | enum, exactly those four lowercase literals | yes | platform tiles (`bio-verification.tsx:85-129`, `login-verification.tsx:308-352`) or `?platform=` (lowercased, validated against known ids; anything else → `null` and the picker shows) | ⚠️ The bio tiles are **duplicated locally** (`bio-verification.tsx:9-34`) rather than imported from `platform-options.ts`; the only visible difference is X labelled `"X"` there vs `"X (Twitter)"` in `platform-options.ts:19` |
| `handle` | string | yes | bio: `<Input id={`handle-${platform}`}>`, label `"Channel Handle"` when youtube else `"Username"`, placeholder `"@YourChannelHandle"` / `"@yourusername"` (`VerificationCardVerifyBio.tsx:202-214`). login: `<Input id="verification-username">`, label `"Username"`, helper `"This MUST match the handle you use on social. Your login credentials will be generated from this handle."` (`login-verification.tsx:401-412`) | Client `normalizeHandleInput` strips whitespace and **all leading `@`** (`rawHandle.trim().replace(/^@+/, '')`). **Server trims but does NOT strip `@`** — a direct API call with `@foo` stores `@foo`. `verified_users.handle` is `varchar(100)`. **Matching is case-insensitive everywhere in `verification.ts` EXCEPT the `verified_login_credentials` lookups**, which use exact `eq()` (`:299, 391, 483, 528`) |
| `forwardEmail` | string (email) | yes | login only — `<Input id="verification-contact-email" type="email" inputMode="email" label="Email address" placeholder="you@example.com" required>` (`:364-378`), description `"We'll send any updates or password verification emails here."` | client `isValidEmail` = non-empty AND `/.+@.+\..+/`; server `z.string().email("Invalid email address")` |
| `verified_users.id` | cuid2 | yes | from the row's "Remove account" button (`VerificationCard.tsx:205`) | server re-checks ownership |
| Terms acceptance | boolean, transient | no | `TermsDialog`, only when `TERMS_AND_CONDITIONS` is on | **Purely client-side — nothing about acceptance is sent to the server or persisted anywhere.** |
| `discord_id` / `username` | string | yes | never entered — `ctx.user.id` / `ctx.user.discordUsername` | `username` written as `ctx.user.discordUsername \|\| ""` |
| `guild_id` | string | yes | hardcoded `const guildId = "default_guild"` (`verification.ts:145`) | part of the unique index |
| `verify_code` | 6 uppercase alphanumerics | yes | generated server-side, displayed to the user | `varchar(20)`. **No expiry field and no expiry check anywhere.** Regenerated on every `initializeVerification` against an unverified row. |
| generated `email` + `password` | strings | no | returned by `handleExists`, rendered in the purple "Generated Login Details" Alert with per-field copy buttons (`login-verification.tsx:447-520`), re-displayed on the hub card | `email = \`${handle.toLowerCase()}@${randomAliasDomain()}\``; password = two capitalised words + 2 digits + one of `! $ ?` (e.g. `NovaCipher47$`). **Shown in PLAINTEXT behind an eye toggle and stored in plaintext** in `verified_login_credentials.password varchar(255)`. |

### Validation

| Rule | Where | Exact message |
| --- | --- | --- |
| Handle required (bio start) | client | toast `{title:"Error", description:"Please enter your account handle", variant:"destructive"}` |
| Handle required (bio verify) | client | same |
| Handle min 1 | server `handleExists` | `"Handle is required"` |
| Email valid | server | `"Invalid email address"` |
| Email valid | client | inline `"Enter a valid email so we know where to reach you."`; on submit toast `"Add your email"` / `"Enter a valid email address before continuing."` |
| Platform chosen | client | toast `"Choose a platform"` / `"Select which account you're creating credentials for."` |
| Username non-empty | client | toast `"Add your username"` / `"Enter your social handle to continue."` |
| **ONE ACCOUNT PER HANDLE — pass 1, by handle, at `initializeVerification`** (only when creating a genuinely new link) | server `verification.ts:39-82`, invoked `:176-182` | `CONFLICT:` `` `This ${platform} account (@${display}) is already linked to another clipper. Each social account can only be connected once — please use a different account, or contact a moderator if you believe this is your account.` `` |
| A conflicting row blocks only if `verified === true` OR `created_at` is newer than **24 h** (`STALE_UNVERIFIED_CLAIM_MS`) | server `:37, 64-65` | same, or none |
| **Pass 2, by stable platform account id**, also at `initializeVerification`. **Best-effort:** if `resolvePlatformAccountId` throws or is not `'ok'`, the check **silently returns without blocking** | server `:96-132` | same |
| **Pass 3 — final enforcement at `verifyUserBio`**, keyed on `platform_account_id`, only against `verified=true AND deleted_at IS NULL`. `ONE_ACCOUNT_RULE_ENABLED = true` | `backend/src/lib/oneAccountRule.ts:14, 41-68` | `CONFLICT "This social account is already linked to another Atomik account. Each social account can only be connected to one web-app account."` |
| **Shared-account carve-out** — a conflict row is ignored when the handle is in `SHARED_SOCIAL_ACCOUNTS` and **both** Discord ids are listed owners. Applied per-row in all three passes, so an unsanctioned third claimant still blocks. **Not platform-scoped.** | `backend/src/lib/sharedSocialAccounts.ts:53-65` | suppresses the CONFLICT. Current allowlist: exactly one entry, handle `growasentrepreneurs`, owners `755628278298968075` and `296884557972504577` |
| Bio contains the code — **substring match, case-SENSITIVE**, `bio.includes(code)` | server `:511-559`, fetch in `checkBio` `:649-756` | not an error — `{success:false, …}`. Per-platform: instagram RapidAPI `biography`; youtube googleapis `channels.list forHandle → brandingSettings.channel.description`; x RapidAPI `legacy.description`; tiktok RapidAPI `user.signature`. ⚠️ **Any thrown error in `checkBio` is swallowed and returns false**, so an API outage is indistinguishable from "code not in bio". |
| Record must exist before verify | server | `"No verification record found. Please initialize verification first."` (a **bare `new Error`**) |
| Credentials row must exist | server | `NOT_FOUND "Login credentials not found"` |
| Credential pair generation | server | `INTERNAL_SERVER_ERROR "Failed to generate credential pair"` |
| Removal ownership | server | `NOT_FOUND "Verification record not found"` |
| Terms scroll gate | client `TermsDialog.tsx:45-59` | hint `"(Please scroll to the bottom)"`; gate is `scrollHeight - scrollTop - clientHeight <= 4` |
| DB uniqueness `(guild_id, discord_id, platform, handle)` | database `schema.ts:118-123` | raw MySQL duplicate-key error — **no friendly message exists** |
| **NO DB unique index on `(platform, handle)` across users** — deliberately absent | — | comment `verification.ts:16-37`: production contained 11 conflicting handles / 37 rows predating the rule, so the index could not be created. **Application-layer only.** |

### Visibility

| UI | Condition | File |
| --- | --- | --- |
| "Create Login" option | `useFeatureFlag('SOCIAL_LOGIN_VERIFICATION').enabled` — **or `loginFlagLoading`** (`if (option.id === "login" && !loginVerificationEnabled) return loginFlagLoading;`) so it does not flash | `step-0-select-method.tsx:46-56` |
| "Profile Verification" option | always | `:33-39, 53` |
| "Recommended" badge | `option.badge` set AND viewport ≥ md | `:102-109` |
| Verified-accounts accordion | `!isStatusLoading && verificationStatus?.verified && verifiedAccounts.length > 0`. `Accordion type="multiple"`, **all items default-open**; container `max-h-[420px] overflow-y-scroll` | `VerificationCard.tsx:274-302` |
| ShieldCheck badge on a row | `account.login_creds_email && account.login_creds_password` | `:83-85` |
| Login Email / Password / Forwarding Email blocks | each independently on truthiness | `:99-143` |
| Password plaintext vs `************` | local `showPassword` per row (Eye/EyeOff ghost button) | `:74, 117, 130` |
| Bio flow Start vs Verify button | `verificationStarted` — set true only after a successful `initializeVerification`, reset false after a successful verify | `:215-256` |
| Handle Input disabled | `isVerifying \|\| isInitializing \|\| verificationStarted` — **once Start succeeds the handle can no longer be edited on that mount** | `:213` |
| Blue "Verification Code" Alert (4-step instructions) | `verificationCode` non-null | `:260-274` |
| TermsDialog before verifying | `useFeatureFlag('TERMS_AND_CONDITIONS').enabled` | `:234-240` |
| Bio step-2 body vs placeholder | `selectedPlatform` truthy, else `"Choose a platform above to get your verification code instructions."` | `bio-verification.tsx:140-152` |
| Login "Next" button | rendered only while `!credentials` — **it disappears once credentials exist** | `login-verification.tsx:419-434` |
| Login "Generated Login Details" alert vs placeholder | `credentials` truthy, else `"Enter your username and click Next to generate credentials."` | `:445-547` |
| Login "Validate" disabled | `isValidatingCredentials \|\| validationSuccess` — ⚠️ `validationSuccess` is `boolean\|null`, so `null` is falsy and **enables** the button | `:526` |
| Green "Account creation successful on {platform}." | `validationSuccess === true` | `:536-540` |
| OTP box — three states | `verificationPhase === 'initializing'` → `"Generating your OTP…"`; else `verificationCode` → the code in a dashed primary box with a copy button; else `"We'll generate your OTP shortly."` | `:569-597` |
| "Verify OTP" disabled | `loadingVerificationCheck \|\| !verificationCode \|\| !usernameNormalized` | `:612-616` |
| Platform-picker step (both flows) | `showPlatformStep = !normalizedPlatformFromQuery`. **When hidden every downstream step number shifts down by one** (`bio`: `verificationStepNumber = showPlatformStep ? 2 : 1`; `login`: `emailStepNumber = showPlatformStep ? 2 : 1` then +1 each) | `bio-verification.tsx:53-54`, `login-verification.tsx:58-62` |
| Sidebar "Social Verification" | `AppLayout showSidebar` — **plain clippers see NO sidebar** and reach verification through the Home dashboard section | `AppLayout.tsx:28-30` |

### State stored

- MySQL `verified_users` (`schema.ts:73-134`): `id` cuid2, `discord_id`, `guild_id` (always `'default_guild'`), `username`, `platform`, `handle`, `verify_code`, `verified`, `verified_login_credentials_id`, `platform_account_id`, `platform_account_secondary_id`, `platform_account_id_resolved_at`, `account_unavailable_strikes`, `account_deleted_at`, `account_last_checked_at`, `deleted_at`, timestamps. Indexes: unique `(guild_id, discord_id, platform, handle)`, `(discord_id, platform)`, `(platform, platform_account_id)`.
- MySQL `verified_login_credentials` (`:136-178`): `user_id`, `email`, `password` (**PLAINTEXT**), `youtube_password`, `instagram_password`, `mod_alias_tag`, `platform`, `handle`, `forwarding_email`, `login_creds_manually_verified_at`, `verification_method` enum `('login-flow','manual')` default `'login-flow'`, `verified_at`, timestamps.
- **ForwardEmail (external SaaS)**: alias `<handle>@<random ALIAS_DOMAIN>` forwarding to the contact email, `is_enabled true`, `has_imap true`. Created during `handleExists`; **never deleted by `removeVerification`**. `ensureForwardEmailAlias` is documented to **never throw** (`forwardEmail.ts:111-114`) — it logs and returns false.
- react-query: `checkVerification` per platform (no custom options on the VerificationCard query; `useHandleVerified` additionally sets `refetchOnWindowFocus:false`); `handleExists` populated by the imperative `.fetch`, so **repeated identical calls may be served from cache**.
- **NOTHING is stored in localStorage or sessionStorage anywhere in this area.** A refresh mid-flow loses the entered handle, the generated credentials display and the local code; the server-side `verify_code` survives but is **rotated** on the next `initializeVerification`.
- `?platform=<id>` is the only flow state carried across routes.
- Analytics events: `social_verification_start_clicked`, `social_verification_start_result {status: success|error, errorMessage}`, `social_verification_verify_clicked`, `social_verification_verify_result {status: verified|code_resent|error}`, `social_verification_remove_account_clicked`, `social_verification_remove_account_result`, `social_verification_login_credentials_generated {method:'flow', handle, platform}`.

### After submit

| Action | Result |
| --- | --- |
| Bio "Start" success | `setVerificationCode`, `setVerificationStarted(true)`, toast `{title:"Verification Started", description: result.message}`. Handle Input becomes disabled; Start → Verify; blue code Alert appears. **No navigation, no invalidation.** |
| Bio "Start" throws | toast `{title:"Error", description: error.message, destructive}`. `verificationStarted` stays false so the handle can be edited and retried. |
| Bio "Verify" with `result.verified === true` | toast `{title:"Success!", description: result.message}`; clears code/started/handle; calls `refetchVerification()` — **a NO-OP when reached via `/verification/flow/bio`** — then `navigate('/verification')`. The hub's own query refetching on mount is what actually makes the account appear. |
| Bio "Verify" with `result.verified === false` | **NOT treated as an error.** `setVerificationCode(result.verifyCode \|\| null)`; toast `{title:"Verification Code", description: 'Code "X" not found in bio. Please add it and try again.', variant:"default"}`. Stays on the page; retry indefinitely. |
| Bio "Verify" throws | toast `{title:"Error", description: error.message, destructive}`. Stays with the code shown. |
| Login "Next" → `exists:true` | toast `{title:"Handle already exists", description: \`@<handle> already exists on <Platform>. Try a different handle.\`, destructive}` |
| Login "Next" → `exists:false` without email/password | toast `{title:"Unable to generate credentials", description:"Please try again in a moment.", destructive}` |
| Login "Next" success | `setCredentials`, `setValidationSuccess(null)`; "Next" disappears; purple alert renders; `trackEvent social_verification_login_credentials_generated`. There is a **commented-out** `// navigate('/verification')` at `:172`. **Server-side a `verified_login_credentials` row and a ForwardEmail alias already exist.** |
| Login "Validate" success | `setValidationSuccess(true)`, `setOtpVerificationSuccess(false)`, then **immediately** calls `startVerification(platform, handle)` which fires `initializeVerification` and puts an OTP on screen. A success toast exists but is **COMMENTED OUT** (`:244-248`). Visible feedback = the green line + the OTP step unlocking. |
| Login "Validate" fails/throws | `setValidationSuccess(false)`; destructive toast `{"Handle not validated", result.message ?? \`We couldn't validate @<handle> on <Platform>.\`}` or `{"Unable to validate", error.message ?? "Please try again shortly."}`. Since the real check is commented out server-side, **only the NOT_FOUND path can realistically produce this.** |
| "Verify OTP" success | `useAccountVerification` invalidates `verification.checkVerification` for that platform, toasts `{"Account verified", "You're all set!"}`, clears the code, returns true → `navigate('/verification')` |
| "Verify OTP" not-verified | `setVerificationCode(result.verifyCode ?? previous)`; destructive toast `{"Verification needed", result.message ?? "Add the code to your bio and try again in a few moments."}`; **no navigation** |
| "Verify OTP" throws | destructive toast `{"Verification failed", error.message ?? "Please try again shortly."}` |
| Remove account confirm | closes the dialog first, then `setRemovingAccountId(id)` (spinner replaces Trash2 on that row; **both** dialog buttons disabled while removing). Success: toast `{"Account removed", \`@<handle> has been disconnected.\`}` then `await refetchVerification()` — **this one IS real** (the hub card owns the query). Failure: toast `{"Unable to remove account", …, destructive}`, row stays. Server: soft delete only; **credentials row and ForwardEmail alias left intact.** |
| Method selection | `navigate(route + '?' + existing query string)`. No server call. |

### Ineligible / incomplete / already-completed

- **Banned:** `UNAUTHORIZED "User is banned"` on every procedure. Does not match the force-logout regex, so the page renders with failing queries and error toasts. **No dedicated banned screen in this area.**
- **Handle owned by another clipper (at Start):** the long CONFLICT paragraph in a destructive toast titled `"Error"`. **No dedicated UI, no "request transfer" affordance, no link to a moderator.**
- **Handle free at Start but the stable id is taken at Verify:** the CONFLICT throws from inside `verifyUserBio` — **after** the clipper has already put the code in their bio.
- **Platform API unreachable during the pre-check:** deliberately non-blocking (`try { … } catch { return; }`, `if (outcome.status !== 'ok') return;`). The user proceeds and is re-checked at verify time.
- **Shared-account allowlist:** the CONFLICT is suppressed silently — **no UI acknowledges that a shared account is in play.**
- **Started and abandoned:** an unverified row exists with a code, but **it does NOT appear anywhere in the UI** — `checkVerification` filters `verified = true`. The hub shows "Not verified" with no pending state and no way to resume. Returning and re-entering the same handle **generates a BRAND NEW code**, invalidating whatever was already pasted into the bio. After 24 h the abandoned claim stops blocking other clippers.
- **Login flow abandoned after credentials are generated:** the credentials row and the ForwardEmail alias already exist server-side, but no `verified_users` row does, so the orphan credentials are **invisible on the hub**. Re-running "Next" with the *exact same* handle returns the SAME stored email/password — the only recovery path.
- **Page refreshed mid-flow:** all local state lost.
- **Verifying an already-verified handle:** short-circuits, returns `"Account already verified!"` **without re-checking the bio and without writing**. The UI treats it exactly like a fresh success.
- **`initializeVerification` on an already-verified handle:** returns the existing code unchanged, `isNewRecord false`, writes nothing, and **`assertHandleNotOwnedByAnother` is skipped**.
- **Re-adding a previously removed handle:** the soft-deleted row is found (the SELECT has no `deleted_at` filter) and **UNDELETED**, but `verified` stays as-is — and `removeVerification` set it false, so it comes back unverified and must be re-verified. **The one-account check is SKIPPED** for it.
- **Multiple accounts per platform:** fully supported, and the hub page says so.
- **Case / `@` variations:** `verified_users` lookups are case-insensitive; `verified_login_credentials` lookups are exact — so a case difference between the credential-generation step and the verify step **silently yields no credentials row** and `verified_login_credentials_id` is left null.
- **Bio-check API outage:** reported to the user as `Code "X" not found in bio. Please add it and try again.`
- **Code expiry:** there is none.
- **ForwardEmail alias creation fails:** never throws; credentials are still returned and stored; the clipper silently receives no forwarded mail. **No UI signal.**
- **God-mode:** bio check skipped, message `"Account verified via god-mode bypass."` **The one-account rule STILL applies.**
- **Removal of someone else's / already-deleted record:** identical `NOT_FOUND "Verification record not found"`.

### Loading / empty / error states

| Surface | Behaviour |
| --- | --- |
| Card status line | `"Fetching status…"` while loading; then `` `${n} account${n !== 1 ? 's' : ''} verified` `` or `"Not verified"` |
| Card body skeleton | two `h-16 w-full animate-pulse rounded-lg bg-muted/60` placeholders |
| **Empty — no verified accounts on a platform** | **NO empty-state copy at all.** The accordion block simply does not render (`VerificationCard.tsx:302`); only "Not verified" and "Add Account" remain. **This is the single biggest gap in the current UI.** |
| Bio Start / Verify buttons | `Loader2` + `"Starting..."` / `"Verifying"` (non-loading Verify shows a RefreshCw icon) |
| Login Next / Validate / OTP-gen / Verify OTP | `"Checking..."` / `"Validating..."` / `"Generating your OTP…"` / `"Checking…"` |
| Account removal | Trash2 → spinning `Loader2`, disabled; both AlertDialog buttons ("Keep account" / "Remove account") disabled |
| Empty — bio before platform | `"Choose a platform above to get your verification code instructions."`; pending StepSection instead shows `"Select a platform first to continue."` |
| Empty — login before credentials | `"Enter your username and click Next to generate credentials."` |
| Empty — OTP not yet generated | `"We'll generate your OTP shortly."` |
| **Error — all mutation failures** | Every error path is a destructive shadcn toast. **No inline error banners, no retry buttons, no error boundaries.** Titles in use: `Error`, `Unable to remove account`, `Unable to check username`, `Handle already exists`, `Unable to generate credentials`, `Choose a platform`, `Add your email`, `Add your username`, `Handle not validated`, `Unable to validate`, `Clipboard unavailable`, `Unable to copy <field>`, `Unable to start verification`, `Verification needed`, `Verification failed` |
| **Error — `checkVerification` query failure** | **UNHANDLED.** `VerificationCard` destructures only `{data, refetch, isLoading}` (`:182-188`); `isError`/`error` are ignored. On failure `isLoading` is false and `data` undefined, so the card **silently renders as "Not verified" with no accounts and no error message.** Same in `useHandleVerified`. |
| Error — clipboard | `{"Clipboard unavailable", "Copying to clipboard is not supported in this environment.", destructive}` or `` {`Unable to copy <label>`, error.message ?? "Please try again."} `` |
| Success — inline | Only two non-toast confirmations exist: the green `"Account creation successful on <Platform>."` and the StepSection turning emerald with a Check icon. |
| **Progress bar** | `SocialVerificationFlowLayout` renders `"Step {currentStep} of {totalSteps}"`. **Both flow pages hardcode `currentStep=2, totalSteps=2`**, so the bar is always 100% on step 2 regardless of how many inner StepSections remain. The inner numbering and the outer bar are **two unrelated counters.** |

**TermsDialog** (`frontend/src/components/TermsDialog.tsx`): default title `"Terms & Conditions"`, description `"Please review and accept these terms before continuing."` **Body is LOREM IPSUM placeholder text (`:83-130`)** — neither call site passes a `content` prop. `requireScroll` defaults true; the checkbox stays disabled until scrolled and shows `"(Please scroll to the bottom)"`. Confirm enabled only when scrolled AND checked AND `!isLoading`. **Acceptance is never recorded** — reset on every open and again on confirm.

---

## 3.F Demographics & the earnings hold

### The money rule, stated once

**Earnings are held PER CAMPAIGN. The hold releases on moderator APPROVAL, not on submission.**

```
ask.satisfied = accounts.every(a => a.approved)          // demographics-reset.ts:491
claimable     = Math.max(0, Math.min(balance, balance - lockedTotal))   // :640
```

A campaign appears in `locked` — and therefore holds money — when the ask exists **AND** `!satisfied` **AND** net earned on that campaign > 0. Net = `SUM(campaign_view_rewards.amount) + SUM(balance_entries.amount)` for `source_type IN (clip_deletion, submission_rejection, noncampaign_uncovered, handle_ban, clip_restore, noncampaign_recovered, reward_restored_reapproval)`, **floored at 0 per campaign** and then dropped from `locked` by `.filter(row => row.amount > 0)` (`:563-567, 630`). A negative would otherwise ADD to what could be withdrawn.

**Non-campaign balance (referrals, manual adjustments, refunds) is never held.** The split is derived by SUBTRACTING locked campaigns from the real balance rather than summing unlocked earnings, precisely so these survive (comment `:590-595`).

### Who is asked

`AUTO_CAMPAIGN_DEMOGRAPHICS_ASK === true` (`demographics-reset.ts:57`). A campaign is asking when **either**:
- there is an OPEN `demographics_reset_requests` row (`closed_at IS NULL`), **or**
- the clipper has any `campaign_view_rewards` row on a campaign with `active = true AND ended = false` (auto-ask, `:377-415`)

…**and** `getParticipatingAccounts` returns ≥1 account, **and** summed views across those accounts ≥ the resolved threshold (or the clipper has `always_request_demographics`).

**Threshold** — `resolveDemographicsThreshold(campaigns.demographics_min_views, campaigns.min_payout)` (`:256-263`): if `demographics_min_views > 0` use it, else `max(0, min_payout)`. The code comment states **every production campaign has `demographics_min_views = 0`**, so in practice the bar IS `min_payout`.

**Which accounts appear:** default — approved, non-deleted submissions on that campaign with `SUM(views) > 0`, not soft-deleted, not `account_deleted_at`, and not in `banned_social_media_users` (platform + handle, **no `LOWER()` so the index stays usable**). Opt-in (`user_clerk.always_request_demographics = true`) — **every** live connected account appears, including 0-view ones, **and the view threshold is bypassed on BOTH the ask side and the submit side.** The comment at `:124-132` says the pairing is deliberate: relaxing only one side would strand money behind an unfileable report.

⚠️ The comment at `:426-435` records that the "below threshold → not asked → not held" pairing is deliberate: **money must never be frozen pending a report the clipper is not allowed to file.**

### Two separate money holds exist

1. **The per-campaign demographics hold** (above) — live.
2. **`geo-clearance` / `campaign_view_rewards.clearance_state='held'` + `balances.pending_balance`** — gated by `WEEKLY_HOLD_ENABLED = false` (`backend/src/lib/geo-clearance.ts:33`), so `runClearanceForUser` currently returns zeros immediately. **No clipper-facing screen reads `pending_balance`.**

A third, older gate exists: `getPayoutEligibility` (`backend/src/lib/payout-eligibility.ts`) — an all-or-nothing weekly whole-wallet check, still exposed as `rewards.getPayoutEligibility` but **not read by any screen**; only `utils.rewards.getPayoutEligibility.invalidate()` at `WeeklyDemographics.tsx:126` references it.

### Screens

| Route | Component | Purpose |
| --- | --- | --- |
| `/demographics-verification` | `DemographicsVerificationList.tsx` | LIST of outstanding per-claim requests. **Also rendered inline on Home.** Sidebar entry points here (hidden when the feature flag is off). |
| `/demographics-verification/weekly` | `WeeklyDemographics.tsx` | **The campaign-scoped ask + money-hold screen.** The ONLY screen that calls `submitForCampaign`. Reached from `Earnings.tsx:375-379` ("Submit demographics"). **NOT in the sidebar; ClaimableWidget links to `/demographics-verification` instead.** |
| `/demographics-verify/:id` | `DemographicsVerification.tsx` (a router, not a page) | Reads `?method=` (`api \| screenshot \| exemption`) and dispatches to `DemographicsVerificationYouTube.tsx`, `…Instagram.tsx`, or `…Screenshot.tsx`. |

### Procedures

| Procedure | Kind | Auth | Input | Returns |
| --- | --- | --- | --- | --- |
| `demographicsVerification.getCampaignAsks` | query | protected | none | `{asks: CampaignAsk[], pendingCount, balance, claimable, locked, lockedTotal}` — the money fields are **spread at top level**. `CampaignAsk = {requestId\|null, campaignId, campaignTitle, cycleStart, note, requestedAt, accounts[], satisfied}`; `ParticipatingAccount = {verifiedUserId, handle, platform, views, status, submitted, approved, exempt}` |
| `demographicsVerification.getClaimable` | query | protected | none | `{balance, claimable, locked: LockedCampaign[], lockedTotal}`; `LockedCampaign = {campaignId, campaignTitle, amount, accountsMissing, accountsAwaitingReview}`. Read by `TopNav.tsx:26` and `ClaimableWidget.tsx:21`. **NOT read by `Earnings.tsx`.** |
| `demographicsVerification.submitForCampaign` | mutation | protected | `campaignDemographicsSubmissionSchema` — a **discriminated union on `mode`** (`'report' \| 'exemption'`) | `{submitted:true, exempt, campaignId, cycleStart, handle, campaignsCovered}` |
| `demographicsVerification.submitVideoLink` | mutation | protected | `{id, videoUrl, parsedData?, attestationConfirmed?}` | `{status:'needs-human-review', videoUrl}`. Writes **`screenshot_file_url`** (NOT `evidence_video_url`), status `needs-human-review`, `approval_method` null, `exemption_reason` null. |
| `demographicsVerification.submitExemption` | mutation | protected | `{id, exemptionReason}` | ⚠️ **RETURNS `{status:'pending'}` but WRITES `'needs-human-review'`** (`:1476` vs `:1453`). |
| `demographicsVerification.listClaims` | query | protected | none | Only `status IN ('active','rejected','pending')` (`:676-681`), **collapsed to one row per verified account**. Representative id prefers the most actionable status via `actionability {active:0, rejected:0, pending:1}`. |
| `demographicsVerification.getClaim` | query | protected + `assertClaimAccess` | `{id}` | `{id, campaignId, campaignTitle, campaignCreatedAt, verifiedHandle, verifiedPlatform, verifiedUsername, screenshotFileUrl, parsedData, status, viewsFromSubmissionsSnapshot, createdAt, updatedAt, exemptionReason, coveredCampaignTitles[], coveredCampaignCount, requiredRecordingPeriodDays}`. ⚠️ **Does NOT return `evidenceVideoUrl`.** |
| `demographicsVerification.submitWeekly` | mutation | protected | `weeklyDemographicsInputSchema {verifiedUserId, evidenceVideoUrl, countries[5]}` | **NO FRONTEND CALLER.** Legacy all-or-nothing path. |
| `demographicsVerification.getWeeklySubmissionStatus` | query | protected | none | **NO FRONTEND CALLER.** |
| `demographicsVerification.requestCampaignReset` | mutation | `demographicsReviewerRoleProcedure` | `{campaignId, note?: trim max 500}` | Opens a round; inserts one notification per participant. |
| `demographicsVerification.cancelCampaignReset` | mutation | reviewer | `{campaignId}` | Closes the request; **releases that campaign's hold immediately.** Filed reports untouched. |
| `demographicsVerification.adminUpdateStatus` | mutation | reviewer | `{id, approvalMethod?, status, parsedData?}` | The decision. |
| `youtubeOAuth.createSession` / `getAudienceReport` | mutation | protected | `{accessToken, refreshToken?, handle, demographicsVerificationId}` | **The only path that auto-approves without a moderator** — writes `parsed_data`, `status 'approved'`, `approval_method 'api'`. |
| `instagramOAuth.createSession` / `getAudienceReport` | mutation | protected | `{accessToken, handle, demographicsVerificationId}` | Same shape. |
| `rewards.getPayoutEligibility` | query | protected | none | Exposed; invalidated by `WeeklyDemographics` after submit; **not otherwise read.** |

### Fields collected

**`/demographics-verification/weekly` — `submitForCampaign`:**

| Field | Type | Required | Where | Constraints |
| --- | --- | --- | --- | --- |
| `campaignId` | string | yes | **NOT an input.** Derived: `activeAsk = asks.find(ask => ask.accounts.some(a => !a.submitted)) ?? asks.find(ask => !ask.satisfied)` (`:92-95`). Rendered read-only in a muted box labelled `"Reporting for"` (`:328-342`). | `z.string().min(1,"Campaign is required")`. Deliberately not a dropdown — comment `WeeklyDemographics.tsx:80-91`. |
| `verifiedUserId` | string | yes | shadcn `<Select>` labelled `"Account"` (`:344-369`). Options = `pending.length > 0 ? pending : accounts`; label `` `{handle} — {platform} ({views.toLocaleString()} views)` ``. Helper: `"Only the accounts that generated views on this campaign are listed."` | `z.string().min(1,"Select which account this is for")`. Server re-checks ownership AND participation. |
| `evidenceVideoUrl` | string (URL) | yes | `<Input>` labelled `"Screen recording link"`, placeholder `"https://youtube.com/watch?v=…"`, helper `"An unlisted YouTube video showing your analytics screen."` (`:371-381`) | `z.string().trim().url("Paste a valid link to your screen recording")`. **REQUIRED ON BOTH MODES including exemption.** **NO YouTube-domain restriction on this path** — any valid URL passes. |
| `mode` | `"report" \| "exemption"` | yes | plain `<input type="checkbox">` labelled `"I can't provide a country breakdown for this account"` (`:384-416`) | Sub-text: `"Your submission is still reviewed and still releases this campaign's earnings once approved — you'll just be paid the base rate, with no geo bonus for this account. The screen recording is still required."` |
| `countries[0..4].country` | enum `COUNTRIES` | yes | 5 fixed rows numbered 1..5, each a Select `"Select a country…"`. Already-chosen countries are filtered out of the other rows' option lists (`:450-454`) | `countrySchema = z.enum(COUNTRIES)` |
| `countries[0..4].percentage` | number | yes | `<Input type="number" step="0.01" class="w-28" placeholder="%">` | `.gt(0,"Percentage must be greater than 0").max(100,"Percentage cannot exceed 100")`; array is `.length(5, "Enter exactly 5 countries")` — **exactly five, not at least**; sum ≤ 100 |
| `exemptionReason` | string | yes when exempt | `<Input id="exemptReason">`, Label `"Reason"`, placeholder `"e.g. This platform doesn't show a country breakdown for my account"` (`:405-415`) | `.trim().min(10, "Explain why this account can't provide a country breakdown").max(500)` |

**`/demographics-verify/:id` — Screenshot flow:**

| Field | Type | Required | Where | Constraints |
| --- | --- | --- | --- | --- |
| `id` | string | yes | route param | `assertClaimAccess` → UNAUTHORIZED / `"Claim not found"` / `"Unauthorized"` |
| `videoUrl` | string (URL) | yes | Step 3, `<Input type="url" inputMode="url" placeholder="https://youtu.be/your-video-id">` | `.url("Please provide a valid URL")` then `.refine(YOUTUBE_URL_PATTERN \|\| GOOGLE_DRIVE_URL_PATTERN, "URL must be an unlisted YouTube video (youtube.com or youtu.be)")`. **Drive is accepted but never advertised.** |
| `parsedData.countries[]` | `{country: string, percentage: number}` | no | Step 4 — one number Input per `TOP_6_COUNTRIES` (India, United States, United Kingdom, Canada, Germany, Australia) plus custom countries from `<CountryPicker>`. `min=0 max=100 step=0.1` | Loose zod, then re-validated against the strict `demographicSchema`. An `"Other"` row is auto-appended client-side as `100 − totalEntered` when > 0 (`:248-253`). |
| `attestationConfirmed` | boolean | see below | shadcn Checkbox in an amber panel | Optional in zod, but the server throws `BAD_REQUEST "You must confirm the country breakdown is accurate before submitting."` whenever `parsedData` is present and this is falsy (`:1391-1400`) |
| `exemptionReason` (per-claim) | string | yes | `<Textarea>`, placeholder `"Example: My YouTube channel is less than 30 days old and demographics haven't been generated yet."` | `.trim().min(1, "Please tell us why you can't record analytics").max(2000, "Exemption reason is too long")` — **note min 1 / max 2000 here vs min 10 / max 500 on `submitForCampaign`** |
| OAuth tokens | string | yes | never typed — arrives via `window.postMessage` from a 500×700 popup, accepted only when `event.origin === backendOrigin` derived from `VITE_TRPC_URL` | held in React state only; cleared whenever `claimId` changes |
| `note` (moderator) | string | no | admin reset dialog | `.trim().max(500).optional()`. When present it **REPLACES** the default notification body and is surfaced verbatim under the campaign name in `WeeklyDemographics` (`:284-288`) |

**The attestation copy (verbatim, do not shorten):**
> `"I confirm these values match exactly what's shown in my screen recording. I understand that if any percentage is wrong or missing, all my clips AND my payout for this campaign will be rejected. This is my responsibility."`

### Validation

| Rule | Where | Exact message |
| --- | --- | --- |
| Exactly 5 countries | server zod + client | `"Enter exactly 5 countries"` / client `"Fill in all 5 countries (n/5 done)"` |
| Percentage > 0, ≤ 100 | server + client | `"Percentage must be greater than 0"` / `"Percentage cannot exceed 100"` / client `"Every percentage must be greater than 0"` |
| No duplicate country | server superRefine + client | `` `${entry.country} is already listed` `` / client `"The same country is listed twice"` |
| Sum ≤ 100 (**under 100 is fine** — the untracked long tail) | server + client | `` `Percentages add up to ${total.toFixed(2)}% — they cannot exceed 100%` `` / client `` `Percentages add up to X% — max is 100%` `` |
| Exemption 10–500 (`submitForCampaign`) | server + client | `"Explain why this account can't provide a country breakdown"` / client `"Explain why this account can't give a country breakdown"` |
| Exemption 1–2000 (`submitExemption`) | server + client toast | `"Please tell us why you can't record analytics"` / `"Exemption reason is too long"`; client `"Please provide a reason"` / `"Tell us why you can't record analytics so the moderator has context."` |
| Campaign must currently be asking | server | `BAD_REQUEST "This campaign isn't asking for demographics right now, so there's nothing to submit."` |
| Account must belong to you AND have views on this campaign | server | `FORBIDDEN "That account didn't generate any views on this campaign, so it isn't part of this request."` |
| Combined views ≥ threshold (unless `always_request_demographics`) | server | `` FORBIDDEN `This campaign needs ${threshold.toLocaleString()} combined views across your accounts before demographics can be submitted — you're at ${totalViews.toLocaleString()}.` `` |
| `submitVideoLink` URL pattern | server refine + client | server `"URL must be an unlisted YouTube video (youtube.com or youtu.be)"`; client toast `"Invalid YouTube link"` / `"Please paste an unlisted YouTube video URL (youtube.com or youtu.be)."`; inline `"That doesn't look like a YouTube URL. Try a youtube.com or youtu.be link."` |
| Attestation required when a breakdown is provided | server + client | server `"You must confirm the country breakdown is accurate before submitting."`; client toast `"Please confirm your attestation"` / `"Tick the box at the bottom to confirm the country breakdown matches what's in your recording."` |
| Step-4 total ≤ 100% | **client only** | toast `"Country percentages exceed 100%"` / `"Adjust the entered values so the total is 100% or less."`; inline `"⚠ Over 100% — adjust before submitting"` |
| Claim ownership | server `assertClaimAccess` | UNAUTHORIZED (no message) / `"Claim not found"` / `"Unauthorized"` |
| Non-canonical country name on the per-claim path | server | `BAD_REQUEST "Invalid country breakdown: " + joined zod messages` |
| **MONEY HOLD — `wise.requestMyWithdrawal`** | server | `` FORBIDDEN `Your balance is on hold pending demographics${names ? \` for ${names}\` : ""}. Submit them from the demographics page to release it.` `` — `names` = up to 3 locked titles, else `"a campaign"` |
| **MONEY HOLD — `rewards.requestWithdrawal`** | server | `` FORBIDDEN `You can claim up to $X right now — $Y is on hold pending demographics for <largest locked campaign> and N other campaign(s). Submit the demographics for those campaigns to release it.` `` |
| **MONEY HOLD — crypto claim**, under `SELECT … FOR UPDATE` | server | `` FORBIDDEN `You can claim up to $X right now — $Y is on hold pending demographics for <names>. Submit them to release it.` `` |
| **MONEY HOLD — the batch payout path** | server, **no user-visible error** | none — `amount = Math.min(balance, claim.claimable)`; if `amount <= 0` **no withdrawal row is created at all** |
| Client pre-submit checklist (the amber "problems" list) | client only | `"No campaign is asking for a report yet"` / `"Choose which account this report is for"` / `"Add the link to your screen recording"` plus the country rules |
| `submitWeekly` (dead path) | server | `"That account is not linked to you."` / `"This account is flagged as deleted or unavailable, so it can't be verified."` / `"This account has no approved clips yet, so there's nothing to verify."` |

### Visibility

| UI | Condition |
| --- | --- |
| Which campaign the form answers | `activeAsk` (above); else `"No campaign is asking right now"` |
| `"N more campaigns to report on after this one"` | `asks.filter(a => !a.satisfied && a.campaignId !== activeCampaignId).length > 0` |
| Account Select options | `pending = accounts.filter(a => !a.approved)`; renders `pending.length > 0 ? pending : accounts`. `selectedAccountId` is blanked whenever the stored id is not in the current campaign's list. |
| Exemption reason Input | local `exempt === true` |
| The 5-country grid greyed + click-blocked | `exempt === true` → `pointer-events-none opacity-40`. ⚠️ **The inputs are NOT unmounted and their values stay in state**; the exemption payload simply does not send them. |
| `"exempt — base rate only"` amber label | `account.exempt` (the row's `exemption_reason` is non-null) |
| Balance card | `locked.length === 0` → `"Nothing is on hold. Your full balance is available to claim."` else one row per locked campaign showing `` `${accountsMissing} account(s) still to report` `` when > 0, else `` `${accountsAwaitingReview} awaiting review` ``, and `` `$${amount} on hold` `` |
| Earnings amber hold panel | `pendingAsks.length > 0` (asks where `!satisfied`) — **independent of whether `claimable` is 0**. Headline `` `$X on hold — demographics needed` `` when `lockedTotal > 0`, else plain `"Demographics needed"` |
| Sidebar "Demographic Verification" | `isFeatureEnabled("DEMOGRAPHICS_VERIFICATION", email)` — currently `{enabled:true}`, so it shows for everyone; the email allowlist is inert |
| A claim appears in `DemographicsVerificationList` | `listClaims` returns only `active`/`rejected`/`pending`. **`created`, `needs-human-review`, `approved` and `cancelled` never appear — so a just-submitted claim VANISHES from the list.** |
| Method-select screen | no `?method=` param. Options depend on `claim.verifiedPlatform.toLowerCase()`: includes `youtube` → API+screenshot+exemption; includes `instagram` → API+screenshot+exemption; **anything else → screenshot+exemption only (no API option)** |
| Step 4 "Enter your country breakdown" | `claim.campaignCreatedAt >= CLIPPER_DEMOGRAPHIC_ENTRY_CUTOFF` = **`2026-06-17T00:00:00Z`**. Older campaigns skip Step 4 entirely and the moderator fills the breakdown during review. |
| Attestation checkbox panel | `hasAnyCountryData` — at least one of TOP_6 ∪ custom has a finite value > 0 |
| `"Set your analytics to the last N days"` banner | `claim.requiredRecordingPeriodDays` non-null — the **MAX** `demographics_recording_period_days` across every campaign this one submission covers |
| Platform guidance box | `PLATFORM_ANALYTICS_PATH[platform]` exists (youtube, instagram, tiktok, x); unknown platforms fall back to a generic sentence |
| `"This one submission … covers all N of its campaigns: …"` | `claim.coveredCampaignCount > 1` |
| Detected-video hint | `parsedVideo` → `"Detected: YouTube Short\|YouTube video • id <id>"`. `videoUrl.length > 0 && !parsedVideo && !isDriveVideo` → destructive hint. **A pasted Drive link shows NEITHER — deliberate.** |
| All inputs + both submit buttons disabled | `isFinalized = ['approved','needs-human-review','cancelled'].includes(localStatus ?? claim.status ?? 'created')`. **`rejected` and `pending` are NOT finalized and stay editable** so a rejected report can be fixed. |
| "Connected" badge / Step 2 dimmed (OAuth pages) | `Boolean(oauthPayload.tokens.access_token)` |
| ClaimableWidget hold block | `!isLoading && (data.lockedTotal ?? 0) > 0`, listing `data.locked.slice(0,3)` — **a 4th+ locked campaign is silently invisible** |

### After submit

| Action | Result |
| --- | --- |
| `submitForCampaign` success | Toast `"Demographics submitted"` or `"Exemption submitted"`; description `` `${result.handle} — sent for review.` `` or, for an exemption, `` `${result.handle} — sent for review. This account will be paid the base rate for this campaign, with no geo bonus.` ``. Form fully cleared. **Three** invalidations: `getCampaignAsks`, `getClaimable`, `rewards.getPayoutEligibility`. **NO navigation** — the user stays and the form re-derives onto the next campaign. Server: rows become `needs-human-review` with `approval_method` nulled. |
| **Fan-out** | The same recording is written to **EVERY other campaign currently asking about that account whose row is not already `approved`** (`:378-408`), each with **ITS own `cycle_start` and ITS own `views_from_submissions_snapshot`**. `campaignsCovered` is returned but **is NOT surfaced anywhere in the UI today.** |
| `submitForCampaign` failure | Toast `"Could not submit"`, description = `error.message` verbatim, destructive. Form state preserved. |
| `submitVideoLink` success | `setLocalStatus('needs-human-review')` immediately (optimistic); toast `"Submitted for review"` / `"A moderator will watch your recording and confirm the data shortly."`; `await utils.…getClaim.invalidate({id})`; then `navigate('/demographics-verification')`. ⚠️ Because `listClaims` excludes `needs-human-review`, **the claim DISAPPEARS from the list the user lands on.** |
| `submitExemption` success | `setLocalStatus('needs-human-review')`; toast `"Exemption requested"` / `"A moderator will review your request shortly."`; invalidate; navigate. |
| Either per-claim failure | Toast `"Submission failed"`, description = `err.message`, destructive. No navigation, no status change. |
| YouTube API fetch success | **`navigate('/demographics-verification')` FIRST**, then toast `"Audience synced"` / `"Pulled demographics directly from YouTube."`, then invalidate. Server sets `approved` + `approval_method 'api'`, writes `parsed_data`, fans out to siblings, recomputes every affected campaign's `demographics_json`. |
| YouTube API returns `success:false` | `setErrorMessage(result.message)` rendered as red text under the Step 2 button. **No navigation, no toast.** |
| Instagram API success | `navigate('/demographics-verification')`, toast `"Audience synced"` / `"Pulled demographics directly from Instagram."` |
| Mod approves | Row → `approved`. Fan-out to same-account, same-cycle siblings **in the AWAITING statuses only** (`created, active, pending, needs-human-review, rejected`), carrying `parsed_data` + `screenshot_file_url` + `exemption_reason`. Every touched campaign gets `recomputeCampaignDemographics` (best-effort). Then `getPayoutEligibility` → `runClearanceForUser` (currently a no-op). Once every account on an ask is approved, `satisfied` flips, the campaign leaves `locked`, and `claimable` rises. |
| Mod rejects | Same fan-out but over `DEMOGRAPHICS_REJECT_STATUSES`, which **ADDS `approved`** — so a rejection **claws the account back out of campaigns where it had already been approved, re-holding that money.** |
| Mod opens a reset round | Any previous open round is closed; a new one is inserted with the CURRENT `cycle_start` **frozen**; every row for that campaign on that cycle resets to `active` with `approval_method`, `screenshot_file_url`, `parsed_data`, `evidence_video_url` and `exemption_reason` all nulled; a notification per participant (best-effort, try/catch). **The hold re-engages immediately.** Notification title `` `Demographics needed — ${campaign.title ?? "campaign"}` ``, default body: `"Submit fresh audience demographics for the accounts you ran in X. Your earnings from this campaign stay on hold until they're approved — everything you earned elsewhere is unaffected."` |
| Mod cancels the round | `closed_at` set; hold releases on the next read; filed reports untouched. ⚠️ **With `AUTO_CAMPAIGN_DEMOGRAPHICS_ASK` true, cancelling does NOT stop the ask** if the campaign is still `active && !ended` and the clipper has rewards on it — the auto-ask takes over with `requestId: null`. |
| Withdrawal attempted while held | No status change; a FORBIDDEN error surfaces as a toast in the claim flow. **The batch path instead silently pays only the unheld portion.** |

### Ineligible / incomplete / already-completed

- **Below the threshold:** the campaign is skipped entirely in `getCampaignAsksForUser` — never in `asks`, never in `locked`, **earnings on it are NOT held.**
- **No campaign asking:** Requests card → `"No campaign is asking for demographics right now."` + `"You'll get a notification when a campaign needs one."`; "Reporting for" → `"No campaign is asking right now"`; Account Select placeholder → `"Nothing to submit"`; the problems list contains `"No campaign is asking for a report yet"` so **Submit is permanently disabled**. Balance card → `"Nothing is on hold. Your full balance is available to claim."`
- **Submitted, not yet reviewed:** `submitted` true, `approved` false. Badge `"Under review"` (secondary, Clock). The ask stays `!satisfied` so **the money STAYS HELD.** The locked row's subtitle switches from `"N account(s) still to report"` to `"N awaiting review"`.
- **Nothing submitted:** status `missing` / `created` / `active` → destructive badge `"Not submitted"`.
- **All accounts approved:** the campaign **still appears** in the Requests card, with a green `"Approved"` badge instead of the counter. It leaves `locked` and is filtered out of Earnings' `pendingAsks`. The form's `activeAsk` skips it.
- **Reopening a finished per-claim page:** `isFinalized` covers `approved | needs-human-review | cancelled`: everything disabled plus `"This verification is <status>. You'll be notified once the moderator finishes their review."` — **wrong copy for `approved` and `cancelled`.**
- **Approved claims are unreachable from the list** (filtered out); the only way back is a saved URL. The list then shows `"You're all caught up"`.
- **Re-submitting for a campaign a mod already approved:** the explicitly-chosen campaign **IS** overwritten back to `needs-human-review` (it is seeded into `targets` before the loop), but the fan-out deliberately **SKIPS** any other campaign whose row is already approved (`if (asked.approved) continue;`) — so filing for campaign A cannot re-hold money a mod already released on campaign B.
- **Banned / platform-deleted account:** excluded from `getParticipatingAccounts` on BOTH branches. Never asked, never holds money. The comment records **169 accounts previously holding money against an impossible report.**
- **`lockedTotal` exceeds the balance** (clipper already cashed out): `claimable` is clamped to 0. The UI then shows `claimable $0.00` alongside a larger `lockedTotal`, which reads oddly but is intentional (comment `:636-639`).
- **Week rolls over while a round is open:** the round's `cycle_start` is frozen at open time, and `submitForCampaign` writes to `openRequest.cycle_start` in preference to the current cycle. An auto-ask always carries `currentCycleStart()`.
- **Ended campaigns:** the auto-ask is scoped to `active && !ended`, so an ended campaign's money is never frozen by the auto path. **A moderator can still open a round on an ended campaign by hand, and that round WILL hold.**
- ⚠️ **A report filed through `WeeklyDemographics`, viewed on the per-claim page:** `submitForCampaign` writes `evidence_video_url`; `getClaim` does not select it and the Screenshot page prefills only from `claim.screenshotFileUrl`. **The recording box therefore appears empty even though a recording exists.** The equivalent bug on the mod side was fixed (`adminGetClaim` gained `recordingUrl = evidence_video_url ?? screenshot_file_url`); the clipper-facing `getClaim` was not.
- **Zero connected earning accounts:** `getPayoutEligibility` short-circuits to `eligible:true` with `accounts: []` — *"the lock must not strand them"*. Independently, `getCampaignAsksForUser` returns `[]` so nothing is held.
- **Google Drive link:** accepted by both client and server on `submitVideoLink`, but **every visible string still says YouTube-only, no "Detected:" badge renders, and no error shows. Deliberately undocumented; mods are told 1:1.**
- **Payout batch mints placeholder rows:** `createReward` inserts `status 'created'` rows per (campaign, account) on the current cycle — or `'approved'` if that account already has an approved report for the SAME cycle on another campaign. `'created'` is not counted as submitted anywhere and does not appear in `listClaims`, so **the clipper never sees these rows until a reset flips them to `active`.**

### Loading / empty / error states

| Surface | Behaviour |
| --- | --- |
| Weekly balance card | CardDescription `"Loading…"`; body a bare spinning `<Loader2 className="h-4 w-4 animate-spin"/>` |
| Weekly Requests card | the same bare spinner |
| Weekly submit button | disabled, spinner before the label |
| `DemographicsVerificationList` | centred spinner + `"Loading verification requests..."`, py-10 |
| `DemographicsVerification` router | LoadingState card, title `"Demographics verification"`, description `"Give us a moment while we load your verification."`, body spinner + `"Fetching your request…"` |
| Per-claim pages | a bare Card with muted text `"Loading verification details..."` and **no spinner** |
| Per-claim buttons | `"Submitting..."`; OAuth `"Opening Google…"` / `"Opening Meta…"` and `"Fetching data…"` |
| `ClaimableWidget` | `<Skeleton className="h-12 w-40 bg-background/20"/>`; the hold block is suppressed while loading |
| TopNav | renders the literal `—` until resolved |
| Empty — list | bold `"You're all caught up"` + `"We'll show any demographics verification requests here as soon as your campaigns require them."` (curly apostrophe in the source) |
| Error — list | red-bordered box: `"We couldn't load your verification requests. Please try again."` |
| Error — router (3 variants) | `"Invalid verification"` / `"We couldn't determine which verification to load."`; `"Unable to load verification"` / `"Something went wrong while loading this request."`; `"Verification not found"` / `"We couldn't find a demographics verification with this id."` **All three append** `"Try refreshing the page. If the issue continues, contact support."` |
| Error — per-claim pages | destructive text `"Failed to load this verification request."` rendered **ABOVE** the form, not instead of it |
| Error — mutations | always a destructive toast, never inline. Titles: `"Could not submit"`, `"Submission failed"`, `"Unable to connect YouTube"` / `"Failed to fetch YouTube data"`, `"Unable to connect Instagram"` / `"Failed to fetch Instagram data"` |
| Validation — the problems list | amber bulleted panel (`border-amber-300 bg-amber-50`; dark `border-amber-900 bg-amber-950/40`) above the buttons whenever `problems.length > 0`; Submit disabled while any problem exists; bullets carry a literal `"• "` prefix |
| Validation — live totals | Weekly: `"Total: X.XX%"` beside "Top 5 audience countries", turning `text-destructive font-semibold` above 100. Screenshot Step 4: `"Total entered: X% + Other Y% = Z%"` with `"⚠ Over 100% — adjust before submitting"` |
| Responsive | `DemographicsVerificationList` renders a `<Table>` at sm+ (`hidden sm:block`) **and a stack of rounded-2xl cards below sm (`space-y-4 sm:hidden`) — two full copies of the row markup.** Weekly is a single `max-w-3xl` column at every width; per-claim pages `max-w-4xl`; method-select `max-w-3xl`. |

### ⚠️ Four independent status→label mappings exist and already disagree

| Source | Mapping |
| --- | --- |
| `WeeklyDemographics.statusBadge()` (`:38-62`) | `approved` → emerald Badge + CheckCircle2 `"Approved"`; `missing\|created\|active` → destructive + XCircle `"Not submitted"`; `rejected` → destructive + XCircle `"Rejected — resubmit"`; **everything else** (pending, needs-human-review, cancelled) → secondary + Clock `"Under review"` |
| `DemographicsVerificationList.statusMeta` (`:29-44`) | `created` `"Awaiting upload"`, `pending` `"Pending confirmation"`, `active` `"Awaiting"`, `approved` `"Approved"`, `cancelled` `"Cancelled"`, `needs-human-review` `"Needs review"`, `rejected` `"Rejected"`, fallback `"Unknown"` |
| Admin queue (`AdminDemographicsVerification.tsx:117-124`) | `created` `"Created"`, `active` `"Awaiting"`, `pending` `"Pending confirmation"`, `approved` `"Approved"`, `needs-human-review` `"Needs review"`, `rejected` `"Rejected"`, `cancelled` `"Cancelled"`, `"Unknown"` |
| Earnings per-account words | `"Approved"` (emerald) / `"Rejected — resubmit"` / `"Under review"` (amber) / `"Not submitted"` (destructive) |

Unifying the **labels** is presentation and is safe. Changing **which statuses count as submitted/approved** is not — `SUBMITTED_STATUSES` (`needs-human-review`, `pending`, `approved`) drives the money.

---

## 3.G Earnings, payouts & payout methods

### Flow

`/earnings` → Claim button → `/earnings/claim` (method picker) → `/earnings/claim/{bank|crypto}/details` → `.../confirmation`. `ClaimFlowLayout` renders `"Step {currentStep} of {totalSteps}"` and a bar at `Math.min(100, Math.max(0, (currentStep/totalSteps)*100))` — **the step numbers and titles are set in `App.tsx`, not in the step components.**

⚠️ **`/earnings/claim` and every step below it re-check nothing.** A clipper who deep-links there bypasses every gate on the Earnings page's Claim button.

### Procedures

| Procedure | Kind | Auth | Input | Notes |
| --- | --- | --- | --- | --- |
| `rewards.getMyEarnings` | query | protected | none | **THE primary money read.** `{currentBalance, totalEarned, entries[], outstandingWithdrawal}`. `entries` = `balance_entries` filtered to `created_at > 2025-11-17T15:51:00Z` (`rewards/index.ts:88`, comment *"Ignore past performance of old campaigns"*), `ORDER BY created_at DESC`, **hard LIMIT 500** (`:92`). `outstandingWithdrawal` = the newest `wise_withdrawals` row with **status EXACTLY `'requested'`** (`:127`). |
| `demographicsVerification.getCampaignAsks` | query | protected | none | Drives the amber hold panel and `weeklyGateBlocked`. |
| `demographicsVerification.listClaims` | query | protected | none | On Earnings used **only** for `.length > 0`; none of its fields are rendered. |
| `wise.requestMyWithdrawal` | mutation | protected | **NO INPUT** | The clipper never chooses an amount; the server pays `Math.min(balances.balance, claimableBreakdown.claimable)` (`wise.ts:1101-1104`). Returns `{success:true}`. |
| `wise.cancelRequestedWithdrawal` | mutation | protected | `{withdrawalId: z.string().min(1)}` | **DELETES** the `wise_withdrawals` row (not a status flip), inserts a `withdrawal_cancellation` balance entry, upserts `balances += amount`. |
| `cryptoPayouts.getMyMethods` | query | protected | none | `{id, npCurrency, address, memo, label}[]` — deliberately omits whitelist fields. |
| `cryptoPayouts.addMethod` | mutation | protected | `{npCurrency: z.string().min(1), address: z.string().trim().min(20,"That address looks too short").max(120), memo?: .trim().max(120), label?: .trim().max(100)}` | Returns void. |
| `cryptoPayouts.deleteMethod` | mutation | protected | `{methodId: z.string()}` | Hard delete scoped to `user_id`. Refuses if a `crypto_withdrawals` row with that `method_id` is still `'requested'`. ⚠️ That in-flight check queries **by `method_id` only, no user scoping**. |
| `cryptoPayouts.getMyOutstandingWithdrawal` | query | protected | none | Newest `'requested'` row, or null. ⚠️ **Does NOT filter on `batch_id`.** `amount` comes back as the raw decimal — the page wraps it in `Number(...)`. |
| `cryptoPayouts.requestMyWithdrawal` | mutation | protected | `{methodId: z.string(), amount: z.number().positive("Enter an amount greater than 0")}` | Rounds **DOWN** to cents (`Math.floor(amount*100)/100`). Under `SELECT … FOR UPDATE` on balances. Freezes copies of `np_currency`/`address`/`memo` onto the withdrawal row. |
| `cryptoPayouts.cancelMyRequestedWithdrawal` | mutation | protected | `{withdrawalId: z.string()}` | Locks `(id, user_id, status='requested')`; **refuses if `batch_id` is set**. Credits, inserts entry, then DELETEs the row. |
| `wiseRecipients.getMine` | query | protected | none | `{id, recipientId, summary}` — `summary` is fetched **LIVE from the Wise API on every call** and is `null` on Wise 404 or any Wise error. |
| `wiseRecipients.create` | mutation | protected | `z.discriminatedUnion('countryCode', […])` | Creates the recipient **at Wise**, then in one transaction DELETEs any existing local row and INSERTs the new one — **"update" is really replace-by-delete.** Atomik stores only `user_id` + `recipient_id`. |
| `wiseRecipients.delete` | mutation | protected | none | Unconditional — **does NOT check for a queued withdrawal**, unlike `cryptoPayouts.deleteMethod`. |
| `wiseRecipients.getPhilippinesBanks` | query | protected | none | Live PH bank list from a Wise quote. **Returns `[]` (never throws) if Wise is unreachable** — which is what triggers the free-text fallback input. |
| `rewards.getMyTotalEarnings` | query | protected | none | Used only by `MyStatsSection.tsx:46`. |
| `rewards.getPayoutEligibility` | query | protected | none | Its doc comment says it *"Drives the Claim button's disabled state"* — **that is NO LONGER TRUE.** `Earnings.tsx` never calls it. |
| `rewards.requestWithdrawal` | mutation | protected | `{amount: z.number().positive("Amount must be greater than zero"), currency: z.enum(["USD"]).default("USD")}` | **NOT CALLED by any frontend file.** A complete second withdrawal implementation with its own error strings and a `"You already have a withdrawal in progress."` guard. |
| `bankAccounts.getAll/getById/create/update/delete` | — | protected | `bankAccountSchema` (every field `.optional()`) | **DEAD ROUTER for the clipper UI** — registered at `routers/index.ts:37`, **zero references in `frontend/src`.** `create` with `{}` is valid and inserts an all-null row. |

### Fields collected

**Bank recipient dialog — duplicated in `pages/BankAccounts.tsx` (two-step: country → details) and `claim-flow/step-1-bank-details.tsx` (single screen):**

| Field | Type | Required | Constraints |
| --- | --- | --- | --- |
| `accountHolderName` | text, trimmed | yes | `z.string().min(1,'Account holder name is required')`; re-checked after trim → `BAD_REQUEST 'Account holder name is required'`. Label "Account holder name", placeholder "Full legal name", HTML `required`. |
| `countryCode` | `"IN"\|"NP"\|"PH"` Select | yes | discriminator. Options "India (INR)", "Nepal (NPR)", "Philippines (PHP)". Default `"IN"`. Unknown → `BAD_REQUEST 'Unsupported country'`. |
| `legalType` | `"PRIVATE"\|"BUSINESS"` (labels "Individual"/"Business") | yes | Select `disabled={!selectedCountryConfig.allowBusiness}` — **only IN allows BUSINESS**; switching to NP/PH force-resets to PRIVATE. Server hard-codes `'PRIVATE'` for NP/PH regardless. |
| `accountNumber` | text; whitespace stripped server-side | yes | IN `.min(6,'Account number must be at least 6 digits')`; NP `.min(9,…at least 9 characters).max(20,…at most 20 characters)`; PH `.min(6,…6 digits).max(18,…18 digits)` |
| `ifscCode` | text, **auto-UPPERCASED on every keystroke** | yes (IN only) | `.min(4,'IFSC code is required')`; also `.trim().toUpperCase()`; plus a redundant guard `'Account number and IFSC code are required for India'`. Placeholder "e.g. HDFC0001234". |
| `bankCode` | NP: Select over `WISE_NEPAL_BANKS`; PH: Select over the live list **or a free-text `<Input placeholder="Bank code (e.g. BDO)" required>`** when the list is empty | yes (NP, PH) | client `'Select a bank before continuing.'` for both; server NP `.refine(v => WISE_NEPAL_BANKS.some(b=>b.code===v), 'Select a valid bank')`, PH `.min(1,'Select a bank')`. Label is "Bank name" in both cases. |
| `addressFirstLine` | text | yes | `.min(1,'Address line is required')`. Label "Street address", placeholder "House / street". |
| `addressCity` | text | yes | `.min(1,'City is required')` |
| `addressPostCode` | text | yes | **`.min(3,'Postal code is required')`** — note min 3, not min 1 |

**Crypto:**

| Field | Type | Required | Constraints |
| --- | --- | --- | --- |
| `npCurrency` | Select over the 8 `CRYPTO_PAYOUT_OPTIONS` tickers: `usdtbsc, usdtsol, usdtmatic, usdtton, usdcbsc, usdcsol, usdcmatic, usdcbase`, rendered `{asset} — {network}` | yes | client `'Pick a currency and network.'`; server `BAD_REQUEST 'That currency/network is not supported. We only pay USDT/USDC on low-fee networks (BNB Smart Chain, Solana, Polygon, TON, Base).'` |
| `address` | `<Input id="crypto-address" placeholder="Paste the deposit address" autoComplete="off" spellCheck={false}>` — **no HTML `required`** (the dialog is not a `<form>`) | yes | client `'That wallet address looks too short.'` at < 20; server min 20 / max 120. Uniqueness on `(user_id, np_currency, address)` → `'You already saved this address for this currency.'` **No network-specific format validation of any kind.** |
| `memo` | optional | no | placeholder "Only if your wallet/exchange requires one (e.g. TON)" |
| `label` | optional | no | placeholder "e.g. My Binance USDT" |
| `methodId` | Select | yes | option label `describeMethod()` = `` `{asset} · {network} — {address.slice(0,8)}…{address.slice(-6)}` ``, falling back to the raw ticker |
| `amount` | `<Input type="number" inputMode="decimal" min="0" step="0.01" max={availableBalance}>`, label "Amount to claim (USD)", placeholder "e.g. 25.00" | yes | client `amountValid` = non-empty && finite && > 0 && `<= availableBalance + 0.0001`. **⚠️ The client compares against `currentBalance`, NOT `claimable`** — a held clipper can type an amount the client accepts and the server rejects. A "Max ({usd})" button sets `String(Math.floor(availableBalance*100)/100)`. Helper: `"Up to your available balance. The rest stays claimable after this one is paid."` |
| **bank claim amount** | — | — | **NOT COLLECTED.** The bank claim always sweeps `min(balance, claimable)`. The confirmation screen is navigated to with `state:{amount: availableBalance}` — **the PRE-hold balance**, which may not equal what was withdrawn. |

### Validation

| Rule | Where | Exact message |
| --- | --- | --- |
| **`MINIMUM_CLAIM_AMOUNT = 2`**, `hasEnoughToClaim = currentBalance > MINIMUM_CLAIM_AMOUNT` — **strictly greater-than**, so exactly $2.00 does NOT qualify | **CLIENT ONLY** — `Earnings.tsx:38, 205, 388`. It exists nowhere else in the repo; **no server check.** Deep-linking `/earnings/claim/...` bypasses it entirely. | `"You need at least $2.00 to claim your balance."` |
| Claim button disabled | client `Earnings.tsx:225-231` | `claimButtonDisabled = isLoadingDemographics \|\| gate.isLoading \|\| weeklyGateBlocked \|\| hasBlockedDemographics \|\| Boolean(outstandingWithdrawal) \|\| !hasEnoughToClaim` |
| `hasBlockedDemographics` | client `:197-203` | `demographicsVerificationEnabled && demographicsClaims && demographicsClaims.length > 0`. ⚠️ **The memo's remaining lines both `return false`, so `currentBalance` in the dep array has no effect.** Because the flag is `enabled:true`, in practice this is simply "`listClaims` returned ≥1 row". |
| `weeklyGateBlocked` | client mirror `:216-223`; **server is the real control** | `pendingAsks.length > 0 && claimable <= 0`. Comment `:221-222`: *"Held money no longer blocks the whole claim — it just caps it. The button is only off when there is nothing claimable at all."* |
| Bank claim preconditions | client | `"Add a bank account before continuing."` / `"You need a positive balance to request a payout."` in a destructive `<Alert>` titled `"Unable to continue"` |
| Withdrawal-cancellation abuse cap: **more than 2** `withdrawal_cancellation` entries in 24 h (`> 2`, i.e. the 4th request in a day fails) | server — **duplicated verbatim** in `wise.ts:44-63` and `cryptoPayouts.ts:168-186` | `BAD_REQUEST "You have reached the maximum number of withdrawals for today."` |
| Debt / non-positive balance | server `wise.ts:67-78` | `BAD_REQUEST "You don't have a positive balance to withdraw. If your balance is negative, new earnings will pay it down first."` |
| Whole balance held | server `wise.ts:83-95` — deliberately distinguished from debt (comment `:80-82`) | `` FORBIDDEN `Your balance is on hold pending demographics for {up to 3 titles}. Submit them from the demographics page to release it.` `` |
| **Bank withdrawal idempotency** | server, inside `SELECT … FOR UPDATE` | **NONE — silent no-op.** If a `'requested'` row exists, `createWithdrawalRequests` just `return`s; `wise.requestMyWithdrawal` **still returns `{success:true}`** and the UI still navigates to the confirmation screen. |
| Missing Wise recipient at withdrawal time | server, a **plain `Error`** → INTERNAL_SERVER_ERROR | `` `Wise recipient not found for user {userId}` `` — **leaks the user id into the message** |
| Bank payout cap | server, placed in the shared helper on purpose so the admin batch is capped too | none — silent no-op when `amount <= 0` |
| Bank cancel | server | `NOT_FOUND "Withdrawal not found."` / `BAD_REQUEST "Only requested withdrawals can be cancelled."` / locked re-check `BAD_REQUEST "This withdrawal can no longer be cancelled — it may already be processing or cancelled."` |
| Crypto: one queued claim | server | `BAD_REQUEST "You already have a queued crypto claim. Wait for it to be paid or cancel it before claiming again."` |
| Crypto: unknown method | server | `BAD_REQUEST "Add a crypto address before claiming."` |
| Crypto: amount ≤ 0 after flooring | server | `BAD_REQUEST "Enter an amount greater than 0."` |
| Crypto: balance ≤ 0 | server | `BAD_REQUEST "You need a positive balance to request a payout."` |
| Crypto: amount > balance | server | `` BAD_REQUEST `You can only claim up to your available balance ($X.XX).` `` |
| Crypto: amount > `spendable` (`max(0, balance - lockedTotal)`) | server | `` FORBIDDEN `You can claim up to $X.XX right now — $Y.YY is on hold pending demographics for {up to 3 titles}. Submit them to release it.` `` |
| Crypto cancel | server | `BAD_REQUEST "No queued crypto claim to cancel."` / `BAD_REQUEST "This claim is being processed for payment. Contact support if you need it cancelled."` |
| Crypto method delete while in flight | server | `BAD_REQUEST "This address has a claim in flight. Wait for it to be paid (or cancel the claim) first."` |
| Wise recipient creation errors | server | Wise's own messages joined by a space, else `"Something went wrong. Please reach out to support on Discord."` |

### Visibility

| UI | Condition |
| --- | --- |
| Claim button | **always rendered**, only ever disabled. `title` tooltip is a 3-way ladder: `weeklyGateBlocked` → `"All of your balance is on hold pending campaign demographics."`; else `hasBlockedDemographics` → `"You have a demographics verification to resolve before claiming."`; else `outstandingWithdrawal` → `"You already have a withdrawal in progress."`; else `undefined`. ⚠️ **There is NO tooltip for the below-minimum or loading cases** — the button looks dead with no explanation. |
| Amber hold panel | `pendingAsks.length > 0`, independent of `claimable`. Grouped **BY CAMPAIGN** (comment `:332-334`). Body singular `` `{campaignTitle ?? 'A campaign'} has asked for a fresh audience report.` `` vs plural `` `{n} campaigns have asked for a fresh audience report.` `` + `"Only these campaigns' earnings are held — the rest of your balance stays claimable."` |
| Per-account chip | 4-way label: `approved` → `"Approved"`; `status === 'rejected'` → `"Rejected — resubmit"`; `submitted` → `"Under review"`; else `"Not submitted"`. ⚠️ **The COLOUR ladder is computed separately** as `approved ? emerald-600 : submitted ? amber-700/amber-300 : destructive`, so a **submitted-and-rejected row gets AMBER colour with the "Rejected — resubmit" label**. Name falls back to `account.verifiedUserId` when `handle` is null. |
| `"You need at least $2.00 to claim your balance."` | `!hasEnoughToClaim && currentBalance > 0` — **hidden at exactly $0 and hidden for a NEGATIVE balance.** |
| `"Complete pending demographics verification requests to claim your balance. [View requests]"` (text-primary) | `hasBlockedDemographics` |
| `"You already have a payout queued."` (muted) | `!hasBlockedDemographics && outstandingWithdrawal` — **suppressed when demographics also block, so the two never appear together** |
| "Withdrawal queued" card (`sm:col-span-2`, border-primary, bg-primary/5) | `outstandingWithdrawal` truthy — i.e. status **exactly** `'requested'`. ⚠️ A withdrawal that advances to `'pending'` makes this card **DISAPPEAR**, even though the card's own status line has a `=== 'pending' ? 'Processing' : 'Requested'` branch that is therefore **unreachable**. |
| `"Wise status: {externalStatus}"` | non-null (raw Wise string, unmapped) |
| History card | 3-way: `isLoading` → spinner; `entries.length === 0` → `"No balance activity yet. Complete submissions to start earning."`; else table + pagination |
| History desktop vs mobile | `hidden lg:block` `<Table>` + `lg:hidden` card list — **both always mounted**, toggled by CSS at `lg`. Columns: Amount (w-40) / Type (w-36) / Note / Date (w-48). |
| History row subtitle | `details.subtitle` truthy (desktop `&&`, mobile ternary → null). Title falls back to `entry.memo \|\| '—'` when `balanceEntryMetadataSchema.safeParse` fails. Type column always renders `entry.type.replace(/_/g,' ')` capitalised. |
| Pagination | always when `entries.length > 0`. pageSize **20**; `useEffect` resets `page` to 0 whenever `entries.length` changes. `"Showing {start}-{end} of {entries.length} entries"`, `"Page {n} of {total}"` (both show 0 when empty). |
| Payout-method tiles (step 0) | **UNCONDITIONAL** — `visibleOptions = [...payoutOptions, cryptoPayoutOption]`. Bank copy `"Send funds to your linked Wise recipient in INR."`; crypto copy `"Get paid in USDT/USDC on low-fee networks (BSC, Solana, Polygon, TON, Base)."` "Recommended" badge is `hidden md:block`. ⚠️ **The comment at `App.tsx:514-515` claiming crypto is "Only linked for rewards-modifier users; the backend enforces the role" is STALE/FALSE.** |
| Bank step recipient block | `isLoading` → `"Checking your payout details…"`; `wiseRecipient` → summary (every field with its own `?? '—'` / `?? 'Unknown'` fallback because `summary` can be null); else dashed `"No bank account on file. Add one to receive your next payout."` |
| Bank step button label / Remove | `wiseRecipient ? 'Update bank account' : 'Add bank account'`; destructive "Remove" only when a recipient exists |
| Bank step hint | `(!wiseRecipient \|\| !hasBalance)` → `wiseRecipient ? 'Your balance must be greater than $0.' : 'Add a bank account to continue.'` |
| Bank step "Available balance" panel | **COMMENTED OUT** (`step-1-bank-details.tsx:322-341`). The balance is fetched but never displayed; `isBalanceLoading` is now unused. |
| IFSC vs plain account-number | `country_code === 'IN'` → 2-col grid; else single full-width |
| PH bank Select vs free-text | `philippineBanksQuery.isLoading` → `"Loading banks…"`; `philippineBanks.length > 0` → Select; else free-text. Query is `{enabled: country==='PH', staleTime: 60*60*1000}`. |
| Crypto step: queued panel vs the form | **MUTUALLY EXCLUSIVE** — `outstanding ? queued : form`. The Claim button is `{!outstanding && …}`, so when a claim is queued the footer shows **only "Back"**. |
| Crypto "Pay to" | 3-way: loading → `"Loading your crypto addresses…"`; `methods.length === 0` → `"No crypto address saved yet. Add one under [Bank Accounts → Crypto Payments] first."` with a Link to `/bank-accounts`; else the Select |
| Crypto Claim button | `disabled={isPending \|\| !amountValid \|\| !methodId \|\| methods.length === 0}`; label `` `Claim {amountValid ? usd(rounded) : ''}` `` — **so it reads "Claim " with a trailing space until a valid amount is typed** |
| Crypto available-balance row | shown (unlike the bank step): loading → `"Checking your available balance…"`; else a bordered `"Available balance"` row |
| BankAccounts two-step dialog | `dialogStep: "country" \| "details"`. `handleOpenDialog` sets it to `wiseRecipient?.summary ? 'details' : 'country'`. The details screen shows a chip `"Bank country: {label} ({currency})"` with a ghost "Change". **The claim-flow copy has NO step split.** |
| BankAccounts bank card | 4-way: loading → `"Checking your payout details…"`; recipient + summary → full summary; recipient with null summary → `"We couldn't fetch the latest details from Wise."` + raw Recipient ID; else `"No bank account found."` / `"Click "Add account" to enter your bank details."` |
| `CryptoPaymentsPanel` list | 3-way: `"Loading your crypto addresses…"` / `"No crypto address saved."` + `"Click "Add address" to add a wallet for payouts."` / one bordered row per method: `{asset} · {network}` + optional `" — {label}"`, the full address in truncated font-mono + optional `"  (memo: X)"`, and a ghost Trash2 |
| `ClaimableWidget` | returns **`null`** when `!user \|\| error`. `"{balance} total balance"` sub-line only when `data.balance !== data.claimable`. Lock panel when `lockedTotal > 0`, listing `locked.slice(0,3)`. |
| TopNav wallet | `user` truthy; value `formatCurrency(claimable.balance)` — **`balance`, NOT `claimable`** |

### State stored

- MySQL: `balances` (`balance` decimal 12,4, **can go negative**; `totalEarned`, never decremented by withdrawals; `pending_balance`, **read by nothing in this area**), `balance_entries` (type enum `reward|manual_adjustment|withdrawal|withdrawal_cancellation|withdrawal_refund`), `campaign_view_rewards` (**never read by the clipper Earnings screen** — it reaches the UI only via the `campaign_view_reward` metadata on the matching `balance_entries` row), `wise_withdrawals` (status enum `requested|pending|failed|completed|cancelled|returned`; **clipper-visible only while `'requested'`**), `wise_recipient` (`user_id` + `recipient_id` only — all PII lives at Wise), `crypto_payout_methods`, `crypto_withdrawals` (with **frozen** currency/address/memo copies), `crypto_payout_batches`, `bank_accounts` (**effectively legacy**).
- react-query, defaults, with exactly one timing override in this area: `wiseRecipients.getPhilippinesBanks` `{enabled: country==='PH', staleTime: 60*60*1000}` — declared identically in both bank forms.
- Local: `page` (Earnings, history only); `isDialogOpen/formError/requestError/isDeleteDialogOpen/formData` (both bank forms, plus `dialogStep` on BankAccounts); `methodId/amountInput/requestError` (crypto step); `isDialogOpen/deleteTargetId/npCurrency/address/memo/label/formError` (CryptoPaymentsPanel).
- `formData` hydration on dialog open maps `routingCodeLabel === 'IFSC code'` → `ifsc_code` and `'Bank code'` → `bank_code`; **any other label string silently yields an empty field.** `handleCloseDialog` resets after a 200 ms timeout so the dialog can animate out.
- react-router `location.state {amount, currency}` → confirmation screen. Survives only the in-memory history entry; **the page reads but never renders it.**
- **NOTHING in this area is persisted to localStorage or sessionStorage.**

### After submit

| Action | Result |
| --- | --- |
| Bank Continue | guards → `await requestWithdrawal.mutateAsync()` (no args) → `await Promise.all([utils.rewards.getMyEarnings.invalidate(), refetch()])` → `navigate('/earnings/claim/bank/confirmation', {state:{amount: availableBalance, currency:'USD'}})`. **NO toast.** On failure: `setRequestError(error.message ?? 'Failed to start withdrawal request.')` in the `"Unable to continue"` Alert; the user stays. |
| Crypto Claim | guards → `amount = Math.round(parsed*100)/100` → mutate → invalidate `getMyEarnings` + `getMyOutstandingWithdrawal` → `setAmountInput('')` → navigate. **NO toast.** On failure: plain `<p className="text-sm text-destructive">`. |
| Confirmation screen (both) | CheckCircle2 + `"Your claim is queued"` + `"We will payout your current balance in the next payment cycle. Please visit the Discord for more questions and details."` One button `"Back to earnings"` → `/earnings`. **No invalidation, no fetch, and the `location.state` amount is NOT displayed.** |
| Bank cancel | `window.confirm('Cancel this payout request and return the funds to your balance?')` — **a NATIVE browser confirm, the only one in the area**; declining returns silently. On confirm: mutate → `await utils.rewards.getMyEarnings.invalidate()` → toast `{title:'Withdrawal cancelled', description:'Your balance has been restored.'}`. On error: toast `{title:'Cancellation failed', …, destructive}`. History gains **both** the original withdrawal and the cancellation line. |
| Crypto cancel | **NO confirmation prompt of any kind.** mutate → invalidate both → toast `{title:'Claim cancelled', description:'Balance restored.'}`. Stays on the step. **Does NOT invalidate `getMyMethods`.** |
| Wise recipient save (claim flow) | `trackEvent('claim_flow_wise_recipient_submit_attempt')` → mutate → toast `{title: wiseRecipient ? 'Recipient updated' : 'Recipient created', description:'We'll use this account for your next payout.'}` → `trackEvent('claim_flow_wise_recipient_submit_result', {status:'success'})` → `await refetch()` → close. On error: `<Alert>` titled `"Unable to save bank account"` **inside** the dialog; dialog stays open, values preserved. |
| Wise recipient save (BankAccounts) | **Different analytics and copy:** `trackEvent('wise_recipient_submit_attempt')`, toast `{title:'Recipient created'}` with **no description and no create/update branch**, success event name `'recipient_submit_result'` (⚠️ **missing the `wise_` prefix**, inconsistent with the error event `'wise_recipient_submit_result'`), then `refetch()` **not awaited**. Error alert title `"Failed to create account"`; fallback `"Failed to create Wise recipient"`. |
| Wise recipient remove | claim flow: toast `{'Recipient removed', 'Add a new bank account before your next claim.'}`, error `"Error removing account"`. BankAccounts: `"You can add another account at any time."`, error title just `"Error"`, `refetch()` not awaited. |
| Crypto address added | toast `{'Crypto address saved', 'You can now claim your balance to this address.'}` → close → reset → `await utils.cryptoPayouts.getMyMethods.invalidate()`. On error: `<p className="text-sm text-destructive">` inside the dialog. |
| Crypto address removed | toast `{'Crypto address removed'}` → invalidate. `finally { setDeleteTargetId(null) }`. ⚠️ **The AlertDialogAction is NOT disabled during the mutation and shows no pending spinner.** |
| Server: bank claim | `balances -= min(balance, claimable)`; `balance_entries {amount:-amount, type:'withdrawal', source_type:'wise_withdrawal', memo:'Wise withdrawal'}`; `wise_withdrawals {status:'requested', external_id: randomUUID()}`; then `balance_entries.source_id` back-filled. |
| Server: crypto claim | `balances -= amount`; `balance_entries {amount:-amount, type:'withdrawal', source_type:'crypto_withdrawal', source_id, memo:'Crypto payout claim (usdtbsc)'}`; `crypto_withdrawals {status:'requested', batch_id:null, external_id: randomUUID()}`. |
| **NOT done** | **No path invalidates `demographicsVerification.getCampaignAsks` or `getClaimable`** — so the TopNav wallet balance and the Home `ClaimableWidget` keep showing the pre-claim figure. No notification is written on a clipper-initiated claim (payout notifications come only from the admin batch). No email. No redirect away from `/earnings` after a cancel. |

### Ineligible / incomplete / already-completed

- **Whole balance held:** Claim disabled with the tooltip; amber panel with `"Submit demographics"` → `/demographics-verification/weekly`. Deep-linked, the server throws.
- **Partially held:** **Claim stays ENABLED** — the hold caps, it does not block. A bank claim then silently withdraws only `min(balance, claimable)` while the confirmation was navigated to with the FULL balance — and renders neither, so the discrepancy is invisible.
- **In debt (negative balance):** **NO dedicated UI anywhere.** The Current-balance card renders `-$12.50`. The $2-minimum hint is suppressed (its condition is `currentBalance > 0`), so the clipper sees a **disabled Claim button with NO tooltip and NO explanation.** TopNav shows the negative number; `ClaimableWidget` shows `$0.00` (clamped) with a `-$12.50 total balance` sub-line. Only forcing the mutation reveals the real message.
- **Outstanding bank withdrawal:** Claim disabled, "Withdrawal queued" card with `"Payout will be processed in the next payment cycle. See Discord for more details."` and a "Cancel request" button.
- **Bank withdrawal advances to `'pending'`:** the card **VANISHES and the Claim button RE-ENABLES** — even though money is in flight at Wise. A second claim attempt is stopped only server-side, and **by a silent no-op rather than an error**.
- **Bank claim double-submit:** the UI invalidates, navigates and shows `"Your claim is queued"` — for a claim it did not create.
- **Crypto double-claim:** handled properly — the form is never rendered while one is queued, and the server throws. Queued panel: `` `{usd(amount)} to {addr.slice(0,8)}…{addr.slice(-6)} — it will go out with the next payout batch. Claim the rest of your balance once this one clears.` `` + "Cancel queued claim".
- **Crypto claim already in an admin batch (`batch_id` set):** it is **still returned** by `getMyOutstandingWithdrawal` (status-only filter), so the clipper still sees an **enabled** "Cancel queued claim" — pressing it fails with `"This claim is being processed for payment. Contact support if you need it cancelled."` **No pre-emptive disabled state or badge.**
- **No bank recipient:** dashed empty state, hint, disabled Continue; server-side a bare `Error` with the user id in it.
- **No crypto address:** must **leave the claim flow entirely** to add one — there is no in-flow add dialog (unlike the bank step, which has one).
- **Recipient exists:** "Update bank account" + a destructive "Remove". Opening the dialog PRE-FILLS from the Wise summary but **only partially faithfully** (see the label-matching note above). **"Update" is really a REPLACE.**
- **Demographics all satisfied but `hasBlockedDemographics` still true:** the two gates come from **different queries and can genuinely disagree** — a clipper with a stale `'active'` row is blocked with `"Complete pending demographics verification requests…"` while the amber panel shows nothing to complete.
- **Balance in (0, 2]:** Claim disabled with **no tooltip**, plus the muted `$2.00` hint. At exactly $2.00 the hint still shows. **This threshold is purely cosmetic — the server would happily process a $0.50 claim.**
- **Wise API down / recipient 404:** `getMine` returns `summary: null` rather than throwing. BankAccounts renders `"We couldn't fetch the latest details from Wise."` + the raw Recipient ID. **The claim-flow bank step has NO such branch** — it renders the summary with every field collapsed to "Unknown"/"—", which reads like a corrupted account rather than a transient outage. `getPhilippinesBanks` returns `[]`, silently degrading the PH Select into a free-text input.
- **> 500 entries, or entries before 2025-11-17T15:51:00Z:** **silently truncated.** The footer says `"of {entries.length} entries"` — i.e. "of 500" — with **no indication that history is cut off or back-dated.** No server-side pagination; all 500 rows ship on every load.
- **Metadata missing/unrecognised:** row falls through to `{title: entry.memo || '—', subtitle: null}`.
- **A `withdrawal` entry with metadata type `'wise'`:** title `"Wise withdrawal"`, subtitle **hard-coded to `""` then `|| null`** — always no subtitle; the `batchName`/`batchGroupId` in the metadata are parsed and discarded. Same for `withdrawal_refund` type `'wise'` → `"Wise withdrawal refund"`.
- **Banned / maintenance:** every query fails at the middleware. **`Earnings.tsx` destructures only `{data, isLoading}` and never `error`**, so the page renders its zero-state ($0.00 / $0.00 / "No balance activity yet…") with a disabled Claim button and **no error message at all.**
- **4th withdrawal in 24 h after ≥3 cancellations:** `"You have reached the maximum number of withdrawals for today."` **Nothing in the UI warns about or counts down this limit beforehand.**
- **Held clipper types an over-`claimable` crypto amount:** the client compares against `currentBalance` and `claimable` is not even fetched on that screen, so **the hold is only ever discovered after submission on the crypto path.**

### Loading / empty / error states

| Kind | Behaviour |
| --- | --- |
| Earnings balance cards | each swaps its number for `<Loader2 className="h-5 w-5 animate-spin text-muted-foreground"/>` |
| Earnings history | `<div className="flex items-center justify-center py-10"><Loader2 className="h-6 w-6 animate-spin"/></div>`. No skeleton rows. |
| Claim gates loading | folded straight into `claimButtonDisabled` — **no tooltip and no spinner on the button; it simply looks dead** |
| Bank/BankAccounts recipient | `<Loader2 className="h-4 w-4 animate-spin"/> Checking your payout details…` (identical copy in both) |
| Crypto balance | `Checking your available balance…` |
| Crypto methods | `Loading your crypto addresses…` (identical in the claim step and the panel) |
| PH banks | `Loading banks…` |
| Pending buttons | Bank Continue: `<Loader2/>Requesting…`. Recipient submit: `"Saving…"` else `"Update recipient"`/`"Create recipient"`. Recipient remove: `"Removing…"` (claim flow also disables Cancel; **BankAccounts does not**). Earnings cancel: `"Cancelling..."` — **three ASCII dots, whereas every other pending label uses `…`**. Crypto: leading spinner, label unchanged. CryptoPaymentsPanel delete: **no pending state at all**. |
| Empty — earnings history | `<p className="py-6 text-sm text-muted-foreground">No balance activity yet. Complete submissions to start earning.</p>` |
| Empty — no recipient | claim flow: dashed `"No bank account on file. Add one to receive your next payout."`; BankAccounts: `"No bank account found."` / `"Click "Add account" to enter your bank details."` — **different copy** |
| Errors | Bank claim → `<Alert variant="destructive"><AlertTitle>Unable to continue</AlertTitle>`. Bank form → Alert inside the Dialog, title `"Unable to save bank account"` (claim flow) vs `"Failed to create account"` (BankAccounts). Crypto → plain `<p className="text-sm text-destructive">`, no Alert component, above the footer. Crypto address form → same plain `<p>`. Toasts (destructive): `"Cancellation failed"`, `"Error removing account"` / `"Error"`, `"Could not remove address"`. |
| **Unhandled** | `Earnings.tsx` never destructures `error` from **any** of its three queries — a failing `getMyEarnings`/`listClaims`/`getCampaignAsks` renders a plausible-looking $0.00 zero-state instead of an error. `ClaimableWidget` is the only component here that handles `error` — by returning `null` (the tile silently disappears). |
| Confirmation dialogs | shadcn AlertDialog for: `"Remove bank account?"` / `"We'll stop routing payouts to this Wise recipient. You can add a new account any time."` (claim flow); `"Remove recipient?"` / `"You can create a new recipient whenever you need to update your bank details."` (BankAccounts); `"Remove this crypto address?"` / `"Past payouts keep their records; you just won't be able to claim to this address anymore."` with `"Keep it"` / `"Remove"`. **Native `window.confirm` for the bank-withdrawal cancel only.** |
| Responsive | Earnings container `mx-auto max-w-5xl px-6 py-4 space-y-8`; summary cards `grid gap-4 sm:grid-cols-2`; queued card `sm:col-span-2`. ClaimFlowLayout `max-w-4xl`; BankAccounts `max-w-3xl`. |
| Dark mode | **Only the amber hold panel carries explicit dark variants** (`dark:border-amber-900 dark:bg-amber-950/40`, `dark:text-amber-200`, `dark:text-amber-300`); the emerald "Approved" chip (`text-emerald-600`) has none. Everything else uses semantic tokens. |

⚠️ **Three different "balance" numbers under three labels:** TopNav `"Wallet balance"` = `balance`; ClaimableWidget `"Claimable earnings"` = `claimable` with `balance` as a sub-line; Earnings `"Current balance"` = `currentBalance` (= balance) while the Claim button is gated on `claimable`. `formatCurrency` also defaults to 0 fraction digits at ≥ $1000 — Earnings always passes `min:2/max:2` explicitly, **TopNav and ClaimableWidget do not**, so a $1,234.56 balance renders as `$1,235` in the nav.

---

## 3.H Profile, stats, leaderboard, referrals & notifications

### 3.H.1 Home — the clipper's whole app

`frontend/src/pages/Home.tsx`. `wrapWithLayout = (content) => <AppLayout>{content}</AppLayout>` (`:144-146`) applied to all three return branches (`:149, :159, :169`).

**Header stack order** (`:186-211`): h1 greeting → ban alert → `AnnouncementBanner` → `NotificationsSpotlight`.

**Bento grid** (`:229-247`): `lg:col-span-8` = `<ActiveCampaignsSection>`; `lg:col-span-4` = `<ClaimableWidget/>` + `<QuickActionsSection/>`.

Then `HomeLeaderboards`, `MyStatsSection`, then **six inlined page components** (`:250-276`), in this exact order and under these exact section titles:

| Order | `<DashboardSection title=…>` | Component | Route it also serves |
| --- | --- | --- | --- |
| 1 | `"Earnings"` | `Earnings` | `/earnings` |
| 2 | `"My clips"` | `Submissions` | `/submissions` |
| 3 | `"Social verification"` | `SocialVerification` | `/verification` |
| 4 | `"Demographics"` | `DemographicsVerificationList` | `/demographics-verification` |
| 5 | `"Receive payments"` | `BankAccounts` | `/bank-accounts` |
| 6 | `"Referrals"` | `ReferralCodePage` | `/referrals` |

The comment at `:251-256` states the contract: *"Each is the real page component: AppLayout no-ops when nested, so they render bare while their own /earnings, /submissions … routes keep working for deep links."* `Home.tsx:15-17` records why the `:id` demographics router cannot be inlined — without a route param it renders only `"Invalid verification"`.

`DashboardSection` (`components/dashboard/DashboardSection.tsx:12-27`) is a `rounded-3xl` bordered `<section>` with an `<h2 className="display-heading">`. Its docblock (`:3-11`) says it is **"Deliberately NOT collapsible"** and that *"every section's queries fire on load; that is the trade being made on purpose."*

Footer carries a deploy canary string **`v3.54`** (`Home.tsx:285`) that the team bumps per PR to confirm a live deploy.

⚠️ Home's `!user` branches (`:177-186` heading fallback, `:215-226` Sign Up / Sign In buttons) are **unreachable at `/`**, because `App.tsx:89` routes signed-out `/` to `<Landing/>`.

**DEAD CODE:** `LeaderboardSection` (`Home.tsx:522-636`) is defined and never rendered; the `activeCampaigns` memo (`:64-67`) exists only to feed it and is likewise unused. `HomeLeaderboards` is what ships.

### 3.H.2 Profile

There is **no profile page**. `user.getProfile` returns exactly `{discordId, firstName, lastName, email, phoneNumber, phoneCountryCode, imageUrl, createdAt}` (`backend/src/routers/user.ts:87-96`), and the **only writer of profile data in the whole app** is `user.updatePhoneNumber` (see 3.B).

`useAuth()` (`hooks/useAuth.tsx:11-26`) transforms the Clerk user into `{id, email, publicMetadata, user_metadata:{display_name: fullName || firstName || email-local-part || ""}, created_at, updated_at}`. `signUp`/`signIn`/`resetPassword`/`updatePassword` are **no-op compatibility stubs** that only fire a toast and return `{error:null}` (`:28-81`).

### 3.H.3 Stats

`MyStatsSection.tsx` — a 3-tile grid: **Posts**, **Total Views** (`submissions.getMyStats`, `enabled: isSignedIn`) and **Total Earned** (`rewards.getMyTotalEarnings`, `enabled: isSignedIn`).

⚠️ `submissions.getMyStats` (`backend/src/routers/submissions/index.ts:398-439`) is **not what it looks like**:
- `posts` = `COUNT(submissions.id) WHERE user_id = ctx.user.id` — **ALL statuses**, including rejected/pending/deleted.
- `totalViews` = `COALESCE(SUM(campaign_view_rewards.view_delta),0) − COALESCE(SUM(submissions.baseline_frozen_views),0)`, clamped with `Math.max(0, …)` — i.e. **REWARDED views, not raw views.**

`submissions.getPlatformBreakdown` (`:1232-1325`, **publicProcedure, no auth**) powers the "Platform Breakdown" card on the client dashboard. It applies `minViewDisplayFilter(campaignId)`; if `visibility === "private" && !private_show_rates` **every CPM is forced to 0**, so `valueDelivered` is 0 too. Returns `{platform, clips, views, valueDelivered, cpm}[]` sorted by `valueDelivered` DESC, dropping falsy platforms.
- ⚠️ **When `category` is omitted the query filters `isNull(submissions.category)`** — it is **not** an "all categories" query.
- ⚠️ The component **filters out `platform === "x"` entirely** (`PlatformBreakdown.tsx:83`) and **does not render `cpm` or `valueDelivered`** even though the API returns them.

`submissions.getMySubmissions` (`:358-396`) — all of the caller's submissions LEFT JOINed to campaigns, `ORDER BY created_at DESC`, **no limit, no status filter, deleted rows NOT excluded.** `Submissions.tsx` groups them client-side into `CampaignSummary` cards with `useMemo` (`:420-527`) — totalEarned, totalViews, pending/approved/rejected counts, platforms Set, ratePerThousand, viewsToGo, daysLeft are all **derived client-side, not server-computed**.

Notable `Submissions.tsx` behaviours:
- `"Submit clip"` button shown when `campaign.active` = `campaign_active && !campaign_ended` (`:502`).
- ⚠️ **HARD-CODED legacy campaign ids** at `:718-720`: `campaign.id === "f9e026cf-11c1-478f-b972-12e61ffc6f94" || campaign.id === "7cf3e7de-73b8-4591-9de6-864ff6bfdedb"` → renders `"Rewards performance stats unavailable"` instead of the Rewarded views / Total rewarded tiles.
- `"(N minimum needed)"` suffix when `campaignMinViewsMap.get(id)` is truthy AND there is no `rewardSummary`.
- `"Views frozen"` badge when `submission.baselineFrozenViews != null`, tooltip `` `<n> views frozen — this clip's reward was reclaimed and no longer earns` ``.
- Delete (trash) button rendered **only** when `submission.status === "pending"`; otherwise an em-dash.
- ⚠️ `getRateForSubmission` (`:131-154`) falls back to the **first non-zero rate among insta/tiktok/youtube/x, in that order** — so the displayed "rate" can be for a different platform than the clip's.
- ⚠️ Rows with a falsy `campaign_id` are **skipped entirely** (`:426`) — such clips never appear.
- ⚠️ **DEAD UI:** `openLeaderboard()` (`:615-627`) is never called anywhere, so `isLeaderboardOpen` is always false and the "Campaign leaderboard" dialog (`:1317-1350`) is unreachable. `trackEvent("campaign_leaderboard_card_clicked")` never fires.
- Desktop table (`hidden … lg:block`) vs mobile cards (`grid … lg:hidden`) — CSS only; the mobile card omits the Campaign/Note columns.

`submissions.deleteSubmission` (`:1195-1229`) throws `"Submission not found"`, `"You are not authorized to delete this submission"`, `"Only pending submissions can be deleted"`; returns `{id}`. On success: `trackEvent('campaign_submission_delete_success')`, toast `{"Submission removed", "We deleted your pending clip."}`, closes the AlertDialog, `await utils.submissions.getMySubmissions.invalidate()`, **plus an optimistic local patch** that removes the row and decrements `pendingCount`/`totalSubmissions` with `Math.max(0, …)`. On failure: `trackEvent('campaign_submission_delete_failure')`, destructive toast `"Unable to delete submission"` with `error.message` verbatim, and **`submissionToDelete` is NOT cleared, so the dialog stays open.**

### 3.H.4 Leaderboards — TWO different systems

| | `components/HomeLeaderboards.tsx` | `components/dashboard/Leaderboard.tsx` |
| --- | --- | --- |
| Where | Home | `/campaign/:campaignId` (client dashboard), `/campaign/:id/category/:category` |
| Title | Top earners + Top clips | `"Top Performing Clips"` |
| Data | `leaderboard.getTopEarners`, `leaderboard.getCampaignTopClips` | `submissions.getAll` or `submissions.getAllTimeLeaderboard` via `useSubmissionsData` |
| Gated by `site_settings.leaderboard_enabled` | **YES** | **NO** |
| Exposes clip source URLs | **NO** — self-hosted video only, no clipper identity | **YES** — the table links out to `clipUrl` |
| Private-campaign gate | `viewerCanSeeBoard`, returns **empty arrays, never throws** | none of that shape |

**`leaderboard.isLeaderboardEnabled`** (`backend/src/routers/leaderboard.ts:520-522`, publicProcedure) reads `site_settings.leaderboard_enabled` through a 15-second in-process cache. **If no `site_settings` row exists the default is TRUE**; **if the DB read THROWS it fails OPEN with `leaderboardEnabled: true`** (`lib/youtubeHosting.ts:72, 88-93`).

`HomeLeaderboards` returns **`null`** when `(enabledLoading || !leaderboardOn)` — i.e. **it is hidden WHILE LOADING as well as when the flag is off** (`:250-252`) — and also when `!campaignsLoading && campaigns.length === 0` (`:254-256`). No empty state at all in either case.

`leaderboard.listCampaigns` (`optionalAuthProcedure`) returns campaigns that are `active && !ended && card_deleted_at IS NULL` and `(visibility != 'private' OR id IN the viewer's approved applications)`. The picker query is `enabled: leaderboardOn && authLoaded` — **deliberately waits for Clerk** so the first fetch is not tokenless and cached public-only (comment `:218-222`). An effect calls `utils.leaderboard.invalidate()` on any auth change because **the query key does not include identity** (`:236-238`).

`leaderboard.getCampaignTopClips` returns `{campaignTitle, clips: [{rank, platform, views, videoUrl (hosted_video_url), thumbnailUrl (hosted_thumbnail_url), isHosted}]}` — **deliberately no source URL and no clipper identity.** Ineligible → `{campaignTitle: null, clips: []}`.

`leaderboard.getTopEarners` — live `SUM(campaign_view_rewards.amount) GROUP BY user_id` joined to `user_clerk.discord_username`. **Eligibility is checked BEFORE the cache read**, and ineligible/empty results are **not cached**. Filters: `totalEarned > 0`; non-empty username; not denylisted (`EARNERS_DENYLIST_EXACT = ["channelprnv"]`, `SUBSTRINGS = ["hannaan","hannan","hanaan"]`, `IDS = []`, `:52-61`). Fetches 30, slices to 10. Cached per campaign for **10 minutes**, max 500 entries.
- ⚠️ An earner with no `discord_username` is **dropped entirely** (no "Anonymous" placeholder), which can shrink the board below 10.
- Video player hardening: `controlsList="nodownload noplaybackrate noremoteplayback"`, `disablePictureInPicture`, `onContextMenu preventDefault`, `playsInline`, `preload="none"`, `poster=thumbnailUrl`; **`src` is set directly on `<video>` (no `<source type>`) on purpose.**
- Not-yet-rehosted clip → spinner + `"Preparing clip…"` **indefinitely, with no retry affordance.**

`submissions.getAll` / `getAllTimeLeaderboard` (both public) exclude deleted clips, banned users and banned handles, apply `minViewDisplayFilter` + `leaderboardExclusionFilters`, `ORDER BY views DESC`.
- ⚠️ **`creator` is fabricated**: `"Creator " + last-4-of-user_id` (or a random suffix).
- ⚠️ **`velocityChange` / `isPositiveVelocity` are `Math.random()` mocks.**
- The UI currently comments out both the Creator column and the 24h Δ column — **but the mocks ARE in the payload.**
- `dashboard/Leaderboard` filter Select: `"all" | "tiktok" | "instagram" | "youtube" | "x"`; **a "Twitter" option was deliberately removed** (comment `:243-246`) because nothing is stored under that value. `"all"` → `undefined`. Page + filter persist in **sessionStorage** under `` `leaderboard:v1:${campaignId}:${category ?? "all"}:${limit ?? "none"}` ``, value `{currentPage, platformFilter}`; write failures are swallowed. Animated gradient on the views number when `clip.viewCount > 1000000`. Pagination shown only when `totalPages > 1`; itemsPerPage 10.

### 3.H.5 Referrals

| Procedure | Kind | Auth | Input | Notes |
| --- | --- | --- | --- | --- |
| `referrals.getMyReferralCode` | query | protected | none | Most-recent `referral_codes_v2` row → `{code, createdAt, shareCardUrl}` or **`null`** |
| `referrals.getMyReferredUsers` | query | protected | none | `[{id, referredUserId, referredAt, discordUsername\|null, email\|null}]`, newest first. **`enabled: Boolean(referralCode)`** |
| `referrals.getMyReferralStatus` | query | protected | none | `null` if not referred; else `{code, referrerDiscordId, referrerDiscordUsername, referrerEmail, referredAt, boostEndsAt}` where `boostEndsAt = referredAt + REFERRAL_NEW_USER_BONUS_DURATION_MS` (**10 days**, `referrals.ts:18`) |
| `referrals.createReferralCode` | mutation | protected | none | Code = 5 chars from `"ABCDEFGHJKLMNPQRSTUVWXYZ23456789"` (no O/I/0/1), retried up to 10×. Builds `referralLink = CORS_ORIGIN + ?referral_code=CODE`, generates and uploads a PNG share card. ⚠️ **Share-card failure is CAUGHT and logged — the mutation still succeeds with `shareCardUrl: null`.** |
| `referrals.regenerateShareCard` | mutation | protected | none | Re-renders with the CURRENT `balances.totalEarned`. **Not wrapped in try/catch**, so a failure surfaces as an error toast. ⚠️ The gate is `if (lifetimeEarned >= 0)` with a literal `// TODO: give me a min` comment, so it **always runs and prints $0.00 for a zero-earnings user.** |
| `referrals.validateCode` | mutation | **public** | `{code: z.string().min(1).max(255)}` | `{isValid}` — a plain existence check |
| `referrals.attachReferralToUser` | mutation | protected | `{code: z.string().min(1).max(255)}` | `{attached:true}` or `{attached:false, reason}` |

**`attachReferralToUser` — THROWS (not a reason) on:** empty code → `BAD_REQUEST "Referral code is required"`; no Discord → `BAD_REQUEST "A linked Discord account is required"`; no `clerkUserCreatedAt` → `BAD_REQUEST "Unable to verify account age"`; unknown code → `NOT_FOUND "Referral code not found"`.

**Soft reasons** (`{attached:false, reason}`) and their UI text on `/referrals` (`ReferralCode.tsx:206-213`):

| reason | Server rule | Page text |
| --- | --- | --- |
| `FEATURE_NOT_ELIGIBLE` | account created before `REFERRAL_FEATURE_RELEASE_DATE = 2026-01-07T00:00:00Z` | `"Referral codes only work for accounts created after the referral program launched."` |
| `HAS_REWARDS` | the user has **any** `balance_entries` row | `"Referral codes must be applied before earning any rewards."` |
| `SELF_REFERRAL` | own code | `"You can't refer yourself."` |
| `ALREADY_ATTACHED` | one referrer per user, ever | `"Your account already has a referral applied."` ⚠️ **ReferralTracker uses a DIFFERENT string for the same reason:** `"Your account already has a referral associated with it."` |

⚠️ `normalizeReferralCode = code.trim()` — **no uppercase/charset normalisation**, so lookup against the 5-char A–Z2-9 code is case-sensitive beyond trimming.

**Fields collected:** exactly one — `<Input placeholder="Enter referral code">` (`ReferralCode.tsx:466-471`), local `referralCodeInput`, sent trimmed. Client refuses empty with an **informational (non-destructive)** toast `"Enter a referral code"` / `"Paste the code you received before applying it."`

**Visibility:**
- Code card body: `isLoadingCode` → spinner + `"Loading your code..."`; else `referralCode` → the code block; else the create CTA `"You haven't created a referral code yet."` + a `size="lg"` `"Generate referral code"` button.
- Referral link row: `referralLink` non-null — built **client-side** as `window.location.origin + ?referral_code=CODE`. ⚠️ **The server builds it from `env.CORS_ORIGIN`, and it is the SERVER version baked into the share-card QR code.** They can disagree on a preview/staging origin.
- Share-card panel ("SHARE ON SOCIAL MEDIA", Instagram+Twitter chips, image, "Regenerate image"): `shareCardUrl` truthy.
- ⚠️ **"Creators using your code" is gated on `referredUsers.length > 0`**, so the inner loading branches and the `"No creators have applied your code yet."` empty state (`:414-416`) are **UNREACHABLE dead code**.
- "Referral applied" alert: `referralStatus` non-null → `` `You were referred by <username || email || discordId || 'Another creator'>.` `` plus, when `boostEndsAt` exists, `` ` Your 10% earnings boost lasts until <locale string>.` ``
- ⚠️ **The "Were you referred?" input and Apply button remain fully enabled even when `referralStatus` is non-null** — there is no disabled/completed state.

**After submit:**
- `createReferralCode` success → toast `"Referral code created"` / `` `Your code ${result.code} is ready to share.` `` then `await refetchReferralCode()` (**an explicit refetch, NOT `utils.invalidate`**).
- `regenerateShareCard` success → `"Share image refreshed"` / `"Your card now reflects the latest total earned."` then refetch.
- `attachReferralToUser` `attached:true` → toast `"Referral applied"` / `"Thanks for letting us know who referred you!"`; clears the input; `await refetchReferralStatus()`. **No redirect.**
- `attached:false` → destructive toast `"Referral not applied"` with the mapped reason, or `"Please double-check the code and try again."` for an unmapped one. **Input NOT cleared, status NOT refetched.**
- throws → `console.error` + destructive `"Couldn't apply referral"` / `"Please try again in a moment."`
- Copy: no clipboard → destructive `"Clipboard unavailable"` / `"Copy this manually from the text field."`; success → `` `${label} copied` `` with the value as description; throw → `"Copy failed"` / `"Please try again."`
- Share: `navigator.share({title:"Join me on Atomik Clips", text:"Use my referral link to sign up", url})` then toast `"Referral link shared"`. **`AbortError` (user cancelled) is silently ignored**; any other error → destructive `"Share unavailable"` / `"Copy the link instead."` **and then it FALLS THROUGH to copy.** No `navigator.share` → copies directly. Null link → `"Share unavailable"` / `"We couldn't build the referral link."`

### 3.H.6 Notifications

| Procedure | Kind | Auth | Notes |
| --- | --- | --- | --- |
| `notifications.getMyNotifications` | query | protected | Up to `ANNOUNCEMENT_LIMIT = 10` rows `WHERE user_id AND dismissed_at IS NULL`, newest first. Then **in JS**: drops falsy-metadata rows; drops rows past `created_at + expires_minutes*60000`; **de-dupes `submission-approved`/`submission-rejected` by `metadata.submissionUrl` (first wins)**; re-sorts so **two `earnings-update` rows compare by `metadata.amount` DESC**, everything else by `created_at` DESC. Throws `UNAUTHORIZED "User not authenticated"` if no `ctx.user.id`. |
| `notifications.getAnnouncements` | query | **protected** | `notification_announcements WHERE dismissed_at IS NULL`, limit 10, same falsy/expiry filters. ⚠️ **Because it is protected, signed-out visitors see no announcements at all.** |
| `notifications.dismiss` | mutation | protected | `UPDATE … WHERE id AND user_id = ctx.user.id`. **No row-existence check — dismissing someone else's id silently no-ops.** |

`NotificationsSpotlight.tsx` is wrapped in a class `SpotlightErrorBoundary` that **renders `null` on any throw** and logs `"NotificationsSpotlight crashed — hiding the banner"` (`:111-136`). It returns `null` when `visibleNotifications.length === 0`.

⚠️ `NotificationSchema.ts` is a zod discriminatedUnion of **12 variants**, used **only for a `console.warn` validation pass** (`"Failed to parse notification metadata"`, `NotificationsSpotlight.tsx:159-166`). **Rendering does not depend on it.** Tone falls back to `toneByAlertType[…] ?? toneByAlertType.info`.

**CTA button** (`buildCta()`, `:67-107`) returns non-null **only** for: `submission-approved`, `submission-rejected`, `demographics-verification-reminder`, `earnings-update`, `payout-initiated`, `withdrawal-refunded`. All other types (`issue-alert`, `announcement`, `private-campaign-application`, `campaign-suspension`, `campaign-activity-grace`, `withdrawal-returned`) render **NO button**.

`"Reason:"` line shows when `metadata.type === "submission-rejected"` AND `rejectionReason` is truthy AND `!== ""` AND `!== "."`. `"Reviewer:"` when `metadata.reviewer` is truthy.

**Dismissal is optimistic:** the id is added to a local `Set` and `activeIndex` is adjusted (stepping back if the dismissed card was last); `trackEvent('notification_dismissed')`. **On error the id is removed and `activeIndex` restored — the card reappears, with no toast.**

**Home announcement banner:** shows only the FIRST announcement whose id is not in the localStorage dismissed set (`.find`). Dismissal is **purely local** — the id is appended to state and written to localStorage `dismissedAnnouncements`. **No server call, so it returns on another browser/profile.** Malformed JSON → `console.warn("Failed to parse dismissed announcements")` and the announcement reappears.

⚠️ **NOT DETERMINABLE FROM CODE:** what creates the `'demographics-verification-reminder'` notification type referenced by `NotificationSchema.ts:17` and `NotificationsSpotlight.tsx:82`. The only notification this area writes is `metadata.type = 'demographics_reset'` (`demographicsVerification.ts:492`). **The two do not match**, and the producer of the reminder type was not found.

### 3.H.7 Loading / empty / error states across 3.H

| Surface | Loading | Empty | Error |
| --- | --- | --- | --- |
| Submissions page | full-section `Loader2 h-6 w-6` + `"Loading campaigns..."` inside AppLayout | dashed rounded-[28px] Card: h2 `"You haven't joined any campaigns yet"`, p `"Submit your first clip to start tracking your progress and earnings here."`, Button → `/campaigns/active` `"Submit your first clip"` (fires `trackEvent('campaign_empty_state_submit_clicked')`) | — |
| Submissions "Rewarded views" tile | `Loader2 h-4` + `"Loading..."` | `0` + `"<n> total views (<min> minimum needed)"` | — |
| Submissions "Total rewarded" tile | centred `Loader2 h-5`, **no text** | `"No rewards yet. Keep driving views to unlock payouts."`; no platform rows → `"No platform breakdown yet"`; no `lastRewardAt` → `"Recent reward info coming soon"` | — |
| Submissions posts dialog | — | `"You haven't submitted any posts to this campaign yet."` (p-10 centred) | — |
| Per-row delete | trash → `Loader2` **only on the row being deleted**; all pending delete buttons disabled; AlertDialog action `"Deleting…"` with both buttons disabled | — | destructive toast only, **no inline error region** |
| `MyStatsSection` | two Skeleton tiles + one `h-6 w-24` — **only when `isLoading && isSignedIn`**, so a signed-out viewer sees 0 / $0.00 rather than skeletons | — | destructive `<p>` **BELOW** the tiles: `"Failed to load your stats. Please try again shortly."`; the tiles still render with 0 |
| HomeLeaderboards earners / clips | `!campaignId \|\| isLoading` → `Loader2 h-5` + `"Loading…"` / `"Loading clips…"` | `"No earners in this campaign yet."` / `"No clips in this campaign yet."` | **NO error branch** — failures fall through to loading/empty |
| HomeLeaderboards picker | SelectValue placeholder `"Loading campaigns…"` else `"Pick a campaign"` | whole section returns `null` | — |
| `dashboard/Leaderboard` | Card with the real title + Trophy icon + 10 × `<Skeleton className="h-10 w-full"/>` | `"No submissions found for this campaign."` (`all`) or `` `No submissions found for ${formatPlatformLabel(platformFilter)}.` `` | Card renders with its title and body `"Failed to load submissions data"` (on `error \|\| !leaderboardData`) |
| `PlatformBreakdown` | 3 skeleton rows | `"No submissions found for this campaign"` (centred, py-4) | destructive `"Failed to load platform breakdown"` |
| `ReferralCode` | `"Loading your code..."`; buttons `"Creating..."` / `"Updating..."` / `"Applying..."` | `"You haven't created a referral code yet."` | **NO error branches** — a failed query leaves `referralCode` null and shows the create CTA, which then fails with a destructive toast |
| `NotificationsSpotlight` | — | renders `null`, no placeholder | error boundary → `null` |
| Home | `isUserLoading` → `Loader2 h-6 w-6` + `"Loading campaigns..."` | — | whole body → destructive `"Failed to load campaigns"`. Notifications/announcements errors are **silently hidden** (gated on `!error`, no message). |

**Rank accents:** `HomeLeaderboards.rankAccent()` — 1 amber, 2 slate, 3 orange, else muted, with explicit dark variants. `dashboard/Leaderboard.getRankIcon()` — ranks 1–3 get a Trophy chip (amber/slate/orange), rank 4+ a plain `#n`.

**Number formatting is inconsistent by design-accident:** `HomeLeaderboards.compactViews` uses `Intl notation:"compact"`; `dashboard/Leaderboard.formatNumber` uses M/K with 1 decimal; `PlatformBreakdown` has its own identical `formatNumber`; `MyStatsSection` uses plain `Intl en-US` + USD with 2 fraction digits; the share card uses 0 fraction digits at ≥ $1000 and 2 below.

---

# 4. Cross-cutting invariants

These are the things a redesigner can break **without noticing**, because nothing fails loudly.

### 4.1 Money holds

| Invariant | Where | What breaks if you touch it |
| --- | --- | --- |
| Release is on **APPROVAL**, not submission | `demographics-reset.ts:491` (`satisfied = accounts.every(a => a.approved)`) | Copy implying "submit to unlock" (ClaimableWidget already says *"Submit demographics to release"*) overstates it. `accountsMissing` vs `accountsAwaitingReview` on each locked row is the **only** signal distinguishing the two states and must survive. |
| The hold **caps**, it does not block | `Earnings.tsx:221-222` comment; `weeklyGateBlocked = pendingAsks.length > 0 && claimable <= 0` | Turning it back into a full block strands claimable money. |
| Non-campaign balance is never held | derived by SUBTRACTING locked campaigns from the real balance (`demographics-reset.ts:588-643`) | Summing "unlocked earnings" instead would freeze referrals, manual adjustments and refunds. |
| Per-campaign net is floored at 0 and rows with `amount <= 0` are dropped | `:563-567, 630` | A negative campaign would otherwise **ADD** to what could be withdrawn. |
| `claimable` is clamped `Math.max(0, Math.min(balance, balance - lockedTotal))` | `:640` | Without it, a cashed-out clipper gets a negative claimable. |
| **Threshold and ask are paired** — a campaign below the view threshold is not asked AND not held | `:426-443` comment | Relaxing one side strands money behind a report the clipper is forbidden to file. **169 accounts previously held money against an impossible report.** |
| `always_request_demographics` bypasses the threshold on **BOTH** the ask side and the submit side | `:124-132` comment; `:441-443`; `demographicsVerification.ts:334-340` | Same failure mode. |
| `MINIMUM_CLAIM_AMOUNT = 2`, strict `>` | `Earnings.tsx:38` — **client only, no server backstop** | Changing to `>=`, moving the Claim button, or adding a claim entry point that skips the check lets clippers claim $0.01. |
| The bank claim takes **no amount**; the crypto claim does | `wise.requestMyWithdrawal` has no `.input()`; `cryptoPayouts.requestMyWithdrawal` takes `{methodId, amount}` | The asymmetry is intentional. Adding an amount field to the bank step is a product change. |
| The batch payout path **caps silently instead of erroring** | `wise.ts:1096-1111` | Surfacing an error there changes admin behaviour. |
| Rejection fan-out **ADDS `approved`** to the target statuses | `demographicsVerification.ts:172-175, 1089-1092` | A rejection deliberately claws an account back out of campaigns where it was already approved, re-holding that money. |

### 4.2 Per-account scoping

- The redemption ledger, the demographics ask, and the one-account rule are all keyed on **`verified_user_id`**, not on the user. A clipper can be blocked on one account and free on another simultaneously.
- Step-2 deliberately does **not** block the submit form on `anyAtCap`, because the target account is unknown until the URL is pasted (`step-2-content.tsx:77-80`). The server throws instead.
- The demographics fan-out gives **each target campaign its own `cycle_start` and its own `views_from_submissions_snapshot`** (`demographicsVerification.ts:365-408`). `views_from_submissions_snapshot` **WEIGHTS** each report in `computeDemographicsBreakdown` — copying one value across campaigns corrupts every other campaign's country percentages.
- `getRedemptionProgress` and `getCampaignAccountDashboard` return **different account sets** (touched-the-ledger vs all-eligible-including-zero-activity). They are not interchangeable.
- `privateCampaigns.myVerifiedAccounts` uses **exactly the same filter** the apply mutation re-checks, deliberately, so the button's enabled state can never disagree with the server rule.

### 4.3 Ban filters

- `banned_users` → `UNAUTHORIZED "User is banned"` at the middleware. **Does NOT match the force-logout regex**, so the session survives.
- `banned_social_media_users` (platform + handle) is checked in `createSubmission` (`:653-666`), `submitNonCampaignClip` (`:1019-1031`, added specifically to close a clawback-reversal money path), and `getParticipatingAccounts` (**no `LOWER()` so the index stays usable**).
- Leaderboard queries exclude banned users AND banned handles server-side.
- Optional-auth surfaces silently **downgrade a banned viewer to anonymous** rather than erroring (`optionalAuth.ts:76-85`).

### 4.4 Private-campaign stripping — three independent implementations

`sanitizePrivateCampaign` (`campaigns.ts:183-248`), `stripPrivateCampaignRow` (`:312-365`), and `getByIdPublic`'s inline strip (`:507-530`).

| Rule | Detail |
| --- | --- |
| `private_teaser_description` **REPLACES** the description **regardless of `private_show_description`** | All three sites implement this precedence, each with a comment warning that ignoring it leaks the real client. |
| `sopEmbedUrl` is **ALWAYS null** for private campaigns in every public endpoint | Hardcoded in all three regardless of `private_show_description`. The only path to the real SOP is `getApplicationState.unlocked.sopEmbedUrl`. |
| `private_show_min_views` is a **SEPARATE toggle** from `private_show_rates` | `hideMinViews` requires **both** false. A campaign can hide CPM but still publish view floors. |
| `levels` is set to `[]` and `is_hot_streak_enabled` to `false` when `!private_show_rates` | `:222-223`. **Neither `myUnlockedCampaigns` nor `getApplicationState.unlocked` restores them**, so an approved clipper on such a campaign sees no Level boosts and no Hot Streaks section even though they are unlocked everywhere else. **Existing behaviour — do not "fix" it in a design-only pass.** |
| `getByIdPublic` does not honour `private_show_rates` | It never selects rate columns, so nothing leaks today — but adding rate fields to that projection to avoid a second request would **bypass the teaser strip entirely.** |
| `useSubmissionFlowCampaign` returns `data: undefined` while the unlock check is pending | So step-1's SOP auto-skip cannot fire on a stripped `sopEmbedUrl`. A loading-state change there **silently skips the SOP for approved clippers.** |
| The dialog's two-signal unlock: `!unlocked && !unlockedForMe` | Dropping `unlockedForMe` re-introduces a real→locked flash; dropping `unlocked` breaks the dialog when opened from a surface that did not merge `myUnlockedCampaigns`. |
| Rejection notifications use the **TEASER** title; approval notifications use the **REAL** title | `privateCampaigns.ts:966-993` vs `:996-1043`. A rejected clipper never learns the real client. |

### 4.5 Kill-switch flags & constants

| Flag / constant | Value today | Effect |
| --- | --- | --- |
| `site_settings.maintenance_enabled` | admin-toggled via `/admin/sos` | Replaces the whole app for non-`sos`/non-`god-mode` **authenticated** users. `/auth`, `/reset-password`, `/privacy` stay reachable **on purpose** so an SOS holder can log in and turn it off. 20-second poll. |
| `site_settings.leaderboard_enabled` | admin-toggled via `/admin/leaderboard-tools` | Hides `HomeLeaderboards` entirely. **Missing row → TRUE. DB read throws → fails OPEN with TRUE.** |
| `AUTO_CAMPAIGN_DEMOGRAPHICS_ASK` | `true` (`demographics-reset.ts:57`) | Every active, non-ended campaign the clipper has rewards on asks automatically, with `requestId: null` and `note: null` and a `requestedAt` back-dated to the cycle's Monday. **Cancelling a moderator round does NOT stop the ask.** |
| `WEEKLY_HOLD_ENABLED` | `false` (`geo-clearance.ts:33`) | The second hold is inert. |
| `ONE_ACCOUNT_RULE_ENABLED` | `true` (`oneAccountRule.ts:14`) | — |
| `STALE_UNVERIFIED_CLAIM_MS` | 24 h | An abandoned unverified handle claim stops blocking other clippers after a day. |
| `CLIPPER_DEMOGRAPHIC_ENTRY_CUTOFF` | `2026-06-17T00:00:00Z` | Campaigns created before it skip Step 4 entirely and the moderator fills the breakdown. |
| `REFERRAL_FEATURE_RELEASE_DATE` | `2026-01-07T00:00:00Z` | Accounts created before it can never attach a referral. |
| `REFERRAL_NEW_USER_BONUS_DURATION_MS` | 10 days | Drives the `boostEndsAt` copy. |
| `MIN_VIEW_DISPLAY_THRESHOLDS` | `{ campaign_1783258985456: 3000 }` | **Display only — never touches payouts.** No admin UI; it is a source constant. |
| `NC_EXEMPT_USER_IDS` | one Discord id | `cap = 0` in `createSubmission` — but **not** applied in `submitNonCampaignClip`. |
| `SHARED_SOCIAL_ACCOUNTS` | one entry: `growasentrepreneurs`, owners `755628278298968075` + `296884557972504577` | Suppresses the one-account CONFLICT. **Not platform-scoped. Silent — no UI acknowledges it.** |
| `EARNERS_DENYLIST_*` | exact `["channelprnv"]`, substrings `["hannaan","hannan","hanaan"]`, ids `[]` | Silently omits rows from the top-earners board. |
| `US_DEMOGRAPHICS_OWNER_DISCORD_ID` / `DEV_OVERLOOK_DISCORD_IDS` | `"296884557972504577"` | Personal, not role-based, **so no user-roles admin can grant themselves access.** |
| Earnings history cutoff | `created_at > 2025-11-17T15:51:00Z`, hard `LIMIT 500` | Silently truncates and back-dates; the UI says "of 500 entries" with no indication. |
| Frontend feature flags | see §2.7 | Client-only, email-keyed, **no server enforcement.** |

### 4.6 Paired helpers that must move together

| Pair | Why |
| --- | --- |
| `getCampaignAsksForUser` ↔ `getClaimableBreakdown` | The ask decides the hold. Splitting them lets money freeze for a campaign the clipper is never asked about. |
| `getParticipatingAccounts` ↔ the submit-side ownership check | Both must apply the same ban/deleted/threshold filters or the clipper is asked for a report they cannot file. |
| `useCampaignsData`'s `isLoading = query.isLoading \|\| unlocked.isPending` | This is what prevents the teaser→real flash. |
| `useSubmissionFlowCampaign` ↔ step-1's SOP auto-skip | The `undefined`-while-pending return is the guard. |
| `useDashboardCampaignData` precedence (editor > password-unlocked > public) | The docblock at `useCampaignData.ts:66-72` records the bug it fixed: when only the cards used it, the header still read the stripped row and a private campaign's dashboard showed real numbers under its cover title. |
| `SubmissionStep2.handleContinue` / `handleVerify` ↔ `step3Complete` | Both set it; step 3's Approve button therefore almost never renders. |
| `submitForCampaign` ↔ its three invalidations (`getCampaignAsks`, `getClaimable`, `rewards.getPayoutEligibility`) | The form re-derives onto the next campaign from the refetched data. |
| `submitNonCampaignClip` ↔ `await utils.…getRedemptionProgress.invalidate()` | The success screen's destructive-vs-neutral branch reads the **refetched** `progress`. Making the invalidate fire-and-forget changes which success variant the clipper sees. |
| `SubmissionPhoneStep`'s `setData` patch ↔ `requiresPhoneNumber` | The patch is what makes the step unmount. Swapping it for an invalidate changes the visible outcome of saving. |
| `AppLayout.InsideAppLayout` ↔ every page's own `<AppLayout>` | Remove either half and Home renders seven nested shells. |
| `TrpcProvider`'s regex ↔ the backend's exact message strings | Renaming `"Token verification failed"` / `"Invalid token"` disables force-logout; putting `"invalid token"` into the anonymous message enables it for public visitors. |
| `AppSidebar`'s `enabled: isAuthenticated` ↔ the public pages the sidebar renders on | Documented at `AppSidebar.tsx:260-268`: firing the owner checks signed-out 401'd and hijacked the client password screen to `/auth`. |
| `ReferralTracker`'s global mount ↔ `localStorage['referral_code_v2']` | Scoping the component to a page breaks attribution for anyone who clicks a link before signing up. |
| Clipboard/share helper ↔ its `AbortError` special-case | Without it a user cancelling the share sheet gets a destructive error toast. |

### 4.7 Things that only look cosmetic

- The `Math.min(acc.unredeemed, acc.cap)` clamp — the raw bucket legitimately exceeds the cap.
- The `Number.isFinite(achievementPercentage)` guard — budget 0 produces `NaN`.
- `floorsAllEqual` comparing **all four raw floors including zeros**.
- `"Hidden"` (teaser) vs `"Not set"` (no rate configured).
- The blocked CTA rendered as a `<span>` rather than a disabled `<Link>` (`disabled` on a Radix `Slot` is inert).
- The literal angle brackets in `` `This link appears to belong to <${detectedHandle}>.` `` — safe only because React escapes it as text.
- The two variants of `"This clip has already been submitted"` — one with a period, one without.
- `"your tiktok account"` (raw lowercase enum) vs `"YouTube, Instagram"` (title-cased by `formatPlatformList`).
- The attestation paragraph — the only place its consequence is stated.
- The hot-streak tier values (`+$0.10 / +$0.05 / +$0.03`) — hardcoded in the component, not the DB. **Rewriting that copy changes a payout claim.**
- The payment-method fallback `"Bank" / "Direct transfer"` — any campaign with empty `payment_methods` silently claims bank transfer.
- `CampaignPreviewModal`'s "Key requirements" bullets — the docblock at `:26-32` states that inventing copy there would state rules the payout engine does not enforce. Every bullet maps to a column; the only constant is the final verified-account line.
- `formatCurrency`'s fraction-digit default flipping at $1000.
- The `v3.54` deploy canary in Home's footer.

---

# 5. Redesign risk register

Ranked by (blast radius × how silently it fails). **R1–R8 are money or access. Treat them as blockers.**

| # | Risk | What breaks | How to avoid it |
| --- | --- | --- | --- |
| **R1** | **Rebuilding the clipper's navigation around the sidebar in the screenshots.** | The sidebar is staff-only (`showSidebar = isSignedIn && roles.length > 0`). Its seven clipper entries are configuration **no clipper ever sees**. `MobileFloatingNav` is inside the same condition, and its hamburger opens the sidebar Sheet — showing it without `AppSidebar` gives a button that opens nothing. Splitting the two conditions **GRANTS clippers navigation they do not have today.** | Keep `AppLayout.tsx:26-30, 46-49` byte-identical. Rebuild the clipper's app as the single `/` page with its six sections. |
| **R2** | **Removing, renaming or relocating the `InsideAppLayout` context.** | Home renders seven nested `SidebarProvider`s, seven `TopNav`s and seven `<main>` elements. **No error — just a page rendered inside itself six times.** Hoisting `<AppLayout>` to the route level means removing the wrapper from 68 call sites and breaks the deep-link contract the code explicitly protects (`AppLayout.tsx:16-18`). | Keep `:19, :38-40, :43`. Note the early return is **after** the hooks, so nested instances still run them. |
| **R3** | **"Simplifying" `TrpcProvider`'s 401 handler into a blanket "any 401 → sign out".** | Kicks every anonymous visitor off `/campaign/:campaignId` (the client password screen), `/`, `/explore` and the unguarded submission-flow routes the moment any protected query 401s. **This regression already shipped once** — the comment at `:46-52` exists because of it. Also force-logs-out banned and maintenance users. | The regex must stay exactly `/token verification failed\|invalid token\|/i`-equivalent. Never rename the backend strings. Never swap `httpLink` for `httpBatchLink` (one 401 in a batch would trigger logout on behalf of unrelated queries). |
| **R4** | **Treating the step-2 error alert as a generic "something went wrong" slot.** | It is the sole user-facing surface for ~16 distinct outcomes — suspension, private denial, pause, handle ban, duplicate, resubmit-disabled, redemption cap, credit race. Collapsing, truncating or "friendlying" them deletes the only explanation the clipper ever gets. | Render `error.message` verbatim. Keep the `submissionError && ctx.step3Complete` gate and the effect that nulls the error when `step3Complete` goes false (`:92-96`) — a redesign that resets step completion on error makes the message flash and vanish. |
| **R5** | **Turning `WeeklyDemographics`'s "Reporting for" into a dropdown, or making the Requests list clickable.** | The campaign is DERIVED (`:92-95`) and the list is explicitly marked non-clickable (`:269-270`). Anchoring on `!ask.satisfied` instead of "has an unsubmitted account" pins the form to a campaign already fully answered and blocks the clipper from reaching the next one for as long as review takes. A selectable campaign also lets a report answer the wrong one — leaving the asking campaign on hold and putting an unasked-for row in the mod queue. | Keep the derivation order exactly. |
| **R6** | **Dropping the blocked non-campaign CTA's `<span>`, or losing the entry points to `/campaign/:id/non-campaign`.** | `disabled={blocked}` on a `Button asChild` lands on a Radix `Slot` → a `<span>`, where it is **inert**; the blocked look is only the inline `cursor-not-allowed opacity-60`. "Cleaning it up" into a `<Link disabled>` makes it clickable again and capped clippers walk into step-1 and get an opaque `PRECONDITION_FAILED`. Separately, there are exactly **two** links into `/non-campaign` (`submit-dashboard.tsx:242-249`, `step-2-content.tsx:249-254`) and no nav entry — drop them and a blocked clipper can never unblock themselves. | Reproduce both the `<span>` and both links. |
| **R7** | **Moving or removing `<ReferralTracker/>` from `App.tsx:100`.** | It is the only thing that captures `?referral_code` / `?referralCode` / `?ref` from a landing URL and auto-attaches it after sign-in. Scoping it to a page **silently stops referral attribution with zero visible error.** Renaming `localStorage['referral_code_v2']` drops in-flight attributions for users who clicked a link but haven't signed up yet. | Keep it mounted globally inside `BrowserRouter`, below `<Toaster/>`, and keep the key. |
| **R8** | **Adding a new public route outside `MaintenanceGate.ALWAYS_ALLOWED_PATHS`, or renaming `/auth`.** | `startsWith` matching means any new `/auth*`, `/reset-password*` or `/privacy*` route is silently maintenance-exempt; conversely a new `/terms` or `/help` becomes unreachable during maintenance. **Renaming `/auth` locks SOS holders out of the only path to `/admin/sos`.** Optimising away the 20 s poll breaks the automatic lift. | Leave the array and the poll alone. |
| **R9** | **Assuming feature flags are server-driven, or deleting a branch you never saw.** | `TERMS_AND_CONDITIONS` and `DEMOGRAPHICS_ON_CAMPAIGN` are `enabled:false` with 6-address lists. **Any tester outside those lists will never once see the `TermsDialog` branch** and will delete the import, the `showTermsDialog` state and the `<TermsDialog/>` block. Conversely `EARNINGS_FF`'s description ("New earnings function with improved UX") invites building the new Earnings page behind a flag **nothing consumes** — shipping it dark forever. | Keep the `if (enabled) setShowTermsDialog(true) else handleVerify()` branch verbatim in both call sites. Note `DEMOGRAPHICS_ON_CAMPAIGN` is bound and never read — the campaign Demographics panel is gated on **server** fields. |
| **R10** | **`handleExists` looks like a check and is a credential GENERATOR.** | It inserts a `verified_login_credentials` row and creates an **external ForwardEmail alias**. It is invoked imperatively via `utils.…fetch()`, so react-query may serve a cached result for identical input. Turning "Next" into an auto-fire-on-blur, a debounced live check, or a `useQuery` with refetch-on-focus **creates credential rows and external aliases as a side effect of typing.** | Keep it behind an explicit button press. |
| **R11** | **Re-initializing bio verification on mount / platform change / remount.** | `initializeVerification` **ROTATES** the verify code for an existing unverified handle (`:207-217`), invalidating whatever the clipper already pasted into their bio — an unwinnable loop. Note `login-verification.tsx` already calls `startVerification` on every successful Validate, and `SubmissionStep2` auto-fires it whenever `detectedPlatform`/`detectedHandle` change. | Never call it from an effect you did not already have. |
| **R12** | **Debouncing, moving or converting the step-1 `getPlatformMetadata` call.** | It is imperative, per-keystroke, and is the **only** thing that populates `ctx.contentUrl` / `detectedPlatform` / `detectedHandle` — which is what makes `step1Complete` true and what gets POSTed. Converting it to a `useQuery` or debouncing it changes when those values exist and therefore when the submit button enables. It also costs real YouTube quota. | Leave `SubmissionStep1.tsx:105-157` as-is, including the `// TODO: debounce`. |
| **R13** | **Collapsing the four submission-flow routes into one page, or one shared layout instance.** | Today each route mounts its own `SubmissionProvider`, so all ten context values reset on every navigation. A single persistent provider **silently changes behaviour** (step flags and a detected handle would survive a back-navigation); merging the steps breaks the two auto-`replace` navigations that depend on distinct URLs. | If you must restructure, verify the reset behaviour explicitly. |
| **R14** | **`verifyUserBio` and `previewClipUrl` return failure as HTTP 200.** | Wiring the button to `mutation.isError` / `onError` only treats a failed bio check as a **success**. The failure signal is `result.verified`, and for the preview it is `preview.ok` / `preview.alreadySubmitted`. | Read the payload, not the mutation state. |
| **R15** | **Making the redesigned phone step a route, rendering it unconditionally, or "fixing" the fail-open.** | It is an inline `StepSection` inside the step-2 `<form>`; its Enter-key handler exists specifically to stop the outer form submitting. It is mounted only when `requiresPhoneNumber`, which is **false while loading, false on error, and false once a number exists** — always rendering it newly exposes an edit-phone surface no clipper can currently reach. And a `getProfile` failure deliberately **unblocks** submit with the copy `"You can still submit your clip."` — failing closed would block real submissions. | Preserve all three conditions and the Enter handler. |
| **R16** | **De-duplicating or re-sorting `PHONE_COUNTRY_CODES`, or changing the `"+91"` default.** | Duplicate dial codes are used as both React `key` and Select `value` (`+1`, `+7`, `+590`). Fixing that is a real improvement but **changes selectable options and therefore stored values**. The stored value is the raw dial string with no ISO code, and the server accepts any ≤8-char string without membership validation. Changing the default changes what unmodified users save. | Flag as a decision, do not do it silently. |
| **R17** | **Adding phone or wallet-address format validation.** | Neither exists today, on either side. The only phone normalisation is `.replace(/\s+/g," ")`, so existing rows may contain dashes, parens and mixed formatting — a stricter input could fail to round-trip them. Crypto addresses have **no network-specific validation at all**. | Adding validation is a logic change. |
| **R18** | **Unifying the four demographics status→label maps, or the three campaign-card designs, or the two bank forms.** | Labels are safe; **which statuses count as submitted/approved is not** (`SUBMITTED_STATUSES` drives money). The three card designs differ in progress-label clamping and error handling (`/explore` has no error branch). The two bank forms differ in step split, toast copy, alert titles and **analytics event names** — one of which is already missing its `wise_` prefix. | Unify only after listing every behavioural difference. |
| **R19** | **`bankAccounts.*`, `rewards.requestWithdrawal`, `rewards.getPayoutEligibility`, `submissions.submitWeekly`, `getWeeklySubmissionStatus`, `verification.validateLoginCredentials` are live-looking and unused.** | `bankAccounts.*` mirrors the live form's field names — wiring the new bank UI to it silently stops creating Wise recipients. `getPayoutEligibility`'s own doc comment falsely claims it drives the Claim button. `verifyLoginCredentials` **no longer validates anything** (the check is commented out) — do not build UI promising validation. | Check for call sites before trusting a procedure name. |
| **R20** | **Adding a global error boundary, a `QueryCache.onError`, or `defaultOptions` to `new QueryClient()`.** | None exists today (the only `ErrorBoundary` is scoped to `NotificationsSpotlight`). Adding one surfaces errors that are currently swallowed by design — including the anonymous 401s `TrpcProvider` is deliberately silent about. A global `staleTime` stops refetch-on-mount **app-wide**; a global `retry` changes how fast every error surfaces. Only ~20 call sites override anything. | Treat these as logic changes requiring sign-off. |
| **R21** | **Discord popup mechanics.** | `window.open(..., "width=500,height=850")` deliberately omits `noopener` because the callback needs `window.opener` to `postMessage` back. `CALLBACK_ORIGIN` is derived from `VITE_TRPC_URL`, **not** `window.location.origin`. Adding `noopener` for "security tidiness" silently breaks consent; changing how the API URL is configured breaks it in exactly one deployment topology. | Leave `PrivateCampaignApplySection.tsx:19-25, 151-156` alone. |
| **R22** | **Collapsing the join button's three labels.** | `"Enable one-click join"` (no grant) / `"Join server"` (grant, not joined) / `"Re-join"` (joined via oauth) encode three distinct server states. | Keep all three. |
| **R23** | **`AdminRoute` denies before roles are known, and denial is a PAGE.** | It never checks `isRolesLoaded`. If the redesign changes mounting order, adds a suspense boundary, or renders `AdminRoute` outside `ProtectedRoute`, the "Access Restricted" flash becomes visible. Restyling it as a redirect or modal changes URL/history behaviour that deep links rely on. **Adding an `isRolesLoaded` guard would be a logic change — flag it, don't fix it.** | |
| **R24** | **The sidebar's role list and the router's role list disagree in three places.** | `/admin/demographics-verification` (sidebar `demographics-reviewer`, route `submission-reviewer`); `/admin/influencer-campaigns` (sidebar `influencer-campaign-editor`, route `submission-reviewer`); `/admin/influencer-submissions-log` (sidebar `influencer-submission-editor`, route `submission-reviewer`). **Unifying them changes who can reach what.** Also `/admin/user-roles` is gated on `user-roles-admin` but its picker calls `user.listUsers`, a `userActivityRoleProcedure` — so a `user-roles-admin` without `user-activity-read` sees a page whose search always errors. | Reproduce both lists verbatim. |
| **R25** | **Restoring `/reset-password` or wiring `/onboarding`.** | `/reset-password` is unreachable, its `updatePassword` is a stub toast, and success navigates to a **non-existent** `/campaigns`. `/onboarding` writes nothing, has decorative uncontrolled payout inputs, a fake "Send code", and a **local-dev-only** `finish()` branch that writes `localStorage['dev-onboarded']` and hard-reloads. Wiring either is a logic change; shipping the dev branch is worse. | Rebuild `/onboarding` as a shell that still saves nothing unless the client explicitly authorises new behaviour. Do not wire `/reset-password` — password reset lives in Clerk's hosted flow. |
| **R26** | **`Earnings.tsx` never reads `error`; `VerificationCard` never reads `isError`.** | A failed query renders a plausible $0.00 zero-state / "Not verified" instead of an error. Adding an explicit error state is presentation-only and safe — but keeping the current destructuring keeps reporting outages as "you have no accounts". | Decide deliberately. |
| **R27** | **Hot-streak tiers, payment-method fallback, and `CampaignPreviewModal`'s requirement bullets are hardcoded product claims.** | Rewriting them changes what the platform promises to pay. | Copy them verbatim. |
| **R28** | **Displaying `creator` / `velocityChange` / `isPositiveVelocity`, or `getPlatformBreakdown`'s `cpm` / `valueDelivered`.** | The first three are fabricated (`"Creator " + last-4-of-user_id`, `Math.random()`) and currently commented out. The last two are returned by a **public** endpoint and are zeroed only for private campaigns — surfacing them publishes CPMs for every non-private campaign. | Leave both hidden. |
| **R29** | **Native `window.confirm` on the bank cancel; no confirm at all on the crypto cancel.** | Replacing the native confirm with an AlertDialog is a presentation change most redesigns want — but the exact string `"Cancel this payout request and return the funds to your balance?"` and the silent no-op on decline are current behaviour, and the crypto path deliberately has none. | |
| **R30** | **`dev-clerk.tsx` must keep exporting exactly the Clerk surface the app uses.** | It is aliased in for the whole `@clerk/clerk-react` package under `VITE_LOCAL_DEV=true`; a missing export is a build error **by design**. Introducing any new Clerk import (`<UserProfile/>`, `useSession`, `<SignIn/>`) stops local dev building until the stub is extended. Also, `VITE_LOCAL_DEV_ROLES=clipper` must be set alongside the backend's `LOCAL_DEV_ROLES=clipper` — setting only one shows admin links that 403, or hides links that still work. | |

---

# 6. Open questions / not determinable from code

These were left unresolved by the audit. **Do not guess — check the code or ask.**

### 6.1 Outside this repo

1. **The actual sign-in / sign-up UI.** `/auth` uses `<SignInButton mode="redirect">` / `<SignUpButton mode="redirect">`, which hand off to Clerk's hosted portal. Which providers are offered, what fields are collected, and what the reset-password email flow looks like are all configured in the Clerk dashboard. The only styling this repo applies is `appearance.baseTheme`.
2. **Whether Clerk itself collects or verifies a phone number** during sign-up. The app's own `phone_number` column is entirely separate — the backend never reads a Clerk phone.
3. **The exact wording on Clerk's hosted OAuth/Discord consent screens**, which is the de-facto first screen of the real signup flow.
4. **Whether Clerk is also mounted as express middleware on the backend.** `backend/src/index.ts` mounts cors, `express.json`, three OAuth callbacks, the Inngest handler and the tRPC adapter — no `clerkMiddleware()` was found. If anything relies on `req.auth`, it is not visible there.

### 6.2 Contradictions and unverified claims

5. ⚠️ **`syncClerkBanMetadata` may never populate `publicMetadata.banStatus`.** It is called as `syncClerkBanMetadata(input.userId, …)` where `input.userId` is a **Discord id** (`user.ts:723`), but its signature (`:1345-1348`) and `clerkClient.users.updateUserMetadata` expect a **Clerk user id**. The whole call is wrapped in a try/catch that only `console.error`s. Yet `Home.tsx:111-112` renders the ban alert **exclusively** from that field. **Verify against a real banned account before assuming the alert ever shows.** Separately, if the call DID succeed it passes `publicMetadata: {banStatus}` only — which would **replace** the object holding `roles` and `lastSyncedAt`.
6. ⚠️ **`ReferralTracker.tsx:54` destructures `isPending` from a v4 `useMutation`**, where the flag is `isLoading`. If `isPending` is `undefined` the in-flight guard at `:127` never trips. **Not verified at runtime. Do not "fix" it blind.**
7. ⚠️ **`submitExemption` returns `{status:'pending'}` but writes `'needs-human-review'`.** The UI happens not to read the return value. Which is correct is not stated anywhere.
8. ⚠️ **No code path writes demographics status `'pending'`.** `listClaims` filters for it, so legacy rows are assumed, but **no live producer was found.**
9. ⚠️ **`'demographics-verification-reminder'`** appears in `NotificationSchema.ts:17` and `NotificationsSpotlight.tsx:82`, but the only notification this area writes is `metadata.type = 'demographics_reset'`. **The producer of the reminder type was not found.**
10. ⚠️ **Is a banned user *intended* to stay signed in?** `"User is banned"` simply does not match the force-logout regex, and no comment covers the case. Same for `"A linked Discord account is required"`.
11. ⚠️ **`ROLES.PAYOUTS_ADMIN` ("payouts-admin")** exists in the ROLES map, both dev role lists and the `/admin/alias-generator` array — but `payoutsAdminRoleProcedure` checks `REWARDS_MODERATOR` instead, so **no procedure gates on it** except via `staffProcedure`. Whether it is granted to anyone in production is a DB question.
12. ⚠️ **`campaigns.demographicsVerificationEnabled`** is written by `campaigns.ts:922/969` but **no read of it was found in the demographics flow** — yet `Index.tsx:167-169` gates the campaign Demographics panel on it. Whether it is intended to gate anything else is not determinable.
13. ⚠️ **`/admin/influencer-campaigns/:campaignId` and `/influencer-campaigns/:campaignId` are both unguarded** — no `ProtectedRoute`, no `AdminRoute` — unlike every sibling admin route. The code carries no comment explaining it, and `AdminInfluencerCampaignDetails.tsx` was not read to see whether it self-guards.

### 6.3 Requires a database or a running app

14. Whether MySQL is in **strict mode**, which decides whether a >32-char phone number errors or silently truncates. No app-level guard exists either way.
15. Whether historical `user_clerk.phone_number` rows contain formats a stricter input would reject.
16. Whether the runtime MySQL **collation** makes `verified_users_guild_discord_platform_idx` case-insensitive (assumed from MySQL defaults, not stated in code).
17. Whether the `verification_method` value `'OTP'` appears in any historical row — it is **not a DB enum member**.
18. Whether any production campaign has `private_show_min_views = true`, and how many private campaigns exist.
19. Whether `AUTO_CAMPAIGN_DEMOGRAPHICS_ASK = true` / `WEEKLY_HOLD_ENABLED = false` / `ONE_ACCOUNT_RULE_ENABLED = true` **match the deployed build**. Source only was read.
20. The live value of `site_settings.leaderboard_enabled`.
21. Whether the exact JSON error shape produced by a tRPC v10 + superjson 401 ever populates `error.data.message` rather than `error.json.message`.
22. Whether `getClaimableBreakdown` — which loops per campaign and is called on **every** balance read (TopNav, ClaimableWidget, Earnings, and all three withdrawal paths) — is safe to mount on more surfaces. **Not measured.**
23. Whether `MIN_VIEW_DISPLAY_THRESHOLDS` is intended to grow beyond its single hardcoded entry. It is a source constant with no admin UI.

### 6.4 Files not read, or read only in part

24. `frontend/src/components/MaintenanceScreen.tsx` — only its call site was read; its copy and layout are unknown.
25. `frontend/src/components/CountryPicker.tsx`, `frontend/src/lib/youtube.ts`, `frontend/src/lib/analytics.ts` (`trackEvent`'s destination), `frontend/src/components/ThemeToggle.tsx`, `frontend/src/components/InstagramEmbed.tsx` / `TwitterEmbed.tsx`, `RewardEligibleUserSelect`.
26. `backend/src/routers/submissions/helpers.ts` — `extractVideoIdFromUrl`, `getPlatfromFromUrl`, `getPlatformAndHandleFromUrl`, `extractVideoUrlInfo`, `minViewDisplayFilter`, `leaderboardExclusionFilters`. **These may themselves throw messages that reach the step-2 alert**, which would make the rejection vocabulary larger than §3.D.5.
27. `isBigBoysNcBackfillToReplit` / `isBigBoysReplitReuse` — one-time carve-outs whose predicates (which campaigns, which users) were not read.
28. `backend/src/lib/wiseRecipientSummary.ts` — the `WiseRecipientSummary` type. Which fields are nullable, and what values `routingCodeLabel` can take beyond `'IFSC code'` / `'Bank code'` (the two the pre-fill matches on), are unverified.
29. `backend/src/lib/externalPassword.ts` — the hashing algorithm and whether the comparison is constant-time.
30. `backend/src/lib/generate-share-card/generateShareCardImageBuffer.ts` — the share card's visual contents.
31. `redemptionLedger.ts:1-200` in full (`countUnredeemed`, `findAvailableCredit`, `consumeCredit`, `findUnredeemedToCover`), `reverseClawback`, `voidOutstandingReserve`, `netEarnedByCampaign` (module-private, only its floor-at-zero clamp was read).
32. `backend/src/lib/inngest.ts` — **whether any cron/Inngest job opens `demographics_reset_requests`.** The comment at `demographics-reset.ts:39-45` says none does, and the only caller of `openResetRequest` found is the moderator mutation — but this was not audited exhaustively.
33. Admin pages: `AdminDemographicsVerification.tsx` (only its status maps and mutation calls), `AdminPrivateCampaigns.tsx`, `AdminClipperActivity.tsx`, `AdminDevOverlook.tsx`, `AdminPayouts.tsx`, `AdminCryptoPayouts.tsx`, `CampaignEdit.tsx`, `CampaignStats.tsx`, `CategoryView.tsx`, `CampaignLevelsManager.tsx`, `CampaignCpmGroupsManager.tsx`.
34. `campaigns.updateCampaign` (`:935-1154`), `slashYoutubeHeavyRewards`, `getSubmissionSnapshots`, `getTopClippers`, the geo-rule procedures (`:2084-2423`), `privateCampaigns.listApplications` / `getApplicantStats` field-by-field, `rewards.getMyCampaignRewards`'s full return shape (inferred from consumed fields only).
35. `components/dashboard/BountyProgress.tsx` beyond ~line 120 — its exact metric-card labels and formatting.
36. `MobileFloatingNav.tsx` / `NotificationsSpotlight.tsx` links to `/earnings` were confirmed by grep only in one audit pass.

### 6.5 Tooling caveat

37. ⚠️ **The Grep tool in this environment mangles some `//` sequences and `/` characters** (it showed `\ Start the one-time consent` and `bg-muted\40`). Every string quoted in this document was re-verified with Read where it mattered — **but do not trust grep transcripts of this repo for exact punctuation.**

### 6.6 Line-number corrections carried forward

- `frontend/src/hooks/useRole.ts` is **12 lines long**; the roles read is at **line 6**. Earlier notes citing `:64` / `:61-70` are wrong (there is only one `useRole` file repo-wide). The *claim* — roles come from Clerk `publicMetadata`, not a query — is correct.
- `AppSidebar`'s `menuItems` array spans **`:59-102`** (not `:58-97`). Content matches.
- Home's inlined `DashboardSection` block runs **`:257-276`**, with the explanatory comment at **`:251-256`** (not `:250-270`).





