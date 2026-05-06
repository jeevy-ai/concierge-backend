/**
 * Messaging adapter types — YOU-13 §7.
 * Covers fixture cases MSG-01..05 from the you31-dryrun-2026-05-03 pack.
 */

export type MessageChannel = "email" | "slack" | "sms";

export type OutreachRequest = {
  channel: MessageChannel;
  to: string[];
  subject?: string | undefined;
  body: string;
  correlationId: string;
};

export type OutreachResult = { ok: true; messageIds: string[] } | { ok: false; error: string };

export type MessagingAdapter = {
  send(req: OutreachRequest): Promise<OutreachResult>;
};
