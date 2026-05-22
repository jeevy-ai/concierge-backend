/**
 * Solo travel flow fixture data — spec §7, persona: Alex Chen (userId: "test-ceo").
 * Covers all 9 screen states (S1–S9) for offline FE dev and deterministic screenshot testing.
 * Ref: YOU-607 / spec: YOU-603#document-spec
 */

// ─── Verb response envelope ───────────────────────────────────────────────────

export type VerbWarning = { code: string; message: string };

export type VerbResponse<K extends string, P extends Record<string, unknown>> = {
  contractVersion: string;
  verbId: string;
  generatedAt: string;
  source: "llm" | "deterministic";
  isConfident: boolean;
  confidence: number;
  result: { kind: K; payload: P };
  warnings: VerbWarning[];
};

// ─── book_reservation payload ─────────────────────────────────────────────────

export type ReservationPayload = {
  venue: string;
  datetime: string;
  partySize: number;
  slot: string;
  fallbacks: string[];
  calendarAddLink: string;
};

export type ReservationResponse = VerbResponse<"reservation", ReservationPayload>;

// ─── schedule_meeting payload ─────────────────────────────────────────────────

export type ProposedSlot = { label: string; iso: string };

export type MeetingPayload = {
  attendee: string;
  proposedSlots: ProposedSlot[];
  draftInvite: string;
};

export type MeetingResponse = VerbResponse<"meeting", MeetingPayload>;

// ─── remind_me payload ────────────────────────────────────────────────────────

export type ReminderPayload = {
  subject: string;
  contact: string;
  dueAt: string;
  ack: string;
};

export type ReminderResponse = VerbResponse<"reminder", ReminderPayload>;

// ─── plan_my_day payload ──────────────────────────────────────────────────────

export type PlanItemPriority = "high" | "medium" | "low";

export type PlanItem = {
  time: string;
  task: string;
  priority: PlanItemPriority;
};

export type DayPlanPayload = {
  rankedPlan: PlanItem[];
  rationale: string;
};

export type DayPlanResponse = VerbResponse<"day_plan", DayPlanPayload>;

// ─── Domain types ─────────────────────────────────────────────────────────────

export type TravelPrefs = {
  airline: string;
  loyaltyNumber: string;
  seatType: string;
  hotelChain: string;
  membershipTier: string;
  cabinClass: { threshold_hours: number; preferred: string };
};

export type UserPrefs = {
  userId: string;
  name: string;
  role: string;
  homeAirport: string;
  travelPrefs: TravelPrefs;
};

export type CalendarEvent = {
  eventId: string;
  title: string;
  startDate: string;
  endDate: string;
  location: string;
  description: string;
  category: string;
};

export type ConflictEvent = {
  eventId: string;
  title: string;
  startDate: string;
  endDate: string;
  attendeeCount: number;
  organizerIsUser: boolean;
  isRecurring: boolean;
};

export type ConferenceSession = {
  sessionId: string;
  title: string;
  speaker: string;
  startIso: string;
  endIso: string;
  venue: string;
  room: string;
  response: MeetingResponse;
};

// ─── Full fixture shape ───────────────────────────────────────────────────────

export type SoloTravelFixture = {
  user: UserPrefs;
  calendarEvent: CalendarEvent;
  flightOutbound: ReservationResponse;
  flightReturn: ReservationResponse;
  hotel: ReservationResponse;
  sessions: ConferenceSession[];
  conflictEvent: ConflictEvent;
  reminders: ReminderResponse[];
  dayOfPlan: DayPlanResponse;
};

// ─── Fixture data ─────────────────────────────────────────────────────────────

