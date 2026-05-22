import { type ValidatedBase, clampConfidence, isNonEmptyString } from "../actions/_shared.js";
import type { ConciergeVerbDef } from "./_shared.js";

type ValidatedReservation = ValidatedBase & {
  venue: string;
  datetime: string;
  partySize: number;
  slot: string;
  fallbacks: string[];
  calendarAddLink: string;
};

const SYSTEM_PROMPT = [
  "You are the book_reservation concierge verb.",
  "Given a natural-language reservation request, extract the relevant details and respond ONLY with JSON matching this schema:",
  '{"venue":string,"datetime":string,"partySize":number,"slot":string,"fallbacks":string[],"calendarAddLink":string,"confidence":number,"warnings":string[]}',
  "venue: restaurant or venue name extracted from the request, or a sensible default if unspecified.",
  "datetime: ISO 8601 datetime string for the requested time (use today + 7pm if unspecified).",
  "partySize: number of people (default 2 if unspecified).",
  "slot: human-readable slot label like '7:00 PM Saturday'.",
  "fallbacks: 1-3 alternative slot strings if the primary may be unavailable.",
  "calendarAddLink: a google calendar add link URL for the datetime and venue.",
  "confidence: 0..1 — lower if venue or time is ambiguous.",
  "warnings: short strings for anything the user should double-check.",
].join("\n");

function todayPlus(days: number, hour = 19): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

function calLink(venue: string, iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  const fmt = (dt: Date) =>
    `${dt.getUTCFullYear()}${pad(dt.getUTCMonth() + 1)}${pad(dt.getUTCDate())}T${pad(dt.getUTCHours())}${pad(dt.getUTCMinutes())}00Z`;
  const end = new Date(d.getTime() + 90 * 60 * 1000);
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: `Reservation at ${venue}`,
    dates: `${fmt(d)}/${fmt(end)}`,
    details: "Reservation booked via YOU concierge",
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function extractVenue(text: string): string {
  const m = text.match(/at\s+([A-Z][^\s,\.]{1,40}(?:\s+[A-Z][^\s,\.]{0,30})?)/);
  if (m?.[1]) return m[1];
  const words = text.split(/\s+/).filter((w) => /^[A-Z]/.test(w));
  return words[0] ?? "the venue";
}

function extractPartySize(text: string): number {
  const m =
    text.match(/\b(\d+)\s*(people|person|guests?|pax|of\s+us)\b/i) ??
    text.match(/\bfor\s+(\d+)\b/i);
  if (m?.[1]) {
    const n = Number.parseInt(m[1], 10);
    return Number.isFinite(n) && n > 0 && n <= 50 ? n : 2;
  }
  return 2;
}

function deterministic(text: string): ValidatedReservation {
  const venue = extractVenue(text);
  const partySize = extractPartySize(text);
  const dt = todayPlus(7);
  const slotDate = new Date(dt);
  const slotLabel = slotDate.toLocaleString("en-US", {
    weekday: "long",
    hour: "numeric",
    minute: "2-digit",
  });
  return {
    venue,
    datetime: dt,
    partySize,
    slot: slotLabel,
    fallbacks: [
      new Date(todayPlus(7, 18)).toLocaleString("en-US", {
        weekday: "long",
        hour: "numeric",
        minute: "2-digit",
      }),
      new Date(todayPlus(8, 19)).toLocaleString("en-US", {
        weekday: "long",
        hour: "numeric",
        minute: "2-digit",
      }),
    ],
    calendarAddLink: calLink(venue, dt),
    confidence: 0.45,
    warnings: [],
  };
}

function validate(raw: unknown): ValidatedReservation | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!isNonEmptyString(r.venue, 200)) return null;
  if (!isNonEmptyString(r.datetime, 100)) return null;
  if (typeof r.partySize !== "number" || r.partySize < 1) return null;
  if (!isNonEmptyString(r.slot, 100)) return null;
  if (!Array.isArray(r.fallbacks)) return null;
  if (!isNonEmptyString(r.calendarAddLink, 500)) return null;
  if (!Array.isArray(r.warnings)) return null;
  return {
    venue: (r.venue as string).slice(0, 200),
    datetime: (r.datetime as string).slice(0, 100),
    partySize: Math.min(Math.max(1, Math.round(r.partySize as number)), 100),
    slot: (r.slot as string).slice(0, 100),
    fallbacks: (r.fallbacks as unknown[])
      .filter((f): f is string => typeof f === "string" && f.length > 0)
      .slice(0, 5),
    calendarAddLink: (r.calendarAddLink as string).slice(0, 500),
    confidence: clampConfidence(r.confidence),
    warnings: (r.warnings as unknown[])
      .filter((w): w is string => typeof w === "string")
      .slice(0, 5),
  };
}

export const book_reservation: ConciergeVerbDef = {
  id: "book_reservation",
  resultKind: "reservation",
  model: "sonnet",
  defaultConfidenceThreshold: 0.5,
  systemPrompt: SYSTEM_PROMPT,
  buildUserMessage: (text) => `Request: ${text}`,
  validate,
  deterministic,
  toResultPayload(v: ValidatedBase): Record<string, unknown> {
    const vr = v as ValidatedReservation;
    return {
      venue: vr.venue,
      datetime: vr.datetime,
      partySize: vr.partySize,
      slot: vr.slot,
      fallbacks: vr.fallbacks,
      calendarAddLink: vr.calendarAddLink,
    };
  },
  toEnvelopeFields(v: ValidatedBase) {
    return { confidence: v.confidence, warnings: v.warnings };
  },
};
