# W5.3 Runbook Systems Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **This plan supports parallel execution** — Systems 1, 2, and 3 are independent and can be built concurrently.

**Goal:** Build three missing W5.3 runbook systems so Scenarios 3-5 can be verified end-to-end: workflow orchestrator + calendar adapter, policy engine + outreach adapter, CF Queue consumer + recap service.

**Architecture:** Three independent subsystems deployed to staging:
1. **System 1** (Scenario 3): Workflow orchestrator in `ai-action-service` with state machine and Google Calendar adapter
2. **System 2** (Scenario 4): Policy engine in `ai-action-service` with outreach adapter and approval enforcement
3. **System 3** (Scenario 5): Queue consumer in `ai-recap-service` for dead-letter handling

**Tech Stack:** TypeScript, Hono (HTTP framework), Cloudflare KV (state), Cloudflare Queues, PostHog (metrics/alerts)

---

## File Structure

### System 1: Workflow Orchestrator + Calendar Adapter
**ai-action-service:**
- `src/lib/workflow/orchestrator.ts` — State machine: enum `WorkflowState`, `Workflow` type, `executeTransition()`, `circuitOpen()` logic
- `src/adapters/google-calendar.ts` — Calendar adapter with `invokeCalendarApi()`, metric emission `provider_call_total`, timeout/error handling
- `src/lib/workflow/types.ts` — Shared types: `WorkflowState`, `ProviderCircuitState`, `WorkflowTransition`
- `src/lib/metrics.ts` — PostHog metric emitters: `emitProviderMetric()`, `checkCircuitState()`
- `tests/workflow/orchestrator.test.ts` — State machine tests
- `tests/adapters/google-calendar.test.ts` — Adapter tests with circuit breaker

### System 2: Policy Engine + Outreach Adapter
**ai-action-service:**
- `src/lib/policy/engine.ts` — Policy validator: `validateApprovalAttached()`, `requiresApproval()`
- `src/adapters/outreach.ts` — Outreach adapter with `sendWithApproval()`, kill-switch check via KV `concierge.external_actions.enabled`
- `src/lib/policy/types.ts` — Types: `Policy`, `ExternalAction`, `ApprovalToken`
- `tests/policy/engine.test.ts` — Policy validation tests
- `tests/adapters/outreach.test.ts` — Adapter tests with KV kill-switch

### System 3: CF Queue Consumer + Recap Service
**ai-recap-service:**
- `src/queue/consumer.ts` — Queue consumer bound to `tasks-default`, job processor, dead-letter handler
- `src/lib/recap.ts` — Recap job logic: `processRecapJob()`, `handleDeadLetter()`
- `wrangler.toml` — Queue binding `tasks-default` with staging/production IDs
- `tests/queue/consumer.test.ts` — Consumer tests with mock queue

---

## System 1: Workflow Orchestrator + Calendar Adapter

### Task 1.1: Workflow state machine types

**Files:**
- Create: `services/ai-action-service/src/lib/workflow/types.ts`
- Create: `services/ai-action-service/src/lib/metrics.ts`

- [ ] **Step 1: Create workflow types file**

```typescript
// services/ai-action-service/src/lib/workflow/types.ts

export enum WorkflowState {
  IN_FLIGHT = "in_flight",
  NEEDS_INPUT = "needs_input",
  EXECUTING = "executing",
  AWAITING_APPROVAL = "awaiting_approval",
}

export enum ProviderErrorReason {
  PROVIDER_4XX = "provider_4xx",
  PROVIDER_5XX = "provider_5xx",
  TIMEOUT = "timeout",
  UNKNOWN = "unknown",
}

export interface Workflow {
  id: string;
  state: WorkflowState;
  reason_code?: ProviderErrorReason;
  provider?: string;
  created_at: number; // timestamp
  updated_at: number;
}

export interface WorkflowTransition {
  from: WorkflowState;
  to: WorkflowState;
  trigger: string;
  metadata?: Record<string, unknown>;
}

export interface ProviderCircuitState {
  provider: string;
  state: "closed" | "open";
  failed_count: number;
  last_failure_at?: number;
}
```

- [ ] **Step 2: Create metrics emitter file**

```typescript
// services/ai-action-service/src/lib/metrics.ts

export interface ProviderMetricEvent {
  provider: string;
  outcome: "success" | "error" | "timeout";
  duration_ms: number;
  error_code?: string;
}

export function emitProviderMetric(event: ProviderMetricEvent, posthogApiKey: string, posthogHost: string): void {
  const payload = {
    distinct_id: `system:${event.provider}`,
    event: "provider_call_total",
    properties: {
      provider: event.provider,
      outcome: event.outcome,
      duration_ms: event.duration_ms,
      ...(event.error_code && { error_code: event.error_code }),
      timestamp: Date.now(),
    },
  };

  fetch(`${posthogHost}/engage/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...payload,
      api_key: posthogApiKey,
    }),
  }).catch((err) => console.error("[metrics] PostHog emit failed:", err));
}

