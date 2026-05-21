import { describe, expect, it } from "vitest";
import app, { type Env } from "../src/index.js";

const BASE_ENV: Env = {
  ENVIRONMENT: "test",
  AUTH_MODE: "none",
  AUTH_BEARER_TOKEN: "",
  ANTHROPIC_API_KEY: "",
  ACTION_USE_LLM: "false",
  ANTHROPIC_TIMEOUT_MS: "7000",
  ANTHROPIC_SONNET_MODEL: "claude-sonnet-4-6",
  ANTHROPIC_HAIKU_MODEL: "claude-haiku-4-5-20251001",
};

const VALID_BODY = {
  userId: "user_test_1",
  actionId: "regroup_windows",
  tabs: [{ tabId: 1, title: "Google", url: "https://google.com", domain: "google.com" }],
};

function makeAnalyticsBindings(): {
  kvStore: Map<string, string>;
  dataPoints: unknown[];
  FIRST_VALUE_KV: KVNamespace;
  CONCIERGE_ANALYTICS: AnalyticsEngineDataset;
} {
  const kvStore = new Map<string, string>();
  const dataPoints: unknown[] = [];

  const FIRST_VALUE_KV = {
    get: (key: string) => Promise.resolve(kvStore.get(key) ?? null),
    put: (key: string, value: string) => {
      kvStore.set(key, value);
      return Promise.resolve();
    },
  } as unknown as KVNamespace;

  const CONCIERGE_ANALYTICS = {
    writeDataPoint: (data: unknown) => {
      dataPoints.push(data);
    },
  } as unknown as AnalyticsEngineDataset;

  return { kvStore, dataPoints, FIRST_VALUE_KV, CONCIERGE_ANALYTICS };
}

describe("ai-action-service", () => {
  it("GET /internal/healthz returns ok", async () => {
    const res = await app.request("/internal/healthz", {}, BASE_ENV);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });
});

describe("compare_tabs input validation", () => {
  const ONE_TAB = { tabId: 1, title: "Only one tab", url: "https://example.com", domain: "example.com" };

  it("returns 400 INVALID_INPUT with exactly 1 tab", async () => {
    const res = await app.request(
      "/v1/ai/action",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "test-qa", actionId: "compare_tabs", tabs: [ONE_TAB] }),
      },
      BASE_ENV,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; message: string; retryable: boolean } };
    expect(body.error.code).toBe("INVALID_INPUT");
    expect(body.error.message).toBe("compare_tabs requires at least 2 tabs to compare.");
    expect(body.error.retryable).toBe(false);
  });

  it("returns 200 with 2 tabs", async () => {
    const TWO_TABS = [ONE_TAB, { tabId: 2, title: "Second tab", url: "https://github.com", domain: "github.com" }];
    const res = await app.request(
      "/v1/ai/action",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "test-qa", actionId: "compare_tabs", tabs: TWO_TABS }),
      },
      BASE_ENV,
    );
    expect(res.status).toBe(200);
  });
});

describe("first_value_delivered instrumentation", () => {
  it("emits data point and sets KV flag on first successful action", async () => {
    const { kvStore, dataPoints, FIRST_VALUE_KV, CONCIERGE_ANALYTICS } = makeAnalyticsBindings();
    const env: Env = { ...BASE_ENV, FIRST_VALUE_KV, CONCIERGE_ANALYTICS };

    const res = await app.request(
      "/v1/ai/action",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(VALID_BODY) },
      env,
    );

    expect(res.status).toBe(200);
    expect(dataPoints).toHaveLength(1);
    const point = dataPoints[0] as { blobs: string[]; doubles: number[]; indexes: string[] };
    expect(point.blobs[0]).toBe("user_test_1");
    expect(point.blobs[1]).toBe("regroup_windows");
    expect(typeof point.blobs[2]).toBe("string"); // source: "llm" | "deterministic"
    expect(typeof point.doubles[0]).toBe("number"); // confidence
    expect(point.indexes[0]).toBe("user_test_1");
    expect(kvStore.get("fv:user_test_1")).toBe("1");
  });

  it("does not re-emit for the same user on a subsequent successful action", async () => {
    const { dataPoints, FIRST_VALUE_KV, CONCIERGE_ANALYTICS } = makeAnalyticsBindings();
    const env: Env = { ...BASE_ENV, FIRST_VALUE_KV, CONCIERGE_ANALYTICS };

    // Second request has different tabs to bypass idempotency cache
    const body2 = { ...VALID_BODY, tabs: [{ tabId: 2, title: "GitHub", url: "https://github.com", domain: "github.com" }] };

    await app.request(
      "/v1/ai/action",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(VALID_BODY) },
      env,
    );
    await app.request(
      "/v1/ai/action",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body2) },
      env,
    );

    expect(dataPoints).toHaveLength(1); // only the first action emits
  });

  it("emits independently for distinct users", async () => {
    const { dataPoints, FIRST_VALUE_KV, CONCIERGE_ANALYTICS } = makeAnalyticsBindings();
    const env: Env = { ...BASE_ENV, FIRST_VALUE_KV, CONCIERGE_ANALYTICS };

    await app.request(
      "/v1/ai/action",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...VALID_BODY, userId: "user_a" }) },
      env,
    );
    await app.request(
      "/v1/ai/action",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...VALID_BODY, userId: "user_b" }) },
      env,
    );

    expect(dataPoints).toHaveLength(2);
    const userIds = (dataPoints as { blobs: string[] }[]).map((p) => p.blobs[0]);
    expect(userIds).toContain("user_a");
    expect(userIds).toContain("user_b");
  });

  it("skips emission gracefully when bindings are absent (dev/test without CF)", async () => {
    const res = await app.request(
      "/v1/ai/action",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(VALID_BODY) },
      BASE_ENV,
    );
    expect(res.status).toBe(200); // no error, emission silently skipped
  });

  it("does not emit when the action request is invalid (400)", async () => {
    const { dataPoints, FIRST_VALUE_KV, CONCIERGE_ANALYTICS } = makeAnalyticsBindings();
    const env: Env = { ...BASE_ENV, FIRST_VALUE_KV, CONCIERGE_ANALYTICS };

    const res = await app.request(
      "/v1/ai/action",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: "user_test_1" /* missing actionId + tabs */ }) },
      env,
    );

    expect(res.status).toBe(400);
    expect(dataPoints).toHaveLength(0);
  });
});
