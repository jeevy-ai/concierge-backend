import { beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../src/index.js";

vi.mock("@jeevy/entitlement", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@jeevy/entitlement")>();
  return {
    ...actual,
    verifyClerkJwt: vi.fn(),
    checkEntitlement: vi.fn(),
    getEntitlementRecord: vi.fn(),
  };
});

vi.mock("../src/lib/stripe-client.js", () => ({
  createCheckoutSession: vi.fn(),
  createPortalSession: vi.fn(),
}));

import { getEntitlementRecord, verifyClerkJwt } from "@jeevy/entitlement";
import { createCheckoutSession, createPortalSession } from "../src/lib/stripe-client.js";

const mockEnv = {
  ENVIRONMENT: "test",
  CLERK_JWKS_URL: "https://clerk.test/.well-known/jwks.json",
  STRIPE_WEBHOOK_SECRET: "whsec_test",
  STRIPE_SECRET_KEY: "sk_test_xxx",
  ENTITLEMENTS_KV: {},
  POSTHOG_API_KEY: "phc_test",
  POSTHOG_HOST: "https://eu.i.posthog.com",
};

const validClaims = { sub: "user_1", exp: 9999999999, iat: 1000 };

function post(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("POST /api/billing/checkout", () => {
  beforeEach(() => {
    vi.mocked(verifyClerkJwt).mockReset();
    vi.mocked(createCheckoutSession).mockReset();
  });

  it("returns 401 without auth token", async () => {
    const res = await app.request("/api/billing/checkout", { method: "POST" }, mockEnv);
    expect(res.status).toBe(401);
  });

  it("returns 400 when priceId is missing", async () => {
    vi.mocked(verifyClerkJwt).mockResolvedValue(validClaims);
    const res = await app.request(
      post("/api/billing/checkout", { successUrl: "https://app/success", cancelUrl: "https://app/cancel" }, {
        authorization: "Bearer tok",
      }),
      {},
      mockEnv,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("billing/invalid_params");
  });

  it("returns 400 when successUrl is missing", async () => {
    vi.mocked(verifyClerkJwt).mockResolvedValue(validClaims);
    const res = await app.request(
      post("/api/billing/checkout", { priceId: "price_abc", cancelUrl: "https://app/cancel" }, {
        authorization: "Bearer tok",
      }),
      {},
      mockEnv,
    );
    expect(res.status).toBe(400);
  });

  it("returns 200 with sessionId and url on success", async () => {
    vi.mocked(verifyClerkJwt).mockResolvedValue(validClaims);
    vi.mocked(createCheckoutSession).mockResolvedValue({
      id: "cs_test_abc",
      url: "https://checkout.stripe.com/pay/cs_test_abc",
      customer: null,
      subscription: null,
    });

    const res = await app.request(
      post(
        "/api/billing/checkout",
        { priceId: "price_pro", successUrl: "https://app/success", cancelUrl: "https://app/cancel" },
        { authorization: "Bearer tok" },
      ),
      {},
      mockEnv,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sessionId: string; url: string };
    expect(body.sessionId).toBe("cs_test_abc");
    expect(body.url).toBe("https://checkout.stripe.com/pay/cs_test_abc");
  });

  it("passes clerkUserId to createCheckoutSession", async () => {
    vi.mocked(verifyClerkJwt).mockResolvedValue({ sub: "user_stripe_test", exp: 9999999999, iat: 1000 });
    vi.mocked(createCheckoutSession).mockResolvedValue({
      id: "cs_test_xyz",
      url: "https://checkout.stripe.com/pay/cs_test_xyz",
      customer: null,
      subscription: null,
    });

    await app.request(
      post(
        "/api/billing/checkout",
        { priceId: "price_starter", successUrl: "https://app/ok", cancelUrl: "https://app/no" },
        { authorization: "Bearer tok" },
      ),
      {},
      mockEnv,
    );

    expect(vi.mocked(createCheckoutSession)).toHaveBeenCalledWith(
      expect.objectContaining({ clerkUserId: "user_stripe_test", priceId: "price_starter" }),
    );
  });

  it("returns 502 when Stripe throws", async () => {
    vi.mocked(verifyClerkJwt).mockResolvedValue(validClaims);
    vi.mocked(createCheckoutSession).mockRejectedValue(new Error("No such price"));

    const res = await app.request(
      post(
        "/api/billing/checkout",
        { priceId: "price_bad", successUrl: "https://app/ok", cancelUrl: "https://app/no" },
        { authorization: "Bearer tok" },
      ),
      {},
      mockEnv,
    );
    expect(res.status).toBe(502);
    const body = (await res.json()) as { code: string; message: string };
    expect(body.code).toBe("billing/stripe_error");
    expect(body.message).toBe("No such price");
  });

  it("emits X-Correlation-Id on success", async () => {
    vi.mocked(verifyClerkJwt).mockResolvedValue(validClaims);
    vi.mocked(createCheckoutSession).mockResolvedValue({
      id: "cs_corr",
      url: "https://checkout.stripe.com/pay/cs_corr",
      customer: null,
      subscription: null,
    });

    const res = await app.request(
      post(
        "/api/billing/checkout",
        { priceId: "price_pro", successUrl: "https://app/ok", cancelUrl: "https://app/no" },
        { authorization: "Bearer tok", "x-correlation-id": "corr-billing-1" },
      ),
      {},
      mockEnv,
    );
    expect(res.headers.get("x-correlation-id")).toBe("corr-billing-1");
  });
});

describe("POST /api/billing/portal", () => {
  beforeEach(() => {
    vi.mocked(verifyClerkJwt).mockReset();
    vi.mocked(getEntitlementRecord).mockReset();
    vi.mocked(createPortalSession).mockReset();
  });

  it("returns 401 without auth token", async () => {
    const res = await app.request("/api/billing/portal", { method: "POST" }, mockEnv);
    expect(res.status).toBe(401);
  });

  it("returns 400 when returnUrl is missing", async () => {
    vi.mocked(verifyClerkJwt).mockResolvedValue(validClaims);
    const res = await app.request(
      post("/api/billing/portal", {}, { authorization: "Bearer tok" }),
      {},
      mockEnv,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("billing/invalid_params");
  });

  it("returns 404 when user has no subscription record", async () => {
    vi.mocked(verifyClerkJwt).mockResolvedValue(validClaims);
    vi.mocked(getEntitlementRecord).mockResolvedValue(null);

    const res = await app.request(
      post("/api/billing/portal", { returnUrl: "https://app" }, { authorization: "Bearer tok" }),
      {},
      mockEnv,
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("billing/no_subscription");
  });

  it("returns 200 with portal url on success", async () => {
    vi.mocked(verifyClerkJwt).mockResolvedValue(validClaims);
    vi.mocked(getEntitlementRecord).mockResolvedValue({
      stripeCustomerId: "cus_test_123",
      stripeSubscriptionId: "sub_test_abc",
      status: "active",
      plan: "price_pro",
      periodEnd: 9999999999,
      updatedAt: new Date().toISOString(),
    });
    vi.mocked(createPortalSession).mockResolvedValue({
      id: "bps_test",
      url: "https://billing.stripe.com/p/session/bps_test",
    });

    const res = await app.request(
      post("/api/billing/portal", { returnUrl: "https://app/settings" }, { authorization: "Bearer tok" }),
      {},
      mockEnv,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string };
    expect(body.url).toBe("https://billing.stripe.com/p/session/bps_test");
  });

  it("passes stripeCustomerId to createPortalSession", async () => {
    vi.mocked(verifyClerkJwt).mockResolvedValue(validClaims);
    vi.mocked(getEntitlementRecord).mockResolvedValue({
      stripeCustomerId: "cus_portal_check",
      stripeSubscriptionId: "sub_p",
      status: "active",
      plan: "price_starter",
      periodEnd: 9999999999,
      updatedAt: new Date().toISOString(),
    });
    vi.mocked(createPortalSession).mockResolvedValue({ id: "bps_x", url: "https://billing.stripe.com/p/session/bps_x" });

    await app.request(
      post("/api/billing/portal", { returnUrl: "https://app" }, { authorization: "Bearer tok" }),
      {},
      mockEnv,
    );

    expect(vi.mocked(createPortalSession)).toHaveBeenCalledWith(
      expect.objectContaining({ stripeCustomerId: "cus_portal_check" }),
    );
  });

  it("returns 502 when Stripe portal throws", async () => {
    vi.mocked(verifyClerkJwt).mockResolvedValue(validClaims);
    vi.mocked(getEntitlementRecord).mockResolvedValue({
      stripeCustomerId: "cus_bad",
      stripeSubscriptionId: "sub_bad",
      status: "active",
      plan: "price_pro",
      periodEnd: 9999999999,
      updatedAt: new Date().toISOString(),
    });
    vi.mocked(createPortalSession).mockRejectedValue(new Error("No such customer"));

    const res = await app.request(
      post("/api/billing/portal", { returnUrl: "https://app" }, { authorization: "Bearer tok" }),
      {},
      mockEnv,
    );
    expect(res.status).toBe(502);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("billing/stripe_error");
  });

  it("emits X-Correlation-Id on 404", async () => {
    vi.mocked(verifyClerkJwt).mockResolvedValue(validClaims);
    vi.mocked(getEntitlementRecord).mockResolvedValue(null);

    const res = await app.request(
      post(
        "/api/billing/portal",
        { returnUrl: "https://app" },
        { authorization: "Bearer tok", "x-correlation-id": "corr-portal-1" },
      ),
      {},
      mockEnv,
    );
    expect(res.headers.get("x-correlation-id")).toBe("corr-portal-1");
  });
});
