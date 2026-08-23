import { StrictMode, ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { ClerkProvider } from "@clerk/clerk-react";
import { dark } from "@clerk/themes";
import { ThemeProvider, useTheme } from "./hooks/useTheme";
import { initializeAnalytics } from "./lib/analytics";
import { env } from "./lib/env";

initializeAnalytics();

export function ThemedClerkProvider({ children }: { children: ReactNode }) {
  const { theme } = useTheme();
  return (
    <ClerkProvider
      publishableKey={env.VITE_CLERK_PUBLISHABLE_KEY}
      afterSignOutUrl="/"
      appearance={{
        baseTheme: theme === "dark" ? dark : undefined,
      }}
    >
      {children}
    </ClerkProvider>
  );
}

// Ensure your index.html contains a <div id="root"></div> element for React to mount the app.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* The redesign IS the dark surface — black page, #111 cards, white CTA.
        Light stays available from the toggle as a monochrome inverse. */}
    <ThemeProvider defaultTheme="dark" storageKey="atomik-clips-theme">
      <ThemedClerkProvider>
        <App />
      </ThemedClerkProvider>
    </ThemeProvider>
  </StrictMode>
);
