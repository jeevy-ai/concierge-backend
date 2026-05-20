import type { ActionClass, ExternalActionMetricEvent, OutboundSendRequest, PolicyDecision } from "@jeevy/contracts";

export const KILL_SWITCH_KV_KEY = "concierge.external_actions.enabled";

export type KVStore = { get(key: string): Promise<string | null> };

export async function checkExternalActionPolicy(
  req: Pick<OutboundSendRequest, "approvalToken" | "actionClass" | "correlationId">,
  kv: KVStore,
): Promise<PolicyDecision> {
  const killSwitchValue = await kv.get(KILL_SWITCH_KV_KEY);
  // Default: enabled unless explicitly set to "false"
  const enabled = killSwitchValue !== "false";
  if (!enabled) {
    return { allowed: false, reason: "kill_switch_disabled" };
  }

  if (!req.approvalToken || req.approvalToken.trim() === "") {
    return { allowed: false, reason: "no_approval_token" };
  }

  return { allowed: true };
}

export function buildExternalActionMetric(
  req: Pick<OutboundSendRequest, "approvalToken" | "actionClass" | "correlationId">,
  decision: PolicyDecision,
): ExternalActionMetricEvent {
  const approvalAttached = Boolean(req.approvalToken && req.approvalToken.trim() !== "");

  let outcome: ExternalActionMetricEvent["outcome"];
  if (decision.allowed) {
    outcome = "allowed";
  } else if (decision.reason === "kill_switch_disabled") {
    outcome = "rejected_kill_switch";
  } else {
    outcome = "rejected_no_token";
  }

  return {
    name: "external_action_total",
    approval_attached: approvalAttached,
    action_class: req.actionClass as ActionClass,
    outcome,
    correlationId: req.correlationId,
  };
}
