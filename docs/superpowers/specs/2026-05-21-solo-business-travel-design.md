# Design Spec: Solo Business Travel — Exec at Conference

**Issue:** YOU-603  
**Date:** 2026-05-21  
**Author:** UXDesigner  
**Status:** Ready for FE implementation  
**Blocking assumption:** CEO decision — solo business travel scenario is the chosen happy path. Unblocked.

---

## 1. Persona + Scenario

**Alex Chen**, VP of Product at a 200-person SaaS company. Frequent traveler (4–6 trips/year), spends 3–4 hours/day in calendar. Travel preferences already stored in Jeevy: Delta Airlines, aisle seat, Marriott Bonvoy, business class for 5h+ flights. Expense policy known. No dietary flags.

Alex has just added "Web Summit 2026 — Lisbon" to their calendar for November 10–11, 2026. They have never typed a travel request to Jeevy — Jeevy detects the geo-string and initiates the flow proactively. Alex's mental model: *Jeevy handles logistics so I can focus on the conference.*

---

## 2. Trigger

**Happy path: Calendar-detected.**

Jeevy polls calendar events (or receives a webhook) at event creation/update time. Detection rule:

- Event title OR description contains a location token (city name, country, IATA code, or known venue)
- Event spans ≥ 1 overnight OR covers ≥ 6 consecutive hours on a non-home-city date
- Event category is not "personal" or "holiday"

When triggered, Jeevy sends a proactive **butler nudge** message into the existing concierge chat thread. The message is NOT a notification banner — it appears inline as a Jeevy-authored chat bubble. This reuses the existing chat surface; no new screen is created.

**Exact trigger payload the FE constructs from calendar data:**
```
Detected trip: "Web Summit 2026" in Lisbon, Portugal. Dates: Nov 10–11, 2026.
Origin inferred from user location: San Francisco, CA (SFO).
User travel prefs on file: Delta Airlines, aisle, Marriott Bonvoy, business class 5h+.
Requesting travel setup confirmation.
```

FE passes this as `text` to `POST /v1/ai/concierge` with `verbId: "book_reservation"` and `userId: "test-ceo"` to pre-warm the conversation context. The actual booking action fires only after user confirms in S2.

---

## 3. Screen-by-Screen Flow

All states occur within the **existing concierge chat pane**. There is no new page or modal. An **itinerary card** lives at the top of the result area and grows as each step completes.

---

### S1 — Butler Nudge

**Purpose:** Jeevy surfaces the detected trip and requests permission to plan.

**User inputs:** None. Two taps: `Set it up` (primary) / `Not now` (ghost).

**System outputs:**
- Jeevy chat bubble (Jeevy-authored, timestamped):
  > "I noticed you have **Web Summit 2026 in Lisbon** on Nov 10–11. Want me to handle flights, hotel, and calendar sync?"
- Below bubble: `[Set it up]` `[Not now]`
- A collapsed **itinerary card stub** appears at top of result area with: trip title, dates, origin city. Card body is hidden (0px height).

**Verb mapping:** No API call yet. FE renders this from calendar event metadata alone.

**Motion intent:**
- Jeevy bubble slides in from bottom: `translateY(16px) → translateY(0)`, `opacity: 0 → 1`, 220ms, `cubic-bezier(0.16, 1, 0.3, 1)`.
- Itinerary card stub fades in 80ms after bubble: `opacity: 0 → 1`, 180ms `ease-out`. No height animation yet.
- Buttons fade in 100ms after card: `opacity: 0 → 1`, 120ms `ease-out`.

**Progressive disclosure:** Itinerary card body hidden. "Not now" dismisses to normal concierge state; itinerary stub persists collapsed in history.

---

### S2 — Travel Preferences Confirmation

**Purpose:** Surface stored prefs before taking any action; give user one chance to override.

**User inputs:**
- Confirm stored prefs (one tap `Looks good`) or
- Tap `Change` next to any pref row to edit inline.
- Inline editing: each pref row expands to a single-field form (airline dropdown, seat type radio, hotel chain dropdown, class radio). Max one row open at a time.

