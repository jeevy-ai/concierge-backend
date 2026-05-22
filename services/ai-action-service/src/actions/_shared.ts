export const TEXT_LIMITS = {
  TITLE_MAX: 140,
  URL_MAX: 300,
  PATH_HINT_MAX: 80,
  DOMAIN_MAX: 120,
  CONTEXT_HINT_MAX: 200,
  HEADLINE_MAX: 80,
  PARAGRAPH_MAX: 600,
  EMAIL_BODY_MAX: 1600,
} as const;

export type RawTab = {
  tabId: string | number;
  title: string;
  url: string;
  domain: string;
  pathHint?: string | undefined;
};

export type MinimizedTab = {
  tabId: string | number | null;
  title: string;
  url: string;
  domain: string;
  pathHint: string;
};

export type ValidatedBase = {
  confidence: number;
  warnings: string[];
};

export interface ActionDef {
  id: string;
  resultKind: string;
  model: "sonnet" | "haiku";
  defaultConfidenceThreshold: number;
  systemPrompt: string;
  buildUserMessage(tabs: MinimizedTab[], contextHint?: string): string;
  buildValidatorContext?(tabs: MinimizedTab[]): Set<string | number>;
  // validate/deterministic return a ValidatedBase-compatible object; each concrete action
  // knows the exact shape and casts inside toResultPayload.
  validate(raw: unknown, ctx?: Set<string | number> | null): ValidatedBase | null;
  deterministic(tabs: MinimizedTab[], contextHint?: string): ValidatedBase;
  toResultPayload(v: ValidatedBase): Record<string, unknown>;
  toEnvelopeFields(v: ValidatedBase): { confidence: number; warnings: string[] };
}

const TRACKING_PARAM_PREFIXES = ["utm_", "fbclid", "gclid", "mc_", "icid", "ref_", "_hs"] as const;

export function minimizeUrl(raw: string): string {
  if (raw.length === 0) return "";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw.slice(0, TEXT_LIMITS.URL_MAX);
  }
  url.hash = "";
  const drop: string[] = [];
  url.searchParams.forEach((_v, k) => {
    const lower = k.toLowerCase();
    if (TRACKING_PARAM_PREFIXES.some((p) => lower.startsWith(p))) drop.push(k);
  });
  drop.forEach((k) => url.searchParams.delete(k));
  return url.toString().slice(0, TEXT_LIMITS.URL_MAX);
}

export function minimizeText(raw: string, max: number): string {
  return raw
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function minimizeTab(tab: RawTab): MinimizedTab {
  return {
    tabId: typeof tab.tabId === "number" || typeof tab.tabId === "string" ? tab.tabId : null,
    title: minimizeText(tab.title, TEXT_LIMITS.TITLE_MAX),
    url: minimizeUrl(tab.url),
    domain: minimizeText(tab.domain, TEXT_LIMITS.DOMAIN_MAX),
    pathHint: minimizeText(tab.pathHint ?? "", TEXT_LIMITS.PATH_HINT_MAX),
  };
}

export function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;
}

export function clampConfidence(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function clusterLabelForDomain(domain: string): string {
  if (/mail|outlook|inbox|calendar|slack|discord/i.test(domain)) return "Communication";
  if (/docs|notion|confluence|drive|figma/i.test(domain)) return "Docs & design";
  if (/github|gitlab|linear|jira|sentry|circleci/i.test(domain)) return "Engineering";
  if (/youtube|vimeo|spotify|netflix/i.test(domain)) return "Media";
  if (/amazon|ebay|shopify|stripe/i.test(domain)) return "Commerce";
  return "Research";
}

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && (value as unknown[]).every((v) => typeof v === "string" && (v as string).length > 0);
}

export function isNonEmptyString(value: unknown, max = 10000): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

export function buildUserMessage(tabs: MinimizedTab[], contextHint?: string): string {
  const slim = tabs.map((t) => ({
    tabId: t.tabId,
    title: t.title,
    url: t.url,
    domain: t.domain,
    pathHint: t.pathHint,
  }));
  const hint = contextHint ? `\nUser context: ${contextHint.slice(0, TEXT_LIMITS.CONTEXT_HINT_MAX)}` : "";
  return `Tabs:\n${JSON.stringify(slim)}${hint}`;
}
