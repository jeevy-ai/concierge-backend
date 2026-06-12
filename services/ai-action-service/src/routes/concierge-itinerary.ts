/**
 * POST /concierge/itinerary — conversational travel itinerary endpoint.
 *
 * Provider selection (first match wins):
 *   1. ANTHROPIC_API_KEY present → Anthropic Claude (desired end state)
 *   2. VERTEX_SA_JSON + GCP_PROJECT_ID present → Gemini on Vertex AI (interim)
 *   3. Neither → 503
 *
 * Swap to Claude: set ANTHROPIC_API_KEY via `wrangler secret put ANTHROPIC_API_KEY`
 * and redeploy — no code change required.
 *
 * Web access (YOU-731): URLs found in the latest user message are fetched
 * server-side before calling the AI provider. The extracted text is injected
 * inline into the user message so the model receives the content directly.
 * No extra tool-calling loop is needed, and it works on both Anthropic and
 * Vertex providers.
 *
 * Build/buy: plain fetch + HTML stripping (url-fetch.ts) rather than
 * Cloudflare Browser Rendering — sufficient for static/SSR conference pages
 * and free. CF Browser Rendering is the upgrade path for JS-heavy SPAs.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { Hono } from "hono";
import type { Env, Variables } from "../index.js";
import { callGeminiVertex } from "../lib/vertex-gemini.js";
import type { ChatMessage, RespondResult } from "../lib/itinerary-types.js";
import { fetchUrlContent, extractUrls } from "../lib/url-fetch.js";

// ---------------------------------------------------------------------------
// URL injection — pre-fetch URLs from the latest user message
// ---------------------------------------------------------------------------

async function injectFetchedUrls(messages: ChatMessage[]): Promise<ChatMessage[]> {
  const lastMsg = messages[messages.length - 1];
  if (lastMsg?.role !== "user") return messages;

  const urls = extractUrls(lastMsg.content);
  if (urls.length === 0) return messages;

  const snippets = await Promise.all(
    urls.map(async (url) => {
      const result = await fetchUrlContent(url);
      if (result.error) return `[URL ${url} — fetch error: ${result.error}]`;
      return `[Fetched content of ${url}]\n${result.text}\n[End of fetched content]`;
    }),
  );

  const enrichedContent =
    lastMsg.content + "\n\n" + snippets.join("\n\n");

  return [
    ...messages.slice(0, -1),
    { role: "user" as const, content: enrichedContent },
  ];
}

// ---------------------------------------------------------------------------
// Prompts and tool definitions
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are an AI travel concierge butler. Help users plan detailed travel itineraries through warm, natural conversation.

Gather through conversation:
- Destination(s)
- Travel dates
- Budget range
- Interests and preferences (culture, food, adventure, relaxation, etc.)
- Number of travelers
- Any special requirements or constraints

When a user message includes "[Fetched content of ...]" blocks, immediately extract and use the relevant details (dates, location, agenda, venue) to advance trip planning — do NOT ask the user to summarize, confirm, or copy/paste the page content. You already have it.

Once you have at minimum destination and dates confirmed, generate a full day-by-day itinerary.

ALWAYS respond by calling the \`respond\` tool:
- Set \`reply\` to your conversational message to the user.
- Set \`itinerary\` to null while still gathering information.
- Set \`itinerary\` to the complete structured object once destination and dates are confirmed.`;

const RESPOND_TOOL: Anthropic.Tool = {
  name: "respond",
  description: "Always call this tool to produce your response.",
  input_schema: {
    type: "object" as const,
    required: ["reply", "itinerary"],
    properties: {
      reply: {
        type: "string",
        description: "Conversational reply to the user.",
      },
      itinerary: {
        anyOf: [
          { type: "null" },
          {
            type: "object",
            required: ["destination", "dates", "days", "summary"],
            properties: {
              destination: { type: "string" },
              dates: { type: "string" },
              days: {
                type: "array",
                items: {
                  type: "object",
                  required: ["day", "items"],
                  properties: {
                    day: { type: "string" },
                    items: {
                      type: "array",
                      items: {
                        type: "object",
                        required: ["time", "title", "detail"],
                        properties: {
                          time: { type: "string" },
                          title: { type: "string" },
                          detail: { type: "string" },
                        },
                      },
                    },
                  },
                },
              },
              summary: { type: "string" },
            },
          },
        ],
      },
    },
  },
};

// ---------------------------------------------------------------------------
// Anthropic call
// ---------------------------------------------------------------------------

async function callAnthropic(messages: ChatMessage[], apiKey: string): Promise<RespondResult> {
  const enriched = await injectFetchedUrls(messages);
  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: enriched.map((m) => ({ role: m.role, content: m.content })),
    tools: [RESPOND_TOOL],
    tool_choice: { type: "tool", name: "respond" },
  });
  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Unexpected response format from Anthropic");
  }
  return toolUse.input as RespondResult;
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

interface RequestBody {
  messages: ChatMessage[];
}

export function registerConciergeItineraryRoute(
  app: Hono<{ Bindings: Env; Variables: Variables }>,
): void {
  app.post("/concierge/itinerary", async (c) => {
    const hasAnthropic = !!c.env?.ANTHROPIC_API_KEY;
    const hasVertex = !!(c.env?.VERTEX_SA_JSON && c.env?.GCP_PROJECT_ID);

    if (!hasAnthropic && !hasVertex) {
      return c.json(
        {
          error:
            "AI butler not configured: set ANTHROPIC_API_KEY or VERTEX_SA_JSON + GCP_PROJECT_ID.",
        },
        503,
      );
    }

    let body: RequestBody;
    try {
      body = await c.req.json<RequestBody>();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    if (!Array.isArray(body?.messages) || body.messages.length === 0) {
      return c.json({ error: "messages must be a non-empty array" }, 400);
    }

    const invalidMsg = body.messages.find(
      (m) =>
        (m.role !== "user" && m.role !== "assistant") ||
        typeof m.content !== "string",
    );
    if (invalidMsg) {
      return c.json(
        { error: "Each message must have role 'user'|'assistant' and string content" },
        400,
      );
    }

    let result: RespondResult;
    try {
      if (hasAnthropic) {
        result = await callAnthropic(body.messages, c.env.ANTHROPIC_API_KEY!);
      } else {
        result = await callGeminiVertex(
          body.messages,
          c.env.VERTEX_SA_JSON!,
          c.env.GCP_PROJECT_ID!,
          SYSTEM_PROMPT,
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const provider = hasAnthropic ? "Anthropic" : "Vertex AI";
      console.error(`[concierge-itinerary] ${provider} error:`, message);
      return c.json({ error: "AI service error", detail: message }, 502);
    }

    return c.json({ reply: result.reply, itinerary: result.itinerary ?? null });
  });
}
