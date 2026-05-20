import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { daysSinceSignup } from '../reminder/templates';
import { DRIP_SCHEDULE, renderDrip, type DripStep } from './templates';
import { buildSheetsClient, loadSentPairs, recordSent } from './drip-log';

interface ClerkEmailAddress {
  email_address: string;
}

interface ClerkUser {
  id: string;
  first_name: string | null;
  email_addresses: ClerkEmailAddress[];
  created_at: number;
}

interface Lead {
  email: string;
  firstName: string;
  signedUpAt: Date;
  /** free_trial users who converted may be suppressed from Email 5 in future. */
  source: 'waitlist' | 'free_trial';
}

async function fetchClerkUsers(secretKey: string): Promise<ClerkUser[]> {
  const users: ClerkUser[] = [];
  let offset = 0;
  const limit = 100;
  while (true) {
    const res = await fetch(
      `https://api.clerk.com/v1/users?limit=${limit}&offset=${offset}`,
      { headers: { Authorization: `Bearer ${secretKey}` } },
    );
    if (!res.ok) throw new Error(`Clerk API ${res.status}: ${await res.text()}`);
    const batch = (await res.json()) as ClerkUser[];
    users.push(...batch);
    if (batch.length < limit) break;
    offset += limit;
  }
  return users;
}

async function fetchWaitlistLeads(
  serviceAccountJson: string,
  sheetId: string,
): Promise<Lead[]> {
  const { google } = await import('googleapis');
  const credentials = JSON.parse(
    Buffer.from(serviceAccountJson, 'base64').toString('utf-8'),
  ) as Record<string, unknown>;
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheets = google.sheets({ version: 'v4', auth });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: 'Sheet1!A:D',
  });
  const rows = res.data.values ?? [];
  const leads: Lead[] = [];
  for (const row of rows) {
    const submittedAt = row[0] as string | undefined;
    const firstName = (row[1] as string | undefined) ?? 'there';
    const email = row[3] as string | undefined;
    if (!submittedAt || !email) continue;
    const parsed = new Date(submittedAt);
    if (isNaN(parsed.getTime())) continue;
    leads.push({ email: email.toLowerCase().trim(), firstName, signedUpAt: parsed, source: 'waitlist' });
  }
  return leads;
}

export async function GET(request: Request): Promise<NextResponse> {
  const cronSecret = process.env['CRON_SECRET'];
  if (cronSecret) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const resendApiKey = process.env['RESEND_API_KEY'];
  const productDomain = process.env['PRODUCT_DOMAIN'] ?? 'jeevy.ai';
  const fromAddress = `Jeevy <hello@${productDomain}>`;
  const pricing = process.env['DRIP_EMAIL5_PRICING'];
  const sheetId = process.env['INTAKE_SHEET_ID'];
  const serviceAccountJson = process.env['GOOGLE_SERVICE_ACCOUNT_JSON'];
  const clerkSecretKey = process.env['CLERK_SECRET_KEY'];
  const sheetsEnabled =
    process.env['INTAKE_SHEETS_ENABLED'] === 'true' && serviceAccountJson && sheetId;

  if (!resendApiKey) {
    console.error('[drip-cron] missing RESEND_API_KEY');
    return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 });
  }
  if (!sheetsEnabled) {
    console.error('[drip-cron] Sheets not enabled — set INTAKE_SHEETS_ENABLED, GOOGLE_SERVICE_ACCOUNT_JSON, INTAKE_SHEET_ID');
    return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 });
  }

  const now = new Date();
  const resend = new Resend(resendApiKey);
  const sheetsClient = await buildSheetsClient(serviceAccountJson!);

  // Build lead list from waitlist (Sheets) + free-trial (Clerk), deduped by email
  const leadMap = new Map<string, Lead>();

  const waitlistLeads = await fetchWaitlistLeads(serviceAccountJson!, sheetId!);
  for (const lead of waitlistLeads) {
    leadMap.set(lead.email, lead);
  }

  if (clerkSecretKey) {
    const clerkUsers = await fetchClerkUsers(clerkSecretKey).catch((err) => {
      console.error('[drip-cron] Clerk fetch failed (non-fatal)', err);
      return [] as ClerkUser[];
    });
    for (const user of clerkUsers) {
      const email = user.email_addresses[0]?.email_address?.toLowerCase().trim();
      if (!email) continue;
      const signedUpAt = new Date(user.created_at);
      const existing = leadMap.get(email);
      // Keep earliest signup date; prefer waitlist source if duplicate
      if (!existing || signedUpAt < existing.signedUpAt) {
        leadMap.set(email, {
          email,
          firstName: user.first_name ?? email.split('@')[0] ?? 'there',
          signedUpAt,
          source: 'free_trial',
        });
      }
    }
  }

  const sentPairs = await loadSentPairs(sheetsClient, sheetId!);

  const results: { email: string; step: DripStep | 'skip'; error?: string }[] = [];

  for (const lead of leadMap.values()) {
    const day = daysSinceSignup(lead.signedUpAt, now);

    let stepDue: DripStep | null = null;
    for (const [s, triggerDay] of Object.entries(DRIP_SCHEDULE) as [string, number][]) {
      if (day === triggerDay) {
        stepDue = Number(s) as DripStep;
        break;
      }
    }

    if (stepDue === null) {
      results.push({ email: lead.email, step: 'skip' });
      continue;
    }

    // Email 5 requires confirmed pricing
    if (stepDue === 5 && !pricing) {
      console.warn(`[drip-cron] skipping Email 5 for ${lead.email} — DRIP_EMAIL5_PRICING not set (YOU-363 pending)`);
      results.push({ email: lead.email, step: 'skip' });
      continue;
    }

    const pairKey = `${lead.email}:${stepDue}`;
    if (sentPairs.has(pairKey)) {
      results.push({ email: lead.email, step: 'skip' });
      continue;
    }

    const { subject, text } = renderDrip(stepDue, {
      firstName: lead.firstName,
      productDomain,
      pricing,
    });

    try {
      const { error } = await resend.emails.send({
        from: fromAddress,
        to: lead.email,
        subject,
        text,
        tags: [
          { name: 'campaign', value: 'drip-v1' },
          { name: 'step', value: String(stepDue) },
          { name: 'source', value: lead.source },
        ],
      });
      if (error) throw new Error(error.message);

      const sentAt = now.toISOString();
      await recordSent(sheetsClient, sheetId!, lead.email, stepDue, sentAt);
      sentPairs.add(pairKey);

      results.push({ email: lead.email, step: stepDue });
      console.log(`[drip-cron] sent step ${stepDue} to ${lead.email} (day ${day})`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ email: lead.email, step: stepDue, error: msg });
      console.error(`[drip-cron] failed step ${stepDue} for ${lead.email}:`, msg);
    }
  }

  const sent = results.filter((r) => r.step !== 'skip' && !r.error).length;
  const failed = results.filter((r) => r.error).length;
  console.log(`[drip-cron] done. sent=${sent} failed=${failed} total=${leadMap.size}`);

  return NextResponse.json({ ok: true, sent, failed, total: leadMap.size });
}
