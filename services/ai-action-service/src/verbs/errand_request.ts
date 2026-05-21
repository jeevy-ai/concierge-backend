import { type ValidatedBase, clampConfidence, isNonEmptyString, isStringArray } from "../actions/_shared.js";
import type { ConciergeVerbDef } from "./_shared.js";

type ValidatedErrand = ValidatedBase & {
  summary: string;
  checklist: string[];
  nextActions: string[];
};

const SYSTEM_PROMPT = [
  "You are the errand_request concierge verb.",
  "Given a natural-language errand or to-do request, extract and organise the work into a structured response.",
  "Respond ONLY with JSON matching this schema:",
  '{"summary":string,"checklist":string[],"nextActions":string[],"confidence":number,"warnings":string[]}',
  "summary: 1-2 sentence plain-text summary of the overall errand (≤200 chars).",
  "checklist: 2-8 discrete, actionable steps to complete the errand.",
  "nextActions: 1-3 immediate next steps the user should take right now.",
  "confidence: 0..1 — lower if the request is vague or incomplete.",
  "warnings: short strings for missing information or potential blockers.",
].join("\n");

function splitItems(text: string): string[] {
  return text
    .split(/\band\b|,|;|\bthen\b|\balso\b|\bnext\b/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 3)
    .slice(0, 8);
}

function deterministic(text: string): ValidatedErrand {
  const items = splitItems(text);
  const summary = `Complete the following errand: ${text.slice(0, 120).trim()}${text.length > 120 ? "…" : ""}`;
  const checklist =
    items.length > 1
      ? items.map((item) => `${item.slice(0, 150)}`)
      : [text.slice(0, 150), "Confirm completion", "Follow up if needed"];
  const nextActions = [`Start with: ${checklist[0] ?? text.slice(0, 80)}`];
  return { summary: summary.slice(0, 200), checklist, nextActions, confidence: 0.45, warnings: [] };
}

function validate(raw: unknown): ValidatedErrand | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!isNonEmptyString(r["summary"], 400)) return null;
  if (!Array.isArray(r["checklist"]) || (r["checklist"] as unknown[]).length === 0) return null;
  if (!isStringArray(r["checklist"])) return null;
  if (!Array.isArray(r["nextActions"])) return null;
  if ((r["nextActions"] as unknown[]).length > 0 && !isStringArray(r["nextActions"])) return null;
  if (!Array.isArray(r["warnings"])) return null;
  return {
    summary: (r["summary"] as string).slice(0, 300),
    checklist: (r["checklist"] as string[]).slice(0, 10).map((s) => s.slice(0, 200)),
    nextActions: (r["nextActions"] as string[]).slice(0, 5).map((s) => s.slice(0, 200)),
    confidence: clampConfidence(r["confidence"]),
    warnings: (r["warnings"] as unknown[]).filter((w): w is string => typeof w === "string").slice(0, 5),
  };
}

export const errand_request: ConciergeVerbDef = {
  id: "errand_request",
  resultKind: "errand",
  model: "haiku",
  defaultConfidenceThreshold: 0.5,
  systemPrompt: SYSTEM_PROMPT,
  buildUserMessage: (text) => `Request: ${text}`,
  validate,
  deterministic,
  toResultPayload(v: ValidatedBase): Record<string, unknown> {
    const ve = v as ValidatedErrand;
    return { summary: ve.summary, checklist: ve.checklist, nextActions: ve.nextActions };
  },
  toEnvelopeFields(v: ValidatedBase) {
    return { confidence: v.confidence, warnings: v.warnings };
  },
};
