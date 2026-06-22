/**
 * Vertex AI (Gemini) provider for the concierge itinerary endpoint.
 *
 * Uses the REST API + Web Crypto JWT signing so no Node.js SDK is required —
 * fully compatible with the Cloudflare Workers runtime.
 *
 * Swap to Claude: set ANTHROPIC_API_KEY in wrangler secrets; the factory in
 * concierge-itinerary.ts picks Anthropic first when that key is present.
 */

import type { ChatMessage, RespondResult } from "./itinerary-types.js";

interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

// Module-level token cache — persists for the lifetime of the isolate (warm requests).
// Not shared across cold starts, but eliminates the token exchange on repeat calls.
let _tokenCache: { token: string; expiresAt: number } | null = null;

const VERTEX_TIMEOUT_MS = 55_000;
const TOKEN_TIMEOUT_MS = 5_000;

function uint8ArrayToBase64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function strToBase64url(s: string): string {
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

async function importRsaPrivateKey(pem: string): Promise<CryptoKey> {
  const pemBody = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const binary = atob(pemBody);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return crypto.subtle.importKey(
    "pkcs8",
    bytes.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function fetchAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  if (_tokenCache && _tokenCache.expiresAt > now + 60) {
    return _tokenCache.token;
  }

  const header = strToBase64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const tokenUri = sa.token_uri ?? "https://oauth2.googleapis.com/token";
  const payload = strToBase64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/cloud-platform",
      aud: tokenUri,
      iat: now,
      exp: now + 3600,
    }),
  );
  const signingInput = `${header}.${payload}`;
  const key = await importRsaPrivateKey(sa.private_key);
  const sigBytes = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput),
  );
  const jwt = `${signingInput}.${uint8ArrayToBase64url(new Uint8Array(sigBytes))}`;

  const res = await fetch(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
    signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GCP token exchange failed (${res.status}): ${text}`);
  }
  const data = (await res.json()) as { access_token: string; expires_in?: number };
  const expiresIn = data.expires_in ?? 3600;
  _tokenCache = { token: data.access_token, expiresAt: now + expiresIn };
  return data.access_token;
}

// Gemini function declaration mirroring the Anthropic RESPOND_TOOL schema.
// Uses lowercase JSON Schema types as required by the Vertex AI REST API.
const RESPOND_FUNCTION_DECLARATION = {
  name: "respond",
  description: "Always call this function to produce your response.",
  parameters: {
    type: "object",
    required: ["reply"],
    properties: {
      reply: {
        type: "string",
        description: "Conversational reply to the user.",
      },
      itinerary: {
        type: "object",
        description: "Omit while still gathering information. Include full itinerary object once destination and dates are confirmed.",
        properties: {
          destination: { type: "string" },
          dates: { type: "string" },
          summary: { type: "string" },
          days: {
            type: "array",
            items: {
              type: "object",
              properties: {
                day: { type: "string" },
                items: {
                  type: "array",
                  items: {
                    type: "object",
                    required: ["time", "title", "detail", "imageUrl"],
                    properties: {
                      time: { type: "string" },
                      title: { type: "string" },
                      detail: { type: "string" },
                      imageUrl: {
                        type: "string",
                        description: "picsum.photos seed URL: https://picsum.photos/seed/{title-kebab}/400/280",
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};

interface GeminiCandidate {
  content: {
    parts: Array<{
      functionCall?: {
        name: string;
        args: Record<string, unknown>;
      };
    }>;
  };
}

interface GeminiResponse {
  candidates: GeminiCandidate[];
}

export async function callGeminiVertex(
  messages: ChatMessage[],
  saJson: string,
  projectId: string,
  systemPrompt: string,
): Promise<RespondResult> {
  const sa = JSON.parse(saJson) as ServiceAccount;
  const accessToken = await fetchAccessToken(sa);

  // Anthropic "assistant" → Gemini "model"
  const contents = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const requestBody = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents,
    tools: [{ function_declarations: [RESPOND_FUNCTION_DECLARATION] }],
    tool_config: {
      function_calling_config: { mode: "ANY", allowed_function_names: ["respond"] },
    },
    generation_config: {
      max_output_tokens: 4096,
      // Disable extended thinking — gemini-2.5-flash thinks by default on complex tasks,
      // adding 20-50s latency before the first function call token arrives.
      thinking_config: { thinking_budget: 0 },
    },
  };

  const model = "gemini-2.5-flash";
  // Use streamGenerateContent so CF Worker receives first bytes within ~1-2s,
  // avoiding the 30s subrequest timeout on long itinerary generations (YOU-875).
  // We buffer the full SSE stream and parse the function call from the final chunk.
  const url =
    `https://us-central1-aiplatform.googleapis.com/v1/projects/${projectId}` +
    `/locations/us-central1/publishers/google/models/${model}:streamGenerateContent?alt=sse`;

  const fetchHeaders = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };
  const fetchBody = JSON.stringify(requestBody);

  let res: Response | null = null;
  for (let attempt = 0; attempt <= 1; attempt++) {
    if (attempt > 0) {
      // Refresh token before retry in case it was the issue
      _tokenCache = null;
      const freshToken = await fetchAccessToken(sa);
      fetchHeaders.Authorization = `Bearer ${freshToken}`;
      await new Promise<void>((r) => setTimeout(r, 1000));
    }
    res = await fetch(url, {
      method: "POST",
      headers: fetchHeaders,
      body: fetchBody,
      signal: AbortSignal.timeout(VERTEX_TIMEOUT_MS),
    });
    // Only retry 429 (rate limit). 5xx from generation = model overloaded/timeout on Vertex side;
    // retrying just doubles the wait and risks hitting the 55s timeout twice.
    if (res.status === 429) {
      if (attempt < 1) continue;
    }
    break;
  }

  if (!res || !res.ok) {
    const text = await res?.text() ?? "no response";
    throw new Error(`Vertex AI error (${res?.status ?? 0}): ${text}`);
  }

  // Buffer the full SSE stream. Each "data: {...}" line is a GeminiResponse chunk.
  // Function calls appear in a single chunk (not split across events), so we take
  // the last one found to handle any redundant closing chunks.
  const responseText = await res.text();
  let fnCall: { name: string; args: Record<string, unknown> } | null = null;
  for (const line of responseText.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data: ")) continue;
    const jsonStr = trimmed.slice(6).trim();
    if (!jsonStr) continue;
    try {
      const chunk = JSON.parse(jsonStr) as GeminiResponse;
      const found = chunk.candidates?.[0]?.content?.parts?.find(
        (p) => p.functionCall?.name === "respond",
      )?.functionCall;
      if (found) fnCall = found;
    } catch {
      // skip malformed SSE events
    }
  }

  if (!fnCall) {
    const raw = responseText.slice(0, 500);
    console.error("[vertex-gemini] no functionCall in streaming response:", raw);
    throw new Error(`No function call in Gemini streaming response. Raw: ${raw}`);
  }

  const args = fnCall.args as { reply: string; itinerary?: unknown };
  return {
    reply: args.reply,
    // Treat missing/empty itinerary object from Gemini as null
    itinerary:
      args.itinerary && typeof args.itinerary === "object" && "destination" in args.itinerary
        ? (args.itinerary as RespondResult["itinerary"])
        : null,
  };
}
