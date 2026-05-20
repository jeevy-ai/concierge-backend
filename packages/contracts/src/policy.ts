/**
 * Policy engine types — YOU-493 Scenario 4.
 * Covers external action gating, approval token enforcement, and kill-switch.
 */

export type ActionClass = "outreach_send" | "calendar_write" | "travel_book";

export type OutboundSendRequest = {
  actionClass: ActionClass;
  channel: "email" | "slack" | "sms";
  to: string[];
  subject?: string | undefined;
  body: string;
  approvalToken?: string | undefined;
  correlationId: string;
};

export type PolicyDecision =
  | { allowed: true }
  | { allowed: false; reason: "no_approval_token" | "kill_switch_disabled" };

export type ExternalActionMetricEvent = {
  name: "external_action_total";
  approval_attached: boolean;
  action_class: ActionClass;
  outcome: "allowed" | "rejected_no_token" | "rejected_kill_switch";
  correlationId: string;
};
