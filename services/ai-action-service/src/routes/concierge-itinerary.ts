import Anthropic from "@anthropic-ai/sdk";
import type { Hono } from "hono";
import type { Env, Variables } from "../index.js";

const SYSTEM_PROMPT = `You are an AI travel concierge butler. Help users plan detailed travel itineraries through warm, natural conversation.

Gather through conversation:
- Destination(s)
- Travel dates
- Budget range
- Interests and preferences (culture, food, adventure, relaxation, etc.)
- Number of travelers
- Any special requirements or constraints

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

interface ItineraryItem {
  time: string;
  title: string;
  detail: string;
}

interface ItineraryDay {
  day: string;
  items: ItineraryItem[];
}

interface Itinerary {
  destination: string;
  dates: string;
  days: ItineraryDay[];
  summary: string;
}

interface RespondToolInput {
  reply: string;
  itinerary: Itinerary | null;
}

interface RequestMessage {
  role: "user" | "assistant";
  content: string;
}

interface RequestBody {
  messages: RequestMessage[];
}

export function registerConciergeItineraryRoute(
  app: Hono<{ Bindings: Env; Variables: Variables }>,
): void {
  app.post("/concierge/itinerary", async (c) => {
    const apiKey = c.env?.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return c.json(
        {
          error:
            "AI butler not configured: ANTHROPIC_API_KEY missing. Contact support.",
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
      return c.json(
        { error: "messages must be a non-empty array" },
        400,
      );
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

    const client = new Anthropic({ apiKey });

    let response: Anthropic.Message;
    try {
      response = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        messages: body.messages,
        tools: [RESPOND_TOOL],
        tool_choice: { type: "tool", name: "respond" },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[concierge-itinerary] Anthropic error:", message);
      return c.json({ error: "AI service error", detail: message }, 502);
    }

    const toolUse = response.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      return c.json({ error: "Unexpected response format from AI" }, 502);
    }

    const result = toolUse.input as RespondToolInput;
    return c.json({
      reply: result.reply,
      itinerary: result.itinerary ?? null,
    });
  });
}
