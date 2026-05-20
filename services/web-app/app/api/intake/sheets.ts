import type { IntakePayload } from "./schema";

function isEnabled(): boolean {
  return (
    process.env.INTAKE_SHEETS_ENABLED === "true" &&
    Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_JSON) &&
    Boolean(process.env.INTAKE_SHEET_ID)
  );
}

export async function appendToSheet(data: IntakePayload): Promise<void> {
  if (!isEnabled()) return;

  const { google } = await import("googleapis");

  const serviceAccountJson = Buffer.from(
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON!,
    "base64",
  ).toString("utf-8");

  const credentials = JSON.parse(serviceAccountJson) as Record<string, unknown>;

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  const sheets = google.sheets({ version: "v4", auth });

  const empty = "";
  const row = [
    // A–I: intake fields
    data.submittedAt, // A intake_submitted_at
    data.firstName, // B first_name
    data.lastName, // C last_name
    data.email.toLowerCase(), // D email (lowercased for downstream lookup consistency)
    data.contactPreference, // E contact_preference
    JSON.stringify({ goals: data.goals, other: data.goalsOther ?? null }), // F goals_json
    JSON.stringify({ calendars: data.calendars, other: data.calendarsOther ?? null }), // G primary_calendar
    JSON.stringify({ tools: data.messagingTools, other: data.messagingOther ?? null }), // H primary_messaging_tool
    data.successCriterion, // I success_criterion
    // J–K: user/company (populated by other systems)
    empty, // J company
    empty, // K user_id
    // L–M: CRM-lite stage metadata
    "intake", // L stage
    "CEO", // M owner
    // N–W: kickoff/TTFV/day7/day30/blocker (written by other systems)
    empty,
    empty,
    empty,
    empty,
    empty,
    empty,
    empty,
    empty,
    empty,
    empty, // N–W (10 cols)
    // X–Y
    data.submittedAt, // X last_touch_at
    empty, // Y notes
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.INTAKE_SHEET_ID!,
    range: "Tracker!A:Y",
    valueInputOption: "RAW",
    requestBody: { values: [row] },
  });
}
