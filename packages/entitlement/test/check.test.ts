import { describe, expect, it, vi } from "vitest";
import { checkEntitlement, resolveFromRecord } from "../src/check.js";
import type { KVStore, StripeEntitlementRecord } from "../src/types.js";

function makeKV(record: StripeEntitlementRecord | null = null): KVStore {
  return {
    get: vi.fn().mockResolvedValue(record),
    put: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  };
}

const FUTURE = Math.floor(Date.now() / 1000) + 86400;
const PAST = Math.floor(Date.now() / 1000) - 86400;

const BASE: StripeEntitlementRecord = {
  stripeCustomerId: "cus_test",
  stripeSubscriptionId: "sub_test",
  status: "active",
  plan: "price_pro",
  periodEnd: FUTURE,
  updatedAt: new Date().toISOString(),
};

describe("checkEntitlement", () => {
  it("returns no_subscription when KV has no record", async () => {
    const state = await checkEntitlement("user_1", makeKV(null));
    expect(state).toEqual({ subscribed: false, reason: "no_subscription" });
  });

  it("returns subscribed for active subscription", async () => {
    const state = await checkEntitlement("user_1", makeKV({ ...BASE, status: "active" }));
    expect(state).toEqual({ subscribed: true, plan: "price_pro", periodEnd: FUTURE });
  });

  it("returns subscribed for trialing subscription", async () => {
    const state = await checkEntitlement("user_1", makeKV({ ...BASE, status: "trialing" }));
    expect(state.subscribed).toBe(true);
  });
});

describe("resolveFromRecord", () => {
  it("active → subscribed", () => {
    const s = resolveFromRecord({ ...BASE, status: "active" });
    expect(s).toEqual({ subscribed: true, plan: "price_pro", periodEnd: FUTURE });
  });

  it("trialing → subscribed", () => {
    const s = resolveFromRecord({ ...BASE, status: "trialing" });
    expect(s.subscribed).toBe(true);
  });

  it("canceled but still within period → subscribed (downgrade at period end)", () => {
    const s = resolveFromRecord({ ...BASE, status: "canceled", periodEnd: FUTURE });
    expect(s).toEqual({ subscribed: true, plan: "price_pro", periodEnd: FUTURE });
  });

  it("canceled past period end → not subscribed", () => {
    const s = resolveFromRecord({ ...BASE, status: "canceled", periodEnd: PAST });
    expect(s).toEqual({ subscribed: false, reason: "canceled" });
  });

  it("past_due → not subscribed", () => {
    const s = resolveFromRecord({ ...BASE, status: "past_due" });
    expect(s).toEqual({ subscribed: false, reason: "past_due" });
  });

  it("unpaid → not subscribed", () => {
    const s = resolveFromRecord({ ...BASE, status: "unpaid" });
    expect(s).toEqual({ subscribed: false, reason: "past_due" });
  });

  it("incomplete → not subscribed (canceled fallback)", () => {
    const s = resolveFromRecord({ ...BASE, status: "incomplete" });
    expect(s).toEqual({ subscribed: false, reason: "canceled" });
  });
});
