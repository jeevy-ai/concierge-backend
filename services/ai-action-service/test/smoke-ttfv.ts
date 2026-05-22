/**
 * TTFV Spec §9 Integration Smoke Test
 *
 * Prerequisites (set in .dev.vars or env before running):
 *   SENTRY_AUTH_TOKEN      — Sentry API token (read events to assert delivery)
 *   SENTRY_ORG             — Sentry org slug (e.g. "jeevy")
 *   SENTRY_PROJECT         — Sentry project slug (e.g. "ai-action-service")
 *   GOOGLE_SERVICE_ACCOUNT_JSON — base64-encoded service account JSON
 *   INTAKE_SHEET_ID        — Google Sheets spreadsheet ID
 *   SMOKE_ENDPOINT         — base URL of running service (default: http://localhost:8787)
 *   INTERNAL_API_SECRET    — value of INTERNAL_API_SECRET on running service
 *
 * KV seeding — one of:
 *   Option A (dynamic, CF creds required):
 *     CLOUDFLARE_EMAIL       — CF account email
 *     CLOUDFLARE_API_KEY     — CF Global API Key
 *     CF_ACCOUNT_ID          — CF account ID (default: 4bad758433de05f8b1b18c44be5a534c)
 *     CF_CONCIERGE_KV_NS     — CONCIERGE_KV staging namespace (default: 3869105e18f240029c504a3762814531)
 *   Option B (pre-seeded, no CF creds needed):
 *     SMOKE_FIXED_USER_ID    — pre-seeded user ID in CONCIERGE_KV (e.g. "smoke-ttfv-fixed-001")
 *
 * Run with:
 *   pnpm exec tsx test/smoke-ttfv.ts
 */

import { google } from "googleapis";

const ENDPOINT = process.env["SMOKE_ENDPOINT"] ?? "http://localhost:8787";
const CF_ACCOUNT_ID = process.env["CF_ACCOUNT_ID"] ?? "4bad758433de05f8b1b18c44be5a534c";
const CF_CONCIERGE_KV_NS = process.env["CF_CONCIERGE_KV_NS"] ?? "3869105e18f240029c504a3762814531";

// User identity — dynamic unless SMOKE_FIXED_USER_ID is set
const ts = Date.now();
const SYNTHETIC_USER_ID = process.env["SMOKE_FIXED_USER_ID"] ?? `smoke-ttfv-${ts}`;
const SYNTHETIC_USER_EMAIL = `${SYNTHETIC_USER_ID}@jeevy-test.internal`;

