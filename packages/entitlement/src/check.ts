import { getEntitlementRecord } from "./kv.js";
import type { EntitlementState, KVStore, StripeEntitlementRecord } from "./types.js";

export async function checkEntitlement(
  clerkUserId: string,
  kv: KVStore,
): Promise<EntitlementState> {
  const record = await getEntitlementRecord(kv, clerkUserId);
  if (!record) {
    return { subscribed: false, reason: "no_subscription" };
  }
  return resolveFromRecord(record);
}

export function resolveFromRecord(record: StripeEntitlementRecord): EntitlementState {
  const now = Math.floor(Date.now() / 1000);

  if (record.status === "active" || record.status === "trialing") {
    return { subscribed: true, plan: record.plan, periodEnd: record.periodEnd };
  }

  // Canceled but still within current period — downgrade takes effect at periodEnd
  if (record.status === "canceled" && record.periodEnd > now) {
    return { subscribed: true, plan: record.plan, periodEnd: record.periodEnd };
  }

  if (record.status === "past_due" || record.status === "unpaid") {
    return { subscribed: false, reason: "past_due" };
  }

  return { subscribed: false, reason: "canceled" };
}
