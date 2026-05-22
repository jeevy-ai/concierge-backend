export type ProviderConfig = {
  projectId: string;
  region: string;
  model?: string | undefined;
  timeoutMs?: number | undefined;
  provider?: string | undefined;
  saJson?: string | undefined;
};

type SaCredentials = {
  client_email: string;
  private_key: string;
};

type CachedToken = {
  token: string;
  expiresAt: number;
};

export interface RecapProvider {
  generate(systemPrompt: string, userMessage: string): Promise<unknown>;
}

function toBase64Url(input: string | ArrayBuffer): string {
  if (typeof input === "string") {
    return btoa(input).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  }
  let binary = "";
  for (const byte of new Uint8Array(input)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

async function fetchSaAccessToken(creds: SaCredentials): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const headerB64 = toBase64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payloadB64 = toBase64Url(
    JSON.stringify({
      iss: creds.client_email,
      sub: creds.client_email,
      scope: "https://www.googleapis.com/auth/cloud-platform",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  );
  const unsigned = `${headerB64}.${payloadB64}`;

  const pemBody = creds.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const keyBytes = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));

  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    keyBytes,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const sigBytes = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    new TextEncoder().encode(unsigned),
  );

  const jwt = `${unsigned}.${toBase64Url(sigBytes)}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`SA token exchange failed: ${res.status} ${body}`);
  }
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

export class GeminiProvider implements RecapProvider {
  private readonly _model: string;
  private readonly _timeoutMs: number;
  private readonly _projectId: string;
  private readonly _region: string;
  private readonly _saCreds: SaCredentials | null;
  private _cachedToken: CachedToken | null = null;

  constructor(config: ProviderConfig) {
    this._model = config.model ?? "gemini-2.5-flash";
    this._timeoutMs = config.timeoutMs ?? 8000;
    this._projectId = config.projectId;
    this._region = config.region;
    this._saCreds = config.saJson ? (JSON.parse(config.saJson) as SaCredentials) : null;
  }

  private async _getAccessToken(): Promise<string | null> {
    if (!this._saCreds) return null;
    if (this._cachedToken && Date.now() < this._cachedToken.expiresAt - 60_000) {
      return this._cachedToken.token;
    }
    const token = await fetchSaAccessToken(this._saCreds);
    this._cachedToken = { token, expiresAt: Date.now() + 58 * 60 * 1000 };
    return token;
  }

  async generate(systemPrompt: string, userMessage: string): Promise<unknown> {
    const accessToken = await this._getAccessToken();
    if (!accessToken) throw new Error("No Vertex AI credentials configured");

    // Call Vertex AI generateContent REST API directly (bypasses @google/genai SDK
    // browser-context apiKey requirement while still using SA bearer auth).
    const endpoint = `https://${this._region}-aiplatform.googleapis.com/v1/projects/${this._projectId}/locations/${this._region}/publishers/google/models/${this._model}:generateContent`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this._timeoutMs);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: userMessage }] }],
          systemInstruction: { parts: [{ text: systemPrompt }] },
          generationConfig: {
            responseMimeType: "application/json",
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`vertex ${res.status}: ${body.slice(0, 200)}`);
      }

      const data = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error("gemini empty response");
      try {
        return JSON.parse(text) as unknown;
      } catch {
        const match = text.match(/\{[\s\S]*\}/);
        if (!match) throw new Error("gemini non-json response");
        return JSON.parse(match[0]) as unknown;
      }
    } finally {
      clearTimeout(timer);
    }
  }
}

// Stub — wires in AnthropicVertex when Model Garden access is granted (future quality upgrade).
export class ClaudeProvider implements RecapProvider {
  generate(): Promise<unknown> {
    throw new Error("claude provider not configured");
  }
}

export function createProvider(config: ProviderConfig): RecapProvider {
  const name = config.provider ?? "gemini";
  if (name === "gemini") return new GeminiProvider(config);
  if (name === "claude") return new ClaudeProvider();
  throw new Error(`Unknown recap provider: ${name}`);
}