export const soloTravelFixture: SoloTravelFixture = {
  user: {
    userId: "test-ceo",
    name: "Alex Chen",
    role: "VP of Product",
    homeAirport: "SFO",
    travelPrefs: {
      airline: "Delta",
      loyaltyNumber: "DL-SKY-947823",
      seatType: "aisle",
      hotelChain: "Marriott Bonvoy",
      membershipTier: "Platinum",
      cabinClass: { threshold_hours: 5, preferred: "business" },
    },
  },

  calendarEvent: {
    eventId: "gcal-ws2026-chen",
    title: "Web Summit 2026 — Lisbon",
    startDate: "2026-11-10",
    endDate: "2026-11-11",
    location: "Altice Arena, Parque das Nações, Lisbon, Portugal",
    description: "Annual tech conference. Registered for 4 sessions.",
    category: "conference",
  },

  flightOutbound: {
    contractVersion: "2026-05-03",
    verbId: "book_reservation",
    generatedAt: "2026-05-21T10:00:00Z",
    source: "llm",
    isConfident: true,
    confidence: 0.91,
    result: {
      kind: "reservation",
      payload: {
        venue: "Delta Air Lines UA88 — San Francisco (SFO) to Lisbon (LIS)",
        datetime: "2026-11-09T22:10:00-08:00",
        partySize: 1,
        slot: "Seat 4A — Business Class, Aisle",
        fallbacks: [
          "Delta UA88 departure 14:30 (earlier, 1 stop via JFK)",
          "TAP Air Portugal TP236 SFO→LIS Nov 9 23:45 Business",
        ],
        calendarAddLink:
          "webcal://calendar.delta.com/add?flight=UA88&date=20261109&seat=4A",
      },
    },
    warnings: [],
  },

  flightReturn: {
    contractVersion: "2026-05-03",
    verbId: "book_reservation",
    generatedAt: "2026-05-21T10:00:01Z",
    source: "llm",
    isConfident: true,
    confidence: 0.89,
    result: {
      kind: "reservation",
      payload: {
        venue: "Delta Air Lines UA89 — Lisbon (LIS) to San Francisco (SFO)",
        datetime: "2026-11-12T09:30:00+00:00",
        partySize: 1,
        slot: "Seat 4A — Business Class, Aisle",
        fallbacks: ["Delta UA89 departure 18:00 (later option, direct)"],
        calendarAddLink:
          "webcal://calendar.delta.com/add?flight=UA89&date=20261112&seat=4A",
      },
    },
    warnings: [],
  },

  hotel: {
    contractVersion: "2026-05-03",
    verbId: "book_reservation",
    generatedAt: "2026-05-21T10:00:02Z",
    source: "llm",
    isConfident: true,
    confidence: 0.85,
    result: {
      kind: "reservation",
      payload: {
        venue:
          "Bairro Alto Hotel — Rua da Bica de Duarte Belo 60, 1200-075 Lisbon (3.2km from Altice Arena)",
        datetime: "2026-11-10T15:00:00+00:00",
        partySize: 1,
        slot: "Superior King Room — Non-smoking, City View",
        fallbacks: [
          "Marriott Lisbon — Avenida dos Combatentes 45 (4.8km from venue, higher tier)",
        ],
        calendarAddLink:
          "webcal://marriott.com/calendar/add?hotel=bairro-alto&checkin=20261110&checkout=20261112",
      },
    },
    warnings: [
      { code: "WARNING", message: "Hotel is 3.2km from conference venue — 8 min by taxi" },
    ],
  },

  sessions: [
    {
      sessionId: "WS2026-K01",
      title: "The Age of Ambient AI",
      speaker: "Reid Hoffman",
      startIso: "2026-11-10T09:30:00+00:00",
      endIso: "2026-11-10T10:15:00+00:00",
      venue: "Altice Arena",
      room: "Stage 1",
      response: {
        contractVersion: "2026-05-03",
        verbId: "schedule_meeting",
        generatedAt: "2026-05-21T10:01:00Z",
        source: "llm",
        isConfident: true,
        confidence: 0.93,
        result: {
          kind: "meeting",
          payload: {
            attendee: "Alex Chen",
            proposedSlots: [{ label: "Nov 10, 9:30 AM WET", iso: "2026-11-10T09:30:00+00:00" }],
            draftInvite:
              "The Age of Ambient AI — Web Summit 2026\nSpeaker: Reid Hoffman\nStage 1, Altice Arena\nSession ID: WS2026-K01",
          },
        },
        warnings: [],
      },
    },
    {
      sessionId: "WS2026-K02",
      title: "Future of Work keynote",
      speaker: "Panel",
      startIso: "2026-11-10T14:00:00+00:00",
      endIso: "2026-11-10T15:00:00+00:00",
      venue: "Altice Arena",
      room: "Centre Stage",
      response: {
        contractVersion: "2026-05-03",
        verbId: "schedule_meeting",
        generatedAt: "2026-05-21T10:01:01Z",
        source: "llm",
        isConfident: true,
        confidence: 0.91,
        result: {
          kind: "meeting",
          payload: {
            attendee: "Alex Chen",
            proposedSlots: [{ label: "Nov 10, 2:00 PM WET", iso: "2026-11-10T14:00:00+00:00" }],
            draftInvite:
              "Future of Work keynote — Web Summit 2026\nSpeaker: Panel\nCentre Stage, Altice Arena\nSession ID: WS2026-K02",
          },
        },
        warnings: [],
      },
    },
    {
      sessionId: "WS2026-W07",
      title: "Product Strategy in the AI Era",
      speaker: "Lenny Rachitsky",
      startIso: "2026-11-11T10:00:00+00:00",
      endIso: "2026-11-11T11:30:00+00:00",
      venue: "Altice Arena",
      room: "Workshop Hall C",
      response: {
        contractVersion: "2026-05-03",
        verbId: "schedule_meeting",
        generatedAt: "2026-05-21T10:01:02Z",
        source: "llm",
        isConfident: true,
        confidence: 0.88,
        result: {
          kind: "meeting",
          payload: {
            attendee: "Alex Chen",
            proposedSlots: [{ label: "Nov 11, 10:00 AM WET", iso: "2026-11-11T10:00:00+00:00" }],
            draftInvite:
              "Product Strategy in the AI Era — Workshop\nHost: Lenny Rachitsky\nWorkshop Hall C, Altice Arena\nSession ID: WS2026-W07",
          },
        },
        warnings: [],
      },
    },
    {
      sessionId: "WS2026-K08",
      title: "Closing Keynote",
      speaker: "Padmasree Warrior",
      startIso: "2026-11-11T15:30:00+00:00",
      endIso: "2026-11-11T17:00:00+00:00",
      venue: "Altice Arena",
      room: "Centre Stage",
      response: {
        contractVersion: "2026-05-03",
        verbId: "schedule_meeting",
        generatedAt: "2026-05-21T10:01:03Z",
        source: "llm",
        isConfident: true,
        confidence: 0.95,
        result: {
          kind: "meeting",
          payload: {
            attendee: "Alex Chen",
            proposedSlots: [{ label: "Nov 11, 3:30 PM WET", iso: "2026-11-11T15:30:00+00:00" }],
            draftInvite:
              "Closing Keynote — Web Summit 2026\nSpeaker: Padmasree Warrior\nCentre Stage, Altice Arena\nSession ID: WS2026-K08",
          },
        },
        warnings: [],
      },
    },
  ],

  conflictEvent: {
    eventId: "gcal-allhands-q4",
    title: "All-Hands Q4 Planning",
    startDate: "2026-11-11T14:00:00+00:00",
    endDate: "2026-11-11T15:30:00+00:00",
    attendeeCount: 12,
    organizerIsUser: true,
    isRecurring: false,
  },

  reminders: [
    {
      contractVersion: "2026-05-03",
      verbId: "remind_me",
      generatedAt: "2026-05-21T10:02:00Z",
      source: "llm",
      isConfident: true,
      confidence: 0.97,
      result: {
        kind: "reminder",
        payload: {
          subject: "Pack for Lisbon + check-in opens",
          contact: "Alex Chen",
          dueAt: "2026-11-09T20:00:00-08:00",
          ack: "Reminder set for Nov 9 at 8:00 PM PST",
        },
      },
      warnings: [],
    },
    {
      contractVersion: "2026-05-03",
      verbId: "remind_me",
      generatedAt: "2026-05-21T10:02:01Z",
      source: "llm",
      isConfident: true,
      confidence: 0.96,
      result: {
        kind: "reminder",
        payload: {
          subject: "Leave for SFO — UA88 boards 09:00",
          contact: "Alex Chen",
          dueAt: "2026-11-10T05:30:00-08:00",
          ack: "Reminder set for Nov 10 at 5:30 AM PST",
        },
      },
      warnings: [],
    },
  ],

  dayOfPlan: {
    contractVersion: "2026-05-03",
    verbId: "plan_my_day",
    generatedAt: "2026-11-10T06:00:00-08:00",
    source: "llm",
    isConfident: true,
    confidence: 0.94,
    result: {
      kind: "day_plan",
      payload: {
        rankedPlan: [
          { time: "06:00", task: "Wake up + final packing", priority: "high" },
          { time: "06:45", task: "Order Lyft to SFO (35 min, Terminal 2)", priority: "high" },
          { time: "07:20", task: "Arrive SFO — Delta Sky Club check-in", priority: "high" },
          { time: "09:00", task: "Board UA88 — Seat 4A Business", priority: "high" },
          { time: "10:10", task: "Wheels up SFO → LIS (10.5h flight)", priority: "medium" },
          { time: "17:45 WET", task: "Land Lisbon — hotel transfer (taxi ~25 min)", priority: "high" },
          { time: "19:30 WET", task: "Check in: Bairro Alto Hotel", priority: "medium" },
          { time: "20:00 WET", task: "Web Summit welcome reception (optional)", priority: "low" },
        ],
        rationale:
          "Critical path: Lyft at 06:45 is the latest safe departure. International check-in closes 90 min before departure (22:10). Sky Club access allows lounge time if early.",
      },
    },
    warnings: [],
  },
};
