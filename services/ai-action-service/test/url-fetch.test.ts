import { describe, expect, it, vi, afterEach } from "vitest";
import { fetchUrlContent, htmlToText, FETCH_TEXT_LIMIT } from "../src/lib/url-fetch.js";

// ---------------------------------------------------------------------------
// htmlToText
// ---------------------------------------------------------------------------

describe("htmlToText", () => {
  it("strips script and style blocks", () => {
    const html = "<html><script>alert(1)</script><style>body{}</style><p>Hello world</p></html>";
    expect(htmlToText(html)).toBe("Hello world");
  });

  it("collapses whitespace", () => {
    const html = "<p>One</p>   <p>Two</p>\n\n<p>Three</p>";
    expect(htmlToText(html)).toBe("One Two Three");
  });

  it("decodes common HTML entities", () => {
    const html = "<p>Fish &amp; Chips &lt;3&gt; &quot;nice&quot; &#39;yes&#39;</p>";
    expect(htmlToText(html)).toBe(`Fish & Chips <3> "nice" 'yes'`);
  });

  it("truncates to FETCH_TEXT_LIMIT chars", () => {
    const html = "<p>" + "A".repeat(FETCH_TEXT_LIMIT + 500) + "</p>";
    const result = htmlToText(html);
    expect(result.length).toBe(FETCH_TEXT_LIMIT);
  });
});

// ---------------------------------------------------------------------------
// fetchUrlContent — guardrails
// ---------------------------------------------------------------------------

describe("fetchUrlContent guardrails", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects non-HTTPS URLs", async () => {
    const result = await fetchUrlContent("http://example.com/page");
    expect(result.error).toMatch(/HTTPS/);
  });

  it("rejects invalid URLs", async () => {
    const result = await fetchUrlContent("not-a-url");
    expect(result.error).toMatch(/Invalid URL/);
  });

  it("rejects localhost", async () => {
    const result = await fetchUrlContent("https://localhost/admin");
    expect(result.error).toMatch(/private/i);
  });

  it("rejects 10.x.x.x private range", async () => {
    const result = await fetchUrlContent("https://10.0.0.1/secret");
    expect(result.error).toMatch(/private/i);
  });

  it("rejects 192.168.x.x private range", async () => {
    const result = await fetchUrlContent("https://192.168.1.100/secret");
    expect(result.error).toMatch(/private/i);
  });

  it("returns error on HTTP 404", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("not found", {
          status: 404,
          headers: { "content-type": "text/html" },
        }),
      ),
    );
    const result = await fetchUrlContent("https://example.com/gone");
    expect(result.error).toMatch(/404/);
  });

  it("returns error on unsupported content type", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(new Uint8Array([0, 1, 2]), {
          status: 200,
          headers: { "content-type": "application/pdf" },
        }),
      ),
    );
    const result = await fetchUrlContent("https://example.com/file.pdf");
    expect(result.error).toMatch(/Unsupported content type/);
  });

  it("returns extracted text for a successful HTML page", async () => {
    const html = "<html><body><h1>PyCon 2027</h1><p>Date: June 5–7. Location: Berlin.</p></body></html>";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(html, {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
      ),
    );
    const result = await fetchUrlContent("https://pycon.example.com");
    expect(result.error).toBeUndefined();
    expect(result.text).toContain("PyCon 2027");
    expect(result.text).toContain("Berlin");
  });

  it("returns error when fetch throws (network/timeout)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("The operation was aborted")),
    );
    const result = await fetchUrlContent("https://slow.example.com");
    expect(result.error).toMatch(/Fetch failed/);
  });
});
