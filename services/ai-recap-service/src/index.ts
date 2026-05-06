import crypto from "node:crypto";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { type RecapProvider, createProvider } from "./recap-provider.js";

export type Env = {
  ENVIRONMENT: string;
  AUTH_MODE: string;
  AUTH_BEARER_TOKEN: string;
  RECAP_USE_LLM: string;
  VERTEX_REGION: string;
  VERTEX_PROJECT_ID: string;
  RECAP_MODEL: string;
  RECAP_TIMEOUT_MS: string;
};

const CONTRACT_VERSION = "2026-05-03";
const MAX_TABS_TOTAL = 100;
const MAX_WINDOWS = 25;
const HEADLINE_MAX = 60;
const SUMMARY_MAX = 220;
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

type IdempotencyEntry = { storedAt: number; response: RecapResponse };
const idempotencyCache = new Map<string, IdempotencyEntry>();

// Provider is lazily created per-config-set to avoid module-level env access.
let cachedProvider: RecapProvider | null = null;
let cachedProviderKey = "";

function getProvider(env: Env): RecapProvider | null {
  if (env.RECAP_USE_LLM !== "true" || !env.VERTEX_PROJECT_ID) return null;
  const key = `${env.VERTEX_PROJECT_ID}:${env.VERTEX_REGION}:${env.RECAP_MODEL}:${env.RECAP_TIMEOUT_MS}`;
  if (key === cachedProviderKey && cachedProvider) return cachedProvider;
  cachedProvider = createProvider({
    projectId: env.VERTEX_PROJECT_ID,
    region: env.VERTEX_REGION || "us-central1",
    model: env.RECAP_MODEL || "gemini-2.5-flash",
    timeoutMs: Number.parseInt(env.RECAP_TIMEOUT_MS || "8000", 10),
  });
  cachedProviderKey = key;
  return cachedProvider;
}

type RawTab = {
  title: string;
  url: string;
  domain: string;
  pathHint?: string | undefined;
  lastActiveAt?: string | undefined;
};

type MinimizedTab = {
  title: string;
  url: string;
  domain: string;
  pathHint: string;
  lastActiveAt: string | null;
};

type IntentWindow = {
  windowId: string;
  startedAt: string;
  endedAt: string;
  tabs: RawTab[];
};

type RecapCluster = {
  clusterId: string;
  label: string;
  headline: string;
  summary: string;
  confidence: number;
  intentWindowIds: string[];
  suggestedAction: "resume" | "archive" | "ignore";
};

type RecapResponse = {
  contractVersion: string;
  recapId: string;
  generatedAt: string;
  source: "llm" | "deterministic";
  clusters: RecapCluster[];
  warnings: string[];
};

type ErrorBody = {
  error: { code: string; message: string; retryable: boolean };
  fallback: { overview: string; suggestedNextActions: string[] };
};

function emptyFallback(overview: string): { overview: string; suggestedNextActions: string[] } {
  return {
    overview,
    suggestedNextActions: [
      "Retry recap after the current capture window completes.",
      "Reduce the number of tabs or windows in the request.",
    ],
  };
}

function unauthorized(message: string): ErrorBody {
  return { error: { code: "UNAUTHORIZED", message, retryable: false }, fallback: emptyFallback("Authentication required.") };
}

function badRequest(message: string): ErrorBody {
  return {
    error: { code: "INVALID_INPUT", message, retryable: false },
    fallback: emptyFallback("Could not process intent windows for recap."),
  };
}

function payloadTooLarge(message: string): ErrorBody {
  return {
    error: { code: "PAYLOAD_TOO_LARGE", message, retryable: false },
    fallback: emptyFallback("Intent window batch exceeded recap size limits."),
  };
}

function upstreamError(message: string): ErrorBody {
  return {
    error: { code: "UPSTREAM_ERROR", message, retryable: true },
    fallback: emptyFallback("Recap generator unavailable; try again shortly."),
  };
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

const TRACKING_PARAM_PREFIXES = ["utm_", "fbclid", "gclid", "mc_", "icid", "ref_", "_hs"] as const;

function minimizeUrl(raw: string): string {
  if (raw.length === 0) return "";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw.slice(0, 300);
  }
  url.hash = "";
  const drop: string[] = [];
  url.searchParams.forEach((_v, k) => {
    const lower = k.toLowerCase();
    if (TRACKING_PARAM_PREFIXES.some((p) => lower.startsWith(p))) drop.push(k);
  });
  drop.forEach((k) => url.searchParams.delete(k));
  return url.toString().slice(0, 300);
}

