import crypto from "node:crypto";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { type ActionDef, type MinimizedTab, type RawTab, minimizeTab } from "./actions/_shared.js";
import { ACTIONS, ACTION_IDS } from "./actions/index.js";

export type Env = {
  ENVIRONMENT: string;
  AUTH_MODE: string;
  AUTH_BEARER_TOKEN: string;
  ANTHROPIC_API_KEY: string;
  ACTION_USE_LLM: string;
  ANTHROPIC_TIMEOUT_MS: string;
  ANTHROPIC_SONNET_MODEL: string;
  ANTHROPIC_HAIKU_MODEL: string;
  // Optional: first_value_delivered instrumentation (absent in dev without CF bindings)
  FIRST_VALUE_KV?: KVNamespace;
  CONCIERGE_ANALYTICS?: AnalyticsEngineDataset;
};

const CONTRACT_VERSION = "2026-05-03";
const MAX_TABS = 60;
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

type IdempotencyEntry = { storedAt: number; response: ActionResponse };
const idempotencyCache = new Map<string, IdempotencyEntry>();

type ErrorEnvelope = {
  actionId: string | null;
  result: null;
  confidence: 0;
  warnings: [];
  error: { code: string; message: string; retryable: boolean };
};

type ActionResponse = {
  contractVersion: string;
  actionId: string;
  generatedAt: string;
  source: "llm" | "deterministic";
  confidenceThreshold: number;
  confidence: number;
  result: { kind: string; payload: Record<string, unknown> };
  warnings: string[];
};

function envelopeError(actionId: string | null, code: string, message: string, retryable: boolean): ErrorEnvelope {
  return { actionId, result: null, confidence: 0, warnings: [], error: { code, message, retryable } };
}

function unauthorized(actionId: string | null): ErrorEnvelope {
  return envelopeError(actionId, "UNAUTHORIZED", "Missing or invalid bearer token.", false);
}

function badRequest(actionId: string | null, message: string): ErrorEnvelope {
  return envelopeError(actionId, "INVALID_INPUT", message, false);
}

function payloadTooLarge(actionId: string | null, message: string): ErrorEnvelope {
  return envelopeError(actionId, "PAYLOAD_TOO_LARGE", message, false);
}

function upstreamError(actionId: string, message: string): ErrorEnvelope {
  return envelopeError(actionId, "UPSTREAM_ERROR", message, true);
}

// Constant-time string compare. timingSafeEqual throws on mismatched lengths,
// so the length check is required; leaking length is acceptable for a fixed-format secret.
function tokensEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function getBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  const parts = authHeader.split(" ");
  if (parts.length !== 2) return null;
  if (parts[0]!.toLowerCase() !== "bearer") return null;
  return parts[1] ?? null;
}

function isAuthorized(authHeader: string | undefined, authMode: string, authToken: string): boolean {
  if (authMode === "none") return true;
  if (authMode === "static_bearer") {
    if (!authToken) return false;
    const token = getBearerToken(authHeader);
    if (!token) return false;
    return tokensEqual(token, authToken);
  }
  return false;
}

type ActionPayload = {
  userId: string;
  actionId: string;
  tabs: RawTab[];
  contextHint?: string | undefined;
};

function validateRequest(payload: unknown): { ok: true; data: ActionPayload } | { ok: false; error: ErrorEnvelope } {
  if (!payload || typeof payload !== "object") {
    return { ok: false, error: badRequest(null, "Body must be a JSON object.") };
  }
  const p = payload as Record<string, unknown>;
  if (typeof p["userId"] !== "string" || p["userId"].length === 0) {
    return { ok: false, error: badRequest(p["actionId"] as string | null ?? null, "Body must include userId.") };
  }
  const actionId = p["actionId"];
  if (typeof actionId !== "string" || !ACTION_IDS.includes(actionId)) {
    return {
      ok: false,
      error: badRequest(typeof actionId === "string" ? actionId : null, `actionId must be one of: ${ACTION_IDS.join(", ")}.`),
    };
  }
  if (!Array.isArray(p["tabs"]) || p["tabs"].length === 0) {
    return { ok: false, error: badRequest(actionId, "Body must include a non-empty tabs array.") };
  }
  if ((p["tabs"] as unknown[]).length > MAX_TABS) {
    return {
      ok: false,
      error: payloadTooLarge(actionId, `tabs length ${(p["tabs"] as unknown[]).length} exceeds limit ${MAX_TABS}.`),
    };
  }
  const tabsRaw = p["tabs"] as unknown[];
  for (const t of tabsRaw) {
    if (!t || typeof t !== "object") {
      return { ok: false, error: badRequest(actionId, "Each tab must be an object.") };
    }
    const tab = t as Record<string, unknown>;
    if (typeof tab["title"] !== "string" || typeof tab["url"] !== "string" || typeof tab["domain"] !== "string") {
      return { ok: false, error: badRequest(actionId, "Each tab must include title, url, and domain.") };
    }
    if (tab["tabId"] == null || (typeof tab["tabId"] !== "string" && typeof tab["tabId"] !== "number")) {
      return { ok: false, error: badRequest(actionId, "Each tab must include a tabId.") };
    }
  }
  if (actionId === "compare_tabs" && tabsRaw.length < 2) {
    return { ok: false, error: badRequest(actionId, "compare_tabs requires at least 2 tabs to compare.") };
  }
  const contextHint = p["contextHint"];
  if (contextHint != null && typeof contextHint !== "string") {
    return { ok: false, error: badRequest(actionId, "contextHint must be a string.") };
  }
  if (typeof contextHint === "string" && contextHint.length > 250) {
    return { ok: false, error: badRequest(actionId, "contextHint must be <= 200 characters.") };
  }
  return {
    ok: true,
    data: {
      userId: p["userId"] as string,
      actionId,
      tabs: tabsRaw as RawTab[],
      ...(typeof contextHint === "string" ? { contextHint } : {}),
    },
  };
}

