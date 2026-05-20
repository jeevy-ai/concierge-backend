import type { MessagingAdapter, OutboundSendRequest } from "@jeevy/contracts";
import type { ConciergeKV } from "../lib/metrics.js";
import { incrementCounter } from "../lib/metrics.js";
import { buildExternalActionMetric, checkExternalActionPolicy } from "../lib/policy-engine.js";
import type { KVStore } from "../lib/policy-engine.js";

export type OutreachSendResult =
  | { ok: true; messageIds: string[] }
  | { ok: false; error: string; reason: "no_approval_token" | "kill_switch_disabled" | "send_failed" };

/**
 * Policy-gated outreach adapter.
 * Enforces kill-switch and approval token before delegating to the transport.
 * Persists external_action_total{approval_attached, action_class, outcome} in KV.
 * Emits ConciergeUnauthorizedExternalAction structured log on policy rejection.
 */
export class PolicyGatedOutreachAdapter {
  constructor(
    private readonly policyKv: KVStore,
    private readonly metricsKv: ConciergeKV | undefined,
    private readonly messaging: MessagingAdapter,
  ) {}

  async send(req: OutboundSendRequest): Promise<OutreachSendResult> {
    const decision = await checkExternalActionPolicy(req, this.policyKv);
    const metricEvent = buildExternalActionMetric(req, decision);

    if (this.metricsKv) await incrementCounter(this.metricsKv, "external_action_total", {
      approval_attached: String(metricEvent.approval_attached),
      action_class: metricEvent.action_class,
      outcome: metricEvent.outcome,
    });

    console.log(JSON.stringify({ type: "metric", ...metricEvent }));

    if (!decision.allowed) {
      console.warn(
        JSON.stringify({
          alert: "ConciergeUnauthorizedExternalAction",
          severity: "sev-1",
          reason: decision.reason,
          action_class: req.actionClass,
          approval_attached: metricEvent.approval_attached,
          correlationId: req.correlationId,
        }),
      );

      const error =
        decision.reason === "kill_switch_disabled"
          ? "External actions are disabled via kill-switch (concierge.external_actions.enabled=false)"
          : "Outbound action requires an approval token";

      return { ok: false, error, reason: decision.reason };
    }

    const result = await this.messaging.send({
      channel: req.channel,
      to: req.to,
      subject: req.subject,
      body: req.body,
      correlationId: req.correlationId,
    });

    if (!result.ok) {
      return { ok: false, error: result.error, reason: "send_failed" };
    }

    return { ok: true, messageIds: result.messageIds };
  }
}
