/**
 * GET  /concierge/profile/:userId — read user trip history + preferences.
 * PUT  /concierge/profile/:userId/prefs — update stated preferences.
 *
 * YOU-893: Persistence layer read endpoint. FE/UX calls this to render
 * "based on your last trip" affordances. Auth is via CONCIERGE_DEMO_SECRET
 * (same middleware as the itinerary endpoints).
 *
 * ## Contract (for UXDesigner)
 *
 * GET /concierge/profile/:userId
 *   Response 200:
 *   {
 *     userId: string,
 *     prefs: {
 *       pace?: "relaxed" | "active" | "intense",
 *       budgetBand?: string,
 *       interests?: string[],
 *       dietaryPrefs?: string[],
 *       travelStyle?: string,
 *       homeCity?: string
 *     },
 *     trips: Array<{
 *       destination: string,
 *       dates: string,
 *       summary: string,
 *       savedAt: string   // ISO-8601
 *     }>
 *   }
 *
 *   Response 404: { error: "No profile found" }
 *   Response 503: { error: "Memory store not available" }  (CONCIERGE_KV unbound)
 *
 * PUT /concierge/profile/:userId/prefs
 *   Body: Partial<UserPreferences>
 *   Response 200: { ok: true }
 */

import type { Hono } from "hono";
import type { Env, Variables } from "../index.js";
import { getUserProfile, savePreferences, type UserPreferences } from "../lib/user-memory.js";

export function registerConciergeProfileRoute(
  app: Hono<{ Bindings: Env; Variables: Variables }>,
): void {
  app.get("/concierge/profile/:userId", async (c) => {
    if (!c.env.CONCIERGE_KV) {
      return c.json({ error: "Memory store not available" }, 503);
    }
    const { userId } = c.req.param();
    if (!userId?.trim()) return c.json({ error: "userId required" }, 400);

    const profile = await getUserProfile(c.env.CONCIERGE_KV, userId);
    if (!profile) return c.json({ error: "No profile found" }, 404);

    return c.json(profile);
  });

  app.put("/concierge/profile/:userId/prefs", async (c) => {
    if (!c.env.CONCIERGE_KV) {
      return c.json({ error: "Memory store not available" }, 503);
    }
    const { userId } = c.req.param();
    if (!userId?.trim()) return c.json({ error: "userId required" }, 400);

    let prefs: Partial<UserPreferences>;
    try {
      prefs = await c.req.json<Partial<UserPreferences>>();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    await savePreferences(c.env.CONCIERGE_KV, userId, prefs);
    return c.json({ ok: true });
  });
}
