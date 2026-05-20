/**
 * Outreach routes — Scenario 4 policy engine (YOU-506).
 *
 * POST /api/internal/outreach/send
 *   Policy-gated outbound send. Requires x-internal-secret header.
 *   Body: OutboundSendRequest — must include approvalToken for allowed sends.
 *   Returns 403 when kill-switch is off or approval token missing.
 *   Emits ConciergeUnauthorizedExternalAction sev-1 log on rejection.
 *
 * POST /internal/policy/validate
 *   Dry-run policy check — does not send, only evaluates approval token + kill-switch.
 *   Useful for Scenario 4 exercise scripts.
 *
 * GET  /internal/metrics/policy
 *   Prometheus text format for external_action_total counter.
 *
 * All routes require X-Internal-Secret header.
 */

import { makeError } from "@jeevy/contracts";
import type { OutboundSendRequest } from "@jeevy/contracts";
import type { Hono } from "hono";
import { PolicyGatedOutreachAdapter } from "../adapters/outreach.js";
import { createResendMessagingAdapter } from "../lib/outreach-adapter.js";
import { getCounter } from "../lib/metrics.js";
import { checkExternalActionPolicy, buildExternalActionMetric } from "../lib/policy-engine.js";
import type { ConciergeKV } from "../lib/metrics.js";
import type { Env, Variables } from "../index.js";

type App = Hono<{ Bindings: Env; Variables: Variables }>;

function verifySecret(header: string | undefined, secret: string): boolean {
  return typeof header === "string" && header === secret;
}

export function registerOutreachRoutes(app: App): void {
  app.post("/api/internal/outreach/send", async (c) => {
    const correlationId = c.req.header("x-correlation-id") ?? crypto.randomUUID();
    c.res.headers.set("x-correlation-id", correlationId);

    if (!verifySecret(c.req.header("x-internal-secret"), c.env.INTERNAL_API_SECRET)) {
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

    const messaging = createResendMessagingAdapter(c.env.RESEND_API_KEY, c.env.FROM_EMAIL);
    const adapter = new PolicyGatedOutreachAdapter(
      c.env.POLICY_KV,
      c.env.CONCIERGE_KV as unknown as ConciergeKV,
      messaging,
    );

    const result = await adapter.send(req);

    if (!result.ok) {
      if (result.reason === "send_failed") {
        return c.json(
          makeError("adapter/messaging", "adapter/send_failed", result.error, correlationId),
          502,
        );
      }
      const message = result.error;
      return c.json(
        makeError("policy/policy_violation", "policy/unauthorized_external_action", message, correlationId),
        403,
      );
    }

    return c.json({ ok: true, messageIds: result.messageIds, correlationId });
  });

  app.post("/internal/policy/validate", async (c) => {
    const correlationId = c.req.header("x-correlation-id") ?? crypto.randomUUID();
    c.res.headers.set("x-correlation-id", correlationId);

    if (!verifySecret(c.req.header("x-internal-secret"), c.env.INTERNAL_API_SECRET)) {
      return c.json(
        makeError("auth", "auth/unauthenticated", "Missing or invalid internal secret", correlationId),
        401,
      );
    }

    let body: Pick<OutboundSendRequest, "approvalToken" | "actionClass" | "correlationId">;
    try {
      body = (await c.req.json()) as typeof body;
    } catch {
      return c.json(
        makeError("internal", "internal/bad_request", "Invalid JSON body", correlationId),
        400,
      );
    }

    const req = { ...body, correlationId };
    const decision = await checkExternalActionPolicy(req, c.env.POLICY_KV);
    const metric = buildExternalActionMetric(req, decision);

    return c.json({ decision, metric, correlationId });
  });

  app.get("/internal/metrics/policy", async (c) => {
    if (!verifySecret(c.req.header("x-internal-secret"), c.env.INTERNAL_API_SECRET)) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const kv = c.env.CONCIERGE_KV as unknown as ConciergeKV;

    const [
      allowedEmail,
      allowedCalendar,
      allowedTravel,
      rejNoTokenEmail,
      rejNoTokenCalendar,
      rejNoTokenTravel,
      rejKillSwitchEmail,
      rejKillSwitchCalendar,
      rejKillSwitchTravel,
    ] = await Promise.all([
      getCounter(kv, "external_action_total", { approval_attached: "true",  action_class: "outreach_send",  outcome: "allowed" }),
      getCounter(kv, "external_action_total", { approval_attached: "true",  action_class: "calendar_write", outcome: "allowed" }),
      getCounter(kv, "external_action_total", { approval_attached: "true",  action_class: "travel_book",    outcome: "allowed" }),
      getCounter(kv, "external_action_total", { approval_attached: "false", action_class: "outreach_send",  outcome: "rejected_no_token" }),
      getCounter(kv, "external_action_total", { approval_attached: "false", action_class: "calendar_write", outcome: "rejected_no_token" }),
      getCounter(kv, "external_action_total", { approval_attached: "false", action_class: "travel_book",    outcome: "rejected_no_token" }),
      getCounter(kv, "external_action_total", { approval_attached: "false", action_class: "outreach_send",  outcome: "rejected_kill_switch" }),
      getCounter(kv, "external_action_total", { approval_attached: "false", action_class: "calendar_write", outcome: "rejected_kill_switch" }),
      getCounter(kv, "external_action_total", { approval_attached: "false", action_class: "travel_book",    outcome: "rejected_kill_switch" }),
    ]);

    const lines = [
      `# HELP external_action_total Total external actions by approval_attached, action_class, outcome`,
      `# TYPE external_action_total counter`,
      `external_action_total{approval_attached="true",action_class="outreach_send",outcome="allowed"} ${allowedEmail}`,
      `external_action_total{approval_attached="true",action_class="calendar_write",outcome="allowed"} ${allowedCalendar}`,
      `external_action_total{approval_attached="true",action_class="travel_book",outcome="allowed"} ${allowedTravel}`,
      `external_action_total{approval_attached="false",action_class="outreach_send",outcome="rejected_no_token"} ${rejNoTokenEmail}`,
      `external_action_total{approval_attached="false",action_class="calendar_write",outcome="rejected_no_token"} ${rejNoTokenCalendar}`,
      `external_action_total{approval_attached="false",action_class="travel_book",outcome="rejected_no_token"} ${rejNoTokenTravel}`,
      `external_action_total{approval_attached="false",action_class="outreach_send",outcome="rejected_kill_switch"} ${rejKillSwitchEmail}`,
      `external_action_total{approval_attached="false",action_class="calendar_write",outcome="rejected_kill_switch"} ${rejKillSwitchCalendar}`,
      `external_action_total{approval_attached="false",action_class="travel_book",outcome="rejected_kill_switch"} ${rejKillSwitchTravel}`,
      ``,
      `# ALERT ConciergeUnauthorizedExternalAction fires on console.warn alert="ConciergeUnauthorizedExternalAction" — routes to PagerDuty sev-1`,
    ].join("\n");

    return new Response(lines, {
      headers: {
        "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
        "X-Correlation-Id": c.req.header("x-correlation-id") ?? crypto.randomUUID(),
      },
    });
  });
}
