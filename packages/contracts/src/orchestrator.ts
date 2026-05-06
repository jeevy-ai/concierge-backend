/**
 * Orchestrator HTTP contract types — YOU-74 operator-ui-integration-contract.
 */

import type { OrchestratorStatus } from "./state-machine.js";

export type MintRequest = {
  operatorId: string;
  expires_in_seconds: number;
  payload: Record<string, unknown>;
};

export type MintResponse = {
  sessionId: string;
  status: OrchestratorStatus;
  correlationId: string;
  expiresAt: string;
};

export type ApprovalRequest = {
  sessionId: string;
  operatorId: string;
  approved: boolean;
  correlationId: string;
};

export type SessionState = {
  sessionId: string;
  status: OrchestratorStatus;
  correlationId: string;
  operatorId: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  payload: Record<string, unknown>;
  history: Array<{
    from: OrchestratorStatus;
    to: OrchestratorStatus;
    at: string;
    correlationId: string;
  }>;
};

export type LedgerEntry = {
  sessionId: string;
  operatorId: string;
  status: OrchestratorStatus;
  correlationId: string;
  createdAt: string;
  completedAt?: string | undefined;
};
