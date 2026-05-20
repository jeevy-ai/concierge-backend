import type { KVStore, StripeEntitlementRecord } from "./types.js";

export const KV_TTL_SECONDS = 3600;

export function entitlementKey(clerkUserId: string): string {
  return `entitlement:${clerkUserId}`;
}

export async function getEntitlementRecord(
  kv: KVStore,
  clerkUserId: string,
): Promise<StripeEntitlementRecord | null> {
  return kv.get<StripeEntitlementRecord>(entitlementKey(clerkUserId), { type: "json" });
}

export async function setEntitlementRecord(
  kv: KVStore,
  clerkUserId: string,
  record: StripeEntitlementRecord,
): Promise<void> {
  await kv.put(entitlementKey(clerkUserId), JSON.stringify(record), {
    expirationTtl: KV_TTL_SECONDS,
  });
}

export async function deleteEntitlementRecord(kv: KVStore, clerkUserId: string): Promise<void> {
  await kv.delete(entitlementKey(clerkUserId));
}
