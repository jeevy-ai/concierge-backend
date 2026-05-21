"use client";

import { useEffect } from "react";
import { initAnalytics, consentGranted } from "@jeevy/analytics/web";

const POSTHOG_API_KEY = process.env.NEXT_PUBLIC_POSTHOG_API_KEY || "";
const ENV = (process.env.NEXT_PUBLIC_ENV || "development") as
  | "production"
  | "staging"
  | "development";
// Feature flag: analytics.landing.enabled (default true)
// Can be disabled via NEXT_PUBLIC_ANALYTICS_LANDING_ENABLED=false
const ANALYTICS_ENABLED = process.env.NEXT_PUBLIC_ANALYTICS_LANDING_ENABLED !== "false";

function isEULocation(): boolean {
  if (typeof window === "undefined") return false;
  // TODO: check CloudFlare geo headers for actual EU detection
  return true;
}

function getUTMParams(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const params = new URLSearchParams(window.location.search);
  const utms: Record<string, string> = {};
  const utmKeys = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];
  utmKeys.forEach((key) => {
    const val = params.get(key);
    if (val) utms[key] = val;
  });
  return utms;
}

export function AnalyticsBootstrap() {
  useEffect(() => {
    if (!ANALYTICS_ENABLED || !POSTHOG_API_KEY) return;

    const isEU = isEULocation();

    // Initialize analytics (deferred if EU due to consent requirement)
    initAnalytics({
      apiKey: POSTHOG_API_KEY,
      superProps: {
        env: ENV,
        app_version: "0.1.0",
        surface: "landing",
      },
      requireConsent: isEU,
    });

    // Persist UTMs as PostHog properties via posthog.register()
    // These will be persisted on the user's distinct_id
    const utms = getUTMParams();
    if (Object.keys(utms).length > 0) {
      // Wait for PostHog to load and then register UTM properties
      setTimeout(() => {
        if ((window as unknown as Record<string, unknown>).posthog) {
          const posthog = (window as unknown as Record<string, unknown>).posthog as {
            register: (props: Record<string, string>) => void;
          };
          posthog.register(utms);
        }
      }, 100);
    }

    // For EU traffic, grant consent automatically for testing
    // TODO: integrate with real consent UI
    if (isEU) {
      consentGranted();
    }
  }, []);

  return null;
}
