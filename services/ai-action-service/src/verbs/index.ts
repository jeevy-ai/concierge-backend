import { book_reservation } from "./book_reservation.js";
import { errand_request } from "./errand_request.js";
import { plan_my_day } from "./plan_my_day.js";
import { remind_me } from "./remind_me.js";
import { schedule_meeting } from "./schedule_meeting.js";
import type { ConciergeVerbDef } from "./_shared.js";

export const VERBS: Readonly<Record<string, ConciergeVerbDef>> = Object.freeze({
  book_reservation,
  schedule_meeting,
  plan_my_day,
  remind_me,
  errand_request,
});

export const VERB_IDS: readonly string[] = Object.freeze(Object.keys(VERBS));
