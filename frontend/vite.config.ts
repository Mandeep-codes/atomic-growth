import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  // Local-only: swap the real Clerk SDK for the stub in src/lib/dev-clerk.tsx.
  // The real ClerkProvider won't mount without a valid publishable key, so
  // without this the app can't run at all when we have no Clerk credentials.
  // Guarded twice — the flag must be set AND the build must not be production —
  // so a production bundle can never pick up the stub.
  const useDevClerk = env.VITE_LOCAL_DEV === "true" && mode !== "production";

  if (useDevClerk) {
    console.warn(
      "\n🔓 VITE_LOCAL_DEV=true — @clerk/clerk-react is STUBBED (src/lib/dev-clerk.tsx). Auth is bypassed. Never build for production this way.\n"
    );
  }

  return {
    server: {
      host: "::",
      port: 8080,
      // Tunnels and forwarded ports arrive with an unfamiliar Host header, which
      // Vite 5.4+ rejects with "Blocked request. This host is not allowed."
      // Dev server only — never part of a production build.
      allowedHosts: true,
      // Proxy the API through the SAME origin as the app, so only port 8080
      // needs to be exposed to show this to someone else. Without this the
      // browser would have to reach port 3000 directly, which also means a
      // second forwarded port and a CORS origin to whitelist.
      proxy: {
        "/trpc": { target: "http://localhost:3000", changeOrigin: true },
        "/auth": { target: "http://localhost:3000", changeOrigin: true },
        "/api": { target: "http://localhost:3000", changeOrigin: true },
        "/health": { target: "http://localhost:3000", changeOrigin: true },
      },
    },
    plugins: [react()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
        ...(useDevClerk
          ? {
              "@clerk/clerk-react": path.resolve(
                __dirname,
                "./src/lib/dev-clerk.tsx"
              ),
            }
          : {}),
      },
    },
  };
});
