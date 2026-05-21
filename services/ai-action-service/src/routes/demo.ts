/**
 * Demo routes — sandbox-only, no X-Internal-Secret required.
 *
 * Only active when ENVIRONMENT !== 'production'. In production these routes
 * return 404 so the backend lockdown stays intact.
 *
 * Routes:
 *   GET  /api/demo/events              — list available fixture events
 *   POST /api/demo/calendar/reschedule — calendar reschedule in sandbox mode
 *   POST /api/demo/outreach/validate   — policy dry-run (no actual send)
 */

import type { Hono } from "hono";
import { GoogleCalendarAdapter } from "../adapters/google-calendar.js";
import { checkExternalActionPolicy } from "../lib/policy-engine.js";
import {
  approveWorkflow,
  createCalendarRescheduleWorkflow,
  executeCalendarReschedule,
} from "../lib/workflow-orchestrator.js";
import type { Env, Variables } from "../index.js";

type App = Hono<{ Bindings: Env; Variables: Variables }>;

const FIXTURE_EVENTS = [
  {
    id: "CAL-01",
    title: "Q2 Planning",
    startIso: "2026-05-03T09:00:00Z",
    endIso: "2026-05-03T10:00:00Z",
    timezone: "Europe/Copenhagen",
    participants: [
      { email: "alice@example.com", name: "Alice", rsvp: "accepted" },
      { email: "bob@example.com", name: "Bob", rsvp: "tentative" },
    ],
  },
  {
    id: "CAL-02",
    title: "1:1 Sync",
    startIso: "2026-05-04T14:00:00Z",
    endIso: "2026-05-04T14:30:00Z",
    timezone: "Europe/Copenhagen",
    participants: [{ email: "carol@example.com", name: "Carol", rsvp: "accepted" }],
  },
];

export function registerDemoRoutes(app: App): void {
  app.use("/api/demo/*", async (c, next) => {
    if (c.env.ENVIRONMENT === "production") {
      return c.json({ error: "Not found" }, 404);
    }
    await next();
  });

  app.get("/api/demo/events", (c) => {
    return c.json({ events: FIXTURE_EVENTS });
  });

  app.post("/api/demo/calendar/reschedule", async (c) => {
    const correlationId = crypto.randomUUID();

    let body: { eventId: string; newStartIso: string; newEndIso: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON" }, 400);
    }
    if (!body.eventId || !body.newStartIso || !body.newEndIso) {
      return c.json({ error: "eventId, newStartIso, newEndIso required" }, 400);
    }

    const session = await createCalendarRescheduleWorkflow(c.env.CONCIERGE_KV, {
      operatorId: "demo-board",
      correlationId,
      eventId: body.eventId,
      newStartIso: body.newStartIso,
      newEndIso: body.newEndIso,
      reason: "Board demo reschedule",
      isTest: true,
    });

    const approved = await approveWorkflow(
      c.env.CONCIERGE_KV,
      session.sessionId,
      "demo-board",
      correlationId,
    );

    const adapter = new GoogleCalendarAdapter({ kv: c.env.CONCIERGE_KV, sandbox: true });
    const result = await executeCalendarReschedule(
      c.env.CONCIERGE_KV,
      approved.sessionId,
      adapter,
      correlationId,
    );

    return c.json({ correlationId, session: result });
  });

  app.post("/api/demo/outreach/validate", async (c) => {
    const correlationId = crypto.randomUUID();

    let body: { actionClass: string; approvalToken?: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON" }, 400);
    }
    if (!body.actionClass) {
      return c.json({ error: "actionClass required" }, 400);
    }

    const decision = await checkExternalActionPolicy(
      {
        actionClass: body.actionClass as "outreach_send" | "calendar_write" | "travel_book",
        approvalToken: body.approvalToken ?? undefined,
        correlationId,
      },
      c.env.POLICY_KV,
    );

    return c.json({ correlationId, decision });
  });
}