**System outputs:**
- Second Jeevy bubble:
  > "I'll use your saved preferences:\n• **Airline:** Delta (SkyMiles)\n• **Seat:** Aisle\n• **Hotel:** Marriott Bonvoy\n• **Class:** Business (flight > 5h, SFO–LIS ~10.5h)\n\nShall I proceed?"
- Inline pref rows with `[Change]` affordance per row.
- Primary CTA: `[Proceed]`.

**Verb mapping:** No API call. FE reads from local user-prefs store / server session.

**Motion intent:**
- Second bubble slides in identically to S1 bubble: 220ms `cubic-bezier(0.16, 1, 0.3, 1)`.
- Inline edit row expands: `max-height: 0 → 72px`, 160ms `ease-out`. Collapses on save: same in reverse.
- Save confirmation: row flashes background `token(color.success.subtle)` for 400ms then fades.

**Progressive disclosure:** Pref rows show only current value + `[Change]`. Edit form hidden until tapped.

**Clarifying-question rule:** Prefs confirmed from store — Jeevy never asks about airline, seat, chain, or class in happy path. Ask rules apply only from S3 onward (see §4).

---

### S3 — Flight Selection

**Purpose:** Present AI-sourced flight options; user picks one.

**User inputs:** Tap to select one of 2–3 flight options. `[Select]` button per row. No text entry.

**System outputs:**
- Jeevy bubble: "Here are the best options for SFO → LIS on Nov 9:"
- 2–3 flight option cards, each showing:
  - Airline + flight number
  - Departure / arrival times (show local times for each airport)
  - Duration, stops
  - Seat class
  - `[Select]` button
- Selected card gets a checkmark; others fade to 40% opacity.
- On selection: itinerary card **grows** to show flight segment (enrichment point 1).

**Verb mapping:** `book_reservation`

**API call constructed by FE:**
```json
{
  "userId": "test-ceo",
  "verbId": "book_reservation",
  "text": "Book outbound flight SFO to LIS, depart Nov 9 2026, return Nov 12 2026. Passenger: Alex Chen. Preference: Delta, business class, aisle seat. Budget: business class approved for 5h+ flights."
}
```

**Response consumed:** `result.payload.venue` → airline/flight#, `result.payload.datetime` → departure time, `result.payload.slot` → seat assignment, `result.payload.calendarAddLink` → calendar add URL. `result.payload.fallbacks` → used to populate options 2 and 3 if LLM returns them.

**Clarifying question rule:** If `response.isConfident === false` AND `response.confidence < 0.7`, Jeevy asks: "I'm not certain of the best flight here — do you have a preferred departure time (morning / afternoon / evening)?" One question only. Re-calls verb with augmented text.

**Motion intent:**
- Flight cards stagger in: card 1 at 0ms, card 2 at 60ms, card 3 at 120ms. Each: `translateY(10px) → translateY(0)`, `opacity: 0 → 1`, 180ms `ease-out`.
- On selection: unchosen cards transition `opacity: 1 → 0.4`, 120ms `linear`. Chosen card border changes to `token(color.accent.border)` over 120ms.
- Itinerary card flight section height animates `0 → auto` via `max-height` transition, 200ms `ease-out`, after 80ms delay from selection.

**Progressive disclosure:** Flight details (layover info, baggage policy, fare rules) hidden behind `[Details ↓]` chevron on each card.

---

### S4 — Hotel Selection

**Purpose:** Present AI-sourced hotel options near conference venue; user picks one.

**User inputs:** Tap `[Select]` on one of 2 hotel options.

**System outputs:**
- Jeevy bubble: "Here are hotels near the venue for Nov 10–12:"
- 2 hotel cards, each showing:
  - Hotel name, chain badge (Marriott logo token)
  - Distance from Web Summit venue
  - Check-in / check-out dates
  - Room type, nightly rate (EUR)
  - `[Select]`
- On selection: itinerary card grows to add hotel segment (enrichment point 2).

