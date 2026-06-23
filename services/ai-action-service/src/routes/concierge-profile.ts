/**
 * GET   /concierge/profile/:userId            — read user profile (FE contract YOU-896).
 * PUT   /concierge/profile/:userId/prefs      — full-replace prefs (legacy, kept for compat).
 * PATCH /concierge/profile/:userId/preferences — partial-merge prefs (YOU-896 FE contract).
 *
 * ## Response contract for GET (YOU-896)
 *
 * Note: endpoint lives at /concierge/profile/:userId (not /api/user/profile/:userId).
 * The /concierge/* prefix shares CONCIERGE_DEMO_SECRET auth middleware.
 *
 * Response 200:
 * {
 *   userId: string,
 *   firstName: string,
 *   isReturning: boolean,
 *   tripHistory: Array<{
 *     tripId: string,
 *     destination: string,
 *     dates: string,
 *     highlightVenues: string[]
 *   }>,
 *   preferences: {
 *     airline: string, seatPreference: string, hotelChain: string,
 *     cabinClass: string, homeAirport: string, travelStyle: string,
 *     dietaryPrefs: string[], pace: string, budgetBand: string, interests: string[]
 *   }
 * }
 *
 * Response 404: { error: "No profile found" }
 * Response 503: { error: "Memory store not available" }
 *
 * ## PATCH /concierge/profile/:userId/preferences (YOU-896)
 *
 * Body (all fields optional — merged with existing prefs):
 * {
 *   airline?: string, seatPreference?: string, hotelChain?: string,
 *   cabinClass?: string, homeAirport?: string, travelStyle?: string,
 *   dietaryPrefs?: string[], pace?: string, budgetBand?: string,
 *   interests?: string[], firstName?: string
 * }
 * Response 200: { ok: true }
 */

import type { Hono } from "hono";
import type { Env, Variables } from "../index.js";
import {
  getUserProfile,
  savePreferences,
  toProfileResponse,
  type UserPreferences,
} from "../lib/user-memory.js";

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

    return c.json(toProfileResponse(profile));
  });

  // PATCH — partial prefs merge (FE prefs sheet close handler, YOU-896)
  app.patch("/concierge/profile/:userId/preferences", async (c) => {
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

  // PUT — legacy full-replace (kept for backward compat)
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
