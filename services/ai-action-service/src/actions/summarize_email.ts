import {
  type ActionDef,
  type MinimizedTab,
  TEXT_LIMITS,
  type ValidatedBase,
  buildUserMessage,
  clampConfidence,
  clusterLabelForDomain,
  isNonEmptyString,
  isStringArray,
  truncate,
} from "./_shared.js";

type ValidatedEmail = ValidatedBase & {
  subject: string;
  body: string;
  recipients: string[];
};

const SYSTEM_PROMPT = [
  "You are the email-draft action for the Zenbrain ⌘K command palette.",
  "The user has selected a set of open browser tabs and wants to share them with their team.",
  "Reply ONLY with JSON matching this schema:",
  '{"subject":string,"body":string,"recipients":string[],"confidence":number,"warnings":string[]}',
  "subject: <= 80 chars, descriptive, no marketing language.",
  "body: <= 1600 chars, plain text or simple markdown, signed 'Best,' (no name).",
  "recipients: 0..3 placeholder slugs only (e.g. 'team', 'design-review'). Never invent real email addresses.",
  "confidence: 0..1. Lower if tabs are unrelated or context is thin.",
  "warnings: short strings flagging anything the user should double-check before sending.",
].join("\n");

function deterministic(tabs: MinimizedTab[]): ValidatedEmail {
  const first = tabs[0];
  const label = clusterLabelForDomain(first?.domain ?? "");
  const firstTitle = first?.title || "";
  const subject = firstTitle
    ? truncate(`${firstTitle}${tabs.length > 1 ? ` — ${tabs.length} tabs` : ""}`, 80)
    : truncate(`${label} (${tabs.length} tab${tabs.length === 1 ? "" : "s"})`, 80);
  const lines = tabs.slice(0, 8).map((t) => `- ${truncate(t.title || t.domain || t.url, 80)}`);
  const more = tabs.length > 8 ? `\n- …and ${tabs.length - 8} more` : "";
  const intro = firstTitle
    ? `Started with "${firstTitle}"${tabs.length > 1 ? ` and ${tabs.length - 1} related tab${tabs.length - 1 === 1 ? "" : "s"}` : ""}`
    : `${tabs.length} ${label.toLowerCase()} tab${tabs.length === 1 ? "" : "s"}`;
  const body = truncate(
    `Hi team,\n\n${intro}. Sharing for context:\n\n${lines.join("\n")}${more}\n\nBest,`,
    TEXT_LIMITS.EMAIL_BODY_MAX,
  );
  return { subject, body, recipients: ["team"], confidence: 0.45, warnings: [] };
}

function validate(raw: unknown): ValidatedEmail | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!isNonEmptyString(r.subject, 200)) return null;
  if (!isNonEmptyString(r.body, TEXT_LIMITS.EMAIL_BODY_MAX + 200)) return null;
  if (!Array.isArray(r.recipients) || (r.recipients as unknown[]).length > 3) return null;
  if ((r.recipients as unknown[]).length > 0 && !isStringArray(r.recipients)) return null;
  if (!Array.isArray(r.warnings)) return null;
  return {
    subject: truncate(r.subject as string, 200),
    body: truncate(r.body as string, TEXT_LIMITS.EMAIL_BODY_MAX),
    recipients: (r.recipients as string[]).slice(0, 3).map((rec) => truncate(rec, 60)),
    confidence: clampConfidence(r.confidence),
    warnings: (r.warnings as unknown[])
      .filter((w): w is string => typeof w === "string")
      .slice(0, 5),
  };
}

export const summarize_email: ActionDef = {
  id: "summarize_email",
  resultKind: "email",
  // Sonnet by default — email tone matters and the design forbids auto-send,
  // so quality > cost. Haiku is reserved for compare_tabs / regroup_windows.
  model: "sonnet",
  // CTO direction in MIN-178: default 0.5 across the board for v1.
  defaultConfidenceThreshold: 0.5,
  systemPrompt: SYSTEM_PROMPT,
  buildUserMessage,
  validate,
  deterministic,
  toResultPayload(v: ValidatedBase): Record<string, unknown> {
    // Safe cast: this is always called with the output of validate/deterministic above.
    const validated = v as ValidatedEmail;
    return { subject: validated.subject, body: validated.body, recipients: validated.recipients };
  },
  toEnvelopeFields(v: ValidatedBase) {
    return { confidence: v.confidence, warnings: v.warnings };
  },
};
