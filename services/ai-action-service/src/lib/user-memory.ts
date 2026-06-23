/**
 * YOU-893: Concierge user memory — per-user trip history + preference signals.
 *
 * KV layout (CONCIERGE_KV):
 *   concierge:user:{userId}:profile  → UserProfile   (mutable prefs)
 *   concierge:user:{userId}:trips    → TripEntry[]   (capped at MAX_TRIPS)
 *
 * All writes are best-effort; failures are logged but never surface to the user.
 */

import type { Itinerary } from "./itinerary-types.js";

export interface UserPreferences {
  pace?: "relaxed" | "active" | "intense";
  budgetBand?: string;
  interests?: string[];
  dietaryPrefs?: string[];
  travelStyle?: string;
  /** Home airport IATA code or city, e.g. "CPH" or "Copenhagen" */
  homeAirport?: string;
  airline?: string;
  seatPreference?: string;
  hotelChain?: string;
  cabinClass?: string;
  firstName?: string;
}

export interface TripEntry {
  tripId: string; // deterministic: destination+savedAt slug
  destination: string;
  dates: string;
  summary: string;
  savedAt: string; // ISO-8601
  highlightVenues: string[]; // populated from itinerary items at save time
}

export interface UserProfile {
  userId: string;
  prefs: UserPreferences;
  trips: TripEntry[];
}

/** Response shape surfaced to the FE (YOU-896). */
export interface UserProfileResponse {
  userId: string;
  firstName: string;
  isReturning: boolean;
  tripHistory: {
    tripId: string;
    destination: string;
    dates: string;
    highlightVenues: string[];
  }[];
  preferences: {
    airline: string;
    seatPreference: string;
    hotelChain: string;
    cabinClass: string;
    homeAirport: string;
    travelStyle: string;
    dietaryPrefs: string[];
    pace: string;
    budgetBand: string;
    interests: string[];
  };
}

/** Map internal UserProfile to the FE response contract. */
export function toProfileResponse(profile: UserProfile): UserProfileResponse {
  const p = profile.prefs;
  return {
    userId: profile.userId,
    firstName: p.firstName ?? "",
    isReturning: profile.trips.length > 0,
    tripHistory: profile.trips.map((t) => ({
      tripId: t.tripId,
      destination: t.destination,
      dates: t.dates,
      highlightVenues: t.highlightVenues,
    })),
    preferences: {
      airline: p.airline ?? "",
      seatPreference: p.seatPreference ?? "",
      hotelChain: p.hotelChain ?? "",
      cabinClass: p.cabinClass ?? "",
      homeAirport: p.homeAirport ?? "",
      travelStyle: p.travelStyle ?? "",
      dietaryPrefs: p.dietaryPrefs ?? [],
      pace: p.pace ?? "",
      budgetBand: p.budgetBand ?? "",
      interests: p.interests ?? [],
    },
  };
}

const MAX_TRIPS = 10;

function profileKey(userId: string): string {
  return `concierge:user:${userId}:profile`;
}

export async function getUserProfile(
  kv: KVNamespace,
  userId: string,
): Promise<UserProfile | null> {
  try {
    return await kv.get<UserProfile>(profileKey(userId), "json");
  } catch (err) {
    console.error(`[user-memory] getUserProfile error for ${userId}:`, err);
    return null;
  }
}

export async function saveTrip(
  kv: KVNamespace,
  userId: string,
  itinerary: Itinerary,
): Promise<void> {
  try {
    const existing = (await kv.get<UserProfile>(profileKey(userId), "json")) ?? {
      userId,
      prefs: {},
      trips: [],
    };

    const savedAt = new Date().toISOString();
    const tripId = `${itinerary.destination.toLowerCase().replace(/\s+/g, "-")}-${savedAt.slice(0, 10)}`;
    const highlightVenues = itinerary.days
      .flatMap((d) => d.items.map((i) => i.title))
      .slice(0, 5);
    const entry: TripEntry = {
      tripId,
      destination: itinerary.destination,
      dates: itinerary.dates,
      summary: itinerary.summary,
      savedAt,
      highlightVenues,
    };

    const trips = [entry, ...existing.trips].slice(0, MAX_TRIPS);
    const updated: UserProfile = { ...existing, userId, trips };

    await kv.put(profileKey(userId), JSON.stringify(updated), {
      expirationTtl: 60 * 60 * 24 * 365, // 1 year
    });
  } catch (err) {
    console.error(`[user-memory] saveTrip error for ${userId}:`, err);
  }
}

export async function savePreferences(
  kv: KVNamespace,
  userId: string,
  prefs: Partial<UserPreferences>,
): Promise<void> {
  try {
    const existing = (await kv.get<UserProfile>(profileKey(userId), "json")) ?? {
      userId,
      prefs: {},
      trips: [],
    };

    const updated: UserProfile = {
      ...existing,
      userId,
      prefs: { ...existing.prefs, ...prefs },
    };

    await kv.put(profileKey(userId), JSON.stringify(updated), {
      expirationTtl: 60 * 60 * 24 * 365,
    });
  } catch (err) {
    console.error(`[user-memory] savePreferences error for ${userId}:`, err);
  }
}

/**
 * Build a system-prompt context block for a returning user.
 * Returns empty string when the profile is null or has no meaningful data.
 */
export function buildMemoryContext(profile: UserProfile | null): string {
  if (!profile) return "";

  const parts: string[] = [];

  if (profile.trips.length > 0) {
    const tripLines = profile.trips
      .slice(0, 5)
      .map((t) => `- ${t.destination} (${t.dates}): ${t.summary}`)
      .join("\n");
    parts.push(`## Prior trips\n${tripLines}`);
  }

  const p = profile.prefs;
  const prefLines: string[] = [];
  if (p.pace) prefLines.push(`pace: ${p.pace}`);
  if (p.budgetBand) prefLines.push(`budget: ${p.budgetBand}`);
  if (p.travelStyle) prefLines.push(`style: ${p.travelStyle}`);
  if (p.interests?.length) prefLines.push(`interests: ${p.interests.join(", ")}`);
  if (p.dietaryPrefs?.length) prefLines.push(`dietary: ${p.dietaryPrefs.join(", ")}`);
  if (p.homeAirport) prefLines.push(`home airport: ${p.homeAirport}`);

  if (prefLines.length > 0) {
    parts.push(`## Stated preferences\n${prefLines.join("\n")}`);
  }

  if (parts.length === 0) return "";

  return `\n\n## Returning traveler — known history\nThis user has traveled with you before. Reference this naturally when tailoring the itinerary:\n\n${parts.join("\n\n")}`;
}
