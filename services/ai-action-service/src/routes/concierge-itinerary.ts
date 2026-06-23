/**
 * POST /concierge/itinerary — conversational travel itinerary endpoint.
 * POST /concierge/itinerary/alter — alter an existing itinerary via an edit instruction.
 *
 * Provider selection (first match wins):
 *   1. ANTHROPIC_API_KEY present → Anthropic Claude (desired end state)
 *   2. VERTEX_SA_JSON + GCP_PROJECT_ID present → Gemini on Vertex AI (interim)
 *   3. Neither → 503
 *
 * YOU-749 Phase 2 additions:
 *   - Personalization: demo persona (Noah) injected into system prompt.
 *   - Images: each ItineraryItem carries imageQuery (AI-generated) + imageUrl
 *     (resolved to Unsplash Source URL server-side).
 *   - Transport legs: transportAfter on each item describes the connection to the next.
 *   - Alter: /concierge/itinerary/alter accepts { instruction, currentItinerary } and
 *     returns a revised itinerary.
 *
 * Demo persona shape (for future swap to real sessions/profile store):
 *   { name, travelStyle, dietaryPrefs, pace, budgetBand, homeCity, loyaltyPrograms }
 */

import Anthropic from "@anthropic-ai/sdk";
import type { Hono } from "hono";
import type { Env, Variables } from "../index.js";
import { enrichItineraryImages } from "../lib/image-utils.js";
import type { ChatMessage, Itinerary, RespondResult } from "../lib/itinerary-types.js";
import { buildMemoryContext, getUserProfile, saveTrip } from "../lib/user-memory.js";
import { callGeminiVertex } from "../lib/vertex-gemini.js";
import { extractUrls, fetchUrlContent } from "../lib/url-fetch.js";

// ---------------------------------------------------------------------------
// Demo persona — hardcoded for Phase 2. Swap to a real profile store in Phase 3.
// Shape: { name, travelStyle, dietaryPrefs, pace, budgetBand, homeCity, loyaltyPrograms }
// ---------------------------------------------------------------------------

const DEMO_PERSONA = `
## Who you are planning for
The traveler is Noah Laux. Profile: travel style = boutique/independent, dietary = pescatarian + loves local cuisine, pace = active mornings, budget = €300-500/day, interests = architecture, design, art, great coffee, hidden gems.

Reference these preferences naturally when building the itinerary — suggest places that match his style, note dietary-friendly highlights, and respect his pacing preference.
`.trim();

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

  const enrichedContent = lastMsg.content + "\n\n" + snippets.join("\n\n");
  return [
    ...messages.slice(0, -1),
    { role: "user" as const, content: enrichedContent },
  ];
}

// ---------------------------------------------------------------------------
// Prompts and tool definitions
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are Jeevy, an AI travel concierge butler. Help users plan detailed travel itineraries through warm, natural conversation.

${DEMO_PERSONA}

