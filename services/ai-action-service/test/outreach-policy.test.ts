/**
 * Scenario 4 — Policy engine + outreach adapter tests (YOU-506).
 *
 * Covers:
 * - Send without approval token → 403 + ConciergeUnauthorizedExternalAction fires
 * - Send with approval token → delegates to messaging adapter (sandbox no-op)
 * - Kill-switch (POLICY_KV concierge.external_actions.enabled=false) → 403 kill_switch
 * - external_action_total KV counter increments with correct labels
 * - /internal/policy/validate dry-run endpoint
 * - /internal/metrics/policy Prometheus output
 * - Auth guard — 401 without x-internal-secret
 * - X-Correlation-Id round-trips
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../src/index.js";
import type { ConciergeKV } from "../src/lib/metrics.js";
import { getCounter } from "../src/lib/metrics.js";
import { KILL_SWITCH_KV_KEY } from "../src/lib/policy-engine.js";

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

const SECRET = "test-internal-secret";

function makeEnv(policyKv?: ConciergeKV, conciergeKv?: ConciergeKV) {
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
    POLICY_KV: policyKv ?? makeKV(),
    CONCIERGE_KV: conciergeKv ?? makeKV(),
  };
}

const SEND_URL = "/api/internal/outreach/send";
const VALIDATE_URL = "/internal/policy/validate";
const METRICS_URL = "/internal/metrics/policy";

const BASE_SEND_BODY = {
  actionClass: "outreach_send" as const,
  channel: "email" as const,
  to: ["user@example.com"],
  subject: "Test subject",
  body: "Hello from test",
};

// Stub fetch so Resend calls don't escape to the network
function stubResendOk() {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "msg_test_001" }),
    }),
  );
}

// --- Tests ---

describe("Scenario 4 — send without approval token", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 403 when approvalToken absent", async () => {
    const env = makeEnv();
    const res = await app.request(
      SEND_URL,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-internal-secret": SECRET },
        body: JSON.stringify(BASE_SEND_BODY),
      },
      env,
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("policy/unauthorized_external_action");
  });

  it("returns 403 when approvalToken is empty string", async () => {
    const env = makeEnv();
    const res = await app.request(
      SEND_URL,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-internal-secret": SECRET },
        body: JSON.stringify({ ...BASE_SEND_BODY, approvalToken: "   " }),
      },
      env,
    );
    expect(res.status).toBe(403);
  });

  it("external_action_total KV counter increments with approval_attached=false, outcome=rejected_no_token", async () => {
    const conciergeKv = makeKV();
    const env = makeEnv(undefined, conciergeKv);
    await app.request(
      SEND_URL,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-internal-secret": SECRET },
        body: JSON.stringify(BASE_SEND_BODY),
      },
      env,
    );
    const count = await getCounter(conciergeKv, "external_action_total", {
      approval_attached: "false",
      action_class: "outreach_send",
      outcome: "rejected_no_token",
    });
    expect(count).toBe(1);
  });
});

describe("Scenario 4 — send with approval token", () => {
  beforeEach(() => {
    stubResendOk();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 200 and messageIds when approvalToken present", async () => {
    const env = makeEnv();
    const res = await app.request(
      SEND_URL,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-internal-secret": SECRET },
        body: JSON.stringify({ ...BASE_SEND_BODY, approvalToken: "tok_approved_001" }),
      },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; messageIds: string[] };
    expect(body.ok).toBe(true);
    expect(body.messageIds).toEqual(["msg_test_001"]);
  });

  it("external_action_total KV counter increments with approval_attached=true, outcome=allowed", async () => {
    const conciergeKv = makeKV();
    const env = makeEnv(undefined, conciergeKv);
    await app.request(
      SEND_URL,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-internal-secret": SECRET },
        body: JSON.stringify({ ...BASE_SEND_BODY, approvalToken: "tok_approved_001" }),
      },
      env,
    );
    const count = await getCounter(conciergeKv, "external_action_total", {
      approval_attached: "true",
      action_class: "outreach_send",
      outcome: "allowed",
    });
    expect(count).toBe(1);
  });
});

describe("Scenario 4 — kill-switch blocks send", () => {
  it("returns 403 kill_switch when POLICY_KV key is 'false'", async () => {
    const policyKv = makeKV();
    await policyKv.put(KILL_SWITCH_KV_KEY, "false");
    const env = makeEnv(policyKv);
    const res = await app.request(
      SEND_URL,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-internal-secret": SECRET },
        body: JSON.stringify({ ...BASE_SEND_BODY, approvalToken: "tok_approved_001" }),
      },
      env,
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { message: string };
    expect(body.message).toContain("kill-switch");
  });

  it("external_action_total increments with outcome=rejected_kill_switch", async () => {
    const policyKv = makeKV();
    const conciergeKv = makeKV();
    await policyKv.put(KILL_SWITCH_KV_KEY, "false");
    const env = makeEnv(policyKv, conciergeKv);
    await app.request(
      SEND_URL,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-internal-secret": SECRET },
        body: JSON.stringify({ ...BASE_SEND_BODY, approvalToken: "tok_approved_001" }),
      },
      env,
    );
    const count = await getCounter(conciergeKv, "external_action_total", {
      approval_attached: "true",
      action_class: "outreach_send",
      outcome: "rejected_kill_switch",
    });
    expect(count).toBe(1);
  });

  it("kill-switch re-enabled allows send", async () => {
    stubResendOk();
    const policyKv = makeKV();
    // Key absent → enabled by default
    const env = makeEnv(policyKv);
    const res = await app.request(
      SEND_URL,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-internal-secret": SECRET },
        body: JSON.stringify({ ...BASE_SEND_BODY, approvalToken: "tok_approved_001" }),
      },
      env,
    );
    expect(res.status).toBe(200);
    vi.restoreAllMocks();
  });
});

describe("policy validate endpoint (dry-run)", () => {
  it("returns allowed=true when approvalToken present and kill-switch on", async () => {
    const env = makeEnv();
    const res = await app.request(
      VALIDATE_URL,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-internal-secret": SECRET },
        body: JSON.stringify({ actionClass: "outreach_send", approvalToken: "tok_xyz", correlationId: "cid-01" }),
      },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { decision: { allowed: boolean } };
    expect(body.decision.allowed).toBe(true);
  });

  it("returns allowed=false when approvalToken absent", async () => {
    const env = makeEnv();
    const res = await app.request(
      VALIDATE_URL,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-internal-secret": SECRET },
        body: JSON.stringify({ actionClass: "outreach_send", correlationId: "cid-02" }),
      },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { decision: { allowed: boolean; reason: string } };
    expect(body.decision.allowed).toBe(false);
    expect(body.decision.reason).toBe("no_approval_token");
  });

  it("returns allowed=false with reason=kill_switch_disabled when flag is off", async () => {
    const policyKv = makeKV();
    await policyKv.put(KILL_SWITCH_KV_KEY, "false");
    const env = makeEnv(policyKv);
    const res = await app.request(
      VALIDATE_URL,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-internal-secret": SECRET },
        body: JSON.stringify({ actionClass: "outreach_send", approvalToken: "tok_xyz", correlationId: "cid-03" }),
      },
      env,
    );
    const body = (await res.json()) as { decision: { allowed: boolean; reason: string } };
    expect(body.decision.allowed).toBe(false);
    expect(body.decision.reason).toBe("kill_switch_disabled");
  });

  it("returns 401 without x-internal-secret", async () => {
    const env = makeEnv();
    const res = await app.request(
      VALIDATE_URL,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ actionClass: "outreach_send", correlationId: "cid-04" }),
      },
      env,
    );
    expect(res.status).toBe(401);
  });
});

describe("metrics endpoint", () => {
  it("GET /internal/metrics/policy returns Prometheus text with external_action_total", async () => {
    const conciergeKv = makeKV();
    const policyKv = makeKV();
    const env = makeEnv(policyKv, conciergeKv);

    // Cause a rejection to populate counters
    await app.request(
      SEND_URL,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-internal-secret": SECRET },
        body: JSON.stringify(BASE_SEND_BODY), // no approval token
      },
      env,
    );

    const res = await app.request(
      METRICS_URL,
      { headers: { "x-internal-secret": SECRET } },
      env,
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("external_action_total");
    expect(text).toContain('approval_attached="false"');
    expect(text).toContain('outcome="rejected_no_token"');
    expect(text).toContain("ConciergeUnauthorizedExternalAction");
  });

  it("returns 401 without x-internal-secret", async () => {
    const env = makeEnv();
    const res = await app.request(METRICS_URL, {}, env);
    expect(res.status).toBe(401);
  });
});

describe("auth guards and validation", () => {
  it("POST /api/internal/outreach/send returns 401 without secret", async () => {
    const env = makeEnv();
    const res = await app.request(
      SEND_URL,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(BASE_SEND_BODY),
      },
      env,
    );
    expect(res.status).toBe(401);
  });

  it("returns 400 on invalid JSON body", async () => {
    const env = makeEnv();
    const res = await app.request(
      SEND_URL,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-internal-secret": SECRET },
        body: "not-json",
      },
      env,
    );
    expect(res.status).toBe(400);
  });

  it("X-Correlation-Id round-trips from request to response", async () => {
    const env = makeEnv();
    const res = await app.request(
      SEND_URL,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-internal-secret": SECRET,
          "x-correlation-id": "corr-roundtrip-01",
        },
        body: JSON.stringify(BASE_SEND_BODY),
      },
      env,
    );
    expect(res.headers.get("x-correlation-id")).toBe("corr-roundtrip-01");
  });
});
