/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CLERK_PUBLISHABLE_KEY: string;
  readonly VITE_TRPC_URL?: string;
  readonly VITE_RUDDERSTACK_WRITE_KEY?: string;
  readonly VITE_RUDDERSTACK_DATA_PLANE_URL?: string;
  readonly ENVIRONMENT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
