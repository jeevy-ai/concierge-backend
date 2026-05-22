/**
 * Stripe reporting helpers for the weekly board metrics report (YOU-323).
 *
 * Uses the same raw-fetch pattern as stripe-client.ts — no stripe-node SDK
 * (CF Workers incompatible).
 */

const STRIPE_API = "https://api.stripe.com/v1";

function stripeHeaders(secretKey: string): HeadersInit {
  return {
    Authorization: `Bearer ${secretKey}`,
    "Content-Type": "application/x-www-form-urlencoded",
  };
}

async function stripeGet<T>(secretKey: string, path: string): Promise<T> {
  const res = await fetch(`${STRIPE_API}${path}`, {
    headers: stripeHeaders(secretKey),
  });
  const json = (await res.json()) as { error?: { message?: string } } & T;
  if (!res.ok) {
    throw new Error(json.error?.message ?? `Stripe API error ${res.status} on ${path}`);
  }
  return json;
}

interface StripePrice {
  id: string;
  unit_amount: number | null;
  currency: string;
  recurring: { interval: "day" | "week" | "month" | "year"; interval_count: number } | null;
}

interface StripeSubscriptionItem {
  quantity: number;
  price: StripePrice;
}

interface StripeSubscription {
  id: string;
  status: string;
  current_period_end: number;
  items: { data: StripeSubscriptionItem[] };
}

interface StripeList<T> {
  object: "list";
  data: T[];
  has_more: boolean;
  url: string;
}

/** Convert a subscription item to its monthly contribution in cents. */
function toMonthlyCents(item: StripeSubscriptionItem): number {
  const price = item.price;
  if (!price.unit_amount || !price.recurring) return 0;
  const { interval, interval_count } = price.recurring;
  const rawCents = price.unit_amount * (item.quantity ?? 1);

  switch (interval) {
    case "day":
      return Math.round((rawCents * 30) / interval_count);
    case "week":
      return Math.round((rawCents * 4.33) / interval_count);
    case "month":
      return Math.round(rawCents / interval_count);
    case "year":
      return Math.round(rawCents / (12 * interval_count));
    default:
      return 0;
  }
}

export interface StripeBillingMetrics {
  paidUsers: number;
  mrrCents: number;
  churnedThisWeek: number;
}

/** Fetch active subscription count, MRR (cents), and cancellations in past 7 days. */
export async function fetchBillingMetrics(secretKey: string): Promise<StripeBillingMetrics> {
  const sevenDaysAgo = Math.floor((Date.now() - 7 * 24 * 60 * 60 * 1000) / 1000);

  const [activeSubs, cancelledSubs] = await Promise.all([
    stripeGet<StripeList<StripeSubscription>>(
      secretKey,
      "/subscriptions?status=active&limit=100&expand[]=data.items.data.price",
    ),
    stripeGet<StripeList<StripeSubscription>>(
      secretKey,
      `/subscriptions?status=canceled&limit=100&canceled_at[gte]=${sevenDaysAgo}`,
    ),
  ]);

  const paidUsers = activeSubs.data.length;
  const mrrCents = activeSubs.data.reduce((sum, sub) => {
    const subMrr = sub.items.data.reduce((s, item) => s + toMonthlyCents(item), 0);
    return sum + subMrr;
  }, 0);

  return {
    paidUsers,
    mrrCents,
    churnedThisWeek: cancelledSubs.data.length,
  };
}
