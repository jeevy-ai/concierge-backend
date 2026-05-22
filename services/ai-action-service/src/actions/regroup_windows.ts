import {
  type ActionDef,
  type MinimizedTab,
  type ValidatedBase,
  buildUserMessage,
  clampConfidence,
  clusterLabelForDomain,
  isNonEmptyString,
  truncate,
} from "./_shared.js";

type WindowGroup = { groupId: string; name: string; rationale: string; tabIds: (string | number)[] };

type ValidatedGroups = ValidatedBase & {
  groups: WindowGroup[];
};

const SYSTEM_PROMPT = [
  "You are the window-grouping action for the Zenbrain ⌘K command palette.",
  "Re-group the user's open tabs into a smaller number of focused windows.",
  "Reply ONLY with JSON matching this schema:",
  '{"groups":[{"groupId":string,"name":string,"rationale":string,"tabIds":(string|number)[]}],"confidence":number,"warnings":string[]}',
  "1..6 groups; each name <= 40 chars; rationale <= 200 chars and references the tabs concretely.",
  "Each tabId MUST come from the input tab set; never invent ids; never duplicate ids across groups.",
  "Every input tab MUST appear in exactly one group (no orphans, no duplicates).",
  "confidence: 0..1; lower if grouping is ambiguous.",
  "warnings: short strings flagging anything the user should sanity-check before applying.",
].join("\n");

function deterministic(tabs: MinimizedTab[], contextHint?: string): ValidatedGroups {
  const buckets = new Map<string, MinimizedTab[]>();
  for (const t of tabs) {
    const label = clusterLabelForDomain(t.domain ?? "");
    if (!buckets.has(label)) buckets.set(label, []);
    buckets.get(label)!.push(t);
  }
  const groups: WindowGroup[] = [];
  let i = 0;
  for (const [label, list] of buckets.entries()) {
    i += 1;
    const titles = list
      .slice(0, 2)
      .map((t) => t.title || t.domain || "")
      .filter(Boolean);
    const extra = list.length > 2 ? ` and ${list.length - 2} more` : "";
    const hint = contextHint ? ` (${contextHint.slice(0, 60)})` : "";
    const rationale =
      titles.length > 0
        ? truncate(
            `Grouped "${titles.join('" and "')}"${extra} — ${label.toLowerCase()} context${hint}.`,
            200,
          )
        : truncate(`${list.length} tab${list.length === 1 ? "" : "s"} from ${label.toLowerCase()}.`, 200);
    groups.push({
      groupId: `grp_${i}`,
      name: truncate(label, 40),
      rationale,
      tabIds: list.map((t) => t.tabId).filter((id): id is string | number => id !== null),
    });
    if (groups.length >= 6) break;
  }
  return { groups, confidence: 0.4, warnings: [] };
}

function validate(raw: unknown, allowedTabIds?: Set<string | number> | null): ValidatedGroups | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const rawGroups = r["groups"];
  if (!Array.isArray(rawGroups) || rawGroups.length < 1 || rawGroups.length > 6) return null;
  const seenTabIds = new Set<string | number>();
  for (const g of rawGroups as unknown[]) {
    if (!g || typeof g !== "object") return null;
    const grp = g as Record<string, unknown>;
    if (!isNonEmptyString(grp["groupId"], 80)) return null;
    if (!isNonEmptyString(grp["name"], 200)) return null;
    if (!isNonEmptyString(grp["rationale"], 400)) return null;
    const tabIds = grp["tabIds"];
    if (!Array.isArray(tabIds) || tabIds.length === 0) return null;
    for (const id of tabIds as unknown[]) {
      if (typeof id !== "string" && typeof id !== "number") return null;
      if (allowedTabIds && !allowedTabIds.has(id)) return null;
      if (seenTabIds.has(id)) return null;
      seenTabIds.add(id);
    }
  }
  // Coverage: every allowed tab id must appear in exactly one group.
  if (allowedTabIds) {
    for (const id of allowedTabIds) {
      if (!seenTabIds.has(id)) return null;
    }
  }
  if (!Array.isArray(r["warnings"])) return null;
  return {
    groups: (rawGroups as Array<{ groupId: string; name: string; rationale: string; tabIds: (string | number)[] }>).map(
      (g, idx) => ({
        groupId: truncate(g.groupId || `grp_${idx + 1}`, 80),
        name: truncate(g.name, 40),
        rationale: truncate(g.rationale, 200),
        tabIds: g.tabIds,
      }),
    ),
    confidence: clampConfidence(r["confidence"]),
    warnings: (r["warnings"] as unknown[]).filter((w): w is string => typeof w === "string").slice(0, 5),
  };
}

export const regroup_windows: ActionDef = {
  id: "regroup_windows",
  resultKind: "groups",
  // Haiku per the issue spec — structuring task; quality bar is "didn't lose a tab".
  model: "haiku",
  // Higher floor per CTO direction in MIN-178 — wrong groupings are immediately
  // visible and the action mutates state behind an Undo, so we want a
  // conservative threshold for v1.
  defaultConfidenceThreshold: 0.6,
  systemPrompt: SYSTEM_PROMPT,
  buildUserMessage,
  validate,
  // The dispatcher passes the validator context (allowed tab id set) built here into validate().
  buildValidatorContext(tabs: MinimizedTab[]): Set<string | number> {
    return new Set(tabs.map((t) => t.tabId).filter((id): id is string | number => id !== null));
  },
  deterministic,
  toResultPayload(v: ValidatedBase): Record<string, unknown> {
    const validated = v as ValidatedGroups;
    return { groups: validated.groups };
  },
  toEnvelopeFields(v: ValidatedBase) {
    return { confidence: v.confidence, warnings: v.warnings };
  },
};
