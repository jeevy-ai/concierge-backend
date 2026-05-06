import { describe, expect, it } from "vitest";
import app from "../src/index.js";

describe("ai-recap-service", () => {
  it("GET /health returns ok", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; service: string };
    expect(body.ok).toBe(true);
    expect(body.service).toBe("ai-recap-service");
  });

  it("GET /api/recaps returns empty list", async () => {
    const res = await app.request("/api/recaps");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { recaps: unknown[] };
    expect(Array.isArray(body.recaps)).toBe(true);
  });
});