**Verb mapping:** `book_reservation`

**API call:**
```json
{
  "userId": "test-ceo",
  "verbId": "book_reservation",
  "text": "Book hotel in Lisbon near Web Summit venue (Altice Arena, Parque das Nações) for Nov 10–12 2026. Preference: Marriott Bonvoy. 1 room, standard business room."
}
```

**Response consumed:** Same fields as S3. `result.payload.venue` → hotel name + address.

**Clarifying question rule:** If `confidence < 0.7` on venue match (hotel ↔ conference proximity), Jeevy asks: "The nearest Marriott is 4.2km from the venue. Accept, or shall I check other chains?" One question. Re-calls with augmented text if user says "other chains."

**Motion intent:** Identical stagger to S3 flight cards. Hotel segment in itinerary card: same `max-height` grow animation as S3 flight segment.

**Progressive disclosure:** Amenities, cancellation policy hidden behind `[Details ↓]`.

---

### S5 — Conference Session Sync

**Purpose:** Jeevy finds the user's registered conference sessions and proposes adding them to calendar.

**User inputs:** Checkbox list — all sessions pre-checked. User can uncheck any. CTA: `[Add to Calendar]`.

**System outputs:**
- Jeevy bubble: "I found 4 sessions you're registered for at Web Summit. Add them to your calendar?"
- Session list (checkbox per row):
  - Session title, speaker, time, room
- Conflict indicator badge on any session that overlaps existing calendar events (computed client-side against known calendar).
- On confirm: itinerary card grows to add sessions list (enrichment point 3).

**Verb mapping:** `schedule_meeting` (one call per session, or batch call with combined text)

**API call per session:**
```json
{
  "userId": "test-ceo",
  "verbId": "schedule_meeting",
  "text": "Schedule: 'The Age of Ambient AI' keynote at Web Summit, Nov 10 2026 09:30–10:15, Altice Arena Stage 1. Add to Alex Chen's calendar as conference session."
}
```

**Response consumed:** `result.payload.proposedSlots` → confirms time slot, `result.payload.draftInvite` → used as calendar event description.

**Clarifying question rule:** None. Sessions are structured data; Jeevy never asks about conference schedule. If `isConfident === false` on a session, FE shows a yellow `⚠ Verify time` badge on that row instead of asking.

**Motion intent:**
- Session rows stagger in at 50ms intervals: `translateY(8px) → translateY(0)`, `opacity: 0 → 1`, 150ms `ease-out`.
- Conflict badge pulses once on appear: `scale(1) → scale(1.08) → scale(1)`, 280ms `ease-in-out`. Does not loop.
- Itinerary card sessions section: `max-height: 0 → auto`, 240ms `ease-out`.

**Progressive disclosure:** Speaker bio, session description hidden. Room map link hidden behind `[Venue ↓]`.

---

### S6 — Conflict Resolution (conditional)

**Purpose:** Surface any calendar conflict surfaced in S5 and give user a one-tap resolution path.

**Condition:** Only shown if ≥1 session conflicts with an existing calendar event.

**User inputs:**
- Per conflict row: `[Move meeting]` (reschedule conflicting existing event) or `[Keep session]` (skip conflict, keep session).
- No text entry.

**System outputs:**
- Jeevy bubble: "One session overlaps an existing meeting:"
- Conflict card showing:
  - Existing meeting: title, time, attendee count
  - Conference session: title, time
  - Two options: `[Move the meeting]` / `[Keep session, skip meeting note]`

**Verb mapping:** `schedule_meeting` (re-propose slots for the conflicting existing meeting if user picks `Move meeting`)

**API call (if user picks Move):**
```json
{
  "userId": "test-ceo",
  "verbId": "schedule_meeting",
  "text": "Reschedule 'All-Hands Q4' from Nov 11 14:00 due to conference conflict. Alex Chen is organizer. Attendees: 12. Find next available slot within same week, avoid mornings."
}
```

