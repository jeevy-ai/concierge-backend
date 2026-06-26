/**
 * YOU-913: Clerk JWT middleware for authenticated concierge routes.
 *
 * Verifies a Clerk Bearer JWT and stores userId in context.
 * Used on /concierge/me/* routes; separate from the entitlement guard
 * (no Stripe subscription required for the travel butler).
 */

import { verifyClerkJwt } from "@jeevy/entitlement";
import type { MiddlewareHandler } from "hono";
import type { Env, Variables } from "../index.js";

type HonoCtx = { Bindings: Env; Variables: Variables };

export function clerkConciergeAuth(): MiddlewareHandler<HonoCtx> {
  return async (c, next) => {
    if (!c.env.CLERK_JWKS_URL) {
      return c.json({ error: "Auth service not configured", code: "auth/unconfigured" }, 503);
    }

    const auth = c.req.header("authorization");
    if (!auth?.startsWith("Bearer ")) {
      return c.json({ error: "Missing Bearer token", code: "auth/unauthenticated" }, 401);
    }

    const token = auth.slice(7);
    try {
      const claims = await verifyClerkJwt(token, c.env.CLERK_JWKS_URL);
      c.set("clerkUserId", claims.sub);
      c.set("clerkClaims", claims);
    } catch {
      return c.json({ error: "Invalid or expired token", code: "auth/invalid_token" }, 401);
    }

    return next();
  };
}
