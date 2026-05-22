import { createServerCapture } from "@jeevy/analytics/server";
import { AnalyticsEventName } from "@jeevy/contracts";
import {
  type StripeWebhookEvent,
  handleSubscriptionEvent,
  verifyStripeSignature,
} from "@jeevy/entitlement";
import type { Hono } from "hono";
import type { Env, Variables } from "../index.js";

type App = Hono<{ Bindings: Env; Variables: Variables }>;

type AnyStripeObject = Record<string, unknown>;

export function registerStripeWebhookRoute(app: App): void {
  app.post("/webhooks/stripe", async (c) => {
    const sigHeader = c.req.header("stripe-signature");
    if (!sigHeader) {
      return c.json({ error: "Missing Stripe-Signature header" }, 400);
    }

    const payload = await c.req.text();

    try {
      await verifyStripeSignature(payload, sigHeader, c.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      return c.json({ error: "Webhook signature verification failed" }, 400);
    }

    let event: StripeWebhookEvent;
    try {
      event = JSON.parse(payload) as StripeWebhookEvent;
    } catch {
      return c.json({ error: "Invalid JSON payload" }, 400);
    }

    await handleSubscriptionEvent(
      event,
      c.env.ENTITLEMENTS_KV as unknown as import("@jeevy/entitlement").KVStore,
    );

    // Analytics capture — fire-and-forget via waitUntil so it doesn't block response
    const capture = createServerCapture({
      apiKey: c.env.POSTHOG_API_KEY,
      host: c.env.POSTHOG_HOST,
    });
    const env = c.env.ENVIRONMENT as "production" | "staging" | "development";
    const obj = event.data.object as AnyStripeObject;

    if (event.type === "checkout.session.completed") {
      const customerId = (obj["customer"] as string | undefined) ?? "unknown";
      const analyticsCapture = capture({
        distinctId: customerId,
        event: AnalyticsEventName.CHECKOUT_COMPLETED,
        props: {
          planId: (obj["metadata"] as Record<string, string> | undefined)?.["planId"] ?? "unknown",
          priceId: (obj["metadata"] as Record<string, string> | undefined)?.["priceId"] ?? "unknown",
          stripeCustomerId: customerId,
        },
        superProps: { env, app_version: "0.1.0", surface: "billing" },
      });
      c.executionCtx.waitUntil(analyticsCapture);
    } else if (event.type === "customer.subscription.deleted") {
      const customerId = (obj["customer"] as string | undefined) ?? "unknown";
      const planId =
        (obj["items"] as { data?: Array<{ price?: { id?: string } }> } | undefined)?.data?.[0]?.price
          ?.id ?? "unknown";
      const analyticsCapture = capture({
        distinctId: customerId,
        event: AnalyticsEventName.SUBSCRIPTION_CANCELLED,
        props: {
          planId,
          stripeCustomerId: customerId,
        },
        superProps: { env, app_version: "0.1.0", surface: "billing" },
      });
      c.executionCtx.waitUntil(analyticsCapture);
    }

    return c.json({ received: true });
  });
}