**Clarifying question rule:** Jeevy never asks which option to pick — it presents both and waits. If `schedule_meeting` returns `isConfident: false` on the new slot, Jeevy shows the proposed slot and adds a `⚠ Verify` label, but does not block the flow.

**Motion intent:**
- Conflict card entrance: `border-left: 3px solid token(color.warning.border)`. Slides in identically to session rows.
- On resolution choice: card fades `opacity: 1 → 0` over 200ms then collapses `max-height → 0` over 160ms.

**Progressive disclosure:** Full attendee list hidden. Meeting recurrence warning shown only if conflicting event is recurring.

---

### S7 — Reminder Setup

**Purpose:** Set departure reminders so Alex never misses a flight.

**User inputs:** Jeevy proposes 2 reminders. User can tap `[Edit time]` on each or `[Confirm reminders]` to accept all.

**System outputs:**
- Jeevy bubble: "I've set up 2 reminders for your trip:"
- Two reminder pills:
  - `Nov 9, 20:00 — Pack + online check-in opens`
  - `Nov 10, 05:30 — Leave for SFO (Lyft ~35 min to terminal)`
- `[Confirm reminders]` CTA.
- On confirm: itinerary card grows to add reminders section (enrichment point 4).

**Verb mapping:** `remind_me` (one call per reminder)

**API call (reminder 1):**
```json
{
  "userId": "test-ceo",
  "verbId": "remind_me",
  "text": "Remind Alex Chen on Nov 9 2026 at 20:00 PST: Pack for Lisbon trip and complete Delta online check-in. Flight UA88 departs SFO Nov 9 22:10."
}
```

**API call (reminder 2):**
```json
{
  "userId": "test-ceo",
  "verbId": "remind_me",
  "text": "Remind Alex Chen on Nov 10 2026 at 05:30 PST: Leave for SFO airport. Delta flight UA88 to Lisbon departs 22:10. Lyft estimate 35 min to international terminal."
}
```

**Response consumed:** `result.payload.dueAt` → confirmed reminder time, `result.payload.ack` → display string, `result.payload.subject` → reminder label.

**Clarifying question rule:** None. Reminders are computed from flight departure time. Jeevy never asks when to remind — it calculates from stored prefs (D-1 evening, D-0 departure minus 90 min + travel time).

**Motion intent:**
- Reminder pills enter: `translateX(-12px) → translateX(0)`, `opacity: 0 → 1`, 160ms `ease-out`, staggered 80ms apart.
- Itinerary card reminders section: `max-height: 0 → auto`, 160ms `ease-out`.

**Progressive disclosure:** Nothing hidden. Reminders are short; full display.

---

### S8 — Itinerary Card (End State)

**Purpose:** Full trip summary; persistent reference artifact.

**User inputs:** None — view only. Tap any segment to deep-link (flight → airline app, hotel → hotel app, session → conference app).

**System outputs:** Full itinerary card. See §6 for exact contents.

**Verb mapping:** No new call. Card assembled from S3–S7 payloads.

**Motion intent:**
- Card "completion" pulse: entire card border transitions `token(color.accent.border) → token(color.success.border)` over 300ms, then `scale(1) → scale(1.01) → scale(1)` over 240ms `ease-in-out`. Once only.
- Status badge on card header: transitions background `token(color.neutral.subtle) → token(color.success.subtle)` over 200ms.

**Progressive disclosure:** Each segment (flight, hotel, sessions, reminders) collapsible via chevron. Default: all expanded.

---

### S9 — Day-of Plan (Morning of Departure)

**Purpose:** On departure morning, Jeevy proactively sends the day plan.

**Trigger:** Calendar event "Web Summit departure" on Nov 10 (or nearest calendar anchor for departure day). Fires at 06:00 local time.

**User inputs:** Read-only. Optional `[Adjust]` taps on each time block.

**System outputs:**
- Jeevy bubble: "Good morning. Here's your day:"
- Ranked day plan card:
  - 06:00 — Wake + pack final items
  - 06:45 — Order Lyft (35 min to SFO international)
  - 07:20 — Arrive SFO, check in (Delta Sky Club access)
  - 09:00 — SFO boarding
  - 10:10 — Wheels up SFO → LIS (UA88)
  - 17:45 local — Arrive Lisbon, hotel check-in
  - 20:00 — Web Summit welcome dinner (optional)

