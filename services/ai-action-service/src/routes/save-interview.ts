import type { Hono } from "hono";
import type { Env, Variables } from "../index.js";
import {
  maybeInviteUser,
  recordNpsScore,
  recordValueEvent,
  trackUser,
} from "../lib/save-interview.js";

type App = Hono<{ Bindings: Env; Variables: Variables }>;

/**
 * Routes consumed by W3.3 activation events and W3.1 NPS module.
 * All routes are internal-only (service-to-service); they require the
 * INTERNAL_API_SECRET header to prevent accidental public use.
 */
export function registerSaveInterviewRoutes(app: App): void {
  // W3.3: fires when the product detects a value event for a user.
  // Body: { userId: string; email: string; firstName?: string }
  app.post("/internal/save-interview/value-event", async (c) => {
    if (!verifyInternalSecret(c.req.header("x-internal-secret"), c.env.INTERNAL_API_SECRET)) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const body = await c.req.json<{ userId: string; email: string; firstName?: string }>();
    if (!body?.userId || !body?.email) {
      return c.json({ error: "userId and email required" }, 400);
    }

    await recordValueEvent(c.env.INTERVIEWS_KV, body.userId);
    await trackUser(c.env.INTERVIEWS_KV, body.userId);

    return c.json({ ok: true });
  });

  // W3.1: fires when a user submits an NPS score.
  // Body: { userId: string; email: string; firstName?: string; score: number }
  // If score ≤ 6 and dedup passes, sends the invite immediately.
  app.post("/internal/save-interview/nps-score", async (c) => {
    if (!verifyInternalSecret(c.req.header("x-internal-secret"), c.env.INTERNAL_API_SECRET)) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const body = await c.req.json<{
      userId: string;
      email: string;
      firstName?: string;
      score: number;
    }>();
    if (!body?.userId || !body?.email || typeof body?.score !== "number") {
      return c.json({ error: "userId, email, and score required" }, 400);
    }

    const isDetractor = await recordNpsScore(c.env.INTERVIEWS_KV, body.userId, body.score);
    await trackUser(c.env.INTERVIEWS_KV, body.userId);

    if (!isDetractor) {
      return c.json({ ok: true, invited: false });
    }

    const result = await maybeInviteUser(
      {
        ENVIRONMENT: c.env.ENVIRONMENT,
        INTERVIEWS_KV: c.env.INTERVIEWS_KV,
        RESEND_API_KEY: c.env.RESEND_API_KEY,
        SCHEDULING_LINK: c.env.SCHEDULING_LINK,
        FROM_EMAIL: c.env.FROM_EMAIL,
        POSTHOG_API_KEY: c.env.POSTHOG_API_KEY,
        POSTHOG_HOST: c.env.POSTHOG_HOST,
      },
      { userId: body.userId, email: body.email, firstName: body.firstName },
    );

    return c.json({ ok: true, invited: result.sent, reason: result.reason });
  });

  // Manual trigger for test users — protected behind INTERNAL_API_SECRET.
  // Body: { userId: string; email: string; firstName?: string }
  app.post("/internal/save-interview/trigger", async (c) => {
    if (!verifyInternalSecret(c.req.header("x-internal-secret"), c.env.INTERNAL_API_SECRET)) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const body = await c.req.json<{ userId: string; email: string; firstName?: string }>();
    if (!body?.userId || !body?.email) {
      return c.json({ error: "userId and email required" }, 400);
    }

    const result = await maybeInviteUser(
      {
        ENVIRONMENT: c.env.ENVIRONMENT,
        INTERVIEWS_KV: c.env.INTERVIEWS_KV,
        RESEND_API_KEY: c.env.RESEND_API_KEY,
        SCHEDULING_LINK: c.env.SCHEDULING_LINK,
        FROM_EMAIL: c.env.FROM_EMAIL,
        POSTHOG_API_KEY: c.env.POSTHOG_API_KEY,
        POSTHOG_HOST: c.env.POSTHOG_HOST,
      },
      { userId: body.userId, email: body.email, firstName: body.firstName },
    );

    return c.json({ ok: true, invited: result.sent, reason: result.reason });
  });

  // Status check: get the current save-interview state for a user.
  app.get("/internal/save-interview/status/:userId", async (c) => {
    if (!verifyInternalSecret(c.req.header("x-internal-secret"), c.env.INTERNAL_API_SECRET)) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const { userId } = c.req.param();
    const [lastEvent, npsRaw, inviteRaw] = await Promise.all([
      c.env.INTERVIEWS_KV.get(`user:${userId}:last_value_event`),
      c.env.INTERVIEWS_KV.get(`user:${userId}:nps`),
      c.env.INTERVIEWS_KV.get(`user:${userId}:save_invite`),
    ]);

    return c.json({
      userId,
      lastValueEvent: lastEvent ?? null,
      nps: npsRaw ? JSON.parse(npsRaw) : null,
      saveInvite: inviteRaw ? JSON.parse(inviteRaw) : null,
    });
  });
}

function verifyInternalSecret(provided: string | undefined, expected: string | undefined): boolean {
  if (!expected || !provided) return false;
  return provided === expected;
}