// Sandbox-only fixture event ID (see src/adapters/google-calendar.ts SANDBOX_EVENTS)
const SANDBOX_EVENT_ID = "CAL-01";
const INTAKE_SUBMITTED_AT = new Date(ts - 2 * 60 * 60 * 1000).toISOString(); // 2h ago

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Seed synthetic user into CONCIERGE_KV staging with status=active (paid user gate).
// Prefers CF API if credentials available, falls back to Worker demo endpoint (non-prod only).
async function seedEntitlement(): Promise<void> {
  const cfEmail = process.env["CLOUDFLARE_EMAIL"];
  const cfKey = process.env["CLOUDFLARE_API_KEY"];

  if (cfEmail && cfKey) {
    const kvKey = `entitlement:${SYNTHETIC_USER_ID}`;
    const record = JSON.stringify({
      stripeCustomerId: "cus_smoke_ttfv",
      stripeSubscriptionId: "sub_smoke_ttfv",
      status: "active",
      plan: "pro",
      periodEnd: 9999999999,
      updatedAt: new Date().toISOString(),
    });
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${CF_CONCIERGE_KV_NS}/values/${encodeURIComponent(kvKey)}`,
      {
        method: "PUT",
        headers: { "X-Auth-Email": cfEmail, "X-Auth-Key": cfKey, "Content-Type": "text/plain" },
        body: record,
      },
    );
    const json = await res.json() as { success: boolean; errors?: Array<{ message: string }> };
    if (!json.success) {
      throw new Error(`CF KV seed failed: ${JSON.stringify(json.errors)}`);
    }
    return;
  }

  // Fallback: use Worker's demo seed endpoint (blocked in production by design)
  console.log(`  No CF creds — seeding via ${ENDPOINT}/api/demo/seed-entitlement`);
  const res = await fetch(`${ENDPOINT}/api/demo/seed-entitlement`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: SYNTHETIC_USER_ID }),
  });
  if (!res.ok) {
    throw new Error(`Demo seed-entitlement failed ${res.status}: ${await res.text()}`);
  }
  const json = await res.json() as { ok: boolean; key?: string };
  if (!json.ok) {
    throw new Error(`Demo seed-entitlement returned ok=false`);
  }
}

// Pre-populate CRM-lite sheet with synthetic user's email (col D) — required for writeTTFV to find row
async function seedCRMLiteRow(): Promise<void> {
  const saJson = Buffer.from(requireEnv("GOOGLE_SERVICE_ACCOUNT_JSON"), "base64").toString("utf-8");
  const credentials = JSON.parse(saJson);
  const auth = new google.auth.GoogleAuth({ credentials, scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = requireEnv("INTAKE_SHEET_ID");

  // Check if user already in sheet
  const existing = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Tracker!A:D" });
  const rows = existing.data.values ?? [];
  const alreadyExists = rows.some((r) => r[3]?.toLowerCase() === SYNTHETIC_USER_EMAIL.toLowerCase());
  if (alreadyExists) {
    console.log(`  Row already exists for ${SYNTHETIC_USER_EMAIL}`);
    return;
  }

  // Append new row with email in col D (cols A-C = stub data)
  const nextRow = rows.length + 1;
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `Tracker!A${nextRow}:D${nextRow}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [["smoke-ttfv", "Smoke Test User", "jeevy-test.internal", SYNTHETIC_USER_EMAIL]] },
  });
  console.log(`  Seeded CRM-lite row ${nextRow}: email=${SYNTHETIC_USER_EMAIL}`);
}

// §9.1 — Trigger calendar.event_created action via orchestrator
async function triggerAction(opts: { isTest: boolean; correlationId: string }): Promise<unknown> {
  const res = await fetch(`${ENDPOINT}/internal/workflow/calendar/reschedule`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-secret": requireEnv("INTERNAL_API_SECRET"),
      "x-correlation-id": opts.correlationId,
    },
    body: JSON.stringify({
      operatorId: SYNTHETIC_USER_ID,
      eventId: SANDBOX_EVENT_ID, // Must be a known fixture ID — sandbox rejects unknown IDs
      newStartIso: new Date(ts + 60 * 60 * 1000).toISOString(),
      newEndIso: new Date(ts + 2 * 60 * 60 * 1000).toISOString(),
      reason: "TTFV smoke test",
      userEmail: SYNTHETIC_USER_EMAIL,
      intakeSubmittedAt: INTAKE_SUBMITTED_AT,
      successCriterionId: "sc_smoke_001",
      isTest: opts.isTest,
    }),
  });

  if (!res.ok) {
    throw new Error(`Orchestrator returned ${res.status}: ${await res.text()}`);
  }

  return res.json();
}

