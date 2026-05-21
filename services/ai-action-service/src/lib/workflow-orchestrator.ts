/**
 * Workflow orchestrator — Scenario 3 (YOU-493).
 *
 * State machine: draft → awaiting_approval → executing → completed | failed | needs_input
 *
 * Workflow sessions stored in KV under workflow:{sessionId}.
 * State transitions validated against @jeevy/contracts isValidTransition.
 *
 * needs_input is reached when the calendar adapter throws ProviderCircuitOpen or a 4xx.
 * reason_code on the session record carries the error class:
 *   "provider_4xx" | "provider_timeout" | "provider_5xx" | "circuit_open"
 */

import type { CalendarAdapter, RescheduleRequest } from "@jeevy/contracts";
import { isValidTransition } from "@jeevy/contracts";
import type { OrchestratorStatus } from "@jeevy/contracts";
import type { ServerCapture } from "@jeevy/analytics/server";
import { ProviderCircuitOpen } from "./circuit-breaker.js";
import { type ConciergeKV, emitMetricLog, incrementCounter, setGauge } from "./metrics.js";
import { trackFirstActionAttempted, trackValueDelivered } from "./activation-analytics.js";
import { handleActionDelivered } from "./action-delivery-handler.js";
import type { EventEmitter } from "./ttfv-events.js";
import type { CRMLiteWriter } from "./crm-lite-ttfv.js";

export type WorkflowReasonCode =
  | "provider_4xx"
  | "provider_timeout"
  | "provider_5xx"
  | "circuit_open"
  | "approval_timeout"
  | null;

export type WorkflowSession = {
  sessionId: string;
  status: OrchestratorStatus;
  correlationId: string;
  operatorId: string;
  workflowClass: "calendar_reschedule";
  createdAt: string;
  updatedAt: string;
  reasonCode: WorkflowReasonCode;
  payload: Record<string, unknown>;
  history: Array<{
    from: OrchestratorStatus;
    to: OrchestratorStatus;
    at: string;
    correlationId: string;
  }>;
};

function sessionKey(sessionId: string): string {
  return `workflow:${sessionId}`;
}

export async function loadSession(
  kv: ConciergeKV,
  sessionId: string,
): Promise<WorkflowSession | null> {
  const raw = await kv.get(sessionKey(sessionId));
  if (!raw) return null;
  return JSON.parse(raw) as WorkflowSession;
}

async function saveSession(kv: ConciergeKV, session: WorkflowSession): Promise<void> {
  await kv.put(sessionKey(session.sessionId), JSON.stringify(session));
  await setGauge(
    kv,
    "workflow_in_flight",
    { workflow_class: session.workflowClass, state: session.status },
    1,
  );
  emitMetricLog(
    "workflow_in_flight",
    { workflow_class: session.workflowClass, state: session.status },
    1,
  );
}

async function transition(
  kv: ConciergeKV,
  session: WorkflowSession,
  to: OrchestratorStatus,
  correlationId: string,
  reasonCode?: WorkflowReasonCode,
): Promise<WorkflowSession> {
  if (!isValidTransition(session.status, to)) {
    throw Object.assign(
      new Error(`Invalid transition: ${session.status} → ${to}`),
      { code: "policy/state_transition" },
    );
  }
  const now = new Date().toISOString();
  const updated: WorkflowSession = {
    ...session,
    status: to,
    updatedAt: now,
    reasonCode: reasonCode ?? session.reasonCode,
    history: [
      ...session.history,
      { from: session.status, to, at: now, correlationId },
    ],
  };
  await saveSession(kv, updated);
  return updated;
}

