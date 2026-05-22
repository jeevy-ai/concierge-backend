import { type ValidatedBase, clampConfidence, isNonEmptyString } from "../actions/_shared.js";
import type { ConciergeVerbDef } from "./_shared.js";

type ValidatedReminder = ValidatedBase & {
  subject: string;
  contact: string;
  dueAt: string;
  ack: string;
};

const SYSTEM_PROMPT = [
  "You are the remind_me concierge verb.",
  "Given a natural-language reminder request, extract the details and respond ONLY with JSON matching this schema:",
  '{"subject":string,"contact":string,"dueAt":string,"ack":string,"confidence":number,"warnings":string[]}',
  "subject: what the reminder is about (≤120 chars).",
  "contact: person or system to notify, or 'self' if the reminder is for the user only.",
  "dueAt: ISO 8601 datetime string for when the reminder fires.",
  "ack: short butler-voiced acknowledgement like 'Certainly — I'll remind you about X on Y.'",
  "confidence: 0..1 — lower if time or subject is ambiguous.",
  "warnings: short strings if the requested time is already past or unclear.",
].join("\n");

const TIME_PATTERNS: [RegExp, (now: Date) => Date][] = [
  [/\btomorrow\b/i, (d) => { const n = new Date(d); n.setDate(n.getDate() + 1); n.setHours(9, 0, 0, 0); return n; }],
  [/\bnext week\b/i, (d) => { const n = new Date(d); n.setDate(n.getDate() + 7); n.setHours(9, 0, 0, 0); return n; }],
  [/\bin\s+(\d+)\s+hour/i, (d) => { const n = new Date(d); n.setHours(n.getHours() + 1); return n; }],
  [/\bin\s+(\d+)\s+minute/i, (d) => { const n = new Date(d); n.setMinutes(n.getMinutes() + 30); return n; }],
];

function extractDueAt(text: string): string {
  const now = new Date();
  for (const [pattern, transform] of TIME_PATTERNS) {
    if (pattern.test(text)) return transform(now).toISOString();
  }
  // Default: tomorrow at 9am
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  return tomorrow.toISOString();
}

function extractContact(text: string): string {
  const m = text.match(/\bremind\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/);
  if (m?.[1] && m[1].toLowerCase() !== "me") return m[1];
  return "self";
}

function extractSubject(text: string): string {
  const cleaned = text
    .replace(/\bremind\s+(me|us)\b/i, "")
    .replace(/\btomorrow\b|\bnext week\b|\bin \d+ \w+/i, "")
    .replace(/\babout\b/i, "")
    .trim();
  return (cleaned.length > 5 ? cleaned : text).slice(0, 120);
}

function deterministic(text: string): ValidatedReminder {
  const subject = extractSubject(text);
  const contact = extractContact(text);
  const dueAt = extractDueAt(text);
  const dueFriendly = new Date(dueAt).toLocaleString("en-US", { weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const ack = `Certainly — I'll remind you about "${subject.slice(0, 60)}" on ${dueFriendly}.`;
  return { subject, contact, dueAt, ack, confidence: 0.5, warnings: [] };
}

function validate(raw: unknown): ValidatedReminder | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!isNonEmptyString(r["subject"], 300)) return null;
  if (!isNonEmptyString(r["contact"], 200)) return null;
  if (!isNonEmptyString(r["dueAt"], 60)) return null;
  if (!isNonEmptyString(r["ack"], 400)) return null;
  if (!Array.isArray(r["warnings"])) return null;
  return {
    subject: (r["subject"] as string).slice(0, 200),
    contact: (r["contact"] as string).slice(0, 200),
    dueAt: (r["dueAt"] as string).slice(0, 60),
    ack: (r["ack"] as string).slice(0, 300),
    confidence: clampConfidence(r["confidence"]),
    warnings: (r["warnings"] as unknown[]).filter((w): w is string => typeof w === "string").slice(0, 5),
  };
}

export const remind_me: ConciergeVerbDef = {
  id: "remind_me",
  resultKind: "reminder",
  model: "haiku",
  defaultConfidenceThreshold: 0.5,
  systemPrompt: SYSTEM_PROMPT,
  buildUserMessage: (text) => `Request: ${text}`,
  validate,
  deterministic,
  toResultPayload(v: ValidatedBase): Record<string, unknown> {
    const vr = v as ValidatedReminder;
    return { subject: vr.subject, contact: vr.contact, dueAt: vr.dueAt, ack: vr.ack };
  },
  toEnvelopeFields(v: ValidatedBase) {
    return { confidence: v.confidence, warnings: v.warnings };
  },
};
