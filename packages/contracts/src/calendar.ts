/**
 * Calendar adapter types — YOU-13 §6.
 * Covers fixture cases CAL-01..06 from the you31-dryrun-2026-05-03 pack.
 */

export type CalendarEventId = string;

export type CalendarParticipant = {
  email: string;
  name?: string | undefined;
  rsvp?: "accepted" | "declined" | "tentative" | "needs_action" | undefined;
};

export type CalendarEvent = {
  id: CalendarEventId;
  title: string;
  startIso: string;
  endIso: string;
  timezone: string;
  participants: CalendarParticipant[];
  organizerEmail: string;
  description?: string | undefined;
  location?: string | undefined;
};

export type RescheduleRequest = {
  eventId: CalendarEventId;
  newStartIso: string;
  newEndIso: string;
  reason?: string | undefined;
  correlationId: string;
};

export type RescheduleResult =
  | { ok: true; updatedEvent: CalendarEvent }
  | { ok: false; error: string };

export type CalendarAdapter = {
  getEvent(eventId: CalendarEventId): Promise<CalendarEvent>;
  reschedule(req: RescheduleRequest): Promise<RescheduleResult>;
};
