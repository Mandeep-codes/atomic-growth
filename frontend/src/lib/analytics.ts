import { env } from "./env";
import { getRudderstack, initializeRudderstack } from "./rudderstack";
import type { ApiObject, ApiOptions } from "@rudderstack/analytics-js";

interface TrackEventPayload {
  event: string;
  properties?: ApiObject;
  options?: ApiOptions;
}

interface PageEventPayload {
  name?: string;
  category?: string;
  properties?: ApiObject;
  options?: ApiOptions;
}

export const initializeAnalytics = () => initializeRudderstack();

export const trackEvent = ({
  event,
  properties,
  options,
}: TrackEventPayload) => {
  const client = getRudderstack();
  if (env.VITE_ENVIRONMENT === "development") {
    console.log("Tracking event:", event, properties, options);
  }
  client?.track(event, properties, options);
};

export const trackPage = ({
  name,
  category,
  properties,
  options,
}: PageEventPayload = {}) => {
  if (env.VITE_ENVIRONMENT === "development") {
    console.log("Tracking page:", name, category, properties, options);
  }

  const client = getRudderstack();
  if (!client) {
    return;
  }

  if (category && name) {
    client.page(category, name, properties, options);
    return;
  }

  if (name) {
    client.page(name, properties, options);
    return;
  }

  client.page(properties, options);
};