function minimizeTitle(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, 140);
}

function minimizeTab(tab: RawTab): MinimizedTab {
  return {
    title: minimizeTitle(tab.title),
    url: minimizeUrl(tab.url),
    domain: typeof tab.domain === "string" ? tab.domain.slice(0, 120) : "",
    pathHint: typeof tab.pathHint === "string" ? tab.pathHint.slice(0, 80) : "",
    lastActiveAt: typeof tab.lastActiveAt === "string" ? tab.lastActiveAt : null,
  };
}

type ValidatedRequest = { userId: string; intentWindows: IntentWindow[]; totalTabs: number };

function validateRequest(payload: unknown): { ok: true; data: ValidatedRequest } | { ok: false; error: ErrorBody } {
  if (!payload || typeof payload !== "object") {
    return { ok: false, error: badRequest("Body must be a JSON object.") };
  }
  const p = payload as Record<string, unknown>;
  if (typeof p["userId"] !== "string" || p["userId"].length === 0) {
    return { ok: false, error: badRequest("Body must include userId.") };
  }
  const windows = p["intentWindows"];
  if (!Array.isArray(windows) || windows.length === 0) {
    return { ok: false, error: badRequest("Body must include non-empty intentWindows array.") };
  }
  if (windows.length > MAX_WINDOWS) {
    return { ok: false, error: payloadTooLarge(`intentWindows length ${windows.length} exceeds limit ${MAX_WINDOWS}.`) };
  }

  let totalTabs = 0;
  for (const w of windows as unknown[]) {
    if (!w || typeof w !== "object") return { ok: false, error: badRequest("Each intentWindow must be an object.") };
    const win = w as Record<string, unknown>;
    if (typeof win["windowId"] !== "string" || win["windowId"].length === 0) {
      return { ok: false, error: badRequest("Each intentWindow must include windowId.") };
    }
    if (typeof win["startedAt"] !== "string" || typeof win["endedAt"] !== "string") {
      return { ok: false, error: badRequest(`Window ${win["windowId"]} must include ISO startedAt and endedAt.`) };
    }
    if (Number.isNaN(Date.parse(win["startedAt"] as string)) || Number.isNaN(Date.parse(win["endedAt"] as string))) {
      return { ok: false, error: badRequest(`Window ${win["windowId"]} has invalid ISO timestamps.`) };
    }
    const tabs = win["tabs"];
    if (!Array.isArray(tabs) || tabs.length === 0) {
      return { ok: false, error: badRequest(`Window ${win["windowId"]} must include non-empty tabs array.`) };
    }
    for (const t of tabs as unknown[]) {
      if (!t || typeof t !== "object") {
        return { ok: false, error: badRequest(`Window ${win["windowId"]} has invalid tab.`) };
      }
      const tab = t as Record<string, unknown>;
      if (typeof tab["title"] !== "string" || typeof tab["url"] !== "string" || typeof tab["domain"] !== "string") {
        return { ok: false, error: badRequest(`Window ${win["windowId"]} has tab missing title/url/domain.`) };
      }
    }
    totalTabs += (tabs as unknown[]).length;
  }

  if (totalTabs > MAX_TABS_TOTAL) {
    return {
      ok: false,
      error: payloadTooLarge(`Total tabs ${totalTabs} exceeds limit ${MAX_TABS_TOTAL} across all windows.`),
    };
  }

  return { ok: true, data: { userId: p["userId"] as string, intentWindows: windows as IntentWindow[], totalTabs } };
}

function idempotencyKey(userId: string, intentWindows: IntentWindow[]): string {
  const canonical = JSON.stringify(
    intentWindows.map((w) => ({
      windowId: w.windowId,
      startedAt: w.startedAt,
      endedAt: w.endedAt,
      tabs: w.tabs.map((t) => ({ url: t.url, title: t.title, domain: t.domain })),
    })),
  );
  const hash = crypto.createHash("sha256").update(canonical).digest("hex").slice(0, 32);
  return `${userId}:${hash}`;
}

function checkIdempotent(key: string): RecapResponse | null {
  const entry = idempotencyCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.storedAt > IDEMPOTENCY_TTL_MS) {
    idempotencyCache.delete(key);
    return null;
  }
  return entry.response;
}

