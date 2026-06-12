/**
 * Web-page fetching for the concierge butler (YOU-731).
 *
 * Guardrails:
 *  - HTTPS only (no http:, no file:, etc.)
 *  - No private/loopback hostnames (SSRF prevention)
 *  - 10 s timeout
 *  - 500 KB body cap (truncated, not errored)
 *  - Result text truncated to 8 000 chars for context-window budget
 */

export const FETCH_TIMEOUT_MS = 10_000;
export const FETCH_MAX_BYTES = 500_000;
export const FETCH_TEXT_LIMIT = 8_000;

// Blocks RFC-1918, loopback, and ULA IPv6.
const PRIVATE_HOSTNAME_RE =
  /^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|::1|fd[0-9a-f]{2}:)/i;

export type FetchResult =
  | { text: string; error?: undefined }
  | { error: string; text?: undefined };

export async function fetchUrlContent(rawUrl: string): Promise<FetchResult> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { error: `Invalid URL: ${rawUrl}` };
  }
  if (parsed.protocol !== "https:") {
    return { error: "Only HTTPS URLs are supported." };
  }
  if (PRIVATE_HOSTNAME_RE.test(parsed.hostname)) {
    return { error: "Cannot fetch private or internal addresses." };
  }

  let res: Response;
  try {
    res = await fetch(rawUrl, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { "User-Agent": "JeevyButler/1.0 (+https://jeevy.app/bot)" },
    });
  } catch (err) {
    return { error: `Fetch failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  if (!res.ok) {
    return { error: `Page returned HTTP ${res.status}` };
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
    return { error: `Unsupported content type: ${contentType.split(";")[0]}` };
  }

  const reader = res.body?.getReader();
  if (!reader) return { error: "No response body" };

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      totalBytes += value.length;
      chunks.push(value);
      if (totalBytes >= FETCH_MAX_BYTES) {
        await reader.cancel();
        break;
      }
    }
  }

  const merged = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return { text: htmlToText(new TextDecoder().decode(merged)) };
}

export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, FETCH_TEXT_LIMIT);
}