function idempotencyKey(payload: ActionPayload): string {
  const canonical = JSON.stringify({
    actionId: payload.actionId,
    userId: payload.userId,
    contextHint: payload.contextHint ?? "",
    tabs: payload.tabs.map((t) => ({ tabId: t.tabId, url: t.url, title: t.title, domain: t.domain })),
  });
  return crypto.createHash("sha256").update(canonical).digest("hex").slice(0, 32);
}

function checkIdempotent(key: string): ActionResponse | null {
  const entry = idempotencyCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.storedAt > IDEMPOTENCY_TTL_MS) {
    idempotencyCache.delete(key);
    return null;
  }
  return entry.response;
}

function rememberIdempotent(key: string, response: ActionResponse): void {
  idempotencyCache.set(key, { storedAt: Date.now(), response });
  if (idempotencyCache.size > 5000) {
    const firstKey = idempotencyCache.keys().next().value;
    if (firstKey !== undefined) idempotencyCache.delete(firstKey);
  }
}

function modelIdFor(action: ActionDef, sonnetModel: string, haikuModel: string): string {
  return action.model === "haiku" ? haikuModel : sonnetModel;
}

async function callAnthropic(
  action: ActionDef,
  tabs: MinimizedTab[],
  contextHint: string | undefined,
  apiKey: string,
  timeoutMs: number,
  sonnetModel: string,
  haikuModel: string,
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: modelIdFor(action, sonnetModel, haikuModel),
        max_tokens: 2048,
        // Mark the system prompt cacheable so the per-action description + schema
        // hits the prompt cache on subsequent calls.
        system: [{ type: "text", text: action.systemPrompt, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: action.buildUserMessage(tabs, contextHint) }],
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`anthropic ${res.status}`);
    const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    const text = Array.isArray(data.content)
      ? data.content
          .filter((p) => p.type === "text")
          .map((p) => p.text ?? "")
          .join("")
      : "";
    if (!text) throw new Error("anthropic empty response");
    try {
      return JSON.parse(text) as unknown;
    } catch {
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) throw new Error("anthropic non-json");
      return JSON.parse(match[0]) as unknown;
    }
  } finally {
    clearTimeout(timeout);
  }
}

// Emits `first_value_delivered` to Analytics Engine the first time a given user
// receives a successful concierge action. KV guards against duplicate emission;
// both bindings are optional so this is a no-op in dev without CF bindings.
async function emitFirstValue(
  userId: string,
  actionId: string,
  source: "llm" | "deterministic",
  confidence: number,
  env: Env,
): Promise<void> {
  const kv = env.FIRST_VALUE_KV;
  const ae = env.CONCIERGE_ANALYTICS;
  if (!kv && !ae) return;

  const kvKey = `fv:${userId}`;
  if (kv) {
    const existing = await kv.get(kvKey);
    if (existing !== null) return;
  }

  if (ae) {
    ae.writeDataPoint({
      // blob1=userId, blob2=actionId, blob3=source — queryable via Workers Analytics Engine SQL
      blobs: [userId, actionId, source],
      doubles: [confidence],
      indexes: [userId],
    });
  }

  if (kv) {
    // Best-effort: rare concurrent races may produce a harmless duplicate data point
    await kv.put(kvKey, "1");
  }
}

