import { type ValidatedBase, clampConfidence, isNonEmptyString } from "../actions/_shared.js";
import type { ConciergeVerbDef } from "./_shared.js";

type PlanItem = { time: string; task: string; priority: "high" | "medium" | "low" };

type ValidatedDayPlan = ValidatedBase & {
  rankedPlan: PlanItem[];
  rationale: string;
};

const SYSTEM_PROMPT = [
  "You are the plan_my_day concierge verb.",
  "Given a natural-language description of what the user wants to accomplish today, produce a prioritised day plan.",
  "Respond ONLY with JSON matching this schema:",
  '{"rankedPlan":[{"time":string,"task":string,"priority":"high"|"medium"|"low"}],"rationale":string,"confidence":number,"warnings":string[]}',
  "rankedPlan: 3-8 time-blocked items, ordered by priority (highest first). time = 'HH:MM AM/PM' or a range like '9:00 AM – 10:00 AM'.",
  "rationale: 1-2 sentences explaining the ordering logic.",
  "confidence: 0..1 — lower if the request is vague.",
  "warnings: short strings flagging overcommitment, missing context, etc.",
].join("\n");

function parseTasks(text: string): string[] {
  const splitPhrases = text
    .split(/\band\b|,|;|\bthen\b|\balso\b/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 3);
  return splitPhrases.length > 1 ? splitPhrases.slice(0, 8) : [text.trim()];
}

const PRIORITY_CYCLE: ("high" | "medium" | "low")[] = [
  "high",
  "high",
  "medium",
  "medium",
  "low",
  "low",
  "low",
  "low",
];
const START_HOUR = 9;

function deterministic(text: string): ValidatedDayPlan {
  const tasks = parseTasks(text);
  const rankedPlan: PlanItem[] = tasks.map((task, i) => {
    const hour = START_HOUR + i;
    const timeLabel = `${hour > 12 ? hour - 12 : hour}:00 ${hour >= 12 ? "PM" : "AM"}`;
    return { time: timeLabel, task: task.slice(0, 200), priority: PRIORITY_CYCLE[i] ?? "low" };
  });
  const rationale =
    rankedPlan.length > 1
      ? "Placed the most time-sensitive items first; lighter tasks follow to avoid decision fatigue."
      : "Single task identified; scheduled for the morning when focus is highest.";
  return { rankedPlan, rationale, confidence: 0.45, warnings: [] };
}

function isValidPriority(v: unknown): v is "high" | "medium" | "low" {
  return v === "high" || v === "medium" || v === "low";
}

function validate(raw: unknown): ValidatedDayPlan | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.rankedPlan) || (r.rankedPlan as unknown[]).length === 0) return null;
  const rankedPlan: PlanItem[] = [];
  for (const item of r.rankedPlan as unknown[]) {
    if (!item || typeof item !== "object") return null;
    const ir = item as Record<string, unknown>;
    if (!isNonEmptyString(ir.time, 40) || !isNonEmptyString(ir.task, 400)) return null;
    if (!isValidPriority(ir.priority)) return null;
    rankedPlan.push({
      time: (ir.time as string).slice(0, 40),
      task: (ir.task as string).slice(0, 400),
      priority: ir.priority,
    });
  }
  if (!isNonEmptyString(r.rationale, 600)) return null;
  if (!Array.isArray(r.warnings)) return null;
  return {
    rankedPlan: rankedPlan.slice(0, 12),
    rationale: (r.rationale as string).slice(0, 400),
    confidence: clampConfidence(r.confidence),
    warnings: (r.warnings as unknown[])
      .filter((w): w is string => typeof w === "string")
      .slice(0, 5),
  };
}

export const plan_my_day: ConciergeVerbDef = {
  id: "plan_my_day",
  resultKind: "day_plan",
  model: "sonnet",
  defaultConfidenceThreshold: 0.5,
  systemPrompt: SYSTEM_PROMPT,
  buildUserMessage: (text) => `Request: ${text}`,
  validate,
  deterministic,
  toResultPayload(v: ValidatedBase): Record<string, unknown> {
    const vp = v as ValidatedDayPlan;
    return { rankedPlan: vp.rankedPlan, rationale: vp.rationale };
  },
  toEnvelopeFields(v: ValidatedBase) {
    return { confidence: v.confidence, warnings: v.warnings };
  },
};
