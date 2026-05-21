import { checkEntitlement, getEntitlementRecord } from "@jeevy/entitlement";
import type { KVStore } from "@jeevy/entitlement";
import type { ActionDeliveredEvent, EventEmitter } from "./ttfv-events.js";
import type { CRMLiteWriter } from "./crm-lite-ttfv.js";
import type { ConciergeKV } from "./metrics.js";

// Wrapper to make ConciergeKV compatible with KVStore
function wrapKV(kv: ConciergeKV): KVStore {
  return {
    get: async (key: string, options?: any) => {
      const raw = await kv.get(key);
      if (!raw) return null;
      if (options?.type === "json") {
        return JSON.parse(raw);
      }
      return raw;
    },
    put: async (key: string, value: string, options?: { expirationTtl?: number }) =>
      kv.put(key, value, options),
    delete: async () => {},
  };
}

export async function handleActionDelivered(params: {
  userId: string;
  actionType: "calendar.event_created" | "message.sent" | "recap.delivered" | "agenda.updated" | "travel.itinerary_sent";
  correlationId: string;
  triggeredBy: string;
  intakeSubmittedAt: string;
  userEmail: string;
  successCriterionId?: string | undefined;
  metadata?: { plan?: string | undefined; source_flow?: string | undefined } | undefined;
  isTest?: boolean | undefined;
  kv: ConciergeKV;
  emitter: EventEmitter;
  crmWriter?: CRMLiteWriter | undefined;
}): Promise<void> {
  const deliveredAt = new Date().toISOString();

  // Check entitlement — exclude free-trial users
  const entitlementRecord = await getEntitlementRecord(wrapKV(params.kv), params.userId);

  // Only emit for paid users (non-trial) — skip if not subscribed or on trial
  if (!entitlementRecord || entitlementRecord.status !== "active") {
    return;
  }

  const event: ActionDeliveredEvent = {
    user_id: params.userId,
    action_type: params.actionType,
    correlation_id: params.correlationId,
    delivered_at: deliveredAt,
    triggered_by: params.triggeredBy,
    success: true,
    is_test: params.isTest ?? false,
    success_criterion_id: params.successCriterionId,
    metadata: params.metadata,
  };

  // Emit event
  await params.emitter.emit(event);

  // Write to CRM-lite (first-write-wins)
  if (params.crmWriter) {
    try {
      await params.crmWriter.writeTTFV({
        email: params.userEmail,
        deliveredAt,
        intakeSubmittedAt: params.intakeSubmittedAt,
      });
    } catch (err) {
      // Log but don't fail the action — CRM-lite write is non-blocking
      console.error("Failed to write TTFV to CRM-lite:", err);
    }
  }
}
