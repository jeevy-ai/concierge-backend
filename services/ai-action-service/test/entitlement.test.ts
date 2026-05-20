import { describe, expect, it, vi, beforeEach } from "vitest";
import { app } from "../src/index.js";

// Mock the entitlement package so we can control KV + JWT outcomes
vi.mock("@jeevy/entitlement", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@jeevy/entitlement")>();
  return {
    ...actual,
    verifyClerkJwt: vi.fn(),
    checkEntitlement: vi.fn(),
  };
});

import { verifyClerkJwt, checkEntitlement } from "@jeevy/entitlement";

const mockEnv = {
  ENVIRONMENT: "test",
  CLERK_JWKS_URL: "https://clerk.test/.well-known/jwks.json",
  STRIPE_WEBHOOK_SECRET: "whsec_test",
  STRIPE_SECRET_KEY: "sk_test_xxx",
  ENTITLEMENTS_KV: {},
};

function req(path: string, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost${path}`, { headers });
}

describe("GET /health (public)", () => {
  it("returns 200 with no auth", async () => {
    const res = await app.request("/health", {}, mockEnv);
    expect(res.status).toBe(200);
  });
});

describe("GET /api/protected/test (guarded)", () => {
  beforeEach(() => {
    vi.mocked(verifyClerkJwt).mockReset();
    vi.mocked(checkEntitlement).mockReset();
  });

  it("returns 401 when no Authorization header", async () => {
    const res = await app.request("/api/protected/test", {}, mockEnv);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { category: string };
    expect(body.category).toBe("auth");
  });

  it("returns 401 when Clerk token is invalid", async () => {
    vi.mocked(verifyClerkJwt).mockRejectedValue(new Error("JWT invalid"));
    const res = await app.request(
      "/api/protected/test",
      { headers: { authorization: "Bearer bad_token" } },
      mockEnv,
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("auth/invalid_token");
  });

  it("returns 402 when subscription is not active", async () => {
    vi.mocked(verifyClerkJwt).mockResolvedValue({
      sub: "user_1",
      exp: 9999999999,
      iat: 1000,
    });
    vi.mocked(checkEntitlement).mockResolvedValue({
      subscribed: false,
      reason: "no_subscription",
    });

    const res = await app.request(
      "/api/protected/test",
      { headers: { authorization: "Bearer valid_token" } },
      mockEnv,
    );
    expect(res.status).toBe(402);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("billing/unsubscribed");
  });

  it("returns 200 for paid subscriber", async () => {
    vi.mocked(verifyClerkJwt).mockResolvedValue({
      sub: "user_paid",
      exp: 9999999999,
      iat: 1000,
    });
    vi.mocked(checkEntitlement).mockResolvedValue({
      subscribed: true,
      plan: "price_pro",
      periodEnd: 9999999999,
    });

    const res = await app.request(
      "/api/protected/test",
      { headers: { authorization: "Bearer valid_token" } },
      mockEnv,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { userId: string };
    expect(body.userId).toBe("user_paid");
  });

  it("propagates X-Correlation-Id on 401", async () => {
    const res = await app.request(
      "/api/protected/test",
      { headers: { "x-correlation-id": "test-corr-123" } },
      mockEnv,
    );
    expect(res.status).toBe(401);
    expect(res.headers.get("x-correlation-id")).toBe("test-corr-123");
  });
});
