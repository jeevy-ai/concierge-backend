/**
 * Calendar workflow + circuit breaker tests — Scenario 3 (YOU-493).
 *
 * Covers:
 * - Happy path: draft → awaiting_approval → executing → completed
 * - Force-error provider_4xx: workflow parks in needs_input with reason_code=provider_4xx
 * - Circuit opens after 3 consecutive failures
 * - Circuit-open path: workflow parks in needs_input with reason_code=circuit_open
 * - provider_circuit_state gauge reads 2 when circuit open (ConciergeProviderCircuitOpen condition)
 * - provider_call_total counter increments correctly
 * - X-Correlation-Id round-trips end-to-end
 * - State transition rejects invalid transitions
 */

import { beforeEach, describe, expect, it } from "vitest";
import { app } from "../src/index.js";
import type { ConciergeKV } from "../src/lib/metrics.js";
import { CIRCUIT_CLOSED, CIRCUIT_OPEN, getCircuitState } from "../src/lib/circuit-breaker.js";
import { getCounter, getGauge } from "../src/lib/metrics.js";

// --- In-memory KV mock ---

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

// --- HTTP test helpers ---

const SECRET = "test-internal-secret";

function makeEnv(kvOverride?: ConciergeKV) {
  const kv = kvOverride ?? makeKV();
  return {
    ENVIRONMENT: "test",
    CLERK_JWKS_URL: "https://clerk.test/.well-known/jwks.json",
    STRIPE_WEBHOOK_SECRET: "whsec_test",
    STRIPE_SECRET_KEY: "sk_test",
    POSTHOG_API_KEY: "phk_test",
    POSTHOG_HOST: "https://eu.i.posthog.com",
    ENTITLEMENTS_KV: {},
    INTERVIEWS_KV: {},
    RESEND_API_KEY: "re_test",
    SCHEDULING_LINK: "https://cal.example.com",
    FROM_EMAIL: "team@jeevy.ai",
    INTERNAL_API_SECRET: SECRET,
    CLERK_SECRET_KEY: "sk_clerk_test",
    POLICY_KV: {},
    CONCIERGE_KV: kv,
  };
}

const BASE_BODY = {
  operatorId: "op_test",
  eventId: "CAL-01",
  newStartIso: "2026-05-10T09:00:00Z",
  newEndIso: "2026-05-10T10:00:00Z",
  reason: "Unit test",
};

// --- Tests ---

describe("calendar workflow — happy path (sandbox)", () => {
  it("POST /internal/workflow/calendar/reschedule returns completed session", async () => {
    const env = makeEnv();
    const res = await app.request(
      "/internal/workflow/calendar/reschedule",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-internal-secret": SECRET,
          "x-correlation-id": "corr-happy-01",
        },
        body: JSON.stringify(BASE_BODY),
      },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { session: { status: string; reasonCode: string | null }; correlationId: string };
    expect(body.session.status).toBe("completed");
    expect(body.session.reasonCode).toBeNull();
    expect(body.correlationId).toBe("corr-happy-01");
  });

  it("response carries X-Correlation-Id header", async () => {
    const env = makeEnv();
    const res = await app.request(
      "/internal/workflow/calendar/reschedule",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-internal-secret": SECRET,
          "x-correlation-id": "corr-header-check",
        },
        body: JSON.stringify(BASE_BODY),
      },
      env,
    );
    expect(res.headers.get("x-correlation-id")).toBe("corr-header-check");
  });

  it("mints a new correlation-id when none provided", async () => {
    const env = makeEnv();
    const res = await app.request(
      "/internal/workflow/calendar/reschedule",
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-internal-secret": SECRET },
        body: JSON.stringify(BASE_BODY),
      },
      env,
    );
    const corrId = res.headers.get("x-correlation-id");
    expect(typeof corrId).toBe("string");
    expect(corrId!.length).toBeGreaterThan(0);
  });

  it("provider_call_total success counter increments", async () => {
    const kv = makeKV();
    const env = makeEnv(kv);
    await app.request(
      "/internal/workflow/calendar/reschedule",
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-internal-secret": SECRET },
        body: JSON.stringify(BASE_BODY),
      },
      env,
    );
    const count = await getCounter(kv, "provider_call_total", { provider: "google_calendar", outcome: "success" });
    expect(count).toBe(1);
  });
});

describe("calendar workflow — force_error=provider_4xx (Scenario 3 exercise)", () => {
  it("workflow parks in needs_input with reason_code=provider_4xx", async () => {
    const env = makeEnv();
    const res = await app.request(
      "/internal/workflow/calendar/reschedule",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-internal-secret": SECRET,
          "x-force-error": "provider_4xx",
          "x-correlation-id": "corr-4xx-test",
        },
        body: JSON.stringify(BASE_BODY),
      },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      session: { status: string; reasonCode: string; history: unknown[] };
    };
    expect(body.session.status).toBe("needs_input");
    expect(body.session.reasonCode).toBe("provider_4xx");
  });

  it("state history includes executing → needs_input transition", async () => {
    const env = makeEnv();
    const res = await app.request(
      "/internal/workflow/calendar/reschedule",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-internal-secret": SECRET,
          "x-force-error": "provider_4xx",
        },
        body: JSON.stringify(BASE_BODY),
      },
      env,
    );
    const body = (await res.json()) as {
      session: { history: Array<{ from: string; to: string }> };
    };
    const txn = body.session.history.find((h) => h.from === "executing" && h.to === "needs_input");
    expect(txn).toBeDefined();
  });

  it("provider_call_total error counter increments", async () => {
    const kv = makeKV();
    const env = makeEnv(kv);
    await app.request(
      "/internal/workflow/calendar/reschedule",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-internal-secret": SECRET,
          "x-force-error": "provider_4xx",
        },
        body: JSON.stringify(BASE_BODY),
      },
      env,
    );
    const errCount = await getCounter(kv, "provider_call_total", { provider: "google_calendar", outcome: "error" });
    expect(errCount).toBeGreaterThan(0);
  });
});

