import { Hono } from "hono";
import { cors } from "hono/cors";
import type { ClerkClaims } from "@jeevy/entitlement";
import { clerkAuthMiddleware, entitlementGuard } from "./middleware/entitlement.js";
import { registerStripeWebhookRoute } from "./routes/stripe-webhook.js";
import { registerSaveInterviewRoutes } from "./routes/save-interview.js";
import { runDailyAtRiskScan } from "./lib/save-interview.js";

export type Env = {
  ENVIRONMENT: string;
  CLERK_JWKS_URL: string;
  STRIPE_WEBHOOK_SECRET: string;
  STRIPE_SECRET_KEY: string;
  POSTHOG_API_KEY: string;
  POSTHOG_HOST: string;
  // KV namespace — binding declared in wrangler.toml as [[kv_namespaces]] name = "ENTITLEMENTS_KV"
  ENTITLEMENTS_KV: KVNamespace;
  // Save-interview bindings — see wrangler.toml for provisioning instructions
  INTERVIEWS_KV: KVNamespace;
  RESEND_API_KEY: string;
  SCHEDULING_LINK: string;
  FROM_EMAIL: string;
  INTERNAL_API_SECRET: string;
};

export type Variables = {
  clerkUserId: string;
  clerkClaims: ClerkClaims;
};

export const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use("*", cors());

app.get("/health", (c) => {
  return c.json({ ok: true, service: "ai-action-service", version: "0.1.0" });
});

// Public action list (no auth required)
app.get("/api/actions", (c) => {
  return c.json({ actions: [], message: "Action service ready" });
});

// Stripe webhook — public but signature-verified
registerStripeWebhookRoute(app);

// Save-interview event ingestion (internal service-to-service, secret-gated)
registerSaveInterviewRoutes(app);

// Protected routes require Clerk auth + active Stripe subscription
const protected_ = app.use(
  "/api/protected/*",
  clerkAuthMiddleware(),
  entitlementGuard(),
);

protected_.get("/api/protected/test", (c) => {
  return c.json({ ok: true, userId: c.get("clerkUserId") });
});

/**
 * Cloudflare Cron trigger: nightly at-risk user scan.
 * Configured in wrangler.toml: [triggers] crons = ["0 2 * * *"]
 *
 * User profile lookup (email/firstName) is stubbed — wire to Clerk API once
 * user directory integration exists. For test users use the manual
 * POST /internal/save-interview/trigger endpoint which accepts full user data.
 */
async function scheduled(
  _event: ScheduledEvent,
  env: Env,
  _ctx: ExecutionContext,
): Promise<void> {
  const result = await runDailyAtRiskScan(
    {
      INTERVIEWS_KV: env.INTERVIEWS_KV,
      RESEND_API_KEY: env.RESEND_API_KEY,
      SCHEDULING_LINK: env.SCHEDULING_LINK,
      FROM_EMAIL: env.FROM_EMAIL,
    },
    async (_userId) => {
      // TODO(YOU-343): resolve user profile from Clerk API once available.
      return null;
    },
  );

  console.log(
    `[save-interview] nightly scan: ${result.invited}/${result.processed} invited`,
  );
}

export default {
  fetch: app.fetch,
  scheduled,
};
