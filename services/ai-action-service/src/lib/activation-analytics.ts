/**
 * Activation event tracking for YOU-307 (W3.3).
 *
 * Three server-side events emitted to PostHog via createServerCapture:
 *   activation_first_action_attempted — once per user, on first workflow creation
 *   activation_first_value_delivered  — once per user, on first completed workflow
 *   activation_nth_value_delivered    — once per user at exactly count N (default N=3)
 *
 * weekly_active is a derived metric in PostHog (any *_value_delivered in trailing 7d);
 * we do not emit a server event for it.
 *
 * KV key schema (in CONCIERGE_KV):
 *   activation:{userId}:first_action_fired   → "1" if already fired
 *   activation:{userId}:completion_count     → JSON number, incremented on each completion
 *   activation:{userId}:nth_fired:{n}        → "1" if fired for this n
 */

import { AnalyticsEventName } from "@jeevy/contracts";
import type { ServerCapture } from "@jeevy/analytics/server";
import type { ConciergeKV } from "./metrics.js";

export type ActionType = "calendar" | "messaging" | "travel";

const NTH_COMPLETION_MILESTONES = [3] as const;

function activationKey(userId: string, suffix: string): string {
  return `activation:${userId}:${suffix}`;
}

async function getCount(kv: ConciergeKV, key: string): Promise<number> {
  const raw = await kv.get(key);
  if (!raw) return 0;
  const n = parseInt(raw, 10);
  return isNaN(n) ? 0 : n;
}

/**
 * Call when a workflow is created for this user.
 * Fires activation_first_action_attempted exactly once per user.
 */
export async function trackFirstActionAttempted(
  kv: ConciergeKV,
  capture: ServerCapture,
  params: {
    userId: string;
    actionType: ActionType;
    sessionId: string;
    correlationId: string;
  },
): Promise<void> {
  const firedKey = activationKey(params.userId, "first_action_fired");
  const alreadyFired = await kv.get(firedKey);
  if (alreadyFired) return;

  await kv.put(firedKey, "1");
  await capture({
    distinctId: params.userId,
    event: AnalyticsEventName.ACTIVATION_FIRST_ACTION_ATTEMPTED,
    props: {
      action_type: params.actionType,
      session_id: params.sessionId,
      correlation_id: params.correlationId,
    },
  });
}

/**
 * Call when a workflow reaches completed/completed_external.
 * Fires:
 *   - activation_first_value_delivered once per user
 *   - activation_nth_value_delivered at each milestone count (default: 3)
 *
 * Returns the new completion count.
 */
export async function trackValueDelivered(
  kv: ConciergeKV,
  capture: ServerCapture,
  params: {
    userId: string;
    actionType: ActionType;
    sessionId: string;
    correlationId: string;
    createdAt: string;
  },
): Promise<number> {
  const countKey = activationKey(params.userId, "completion_count");
  const currentCount = await getCount(kv, countKey);
  const newCount = currentCount + 1;
  await kv.put(countKey, String(newCount));

  const latencyMs = Date.now() - new Date(params.createdAt).getTime();

  if (newCount === 1) {
    await capture({
      distinctId: params.userId,
      event: AnalyticsEventName.ACTIVATION_FIRST_VALUE_DELIVERED,
      props: {
        action_type: params.actionType,
        session_id: params.sessionId,
        correlation_id: params.correlationId,
        latency_ms: Math.max(0, latencyMs),
      },
    });
  }

  for (const milestone of NTH_COMPLETION_MILESTONES) {
    if (newCount === milestone) {
      const nthFiredKey = activationKey(params.userId, `nth_fired:${milestone}`);
      const alreadyFired = await kv.get(nthFiredKey);
      if (!alreadyFired) {
        await kv.put(nthFiredKey, "1");
        await capture({
          distinctId: params.userId,
          event: AnalyticsEventName.ACTIVATION_NTH_VALUE_DELIVERED,
          props: {
            action_type: params.actionType,
            session_id: params.sessionId,
            correlation_id: params.correlationId,
            count: milestone,
          },
        });
      }
    }
  }

  return newCount;
}
