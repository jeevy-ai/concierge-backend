import { GoogleGenAI } from "@google/genai";

export type ProviderConfig = {
  projectId: string;
  region: string;
  model?: string | undefined;
  timeoutMs?: number | undefined;
  provider?: string | undefined;
};

export interface RecapProvider {
  generate(systemPrompt: string, userMessage: string): Promise<unknown>;
}

export class GeminiProvider implements RecapProvider {
  private readonly _model: string;
  private readonly _timeoutMs: number;
  private readonly _client: GoogleGenAI;

  constructor(config: ProviderConfig) {
    this._model = config.model ?? "gemini-2.5-flash";
    this._timeoutMs = config.timeoutMs ?? 8000;
    // enterprise: true routes through Vertex AI
    this._client = new GoogleGenAI({
      enterprise: true,
      project: config.projectId,
      location: config.region,
    });
  }

  async generate(systemPrompt: string, userMessage: string): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this._timeoutMs);
    try {
      const response = await this._client.models.generateContent({
        model: this._model,
        contents: userMessage,
        config: {
          systemInstruction: systemPrompt,
          responseMimeType: "application/json",
          // Disable thinking for recap — latency budget is 4 s, reasoning overhead
          // is not needed for this structured-output clustering task.
          thinkingConfig: { thinkingBudget: 0 },
        },
      });
      const text = response.text;
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
