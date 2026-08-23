import { createTRPCReact } from "@trpc/react-query";
import { httpLink } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "../../../backend/src/routers";
import { useAuth } from "@clerk/clerk-react";
import { env } from "./env";
import { DEMO_MODE, demoLink } from "./demo/demoLink";

export const trpc = createTRPCReact<AppRouter>();

// In demo mode demoLink is terminating — it never calls next(), so the http
// link below it is never reached and no request leaves the browser. Outside
// demo mode the array is just the http link, exactly as before.
const linksFor = (http: ReturnType<typeof httpLink>) =>
  DEMO_MODE ? [demoLink(), http] : [http];

export const trpcClient = trpc.createClient({
  links: linksFor(
    httpLink({
      url: env.VITE_TRPC_URL,
      fetch(url, options) {
        return fetch(url, {
          ...options,
          credentials: "include",
        });
      },
    })
  ),
  transformer: superjson,
});

// Hook to create tRPC client with Clerk authentication
export const useAuthenticatedTrpcClient = () => {
  const { getToken } = useAuth();

  return trpc.createClient({
    links: linksFor(
      httpLink({
        url: env.VITE_TRPC_URL,
        async fetch(url, options) {
          const token = await getToken();

          return fetch(url, {
            ...options,
            headers: {
              ...options?.headers,
              ...(token && { Authorization: `Bearer ${token}` }),
            },
            credentials: "include",
          });
        },
      })
    ),
    transformer: superjson,
  });
};
