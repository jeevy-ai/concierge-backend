import { describe, expect, it } from "vitest";
import app from "../src/index.js";
import type { Env } from "../src/index.js";

const testEnv: Env = {
  ENVIRONMENT: "test",
  AUTH_MODE: "none",
  AUTH_BEARER_TOKEN: "",
  RECAP_USE_LLM: "false",
  VERTEX_REGION: "",
  VERTEX_PROJECT_ID: "",
  RECAP_MODEL: "",
  RECAP_TIMEOUT_MS: "",
};

const validWindow = {
  windowId: "win1",
  startedAt: "2026-05-01T10:00:00Z",
  endedAt: "2026-05-01T11:00:00Z",
  tabs: [{ title: "Test Page", url: "https://example.com", domain: "example.com" }],
};

describe("ai-recap-service", () => {
  it("GET /internal/healthz returns ok", async () => {
    const res = await app.request("/internal/healthz", {}, testEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; contractVersion: string; llmEnabled: boolean };
    expect(body.ok).toBe(true);
    expect(typeof body.contractVersion).toBe("string");
    expect(typeof body.llmEnabled).toBe("boolean");
  });

  it("POST /v1/ai/recap with valid body returns recap response shape", async () => {
    const res = await app.request(
      "/v1/ai/recap",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "test-user", intentWindows: [validWindow] }),
      },
      testEnv,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      contractVersion: string;
      recapId: string;
      generatedAt: string;
      source: string;
      clusters: unknown[];
      warnings: string[];
    };
    expect(typeof body.contractVersion).toBe("string");
    expect(typeof body.recapId).toBe("string");
    expect(typeof body.generatedAt).toBe("string");
    expect(["llm", "deterministic"]).toContain(body.source);
    expect(Array.isArray(body.clusters)).toBe(true);
    expect(Array.isArray(body.warnings)).toBe(true);
  });

  it("POST /v1/ai/recap with empty intentWindows returns 400 INVALID_INPUT", async () => {
    const res = await app.request(
      "/v1/ai/recap",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "test-user", intentWindows: [] }),
      },
      testEnv,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_INPUT");
  });
});

describe("meeting domain classification (YOU-519)", () => {
  const meetingCases = [
    { domain: "meet.google.com", title: "Q2 Planning Kickoff", url: "https://meet.google.com/abc-defg-hij" },
    { domain: "zoom.us", title: "Weekly Sync", url: "https://zoom.us/j/1234567890" },
    { domain: "teams.microsoft.com", title: "Sprint Review", url: "https://teams.microsoft.com/meet/123" },
    { domain: "whereby.com", title: "Design Review", url: "https://whereby.com/myroom" },
  ];

  for (const { domain, title, url } of meetingCases) {
    it(`${domain} → label=Meeting, suggestedAction=archive`, async () => {
      const res = await app.request(
        "/v1/ai/recap",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: "test-user",
            intentWindows: [
              {
                windowId: "win-meeting",
                startedAt: "2026-05-01T10:00:00Z",
                endedAt: "2026-05-01T11:00:00Z",
                tabs: [{ title, url, domain }],
              },
            ],
          }),
        },
        testEnv,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { clusters: Array<{ label: string; suggestedAction: string }> };
      expect(body.clusters.length).toBeGreaterThan(0);
      const cluster = body.clusters[0]!;
      expect(cluster.label).toBe("Meeting");
      expect(cluster.suggestedAction).toBe("archive");
    });
  }

  it("single Google Meet tab is not Research and not ignore", async () => {
    const res = await app.request(
      "/v1/ai/recap",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: "test-user",
          intentWindows: [
            {
              windowId: "win-meet-single",
              startedAt: "2026-05-01T10:00:00Z",
              endedAt: "2026-05-01T11:00:00Z",
              tabs: [{ title: "Google Meet - Q2 Planning Kickoff", url: "https://meet.google.com/abc-defg-hij", domain: "meet.google.com" }],
            },
          ],
        }),
      },
      testEnv,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { clusters: Array<{ label: string; suggestedAction: string }> };
    const cluster = body.clusters[0]!;
    expect(cluster.label).not.toBe("Research");
    expect(cluster.suggestedAction).not.toBe("ignore");
  });
});
