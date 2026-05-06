import {
  type ActionDef,
  type MinimizedTab,
  type ValidatedBase,
  buildUserMessage,
  clampConfidence,
  isNonEmptyString,
  truncate,
} from "./_shared.js";

type TableRow = { item: string; cells: string[] };

type ValidatedTable = ValidatedBase & {
  columns: string[];
  rows: TableRow[];
  markdown: string;
  csv: string;
};

const SYSTEM_PROMPT = [
  "You are the comparison-table action for the Zenbrain ⌘K command palette.",
  "Convert the user's open tabs into a side-by-side comparison table.",
  "Reply ONLY with JSON matching this schema:",
  '{"columns":string[],"rows":{"item":string,"cells":string[]}[],"markdown":string,"csv":string,"confidence":number,"warnings":string[]}',
  "columns: 2..5 entries (the first column header should describe the dimension being compared, e.g. 'Aspect').",
  "Every column header is non-empty and <= 40 chars.",
  "rows: 2..8 entries; rows[i].cells.length === columns.length; each cell <= 200 chars.",
  "If a column does not apply for a row, set the cell to '—' rather than inventing.",
  "markdown: the same table rendered as a GitHub-flavored markdown table (header row + separator + data rows).",
  "csv: the same table rendered as RFC 4180 CSV (header row first; quote cells that contain commas or quotes).",
  "confidence: 0..1; lower if you had to invent a comparison axis the tabs don't support.",
  "warnings: short strings flagging anything the user should verify.",
].join("\n");

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function deterministic(tabs: MinimizedTab[]): ValidatedTable {
  const columns = ["Item", "Domain", "Notes"];
  const rows: TableRow[] = tabs.slice(0, 8).map((t) => ({
    item: truncate(t.title || t.url || t.domain || "Tab", 200),
    cells: [truncate(t.title || t.url || t.domain || "Tab", 200), truncate(t.domain || "—", 200), "—"],
  }));
  const header = `| ${columns.join(" | ")} |`;
  const sep = `| ${columns.map(() => "---").join(" | ")} |`;
  const body = rows.map((r) => `| ${r.cells.map((c) => c.replace(/\|/g, "\\|")).join(" | ")} |`).join("\n");
  const markdown = `${header}\n${sep}\n${body}\n`;
  const csv = `${columns.join(",")}\n${rows.map((r) => r.cells.map(csvEscape).join(",")).join("\n")}\n`;
  return { columns, rows, markdown, csv, confidence: 0.4, warnings: [] };
}

function validate(raw: unknown): ValidatedTable | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const cols = r["columns"];
  if (!Array.isArray(cols) || cols.length < 2 || cols.length > 5) return null;
  if (!(cols as unknown[]).every((c) => isNonEmptyString(c, 60))) return null;
  const rows = r["rows"];
  if (!Array.isArray(rows) || rows.length < 2 || rows.length > 8) return null;
  for (const row of rows as unknown[]) {
    if (!row || typeof row !== "object") return null;
    const rowObj = row as Record<string, unknown>;
    if (!isNonEmptyString(rowObj["item"], 200)) return null;
    const cells = rowObj["cells"];
    if (!Array.isArray(cells) || cells.length !== cols.length) return null;
    if (!(cells as unknown[]).every((c) => isNonEmptyString(c, 400))) return null;
  }
  if (!isNonEmptyString(r["markdown"], 8000)) return null;
  if (!isNonEmptyString(r["csv"], 8000)) return null;
  if (!Array.isArray(r["warnings"])) return null;
  return {
    columns: (cols as string[]).map((c) => truncate(c, 40)),
    rows: (rows as Array<{ item: string; cells: string[] }>).map((row) => ({
      item: truncate(row.item, 200),
      cells: row.cells.map((c) => truncate(c, 200)),
    })),
    markdown: truncate(r["markdown"] as string, 8000),
    csv: truncate(r["csv"] as string, 8000),
    confidence: clampConfidence(r["confidence"]),
    warnings: (r["warnings"] as unknown[]).filter((w): w is string => typeof w === "string").slice(0, 5),
  };
}

export const compare_tabs: ActionDef = {
  id: "compare_tabs",
  resultKind: "table",
  // Haiku per the issue spec — structuring task is lower-stakes than long-form drafting.
  model: "haiku",
  // Higher floor per CTO direction in MIN-178 — comparison failure modes are
  // visible to users immediately, so we want the fallback panel to fire sooner.
  defaultConfidenceThreshold: 0.6,
  systemPrompt: SYSTEM_PROMPT,
  buildUserMessage,
  validate,
  deterministic,
  toResultPayload(v: ValidatedBase): Record<string, unknown> {
    const validated = v as ValidatedTable;
    return { columns: validated.columns, rows: validated.rows, markdown: validated.markdown, csv: validated.csv };
  },
  toEnvelopeFields(v: ValidatedBase) {
    return { confidence: v.confidence, warnings: v.warnings };
  },
};
