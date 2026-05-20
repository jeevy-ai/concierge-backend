import { describe, expect, it } from "vitest";
import { app } from "../src/index.js";

const INTERNAL_SECRET = "test-secret";
const POLICY_KV_ENABLED: Record<string, string> = {};
const POLICY_KV_DISABLED: Record<string, string> = { "concierge.external_actions.enabled": "false" };

function makeKV(store: Record<string, string>) {
  return {
    async get(k: string) { return store[k] ?? null; },
    async put(k: string, v: string) { store[k] = v; },
    async delete(k: string) { delete store[k]; },
    async list() { return { keys: [] }; },
  };
}

function makeEnv(kvStore: Record<string, string>) {
  return {
    INTERNAL_API_SECRET: INTERNAL_SECRET,
    POLICY_KV: makeKV(kvStore),
    CONCIERGE_KV: makeKV({}),
    RESEND_API_KEY: "re_test",
    FROM_EMAIL: "test@example.com",
    POSTHOG_API_KEY: "",
    POSTHOG_HOST: "",
  };
}

const BASE_BODY = {
  actionClass: "outreach_send",
  channel: "email",
  to: ["recipient@example.com"],
  subject: "Hello",
  body: "Test outreach",
};

describe("POST /api/internal/outreach/send", () => {
  it("returns 401 when internal secret is missing", async () => {
    const res = await app.request(
      "/api/internal/outreach/send",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(BASE_BODY),
      },
      makeEnv(POLICY_KV_ENABLED),
    );
    expect(res.status).toBe(401);
    const json = (await res.json()) as { category: string };
    expect(json.category).toBe("auth");
  });

  it("returns 403 policy/policy_violation when approval token missing", async () => {
    const res = await app.request(
      "/api/internal/outreach/send",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-secret": INTERNAL_SECRET,
        },
        body: JSON.stringify({ ...BASE_BODY }),
      },
      makeEnv(POLICY_KV_ENABLED),
    );
    expect(res.status).toBe(403);
    const json = (await res.json()) as { category: string; code: string };
    expect(json.category).toBe("policy/policy_violation");
    expect(json.code).toBe("policy/unauthorized_external_action");
  });

  it("returns 403 policy/policy_violation when kill-switch is disabled", async () => {
    const res = await app.request(
      "/api/internal/outreach/send",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-secret": INTERNAL_SECRET,
        },
        body: JSON.stringify({ ...BASE_BODY, approvalToken: "valid-token" }),
      },
      makeEnv(POLICY_KV_DISABLED),
    );
    expect(res.status).toBe(403);
    const json = (await res.json()) as { category: string; code: string; message: string };
    expect(json.category).toBe("policy/policy_violation");
    expect(json.message).toContain("kill-switch");
  });

  it("sets X-Correlation-Id on rejection response", async () => {
    const res = await app.request(
      "/api/internal/outreach/send",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-secret": INTERNAL_SECRET,
          "x-correlation-id": "req-corr-123",
        },
        body: JSON.stringify({ ...BASE_BODY }),
      },
      makeEnv(POLICY_KV_ENABLED),
    );
    expect(res.headers.get("x-correlation-id")).toBe("req-corr-123");
  });

  it("mints a new correlation id when none provided", async () => {
    const res = await app.request(
      "/api/internal/outreach/send",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-secret": INTERNAL_SECRET,
        },
        body: JSON.stringify({ ...BASE_BODY }),
      },
      makeEnv(POLICY_KV_ENABLED),
    );
    const corrId = res.headers.get("x-correlation-id");
    expect(corrId).toBeTruthy();
    expect(typeof corrId).toBe("string");
  });
});