export function checkCircuitOpen(circuitState: Record<string, boolean>, provider: string): boolean {
  return circuitState[`${provider}:open`] ?? false;
}

export function setCircuitOpen(circuitState: Record<string, boolean>, provider: string, open: boolean): void {
  circuitState[`${provider}:open`] = open;
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd services/ai-action-service && npm run build`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add services/ai-action-service/src/lib/workflow/types.ts services/ai-action-service/src/lib/metrics.ts
git commit -m "feat(workflow): add workflow state machine and metrics types"
```

### Task 1.2: Workflow orchestrator core

**Files:**
- Create: `services/ai-action-service/src/lib/workflow/orchestrator.ts`

- [ ] **Step 1: Implement orchestrator**

```typescript
// services/ai-action-service/src/lib/workflow/orchestrator.ts

import type { Workflow, WorkflowState, ProviderErrorReason } from "./types.js";
import { WorkflowState as State } from "./types.js";
import { emitProviderMetric, checkCircuitOpen, setCircuitOpen } from "../metrics.js";

export class WorkflowOrchestrator {
  private workflows: Map<string, Workflow> = new Map();
  private circuitState: Record<string, boolean> = {};

  constructor(private posthogApiKey: string, private posthogHost: string) {}

  createWorkflow(id: string): Workflow {
    const workflow: Workflow = {
      id,
      state: State.IN_FLIGHT,
      created_at: Date.now(),
      updated_at: Date.now(),
    };
    this.workflows.set(id, workflow);
    return workflow;
  }

  getWorkflow(id: string): Workflow | undefined {
    return this.workflows.get(id);
  }

  /**
   * Transition workflow on provider error. Provider circuit opens after 3 failures.
   */
  transitionToNeedsInput(
    workflowId: string,
    provider: string,
    reasonCode: ProviderErrorReason,
  ): Workflow | null {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) return null;

    workflow.state = State.NEEDS_INPUT;
    workflow.provider = provider;
    workflow.reason_code = reasonCode;
    workflow.updated_at = Date.now();

    // Increment failure counter per provider (simplified circuit breaker)
    const failKey = `${provider}:fails`;
    const currentFails = (this.circuitState[failKey] as number) ?? 0;
    const newFails = currentFails + 1;
    this.circuitState[failKey] = newFails;

    // Trip circuit after 3 failures
    if (newFails >= 3) {
      setCircuitOpen(this.circuitState, provider, true);
      console.warn(`[workflow] Circuit opened for provider: ${provider}`);
    }

    return workflow;
  }

  isCircuitOpen(provider: string): boolean {
    return checkCircuitOpen(this.circuitState, provider);
  }

  transitionToExecuting(workflowId: string): Workflow | null {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) return null;

    workflow.state = State.EXECUTING;
    workflow.updated_at = Date.now();
    return workflow;
  }

  transitionToAwaitingApproval(workflowId: string): Workflow | null {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) return null;

    workflow.state = State.AWAITING_APPROVAL;
    workflow.updated_at = Date.now();
    return workflow;
  }

  resetCircuitForProvider(provider: string): void {
    setCircuitOpen(this.circuitState, provider, false);
    this.circuitState[`${provider}:fails`] = 0;
  }
}
```

- [ ] **Step 2: Write tests for orchestrator**

```typescript
// services/ai-action-service/tests/workflow/orchestrator.test.ts

import { describe, it, expect, beforeEach } from "vitest";
import { WorkflowOrchestrator } from "../../src/lib/workflow/orchestrator.js";
import { WorkflowState } from "../../src/lib/workflow/types.js";
import type { ProviderErrorReason } from "../../src/lib/workflow/types.js";

describe("WorkflowOrchestrator", () => {
  let orchestrator: WorkflowOrchestrator;

  beforeEach(() => {
    orchestrator = new WorkflowOrchestrator("test-key", "https://test.posthog.com");
  });

  it("creates workflow in IN_FLIGHT state", () => {
    const workflow = orchestrator.createWorkflow("wf-1");
    expect(workflow.id).toBe("wf-1");
    expect(workflow.state).toBe(WorkflowState.IN_FLIGHT);
  });

  it("transitions to NEEDS_INPUT on provider error", () => {
    const wf = orchestrator.createWorkflow("wf-1");
    const reason: ProviderErrorReason = "provider_4xx";
    const updated = orchestrator.transitionToNeedsInput("wf-1", "google_calendar", reason);

    expect(updated?.state).toBe(WorkflowState.NEEDS_INPUT);
    expect(updated?.reason_code).toBe(reason);
    expect(updated?.provider).toBe("google_calendar");
  });

  it("opens circuit after 3 failures for same provider", () => {
    orchestrator.createWorkflow("wf-1");
    const reason: ProviderErrorReason = "provider_5xx";

    orchestrator.transitionToNeedsInput("wf-1", "google_calendar", reason);
    expect(orchestrator.isCircuitOpen("google_calendar")).toBe(false);

    orchestrator.createWorkflow("wf-2");
    orchestrator.transitionToNeedsInput("wf-2", "google_calendar", reason);
    expect(orchestrator.isCircuitOpen("google_calendar")).toBe(false);

    orchestrator.createWorkflow("wf-3");
    orchestrator.transitionToNeedsInput("wf-3", "google_calendar", reason);
    expect(orchestrator.isCircuitOpen("google_calendar")).toBe(true);
  });

  it("transitions to EXECUTING state", () => {
    orchestrator.createWorkflow("wf-1");
    const updated = orchestrator.transitionToExecuting("wf-1");
    expect(updated?.state).toBe(WorkflowState.EXECUTING);
  });

  it("transitions to AWAITING_APPROVAL state", () => {
    orchestrator.createWorkflow("wf-1");
    const updated = orchestrator.transitionToAwaitingApproval("wf-1");
    expect(updated?.state).toBe(WorkflowState.AWAITING_APPROVAL);
  });

  it("resets circuit for provider", () => {
    orchestrator.createWorkflow("wf-1");
    orchestrator.transitionToNeedsInput("wf-1", "google_calendar", "provider_5xx");
    orchestrator.createWorkflow("wf-2");
    orchestrator.transitionToNeedsInput("wf-2", "google_calendar", "provider_5xx");
    orchestrator.createWorkflow("wf-3");
    orchestrator.transitionToNeedsInput("wf-3", "google_calendar", "provider_5xx");

    expect(orchestrator.isCircuitOpen("google_calendar")).toBe(true);

    orchestrator.resetCircuitForProvider("google_calendar");
    expect(orchestrator.isCircuitOpen("google_calendar")).toBe(false);
  });
});
```

- [ ] **Step 3: Install vitest if needed**

Run: `cd services/ai-action-service && npm list vitest` (check if already installed)
If missing: `npm install --save-dev vitest`

- [ ] **Step 4: Run tests**

Run: `cd services/ai-action-service && npm run test -- tests/workflow/orchestrator.test.ts`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add services/ai-action-service/src/lib/workflow/orchestrator.ts services/ai-action-service/tests/workflow/orchestrator.test.ts
git commit -m "feat(workflow): implement orchestrator with state machine and circuit breaker"
```

### Task 1.3: Google Calendar adapter

**Files:**
- Create: `services/ai-action-service/src/adapters/google-calendar.ts`

- [ ] **Step 1: Implement Google Calendar adapter**

```typescript
// services/ai-action-service/src/adapters/google-calendar.ts

import { emitProviderMetric } from "../lib/metrics.js";

export interface CalendarEvent {
  summary: string;
  start: { dateTime: string };
  end: { dateTime: string };
}

export interface CalendarAdapterConfig {
  googleAccessToken: string;
  posthogApiKey: string;
  posthogHost: string;
}

export class GoogleCalendarAdapter {
  private readonly provider = "google_calendar";

  constructor(private config: CalendarAdapterConfig) {}

  async getCalendarEvents(calendarId: string, maxResults: number = 10): Promise<CalendarEvent[] | null> {
    const startTime = Date.now();

    try {
      const response = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?maxResults=${maxResults}`,
        {
          headers: {
            Authorization: `Bearer ${this.config.googleAccessToken}`,
            Accept: "application/json",
          },
        },
      );

      const duration = Date.now() - startTime;

      if (!response.ok) {
        const status = response.status;
        const isClientError = status >= 400 && status < 500;
        const errorCode = isClientError ? "4xx" : "5xx";

        emitProviderMetric(
          {
            provider: this.provider,
            outcome: "error",
            duration_ms: duration,
            error_code: errorCode,
          },
          this.config.posthogApiKey,
          this.config.posthogHost,
        );

        return null;
      }

      const data = (await response.json()) as { items?: CalendarEvent[] };
      emitProviderMetric(
        {
          provider: this.provider,
          outcome: "success",
          duration_ms: duration,
        },
        this.config.posthogApiKey,
        this.config.posthogHost,
      );

      return data.items ?? [];
    } catch (error) {
      const duration = Date.now() - startTime;
      const isTimeout = error instanceof Error && error.message.includes("timeout");

      emitProviderMetric(
        {
          provider: this.provider,
          outcome: isTimeout ? "timeout" : "error",
          duration_ms: duration,
          error_code: isTimeout ? "timeout" : "unknown",
        },
        this.config.posthogApiKey,
        this.config.posthogHost,
      );

      return null;
    }
  }
}
```

- [ ] **Step 2: Write adapter tests**

```typescript
// services/ai-action-service/tests/adapters/google-calendar.test.ts

import { describe, it, expect, beforeEach, vi } from "vitest";
import { GoogleCalendarAdapter } from "../../src/adapters/google-calendar.js";

// Mock fetch globally
global.fetch = vi.fn();

describe("GoogleCalendarAdapter", () => {
  let adapter: GoogleCalendarAdapter;
  const mockConfig = {
    googleAccessToken: "test-token",
    posthogApiKey: "test-key",
    posthogHost: "https://test.posthog.com",
  };

  beforeEach(() => {
    adapter = new GoogleCalendarAdapter(mockConfig);
    vi.clearAllMocks();
  });

  it("fetches calendar events successfully", async () => {
    const mockEvents = [
      {
        summary: "Meeting",
        start: { dateTime: "2026-05-20T10:00:00Z" },
        end: { dateTime: "2026-05-20T11:00:00Z" },
      },
    ];

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ items: mockEvents }),
    });

    const result = await adapter.getCalendarEvents("test@google.com", 10);
    expect(result).toEqual(mockEvents);
  });

  it("returns null on 4xx error and emits metric", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 401,
    });

    const result = await adapter.getCalendarEvents("test@google.com", 10);
    expect(result).toBeNull();
  });

  it("returns null on 5xx error and emits metric", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 500,
    });

    const result = await adapter.getCalendarEvents("test@google.com", 10);
    expect(result).toBeNull();
  });

  it("returns null on timeout and emits timeout metric", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Request timeout"),
    );

    const result = await adapter.getCalendarEvents("test@google.com", 10);
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 3: Run adapter tests**

Run: `cd services/ai-action-service && npm run test -- tests/adapters/google-calendar.test.ts`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add services/ai-action-service/src/adapters/google-calendar.ts services/ai-action-service/tests/adapters/google-calendar.test.ts
git commit -m "feat(adapter): add Google Calendar adapter with metric emission"
```

### Task 1.4: Integrate orchestrator into ai-action-service

**Files:**
- Modify: `services/ai-action-service/src/index.ts`

- [ ] **Step 1: Create workflow orchestrator singleton**

In `src/index.ts`, after the app definition:

```typescript
// In services/ai-action-service/src/index.ts, after "export const app = new Hono..."

// Workflow orchestrator singleton (initialize once per worker)
const workflowOrchestrator = new WorkflowOrchestrator(
  process.env.POSTHOG_API_KEY ?? "",
  process.env.POSTHOG_HOST ?? "https://eu.i.posthog.com",
);

// Expose orchestrator via context for route handlers
export type Variables = {
  clerkUserId: string;
  clerkClaims: ClerkClaims;
  workflowOrchestrator: WorkflowOrchestrator;
};
```

Actually, wait. Let me check the current index.ts to see how Variables is defined. I already did read it. Let me provide an update that extends it:

Instead, add this import at top:
```typescript
import { WorkflowOrchestrator } from "./lib/workflow/orchestrator.js";
```

And modify the Variables type:
```typescript
export type Variables = {
  clerkUserId: string;
  clerkClaims: ClerkClaims;
  workflowOrchestrator?: WorkflowOrchestrator;
};
```

Then in app setup (after `app.use("*", cors());`):
```typescript
// Initialize workflow orchestrator
const workflowOrchestrator = new WorkflowOrchestrator(
  app.env?.POSTHOG_API_KEY ?? "",
  app.env?.POSTHOG_HOST ?? "https://eu.i.posthog.com",
);

app.use("*", async (c, next) => {
  c.set("workflowOrchestrator", workflowOrchestrator);
  await next();
});
```

- [ ] **Step 2: Add test route for workflow**

```typescript
// In src/index.ts, add protected test route:
protected_.post("/api/protected/workflow/create", async (c) => {
  const body = await c.req.json<{ workflow_id: string }>();
  const orchestrator = c.get("workflowOrchestrator");
  const workflow = orchestrator?.createWorkflow(body.workflow_id);
  return c.json({ workflow });
});

protected_.get("/api/protected/workflow/:id", async (c) => {
  const id = c.req.param("id");
  const orchestrator = c.get("workflowOrchestrator");
  const workflow = orchestrator?.getWorkflow(id);
  return c.json({ workflow: workflow ?? null });
});
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd services/ai-action-service && npm run build`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add services/ai-action-service/src/index.ts
git commit -m "feat(service): integrate workflow orchestrator into ai-action-service"
```

---

## System 2: Policy Engine + Outreach Adapter

### Task 2.1: Policy engine types and implementation

**Files:**
- Create: `services/ai-action-service/src/lib/policy/types.ts`
- Create: `services/ai-action-service/src/lib/policy/engine.ts`

- [ ] **Step 1: Create policy types**

```typescript
// services/ai-action-service/src/lib/policy/types.ts

export enum ExternalActionClass {
  OUTREACH_EMAIL = "outreach_email",
  OUTREACH_SMS = "outreach_sms",
  OUTREACH_CALL = "outreach_call",
}

export interface ExternalAction {
  id: string;
  class: ExternalActionClass;
  recipient: string;
  content: string;
  approval_attached: boolean;
  approval_token?: string;
  created_at: number;
}

export interface PolicyValidation {
  valid: boolean;
  reason?: string;
}
```

- [ ] **Step 2: Create policy engine**

```typescript
// services/ai-action-service/src/lib/policy/engine.ts

import type { ExternalAction, PolicyValidation } from "./types.js";
import { ExternalActionClass } from "./types.js";
import { emitProviderMetric } from "../metrics.js";

export class PolicyEngine {
  constructor(private posthogApiKey: string, private posthogHost: string) {}

  /**
   * Validate that external action has approval token attached.
   * Required for all external outreach actions.
   */
  validateApprovalAttached(action: ExternalAction): PolicyValidation {
    if (!action.approval_attached) {
      return {
        valid: false,
        reason: "approval_required",
      };
    }

    if (!action.approval_token) {
      return {
        valid: false,
        reason: "approval_token_missing",
      };
    }

    return { valid: true };
  }

  /**
   * Check if an action class requires approval (all outreach actions do).
   */
  requiresApproval(actionClass: ExternalActionClass): boolean {
    return [
      ExternalActionClass.OUTREACH_EMAIL,
      ExternalActionClass.OUTREACH_SMS,
      ExternalActionClass.OUTREACH_CALL,
    ].includes(actionClass);
  }

  /**
   * Emit external action metric with approval status.
   */
  emitExternalActionMetric(
    actionClass: ExternalActionClass,
    approvalAttached: boolean,
  ): void {
    const metric = {
      provider: "policy_engine",
      outcome: "audit" as const,
      duration_ms: 0,
      error_code: undefined,
    };

    emitProviderMetric(metric, this.posthogApiKey, this.posthogHost);

    // PostHog custom event for approval tracking
    fetch(`${this.posthogHost}/engage/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        distinct_id: "system:policy_engine",
        event: "external_action_total",
        properties: {
          action_class: actionClass,
          approval_attached: approvalAttached,
          timestamp: Date.now(),
        },
        api_key: this.posthogApiKey,
      }),
    }).catch((err) => console.error("[policy] PostHog emit failed:", err));
  }
}
```

- [ ] **Step 3: Write policy engine tests**

```typescript
// services/ai-action-service/tests/policy/engine.test.ts

import { describe, it, expect, beforeEach } from "vitest";
import { PolicyEngine } from "../../src/lib/policy/engine.js";
import { ExternalActionClass } from "../../src/lib/policy/types.js";
import type { ExternalAction } from "../../src/lib/policy/types.js";

describe("PolicyEngine", () => {
  let engine: PolicyEngine;

  beforeEach(() => {
    engine = new PolicyEngine("test-key", "https://test.posthog.com");
  });

  it("validates approval is attached", () => {
    const action: ExternalAction = {
      id: "act-1",
      class: ExternalActionClass.OUTREACH_EMAIL,
      recipient: "user@example.com",
      content: "Hello",
      approval_attached: true,
      approval_token: "token-123",
      created_at: Date.now(),
    };

    const result = engine.validateApprovalAttached(action);
    expect(result.valid).toBe(true);
  });

  it("rejects action without approval", () => {
    const action: ExternalAction = {
      id: "act-1",
      class: ExternalActionClass.OUTREACH_EMAIL,
      recipient: "user@example.com",
      content: "Hello",
      approval_attached: false,
      created_at: Date.now(),
    };

    const result = engine.validateApprovalAttached(action);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("approval_required");
  });

  it("rejects action without approval token", () => {
    const action: ExternalAction = {
      id: "act-1",
      class: ExternalActionClass.OUTREACH_EMAIL,
      recipient: "user@example.com",
      content: "Hello",
      approval_attached: true,
      created_at: Date.now(),
    };

    const result = engine.validateApprovalAttached(action);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("approval_token_missing");
  });

  it("identifies outreach actions as requiring approval", () => {
    expect(engine.requiresApproval(ExternalActionClass.OUTREACH_EMAIL)).toBe(true);
    expect(engine.requiresApproval(ExternalActionClass.OUTREACH_SMS)).toBe(true);
    expect(engine.requiresApproval(ExternalActionClass.OUTREACH_CALL)).toBe(true);
  });
});
```

- [ ] **Step 4: Run tests**

Run: `cd services/ai-action-service && npm run test -- tests/policy/engine.test.ts`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add services/ai-action-service/src/lib/policy/types.ts services/ai-action-service/src/lib/policy/engine.ts services/ai-action-service/tests/policy/engine.test.ts
git commit -m "feat(policy): add policy engine with approval validation"
```

### Task 2.2: Outreach adapter with kill-switch

**Files:**
- Create: `services/ai-action-service/src/adapters/outreach.ts`

- [ ] **Step 1: Implement Outreach adapter**

```typescript
// services/ai-action-service/src/adapters/outreach.ts

import { PolicyEngine } from "../lib/policy/engine.js";
import type { ExternalAction } from "../lib/policy/types.js";
import { ExternalActionClass } from "../lib/policy/types.js";

export interface OutreachAdapterConfig {
  outreachApiKey: string;
  posthogApiKey: string;
  posthogHost: string;
  kvNamespace: KVNamespace; // Bound in wrangler.toml
}

export class OutreachAdapter {
  private policyEngine: PolicyEngine;
  private readonly killSwitchKey = "concierge.external_actions.enabled";

  constructor(private config: OutreachAdapterConfig) {
    this.policyEngine = new PolicyEngine(config.posthogApiKey, config.posthogHost);
  }

  /**
   * Check if external actions are enabled via kill-switch in KV.
   * Default: enabled (true).
   */
  async isExternalActionsEnabled(): Promise<boolean> {
    try {
      const value = await this.config.kvNamespace.get(this.killSwitchKey);
      if (value === null) return true; // Default enabled
      return value === "true";
    } catch (error) {
      console.error("[outreach] KV read failed:", error);
      return false; // Fail closed on KV error
    }
  }

  /**
   * Send outreach with approval validation and kill-switch check.
   */
  async sendWithApproval(action: ExternalAction): Promise<{ success: boolean; reason?: string }> {
    // Check kill-switch first
    const enabled = await this.isExternalActionsEnabled();
    if (!enabled) {
      this.policyEngine.emitExternalActionMetric(action.class as ExternalActionClass, false);
      return { success: false, reason: "external_actions_disabled" };
    }

    // Validate approval
    const validation = this.policyEngine.validateApprovalAttached(action);
    if (!validation.valid) {
      this.policyEngine.emitExternalActionMetric(action.class as ExternalActionClass, false);
      return { success: false, reason: validation.reason };
    }

    // Emit metric for auditing
    this.policyEngine.emitExternalActionMetric(action.class as ExternalActionClass, true);

    // Send via Outreach API
    try {
      const response = await fetch("https://api.outreach.io/api/v2/send", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.outreachApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action_id: action.id,
          recipient: action.recipient,
          content: action.content,
          approval_token: action.approval_token,
        }),
      });

      if (!response.ok) {
        return { success: false, reason: `outreach_api_error: ${response.status}` };
      }

      return { success: true };
    } catch (error) {
      console.error("[outreach] Send failed:", error);
      return { success: false, reason: "outreach_send_failed" };
    }
  }
}
```

- [ ] **Step 2: Write outreach adapter tests**

```typescript
// services/ai-action-service/tests/adapters/outreach.test.ts

import { describe, it, expect, beforeEach, vi } from "vitest";
import { OutreachAdapter } from "../../src/adapters/outreach.js";
import { ExternalActionClass } from "../../src/lib/policy/types.js";
import type { ExternalAction } from "../../src/lib/policy/types.js";

describe("OutreachAdapter", () => {
  let adapter: OutreachAdapter;
  const mockKV = {
    get: vi.fn(),
    put: vi.fn(),
  };
  const mockConfig = {
    outreachApiKey: "test-key",
    posthogApiKey: "test-key",
    posthogHost: "https://test.posthog.com",
    kvNamespace: mockKV as unknown as KVNamespace,
  };

  beforeEach(() => {
    adapter = new OutreachAdapter(mockConfig);
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it("rejects send without approval", async () => {
    const action: ExternalAction = {
      id: "act-1",
      class: ExternalActionClass.OUTREACH_EMAIL,
      recipient: "user@example.com",
      content: "Hello",
      approval_attached: false,
      created_at: Date.now(),
    };

    mockKV.get.mockResolvedValueOnce("true");

    const result = await adapter.sendWithApproval(action);
    expect(result.success).toBe(false);
    expect(result.reason).toBe("approval_required");
  });

  it("respects kill-switch when disabled", async () => {
    const action: ExternalAction = {
      id: "act-1",
      class: ExternalActionClass.OUTREACH_EMAIL,
      recipient: "user@example.com",
      content: "Hello",
      approval_attached: true,
      approval_token: "token-123",
      created_at: Date.now(),
    };

    mockKV.get.mockResolvedValueOnce("false");

    const result = await adapter.sendWithApproval(action);
    expect(result.success).toBe(false);
    expect(result.reason).toBe("external_actions_disabled");
  });

  it("sends successfully with valid approval", async () => {
    const action: ExternalAction = {
      id: "act-1",
      class: ExternalActionClass.OUTREACH_EMAIL,
      recipient: "user@example.com",
      content: "Hello",
      approval_attached: true,
      approval_token: "token-123",
      created_at: Date.now(),
    };

    mockKV.get.mockResolvedValueOnce("true");
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
    });

    const result = await adapter.sendWithApproval(action);
    expect(result.success).toBe(true);
  });

  it("defaults to enabled when kill-switch key not in KV", async () => {
    const action: ExternalAction = {
      id: "act-1",
      class: ExternalActionClass.OUTREACH_EMAIL,
      recipient: "user@example.com",
      content: "Hello",
      approval_attached: true,
      approval_token: "token-123",
      created_at: Date.now(),
    };

    mockKV.get.mockResolvedValueOnce(null);
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
    });

    const result = await adapter.sendWithApproval(action);
    expect(result.success).toBe(true);
  });

  it("fails closed on KV read error", async () => {
    const action: ExternalAction = {
      id: "act-1",
      class: ExternalActionClass.OUTREACH_EMAIL,
      recipient: "user@example.com",
      content: "Hello",
      approval_attached: true,
      approval_token: "token-123",
      created_at: Date.now(),
    };

    mockKV.get.mockRejectedValueOnce(new Error("KV error"));

    const result = await adapter.sendWithApproval(action);
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 3: Run tests**

Run: `cd services/ai-action-service && npm run test -- tests/adapters/outreach.test.ts`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add services/ai-action-service/src/adapters/outreach.ts services/ai-action-service/tests/adapters/outreach.test.ts
git commit -m "feat(adapter): add Outreach adapter with kill-switch and approval enforcement"
```

---

## System 3: CF Queue Consumer + Recap Service

### Task 3.1: Configure CF Queue binding in ai-recap-service

**Files:**
- Modify: `services/ai-recap-service/wrangler.toml`

- [ ] **Step 1: Add queue binding to wrangler.toml**

```toml
# Add to services/ai-recap-service/wrangler.toml

[vars]
ENVIRONMENT = "development"

# Queue binding for task intake (default queue)
[[queues.consumers]]
queue = "tasks-default"
max_batch_size = 10
max_batch_timeout = 30
max_retries = 3
dead_letter_queue = "tasks-default-dlq"

# Staging environment queue IDs
[env.staging]
name = "ai-recap-service-staging"

[env.staging.vars]
ENVIRONMENT = "staging"

[[env.staging.queues.consumers]]
queue = "tasks-default"
max_batch_size = 10
max_batch_timeout = 30
max_retries = 3
dead_letter_queue = "tasks-default-dlq"

# Production environment queue IDs
[env.production]
name = "ai-recap-service-production"

[env.production.vars]
ENVIRONMENT = "production"

[[env.production.queues.consumers]]
queue = "tasks-default"
max_batch_size = 10
max_batch_timeout = 30
max_retries = 3
dead_letter_queue = "tasks-default-dlq"
```

Note: Queue IDs (if needed) are set via `wrangler queue create tasks-default` during deployment.

- [ ] **Step 2: Verify syntax**

Run: `cd services/ai-recap-service && cat wrangler.toml | head -20`
Expected: No syntax errors (toml should be readable).

- [ ] **Step 3: Commit**

```bash
git add services/ai-recap-service/wrangler.toml
git commit -m "infra(queue): add tasks-default queue binding to ai-recap-service"
```

### Task 3.2: Implement queue consumer in ai-recap-service

**Files:**
- Modify: `services/ai-recap-service/src/index.ts`
- Create: `services/ai-recap-service/src/queue/consumer.ts`
- Create: `services/ai-recap-service/src/lib/recap.ts`

- [ ] **Step 1: Create queue consumer**

```typescript
// services/ai-recap-service/src/queue/consumer.ts

export interface RecapJobPayload {
  id: string;
  user_id: string;
  period_start: number; // timestamp
  period_end: number;
  created_at: number;
}

export interface DeadLetterInfo {
  job_id: string;
  reason: string;
  attempt: number;
  failed_at: number;
}

export class QueueConsumer {
  async processJob(payload: RecapJobPayload): Promise<{ success: boolean; reason?: string }> {
    // Validate job structure
    if (!payload.id || !payload.user_id || !payload.period_start || !payload.period_end) {
      return { success: false, reason: "invalid_job_structure" };
    }

    // Simulate recap generation (this would call Claude or your recap service)
    try {
      console.log(`[queue] Processing recap job: ${payload.id} for user ${payload.user_id}`);

      // Simulate processing delay
      await new Promise((resolve) => setTimeout(resolve, 100));

      return { success: true };
    } catch (error) {
      console.error(`[queue] Job processing failed: ${error}`);
      return { success: false, reason: "processing_failed" };
    }
  }

  async handleDeadLetter(payload: RecapJobPayload, reason: string, attempt: number): Promise<void> {
    const dlInfo: DeadLetterInfo = {
      job_id: payload.id,
      reason,
      attempt,
      failed_at: Date.now(),
    };

    console.warn(`[queue] Dead letter: ${JSON.stringify(dlInfo)}`);
    // In production, log to monitoring/alerting system
  }
}
```

- [ ] **Step 2: Create recap processing logic**

```typescript
// services/ai-recap-service/src/lib/recap.ts

export async function generateRecap(userId: string, periodStart: number, periodEnd: number): Promise<string> {
  // Placeholder: would call Claude API or summary service
  const days = Math.ceil((periodEnd - periodStart) / (1000 * 60 * 60 * 24));
  return `Recap for user ${userId}: ${days} day(s) of activity from ${new Date(periodStart).toISOString()} to ${new Date(periodEnd).toISOString()}`;
}
```

- [ ] **Step 3: Update ai-recap-service index.ts**

```typescript
// services/ai-recap-service/src/index.ts

import { QueueConsumer } from "./queue/consumer.js";
import type { RecapJobPayload } from "./queue/consumer.js";

export type Env = {
  ENVIRONMENT: string;
  // Queue binding (declared in wrangler.toml)
  tasks_default: Queue<RecapJobPayload>;
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Health check endpoint
    if (request.method === "GET" && new URL(request.url).pathname === "/health") {
      return new Response(JSON.stringify({ ok: true, service: "ai-recap-service" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response("Not Found", { status: 404 });
  },

  async queue(batch: MessageBatch<RecapJobPayload>, env: Env): Promise<void> {
    const consumer = new QueueConsumer();

    for (const message of batch.messages) {
      try {
        const payload = message.body;
        const result = await consumer.processJob(payload);

        if (result.success) {
          message.ack();
        } else {
          // Re-queue on temporary failure (max retries defined in wrangler.toml)
          console.warn(`[queue] Retrying job ${payload.id}: ${result.reason}`);
        }
      } catch (error) {
        console.error(`[queue] Unexpected error processing message:`, error);
        // Message will be retried or moved to dead letter based on wrangler config
      }
    }
  },
};
```

- [ ] **Step 4: Write queue consumer tests**

```typescript
// services/ai-recap-service/tests/queue/consumer.test.ts

import { describe, it, expect, beforeEach } from "vitest";
import { QueueConsumer } from "../../src/queue/consumer.js";
import type { RecapJobPayload } from "../../src/queue/consumer.js";

describe("QueueConsumer", () => {
  let consumer: QueueConsumer;

  beforeEach(() => {
    consumer = new QueueConsumer();
  });

  it("processes valid recap job", async () => {
    const job: RecapJobPayload = {
      id: "job-1",
      user_id: "user-123",
      period_start: Date.now() - 7 * 24 * 60 * 60 * 1000,
      period_end: Date.now(),
      created_at: Date.now(),
    };

    const result = await consumer.processJob(job);
    expect(result.success).toBe(true);
  });

  it("rejects job with missing fields", async () => {
    const job: Partial<RecapJobPayload> = {
      id: "job-1",
      user_id: "user-123",
      // missing period_start and period_end
      created_at: Date.now(),
    };

    const result = await consumer.processJob(job as RecapJobPayload);
    expect(result.success).toBe(false);
    expect(result.reason).toBe("invalid_job_structure");
  });

  it("handles dead letter for failed job", async () => {
    const job: RecapJobPayload = {
      id: "job-1",
      user_id: "user-123",
      period_start: Date.now() - 7 * 24 * 60 * 60 * 1000,
      period_end: Date.now(),
      created_at: Date.now(),
    };

    // Should not throw
    await expect(consumer.handleDeadLetter(job, "max_retries_exceeded", 3)).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 5: Run tests**

Run: `cd services/ai-recap-service && npm run test -- tests/queue/consumer.test.ts` (if vitest configured)
Expected: All tests pass.

- [ ] **Step 6: Verify TypeScript compiles**

Run: `cd services/ai-recap-service && npm run build`
Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add services/ai-recap-service/src/index.ts services/ai-recap-service/src/queue/consumer.ts services/ai-recap-service/src/lib/recap.ts services/ai-recap-service/tests/queue/consumer.test.ts
git commit -m "feat(queue): implement queue consumer for recap job processing and dead-letter handling"
```

### Task 3.3: Deploy all systems to staging

**Files:**
- Deploy: both services

- [ ] **Step 1: Deploy ai-action-service to staging**

Run: `cd services/ai-action-service && wrangler deploy --env staging`
Expected: Deployment successful, staging URL returned.

- [ ] **Step 2: Deploy ai-recap-service to staging**

Run: `cd services/ai-recap-service && wrangler deploy --env staging`
Expected: Deployment successful, staging URL returned.

- [ ] **Step 3: Verify health endpoints**

Run: `curl https://ai-action-service-staging.<your-domain>/health`
Expected: `{"ok":true,"service":"ai-action-service"}`

Run: `curl https://ai-recap-service-staging.<your-domain>/health`
Expected: `{"ok":true,"service":"ai-recap-service"}`

- [ ] **Step 4: Commit (deployment confirmation)**

```bash
git add -A # (if any config changes)
git commit -m "chore: deploy W5.3 systems to staging"
```

---

## Integration Checklist

Once all three systems are deployed:

- [ ] **System 1 (Workflow + Calendar):**
  - [ ] Create workflow via `/api/protected/workflow/create`
  - [ ] Verify `provider_call_total` metric emitted on calendar calls
  - [ ] Verify circuit breaker trips after 3 failures
  - [ ] Verify `ConciergeProviderCircuitOpen` alert can fire (mock in test)

- [ ] **System 2 (Policy + Outreach):**
  - [ ] Attempt outreach send without approval token → blocked
  - [ ] Test kill-switch enable/disable via KV
  - [ ] Verify `ConciergeUnauthorizedExternalAction` alert can fire
  - [ ] Test `external_action_total` metric emission

- [ ] **System 3 (Queue + Recap):**
  - [ ] Push valid recap job to `tasks-default` queue
  - [ ] Verify job processes and ACKs
  - [ ] Push malformed job → dead letter accumulates
  - [ ] Verify dead-letter detection works
  - [ ] Document re-queue procedure

---

## Remaining

When all systems verified in staging, update YOU-317 with sign-off on Scenarios 3-5.

**Execution Decision:** This plan supports parallel execution across three independent subsystems. Choose:

1. **Subagent-Driven (recommended)** — Dispatch independent agents for System 1, 2, 3 in parallel, review outputs, merge.
2. **Inline Execution** — Execute sequentially in this session with checkpoints.