function rememberIdempotent(key: string, response: RecapResponse): void {
  idempotencyCache.set(key, { storedAt: Date.now(), response });
  if (idempotencyCache.size > 5000) {
    const firstKey = idempotencyCache.keys().next().value;
    if (firstKey !== undefined) idempotencyCache.delete(firstKey);
  }
}

function clusterLabelForDomain(domain: string): string {
  if (/mail|outlook|inbox|calendar|slack|discord/i.test(domain)) return "Communication";
  if (/docs|notion|confluence|drive|figma/i.test(domain)) return "Docs & design";
  if (/github|gitlab|linear|jira|sentry|circleci/i.test(domain)) return "Engineering";
  if (/youtube|vimeo|spotify|netflix/i.test(domain)) return "Media";
  if (/amazon|ebay|shopify|stripe/i.test(domain)) return "Commerce";
  return "Research";
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;
}

function deterministicCluster(intentWindows: IntentWindow[]): RecapCluster[] {
  const grouped = new Map<string, { windowId: string; label: string; tabs: MinimizedTab[] }>();
  for (const w of intentWindows) {
    for (const tab of w.tabs) {
      const min = minimizeTab(tab);
      const label = clusterLabelForDomain(min.domain);
      const key = `${w.windowId}::${label}`;
      if (!grouped.has(key)) {
        grouped.set(key, { windowId: w.windowId, label, tabs: [] });
      }
      grouped.get(key)!.tabs.push(min);
    }
  }

  const clusters: RecapCluster[] = [];
  let i = 0;
  for (const { windowId, label, tabs } of grouped.values()) {
    i += 1;
    const anchorTitle = tabs[0]?.title ?? label;
    const headline = truncate(`${label}: ${anchorTitle}`, HEADLINE_MAX);
    const summary = truncate(
      `${tabs.length} tab${tabs.length === 1 ? "" : "s"} from ${anchorTitle || label}` +
        (tabs.length > 1 ? ` and ${tabs.length - 1} related page${tabs.length - 1 === 1 ? "" : "s"}` : "") +
        ".",
      SUMMARY_MAX,
    );
    clusters.push({
      clusterId: `cls_${i}`,
      label,
      headline,
      summary,
      confidence: 0.5,
      intentWindowIds: [windowId],
      suggestedAction: tabs.length >= 2 ? "resume" : "ignore",
    });
  }
  return clusters;
}

const SYSTEM_PROMPT = [
  "You are the recap clustering model for the Zenbrain tab manager.",
  "You receive a set of intent windows captured from a user's browser session.",
  "Group related tabs into clusters that summarize where the user left off.",
  "Reply ONLY with JSON matching the schema:",
  '{"clusters":[{"clusterId":string,"label":string,"headline":string,"summary":string,"confidence":number,"intentWindowIds":string[],"suggestedAction":"resume"|"archive"|"ignore"}]}',
  `headline must be <= ${HEADLINE_MAX} characters; summary must be <= ${SUMMARY_MAX} characters and at most two sentences.`,
  "headline and summary must be non-empty strings.",
  "Every value in intentWindowIds MUST come from the input windowId set. Do not invent new ids; if a cluster spans windows, list each input windowId separately.",
  "confidence is a number in [0,1]; set suggestedAction=resume when the cluster represents an in-progress task.",
].join("\n");

function buildUserMessage(intentWindows: IntentWindow[]): string {
  const slim = intentWindows.map((w) => ({
    windowId: w.windowId,
    startedAt: w.startedAt,
    endedAt: w.endedAt,
    tabs: w.tabs.map(minimizeTab),
  }));
  return `Intent windows:\n${JSON.stringify(slim)}`;
}

