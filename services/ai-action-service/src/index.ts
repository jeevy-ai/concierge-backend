import type { ClerkClaims } from "@jeevy/entitlement";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { runDailyAtRiskScan } from "./lib/save-interview.js";
import { clerkAuthMiddleware, entitlementGuard } from "./middleware/entitlement.js";
import { registerCalendarWorkflowRoutes } from "./routes/calendar-workflow.js";
import { registerDemoRoutes } from "./routes/demo.js";
import { registerOutreachRoutes } from "./routes/outreach.js";
import { registerSaveInterviewRoutes } from "./routes/save-interview.js";
import { registerStripeWebhookRoute } from "./routes/stripe-webhook.js";

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
  CLERK_SECRET_KEY: string;
  // KV namespace for policy engine kill-switch: concierge.external_actions.enabled
  POLICY_KV: KVNamespace;
  // KV namespace for workflow orchestrator + circuit breaker state (Scenario 3)
  CONCIERGE_KV: KVNamespace;
  // TTFV event emission (W2.5a / YOU-453)
  SENTRY_DSN?: string;
  GOOGLE_SERVICE_ACCOUNT_JSON?: string;
  INTAKE_SHEET_ID?: string;
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

// Outreach adapter with policy engine (internal, secret-gated)
registerOutreachRoutes(app);

// Calendar workflow orchestrator + circuit breaker (Scenario 3, internal, secret-gated)
registerCalendarWorkflowRoutes(app);

// Demo routes — sandbox only, no auth, blocked in production (board Wave 0 test pass)
registerDemoRoutes(app);

// Protected routes require Clerk auth + active Stripe subscription
const protected_ = app.use("/api/protected/*", clerkAuthMiddleware(), entitlementGuard());

protected_.get("/api/protected/test", (c) => {
  return c.json({ ok: true, userId: c.get("clerkUserId") });
});

interface ClerkUser {
  id: string;
  first_name: string | null;
  email_addresses: Array<{ email_address: string }>;
}

async function fetchClerkUserById(
  userId: string,
  secretKey: string,
): Promise<{ userId: string; email: string; firstName?: string } | null> {
  const res = await fetch(`https://api.clerk.com/v1/users/${userId}`, {
    headers: { Authorization: `Bearer ${secretKey}` },
  });
  if (!res.ok) return null;
  const user = (await res.json()) as ClerkUser;
  const email = user.email_addresses[0]?.email_address;
  if (!email) return null;
  return {
    userId: user.id,
    email,
    ...(user.first_name ? { firstName: user.first_name } : {}),
  };
}

/**
 * Cloudflare Cron trigger: nightly at-risk user scan.
 * Configured in wrangler.toml: [triggers] crons = ["0 2 * * *"]
 */
async function scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
  const result = await runDailyAtRiskScan(
    {
      ENVIRONMENT: env.ENVIRONMENT,
      INTERVIEWS_KV: env.INTERVIEWS_KV,
      RESEND_API_KEY: env.RESEND_API_KEY,
      SCHEDULING_LINK: env.SCHEDULING_LINK,
      FROM_EMAIL: env.FROM_EMAIL,
      POSTHOG_API_KEY: env.POSTHOG_API_KEY,
      POSTHOG_HOST: env.POSTHOG_HOST,
    },
    async (userId) => fetchClerkUserById(userId, env.CLERK_SECRET_KEY),
  );

  console.log(`[save-interview] nightly scan: ${result.invited}/${result.processed} invited`);
}

export default {
  fetch: app.fetch,
  scheduled,
};
