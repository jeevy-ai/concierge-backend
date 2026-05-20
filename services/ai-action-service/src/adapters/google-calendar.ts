/**
 * Google Calendar adapter — Scenario 3 (YOU-493).
 *
 * In production: calls the Google Calendar API with the service account token.
 * In sandbox/force-error mode: replays fixtures or simulates errors without real API calls.
 *
 * Emits provider_call_total{provider="google_calendar", outcome="success|error|timeout"}.
 * Updates circuit breaker state on each call outcome.
 */

import type { CalendarAdapter, CalendarEvent, CalendarEventId, RescheduleRequest, RescheduleResult } from "@jeevy/contracts";
import {
  CIRCUIT_OPEN,
  ProviderCircuitOpen,
  getCircuitState,
  recordFailure,
  recordSuccess,
} from "../lib/circuit-breaker.js";
import { type ConciergeKV, emitMetricLog, incrementCounter } from "../lib/metrics.js";

export type ForceError = "provider_4xx" | "provider_timeout" | "provider_5xx" | null;

const PROVIDER = "google_calendar";

const SANDBOX_EVENTS: Record<string, CalendarEvent> = {
  "CAL-01": {
    id: "CAL-01",
    title: "Q2 Planning",
    startIso: "2026-05-03T09:00:00Z",
    endIso: "2026-05-03T10:00:00Z",
    timezone: "Europe/Copenhagen",
    participants: [
      { email: "alice@example.com", name: "Alice", rsvp: "accepted" },
      { email: "bob@example.com", name: "Bob", rsvp: "tentative" },
    ],
    organizerEmail: "alice@example.com",
  },
  "CAL-02": {
    id: "CAL-02",
    title: "1:1 Sync",
    startIso: "2026-05-04T14:00:00Z",
    endIso: "2026-05-04T14:30:00Z",
    timezone: "Europe/Copenhagen",
    participants: [{ email: "carol@example.com", name: "Carol", rsvp: "accepted" }],
    organizerEmail: "carol@example.com",
  },
};

export interface GoogleCalendarAdapterOptions {
  kv: ConciergeKV;
  forceError?: ForceError;
  sandbox?: boolean;
  accessToken?: string;
}

export class GoogleCalendarAdapter implements CalendarAdapter {
  private readonly kv: ConciergeKV;
  private readonly forceError: ForceError;
  private readonly sandbox: boolean;
  private readonly accessToken: string;

  constructor(opts: GoogleCalendarAdapterOptions) {
    this.kv = opts.kv;
    this.forceError = opts.forceError ?? null;
    this.sandbox = opts.sandbox ?? false;
    this.accessToken = opts.accessToken ?? "";
  }

  async getEvent(eventId: CalendarEventId): Promise<CalendarEvent> {
    await this.checkCircuit();
    try {
      const event = await this.fetchEvent(eventId);
      await this.onSuccess();
      return event;
    } catch (err) {
      await this.onError(err);
      throw err;
    }
  }

  async reschedule(req: RescheduleRequest): Promise<RescheduleResult> {
    await this.checkCircuit();
    try {
      const result = await this.doReschedule(req);
      if (result.ok) {
        await this.onSuccess();
      } else {
        await this.onError(new Error(result.error));
      }
      return result;
    } catch (err) {
      await this.onError(err);
      throw err;
    }
  }

  private async checkCircuit(): Promise<void> {
    const state = await getCircuitState(this.kv, PROVIDER);
    if (state === CIRCUIT_OPEN) {
      await incrementCounter(this.kv, "provider_call_total", {
        provider: PROVIDER,
        outcome: "circuit_open",
      });
      emitMetricLog("provider_call_total", { provider: PROVIDER, outcome: "circuit_open" }, 1);
      throw new ProviderCircuitOpen(PROVIDER);
    }
  }

  private async onSuccess(): Promise<void> {
    await recordSuccess(this.kv, PROVIDER);
    await incrementCounter(this.kv, "provider_call_total", {
      provider: PROVIDER,
      outcome: "success",
    });
    emitMetricLog("provider_call_total", { provider: PROVIDER, outcome: "success" }, 1);
  }

  private async onError(err: unknown): Promise<void> {
    const isTimeout =
      err instanceof Error && (err.message.includes("timeout") || err.name === "TimeoutError");
    const outcome = isTimeout ? "timeout" : "error";
    await recordFailure(this.kv, PROVIDER);
    await incrementCounter(this.kv, "provider_call_total", { provider: PROVIDER, outcome });
    emitMetricLog("provider_call_total", { provider: PROVIDER, outcome }, 1);
  }

  private async fetchEvent(eventId: CalendarEventId): Promise<CalendarEvent> {
    if (this.forceError === "provider_4xx") {
      throw Object.assign(new Error("Google Calendar API: 401 Unauthorized"), {
        name: "Provider4xxError",
        statusCode: 401,
      });
    }
    if (this.forceError === "provider_timeout") {
      throw Object.assign(new Error("Google Calendar API: request timeout"), {
        name: "TimeoutError",
      });
    }
    if (this.forceError === "provider_5xx") {
      throw Object.assign(new Error("Google Calendar API: 503 Service Unavailable"), {
        name: "Provider5xxError",
        statusCode: 503,
      });
    }

    if (this.sandbox) {
      const event = SANDBOX_EVENTS[eventId];
      if (!event) throw Object.assign(new Error(`Fixture not found: ${eventId}`), { statusCode: 404 });
      return event;
    }

    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`,
      { headers: { Authorization: `Bearer ${this.accessToken}` } },
    );
    if (!res.ok) {
      throw Object.assign(new Error(`Google Calendar API: ${res.status} ${res.statusText}`), {
        statusCode: res.status,
      });
    }
    return (await res.json()) as CalendarEvent;
  }

  private async doReschedule(req: RescheduleRequest): Promise<RescheduleResult> {
    if (this.forceError === "provider_4xx") {
      throw Object.assign(new Error("Google Calendar API: 401 Unauthorized"), {
        name: "Provider4xxError",
        statusCode: 401,
      });
    }
    if (this.forceError === "provider_timeout") {
      throw Object.assign(new Error("Google Calendar API: request timeout"), {
        name: "TimeoutError",
      });
    }
    if (this.forceError === "provider_5xx") {
      throw Object.assign(new Error("Google Calendar API: 503 Service Unavailable"), {
        name: "Provider5xxError",
        statusCode: 503,
      });
    }

    if (this.sandbox) {
      const existing = SANDBOX_EVENTS[req.eventId];
      if (!existing) return { ok: false, error: `Fixture not found: ${req.eventId}` };
      const updated: CalendarEvent = {
        ...existing,
        startIso: req.newStartIso,
        endIso: req.newEndIso,
      };
      return { ok: true, updatedEvent: updated };
    }

    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(req.eventId)}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ start: { dateTime: req.newStartIso }, end: { dateTime: req.newEndIso } }),
      },
    );
    if (!res.ok) {
      return { ok: false, error: `Google Calendar API: ${res.status} ${res.statusText}` };
    }
    return { ok: true, updatedEvent: (await res.json()) as CalendarEvent };
  }
}
