import type { DripStep } from "./templates";

type SheetsClient = Awaited<ReturnType<typeof buildSheetsClient>>;

async function buildSheetsClient(serviceAccountJson: string) {
  const { google } = await import("googleapis");
  const credentials = JSON.parse(
    Buffer.from(serviceAccountJson, "base64").toString("utf-8"),
  ) as Record<string, unknown>;
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

/** Reads all (email, step) pairs that have already been sent. */
export async function loadSentPairs(
  sheetsClient: SheetsClient,
  sheetId: string,
): Promise<Set<string>> {
  const res = await sheetsClient.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: "DripLog!A:B",
  });
  const rows = res.data.values ?? [];
  const sent = new Set<string>();
  for (const row of rows) {
    const email = (row[0] as string | undefined)?.toLowerCase().trim();
    const step = row[1] as string | undefined;
    if (email && step) sent.add(`${email}:${step}`);
  }
  return sent;
}

/** Appends a sent record to the DripLog tab. */
export async function recordSent(
  sheetsClient: SheetsClient,
  sheetId: string,
  email: string,
  step: DripStep,
  sentAt: string,
): Promise<void> {
  await sheetsClient.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: "DripLog",
    valueInputOption: "RAW",
    requestBody: { values: [[email.toLowerCase().trim(), String(step), sentAt]] },
  });
}

export { buildSheetsClient };