Gather through conversation:
- Destination(s)
- Travel dates
- Any additional specifics (who's going, special occasions, etc.)

When a user message includes "[Fetched content of ...]" blocks, immediately extract and use the relevant details (dates, location, agenda, venue) to advance trip planning — do NOT ask the user to summarize, confirm, or copy/paste the page content. You already have it.

Once you have destination and dates, generate a full day-by-day itinerary tailored to Noah's preferences above. Contextual date hints are sufficient — infer specific dates rather than asking. Examples: "cherry blossom season" → assume late March/early April; "summer" → July; "New Year's" → Dec 30–Jan 2. Only ask for dates when the message contains no date context whatsoever.

ALWAYS respond by calling the \`respond\` tool:
- Set \`reply\` to your conversational message to the user.
- Set \`itinerary\` to null while still gathering information.
- Set \`itinerary\` to the complete structured object once destination and dates are confirmed. The \`days\` array MUST contain at least one day with items — never return an itinerary with an empty days array.

For each itinerary item:
- ALWAYS set \`imageQuery\` to a vivid 2–5 word search phrase that includes the destination city and the specific landmark or scene type. This drives the hero image shown on the card — be precise so the photo matches the actual destination. Good examples: "paris eiffel tower dusk", "tokyo shibuya crossing neon", "kyoto arashiyama bamboo forest", "lisbon alfama tram hillside", "barcelona sagrada familia facade". Bad example: "nice view" (no city, too generic).
- Set \`imageUrl\` to: \`https://picsum.photos/seed/{SLUG}/400/280\` where {SLUG} is the item title in kebab-case (max 20 chars). This is a schema-required fallback only — the server uses \`imageQuery\` when present.
- For each item except the first item of each day, add a \`transport\` object describing how to get there from the previous item. Include mode (Walk/Metro/Taxi/Train/Bus/Ferry), duration (e.g. '12 min'), and detail (e.g. 'From hotel to Shinjuku Station, Oedo Line').
- Set \`transportAfter\` to the transport leg FROM this item TO the next (mode: walk/taxi/metro/uber/tram/ferry/etc., duration: estimated time, notes: optional tip). Omit on the last item of a day or when items are in the same location.`;

const ALTER_SYSTEM_PROMPT = `You are an AI travel concierge butler. The user wants to modify their existing itinerary.
Apply the requested changes while keeping what was good. Maintain the same structure and field requirements as the original itinerary.

${DEMO_PERSONA}

For imageQuery: ALWAYS include a vivid 2–5 word phrase with city name + landmark/scene, e.g. "paris marais district cafe". This drives the hero image — be destination-specific.
For imageUrl: use format https://picsum.photos/seed/{title-kebab}/400/280 (schema fallback only).
For transport: include mode/duration/detail for each item except the first of each day.

ALWAYS respond by calling the respond tool with the complete revised itinerary and a brief reply acknowledging what changed.`;

const ITINERARY_ITEM_SCHEMA = {
  type: "object" as const,
  required: ["time", "title", "detail", "imageUrl"],
  properties: {
    time: { type: "string" as const },
    title: { type: "string" as const },
    detail: { type: "string" as const },
    imageUrl: {
      type: "string" as const,
      description: "picsum.photos seed URL: https://picsum.photos/seed/{title-kebab}/400/280",
    },
    transport: {
      type: "object" as const,
      description: "How to get TO this item from the previous. Omit on first item of a day.",
      properties: {
        mode: { type: "string" as const, description: "Walk / Metro / Taxi / Train / Bus / Ferry" },
        duration: { type: "string" as const, description: "e.g. '12 min'" },
        detail: { type: "string" as const, description: "e.g. 'From hotel to Shinjuku Station, Oedo Line'" },
      },
    },
    rationale: {
      type: "string" as const,
      description: "Short phrase (≤12 words) explaining why this activity suits this traveler. Written as chip copy, e.g. 'Matches your love of street food' or 'Perfect for an active afternoon'. Omit when there is no personalization context.",
    },
    imageQuery: {
      type: "string" as const,
      description: "Vivid 2–5 word Unsplash search phrase for a representative photo.",
    },
    transportAfter: {
      type: "object" as const,
      description: "Transport from this item to the next. Omit on last item of a day.",
      required: ["mode", "duration"],
      properties: {
        mode: { type: "string" as const, description: "walk / taxi / metro / uber / tram / ferry / bus / car" },
        duration: { type: "string" as const, description: "Estimated duration e.g. '12 min'" },
        notes: { type: "string" as const, description: "Optional tip e.g. 'Line 2 towards Odivelas'" },
      },
    },
  },
};

const RESPOND_TOOL: Anthropic.Tool = {
  name: "respond",
  description: "Always call this tool to produce your response.",
  input_schema: {
    type: "object" as const,
    required: ["reply", "itinerary"],
    properties: {
      reply: {
        type: "string" as const,
        description: "Conversational reply to the user.",
      },
      itinerary: {
        anyOf: [
          { type: "null" as const },
          {
            type: "object" as const,
            required: ["destination", "dates", "days", "summary"],
            properties: {
              destination: { type: "string" as const },
              dates: { type: "string" as const },
              days: {
                type: "array" as const,
                items: {
                  type: "object" as const,
                  required: ["day", "items"],
                  properties: {
                    day: { type: "string" as const },
                    items: {
                      type: "array" as const,
                      items: ITINERARY_ITEM_SCHEMA,
                    },
                  },
                },
              },
              summary: { type: "string" as const },
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

async function callAnthropic(
  messages: ChatMessage[],
  apiKey: string,
  systemPrompt: string = SYSTEM_PROMPT,
): Promise<RespondResult> {
  const client = new Anthropic({ apiKey, timeout: 20_000 });
  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    system: systemPrompt,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
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
// Provider helpers
// ---------------------------------------------------------------------------

function hasProvider(env: Env): { anthropic: boolean; vertex: boolean } {
  return {
    anthropic: !!env?.ANTHROPIC_API_KEY,
    vertex: !!(env?.VERTEX_SA_JSON && env?.GCP_PROJECT_ID),
  };
}

async function callProvider(
  messages: ChatMessage[],
  env: Env,
  systemPrompt: string = SYSTEM_PROMPT,
): Promise<RespondResult> {
  const { anthropic, vertex } = hasProvider(env);
  if (anthropic) return callAnthropic(messages, env.ANTHROPIC_API_KEY!, systemPrompt);
  if (vertex) return callGeminiVertex(messages, env.VERTEX_SA_JSON!, env.GCP_PROJECT_ID!, systemPrompt);
  throw new Error("No AI provider configured");
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

interface ItineraryRequestBody {
  messages: ChatMessage[];
  userId?: string;
}

interface AlterRequestBody {
  instruction: string;
  currentItinerary: Itinerary;
  messages?: ChatMessage[];
}

function validateMessages(messages: unknown): messages is ChatMessage[] {
  if (!Array.isArray(messages) || messages.length === 0) return false;
  return !messages.some(
    (m) => (m.role !== "user" && m.role !== "assistant") || typeof m.content !== "string",
  );
}

export function registerConciergeItineraryRoute(
  app: Hono<{ Bindings: Env; Variables: Variables }>,
): void {
  // POST /concierge/itinerary — main conversational endpoint
  app.post("/concierge/itinerary", async (c) => {
    const prov = hasProvider(c.env);
    if (!prov.anthropic && !prov.vertex) {
      return c.json(
        { error: "AI butler not configured: set ANTHROPIC_API_KEY or VERTEX_SA_JSON + GCP_PROJECT_ID." },
        503,
      );
    }

    let body: ItineraryRequestBody;
    try {
      body = await c.req.json<ItineraryRequestBody>();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    if (!validateMessages(body?.messages)) {
      return c.json(
        { error: "messages must be a non-empty array of {role:'user'|'assistant', content:string}" },
        400,
      );
    }

    // Load user memory (best-effort: no-op if KV unavailable or userId absent).
    const userId = typeof body.userId === "string" && body.userId.trim() ? body.userId.trim() : null;
    const userProfile = userId && c.env.CONCIERGE_KV
      ? await getUserProfile(c.env.CONCIERGE_KV, userId)
      : null;
    const memoryContext = buildMemoryContext(userProfile);
    const systemPrompt = memoryContext ? SYSTEM_PROMPT + memoryContext : SYSTEM_PROMPT;

    let messages: ChatMessage[];
    try {
      messages = await injectFetchedUrls(body.messages);
    } catch {
      messages = body.messages;
    }

    let result: RespondResult;
    try {
      result = await callProvider(messages, c.env, systemPrompt);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const provider = prov.anthropic ? "Anthropic" : "Vertex AI";
      const lc = message.toLowerCase();
      const code = lc.includes("429") || lc.includes("rate limit") || lc.includes("quota")
        ? "ai/rate_limited"
        : lc.includes("401") || lc.includes("403") || lc.includes("auth") || lc.includes("credential")
          ? "ai/auth_error"
          : lc.includes("timeout") || lc.includes("timed out") || lc.includes("abort")
            ? "ai/timeout"
            : "ai/unavailable";
      console.error(`[concierge-itinerary] ${provider} error [${code}]:`, message);
      return c.json({ error: "AI service temporarily unavailable", code }, 502);
    }

    const enriched = enrichItineraryImages(result.itinerary);
    // Guard: an itinerary with 0 days is a malformed LLM response — treat as null
    // so the conversation continues rather than rendering an empty itinerary shell.
    const finalItinerary = (enriched?.days?.length ?? 0) > 0 ? enriched : null;

    // Persist the completed itinerary to user memory (fire-and-forget).
    if (finalItinerary && userId && c.env.CONCIERGE_KV) {
      c.executionCtx.waitUntil(saveTrip(c.env.CONCIERGE_KV, userId, finalItinerary));
    }

    return c.json({ reply: result.reply, itinerary: finalItinerary, userId: userId ?? undefined });
  });

  // POST /concierge/itinerary/alter — edit an existing itinerary
  app.post("/concierge/itinerary/alter", async (c) => {
    const prov = hasProvider(c.env);
    if (!prov.anthropic && !prov.vertex) {
      return c.json(
        { error: "AI butler not configured: set ANTHROPIC_API_KEY or VERTEX_SA_JSON + GCP_PROJECT_ID." },
        503,
      );
    }

    let body: AlterRequestBody;
    try {
      body = await c.req.json<AlterRequestBody>();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    if (!body?.instruction || typeof body.instruction !== "string") {
      return c.json({ error: "instruction must be a non-empty string" }, 400);
    }
    if (!body?.currentItinerary || typeof body.currentItinerary !== "object") {
      return c.json({ error: "currentItinerary must be an itinerary object" }, 400);
    }

    const itineraryJson = JSON.stringify(body.currentItinerary, null, 2);
    const alterMessages: ChatMessage[] = [
      ...(body.messages ?? []),
      {
        role: "user",
        content: `Here is the current itinerary:\n\`\`\`json\n${itineraryJson}\n\`\`\`\n\nPlease make this change: ${body.instruction}`,
      },
    ];

    let result: RespondResult;
    try {
      result = await callProvider(alterMessages, c.env, ALTER_SYSTEM_PROMPT);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const provider = prov.anthropic ? "Anthropic" : "Vertex AI";
      const lc = message.toLowerCase();
      const code = lc.includes("429") || lc.includes("rate limit") || lc.includes("quota")
        ? "ai/rate_limited"
        : lc.includes("401") || lc.includes("403") || lc.includes("auth") || lc.includes("credential")
          ? "ai/auth_error"
          : lc.includes("timeout") || lc.includes("timed out") || lc.includes("abort")
            ? "ai/timeout"
            : "ai/unavailable";
      console.error(`[concierge-itinerary/alter] ${provider} error [${code}]:`, message);
      return c.json({ error: "AI service temporarily unavailable", code }, 502);
    }

    const enriched = enrichItineraryImages(result.itinerary);
    const finalItinerary = (enriched?.days?.length ?? 0) > 0 ? enriched : null;
    return c.json({ reply: result.reply, itinerary: finalItinerary });
  });
}
