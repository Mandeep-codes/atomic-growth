#!/usr/bin/env bash
# Atomik Clips — wire demo mode into the client the app ACTUALLY uses.
# Run from frontend/:   bash fix-trpc-provider.sh
set -euo pipefail

if [ ! -f package.json ] || [ ! -d src/components ]; then
  echo "ERROR: run this from the frontend/ directory (the one with package.json)."
  exit 1
fi

echo "=== BEFORE ==="
echo -n "TrpcProvider uses demoLink? : "
grep -q "demoLink" src/components/TrpcProvider.tsx 2>/dev/null && echo YES || echo "NO  <-- the real cause"
echo

cp src/components/TrpcProvider.tsx "src/components/TrpcProvider.tsx.bak"
echo "writing src/components/TrpcProvider.tsx"
cat > src/components/TrpcProvider.tsx << 'ATOMIK_EOF'
import { ReactNode, useCallback, useMemo, useRef } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@clerk/clerk-react";
import { httpLink } from "@trpc/client";
import superjson from "superjson";
import { env } from "@/lib/env";
import { DEMO_MODE, demoLink } from "@/lib/demo/demoLink";

interface TrpcProviderProps {
  children: ReactNode;
}

export const TrpcProvider = ({ children }: TrpcProviderProps) => {
  const { getToken, signOut } = useAuth();
  const isSigningOutRef = useRef(false);
  const queryClient = useMemo(() => new QueryClient(), []);

  const forceLogout = useCallback(async () => {
    if (isSigningOutRef.current) return;
    isSigningOutRef.current = true;

    try {
      await signOut();
    } catch (error) {
      console.error(
        "Failed to sign out after token verification failure",
        error
      );
    } finally {
      window.location.href = "/auth";
    }
  }, [signOut]);

  const handleUnauthorizedResponse = useCallback(
    async (response: Response) => {
      try {
        const contentType = response.headers.get("content-type") ?? "";

        if (!contentType.includes("application/json")) {
          return;
        }

        const body = await response.json();
        const errorMessages = extractErrorMessages(body);

        // Force-logout ONLY when a token was presented and judged bad —
        // an expired or tampered session. "No authorization token provided"
        // is deliberately NOT matched: that's an anonymous request (e.g. a
        // client on the public /campaign/:id password screen whose page
        // fired a staff-only query) — signing them "out" just hijacks a
        // public page into the login screen. Anonymous 401s are the calling
        // component's problem; route protection stays with ProtectedRoute.
        const hasTokenError = errorMessages.some((message) =>
          /token verification failed|invalid token/i.test(message)
        );

        if (hasTokenError) {
          await forceLogout();
        }
      } catch (error) {
        console.error("Failed to inspect unauthorized response", error);
      }
    },
    [forceLogout]
  );

  // Create tRPC client with authentication
  const trpcClient = useMemo(
    () =>
      trpc.createClient({
        // THIS is the client the app actually uses. lib/trpc.ts also exports
        // a `trpcClient` and a `useAuthenticatedTrpcClient`, but nothing
        // renders them — <TrpcProvider> builds its own here and hands it to
        // trpc.Provider. Patching lib/trpc.ts alone therefore changes nothing
        // at runtime, which is exactly how demo mode appeared to be "on"
        // (banner showing) while every query still hit the live backend.
        //
        // demoLink is terminating: it never calls next(), so in demo mode the
        // httpLink below is unreachable and no request leaves the browser.
        links: [
          ...(DEMO_MODE ? [demoLink()] : []),
          httpLink({
            url: env.VITE_TRPC_URL,
            async fetch(url, options) {
              const token = await getToken();

              const response = await fetch(url, {
                ...options,
                headers: {
                  ...options?.headers,
                  ...(token && { Authorization: `Bearer ${token}` }),
                },
                credentials: "include",
              });

              if (response.status === 401) {
                void handleUnauthorizedResponse(response.clone());
              }

              return response;
            },
          }),
        ],
        transformer: superjson,
      }),
    [getToken, handleUnauthorizedResponse]
  );

  return (
    <QueryClientProvider client={queryClient}>
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        {children}
      </trpc.Provider>
    </QueryClientProvider>
  );
};

function extractErrorMessages(body: unknown): string[] {
  if (!body) return [];

  if (Array.isArray(body)) {
    return body.flatMap((entry) => extractErrorMessages(entry));
  }

  if (typeof body === "object") {
    const maybeError = (body as { error?: unknown }).error;
    if (maybeError && typeof maybeError === "object") {
      const message = (maybeError as { json?: { message?: string } }).json
        ?.message;
      const dataMessage = (maybeError as { data?: { message?: unknown } }).data
        ?.message;

      return [message, dataMessage]
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean);
    }
  }

  return [];
}
ATOMIK_EOF

echo
echo "=== AFTER ==="
grep -q "demoLink" src/components/TrpcProvider.tsx && echo "OK    TrpcProvider routes through demoLink" || echo "FAIL  demoLink missing"
grep -q "DEMO_MODE" src/components/TrpcProvider.tsx && echo "OK    DEMO_MODE imported" || echo "FAIL  DEMO_MODE missing"
echo
echo "Vite should hot-reload. If nothing changes, hard-reload with Cmd+Shift+R."
echo
echo "Confirm it worked:"
echo "  - campaigns read Airwallex / Nyne / Parloa / Slash"
echo "  - 'Welcome back' says Shreyas Patel, not Local Dev"
echo "  - clips submitted shows 4, not 61"