// §9.3 — Assert concierge.action.delivered event in Sentry
// Looks up via Issues endpoint (project:read on /events/ is not granted to org User Auth Tokens;
// /issues/ works with the default org-scope user token). We find the matching issue by tag query,
// then fetch its latest event for context/tag validation.
async function assertSentryEvent(correlationId: string): Promise<unknown> {
  const authToken = requireEnv("SENTRY_AUTH_TOKEN");
  const org = requireEnv("SENTRY_ORG");
  const project = requireEnv("SENTRY_PROJECT");

  // Retry up to 8 times — Sentry tag-search indexing can take 20–30s after ingest
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= 8; attempt++) {
    await sleep(5000);

    const url = `https://sentry.io/api/0/projects/${org}/${project}/issues/?query=${encodeURIComponent(`correlation_id:${correlationId}`)}&limit=1`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${authToken}` },
    });

    if (!res.ok) {
      throw new Error(
        `Sentry API error ${res.status}: ${await res.text()}\n` +
        `(If 403: token may need event:read or issue:read on this project)`
      );
    }

    const issues = await res.json() as Array<Record<string, unknown>>;

    if (!Array.isArray(issues) || issues.length === 0) {
      lastError = new Error(`Sentry issue not found for correlationId=${correlationId} (attempt ${attempt}/8)`);
      continue;
    }

    const issueId = issues[0]?.["id"] as string;
    if (!issueId) {
      throw new Error(`Sentry issue response missing id: ${JSON.stringify(issues[0])}`);
    }

    // Fetch latest event for this issue for context/tag validation
    const fullRes = await fetch(`https://sentry.io/api/0/issues/${issueId}/events/latest/`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    if (!fullRes.ok) {
      throw new Error(`Sentry latest event fetch error ${fullRes.status}: ${await fullRes.text()}`);
    }
    const event = await fullRes.json() as Record<string, unknown>;

    // Validate all required fields per spec §4
    const ctx = (event["contexts"] as Record<string, unknown>)?.["action_delivered"] as Record<string, unknown>;
    const tags = event["tags"] as Array<{ key: string; value: string }>;

    const requiredFields = ["user_id", "action_type", "correlation_id", "triggered_by", "success", "is_test"];
    for (const field of requiredFields) {
      if (ctx?.[field] === undefined) {
        throw new Error(`Sentry event missing required field: contexts.action_delivered.${field}`);
      }
    }

    const tagMap = Object.fromEntries((tags ?? []).map((t) => [t.key, t.value]));
    if (tagMap["action_type"] !== "calendar.event_created") {
      throw new Error(`Sentry tag action_type wrong: ${tagMap["action_type"]}`);
    }
    if (tagMap["is_test"] !== "true") {
      throw new Error(`Sentry tag is_test wrong: ${tagMap["is_test"]}`);
    }

    return event;
  }

  throw lastError ?? new Error(`Sentry event not found for correlationId=${correlationId} after 8 attempts`);
}

// §9.4 + §9.6 — Verify CRM-lite row first_action_delivered_at + ttfv_hours
async function getCRMLiteRow(): Promise<{
  rowIndex: number;
  firstActionDeliveredAt: string | null;
  ttfvHours: number | null;
}> {
  const saJson = Buffer.from(requireEnv("GOOGLE_SERVICE_ACCOUNT_JSON"), "base64").toString("utf-8");
  const credentials = JSON.parse(saJson);
  const auth = new google.auth.GoogleAuth({ credentials, scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = requireEnv("INTAKE_SHEET_ID");

  const emailsRes = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Tracker!A:D" });
  const rows = emailsRes.data.values ?? [];
  let rowIndex = -1;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i]?.[3]?.toLowerCase() === SYNTHETIC_USER_EMAIL.toLowerCase()) { rowIndex = i; break; }
  }
  if (rowIndex === -1) throw new Error(`Synthetic user not found in CRM-lite sheet: ${SYNTHETIC_USER_EMAIL}`);

  const ttfvRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `Tracker!N${rowIndex + 1}:O${rowIndex + 1}`,
  });
  const vals = ttfvRes.data.values?.[0] ?? [];
  return {
    rowIndex,
    firstActionDeliveredAt: (vals[0] as string) ?? null,
    ttfvHours: vals[1] !== undefined ? parseFloat(vals[1] as string) : null,
  };
}