export async function createCalendarRescheduleWorkflow(
  kv: ConciergeKV,
  params: {
    operatorId: string;
    correlationId: string;
    eventId: string;
    newStartIso: string;
    newEndIso: string;
    reason?: string;
    userEmail?: string;
    intakeSubmittedAt?: string;
    successCriterionId?: string;
    isTest?: boolean;
  },
  capture?: ServerCapture,
): Promise<WorkflowSession> {
  const sessionId = crypto.randomUUID();
  const now = new Date().toISOString();
  const draft: WorkflowSession = {
    sessionId,
    status: "draft",
    correlationId: params.correlationId,
    operatorId: params.operatorId,
    workflowClass: "calendar_reschedule",
    createdAt: now,
    updatedAt: now,
    reasonCode: null,
    payload: {
      eventId: params.eventId,
      newStartIso: params.newStartIso,
      newEndIso: params.newEndIso,
      reason: params.reason,
      userEmail: params.userEmail,
      intakeSubmittedAt: params.intakeSubmittedAt,
      successCriterionId: params.successCriterionId,
      isTest: params.isTest,
    },
    history: [],
  };
  await saveSession(kv, draft);
  await incrementCounter(kv, "workflow_created_total", { workflow_class: "calendar_reschedule" });
  emitMetricLog("workflow_created_total", { workflow_class: "calendar_reschedule" }, 1);

  if (capture) {
    await trackFirstActionAttempted(kv, capture, {
      userId: params.operatorId,
      actionType: "calendar",
      sessionId,
      correlationId: params.correlationId,
    });
  }

  return transition(kv, draft, "awaiting_approval", params.correlationId);
}

export async function approveWorkflow(
  kv: ConciergeKV,
  sessionId: string,
  operatorId: string,
  correlationId: string,
): Promise<WorkflowSession> {
  const session = await loadSession(kv, sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);
  if (session.operatorId !== operatorId) {
    throw Object.assign(new Error("Operator mismatch"), { code: "auth/forbidden" });
  }
  return transition(kv, session, "executing", correlationId);
}

export async function executeCalendarReschedule(
  kv: ConciergeKV,
  sessionId: string,
  adapter: CalendarAdapter,
  correlationId: string,
  capture?: ServerCapture,
  emitter?: EventEmitter,
  crmWriter?: CRMLiteWriter,
): Promise<WorkflowSession> {
  const session = await loadSession(kv, sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);
  if (session.status !== "executing") {
    throw Object.assign(
      new Error(`Cannot execute from status: ${session.status}`),
      { code: "policy/state_transition" },
    );
  }

  const { eventId, newStartIso, newEndIso, reason, userEmail, intakeSubmittedAt, successCriterionId, isTest } = session.payload as {
    eventId: string;
    newStartIso: string;
    newEndIso: string;
    reason?: string;
    userEmail?: string;
    intakeSubmittedAt?: string;
    successCriterionId?: string;
    isTest?: boolean;
  };

  const req: RescheduleRequest = {
    eventId,
    newStartIso,
    newEndIso,
    reason,
    correlationId,
  };

  try {
    const result = await adapter.reschedule(req);
    if (result.ok) {
      const completed = await transition(kv, session, "completed", correlationId);
      if (capture) {
        await trackValueDelivered(kv, capture, {
          userId: session.operatorId,
          actionType: "calendar",
          sessionId: session.sessionId,
          correlationId,
          createdAt: session.createdAt,
        });
      }

      // Emit TTFV event for first qualifying action delivery
      if (emitter && userEmail && intakeSubmittedAt) {
        try {
          await handleActionDelivered({
            userId: session.operatorId,
            actionType: "calendar.event_created",
            correlationId,
            triggeredBy: "orchestrator",
            intakeSubmittedAt,
            userEmail,
            successCriterionId,
            isTest,
            kv,
            emitter,
            crmWriter,
          });
        } catch (err) {
          // Log but don't fail the action delivery
          console.error("Failed to emit TTFV event:", err);
        }
      }

      return completed;
    }
    return transition(kv, session, "failed", correlationId);
  } catch (err) {
    const reasonCode = classifyError(err);
    return transition(kv, session, "needs_input", correlationId, reasonCode);
  }
}

function classifyError(err: unknown): WorkflowReasonCode {
  if (err instanceof ProviderCircuitOpen) return "circuit_open";
  if (err instanceof Error) {
    if ((err as { statusCode?: number }).statusCode === 401 ||
        (err as { statusCode?: number }).statusCode === 403 ||
        (err as { statusCode?: number }).statusCode === 429) return "provider_4xx";
    if ((err as { statusCode?: number }).statusCode && (err as { statusCode?: number }).statusCode! >= 400 && (err as { statusCode?: number }).statusCode! < 500) return "provider_4xx";
    if ((err as { statusCode?: number }).statusCode && (err as { statusCode?: number }).statusCode! >= 500) return "provider_5xx";
    if (err.name === "TimeoutError" || err.message.includes("timeout")) return "provider_timeout";
    if (err.name === "Provider4xxError") return "provider_4xx";
    if (err.name === "Provider5xxError") return "provider_5xx";
  }
  return "provider_4xx";
}