function buildResponse(
  action: ActionDef,
  validated: ReturnType<ActionDef["validate"]>,
  source: "llm" | "deterministic",
  extraWarnings: string[],
  generatedAt: string,
): ActionResponse {
  // validated is non-null here: callers only invoke after a null-check
  const v = validated!;
  const envelope = action.toEnvelopeFields(v);
  const warnings = [...envelope.warnings, ...extraWarnings];
  if (envelope.confidence < action.defaultConfidenceThreshold) {
    warnings.push(
      `My confidence in this result is below the reliability threshold (${Math.round(envelope.confidence * 100)}% vs. ${Math.round(action.defaultConfidenceThreshold * 100)}% needed) — treat it as a starting point and verify before acting on it.`,
    );
  }
  return {
    contractVersion: CONTRACT_VERSION,
    actionId: action.id,
    generatedAt,
    source,
    confidenceThreshold: action.defaultConfidenceThreshold,
    confidence: envelope.confidence,
    result: { kind: action.resultKind, payload: action.toResultPayload(v) },
    warnings,
  };
}

async function runAction(
  action: ActionDef,
  tabs: RawTab[],
  contextHint: string | undefined,
  env: Env,
): Promise<ActionResponse> {
  const warnings: string[] = [];
  const minimizedTabs = tabs.map(minimizeTab);
  const validatorContext = action.buildValidatorContext ? action.buildValidatorContext(minimizedTabs) : null;
  const actionUseLlm = env.ACTION_USE_LLM === "true";
  const apiKey = env.ANTHROPIC_API_KEY;
  const timeoutMs = Number.parseInt(env.ANTHROPIC_TIMEOUT_MS || "7000", 10);
  const sonnetModel = env.ANTHROPIC_SONNET_MODEL || "claude-sonnet-4-6";
  const haikuModel = env.ANTHROPIC_HAIKU_MODEL || "claude-haiku-4-5-20251001";

  if (actionUseLlm && apiKey) {
    try {
      const raw = await callAnthropic(action, minimizedTabs, contextHint, apiKey, timeoutMs, sonnetModel, haikuModel);
      const validated = action.validate(raw, validatorContext);
      if (validated) {
        return buildResponse(action, validated, "llm", warnings, new Date().toISOString());
      }
      warnings.push("LLM response failed schema validation; using deterministic fallback.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown";
      warnings.push(`LLM call failed (${msg}); using deterministic fallback.`);
    }
  } else if (actionUseLlm && !apiKey) {
    warnings.push("ACTION_USE_LLM is set but ANTHROPIC_API_KEY is missing; using deterministic fallback.");
  }

  const fallback = action.deterministic(minimizedTabs, contextHint);
  const validated = action.validate(fallback, validatorContext);
  if (!validated) throw new Error(`deterministic fallback failed validation for ${action.id}`);
  return buildResponse(action, validated, "deterministic", warnings, new Date().toISOString());
}

const app = new Hono<{ Bindings: Env }>();

app.use("*", cors());

app.get("/internal/healthz", (c) => {
  const env = c.env;
  return c.json({
    ok: true,
    contractVersion: CONTRACT_VERSION,
    llmEnabled: env.ACTION_USE_LLM === "true" && Boolean(env.ANTHROPIC_API_KEY),
    actions: ACTION_IDS,
  });
});

app.post("/v1/ai/action", async (c) => {
  const requestId = crypto.randomUUID();
  const env = c.env;
  const authMode = env.AUTH_MODE || "none";
  const authToken = env.AUTH_BEARER_TOKEN || "";

  if (!isAuthorized(c.req.header("authorization"), authMode, authToken)) {
    c.header("X-Request-Id", requestId);
    return c.json({ requestId, ...unauthorized(null) }, 401);
  }

  let payload: unknown;
  try {
    payload = await c.req.json();
  } catch {
    c.header("X-Request-Id", requestId);
    return c.json({ requestId, ...badRequest(null, "Request body must be valid JSON.") }, 400);
  }

  const validation = validateRequest(payload);
  if (!validation.ok) {
    const code = validation.error.error.code;
    const status = code === "PAYLOAD_TOO_LARGE" ? 413 : 400;
    c.header("X-Request-Id", requestId);
    return c.json({ requestId, ...validation.error }, status);
  }

  const { userId, actionId, tabs, contextHint } = validation.data;
  const action = ACTIONS[actionId]!;
  const idemKey = `${userId}:${actionId}:${idempotencyKey(validation.data)}`;
  const cached = checkIdempotent(idemKey);
  if (cached) {
    c.header("X-Request-Id", requestId);
    return c.json({ requestId, ...cached }, 200);
  }

  try {
    const response = await runAction(action, tabs, contextHint, env);
    rememberIdempotent(idemKey, response);
    await emitFirstValue(userId, actionId, response.source, response.confidence, env).catch(() => {});
    c.header("X-Request-Id", requestId);
    return c.json({ requestId, ...response }, 200);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "action generation failed";
    c.header("X-Request-Id", requestId);
    return c.json({ requestId, ...upstreamError(actionId, msg) }, 502);
  }
});

export default app;
