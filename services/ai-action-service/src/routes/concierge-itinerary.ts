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
 * Web access (YOU-731): the Anthropic path exposes a `fetch_url` tool so the
 * model can read user-supplied URLs (conference pages, venues, etc.) without
 * asking the user to copy/paste. Plain fetch + HTML stripping — no browser
 * rendering required for static/SSR pages. CF Browser Rendering is the
 * upgrade path if JS-heavy pages become an issue.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { Hono } from "hono";
import type { Env, Variables } from "../index.js";
import { callGeminiVertex } from "../lib/vertex-gemini.js";
import type { ChatMessage, Itinerary, RespondResult } from "../lib/itinerary-types.js";
import { fetchUrlContent, FETCH_TEXT_LIMIT } from "../lib/url-fetch.js";

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

When a user mentions a URL (a conference website, event page, venue, or any travel-relevant link), call the \`fetch_url\` tool to read its content so you can extract dates, location, agenda, or other details — do not ask the user to copy and paste content from a page.

Once you have at minimum destination and dates confirmed, generate a full day-by-day itinerary.

ALWAYS finish each turn by calling the \`respond\` tool:
- Set \`reply\` to your conversational message to the user.
- Set \`itinerary\` to null while still gathering information.
- Set \`itinerary\` to the complete structured object once destination and dates are confirmed.`;

const RESPOND_TOOL: Anthropic.Tool = {
  name: "respond",
  description: "Always call this tool to produce your final response for the current turn.",
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

const FETCH_URL_TOOL: Anthropic.Tool = {
  name: "fetch_url",
  description:
    "Fetch and read the text content of a public web page. Use this when the user provides a URL so you can extract event dates, venue details, conference agendas, or other travel-relevant information without asking the user to copy/paste.",
  input_schema: {
    type: "object" as const,
    required: ["url"],
    properties: {
      url: {
        type: "string",
        description: "The HTTPS URL to fetch. Must start with https://.",
      },
    },
  },
};

// ---------------------------------------------------------------------------
// Anthropic multi-turn call (handles fetch_url tool loop)
// ---------------------------------------------------------------------------

const MAX_TOOL_ITERATIONS = 8;

async function callAnthropic(messages: ChatMessage[], apiKey: string): Promise<RespondResult> {
  const client = new Anthropic({ apiKey });

  let currentMessages: Anthropic.MessageParam[] = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: currentMessages,
      tools: [RESPOND_TOOL, FETCH_URL_TOOL],
      tool_choice: { type: "auto" },
    });

    const toolBlocks = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );

    // Model called `respond` — we're done.
    const respondBlock = toolBlocks.find((b) => b.name === "respond");
    if (respondBlock) {
      return respondBlock.input as RespondResult;
    }

    // Model called `fetch_url` — execute and continue the loop.
    const fetchBlocks = toolBlocks.filter((b) => b.name === "fetch_url");
    if (fetchBlocks.length === 0) {
      // No recognised tool call; may be a plain text response — should not happen
      // with these tools configured but guard against it.
      throw new Error("Unexpected response: no recognised tool call from Anthropic");
    }

    // Append assistant turn with all tool-use blocks.
    currentMessages = [
      ...currentMessages,
      { role: "assistant", content: response.content },
    ];

    // Execute fetches (in parallel) and build tool_result blocks.
    const toolResults: Anthropic.ToolResultBlockParam[] = await Promise.all(
      fetchBlocks.map(async (block) => {
        const input = block.input as { url?: string };
        const url = typeof input.url === "string" ? input.url : "";
        const result = await fetchUrlContent(url);
        const content = result.error
          ? `Error fetching page: ${result.error}`
          : `Page content (truncated to ${FETCH_TEXT_LIMIT} chars):\n\n${result.text}`;
        return {
          type: "tool_result" as const,
          tool_use_id: block.id,
          content,
        };
      }),
    );

    // Append user turn with fetch results so the model can continue.
    currentMessages = [
      ...currentMessages,
      { role: "user", content: toolResults },
    ];
  }

  throw new Error("Tool call loop exceeded maximum iterations — possible infinite loop");
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
