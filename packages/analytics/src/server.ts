// Server-side analytics capture for Cloudflare Workers.
// Decision: uses direct fetch to POST /capture/ instead of posthog-node.
// Rationale: posthog-node relies on background timers (setTimeout flush) which
// are not reliable inside Workers request lifecycles. Direct fetch is explicit,
// fire-and-forget friendly via ctx.waitUntil(), and has no runtime compatibility risk.
import type {
  AnalyticsEventName,
  AnalyticsEventPropsMap,
  AnalyticsSuperProperties,
} from "@jeevy/contracts";

const POSTHOG_EU_HOST = "https://eu.i.posthog.com";

export type ServerCaptureOptions = {
  apiKey: string;
  host?: string;
};

export type CapturePayload<K extends AnalyticsEventName = AnalyticsEventName> = {
  distinctId: string;
  event: K;
  props: AnalyticsEventPropsMap[K];
  superProps?: Partial<AnalyticsSuperProperties>;
};

export function createServerCapture(opts: ServerCaptureOptions) {
  const host = opts.host ?? POSTHOG_EU_HOST;

  return async function capture<K extends AnalyticsEventName>(
    payload: CapturePayload<K>,
  ): Promise<void> {
    const body = {
      api_key: opts.apiKey,
      event: payload.event,
      distinct_id: payload.distinctId,
      timestamp: new Date().toISOString(),
      properties: {
        ...payload.superProps,
        ...payload.props,
      },
    };

    const res = await fetch(`${host}/capture/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      console.error(`[analytics] capture failed: ${res.status} ${payload.event}`);
    }
  };
}

export type ServerCapture = ReturnType<typeof createServerCapture>;
