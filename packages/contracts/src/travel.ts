/**
 * Travel adapter types — YOU-13 §8.
 * Covers fixture cases TRV-01..05 from the you31-dryrun-2026-05-03 pack.
 */

export type TravelBookingId = string;

export type TravelSegment = {
  type: "flight" | "hotel" | "car" | "rail";
  origin?: string | undefined;
  destination?: string | undefined;
  departureIso?: string | undefined;
  arrivalIso?: string | undefined;
  confirmationCode?: string | undefined;
};

export type TravelBooking = {
  id: TravelBookingId;
  travelerEmail: string;
  segments: TravelSegment[];
  status: "confirmed" | "cancelled" | "modified";
};

export type TravelRebookRequest = {
  bookingId: TravelBookingId;
  reason: string;
  preferredDepartureIso?: string | undefined;
  correlationId: string;
};

export type TravelRebookResult =
  | { ok: true; updatedBooking: TravelBooking }
  | { ok: false; error: string };

export type TravelAdapter = {
  getBooking(bookingId: TravelBookingId): Promise<TravelBooking>;
  rebook(req: TravelRebookRequest): Promise<TravelRebookResult>;
};
