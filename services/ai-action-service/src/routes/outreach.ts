import { makeError } from "@jeevy/contracts";
import type { OutboundSendRequest } from "@jeevy/contracts";
import type { Hono } from "hono";
import { createResendMessagingAdapter } from "../lib/outreach-adapter.js";
import { buildExternalActionMetric, checkExternalActionPolicy } from "../lib/policy-engine.js";
import type { Env, Variables } from "../index.js";

type App = Hono<{ Bindings: Env; Variables: Variables }>;

export function registerOutreachRoutes(app: App): void {
  app.post("/api/internal/outreach/send", async (c) => {
    const correlationId = c.req.header("x-correlation-id") ?? crypto.randomUUID();
    c.res.headers.set("x-correlation-id", correlationId);

    const secret = c.req.header("x-internal-secret");
    if (secret !== c.env.INTERNAL_API_SECRET) {
      return c.json(
        makeError("auth", "auth/unauthenticated", "Missing or invalid internal secret", correlationId),
        401,
      );
    }

    let body: OutboundSendRequest;
    try {
      body = (await c.req.json()) as OutboundSendRequest;
    } catch {
      return c.json(
        makeError("internal", "internal/bad_request", "Invalid JSON body", correlationId),
        400,
      );
    }

    const req: OutboundSendRequest = { ...body, correlationId };

    const decision = await checkExternalActionPolicy(req, c.env.POLICY_KV);
    const metric = buildExternalActionMetric(req, decision);

    // Emit metric as structured log — PostHog ingestion picks this up via log drain.
    console.log(JSON.stringify({ type: "metric", ...metric }));

    if (!decision.allowed) {
      const isKillSwitch = decision.reason === "kill_switch_disabled";
      // ConciergeUnauthorizedExternalAction alert fires on this log pattern.
      console.warn(
        JSON.stringify({
          alert: "ConciergeUnauthorizedExternalAction",
          reason: decision.reason,
          action_class: req.actionClass,
          approval_attached: metric.approval_attached,
          correlationId,
        }),
      );

      const message = isKillSwitch
        ? "External actions are disabled via kill-switch (concierge.external_actions.enabled=false)"
        : "Outbound action requires an approval token";

      return c.json(
        makeError("policy/policy_violation", "policy/unauthorized_external_action", message, correlationId),
        403,
      );
    }

    const adapter = createResendMessagingAdapter(c.env.RESEND_API_KEY, c.env.FROM_EMAIL);
    const result = await adapter.send({
      channel: req.channel,
      to: req.to,
      subject: req.subject,
      body: req.body,
      correlationId,
    });

    if (!result.ok) {
      return c.json(
        makeError("adapter/messaging", "adapter/send_failed", result.error, correlationId),
        502,
      );
    }

    return c.json({ ok: true, messageIds: result.messageIds, correlationId });
  });
}
