/**
 * Error category types — YOU-13 §5.
 * Five categories required by the integration contract.
 */

export type ErrorCategory =
  | "auth"
  | "auth/forbidden"
  | "policy/state_transition"
  | "policy/policy_violation"
  | "adapter/calendar"
  | "adapter/messaging"
  | "adapter/travel"
  | "internal";

export type OrchestratorError = {
  category: ErrorCategory;
  code: string;
  message: string;
  correlationId: string;
  timestamp: string;
};

export function makeError(
  category: ErrorCategory,
  code: string,
  message: string,
  correlationId: string,
): OrchestratorError {
  return { category, code, message, correlationId, timestamp: new Date().toISOString() };
}
