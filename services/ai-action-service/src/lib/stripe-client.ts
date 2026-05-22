/**
 * Raw Stripe API helpers — no stripe-node SDK (CF Workers incompatible).
 * Uses fetch + URLSearchParams for form-encoded Stripe API requests.
 */

export interface StripeCheckoutSession {
  id: string;
  url: string;
  customer: string | null;
  subscription: string | null;
}

export interface StripePortalSession {
  id: string;
  url: string;
}

const STRIPE_API = "https://api.stripe.com/v1";

function stripeHeaders(secretKey: string): HeadersInit {
  return {
    Authorization: `Bearer ${secretKey}`,
    "Content-Type": "application/x-www-form-urlencoded",
  };
}

async function stripePost<T>(secretKey: string, path: string, params: URLSearchParams): Promise<T> {
  const res = await fetch(`${STRIPE_API}${path}`, {
    method: "POST",
    headers: stripeHeaders(secretKey),
    body: params.toString(),
  });

  const json = (await res.json()) as { error?: { message?: string } } & T;
  if (!res.ok) {
    throw new Error(json.error?.message ?? `Stripe API error ${res.status}`);
  }
  return json;
}

export async function createCheckoutSession({
  secretKey,
  priceId,
  clerkUserId,
  customerEmail,
  successUrl,
  cancelUrl,
}: {
  secretKey: string;
  priceId: string;
  clerkUserId: string;
  customerEmail?: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<StripeCheckoutSession> {
  const params = new URLSearchParams({
    mode: "subscription",
    "line_items[0][price]": priceId,
    "line_items[0][quantity]": "1",
    "automatic_tax[enabled]": "true",
    success_url: successUrl,
    cancel_url: cancelUrl,
    // clerkUserId on both session and subscription metadata so the webhook handler
    // can map either checkout.session.completed or customer.subscription.created to a user
    "metadata[clerkUserId]": clerkUserId,
    "metadata[priceId]": priceId,
    "subscription_data[metadata][clerkUserId]": clerkUserId,
  });
  if (customerEmail) params.set("customer_email", customerEmail);

  return stripePost<StripeCheckoutSession>(secretKey, "/checkout/sessions", params);
}

export async function createPortalSession({
  secretKey,
  stripeCustomerId,
  returnUrl,
}: {
  secretKey: string;
  stripeCustomerId: string;
  returnUrl: string;
}): Promise<StripePortalSession> {
  const params = new URLSearchParams({
    customer: stripeCustomerId,
    return_url: returnUrl,
  });
  return stripePost<StripePortalSession>(secretKey, "/billing_portal/sessions", params);
}