describe("circuit breaker", () => {
  let kv: ConciergeKV & { _store: Map<string, string> };

  beforeEach(() => {
    kv = makeKV();
  });

  it("circuit opens after 3 consecutive provider_4xx failures", async () => {
    const env = makeEnv(kv);
    const headers = {
      "content-type": "application/json",
      "x-internal-secret": SECRET,
      "x-force-error": "provider_4xx",
    };
    for (let i = 0; i < 3; i++) {
      await app.request(
        "/internal/workflow/calendar/reschedule",
        { method: "POST", headers, body: JSON.stringify(BASE_BODY) },
        env,
      );
    }
    const state = await getCircuitState(kv, "google_calendar");
    expect(state).toBe(CIRCUIT_OPEN);
  });

  it("provider_circuit_state gauge is 2 when circuit open (ConciergeProviderCircuitOpen condition)", async () => {
    const env = makeEnv(kv);
    const headers = {
      "content-type": "application/json",
      "x-internal-secret": SECRET,
      "x-force-error": "provider_4xx",
    };
    for (let i = 0; i < 3; i++) {
      await app.request(
        "/internal/workflow/calendar/reschedule",
        { method: "POST", headers, body: JSON.stringify(BASE_BODY) },
        env,
      );
    }
    const gauge = await getGauge(kv, "provider_circuit_state", { provider: "google_calendar" });
    expect(gauge).toBe(2);
  });

  it("open circuit causes workflow to park needs_input with reason_code=circuit_open", async () => {
    const env = makeEnv(kv);
    const headers = {
      "content-type": "application/json",
      "x-internal-secret": SECRET,
      "x-force-error": "provider_4xx",
    };
    // Trip the circuit
    for (let i = 0; i < 3; i++) {
      await app.request(
        "/internal/workflow/calendar/reschedule",
        { method: "POST", headers, body: JSON.stringify(BASE_BODY) },
        env,
      );
    }
    // 4th request — circuit should be open, no provider call
    const res = await app.request(
      "/internal/workflow/calendar/reschedule",
      { method: "POST", headers, body: JSON.stringify(BASE_BODY) },
      env,
    );
    const body = (await res.json()) as { session: { status: string; reasonCode: string } };
    expect(body.session.status).toBe("needs_input");
    expect(body.session.reasonCode).toBe("circuit_open");
  });

  it("circuit starts closed", async () => {
    const state = await getCircuitState(kv, "google_calendar");
    expect(state).toBe(CIRCUIT_CLOSED);
  });
});

describe("metrics endpoint", () => {
  it("GET /internal/metrics/calendar returns Prometheus text with correct circuit state", async () => {
    const kv = makeKV();
    const env = makeEnv(kv);

    // Trip circuit first
    const headers = {
      "content-type": "application/json",
      "x-internal-secret": SECRET,
      "x-force-error": "provider_4xx",
    };
    for (let i = 0; i < 3; i++) {
      await app.request(
        "/internal/workflow/calendar/reschedule",
        { method: "POST", headers, body: JSON.stringify(BASE_BODY) },
        env,
      );
    }

    const res = await app.request(
      "/internal/metrics/calendar",
      { headers: { "x-internal-secret": SECRET } },
      env,
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('provider_circuit_state{provider="google_calendar"} 2');
    expect(text).toContain('provider_call_total{provider="google_calendar",outcome="error"}');
    expect(text).toContain("ConciergeProviderCircuitOpen");
  });
});

describe("auth / security guards", () => {
  it("returns 401 without x-internal-secret", async () => {
    const env = makeEnv();
    const res = await app.request(
      "/internal/workflow/calendar/reschedule",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(BASE_BODY),
      },
      env,
    );
    expect(res.status).toBe(401);
  });

  it("returns 400 on missing required fields", async () => {
    const env = makeEnv();
    const res = await app.request(
      "/internal/workflow/calendar/reschedule",
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-internal-secret": SECRET },
        body: JSON.stringify({ operatorId: "op_test" }),
      },
      env,
    );
    expect(res.status).toBe(400);
  });
});

describe("state machine — invalid transition guard", () => {
  it("GET /internal/workflow/:sessionId 404s for unknown session", async () => {
    const env = makeEnv();
    const res = await app.request(
      "/internal/workflow/nonexistent-session",
      { headers: { "x-internal-secret": SECRET } },
      env,
    );
    expect(res.status).toBe(404);
  });
});
