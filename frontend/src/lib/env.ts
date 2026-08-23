import { z } from "zod";

// When VITE_LOCAL_DEV=true, vite.config.ts aliases @clerk/clerk-react to the
// stub in lib/dev-clerk.tsx, so no publishable key is needed (or used). The
// key stays REQUIRED in every other mode — a real build must not start up
// missing its auth config.
const isLocalDev = import.meta.env.VITE_LOCAL_DEV === "true";

const envSchema = z.object({
  VITE_CLERK_PUBLISHABLE_KEY: isLocalDev
    ? z.string().optional().default("pk_local_dev_stubbed")
    : z.string().min(1, "VITE_CLERK_PUBLISHABLE_KEY is required"),
  VITE_TRPC_URL: z
    .string()
    .url()
    .optional()
    .default("http://localhost:3000/trpc"),
  VITE_RUDDERSTACK_WRITE_KEY: z.string().min(1).optional(),
  VITE_RUDDERSTACK_DATA_PLANE_URL: z.string().url().optional(),
  VITE_ENVIRONMENT: z
    .enum(["development", "production"])
    .optional()
    .default("development"),
});

// When VITE_TRPC_URL isn't set explicitly, derive it from whatever host the
// page is actually being served from. Hardcoding localhost:3000 breaks the
// moment anyone else opens the app — over a LAN IP, a tunnel, or a forwarded
// port, "localhost" means THEIR machine, so every request fails and the UI
// renders empty. Deriving it keeps a single forwarded port working everywhere.
// Stays an absolute URL, so the `new URL(...).origin` call sites still work.
const defaultTrpcUrl =
  typeof window !== "undefined"
    ? `${window.location.origin}/trpc`
    : "http://localhost:3000/trpc";

const env = envSchema.parse({
  VITE_CLERK_PUBLISHABLE_KEY: import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
  VITE_TRPC_URL: import.meta.env.VITE_TRPC_URL || defaultTrpcUrl,
  VITE_RUDDERSTACK_WRITE_KEY: import.meta.env.VITE_RUDDERSTACK_WRITE_KEY,
  VITE_RUDDERSTACK_DATA_PLANE_URL: import.meta.env
    .VITE_RUDDERSTACK_DATA_PLANE_URL,
  VITE_ENVIRONMENT: import.meta.env.VITE_ENVIRONMENT,
});

type Env = typeof env;

export { env, type Env };
