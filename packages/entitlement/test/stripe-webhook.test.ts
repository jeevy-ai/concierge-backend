import { describe, expect, it, vi } from "vitest";
import {
  type StripeWebhookEvent,
  handleSubscriptionEvent,
  verifyStripeSignature,
} from "../src/stripe-webhook.js";
import type { KVStore } from "../src/types.js";

function makeKV(): KVStore & { stored: Map<string, string> } {
  const stored = new Map<string, string>();
  return {
    stored,
    get: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockImplementation(async (k: string, v: string) => {
      stored.set(k, v);
    }),
    delete: vi.fn().mockImplementation(async (k: string) => {
      stored.delete(k);
    }),
  };
}

function makeSubEvent(
  type: string,
  overrides: Partial<StripeWebhookEvent["data"]["object"]> = {},
): StripeWebhookEvent {
  return {
    id: "evt_test",
    type,
    data: {
      object: {
        id: "sub_test",
        customer: "cus_test",
        status: "active",
        items: { data: [{ price: { id: "price_pro" } }] },
        current_period_end: Math.floor(Date.now() / 1000) + 86400,
        metadata: { clerkUserId: "user_clerk_1" },
        ...overrides,
      },
    },
  };
}

async function makeValidSig(payload: string, secret: string, tsOffset = 0): Promise<string> {
  const ts = Math.floor(Date.now() / 1000) + tsOffset;
  const toSign = `${ts}.${payload}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(toSign));
  const sigHex = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `t=${ts},v1=${sigHex}`;
}

describe("verifyStripeSignature", () => {
  it("accepts a valid signature", async () => {
    const payload = JSON.stringify({ type: "test" });
    const secret = "whsec_test";
    const sigHeader = await makeValidSig(payload, secret);
    await expect(verifyStripeSignature(payload, sigHeader, secret)).resolves.toBeUndefined();
  });

  it("rejects a bad signature", async () => {
    const payload = JSON.stringify({ type: "test" });
    const secret = "whsec_test";
    const ts = Math.floor(Date.now() / 1000);
    await expect(verifyStripeSignature(payload, `t=${ts},v1=badbad`, secret)).rejects.toThrow(
      "signature mismatch",
    );
  });

  it("rejects a stale timestamp", async () => {
    const payload = JSON.stringify({ type: "test" });
    const secret = "whsec_test";
    const sigHeader = await makeValidSig(payload, secret, -400);
    await expect(verifyStripeSignature(payload, sigHeader, secret)).rejects.toThrow("too old");
  });

  it("rejects missing header fields", async () => {
    await expect(verifyStripeSignature("{}", "v1=abc", "secret")).rejects.toThrow(
      "Invalid Stripe-Signature header",
    );
  });
});

describe("handleSubscriptionEvent", () => {
  it("writes entitlement to KV on subscription.created", async () => {
    const kv = makeKV();
    await handleSubscriptionEvent(makeSubEvent("customer.subscription.created"), kv);
    expect(kv.put).toHaveBeenCalledOnce();
    const [key, value] = (kv.put as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      string,
      unknown,
    ];
    expect(key).toBe("entitlement:user_clerk_1");
    const record = JSON.parse(value) as { status: string; plan: string };
    expect(record.status).toBe("active");
    expect(record.plan).toBe("price_pro");
  });

  it("writes entitlement to KV on subscription.updated", async () => {
    const kv = makeKV();
    await handleSubscriptionEvent(makeSubEvent("customer.subscription.updated"), kv);
    expect(kv.put).toHaveBeenCalledOnce();
  });

  it("writes canceled status on subscription.deleted", async () => {
    const kv = makeKV();
    await handleSubscriptionEvent(makeSubEvent("customer.subscription.deleted"), kv);
    const [, value] = (kv.put as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      string,
      unknown,
    ];
    const record = JSON.parse(value) as { status: string };
    expect(record.status).toBe("canceled");
  });

  it("skips events with no clerkUserId in metadata", async () => {
    const kv = makeKV();
    await handleSubscriptionEvent(
      makeSubEvent("customer.subscription.created", { metadata: {} }),
      kv,
    );
    expect(kv.put).not.toHaveBeenCalled();
  });

  it("ignores unhandled event types", async () => {
    const kv = makeKV();
    await handleSubscriptionEvent(makeSubEvent("invoice.paid"), kv);
    expect(kv.put).not.toHaveBeenCalled();
  });
});
