import Anthropic from "@anthropic-ai/sdk";
import type { Hono } from "hono";
import type { Env, Variables } from "../index.js";
import { enrichItineraryImages } from "../lib/image-utils.js";
import { callGeminiVertex } from "../lib/vertex-gemini.js";
import type { ChatMessage, Itinerary, RespondResult } from "../lib/itinerary-types.js";

const ALTER_SYSTEM_PROMPT = `You are an AI travel concierge butler. The user wants to modify their existing itinerary.
Apply the requested changes while keeping what was good. Maintain the same structure and field requirements as the original itinerary.

The traveler is Noah Laux. Profile: boutique/independent travel style, pescatarian + loves local cuisine, active mornings, €300-500/day budget, interests = architecture, design, art, great coffee, hidden gems.

For imageQuery: ALWAYS set a vivid 2–5 word phrase that includes the destination city name + landmark/scene, e.g. "paris marais district cafe", "tokyo shibuya crossing neon", "lisbon alfama tram hillside". Never omit the city. This drives the hero image shown on the card.
For imageUrl: use format https://picsum.photos/seed/{title-kebab}/400/280 (schema-required fallback only — imageQuery takes precedence server-side).
For transport: include mode/duration/detail for each item except the first of each day.

ALWAYS respond by calling the respond tool with the complete revised itinerary and a brief reply acknowledging what changed.`;

const RESPOND_TOOL: Anthropic.Tool = {
  name: "respond",
  description: "Always call this tool to produce your response.",
  input_schema: {
    type: "object" as const,
    required: ["reply", "itinerary"],
    properties: {
      reply: {
        type: "string" as const,
        description: "Conversational reply acknowledging what changed.",
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
                      items: {
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
                          imageQuery: {
                            type: "string" as const,
                            description: "Vivid 2–5 word Unsplash search phrase including destination city, e.g. 'paris eiffel tower dusk'.",
                          },
                          transport: {
                            type: "object" as const,
                            description: "How to get TO this item from the previous. Omit on first item of a day.",
                            properties: {
                              mode: { type: "string" as const },
                              duration: { type: "string" as const },
                              detail: { type: "string" as const },
                            },
                          },
                        },
                      },
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

async function callAnthropic(messages: ChatMessage[], apiKey: string): Promise<RespondResult> {
  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    system: ALTER_SYSTEM_PROMPT,
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

interface AlterRequestBody {
  currentItinerary: Itinerary;
  instruction: string;
}

export function registerConciergeAlterRoute(
  app: Hono<{ Bindings: Env; Variables: Variables }>,
): void {
  app.post("/concierge/alter", async (c) => {
    const anthropicKey = c.env?.ANTHROPIC_API_KEY;
    const vertexReady = !!(c.env?.VERTEX_SA_JSON && c.env?.GCP_PROJECT_ID);

    if (!anthropicKey && !vertexReady) {
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

    const messages: ChatMessage[] = [
      {
        role: "user",
        content: `Current itinerary: ${JSON.stringify(body.currentItinerary)}\n\nInstruction: ${body.instruction}`,
      },
    ];

    let result: RespondResult;
    try {
      if (anthropicKey) {
        result = await callAnthropic(messages, anthropicKey);
      } else {
        result = await callGeminiVertex(messages, c.env.VERTEX_SA_JSON!, c.env.GCP_PROJECT_ID!, ALTER_SYSTEM_PROMPT);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const provider = anthropicKey ? "Anthropic" : "Vertex AI";
      const lc = message.toLowerCase();
      const code = lc.includes("429") || lc.includes("rate limit") || lc.includes("quota")
        ? "ai/rate_limited"
        : lc.includes("401") || lc.includes("403") || lc.includes("auth") || lc.includes("credential")
          ? "ai/auth_error"
          : lc.includes("timeout") || lc.includes("timed out") || lc.includes("abort")
            ? "ai/timeout"
            : "ai/unavailable";
      console.error(`[concierge-alter] ${provider} error [${code}]:`, message);
      return c.json({ error: "AI service temporarily unavailable", code }, 502);
    }

    const enriched = enrichItineraryImages(result.itinerary);
    const finalItinerary = (enriched?.days?.length ?? 0) > 0 ? enriched : null;
    return c.json({ reply: result.reply, itinerary: finalItinerary });
  });
}
