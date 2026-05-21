import { describe, it, expect, beforeEach, vi } from "vitest";
import * as Sentry from "@sentry/cloudflare";
import { SentryEventEmitter } from "../src/lib/ttfv-events.js";
import type { ActionDeliveredEvent } from "../src/lib/ttfv-events.js";

vi.mock("@sentry/cloudflare");

describe("TTFV Event Emission", () => {
  let emitter: SentryEventEmitter;

  beforeEach(() => {
    emitter = new SentryEventEmitter();
    vi.clearAllMocks();
  });

  it("should emit concierge.action.delivered event to Sentry with all required fields", async () => {
    const event: ActionDeliveredEvent = {
      user_id: "user-123",
      action_type: "calendar.event_created",
      correlation_id: "corr-456",
      delivered_at: "2026-05-21T12:00:00Z",
      triggered_by: "orchestrator",
      success: true,
      is_test: false,
      success_criterion_id: "criterion-789",
      metadata: { plan: "pro", source_flow: "intake" },
    };

    await emitter.emit(event);

    expect(Sentry.captureEvent).toHaveBeenCalledWith({
      event_id: expect.stringMatching(/^[0-9a-f]{32}$/),
      message: "calendar.event_created delivered for user user-123",
      level: "info",
      tags: {
        action_type: "calendar.event_created",
        user_id: "user-123",
        is_test: "false",
        success: "true",
        correlation_id: "corr-456",
      },
      contexts: {
        action_delivered: {
          user_id: "user-123",
          action_type: "calendar.event_created",
          correlation_id: "corr-456",
          delivered_at: "2026-05-21T12:00:00Z",
          triggered_by: "orchestrator",
          success: true,
          is_test: false,
          success_criterion_id: "criterion-789",
          metadata: { plan: "pro", source_flow: "intake" },
        },
      },
    });
  });

  it("should emit with success=false for failed actions", async () => {
    const event: ActionDeliveredEvent = {
      user_id: "user-123",
      action_type: "message.sent",
      correlation_id: "corr-456",
      delivered_at: "2026-05-21T12:00:00Z",
      triggered_by: "orchestrator",
      success: false,
      is_test: false,
    };

    await emitter.emit(event);

    const calls = vi.mocked(Sentry.captureEvent).mock.calls;
    expect(calls[0][0].level).toBe("warning");
    expect(calls[0][0].contexts.action_delivered.success).toBe(false);
  });

  it("should mark test events with is_test=true", async () => {
    const event: ActionDeliveredEvent = {
      user_id: "user-123",
      action_type: "recap.delivered",
      correlation_id: "corr-456",
      delivered_at: "2026-05-21T12:00:00Z",
      triggered_by: "orchestrator",
      success: true,
      is_test: true,
    };

    await emitter.emit(event);

    const calls = vi.mocked(Sentry.captureEvent).mock.calls;
    expect(calls[0][0].tags.is_test).toBe("true");
    expect(calls[0][0].contexts.action_delivered.is_test).toBe(true);
  });

  it("should support all 5 action types", async () => {
    const actionTypes = [
      "calendar.event_created",
      "message.sent",
      "recap.delivered",
      "agenda.updated",
      "travel.itinerary_sent",
    ] as const;

    for (const actionType of actionTypes) {
      vi.clearAllMocks();

      const event: ActionDeliveredEvent = {
        user_id: "user-123",
        action_type: actionType,
        correlation_id: "corr-456",
        delivered_at: "2026-05-21T12:00:00Z",
        triggered_by: "orchestrator",
        success: true,
        is_test: false,
      };

      await emitter.emit(event);

      const calls = vi.mocked(Sentry.captureEvent).mock.calls;
      expect(calls[0][0].tags.action_type).toBe(actionType);
    }
  });
});
