import { describe, expect, it } from "vitest";
import { app } from "../src/index.js";

describe("POST /concierge/itinerary", () => {
  it("returns 503 when no AI provider is configured", async () => {
    const res = await app.request("/concierge/itinerary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
    });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/not configured/);
  });

  it("returns 400 on missing messages field", async () => {
    const res = await app.request(
      "/concierge/itinerary",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
      // Provide a stub key so validation error surfaces, not 503
      { ANTHROPIC_API_KEY: "sk-ant-test" },
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 on empty messages array", async () => {
    const res = await app.request(
      "/concierge/itinerary",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [] }),
      },
      { ANTHROPIC_API_KEY: "sk-ant-test" },
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 on invalid message role", async () => {
    const res = await app.request(
      "/concierge/itinerary",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "system", content: "hello" }],
        }),
      },
      { ANTHROPIC_API_KEY: "sk-ant-test" },
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 on invalid JSON body", async () => {
    const res = await app.request(
      "/concierge/itinerary",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not-json",
      },
      { ANTHROPIC_API_KEY: "sk-ant-test" },
    );
    expect(res.status).toBe(400);
  });
});
