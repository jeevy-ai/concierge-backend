/**
 * Calendar workflow routes — Scenario 3 (YOU-493).
 *
 * POST /internal/workflow/calendar/reschedule
 *   Creates a workflow, auto-approves, and runs execution in one shot.
 *   Header X-Force-Error: provider_4xx|provider_timeout|provider_5xx injects errors.
 *   Returns the final session state including reasonCode on needs_input.
 *
 * GET  /internal/workflow/:sessionId
 *   Returns session state + history.
 *
 * POST /internal/workflow/:sessionId/approve
 *   Manually approves a session in awaiting_approval, then executes.
 *
 * GET  /internal/metrics/calendar
 *   Returns Prometheus text format metrics for circuit state and counters.
 *
 * All routes require X-Internal-Secret header.
 */

import { makeError } from "@jeevy/contracts";
import { createServerCapture } from "@jeevy/analytics/server";
import type { Hono } from "hono";
import type { ForceError } from "../adapters/google-calendar.js";
import { GoogleCalendarAdapter } from "../adapters/google-calendar.js";
import { CIRCUIT_CLOSED, CIRCUIT_HALF_OPEN, CIRCUIT_OPEN, getCircuitState } from "../lib/circuit-breaker.js";
import { getCounter, getGauge } from "../lib/metrics.js";
import {
  approveWorkflow,
  createCalendarRescheduleWorkflow,
  executeCalendarReschedule,
  loadSession,
} from "../lib/workflow-orchestrator.js";
import { SentryEventEmitter } from "../lib/ttfv-events.js";
import { getCRMLiteWriter } from "../lib/crm-lite-ttfv.js";
import type { Env, Variables } from "../index.js";

type App = Hono<{ Bindings: Env; Variables: Variables }>;

function verifySecret(header: string | undefined, secret: string): boolean {
  return typeof header === "string" && header === secret;
}

const PROVIDER = "google_calendar";

