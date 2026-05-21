import * as Sentry from "@sentry/cloudflare";

export type ActionType =
  | "calendar.event_created"
  | "message.sent"
  | "recap.delivered"
  | "agenda.updated"
  | "travel.itinerary_sent";

export type ActionDeliveredEvent = {
  user_id: string;
  action_type: ActionType;
  correlation_id: string;
  delivered_at: string;
  triggered_by: string;
  success: boolean;
  is_test: boolean;
  success_criterion_id?: string | undefined;
  metadata?: { plan?: string | undefined; source_flow?: string | undefined } | undefined;
};

export interface EventEmitter {
  emit(event: ActionDeliveredEvent): Promise<void>;
}

export class SentryEventEmitter implements EventEmitter {
  async emit(event: ActionDeliveredEvent): Promise<void> {
    Sentry.captureEvent({
      event_id: event.correlation_id,
      message: `${event.action_type} delivered for user ${event.user_id}`,
      level: event.success ? "info" : "warning",
      tags: {
        action_type: event.action_type,
        user_id: event.user_id,
        is_test: String(event.is_test),
        success: String(event.success),
      },
      contexts: {
        action_delivered: {
          user_id: event.user_id,
          action_type: event.action_type,
          correlation_id: event.correlation_id,
          delivered_at: event.delivered_at,
          triggered_by: event.triggered_by,
          success: event.success,
          is_test: event.is_test,
          success_criterion_id: event.success_criterion_id,
          metadata: event.metadata,
        },
      },
    });
  }
}

