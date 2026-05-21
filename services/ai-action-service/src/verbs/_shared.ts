export type { ValidatedBase } from "../actions/_shared.js";
import type { ValidatedBase } from "../actions/_shared.js";

export interface ConciergeVerbDef {
  id: string;
  resultKind: string;
  model: "sonnet" | "haiku";
  defaultConfidenceThreshold: number;
  systemPrompt: string;
  buildUserMessage(text: string): string;
  validate(raw: unknown): ValidatedBase | null;
  deterministic(text: string): ValidatedBase;
  toResultPayload(v: ValidatedBase): Record<string, unknown>;
  toEnvelopeFields(v: ValidatedBase): { confidence: number; warnings: string[] };
}
