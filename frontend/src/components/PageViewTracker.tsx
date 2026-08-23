import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { trackPage } from "@/lib/analytics";
import { env } from "@/lib/env";

/**
 * Tracks page views automatically on route changes
 * Should be placed inside BrowserRouter to access location
 */
export const PageViewTracker = () => {
  const location = useLocation();

  useEffect(() => {
    trackPage({
      name: location.pathname,
      properties: {
        path: location.pathname,
        search: location.search,
        hash: location.hash,
        fullPath: location.pathname + location.search + location.hash,
        timestamp: new Date().toISOString(),
        environment: env.VITE_ENVIRONMENT,
      },
    });
  }, [location]);

  return null;
};
