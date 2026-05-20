export type SubscriptionStatus =
  | "active"
  | "trialing"
  | "canceled"
  | "past_due"
  | "unpaid"
  | "incomplete"
  | "incomplete_expired"
  | "paused";

export type EntitlementState =
  | { subscribed: true; plan: string; periodEnd: number }
  | { subscribed: false; reason: "no_subscription" | "canceled" | "past_due" | "unpaid" };

export type ClerkClaims = {
  sub: string;
  org_id?: string;
  org_role?: string;
  exp: number;
  iat: number;
};

export type StripeEntitlementRecord = {
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  status: SubscriptionStatus;
  plan: string;
  periodEnd: number;
  updatedAt: string;
};

/** Minimal KV interface — CF Workers KVNamespace satisfies this. */
export interface KVStore {
  get<T>(key: string, options: { type: "json" }): Promise<T | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}
