import {
  type ActionDef,
  type MinimizedTab,
  type ValidatedBase,
  buildUserMessage,
  clampConfidence,
  isNonEmptyString,
  truncate,
} from "./_shared.js";

type DocSection = { heading: string; bullets: string[] };

type ValidatedDoc = ValidatedBase & {
  title: string;
  sections: DocSection[];
  markdown: string;
};

const SYSTEM_PROMPT = [
  "You are the doc-outline action for the Zenbrain ⌘K command palette.",
  "Convert the user's open tabs into a markdown outline they can paste into a writing surface.",
  "Reply ONLY with JSON matching this schema:",
  '{"title":string,"sections":[{"heading":string,"bullets":string[]}],"markdown":string,"confidence":number,"warnings":string[]}',
  "title: <= 80 chars, neutral and descriptive (no marketing).",
  "sections: 2..6 entries; each heading <= 80 chars; each section has 2..6 bullet strings (each <= 200 chars).",
  "markdown: a single string containing the complete outline rendered as markdown (`# title`, `## heading`, `- bullet`).",
  "confidence: 0..1. Lower confidence when source material is sparse or contradictory.",
  "warnings: short strings flagging anything the user should verify.",
].join("\n");

function bulletForTab(tab: MinimizedTab): string {
  const tail = tab.url ? ` (${tab.domain || tab.url})` : "";
  return truncate(`${tab.title || tab.domain || tab.url}${tail}`, 200);
}

function deterministic(tabs: MinimizedTab[]): ValidatedDoc {
  const sections: DocSection[] = tabs.slice(0, 6).map((tab) => ({
    heading: truncate(tab.title || tab.domain, 80),
    bullets: [bulletForTab(tab)],
  }));
  if (sections.length < 2) {
    sections.push({ heading: "Open questions", bullets: ["What is the next concrete step?"] });
  }
  const title = truncate(`Outline from ${tabs.length} tab${tabs.length === 1 ? "" : "s"}`, 80);
  const markdown = `# ${title}\n\n${sections
    .map((s) => `## ${s.heading}\n\n${s.bullets.map((b) => `- ${b}`).join("\n")}`)
    .join("\n\n")}\n`;
  return { title, sections, markdown, confidence: 0.45, warnings: [] };
}

function validate(raw: unknown): ValidatedDoc | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!isNonEmptyString(r["title"], 200)) return null;
  const secs = r["sections"];
  if (!Array.isArray(secs) || secs.length < 2 || secs.length > 6) return null;
  for (const s of secs as unknown[]) {
    if (!s || typeof s !== "object") return null;
    const sec = s as Record<string, unknown>;
    if (!isNonEmptyString(sec["heading"], 200)) return null;
    const bullets = sec["bullets"];
    if (!Array.isArray(bullets) || bullets.length < 1 || bullets.length > 8) return null;
    if (!(bullets as unknown[]).every((b) => isNonEmptyString(b, 400))) return null;
  }
  if (!isNonEmptyString(r["markdown"], 8000)) return null;
  if (!Array.isArray(r["warnings"])) return null;
  return {
    title: truncate(r["title"] as string, 80),
    sections: (secs as Array<{ heading: string; bullets: string[] }>).slice(0, 6).map((s) => ({
      heading: truncate(s.heading, 80),
      bullets: s.bullets.slice(0, 6).map((b) => truncate(b, 200)),
    })),
    markdown: truncate(r["markdown"] as string, 8000),
    confidence: clampConfidence(r["confidence"]),
    warnings: (r["warnings"] as unknown[]).filter((w): w is string => typeof w === "string").slice(0, 5),
  };
}

export const outline_doc: ActionDef = {
  id: "outline_doc",
  resultKind: "markdown",
  model: "sonnet",
  defaultConfidenceThreshold: 0.5,
  systemPrompt: SYSTEM_PROMPT,
  buildUserMessage,
  validate,
  deterministic,
  toResultPayload(v: ValidatedBase): Record<string, unknown> {
    const validated = v as ValidatedDoc;
    return { title: validated.title, sections: validated.sections, markdown: validated.markdown };
  },
  toEnvelopeFields(v: ValidatedBase) {
    return { confidence: v.confidence, warnings: v.warnings };
  },
};
