import { type ValidatedBase, clampConfidence, isNonEmptyString } from "../actions/_shared.js";
import type { ConciergeVerbDef } from "./_shared.js";

type ProposedSlot = { label: string; iso: string };

type ValidatedMeeting = ValidatedBase & {
  attendee: string;
  proposedSlots: ProposedSlot[];
  draftInvite: string;
};

const SYSTEM_PROMPT = [
  "You are the schedule_meeting concierge verb.",
  "Given a natural-language scheduling request, extract the relevant details and respond ONLY with JSON matching this schema:",
  '{"attendee":string,"proposedSlots":[{"label":string,"iso":string}],"draftInvite":string,"confidence":number,"warnings":string[]}',
  "attendee: name or role of the person to meet (extracted from request, or 'team' if unclear).",
  "proposedSlots: exactly 3 proposed time slots — each has label (human-readable) and iso (ISO 8601).",
  "draftInvite: short plain-text draft invite message (≤300 chars) mentioning the topic and slots.",
  "confidence: 0..1 — lower if attendee or topic is ambiguous.",
  "warnings: short strings for anything the user should check before sending.",
].join("\n");

function todayPlusIso(days: number, hour: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

function slotLabel(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function extractAttendee(text: string): string {
  const withPatterns = [
    /\bwith\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/,
    /\bmeeting\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/,
    /\bcall\s+with\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/,
  ];
  for (const p of withPatterns) {
    const m = text.match(p);
    if (m?.[1]) return m[1];
  }
  return "team";
}

function extractTopic(text: string): string {
  const m = text.match(/\babout\s+(.{5,60}?)(?:\s+with|\s+tomorrow|\s+next|\s*$)/i);
  if (m?.[1]) return m[1].trim();
  return "our upcoming work";
}

function deterministic(text: string): ValidatedMeeting {
  const attendee = extractAttendee(text);
  const topic = extractTopic(text);
  const slots: ProposedSlot[] = [
    { label: slotLabel(todayPlusIso(1, 10)), iso: todayPlusIso(1, 10) },
    { label: slotLabel(todayPlusIso(2, 14)), iso: todayPlusIso(2, 14) },
    { label: slotLabel(todayPlusIso(3, 11)), iso: todayPlusIso(3, 11) },
  ];
  const draftInvite = `Hi ${attendee},\n\nWould love to connect about ${topic}. A few options:\n${slots.map((s) => `- ${s.label}`).join("\n")}\n\nLet me know what works!`.slice(0, 300);
  return { attendee, proposedSlots: slots, draftInvite, confidence: 0.5, warnings: [] };
}

function validate(raw: unknown): ValidatedMeeting | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!isNonEmptyString(r["attendee"], 200)) return null;
  if (!Array.isArray(r["proposedSlots"]) || (r["proposedSlots"] as unknown[]).length === 0) return null;
  const slots: ProposedSlot[] = [];
  for (const s of r["proposedSlots"] as unknown[]) {
    if (!s || typeof s !== "object") return null;
    const sr = s as Record<string, unknown>;
    if (!isNonEmptyString(sr["label"], 100) || !isNonEmptyString(sr["iso"], 60)) return null;
    slots.push({ label: (sr["label"] as string).slice(0, 100), iso: (sr["iso"] as string).slice(0, 60) });
  }
  if (!isNonEmptyString(r["draftInvite"], 600)) return null;
  if (!Array.isArray(r["warnings"])) return null;
  return {
    attendee: (r["attendee"] as string).slice(0, 200),
    proposedSlots: slots.slice(0, 5),
    draftInvite: (r["draftInvite"] as string).slice(0, 400),
    confidence: clampConfidence(r["confidence"]),
    warnings: (r["warnings"] as unknown[]).filter((w): w is string => typeof w === "string").slice(0, 5),
  };
}

export const schedule_meeting: ConciergeVerbDef = {
  id: "schedule_meeting",
  resultKind: "meeting",
  model: "sonnet",
  defaultConfidenceThreshold: 0.5,
  systemPrompt: SYSTEM_PROMPT,
  buildUserMessage: (text) => `Request: ${text}`,
  validate,
  deterministic,
  toResultPayload(v: ValidatedBase): Record<string, unknown> {
    const vm = v as ValidatedMeeting;
    return { attendee: vm.attendee, proposedSlots: vm.proposedSlots, draftInvite: vm.draftInvite };
  },
  toEnvelopeFields(v: ValidatedBase) {
    return { confidence: v.confidence, warnings: v.warnings };
  },
};
