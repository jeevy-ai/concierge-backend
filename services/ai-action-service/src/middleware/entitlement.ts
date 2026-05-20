import { makeError } from "@jeevy/contracts";
import { type ClerkClaims, checkEntitlement, verifyClerkJwt } from "@jeevy/entitlement";
import type { MiddlewareHandler } from "hono";
import type { Env, Variables } from "../index.js";

type HonoCtx = { Bindings: Env; Variables: Variables };

/**
 * Verifies the Clerk Bearer JWT and sets clerkUserId + clerkClaims in context.
 * Returns 401 if the token is missing or invalid.
 */
export function clerkAuthMiddleware(): MiddlewareHandler<HonoCtx> {
  return async (c, next) => {
    const correlationId = c.req.header("x-correlation-id") ?? crypto.randomUUID();
    c.res.headers.set("x-correlation-id", correlationId);

    const auth = c.req.header("authorization");
    if (!auth?.startsWith("Bearer ")) {
      return c.json(
        makeError("auth", "auth/unauthenticated", "Missing Bearer token", correlationId),
        401,
      );
    }

    const token = auth.slice(7);
    let claims: ClerkClaims;
    try {
      claims = await verifyClerkJwt(token, c.env.CLERK_JWKS_URL);
    } catch {
      return c.json(
        makeError("auth", "auth/invalid_token", "Invalid or expired Clerk token", correlationId),
        401,
      );
    }

    c.set("clerkUserId", claims.sub);
    c.set("clerkClaims", claims);
    await next();
  };
}

/**
 * Requires an active Stripe subscription for the authenticated user.
 * Returns 402 if the user has no active subscription.
 * Must be applied after clerkAuthMiddleware.
 */
export function entitlementGuard(): MiddlewareHandler<HonoCtx> {
  return async (c, next) => {
    const correlationId = c.req.header("x-correlation-id") ?? crypto.randomUUID();
    c.res.headers.set("x-correlation-id", correlationId);

    const clerkUserId = c.get("clerkUserId");
    if (!clerkUserId) {
      return c.json(
        makeError("auth", "auth/unauthenticated", "Not authenticated", correlationId),
        401,
      );
    }

    const state = await checkEntitlement(
      clerkUserId,
      c.env.ENTITLEMENTS_KV as unknown as import("@jeevy/entitlement").KVStore,
    );
    if (!state.subscribed) {
      return c.json(
        makeError(
          "auth/forbidden",
          "billing/unsubscribed",
          `Subscription required: ${state.reason}`,
          correlationId,
        ),
        402,
      );
    }

    await next();
  };
}
