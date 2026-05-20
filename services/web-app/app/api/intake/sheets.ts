import type { IntakePayload } from './schema';

function isEnabled(): boolean {
  return (
    process.env['INTAKE_SHEETS_ENABLED'] === 'true' &&
    Boolean(process.env['GOOGLE_SERVICE_ACCOUNT_JSON']) &&
    Boolean(process.env['INTAKE_SHEET_ID'])
  );
}

export async function appendToSheet(data: IntakePayload): Promise<void> {
  if (!isEnabled()) return;

  const { google } = await import('googleapis');

  const serviceAccountJson = Buffer.from(
    process.env['GOOGLE_SERVICE_ACCOUNT_JSON']!,
    'base64',
  ).toString('utf-8');

  const credentials = JSON.parse(serviceAccountJson) as Record<string, unknown>;

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const sheets = google.sheets({ version: 'v4', auth });

  const row = [
    data.submittedAt,
    data.firstName,
    data.lastName,
    data.email,
    data.contactPreference,
    JSON.stringify(data.goals),
    JSON.stringify(data.calendars),
    JSON.stringify(data.messagingTools),
    data.successCriterion,
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env['INTAKE_SHEET_ID']!,
    range: 'Sheet1',
    valueInputOption: 'RAW',
    requestBody: { values: [row] },
  });
}
