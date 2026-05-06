/**
 * Orchestrator state machine types — YOU-13 §3.
 * Transitions: draft → awaiting_approval → executing → completed | completed_external | failed | needs_input
 */

export type OrchestratorStatus =
  | "draft"
  | "awaiting_approval"
  | "executing"
  | "completed"
  | "completed_external"
  | "failed"
  | "needs_input";

export type OrchestratorStatusTransition = {
  from: OrchestratorStatus;
  to: OrchestratorStatus;
  correlationId: string;
  operatorId: string;
  timestamp: string;
};

const VALID_TRANSITIONS: ReadonlyMap<OrchestratorStatus, ReadonlySet<OrchestratorStatus>> = new Map(
  [
    ["draft", new Set<OrchestratorStatus>(["awaiting_approval"])],
    ["awaiting_approval", new Set<OrchestratorStatus>(["executing", "failed"])],
    [
      "executing",
      new Set<OrchestratorStatus>(["completed", "completed_external", "failed", "needs_input"]),
    ],
    ["needs_input", new Set<OrchestratorStatus>(["executing", "failed"])],
    ["completed", new Set<OrchestratorStatus>()],
    ["completed_external", new Set<OrchestratorStatus>()],
    ["failed", new Set<OrchestratorStatus>()],
  ],
);

export function isValidTransition(from: OrchestratorStatus, to: OrchestratorStatus): boolean {
  return VALID_TRANSITIONS.get(from)?.has(to) ?? false;
}