**Verb mapping:** `plan_my_day`

**API call:**
```json
{
  "userId": "test-ceo",
  "verbId": "plan_my_day",
  "text": "Plan Alex Chen's day on Nov 10 2026. Departing SFO 22:10 on Delta UA88 to Lisbon. Hotel check-in at Bairro Alto Hotel. Web Summit evening reception 20:00 local. Must arrive airport 3h before international departure. Lyft ~35 min to SFO."
}
```

**Response consumed:** `result.payload.rankedPlan` → ordered time blocks, `result.payload.rationale` → shown as collapsed footnote.

**Motion intent:**
- Day plan time blocks stagger in at 40ms intervals: `translateX(-8px) → translateX(0)`, `opacity: 0 → 1`, 140ms `ease-out`.

**Progressive disclosure:** `rationale` hidden behind `[Why this order? ↓]` link at bottom of card.

---

## 4. Clarifying-Question Rules

Jeevy asks **only when confidence < 0.7** on a specific field. Rules are deterministic — no judgment calls for FE.

| Situation | Confidence threshold | Question asked | Max questions |
|---|---|---|---|
| Flight options ambiguous (no direct flight) | < 0.7 on `slot` | "Prefer morning or evening departure?" | 1 |
| Hotel proximity < 3km not achievable in pref chain | < 0.7 on `venue` | "Nearest [chain] is Xkm from venue. Accept or check other chains?" | 1 |
| Conference session time uncertain (source unavailable) | < 0.7 on any `proposedSlots` | FE shows `⚠ Verify` badge, no question | 0 |
| Conflict resolution proposed slot uncertain | < 0.7 on rescheduled slot | FE shows `⚠ Verify` badge on proposed time, no question | 0 |
| Reminder time computable from flight data | Always > 0.7 | Never asked | 0 |
| Day-of plan with all data known | Always > 0.7 | Never asked | 0 |

**Rule:** Jeevy asks at most 1 clarifying question per verb call. If still < 0.7 after the answer, Jeevy uses the best deterministic fallback and shows a `⚠ Verify` badge. Never asks twice.

**Question format:** Single sentence, plain English, inside a Jeevy chat bubble. Never a modal. Never blocks the flow — other segments continue in parallel.

---

## 5. Progressive Enrichment — 5 Growth Points

The itinerary card starts as a stub (trip header + dates) and gains sections at these points:

| # | Trigger | What appears on card |
|---|---|---|
| 1 | User selects flight in S3 | Flight segment: airline, flight#, SFO→LIS, times, seat |
| 2 | User selects hotel in S4 | Hotel segment: name, address, check-in/out dates, room type |
| 3 | User confirms sessions in S5 | Sessions list: 4 items with time + room |
| 4 | User confirms reminders in S7 | Reminders section: 2 reminder pills with times |
| 5 | All steps complete (S8) | Status badge updates to "Trip ready ✓"; card border turns success-green |

Each growth point triggers the `max-height: 0 → auto` animation (200ms `ease-out`) on the new section. No full-card re-render — only the new section animates in. Existing sections do not re-animate.

---

## 6. End-State Artifacts

### 6a. Itinerary Card (final contents)

