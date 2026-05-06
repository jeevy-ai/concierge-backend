import { describe, expect, it } from "vitest";
import app from "../src/index.js";

describe("ai-action-service", () => {
  it("GET /health returns ok", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; service: string };
    expect(body.ok).toBe(true);
    expect(body.service).toBe("ai-action-service");
  });

  it("GET /api/actions returns empty list", async () => {
    const res = await app.request("/api/actions");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { actions: unknown[] };
    expect(Array.isArray(body.actions)).toBe(true);
  });
});