export function registerCalendarWorkflowRoutes(app: App): void {
  app.post("/internal/workflow/calendar/reschedule", async (c) => {
    if (!verifySecret(c.req.header("x-internal-secret"), c.env.INTERNAL_API_SECRET)) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const correlationId = c.req.header("x-correlation-id") ?? crypto.randomUUID();
    c.res.headers.set("x-correlation-id", correlationId);

    const forceError = (c.req.header("x-force-error") as ForceError | undefined) ?? null;
    const sandbox = c.env.ENVIRONMENT !== "production";

    const body = await c.req.json<{
      operatorId: string;
      eventId: string;
      newStartIso: string;
      newEndIso: string;
      reason?: string;
      userEmail?: string;
      intakeSubmittedAt?: string;
      successCriterionId?: string;
      isTest?: boolean;
    }>();

    if (!body?.operatorId || !body?.eventId || !body?.newStartIso || !body?.newEndIso) {
      const err = makeError(
        "internal",
        "validation/missing_fields",
        "operatorId, eventId, newStartIso, newEndIso required",
        correlationId,
      );
      return c.json(err, 400);
    }

    const kv_ = c.env.CONCIERGE_KV as unknown as import("../lib/metrics.js").ConciergeKV;
    const capture_ = sandbox
      ? undefined
      : createServerCapture({ apiKey: c.env.POSTHOG_API_KEY, host: c.env.POSTHOG_HOST });

    const session = await createCalendarRescheduleWorkflow(kv_, {
      operatorId: body.operatorId,
      correlationId,
      eventId: body.eventId,
      newStartIso: body.newStartIso,
      newEndIso: body.newEndIso,
      ...(body.reason !== undefined ? { reason: body.reason } : {}),
      ...(body.userEmail !== undefined ? { userEmail: body.userEmail } : {}),
      ...(body.intakeSubmittedAt !== undefined ? { intakeSubmittedAt: body.intakeSubmittedAt } : {}),
      ...(body.successCriterionId !== undefined ? { successCriterionId: body.successCriterionId } : {}),
      ...(body.isTest !== undefined ? { isTest: body.isTest } : {}),
    }, capture_);

    const approved = await approveWorkflow(kv_, session.sessionId, body.operatorId, correlationId);

    const adapter = new GoogleCalendarAdapter({ kv: kv_, forceError, sandbox });

    const emitter = c.env.SENTRY_DSN ? new SentryEventEmitter() : undefined;
    const crmWriter = getCRMLiteWriter(c.env) || undefined;

    const final = await executeCalendarReschedule(
      kv_,
      approved.sessionId,
      adapter,
      correlationId,
      capture_,
      emitter,
      crmWriter,
    );

    return c.json({ session: final, correlationId });
  });

  app.get("/internal/workflow/:sessionId", async (c) => {
    if (!verifySecret(c.req.header("x-internal-secret"), c.env.INTERNAL_API_SECRET)) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const correlationId = c.req.header("x-correlation-id") ?? crypto.randomUUID();
    c.res.headers.set("x-correlation-id", correlationId);

    const session = await loadSession(
      c.env.CONCIERGE_KV as unknown as import("../lib/metrics.js").ConciergeKV,
      c.req.param("sessionId"),
    );
    if (!session) {
      return c.json(
        makeError("internal", "not_found", "Session not found", correlationId),
        404,
      );
    }
    return c.json({ session, correlationId });
  });

  app.post("/internal/workflow/:sessionId/approve", async (c) => {
    if (!verifySecret(c.req.header("x-internal-secret"), c.env.INTERNAL_API_SECRET)) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const correlationId = c.req.header("x-correlation-id") ?? crypto.randomUUID();
    c.res.headers.set("x-correlation-id", correlationId);

    const forceError = (c.req.header("x-force-error") as ForceError | undefined) ?? null;
    const sandbox = c.env.ENVIRONMENT !== "production";

    const body = await c.req.json<{ operatorId: string }>();
    if (!body?.operatorId) {
      return c.json(
        makeError("internal", "validation/missing_fields", "operatorId required", correlationId),
        400,
      );
    }

    const kv = c.env.CONCIERGE_KV as unknown as import("../lib/metrics.js").ConciergeKV;

    let approved;
    try {
      approved = await approveWorkflow(kv, c.req.param("sessionId"), body.operatorId, correlationId);
    } catch (err: unknown) {
      const e = err as { code?: string; message?: string };
      if (e.code === "auth/forbidden") {
        return c.json(
          makeError("auth/forbidden", "auth/forbidden", "Operator mismatch", correlationId),
          403,
        );
      }
      if (e.code === "policy/state_transition") {
        return c.json(
          makeError("policy/state_transition", "policy/state_transition", e.message ?? "Invalid transition", correlationId),
          409,
        );
      }
      throw err;
    }

    const capture2 = sandbox
      ? undefined
      : createServerCapture({ apiKey: c.env.POSTHOG_API_KEY, host: c.env.POSTHOG_HOST });
    const adapter = new GoogleCalendarAdapter({ kv, forceError, sandbox });
    const final = await executeCalendarReschedule(kv, approved.sessionId, adapter, correlationId, capture2);

    return c.json({ session: final, correlationId });
  });

  app.get("/internal/metrics/calendar", async (c) => {
    if (!verifySecret(c.req.header("x-internal-secret"), c.env.INTERNAL_API_SECRET)) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const kv = c.env.CONCIERGE_KV as unknown as import("../lib/metrics.js").ConciergeKV;

    const circuitState = await getCircuitState(kv, PROVIDER);
    const circuitStateLabel =
      circuitState === CIRCUIT_OPEN ? "open" :
      circuitState === CIRCUIT_HALF_OPEN ? "half_open" : "closed";

    const successCount = await getCounter(kv, "provider_call_total", { provider: PROVIDER, outcome: "success" });
    const errorCount = await getCounter(kv, "provider_call_total", { provider: PROVIDER, outcome: "error" });
    const timeoutCount = await getCounter(kv, "provider_call_total", { provider: PROVIDER, outcome: "timeout" });
    const circuitOpenCount = await getCounter(kv, "provider_call_total", { provider: PROVIDER, outcome: "circuit_open" });

    const needsInput = await getGauge(kv, "workflow_in_flight", { workflow_class: "calendar_reschedule", state: "needs_input" });

    const lines = [
      `# HELP provider_circuit_state Circuit breaker state (0=closed 1=half_open 2=open)`,
      `# TYPE provider_circuit_state gauge`,
      `provider_circuit_state{provider="${PROVIDER}"} ${circuitState}`,
      `# COMMENT provider_circuit_state_label ${circuitStateLabel}`,
      ``,
      `# HELP provider_call_total Total provider calls by outcome`,
      `# TYPE provider_call_total counter`,
      `provider_call_total{provider="${PROVIDER}",outcome="success"} ${successCount}`,
      `provider_call_total{provider="${PROVIDER}",outcome="error"} ${errorCount}`,
      `provider_call_total{provider="${PROVIDER}",outcome="timeout"} ${timeoutCount}`,
      `provider_call_total{provider="${PROVIDER}",outcome="circuit_open"} ${circuitOpenCount}`,
      ``,
      `# HELP workflow_in_flight Workflows currently in the given state`,
      `# TYPE workflow_in_flight gauge`,
      `workflow_in_flight{workflow_class="calendar_reschedule",state="needs_input"} ${needsInput}`,
      ``,
      `# ALERT ConciergeProviderCircuitOpen fires when provider_circuit_state{provider="google_calendar"} == 2 for 15m`,
    ].join("\n");

    return new Response(lines, {
      headers: {
        "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
        "X-Correlation-Id": c.req.header("x-correlation-id") ?? crypto.randomUUID(),
      },
    });
  });
}
