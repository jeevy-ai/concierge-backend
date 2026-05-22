import {
  type ActionDef,
  type MinimizedTab,
  TEXT_LIMITS,
  type ValidatedBase,
  buildUserMessage,
  clampConfidence,
  isNonEmptyString,
  truncate,
} from "./_shared.js";

type BriefSource = { title: string; url: string; summary: string };

type ValidatedBrief = ValidatedBase & {
  title: string;
  overview: string;
  sources: BriefSource[];
  openQuestions: string[];
};

const SYSTEM_PROMPT = [
  "You are the research-brief action for the Zenbrain ⌘K command palette.",
  "Convert the user's open tabs into a short research brief they can save and revisit.",
  "Reply ONLY with JSON matching this schema:",
  '{"title":string,"overview":string,"sources":[{"title":string,"url":string,"summary":string}],"openQuestions":string[],"confidence":number,"warnings":string[]}',
  "title: <= 100 chars, neutral and descriptive.",
  "overview: 1..3 short paragraphs, plain text, <= 600 chars total.",
  "sources: 1..10 entries; one per relevant tab; each summary <= 240 chars and grounded in the tab title/url.",
  "openQuestions: 2..5 entries; each <= 160 chars; phrased as concrete questions.",
  "If a tab does not belong in the brief, omit it rather than padding.",
  "confidence: 0..1; warnings: short strings flagging gaps.",
].join("\n");

function deterministic(tabs: MinimizedTab[], contextHint?: string): ValidatedBrief {
  const sources: BriefSource[] = tabs.slice(0, 10).map((t) => ({
    title: truncate(t.title || t.domain || t.url, 140),
    url: t.url,
    summary: truncate(
      t.title
        ? `"${t.title}" — from ${t.domain || "the web"}.`
        : `Source from ${t.domain || "the web"}.`,
      240,
    ),
  }));
  const titles = tabs
    .slice(0, 2)
    .map((t) => t.title || t.domain || "")
    .filter(Boolean);
  const overview = truncate(
    contextHint
      ? `${contextHint}. Drawing on ${tabs.length} source${tabs.length === 1 ? "" : "s"} — review before sharing.`
      : titles.length >= 2
        ? `Research covering "${titles[0]}" and ${tabs.length - 1} related source${tabs.length - 1 === 1 ? "" : "s"}. Review the sources below and answer the open questions before sharing.`
        : titles.length === 1
          ? `Research starting from "${titles[0]}" — ${tabs.length} source${tabs.length === 1 ? "" : "s"} total. Review before sharing.`
          : `Research brief from ${tabs.length} source${tabs.length === 1 ? "" : "s"}. Use the sources below as a starting point.`,
    TEXT_LIMITS.PARAGRAPH_MAX,
  );
  const briefTitle = contextHint
    ? truncate(contextHint, 100)
    : titles.length > 0
      ? truncate(`${titles[0]}${tabs.length > 1 ? ` (${tabs.length} sources)` : ""}`, 100)
      : truncate(`Research brief (${tabs.length} sources)`, 100);
  return {
    title: briefTitle,
    overview,
    sources,
    openQuestions: [
      "What is the single decision this brief is meant to support?",
      "Which source carries the most weight, and why?",
      "What is the next concrete step after reading this brief?",
    ],
    confidence: 0.45,
    warnings: [],
  };
}

function validate(raw: unknown): ValidatedBrief | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!isNonEmptyString(r.title, 200)) return null;
  if (!isNonEmptyString(r.overview, 1200)) return null;
  const sources = r.sources;
  if (!Array.isArray(sources) || sources.length < 1 || sources.length > 10) return null;
  for (const s of sources as unknown[]) {
    if (!s || typeof s !== "object") return null;
    const src = s as Record<string, unknown>;
    if (!isNonEmptyString(src.title, 200)) return null;
    if (typeof src.url !== "string") return null;
    if (!isNonEmptyString(src.summary, 400)) return null;
  }
  const openQuestions = r.openQuestions;
  if (!Array.isArray(openQuestions) || openQuestions.length < 2 || openQuestions.length > 5)
    return null;
  if (!(openQuestions as unknown[]).every((q) => isNonEmptyString(q, 240))) return null;
  if (!Array.isArray(r.warnings)) return null;
  return {
    title: truncate(r.title as string, 100),
    overview: truncate(r.overview as string, TEXT_LIMITS.PARAGRAPH_MAX),
    sources: (sources as Array<{ title: string; url: string; summary: string }>).map((s) => ({
      title: truncate(s.title, 140),
      url: truncate(s.url, TEXT_LIMITS.URL_MAX),
      summary: truncate(s.summary, 240),
    })),
    openQuestions: (openQuestions as string[]).map((q) => truncate(q, 160)),
    confidence: clampConfidence(r.confidence),
    warnings: (r.warnings as unknown[])
      .filter((w): w is string => typeof w === "string")
      .slice(0, 5),
  };
}

export const research_brief: ActionDef = {
  id: "research_brief",
  resultKind: "brief",
  model: "sonnet",
  defaultConfidenceThreshold: 0.5,
  systemPrompt: SYSTEM_PROMPT,
  buildUserMessage,
  validate,
  deterministic,
  toResultPayload(v: ValidatedBase): Record<string, unknown> {
    const validated = v as ValidatedBrief;
    return {
      title: validated.title,
      overview: validated.overview,
      sources: validated.sources,
      openQuestions: validated.openQuestions,
    };
  },
  toEnvelopeFields(v: ValidatedBase) {
    return { confidence: v.confidence, warnings: v.warnings };
  },
};
