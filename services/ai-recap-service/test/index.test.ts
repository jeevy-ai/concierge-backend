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
