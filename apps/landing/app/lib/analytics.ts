import type { AnalyticsEventName, AnalyticsEventPropsMap } from "@jeevy/contracts";

type Props = Record<string, unknown>;

declare global {
  interface Window {
    __jeevy?: { track: (event: string, props: Props) => void };
  }
}

export function track(event: string, props: Props = {}): void {
  try {
    window.__jeevy?.track(event, props);
  } catch (_) {
    // vendor not loaded — silent
  }
}

export function trackEvent<K extends AnalyticsEventName>(
  event: K,
  props: AnalyticsEventPropsMap[K],
): void {
  track(event, props as Props);
}

export function trackPageView(): void {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  track("landing_page_viewed", {
    utm_source: params.get("utm_source"),
    utm_medium: params.get("utm_medium"),
    utm_campaign: params.get("utm_campaign"),
    referrer: document.referrer,
    path: window.location.pathname,
  });
}

export function observeSection(
  selector: string,
  event: string,
  props: Props = {},
  threshold = 0.5,
): void {
  if (typeof window === "undefined") return;
  const el = document.querySelector(selector);
  if (!el) return;
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          track(event, props);
          observer.disconnect();
        }
      }
    },
    { threshold },
  );
  observer.observe(el);
}
