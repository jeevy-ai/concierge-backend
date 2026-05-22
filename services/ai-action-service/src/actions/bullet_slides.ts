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
  "You are the slide-bullets action for the Zenbrain \u2318K command palette.",
  "Convert the user's open tabs into clusters of short bullets, ready to paste into a slide deck.",
  "Reply ONLY with JSON matching this schema:",
  '{"clusters":[{"clusterId":string,"title":string,"bullets":string[]}],"copyAll":string,"confidence":number,"warnings":string[]}',
  "1..4 clusters; each title <= 60 chars; bullets is 1..7 entries; each bullet <= 120 chars and a single line.",
  "Derive bullets from actual tab content \u2014 never emit placeholder text.",
  "FORBIDDEN: never emit template/placeholder strings such as 'Open question \u2014 fill in before sharing', 'Click to add title', 'Add a text box', or any lorem ipsum variant.",
  "FORBIDDEN: never repeat the same bullet text twice within a cluster.",
  "If the tab title is the only signal, derive 1\u20133 distinct bullets from its keywords instead of inventing content.",
  "Bullets are punchy, scannable, and avoid full sentences. No emoji.",
  "copyAll: the full slide deck as plain text \u2014 one cluster per block, blank lines between blocks, bullets prefixed with '- '.",
  "confidence: 0..1; warnings: short strings flagging gaps the user should verify.",
].join("\n");

function titleToBullets(title: string, domain: string, url: string): string[] {
  const text = (title || domain || url).trim();
  if (!text) return [];
  const parts = text
    .split(/\s*[|\u2014\xb7\/]\s*|\s+-\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length >= 2) return parts.map((p) => truncate(p, 120));
  const words = text.split(/\s+/);
  if (words.length >= 6) {
    const mid = Math.ceil(words.length / 2);
    return [
      truncate(words.slice(0, mid).join(" "), 120),
      truncate(words.slice(mid).join(" "), 120),
    ];
  }
  return [truncate(text, 120)];
}

function deterministic(tabs: MinimizedTab[]): ValidatedSlides {
  const grouped = new Map<string, MinimizedTab[]>();
  for (const t of tabs) {
    const label = clusterLabelForDomain(t.domain ?? "");
    if (!grouped.has(label)) grouped.set(label, []);
    grouped.get(label)?.push(t);
  }
  const clusters: SlideCluster[] = [];
  let i = 0;
  for (const [label, list] of grouped.entries()) {
    i += 1;
    const bullets: string[] = [];
    for (const t of list.slice(0, 7)) {
      for (const b of titleToBullets(t.title, t.domain ?? "", t.url)) {
        if (bullets.length < 7) bullets.push(b);
      }
    }
    if (bullets.length === 0) continue;
    clusters.push({ clusterId: `cls_${i}`, title: truncate(label, 60), bullets });
    if (clusters.length >= 4) break;
  }
  const copyAll = clusters
    .map((c) => `${c.title}\n${c.bullets.map((b) => `- ${b}`).join("\n")}`)
    .join("\n\n");
  return { clusters, copyAll, confidence: 0.45, warnings: [] };
}

// Patterns known to be Google Slides / deck template placeholders rather than real content.
const PLACEHOLDER_BULLET_RE =
  /open\s+question\s*[—–-]|fill\s+in\s+before\s+sharing|click\s+to\s+add\s+(title|text|subtitle)|add\s+a\s+text\s+box|lorem\s+ipsum/i;

function filterBullets(raw: string[]): string[] {
  return raw.filter((b) => !PLACEHOLDER_BULLET_RE.test(b));
}

function allIdentical(arr: string[]): boolean {
  return arr.length > 1 && new Set(arr).size === 1;
}

function validate(raw: unknown): ValidatedSlides | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const cls = r.clusters;
  if (!Array.isArray(cls) || cls.length < 1 || cls.length > 4) return null;
  for (const c of cls as unknown[]) {
    if (!c || typeof c !== "object") return null;
    const cluster = c as Record<string, unknown>;
    if (!isNonEmptyString(cluster.clusterId, 80)) return null;
    if (!isNonEmptyString(cluster.title, 200)) return null;
    const bullets = cluster.bullets;
    if (!Array.isArray(bullets) || bullets.length < 1 || bullets.length > 7) return null;
    if (!(bullets as unknown[]).every((b) => isNonEmptyString(b, 200))) return null;
  }
  if (!isNonEmptyString(r.copyAll, 4000)) return null;
  if (!Array.isArray(r.warnings)) return null;

  const validClusters = (cls as Array<{ clusterId: string; title: string; bullets: string[] }>)
    .map((c, idx) => {
      const cleaned = filterBullets(c.bullets.map((b) => truncate(b, 120)));
      return {
        clusterId: truncate(c.clusterId || `cls_${idx + 1}`, 80),
        title: truncate(c.title, 60),
        bullets: cleaned,
      };
    })
    .filter((c) => c.bullets.length > 0 && !allIdentical(c.bullets));

  // If placeholder/loop filtering wiped all clusters, fall back to deterministic
  if (validClusters.length === 0) return null;

  const copyAll = validClusters
    .map((c) => `${c.title}\n${c.bullets.map((b) => `- ${b}`).join("\n")}`)
    .join("\n\n");

  return {
    clusters: validClusters,
    copyAll,
    confidence: clampConfidence(r.confidence),
    warnings: (r.warnings as unknown[])
      .filter((w): w is string => typeof w === "string")
      .slice(0, 5),
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
