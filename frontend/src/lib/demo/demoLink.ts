import { TRPCClientError, type TRPCLink } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import type { AppRouter } from "../../../../backend/src/routers";
import { HANDLERS } from "./demoHandlers";

// FORCED ON whenever the Clerk stub is active. VITE_LOCAL_DEV=true swaps real
// auth for a stub in which every visitor is a signed-in god-mode admin - that
// build must never reach a real backend, so a stubbed build mocks every
// request regardless of VITE_DEMO.
const CLERK_STUBBED = import.meta.env.VITE_LOCAL_DEV === "true";
export const DEMO_MODE =
  CLERK_STUBBED || import.meta.env.VITE_DEMO !== "false";

if (DEMO_MODE) {
  // eslint-disable-next-line no-console
  console.info(
    "%c[demo] demo mode is ON — no tRPC request will leave the browser. " +
      "Set VITE_DEMO=false to use the real backend.",
    "color:#22c55e;font-weight:bold"
  );
}

/**
 * Every path the app asked for that has no handler. Read it in the console
 * with `__DEMO_MISSING__` — that list is exactly what needs adding to
 * demoHandlers.ts to extend coverage to another screen.
 */
const missing = new Set<string>();

declare global {
  // eslint-disable-next-line no-var
  var __DEMO_MISSING__: string[];
}

const recordMissing = (path: string) => {
  if (missing.has(path)) return;
  missing.add(path);
  globalThis.__DEMO_MISSING__ = [...missing].sort();
  // eslint-disable-next-line no-console
  console.warn(
    `[demo] no handler for "${path}" — returning null. ` +
      `Full list so far in __DEMO_MISSING__`
  );
};

/**
 * Short-circuits every tRPC call in demo mode, so no page, hook or component
 * needs to know the backend is absent.
 *
 * An unmocked path resolves to null rather than throwing. A thrown error would
 * surface as a red toast or an error boundary and break the walkthrough; null
 * lets components fall through to their own empty states, which is what the
 * ~20 unfixtured admin screens will do.
 */
export function demoLink(): TRPCLink<AppRouter> {
  return () =>
    ({ op }) =>
      observable((observer) => {
        const handler = HANDLERS[op.path];

        if (!handler) {
          recordMissing(op.path);
          observer.next({ result: { type: "data", data: null } });
          observer.complete();
          return;
        }

        let cancelled = false;
        Promise.resolve()
          .then(() => handler(op.input as any))
          .then((data) => {
            if (cancelled) return;
            observer.next({ result: { type: "data", data } });
            observer.complete();
          })
          .catch((error) => {
            if (cancelled) return;
            observer.error(TRPCClientError.from(error as Error));
          });

        return () => {
          cancelled = true;
        };
      });
}
