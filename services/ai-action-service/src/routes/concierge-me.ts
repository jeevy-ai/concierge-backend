/**
 * YOU-913: Authenticated per-account butler endpoints.
 * Maps to YOU-4: durable per-user butler memory.
 *
 * All routes require a valid Clerk Bearer JWT.
 * userId always comes from the verified JWT claim — never from caller input.
 *
 * ## API contract (for YOU-914 UX surface)
 *
 * ### GET /concierge/me
 * Auth: Bearer <clerk-jwt>
 * Response 200:
 *   {
 *     userId: string,
 *     firstName: string,
 *     isReturning: boolean,
 *     tripHistory: Array<{ tripId, destination, dates, highlightVenues: string[] }>,
 *     preferences: {
 *       airline, seatPreference, hotelChain, cabinClass, homeAirport,
 *       travelStyle, dietaryPrefs: string[], pace, budgetBand, interests: string[]
 *     }
 *   }
 * Response 404: { error: "No profile found" }
 * Response 503: { error: "Database not configured", code: "db/unconfigured" }
 *
 * ### PATCH /concierge/me/preferences
 * Auth: Bearer <clerk-jwt>
 * Body (all optional — merged with existing prefs):
 *   {
 *     firstName?, airline?, seatPreference?, hotelChain?, cabinClass?,
 *     homeAirport?, travelStyle?, dietaryPrefs?: string[], pace?,
 *     budgetBand?, interests?: string[]
 *   }
 * Response 200: { ok: true }
 * Response 400: { error: "Invalid JSON body" }
 * Response 503: { error: "Database not configured", code: "db/unconfigured" }
 *
 * ### POST /concierge/me/trips  (internal — called by itinerary route on save)
 * This is handled inside concierge-itinerary.ts when the user has a JWT and
 * the itinerary is final. Not a separate public endpoint.
 */

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import type { Hono } from "hono";
import type { Env, Variables } from "../index.js";
import {
  getProfile,
  toProfileResponse,
  upsertPreferences,
  type UserPreferences,
} from "../lib/neon-butler.js";
import { clerkConciergeAuth } from "../middleware/clerk-concierge-auth.js";

export function registerConciergeMe(
  app: Hono<{ Bindings: Env; Variables: Variables }>,
): void {
  // All /concierge/me/* require Clerk JWT
  app.use("/concierge/me/*", clerkConciergeAuth());

  app.get("/concierge/me", async (c) => {
    if (!c.env.NEON_DATABASE_URL) {
      return c.json({ error: "Database not configured", code: "db/unconfigured" }, 503);
    }
    const sql = neon(c.env.NEON_DATABASE_URL);
    const userId = c.get("clerkUserId");

    const profile = await getProfile(sql, userId);
    if (!profile) {
      return c.json({ error: "No profile found" }, 404);
    }
    return c.json(toProfileResponse(profile));
  });

  app.patch("/concierge/me/preferences", async (c) => {
    if (!c.env.NEON_DATABASE_URL) {
      return c.json({ error: "Database not configured", code: "db/unconfigured" }, 503);
    }
    const sql = neon(c.env.NEON_DATABASE_URL);
    const userId = c.get("clerkUserId");

    let prefs: Partial<UserPreferences>;
    try {
      prefs = await c.req.json<Partial<UserPreferences>>();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    await upsertPreferences(sql, userId, prefs);
    return c.json({ ok: true });
  });
}
