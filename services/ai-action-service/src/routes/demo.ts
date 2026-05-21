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
 *   POST /api/demo/seed-nps-user       — seed test user with NPS detractor score + clear dedup
 *   POST /api/demo/interview/send      — send branded interview invite email (no dedup)
 */

import type { Hono } from "hono";
import { GoogleCalendarAdapter } from "../adapters/google-calendar.js";
import { checkExternalActionPolicy } from "../lib/policy-engine.js";
import { buildInterviewEmailHtml } from "../lib/save-interview.js";
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

  // Seed a test user with a low NPS score and clear dedup so the interview trigger fires.
  // Body: { userId: string; email: string; firstName?: string; score?: number }
  app.post("/api/demo/seed-nps-user", async (c) => {
    let body: { userId: string; email: string; firstName?: string; score?: number };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON" }, 400);
    }
    if (!body.userId || !body.email) {
      return c.json({ error: "userId and email required" }, 400);
    }
    const score = typeof body.score === "number" ? body.score : 3;

    await c.env.INTERVIEWS_KV.put(
      `user:${body.userId}:nps`,
      JSON.stringify({ score, recordedAt: new Date().toISOString() }),
    );
    await c.env.INTERVIEWS_KV.delete(`user:${body.userId}:save_invite`);
    await c.env.INTERVIEWS_KV.delete(`user:${body.userId}:last_value_event`);

    const raw = await c.env.INTERVIEWS_KV.get("tracked_users");
    const users: string[] = raw ? (JSON.parse(raw) as string[]) : [];
    if (!users.includes(body.userId)) {
      users.push(body.userId);
      await c.env.INTERVIEWS_KV.put("tracked_users", JSON.stringify(users));
    }

    return c.json({ ok: true, seeded: true, userId: body.userId, npsScore: score });
  });

  // Seed a synthetic paid user into CONCIERGE_KV — used by §9 smoke test (non-prod only).
  // Body: { userId: string }
  app.post("/api/demo/seed-entitlement", async (c) => {
    let body: { userId: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON" }, 400);
    }
    if (!body.userId) {
      return c.json({ error: "userId required" }, 400);
    }

    const record = JSON.stringify({
      stripeCustomerId: "cus_smoke_ttfv",
      stripeSubscriptionId: "sub_smoke_ttfv",
      status: "active",
      plan: "pro",
      periodEnd: 9999999999,
      updatedAt: new Date().toISOString(),
    });

    await c.env.CONCIERGE_KV.put(`entitlement:${body.userId}`, record);

    return c.json({ ok: true, seeded: true, userId: body.userId, key: `entitlement:${body.userId}` });
  });

  // Send a branded interview invite email directly via Resend — no dedup, no KV tracking.
  // Intended for board demo: lets the tester see the real HTML email arrive.
  // Body: { email: string; firstName?: string }
  app.post("/api/demo/interview/send", async (c) => {
    const correlationId = crypto.randomUUID();

    let body: { email: string; firstName?: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON" }, 400);
    }
    if (!body.email) {
      return c.json({ error: "email required" }, 400);
    }

    const firstName = body.firstName ?? "there";
    const subject = "We'd love 20 minutes to help — can you find a time?";
    const text = [
      `Hi ${firstName},`,
      "",
      "We noticed you haven't had a chance to get much use out of Jeevy recently.",
      "That's on us — we want to understand why and see if we can fix it.",
      "",
      "Could you spare 20 minutes for a quick call? I'll listen, take notes,",
      "and share anything useful we learn with the team.",
      "",
      `→ Pick a time: ${c.env.SCHEDULING_LINK}`,
      "",
      "No agenda, no sales pitch — just an honest conversation.",
      "",
      "— The Jeevy team",
    ].join("\n");

    let res: Response;
    try {
      res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${c.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: c.env.FROM_EMAIL,
          to: body.email,
          subject,
          text,
          html: buildInterviewEmailHtml(firstName, c.env.SCHEDULING_LINK),
        }),
      });
    } catch (err) {
      return c.json({ ok: false, error: `Network error: ${String(err)}`, correlationId }, 502);
    }

    if (!res.ok) {
      const errBody = (await res.json().catch(() => ({}))) as { message?: string };
      return c.json(
        { ok: false, error: errBody.message ?? `Resend error ${res.status}`, correlationId },
        502,
      );
    }

    const result = (await res.json()) as { id: string };
    return c.json({ ok: true, messageId: result.id, correlationId });
  });
}
