import { RudderAnalytics } from "@rudderstack/analytics-js";

let rudderAnalytics: RudderAnalytics | undefined;

const WRITE_KEY = import.meta.env.VITE_RUDDERSTACK_WRITE_KEY;
const DATA_PLANE_URL = import.meta.env.VITE_RUDDERSTACK_DATA_PLANE_URL;

export const initializeRudderstack = () => {
  if (typeof window === "undefined") {
    return undefined;
  }

  if (rudderAnalytics) {
    return rudderAnalytics;
  }

  if (!WRITE_KEY || !DATA_PLANE_URL) {
    if (import.meta.env.DEV) {
      console.warn("Rudderstack environment variables are not configured.");
    }

    return undefined;
  }

  const analytics = new RudderAnalytics();
  analytics.load(WRITE_KEY, DATA_PLANE_URL, {
    logLevel: import.meta.env.DEV ? "DEBUG" : "ERROR",
  });

  rudderAnalytics = analytics;
  return rudderAnalytics;
};

export const getRudderstack = () => {
  if (!rudderAnalytics) {
    return initializeRudderstack();
  }

  return rudderAnalytics;
};
