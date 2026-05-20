// Web SDK wrapper around posthog-js.
// Rules:
//  - autocapture: false always (manual tracking only)
//  - EU region: host = https://eu.i.posthog.com
//  - Consent gate: init() is deferred until consentGranted() is called on EU traffic
//  - In dev, track() validates props against Zod schema and logs on mismatch
import posthog from "posthog-js";
import {
  AnalyticsEventName,
  analyticsEventSchemas,
  type AnalyticsEventPropsMap,
  type AnalyticsSuperProperties,
} from "@jeevy/contracts";

const POSTHOG_EU_HOST = "https://eu.i.posthog.com";

export type WebAnalyticsConfig = {
  apiKey: string;
  host?: string;
  superProps: AnalyticsSuperProperties;
  /** Set true when this session is EU-origin and consent must be deferred */
  requireConsent?: boolean;
};

let _consentGranted = false;
let _pendingConfig: WebAnalyticsConfig | null = null;

function _init(config: WebAnalyticsConfig) {
  posthog.init(config.apiKey, {
    api_host: config.host ?? POSTHOG_EU_HOST,
    autocapture: false,
    capture_pageview: false,
    capture_pageleave: false,
    persistence: "localStorage+cookie",
  });
  posthog.register(config.superProps);
}

export function initAnalytics(config: WebAnalyticsConfig): void {
  if (config.requireConsent && !_consentGranted) {
    _pendingConfig = config;
    return;
  }
  _init(config);
}

export function consentGranted(): void {
  _consentGranted = true;
  if (_pendingConfig) {
    _init(_pendingConfig);
    _pendingConfig = null;
  }
}

export function track<K extends AnalyticsEventName>(
  event: K,
  props: AnalyticsEventPropsMap[K],
): void {
  if (!posthog.__loaded) {
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const isDev = (globalThis as any).__ANALYTICS_DEV__ === true;
  if (isDev) {
    const schema = analyticsEventSchemas[event];
    const result = schema.safeParse(props);
    if (!result.success) {
      console.error(`[analytics] schema mismatch for "${event}":`, result.error.issues);
      throw new Error(`[analytics] schema mismatch for event "${event}"`);
    }
  }

  posthog.capture(event, props as Record<string, unknown>);
}

export function identify(userId: string, traits?: Record<string, unknown>): void {
  if (!posthog.__loaded) {
    return;
  }
  posthog.identify(userId, traits);
}

export function reset(): void {
  if (posthog.__loaded) {
    posthog.reset();
  }
}

export { AnalyticsEventName };
