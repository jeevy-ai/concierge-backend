/**
 * YOU-913: Neon-backed per-account butler persistence.
 * Maps to YOU-4: "butler that grows with you" — durable per-user memory.
 *
 * Replaces the KV-backed user-memory.ts demo store with durable Postgres via
 * the Neon serverless HTTP driver (works in CF Workers, no TCP required).
 *
 * Schema: db/schema.sql
 */

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

export interface UserPreferences {
  pace?: "relaxed" | "active" | "intense";
  budgetBand?: string;
  interests?: string[];
  dietaryPrefs?: string[];
  travelStyle?: string;
  homeAirport?: string;
  airline?: string;
  seatPreference?: string;
  hotelChain?: string;
  cabinClass?: string;
  firstName?: string;
}

export interface TripEntry {
  tripId: string;
  destination: string;
  dates: string;
  summary: string;
  savedAt: string;
  highlightVenues: string[];
}

export interface UserProfile {
  userId: string;
  prefs: UserPreferences;
  trips: TripEntry[];
}

/** FE-facing contract (documented in YOU-913 comment for YOU-914). */
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

// Default neon() mode: rows as objects, no full result metadata
type SqlClient = NeonQueryFunction<false, false>;

export async function getProfile(
  sql: SqlClient,
  userId: string,
): Promise<UserProfile | null> {
  const rows = await sql`
    SELECT bp.clerk_user_id, bp.first_name, bp.prefs,
           COALESCE(
             json_agg(
               json_build_object(
                 'tripId', bt.trip_id,
                 'destination', bt.destination,
                 'dates', bt.dates,
                 'summary', bt.summary,
                 'savedAt', bt.saved_at,
                 'highlightVenues', bt.highlight_venues
               ) ORDER BY bt.saved_at DESC
             ) FILTER (WHERE bt.trip_id IS NOT NULL),
             '[]'::json
           ) AS trips
    FROM butler_profiles bp
    LEFT JOIN butler_trips bt ON bt.clerk_user_id = bp.clerk_user_id
    WHERE bp.clerk_user_id = ${userId}
    GROUP BY bp.clerk_user_id, bp.first_name, bp.prefs
  `;
  const row = rows[0];
  if (!row) return null;

  return {
    userId: row["clerk_user_id"] as string,
    prefs: {
      ...(row["prefs"] as UserPreferences),
      ...(row["first_name"] ? { firstName: row["first_name"] as string } : {}),
    },
    trips: row["trips"] as TripEntry[],
  };
}

export async function upsertPreferences(
  sql: SqlClient,
  userId: string,
  prefs: Partial<UserPreferences>,
): Promise<void> {
  const { firstName, ...restPrefs } = prefs;
  await sql`
    INSERT INTO butler_profiles (clerk_user_id, first_name, prefs)
    VALUES (
      ${userId},
      ${firstName ?? null},
      ${JSON.stringify(restPrefs)}::jsonb
    )
    ON CONFLICT (clerk_user_id) DO UPDATE
      SET first_name = COALESCE(EXCLUDED.first_name, butler_profiles.first_name),
          prefs      = butler_profiles.prefs || EXCLUDED.prefs
  `;
}

const MAX_TRIPS = 10;

export async function saveTrip(
  sql: SqlClient,
  userId: string,
  itinerary: { destination: string; dates: string; summary: string; days: Array<{ items: Array<{ title: string }> }> },
): Promise<void> {
  // Ensure profile row exists first (upsert with no-op on prefs)
  await sql`
    INSERT INTO butler_profiles (clerk_user_id, prefs)
    VALUES (${userId}, '{}'::jsonb)
    ON CONFLICT (clerk_user_id) DO NOTHING
  `;

  const savedAt = new Date().toISOString();
  const tripId = `${itinerary.destination.toLowerCase().replace(/\s+/g, "-")}-${savedAt.slice(0, 10)}`;
  const highlightVenues = itinerary.days
    .flatMap((d) => d.items.map((i) => i.title))
    .slice(0, 5);

  await sql`
    INSERT INTO butler_trips
      (clerk_user_id, trip_id, destination, dates, summary, highlight_venues, saved_at)
    VALUES (
      ${userId}, ${tripId}, ${itinerary.destination},
      ${itinerary.dates}, ${itinerary.summary},
      ${highlightVenues}, ${savedAt}
    )
    ON CONFLICT (clerk_user_id, trip_id) DO NOTHING
  `;

  // Cap at MAX_TRIPS oldest entries
  await sql`
    DELETE FROM butler_trips
    WHERE clerk_user_id = ${userId}
      AND id NOT IN (
        SELECT id FROM butler_trips
        WHERE clerk_user_id = ${userId}
        ORDER BY saved_at DESC
        LIMIT ${MAX_TRIPS}
      )
  `;
}

/**
 * Build system-prompt memory block for a returning user.
 * Empty string when no meaningful data exists.
 */
export function buildMemoryContext(profile: UserProfile | null): string {
  if (!profile) return "";

  const parts: string[] = [];

  if (profile.trips.length > 0) {
    const lines = profile.trips
      .slice(0, 5)
      .map((t) => `- ${t.destination} (${t.dates}): ${t.summary}`)
      .join("\n");
    parts.push(`## Prior trips\n${lines}`);
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