async function runSmokeTest(): Promise<void> {
  console.log("=== TTFV Spec §9 Smoke Test ===\n");
  console.log(`Endpoint: ${ENDPOINT}`);
  console.log(`Synthetic user ID: ${SYNTHETIC_USER_ID}`);
  console.log(`Synthetic user email: ${SYNTHETIC_USER_EMAIL}`);
  console.log(`Intake submitted at: ${INTAKE_SUBMITTED_AT}\n`);

  // §9.0a — Seed synthetic paid user into CONCIERGE_KV staging (or use pre-seeded)
  console.log("Step 0a: Seeding synthetic paid user into CONCIERGE_KV...");
  await seedEntitlement();
  console.log(`  ✓ Entitlement ready: entitlement:${SYNTHETIC_USER_ID} → status=active\n`);

  // §9.0b — Pre-populate CRM-lite sheet row so writeTTFV can find the user
  console.log("Step 0b: Pre-populating CRM-lite sheet row...");
  await seedCRMLiteRow();
  console.log(`  ✓ CRM-lite sheet row ready\n`);

  // §9.1 + §9.2 — Trigger first action (is_test=true to avoid polluting TTFV cohort)
  console.log("Step 1: Triggering first calendar.event_created action (is_test=true)...");
  const corrId1 = `smoke-corr-${ts}-1`;
  const result1 = await triggerAction({ isTest: true, correlationId: corrId1 });
  console.log(`  ✓ Orchestrator completed. correlation_id=${corrId1}`);
  console.log(`  Session: ${JSON.stringify((result1 as Record<string, unknown>)["session"] ?? result1, null, 2)}\n`);

  // §9.3 — Assert Sentry event
  console.log("Step 2: Asserting concierge.action.delivered event in Sentry...");
  const sentryEvent = await assertSentryEvent(corrId1);
  console.log(`  ✓ Sentry event found. correlation_id=${corrId1} (looked up by tag)`);
  console.log(`  Required fields all present: user_id, action_type, correlation_id, triggered_by, success, is_test`);
  console.log(`  Sentry event JSON:\n${JSON.stringify(sentryEvent, null, 2)}\n`);

  // §9.4 — Verify CRM-lite row
  console.log("Step 3: Verifying CRM-lite row...");
  const rowBefore = await getCRMLiteRow();
  if (!rowBefore.firstActionDeliveredAt) {
    throw new Error("first_action_delivered_at NOT set after first action — write failed");
  }
  if (rowBefore.ttfvHours === null || rowBefore.ttfvHours <= 0) {
    throw new Error(`ttfv_hours invalid: ${rowBefore.ttfvHours}`);
  }
  console.log(`  ✓ CRM-lite row updated:`);
  console.log(`    first_action_delivered_at: ${rowBefore.firstActionDeliveredAt}`);
  console.log(`    ttfv_hours: ${rowBefore.ttfvHours}\n`);

  // §9.5 — Cohort query: synthetic user should appear with ttfv_hours > 0
  console.log("Step 4: Cohort query (Google Sheets direct verification)...");
  console.log(`  ✓ User appears in CRM-lite with ttfv_hours=${rowBefore.ttfvHours} > 0`);
  console.log(`  (Spec §8 SQL cohort query maps to Sheets row check since CRM-lite = Google Sheets)\n`);

  // §9.6 — Re-trigger → first-write-wins
  console.log("Step 5: Re-triggering action to verify first-write-wins...");
  const corrId2 = `smoke-corr-${ts}-2`;
  await sleep(500); // ensure different timestamp
  await triggerAction({ isTest: true, correlationId: corrId2 });
  console.log(`  Triggered second action. correlation_id=${corrId2}`);

  const rowAfter = await getCRMLiteRow();
  if (rowAfter.firstActionDeliveredAt !== rowBefore.firstActionDeliveredAt) {
    throw new Error(
      `first-write-wins VIOLATED: value changed from ${rowBefore.firstActionDeliveredAt} to ${rowAfter.firstActionDeliveredAt}`,
    );
  }
  if (rowAfter.ttfvHours !== rowBefore.ttfvHours) {
    throw new Error(`first-write-wins VIOLATED: ttfv_hours changed from ${rowBefore.ttfvHours} to ${rowAfter.ttfvHours}`);
  }
  console.log(`  ✓ first-write-wins confirmed: first_action_delivered_at unchanged after second trigger`);
  console.log(`    value remains: ${rowAfter.firstActionDeliveredAt}\n`);

  console.log("=== ALL CHECKS PASSED ===");
  console.log("\nEvidence summary:");
  console.log(`  1. Sentry event: correlation_id=${corrId1} (tag), all required fields present`);
  console.log(`  2. CRM-lite: first_action_delivered_at=${rowBefore.firstActionDeliveredAt}, ttfv_hours=${rowBefore.ttfvHours}`);
  console.log(`  3. First-write-wins: re-trigger did not overwrite`);
}

runSmokeTest().catch((err) => {
  console.error("\n=== SMOKE TEST FAILED ===");
  console.error(err.message);
  process.exit(1);
});
