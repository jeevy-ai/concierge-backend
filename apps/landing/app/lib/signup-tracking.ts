import { AnalyticsEventName } from "@jeevy/contracts";
import { trackEvent } from "./analytics";

/**
 * Track signup_started event on signup page load.
 * Captures source (utm_source) and plan_intent from URL or state.
 */
export function trackSignupStarted(options?: {
  source?: string | null;
  planIntent?: string | null;
}): void {
  const source = options?.source ?? getUrlParam("utm_source");
  const planIntent = options?.planIntent ?? getUrlParam("plan_intent");

  trackEvent(AnalyticsEventName.SIGNUP_STARTED, {
    source: source ?? undefined,
    plan_intent: planIntent ?? undefined,
  });
}

/**
 * Track signup_submitted event on form submit.
 * Captures method (email, google, github) and plan_intent.
 */
export function trackSignupSubmitted(
  method: "email" | "google" | "github",
  options?: {
    planIntent?: string | null;
  },
): void {
  const planIntent = options?.planIntent ?? getUrlParam("plan_intent");

  trackEvent(AnalyticsEventName.SIGNUP_SUBMITTED, {
    method,
    plan_intent: planIntent ?? undefined,
  });
}

/**
 * Track signup_failed event on submission error.
 * Captures method and reason code.
 */
export function trackSignupFailed(
  method: "email" | "google" | "github",
  reasonCode: string,
): void {
  trackEvent(AnalyticsEventName.SIGNUP_FAILED, {
    method,
    reason_code: reasonCode,
  });
}

/**
 * Helper to extract URL search parameters.
 */
function getUrlParam(name: string): string | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  return params.get(name);
}
