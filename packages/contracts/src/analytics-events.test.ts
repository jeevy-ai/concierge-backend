import { describe, expect, it } from "vitest";
import {
  AnalyticsEventName,
  type AnalyticsEventPropsMap,
  analyticsEventSchemas,
} from "./analytics-events.js";

const allEventNames = Object.values(AnalyticsEventName) as AnalyticsEventName[];

describe("analyticsEventSchemas", () => {
  it("has a schema for every event name", () => {
    for (const name of allEventNames) {
      expect(analyticsEventSchemas).toHaveProperty(name);
    }
  });

  it("no extra schemas beyond the enum", () => {
    const schemaKeys = Object.keys(analyticsEventSchemas);
    expect(schemaKeys.sort()).toEqual(allEventNames.slice().sort());
  });
});

describe("event schema validation", () => {
  it("page_viewed — valid", () => {
    const result = analyticsEventSchemas.page_viewed.safeParse({ path: "/home" });
    expect(result.success).toBe(true);
  });

  it("page_viewed — rejects missing path", () => {
    const result = analyticsEventSchemas.page_viewed.safeParse({});
    expect(result.success).toBe(false);
  });

  it("signup_completed — valid", () => {
    const result = analyticsEventSchemas.signup_completed.safeParse({
      userId: "user_123",
      method: "email",
    });
    expect(result.success).toBe(true);
  });

  it("signup_completed — rejects invalid method", () => {
    const result = analyticsEventSchemas.signup_completed.safeParse({
      userId: "user_123",
      method: "magic_link",
    });
    expect(result.success).toBe(false);
  });

  it("checkout_completed — valid", () => {
    const result = analyticsEventSchemas.checkout_completed.safeParse({
      planId: "plan_pro",
      priceId: "price_monthly",
      stripeCustomerId: "cus_abc",
    });
    expect(result.success).toBe(true);
  });

  it("subscription_cancelled — valid", () => {
    const result = analyticsEventSchemas.subscription_cancelled.safeParse({
      planId: "plan_pro",
      stripeCustomerId: "cus_abc",
    });
    expect(result.success).toBe(true);
  });

  it("subscription_cancelled — optional reason", () => {
    const result = analyticsEventSchemas.subscription_cancelled.safeParse({
      planId: "plan_pro",
      stripeCustomerId: "cus_abc",
      reason: "too_expensive",
    });
    expect(result.success).toBe(true);
  });

  it("recap_generated — rejects negative itemCount", () => {
    const result = analyticsEventSchemas.recap_generated.safeParse({
      recapId: "r1",
      itemCount: -1,
    });
    expect(result.success).toBe(false);
  });
});

// Type-level check: AnalyticsEventPropsMap covers all event names
type _AssertAllCovered = {
  [K in AnalyticsEventName]: AnalyticsEventPropsMap[K];
};