function validateLlmClusters(raw: unknown, allowedWindowIds: Set<string>): RecapCluster[] | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r["clusters"])) return null;
  const out: RecapCluster[] = [];
  const clusters = r["clusters"] as unknown[];
  for (let i = 0; i < clusters.length; i++) {
    const c = clusters[i];
    if (!c || typeof c !== "object") return null;
    const cluster = c as Record<string, unknown>;
    const clusterId =
      typeof cluster["clusterId"] === "string" && cluster["clusterId"].length > 0
        ? cluster["clusterId"]
        : `cls_${i + 1}`;
    if (typeof cluster["label"] !== "string" || typeof cluster["headline"] !== "string" || typeof cluster["summary"] !== "string") {
      return null;
    }
    if ((cluster["headline"] as string).trim().length === 0 || (cluster["summary"] as string).trim().length === 0) {
      return null;
    }
    if (typeof cluster["confidence"] !== "number" || !Number.isFinite(cluster["confidence"])) return null;
    const windowIds = cluster["intentWindowIds"];
    if (!Array.isArray(windowIds) || windowIds.length === 0) return null;
    if (!(windowIds as unknown[]).every((id) => typeof id === "string" && allowedWindowIds.has(id))) return null;
    const action = cluster["suggestedAction"];
    if (action !== "resume" && action !== "archive" && action !== "ignore") return null;
    out.push({
      clusterId,
      label: truncate(cluster["label"] as string, HEADLINE_MAX),
      headline: truncate(cluster["headline"] as string, HEADLINE_MAX),
      summary: truncate(cluster["summary"] as string, SUMMARY_MAX),
      confidence: Math.max(0, Math.min(1, cluster["confidence"] as number)),
      intentWindowIds: Array.from(new Set(windowIds as string[])),
      suggestedAction: action,
    });
  }
  return out;
}

async function generateClusters(
  intentWindows: IntentWindow[],
  warnings: string[],
  provider: RecapProvider | null,
  recapUseLlm: boolean,
  vertexProjectId: string,
): Promise<{ clusters: RecapCluster[]; source: "llm" | "deterministic" }> {
  const allowedWindowIds = new Set(intentWindows.map((w) => w.windowId));
  if (recapUseLlm && provider) {
    try {
      const raw = await provider.generate(SYSTEM_PROMPT, buildUserMessage(intentWindows));
      const validated = validateLlmClusters(raw, allowedWindowIds);
      if (validated && validated.length > 0) {
        return { clusters: validated, source: "llm" };
      }
      warnings.push("LLM response failed schema validation; using deterministic fallback.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown";
      warnings.push(`LLM call failed (${msg}); using deterministic fallback.`);
    }
  } else if (recapUseLlm && !vertexProjectId) {
    warnings.push("RECAP_USE_LLM is set but VERTEX_PROJECT_ID is missing; using deterministic fallback.");
  }
  return { clusters: deterministicCluster(intentWindows), source: "deterministic" };
}

async function buildRecap(payload: ValidatedRequest, env: Env): Promise<RecapResponse> {
  const warnings: string[] = [];
  const recapUseLlm = env.RECAP_USE_LLM === "true";
  const provider = getProvider(env);
  const { clusters, source } = await generateClusters(
    payload.intentWindows,
    warnings,
    provider,
    recapUseLlm,
    env.VERTEX_PROJECT_ID || "",
  );
  return {
    contractVersion: CONTRACT_VERSION,
    recapId: `rcp_${crypto.randomUUID()}`,
    generatedAt: new Date().toISOString(),
    source,
    clusters,
    warnings,
  };
}

const app = new Hono<{ Bindings: Env }>();

app.use("*", cors());

app.get("/internal/healthz", (c) => {
  const env = c.env;
  const provider = getProvider(env);
  return c.json({ ok: true, contractVersion: CONTRACT_VERSION, llmEnabled: env.RECAP_USE_LLM === "true" && Boolean(provider) });
});

app.post("/v1/ai/recap", async (c) => {
  const env = c.env;
  const authMode = env.AUTH_MODE || "none";
  const authToken = env.AUTH_BEARER_TOKEN || "";

  if (!isAuthorized(c.req.header("authorization"), authMode, authToken)) {
    return c.json(unauthorized("Missing or invalid bearer token."), 401);
  }

  let payload: unknown;
  try {
    payload = await c.req.json();
  } catch {
    return c.json(badRequest("Request body must be valid JSON."), 400);
  }

  const validation = validateRequest(payload);
  if (!validation.ok) {
    const code = validation.error.error.code;
    const status = code === "PAYLOAD_TOO_LARGE" ? 413 : 400;
    return c.json(validation.error, status);
  }

  const idemKey = idempotencyKey(validation.data.userId, validation.data.intentWindows);
  const cached = checkIdempotent(idemKey);
  if (cached) return c.json(cached, 200);

  try {
    const recap = await buildRecap(validation.data, env);
    rememberIdempotent(idemKey, recap);
    return c.json(recap, 200);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "recap generation failed";
    return c.json(upstreamError(msg), 502);
  }
});

export default app;
