import type { ClerkClaims } from "@jeevy/entitlement";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { runDailyAtRiskScan } from "./lib/save-interview.js";
import { clerkAuthMiddleware, entitlementGuard } from "./middleware/entitlement.js";
import { registerConciergeAlterRoute } from "./routes/concierge-alter.js";
import { registerConciergeItineraryRoute } from "./routes/concierge-itinerary.js";
import { registerConciergeMe } from "./routes/concierge-me.js";
import { registerConciergeProfileRoute } from "./routes/concierge-profile.js";
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
  // Concierge user memory: trip history + preference signals (YOU-893).
  CONCIERGE_KV?: KVNamespace;
  RESEND_API_KEY: string;
  SCHEDULING_LINK: string;
  FROM_EMAIL: string;
  INTERNAL_API_SECRET: string;
  // Shared secret for public /concierge/* demo endpoints (set via `wrangler secret put CONCIERGE_DEMO_SECRET`).
  // Also hardcoded in public/solo-travel-demo.html. CORS + rate limiting are the primary defenses.
  CONCIERGE_DEMO_SECRET: string;
  CLERK_SECRET_KEY: string;
  // AI provider keys for POST /concierge/itinerary (YOU-681 / YOU-686).
  // Provider priority: ANTHROPIC_API_KEY → Anthropic; VERTEX_SA_JSON + GCP_PROJECT_ID → Gemini on Vertex.
  ANTHROPIC_API_KEY?: string;
  // Interim provider: Gemini on Vertex AI (active until Anthropic key is approved).
  VERTEX_SA_JSON?: string;   // GCP service-account JSON blob
  GCP_PROJECT_ID?: string;   // GCP project that has Vertex AI enabled
  // YOU-913 Phase 8: Neon Postgres connection string for durable per-account butler persistence.
  // Set via: wrangler secret put NEON_DATABASE_URL --env production
  // Schema: db/schema.sql
  NEON_DATABASE_URL?: string;
};

export type Variables = {
  clerkUserId: string;
  clerkClaims: ClerkClaims;
};

export const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// Restrict CORS to known demo origins. Wildcard removed (F3 — YOU-866).
const ALLOWED_ORIGINS = [
  "https://travel-flow.pages.dev",
  "https://jeevy.app",
  "https://www.jeevy.app",
];

app.use(
  "*",
  cors({
    origin: (origin) => {
      if (!origin) return "";
      if (ALLOWED_ORIGINS.includes(origin)) return origin;
      // Allow localhost for local development.
      if (origin.startsWith("http://localhost:") || origin.startsWith("http://127.0.0.1:")) {
        return origin;
      }
      return "";
    },
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "x-internal-secret", "x-internal-api-secret", "x-concierge-secret"],
    exposeHeaders: ["x-correlation-id"],
  }),
);

// Per-IP rate limiter for /concierge/* using KV token bucket (F3 — YOU-866).
// Limit: 30 requests per 60-second window per IP. Not atomic but sufficient for demo traffic.
async function conciergeRateLimit(ip: string, kv: KVNamespace): Promise<boolean> {
  const key = `rate:concierge:${ip}`;
  const WINDOW_MS = 60_000;
  const MAX_REQUESTS = 30;
  const now = Date.now();

  type Bucket = { count: number; windowStart: number };
  const stored = await kv.get<Bucket>(key, "json");

  if (!stored || now - stored.windowStart > WINDOW_MS) {
    await kv.put(key, JSON.stringify({ count: 1, windowStart: now }), { expirationTtl: 120 });
    return true;
  }
  if (stored.count >= MAX_REQUESTS) return false;
  await kv.put(
    key,
    JSON.stringify({ count: stored.count + 1, windowStart: stored.windowStart }),
    { expirationTtl: 120 },
  );
  return true;
}

// Auth + rate-limit middleware for /concierge/* (F3 — YOU-866).
// /concierge/me/* is exempt: those routes carry their own Clerk JWT auth (YOU-913).
// OPTIONS preflight is always exempt; CORS headers are set by the cors() middleware above.
app.use("/concierge/*", async (c, next) => {
  if (c.req.method === "OPTIONS") return next();

  // Authenticated routes handle their own auth via Clerk JWT middleware.
  if (c.req.path.startsWith("/concierge/me")) return next();

  // All other /concierge/* routes require the shared demo secret.
  const provided = c.req.header("x-concierge-secret") ?? c.req.header("x-internal-api-secret");
  const expected = c.env.CONCIERGE_DEMO_SECRET;
  if (!expected || !provided || provided !== expected) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const ip = c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for") ?? "unknown";
  const allowed = await conciergeRateLimit(ip, c.env.ENTITLEMENTS_KV);
  if (!allowed) {
    return c.json({ error: "Rate limit exceeded — try again in a minute." }, 429);
  }

  return next();
});

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

// AI butler: conversational travel itinerary planner (YOU-681)
registerConciergeItineraryRoute(app);
registerConciergeAlterRoute(app);

// YOU-913 Phase 8: authenticated per-account butler endpoints (Clerk JWT + Neon).
registerConciergeMe(app);

// Legacy demo profile routes (KV-backed, CONCIERGE_DEMO_SECRET auth).
registerConciergeProfileRoute(app);

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
