import { describe, expect, it, vi, beforeEach } from "vitest";
import { buildSlackBlocks, collectWeeklyMetrics, runWeeklyReport } from "../src/lib/weekly-report.js";
import type { WeeklyMetrics, WeeklyReportEnv } from "../src/lib/weekly-report.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeKv(store: Record<string, string>): KVNamespace {
  return {
    get: async (key: string) => store[key] ?? null,
    put: async (key: string, value: string) => { store[key] = value; },
    list: async ({ prefix }: { prefix?: string } = {}) => ({
      keys: Object.keys(store)
        .filter((k) => !prefix || k.startsWith(prefix))
        .map((name) => ({ name })),
      list_complete: true,
      cursor: undefined,
    }),
    delete: async () => {},
    getWithMetadata: async () => ({ value: null, metadata: null }),
  } as unknown as KVNamespace;
}

function makeEnv(overrides: Partial<WeeklyReportEnv> = {}): WeeklyReportEnv {
  return {
    STRIPE_SECRET_KEY: "sk_test_mock",
    CONCIERGE_KV: makeKv({}),
    INTERVIEWS_KV: makeKv({}),
    RESEND_API_KEY: "re_test_mock",
    FROM_EMAIL: "team@jeevy.ai",
    SLACK_WEBHOOK_URL: undefined,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildSlackBlocks
// ---------------------------------------------------------------------------

describe("buildSlackBlocks", () => {
  const metrics: WeeklyMetrics = {
    reportDate: "2026-05-25",
    billing: { paidUsers: 12, mrrCents: 59900, churnedThisWeek: 1 },
    activation: { usersAttempted: 45, usersFirstValue: 30, usersNthValue: 10 },
    nps: { score: 42, respondents: 7, promoters: 5, passives: 1, detractors: 1 },
  };

  it("produces a header block with the report date", () => {
    const blocks = buildSlackBlocks(metrics);
    const header = blocks[0] as { text: { text: string } };
    expect(header.text.text).toContain("2026-05-25");
  });

  it("includes MRR formatted in dollars", () => {
    const blocks = buildSlackBlocks(metrics);
    const json = JSON.stringify(blocks);
    expect(json).toContain("$599");
  });

  it("shows NPS score with sign", () => {
    const blocks = buildSlackBlocks(metrics);
    const json = JSON.stringify(blocks);
    expect(json).toContain("+42");
  });

  it("shows n/a NPS when no respondents", () => {
    const noNps: WeeklyMetrics = {
      ...metrics,
      nps: { score: null, respondents: 0, promoters: 0, passives: 0, detractors: 0 },
    };
    const json = JSON.stringify(buildSlackBlocks(noNps));
    expect(json).toContain("n/a");
  });
});

// ---------------------------------------------------------------------------
// collectWeeklyMetrics — activation KV
// ---------------------------------------------------------------------------

describe("collectWeeklyMetrics — activation", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("counts unique users at each activation stage from KV keys", async () => {
    const conciergeKv = makeKv({
      "activation:user1:first_action_fired": "1",
      "activation:user2:first_action_fired": "1",
      "activation:user1:completion_count": "1",
      "activation:user2:completion_count": "3",
      "activation:user2:nth_fired:3": "1",
    });

    vi.stubGlobal("fetch", async (url: string) => {
      if (String(url).includes("api.stripe.com")) {
        return {
          ok: true,
          json: async () => ({ object: "list", data: [], has_more: false }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });

    const env = makeEnv({ CONCIERGE_KV: conciergeKv });
    const metrics = await collectWeeklyMetrics(env);

    expect(metrics.activation.usersAttempted).toBe(2);
    expect(metrics.activation.usersFirstValue).toBe(2);
    expect(metrics.activation.usersNthValue).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// collectWeeklyMetrics — NPS
// ---------------------------------------------------------------------------

describe("collectWeeklyMetrics — NPS", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("computes NPS score from recent KV records", async () => {
    const now = new Date().toISOString();
    const interviewsKv = makeKv({
      tracked_users: JSON.stringify(["u1", "u2", "u3", "u4"]),
      "user:u1:nps": JSON.stringify({ score: 10, recordedAt: now }),
      "user:u2:nps": JSON.stringify({ score: 9, recordedAt: now }),
      "user:u3:nps": JSON.stringify({ score: 7, recordedAt: now }),
      "user:u4:nps": JSON.stringify({ score: 3, recordedAt: now }),
    });

    vi.stubGlobal("fetch", async (url: string) => {
      if (String(url).includes("api.stripe.com")) {
        return { ok: true, json: async () => ({ object: "list", data: [], has_more: false }) };
      }
      return { ok: true, json: async () => ({}) };
    });

    const env = makeEnv({ INTERVIEWS_KV: interviewsKv });
    const metrics = await collectWeeklyMetrics(env);

    // promoters=2 (scores 10,9), passives=1 (7), detractors=1 (3)
    // NPS = (2-1)/4 * 100 = 25
    expect(metrics.nps.respondents).toBe(4);
    expect(metrics.nps.promoters).toBe(2);
    expect(metrics.nps.passives).toBe(1);
    expect(metrics.nps.detractors).toBe(1);
    expect(metrics.nps.score).toBe(25);
  });

  it("excludes NPS records older than 30 days", async () => {
    const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    const interviewsKv = makeKv({
      tracked_users: JSON.stringify(["u1"]),
      "user:u1:nps": JSON.stringify({ score: 10, recordedAt: old }),
    });

    vi.stubGlobal("fetch", async (url: string) => {
      if (String(url).includes("api.stripe.com")) {
        return { ok: true, json: async () => ({ object: "list", data: [], has_more: false }) };
      }
      return { ok: true, json: async () => ({}) };
    });

    const env = makeEnv({ INTERVIEWS_KV: interviewsKv });
    const metrics = await collectWeeklyMetrics(env);

    expect(metrics.nps.score).toBeNull();
    expect(metrics.nps.respondents).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// runWeeklyReport — delivery routing
// ---------------------------------------------------------------------------

describe("runWeeklyReport", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("posts to Slack when SLACK_WEBHOOK_URL is set", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(String(url));
      if (String(url).includes("api.stripe.com")) {
        return { ok: true, json: async () => ({ object: "list", data: [], has_more: false }) };
      }
      // Slack webhook
      return { ok: true, text: async () => "ok" };
    });

    const result = await runWeeklyReport(
      makeEnv({ SLACK_WEBHOOK_URL: "https://hooks.slack.com/services/T00/B00/fake" }),
    );

    expect(result.delivered).toBe("slack");
    expect(calls.some((u) => u.includes("hooks.slack.com"))).toBe(true);
  });

  it("sends email via Resend when no Slack webhook", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(String(url));
      if (String(url).includes("api.stripe.com")) {
        return { ok: true, json: async () => ({ object: "list", data: [], has_more: false }) };
      }
      // Resend
      return { ok: true, json: async () => ({ id: "email_abc" }) };
    });

    const result = await runWeeklyReport(makeEnv());
    expect(result.delivered).toBe("email");
    expect(calls.some((u) => u.includes("resend.com"))).toBe(true);
  });
});