```
┌─────────────────────────────────────────────┐
│ ✓ Trip ready                                │
│ Web Summit 2026 · Lisbon · Nov 9–12         │
├─────────────────────────────────────────────┤
│ ✈ Outbound Flight                           │
│   Delta UA88 · SFO → LIS                   │
│   Nov 9, 22:10 PST → Nov 10, 17:45 WET     │
│   Business · Aisle 4A                       │
├─────────────────────────────────────────────┤
│ ✈ Return Flight                             │
│   Delta UA89 · LIS → SFO                   │
│   Nov 12, 09:30 WET → Nov 12, 12:15 PST    │
│   Business · Aisle 4A                       │
├─────────────────────────────────────────────┤
│ 🏨 Hotel                                    │
│   Bairro Alto Hotel · Marriott Bonvoy       │
│   Rua da Bica de Duarte Belo 60, Lisbon     │
│   Check-in: Nov 10 · Check-out: Nov 12      │
│   Superior King room                        │
├─────────────────────────────────────────────┤
│ 📅 Conference Sessions (4)                  │
│   Nov 10 09:30  The Age of Ambient AI       │
│   Nov 10 14:00  Future of Work keynote      │
│   Nov 11 10:00  Product Strategy workshop   │
│   Nov 11 15:30  Closing keynote             │
├─────────────────────────────────────────────┤
│ 🔔 Reminders (2)                            │
│   Nov 9, 20:00  Pack + check-in opens       │
│   Nov 10, 05:30  Leave for SFO              │
└─────────────────────────────────────────────┘
```

### 6b. Reminders (exact content)

| Time | Text | Delivery channel |
|---|---|---|
| Nov 9, 20:00 PST | "Pack for Lisbon. Delta check-in opens now (flight UA88, Nov 9 22:10 SFO). Confirmation: DL-2026-88-CHEN" | Push + email |
| Nov 10, 05:30 PST | "Leave for SFO now. Lyft ~35 min to international terminal. Delta UA88 boards 09:00. Seat 4A confirmed." | Push only |

### 6c. Calendar Sync Confirmation

```
6 events added to Alex Chen's calendar:

  ✓ Delta UA88 SFO→LIS (Nov 9, 22:10 – Nov 10, 17:45)
  ✓ Delta UA89 LIS→SFO (Nov 12, 09:30 – Nov 12, 12:15)
  ✓ The Age of Ambient AI (Nov 10, 09:30 – 10:15, Stage 1)
  ✓ Future of Work keynote (Nov 10, 14:00 – 15:00, Centre Stage)
  ✓ Product Strategy workshop (Nov 11, 10:00 – 11:30, Workshop Hall C)
  ✓ Closing keynote (Nov 11, 15:30 – 17:00, Centre Stage)
```

FE renders this list in-chat as a Jeevy bubble immediately after S5 confirm. Each item has a `[View in Calendar]` deep link.

---

## 7. Fixture Data

Realistic dummy data for FE development and demo. Matches `test-ceo` user persona.

### User
```json
{
  "userId": "test-ceo",
  "name": "Alex Chen",
  "role": "VP of Product",
  "homeAirport": "SFO",
  "travelPrefs": {
    "airline": "Delta",
    "loyaltyNumber": "DL-SKY-947823",
    "seatType": "aisle",
    "hotelChain": "Marriott Bonvoy",
    "membershipTier": "Platinum",
    "cabinClass": { "threshold_hours": 5, "preferred": "business" }
  }
}
```

### Calendar Event (trigger)
```json
{
  "eventId": "gcal-ws2026-chen",
  "title": "Web Summit 2026 — Lisbon",
  "startDate": "2026-11-10",
  "endDate": "2026-11-11",
  "location": "Altice Arena, Parque das Nações, Lisbon, Portugal",
  "description": "Annual tech conference. Registered for 4 sessions.",
  "category": "conference"
}
```

### Flight (outbound) — book_reservation response
```json
{
  "contractVersion": "1",
  "verbId": "book_reservation",
  "generatedAt": "2026-05-21T10:00:00Z",
  "source": "llm",
  "isConfident": true,
  "confidence": 0.91,
  "result": {
    "kind": "reservation",
    "payload": {
      "venue": "Delta Air Lines UA88 — San Francisco (SFO) to Lisbon (LIS)",
      "datetime": "2026-11-09T22:10:00-08:00",
      "partySize": 1,
      "slot": "Seat 4A — Business Class, Aisle",
      "fallbacks": [
        "Delta UA88 departure 14:30 (earlier, 1 stop via JFK)",
        "TAP Air Portugal TP236 SFO→LIS Nov 9 23:45 Business"
      ],
      "calendarAddLink": "webcal://calendar.delta.com/add?flight=UA88&date=20261109&seat=4A"
    }
  },
  "warnings": []
}
```

