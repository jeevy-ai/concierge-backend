/**
 * Activation analytics tests — YOU-307 (W3.3).
 *
 * Covers:
 * - trackFirstActionAttempted fires once per user, deduplicates on repeat
 * - trackValueDelivered fires first_value_delivered on count=1
 * - trackValueDelivered fires nth_value_delivered at count=3, deduplicated
 * - latency_ms is non-negative
 * - Events not emitted for non-milestone completions (count=2)
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConciergeKV } from "../src/lib/metrics.js";
import { trackFirstActionAttempted, trackValueDelivered } from "../src/lib/activation-analytics.js";
import { AnalyticsEventName } from "@jeevy/contracts";

function makeKV(): ConciergeKV & { _store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    _store: store,
    async get(key: string): Promise<string | null> {
      return store.get(key) ?? null;
    },
    async put(key: string, value: string): Promise<void> {
      store.set(key, value);
    },
  };
}

function makeCapture() {
  const calls: Array<{ distinctId: string; event: string; props: Record<string, unknown> }> = [];
  const capture = vi.fn(async (payload: { distinctId: string; event: string; props: Record<string, unknown> }) => {
    calls.push(payload);
  });
  return { capture, calls };
}

describe("trackFirstActionAttempted", () => {
  let kv: ReturnType<typeof makeKV>;
  let cap: ReturnType<typeof makeCapture>;

  beforeEach(() => {
    kv = makeKV();
    cap = makeCapture();
  });

  it("fires activation_first_action_attempted on first call", async () => {
    await trackFirstActionAttempted(kv, cap.capture, {
      userId: "user_1",
      actionType: "calendar",
      sessionId: "sess_1",
      correlationId: "corr_1",
    });

    expect(cap.calls).toHaveLength(1);
    expect(cap.calls[0].event).toBe(AnalyticsEventName.ACTIVATION_FIRST_ACTION_ATTEMPTED);
    expect(cap.calls[0].distinctId).toBe("user_1");
    expect(cap.calls[0].props).toMatchObject({
      action_type: "calendar",
      session_id: "sess_1",
      correlation_id: "corr_1",
    });
  });

  it("deduplicates — does not fire on second call for same user", async () => {
    await trackFirstActionAttempted(kv, cap.capture, {
      userId: "user_1",
      actionType: "calendar",
      sessionId: "sess_1",
      correlationId: "corr_1",
    });
    await trackFirstActionAttempted(kv, cap.capture, {
      userId: "user_1",
      actionType: "calendar",
      sessionId: "sess_2",
      correlationId: "corr_2",
    });

    expect(cap.calls).toHaveLength(1);
  });

  it("fires independently per user", async () => {
    await trackFirstActionAttempted(kv, cap.capture, {
      userId: "user_1",
      actionType: "calendar",
      sessionId: "sess_1",
      correlationId: "corr_1",
    });
    await trackFirstActionAttempted(kv, cap.capture, {
      userId: "user_2",
      actionType: "calendar",
      sessionId: "sess_2",
      correlationId: "corr_2",
    });

    expect(cap.calls).toHaveLength(2);
    expect(cap.calls[0].distinctId).toBe("user_1");
    expect(cap.calls[1].distinctId).toBe("user_2");
  });
});

describe("trackValueDelivered", () => {
  let kv: ReturnType<typeof makeKV>;
  let cap: ReturnType<typeof makeCapture>;
  const BASE_PARAMS = {
    userId: "user_1",
    actionType: "calendar" as const,
    sessionId: "sess_1",
    correlationId: "corr_1",
    createdAt: new Date(Date.now() - 5000).toISOString(),
  };

  beforeEach(() => {
    kv = makeKV();
    cap = makeCapture();
  });

  it("fires activation_first_value_delivered on count=1", async () => {
    await trackValueDelivered(kv, cap.capture, BASE_PARAMS);

    const firstEvent = cap.calls.find(c => c.event === AnalyticsEventName.ACTIVATION_FIRST_VALUE_DELIVERED);
    expect(firstEvent).toBeDefined();
    expect(firstEvent!.distinctId).toBe("user_1");
    expect(firstEvent!.props.action_type).toBe("calendar");
    expect(typeof firstEvent!.props.latency_ms).toBe("number");
    expect(firstEvent!.props.latency_ms as number).toBeGreaterThanOrEqual(0);
  });

  it("does not fire first_value_delivered on count=2", async () => {
    await trackValueDelivered(kv, cap.capture, { ...BASE_PARAMS, sessionId: "sess_1" });
    cap.calls.length = 0;

    await trackValueDelivered(kv, cap.capture, { ...BASE_PARAMS, sessionId: "sess_2" });

    const firstEvent = cap.calls.find(c => c.event === AnalyticsEventName.ACTIVATION_FIRST_VALUE_DELIVERED);
    expect(firstEvent).toBeUndefined();
  });

  it("fires nth_value_delivered at count=3", async () => {
    for (let i = 1; i <= 3; i++) {
      await trackValueDelivered(kv, cap.capture, { ...BASE_PARAMS, sessionId: `sess_${i}` });
    }

    const nthEvent = cap.calls.find(c => c.event === AnalyticsEventName.ACTIVATION_NTH_VALUE_DELIVERED);
    expect(nthEvent).toBeDefined();
    expect(nthEvent!.props.count).toBe(3);
    expect(nthEvent!.props.action_type).toBe("calendar");
  });

  it("deduplicates nth_value_delivered — does not fire again if count reaches 3 twice (impossible in practice but guarded)", async () => {
    // Simulate already-fired nth flag
    await kv.put("activation:user_1:nth_fired:3", "1");
    // Manually set completion count to 2 so next call hits 3
    await kv.put("activation:user_1:completion_count", "2");

    await trackValueDelivered(kv, cap.capture, BASE_PARAMS);

    const nthEvents = cap.calls.filter(c => c.event === AnalyticsEventName.ACTIVATION_NTH_VALUE_DELIVERED);
    expect(nthEvents).toHaveLength(0);
  });

  it("does not fire nth_value_delivered at count=2 or count=4", async () => {
    for (let i = 1; i <= 4; i++) {
      cap.calls.length = 0;
      await trackValueDelivered(kv, cap.capture, { ...BASE_PARAMS, sessionId: `sess_${i}` });
      if (i === 2 || i === 4) {
        const nthEvent = cap.calls.find(c => c.event === AnalyticsEventName.ACTIVATION_NTH_VALUE_DELIVERED);
        expect(nthEvent).toBeUndefined();
      }
    }
  });

  it("returns the new completion count", async () => {
    const count1 = await trackValueDelivered(kv, cap.capture, { ...BASE_PARAMS, sessionId: "s1" });
    const count2 = await trackValueDelivered(kv, cap.capture, { ...BASE_PARAMS, sessionId: "s2" });
    const count3 = await trackValueDelivered(kv, cap.capture, { ...BASE_PARAMS, sessionId: "s3" });

    expect(count1).toBe(1);
    expect(count2).toBe(2);
    expect(count3).toBe(3);
  });

  it("latency_ms is non-negative even for very recent sessions", async () => {
    const result = await trackValueDelivered(kv, cap.capture, {
      ...BASE_PARAMS,
      createdAt: new Date().toISOString(),
    });
    const event = cap.calls.find(c => c.event === AnalyticsEventName.ACTIVATION_FIRST_VALUE_DELIVERED);
    expect(event).toBeDefined();
    expect(event!.props.latency_ms as number).toBeGreaterThanOrEqual(0);
    expect(result).toBe(1);
  });
});
