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

type SlideCluster = { clusterId: string; title: string; bullets: string[] };

type ValidatedSlides = ValidatedBase & {
  clusters: SlideCluster[];
  copyAll: string;
};

const SYSTEM_PROMPT = [
  "You are the slide-bullets action for the Zenbrain ⌘K command palette.",
  "Convert the user's open tabs into clusters of 5-7 short bullets, ready to paste into a slide deck.",
  "Reply ONLY with JSON matching this schema:",
  '{"clusters":[{"clusterId":string,"title":string,"bullets":string[]}],"copyAll":string,"confidence":number,"warnings":string[]}',
  "1..4 clusters; each title <= 60 chars; bullets is 5..7 entries; each bullet <= 120 chars and a single line.",
  "Bullets are punchy, scannable, and avoid full sentences. No emoji.",
  "copyAll: the full slide deck as plain text — one cluster per block, blank lines between blocks, bullets prefixed with '- '.",
  "confidence: 0..1; warnings: short strings flagging gaps the user should verify.",
].join("\n");

function deterministic(tabs: MinimizedTab[]): ValidatedSlides {
  const grouped = new Map<string, MinimizedTab[]>();
  for (const t of tabs) {
    const label = clusterLabelForDomain(t.domain ?? "");
    if (!grouped.has(label)) grouped.set(label, []);
    grouped.get(label)!.push(t);
  }
  const clusters: SlideCluster[] = [];
  let i = 0;
  for (const [label, list] of grouped.entries()) {
    i += 1;
    const bullets = list.slice(0, 7).map((t) => truncate(t.title || t.domain || t.url, 120));
    while (bullets.length < 5) {
      bullets.push("Open question — fill in before sharing.");
    }
    clusters.push({ clusterId: `cls_${i}`, title: truncate(label, 60), bullets: bullets.slice(0, 7) });
    if (clusters.length >= 4) break;
  }
  const copyAll = clusters
    .map((c) => `${c.title}\n${c.bullets.map((b) => `- ${b}`).join("\n")}`)
    .join("\n\n");
  return { clusters, copyAll, confidence: 0.45, warnings: [] };
}

function validate(raw: unknown): ValidatedSlides | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const cls = r["clusters"];
  if (!Array.isArray(cls) || cls.length < 1 || cls.length > 4) return null;
  for (const c of cls as unknown[]) {
    if (!c || typeof c !== "object") return null;
    const cluster = c as Record<string, unknown>;
    if (!isNonEmptyString(cluster["clusterId"], 80)) return null;
    if (!isNonEmptyString(cluster["title"], 200)) return null;
    const bullets = cluster["bullets"];
    if (!Array.isArray(bullets) || bullets.length < 5 || bullets.length > 7) return null;
    if (!(bullets as unknown[]).every((b) => isNonEmptyString(b, 200))) return null;
  }
  if (!isNonEmptyString(r["copyAll"], 4000)) return null;
  if (!Array.isArray(r["warnings"])) return null;
  return {
    clusters: (cls as Array<{ clusterId: string; title: string; bullets: string[] }>).map((c, idx) => ({
      clusterId: truncate(c.clusterId || `cls_${idx + 1}`, 80),
      title: truncate(c.title, 60),
      bullets: c.bullets.map((b) => truncate(b, 120)),
    })),
    copyAll: truncate(r["copyAll"] as string, 4000),
    confidence: clampConfidence(r["confidence"]),
    warnings: (r["warnings"] as unknown[]).filter((w): w is string => typeof w === "string").slice(0, 5),
  };
}

export const bullet_slides: ActionDef = {
  id: "bullet_slides",
  resultKind: "bullets",
  model: "sonnet",
  defaultConfidenceThreshold: 0.5,
  systemPrompt: SYSTEM_PROMPT,
  buildUserMessage,
  validate,
  deterministic,
  toResultPayload(v: ValidatedBase): Record<string, unknown> {
    const validated = v as ValidatedSlides;
    return { clusters: validated.clusters, copyAll: validated.copyAll };
  },
  toEnvelopeFields(v: ValidatedBase) {
    return { confidence: v.confidence, warnings: v.warnings };
  },
};
