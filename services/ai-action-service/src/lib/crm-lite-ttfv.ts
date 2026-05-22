const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets";

function base64url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf;
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function encodeJWTPart(obj: unknown): string {
  return base64url(new TextEncoder().encode(JSON.stringify(obj)));
}

async function getAccessToken(
  clientEmail: string,
  privateKeyPem: string,
  scope: string,
): Promise<string> {
  const pemBody = privateKeyPem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");
  const keyDer = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    keyDer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const now = Math.floor(Date.now() / 1000);
  const header = encodeJWTPart({ alg: "RS256", typ: "JWT" });
  const payload = encodeJWTPart({
    iss: clientEmail,
    scope,
    aud: GOOGLE_TOKEN_URL,
    iat: now,
    exp: now + 3600,
  });

  const sigInput = new TextEncoder().encode(`${header}.${payload}`);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", cryptoKey, sigInput);
  const jwt = `${header}.${payload}.${base64url(sig)}`;

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google token exchange failed: ${res.status} ${body}`);
  }

  const { access_token } = (await res.json()) as { access_token: string };
  return access_token;
}

export interface CRMLiteWriter {
  writeTTFV(params: {
    email: string;
    deliveredAt: string;
    intakeSubmittedAt: string;
  }): Promise<void>;
}

export class GoogleSheetsCRMLiteWriter implements CRMLiteWriter {
  private clientEmail: string;
  private privateKey: string;
  private spreadsheetId: string;

  constructor(credentials: Record<string, unknown>, spreadsheetId: string) {
    this.clientEmail = credentials["client_email"] as string;
    this.privateKey = credentials["private_key"] as string;
    this.spreadsheetId = spreadsheetId;
  }

  private async sheetsGet(token: string, range: string): Promise<unknown[][]> {
    const url = `${SHEETS_BASE}/${this.spreadsheetId}/values/${encodeURIComponent(range)}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      throw new Error(`Sheets GET failed: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as { values?: unknown[][] };
    return data.values ?? [];
  }

  private async sheetsUpdate(
    token: string,
    range: string,
    values: unknown[][],
  ): Promise<void> {
    const url = `${SHEETS_BASE}/${this.spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`;
    const res = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ values }),
    });
    if (!res.ok) {
      throw new Error(`Sheets PUT failed: ${res.status} ${await res.text()}`);
    }
  }

  async writeTTFV(params: {
    email: string;
    deliveredAt: string;
    intakeSubmittedAt: string;
  }): Promise<void> {
    const token = await getAccessToken(
      this.clientEmail,
      this.privateKey,
      "https://www.googleapis.com/auth/spreadsheets",
    );

    const intakeTime = new Date(params.intakeSubmittedAt).getTime();
    const deliveredTime = new Date(params.deliveredAt).getTime();
    const ttfvHours = parseFloat(
      ((deliveredTime - intakeTime) / (1000 * 60 * 60)).toFixed(2),
    );

    const rows = await this.sheetsGet(token, "Tracker!A:D");
    let rowIndex = -1;
    for (let i = 0; i < rows.length; i++) {
      if ((rows[i] as string[])?.[3]?.toLowerCase() === params.email.toLowerCase()) {
        rowIndex = i;
        break;
      }
    }

    if (rowIndex === -1) {
      throw new Error(`User not found in CRM-lite: ${params.email}`);
    }

    const existing = await this.sheetsGet(
      token,
      `Tracker!N${rowIndex + 1}:O${rowIndex + 1}`,
    );
    if (existing[0]?.[0]) {
      return; // first-write-wins
    }

    await this.sheetsUpdate(token, `Tracker!N${rowIndex + 1}:O${rowIndex + 1}`, [
      [params.deliveredAt, ttfvHours],
    ]);
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
