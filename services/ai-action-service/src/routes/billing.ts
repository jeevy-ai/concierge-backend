import { makeError } from "@jeevy/contracts";
import { getEntitlementRecord } from "@jeevy/entitlement";
import type { Hono } from "hono";
import { createCheckoutSession, createPortalSession } from "../lib/stripe-client.js";
import { clerkAuthMiddleware } from "../middleware/entitlement.js";
import type { Env, Variables } from "../index.js";

type App = Hono<{ Bindings: Env; Variables: Variables }>;

type CheckoutBody = { priceId?: string; successUrl?: string; cancelUrl?: string };
type PortalBody = { returnUrl?: string };

export function registerBillingRoutes(app: App): void {
  // All billing routes require Clerk auth
  const billing = app.use("/api/billing/*", clerkAuthMiddleware());

  /**
   * POST /api/billing/checkout
   * Creates a Stripe Checkout session (subscription mode, Stripe Tax enabled).
   * Caller passes priceId — price IDs are configured once pricing tiers are approved (YOU-638).
   * Sets clerkUserId on both session and subscription metadata so the webhook can map either
   * checkout.session.completed or customer.subscription.created to the user's entitlement record.
   */
  billing.post("/api/billing/checkout", async (c) => {
    const correlationId = c.req.header("x-correlation-id") ?? crypto.randomUUID();
    c.res.headers.set("x-correlation-id", correlationId);

    const body = await c.req.json<CheckoutBody>().catch(() => ({} as CheckoutBody));
    const { priceId, successUrl, cancelUrl } = body;

    if (!priceId || !successUrl || !cancelUrl) {
      return c.json(
        makeError(
          "policy/policy_violation",
          "billing/invalid_params",
          "priceId, successUrl, cancelUrl are required",
          correlationId,
        ),
        400,
      );
    }

    const clerkUserId = c.get("clerkUserId");

    try {
      const session = await createCheckoutSession({
        secretKey: c.env.STRIPE_SECRET_KEY,
        priceId,
        clerkUserId,
        successUrl,
        cancelUrl,
      });
      return c.json({ sessionId: session.id, url: session.url });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Stripe error";
      return c.json(
        makeError("internal", "billing/stripe_error", message, correlationId),
        502,
      );
    }
  });

  /**
   * POST /api/billing/portal
   * Creates a Stripe Customer Portal session for subscription management.
   * Requires an active (or recent) subscription in ENTITLEMENTS_KV to resolve stripeCustomerId.
   */
  billing.post("/api/billing/portal", async (c) => {
    const correlationId = c.req.header("x-correlation-id") ?? crypto.randomUUID();
    c.res.headers.set("x-correlation-id", correlationId);

    const body = await c.req.json<PortalBody>().catch(() => ({} as PortalBody));
    const { returnUrl } = body;

    if (!returnUrl) {
      return c.json(
        makeError(
          "policy/policy_violation",
          "billing/invalid_params",
          "returnUrl is required",
          correlationId,
        ),
        400,
      );
    }

    const clerkUserId = c.get("clerkUserId");
    const record = await getEntitlementRecord(
      c.env.ENTITLEMENTS_KV as unknown as import("@jeevy/entitlement").KVStore,
      clerkUserId,
    );

    if (!record) {
      return c.json(
        makeError(
          "auth/forbidden",
          "billing/no_subscription",
          "No subscription record found — complete checkout first",
          correlationId,
        ),
        404,
      );
    }

    try {
      const portal = await createPortalSession({
        secretKey: c.env.STRIPE_SECRET_KEY,
        stripeCustomerId: record.stripeCustomerId,
        returnUrl,
      });
      return c.json({ url: portal.url });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Stripe portal error";
      return c.json(
        makeError("internal", "billing/stripe_error", message, correlationId),
        502,
      );
    }
  });
}