### Flight (return) — book_reservation response
```json
{
  "contractVersion": "1",
  "verbId": "book_reservation",
  "generatedAt": "2026-05-21T10:00:01Z",
  "source": "llm",
  "isConfident": true,
  "confidence": 0.89,
  "result": {
    "kind": "reservation",
    "payload": {
      "venue": "Delta Air Lines UA89 — Lisbon (LIS) to San Francisco (SFO)",
      "datetime": "2026-11-12T09:30:00+00:00",
      "partySize": 1,
      "slot": "Seat 4A — Business Class, Aisle",
      "fallbacks": [
        "Delta UA89 departure 18:00 (later option, direct)"
      ],
      "calendarAddLink": "webcal://calendar.delta.com/add?flight=UA89&date=20261112&seat=4A"
    }
  },
  "warnings": []
}
```

### Hotel — book_reservation response
```json
{
  "contractVersion": "1",
  "verbId": "book_reservation",
  "generatedAt": "2026-05-21T10:00:02Z",
  "source": "llm",
  "isConfident": true,
  "confidence": 0.85,
  "result": {
    "kind": "reservation",
    "payload": {
      "venue": "Bairro Alto Hotel — Rua da Bica de Duarte Belo 60, 1200-075 Lisbon (3.2km from Altice Arena)",
      "datetime": "2026-11-10T15:00:00+00:00",
      "partySize": 1,
      "slot": "Superior King Room — Non-smoking, City View",
      "fallbacks": [
        "Marriott Lisbon — Avenida dos Combatentes 45 (4.8km from venue, higher tier)"
      ],
      "calendarAddLink": "webcal://marriott.com/calendar/add?hotel=bairro-alto&checkin=20261110&checkout=20261112"
    }
  },
  "warnings": ["Hotel is 3.2km from conference venue — 8 min by taxi"]
}
```

### Conference Sessions — schedule_meeting responses (4 sessions)
```json
[
  {
    "verbId": "schedule_meeting",
    "isConfident": true,
    "confidence": 0.93,
    "result": {
      "kind": "meeting",
      "payload": {
        "attendee": "Alex Chen",
        "proposedSlots": ["2026-11-10T09:30:00+00:00"],
        "draftInvite": "The Age of Ambient AI — Web Summit 2026\nSpeaker: Reid Hoffman\nStage 1, Altice Arena\nSession ID: WS2026-K01"
      }
    }
  },
  {
    "verbId": "schedule_meeting",
    "isConfident": true,
    "confidence": 0.91,
    "result": {
      "kind": "meeting",
      "payload": {
        "attendee": "Alex Chen",
        "proposedSlots": ["2026-11-10T14:00:00+00:00"],
        "draftInvite": "Future of Work keynote — Web Summit 2026\nSpeaker: Panel\nCentre Stage, Altice Arena\nSession ID: WS2026-K02"
      }
    }
  },
  {
    "verbId": "schedule_meeting",
    "isConfident": true,
    "confidence": 0.88,
    "result": {
      "kind": "meeting",
      "payload": {
        "attendee": "Alex Chen",
        "proposedSlots": ["2026-11-11T10:00:00+00:00"],
        "draftInvite": "Product Strategy in the AI Era — Workshop\nHost: Lenny Rachitsky\nWorkshop Hall C, Altice Arena\nSession ID: WS2026-W07"
      }
    }
  },
  {
    "verbId": "schedule_meeting",
    "isConfident": true,
    "confidence": 0.95,
    "result": {
      "kind": "meeting",
      "payload": {
        "attendee": "Alex Chen",
        "proposedSlots": ["2026-11-11T15:30:00+00:00"],
        "draftInvite": "Closing Keynote — Web Summit 2026\nSpeaker: Padmasree Warrior\nCentre Stage, Altice Arena\nSession ID: WS2026-K08"
      }
    }
  }
]
```

