import { google } from "googleapis";

export interface CRMLiteWriter {
  writeTTFV(params: {
    email: string;
    deliveredAt: string;
    intakeSubmittedAt: string;
  }): Promise<void>;
}

export class GoogleSheetsCRMLiteWriter implements CRMLiteWriter {
  private auth: any;
  private spreadsheetId: string;

  constructor(credentials: Record<string, unknown>, spreadsheetId: string) {
    this.auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    this.spreadsheetId = spreadsheetId;
  }

  async writeTTFV(params: {
    email: string;
    deliveredAt: string;
    intakeSubmittedAt: string;
  }): Promise<void> {
    const sheetsAPI = google.sheets({ version: "v4", auth: this.auth });

    const intakeTime = new Date(params.intakeSubmittedAt).getTime();
    const deliveredTime = new Date(params.deliveredAt).getTime();
    const ttfvMs = deliveredTime - intakeTime;
    const ttfvHours = parseFloat((ttfvMs / (1000 * 60 * 60)).toFixed(2));

    // Find row by email and update first_action_delivered_at (column N) and ttfv_hours (column O)
    const response = await sheetsAPI.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: "Tracker!A:D",
    });

    const rows = response.data.values || [];
    let rowIndex = -1;

    for (let i = 0; i < rows.length; i++) {
      if (rows[i]?.[3]?.toLowerCase() === params.email.toLowerCase()) {
        rowIndex = i;
        break;
      }
    }

    if (rowIndex === -1) {
      throw new Error(`User not found in CRM-lite: ${params.email}`);
    }

    // Check if first_action_delivered_at is already set (first-write-wins)
    const existingRow = await sheetsAPI.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: `Tracker!N${rowIndex + 1}:O${rowIndex + 1}`,
    });

    const existingValue = existingRow.data.values?.[0]?.[0];
    if (existingValue) {
      // Already set, skip (first-write-wins)
      return;
    }

    // Write first_action_delivered_at (column N) and ttfv_hours (column O)
    await sheetsAPI.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range: `Tracker!N${rowIndex + 1}:O${rowIndex + 1}`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[params.deliveredAt, ttfvHours]],
      },
    });
  }
}

export function getCRMLiteWriter(env: {
  GOOGLE_SERVICE_ACCOUNT_JSON?: string;
  INTAKE_SHEET_ID?: string;
}): CRMLiteWriter | null {
  if (!env.GOOGLE_SERVICE_ACCOUNT_JSON || !env.INTAKE_SHEET_ID) {
    return null;
  }

  const serviceAccountJson = Buffer.from(
    env.GOOGLE_SERVICE_ACCOUNT_JSON,
    "base64",
  ).toString("utf-8");

  const credentials = JSON.parse(serviceAccountJson);

  return new GoogleSheetsCRMLiteWriter(credentials, env.INTAKE_SHEET_ID);
}
