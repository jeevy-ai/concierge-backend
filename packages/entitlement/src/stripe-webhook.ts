import { setEntitlementRecord } from "./kv.js";
import type { KVStore, StripeEntitlementRecord, SubscriptionStatus } from "./types.js";

type StripeSubObject = {
  id: string;
  customer: string;
  status: string;
  items?: { data?: Array<{ price?: { id?: string } }> };
  current_period_end: number;
  metadata?: Record<string, string>;
};

export type StripeWebhookEvent = {
  id: string;
  type: string;
  data: { object: StripeSubObject };
};

const HANDLED_EVENTS = new Set([
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
]);

/**
 * Verifies a Stripe webhook signature using HMAC-SHA256 via Web Crypto.
 * Throws if the signature is invalid or the timestamp is stale (>300s).
 */
export async function verifyStripeSignature(
  payload: string,
  sigHeader: string,
  secret: string,
): Promise<void> {
  const parts = Object.fromEntries(
    sigHeader.split(",").map((p) => {
      const eq = p.indexOf("=");
      return [p.slice(0, eq), p.slice(eq + 1)];
    }),
  );
  const timestamp = parts.t;
  const sig = parts.v1;

  if (!timestamp || !sig) throw new Error("Invalid Stripe-Signature header");

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number.parseInt(timestamp, 10)) > 300) {
    throw new Error("Webhook timestamp too old");
  }

  const toSign = `${timestamp}.${payload}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const computed = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(toSign));
  const computedHex = Array.from(new Uint8Array(computed))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  if (computedHex !== sig) throw new Error("Stripe signature mismatch");
}

/**
 * Processes a Stripe subscription event and syncs entitlement state to KV.
 * The subscription's metadata must contain `clerkUserId` to map to a user.
 */
export async function handleSubscriptionEvent(
  event: StripeWebhookEvent,
  kv: KVStore,
): Promise<void> {
  if (!HANDLED_EVENTS.has(event.type)) return;

  const sub = event.data.object;
  const clerkUserId = sub.metadata?.clerkUserId;
  if (!clerkUserId) return;

  const plan = sub.items?.data?.[0]?.price?.id ?? "unknown";
  const status: SubscriptionStatus =
    event.type === "customer.subscription.deleted" ? "canceled" : (sub.status as SubscriptionStatus);
  const record: StripeEntitlementRecord = {
    stripeCustomerId: sub.customer,
    stripeSubscriptionId: sub.id,
    status,
    plan,
    periodEnd: sub.current_period_end,
    updatedAt: new Date().toISOString(),
  };

  await setEntitlementRecord(kv, clerkUserId, record);
}