### Conflict event (for S6 conditional path)
```json
{
  "eventId": "gcal-allhands-q4",
  "title": "All-Hands Q4 Planning",
  "startDate": "2026-11-11T14:00:00+00:00",
  "endDate": "2026-11-11T15:30:00+00:00",
  "attendeeCount": 12,
  "organizerIsUser": true,
  "isRecurring": false
}
```

Note: This overlaps session WS2026-K08 (Nov 11, 15:30), creating a partial conflict at the boundary. FE should display conflict indicator on that session row.

### Reminders — remind_me responses
```json
[
  {
    "verbId": "remind_me",
    "isConfident": true,
    "confidence": 0.97,
    "result": {
      "kind": "reminder",
      "payload": {
        "subject": "Pack for Lisbon + check-in opens",
        "contact": "Alex Chen",
        "dueAt": "2026-11-09T20:00:00-08:00",
        "ack": "Reminder set for Nov 9 at 8:00 PM PST"
      }
    }
  },
  {
    "verbId": "remind_me",
    "isConfident": true,
    "confidence": 0.96,
    "result": {
      "kind": "reminder",
      "payload": {
        "subject": "Leave for SFO — UA88 boards 09:00",
        "contact": "Alex Chen",
        "dueAt": "2026-11-10T05:30:00-08:00",
        "ack": "Reminder set for Nov 10 at 5:30 AM PST"
      }
    }
  }
]
```

### Day-of Plan — plan_my_day response
```json
{
  "verbId": "plan_my_day",
  "isConfident": true,
  "confidence": 0.94,
  "result": {
    "kind": "dayPlan",
    "payload": {
      "rankedPlan": [
        { "time": "06:00", "task": "Wake up + final packing", "priority": "high" },
        { "time": "06:45", "task": "Order Lyft to SFO (35 min, Terminal 2)", "priority": "critical" },
        { "time": "07:20", "task": "Arrive SFO — Delta Sky Club check-in", "priority": "high" },
        { "time": "09:00", "task": "Board UA88 — Seat 4A Business", "priority": "critical" },
        { "time": "10:10", "task": "Wheels up SFO → LIS (10.5h flight)", "priority": "info" },
        { "time": "17:45 WET", "task": "Land Lisbon — hotel transfer (taxi ~25 min)", "priority": "high" },
        { "time": "19:30 WET", "task": "Check in: Bairro Alto Hotel", "priority": "medium" },
        { "time": "20:00 WET", "task": "Web Summit welcome reception (optional)", "priority": "low" }
      ],
      "rationale": "Critical path: Lyft at 06:45 is the latest safe departure. International check-in closes 90 min before departure (22:10). Sky Club access allows lounge time if early."
    }
  },
  "warnings": []
}
```

---

## Acceptance Criteria (FE Checklist)

- [ ] All 9 screen states renderable without API calls (using fixture data above)
- [ ] Itinerary card grows at all 5 enrichment points with correct animation
- [ ] Every state maps to exactly one verb (or no call, as specified)
- [ ] Clarifying-question rule: FE checks `isConfident && confidence >= 0.7` before rendering question UI
- [ ] Conflict detection logic: client-side calendar overlap check for S6 conditional
- [ ] Motion: all animations use specified `cubic-bezier` or `ease-out`/`ease-in-out` curves and durations
- [ ] Progressive disclosure: all `[Details ↓]` toggles implemented per screen spec
- [ ] Fixture data matches `test-ceo` user persona (`userId: "test-ceo"`)
- [ ] Calendar sync confirmation bubble renders after S5 confirm (6-item list)
- [ ] S9 day-of plan fires at 06:00 local time (timer logic in FE, not a user action)
- [ ] `⚠ Verify` badge renders when `isConfident: false` on any verb response
- [ ] `Not now` in S1 dismisses flow; itinerary stub persists collapsed in chat history
- [ ] All deep-link taps (flight, hotel, calendar items) open in new tab / native app handler

---

*Spec version 1.0 — YOU-603 — 2026-05-21*
