import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { sendIntakeNotification, appendToSheet } = vi.hoisted(() => ({
  sendIntakeNotification: vi.fn(),
  appendToSheet: vi.fn(),
}));

vi.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: ResponseInit) =>
      new Response(JSON.stringify(body), {
        ...init,
        headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
      }),
  },
}));

vi.mock('../notify', () => ({ sendIntakeNotification }));
vi.mock('../sheets', () => ({ appendToSheet }));

import { POST } from '../route';

const VALID_PAYLOAD = {
  goals: ['Zero scheduling back-and-forth'],
  calendars: ['Google Calendar'],
  messagingTools: ['Slack'],
  successCriterion: 'No double-bookings and 3 hours of deep work per day',
  firstName: 'Jane',
  lastName: 'Doe',
  email: 'jane@example.com',
  contactPreference: 'pref_email_link',
  submittedAt: '2026-05-07T12:34:56Z',
};

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/intake', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function callPost(body: unknown) {
  const res = await POST(makeRequest(body));
  const json = (await res.json()) as unknown;
  return { status: res.status, json };
}

describe('POST /api/intake', () => {
  beforeEach(() => {
    sendIntakeNotification.mockResolvedValue(undefined);
    appendToSheet.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns 200 { ok: true } for a valid payload', async () => {
    const { status, json } = await callPost(VALID_PAYLOAD);

    expect(status).toBe(200);
    expect(json).toEqual({ ok: true });
    expect(sendIntakeNotification).toHaveBeenCalledOnce();
    expect(appendToSheet).toHaveBeenCalledOnce();
  });


  it('returns 400 with field errors for an invalid payload', async () => {
    const invalid = { ...VALID_PAYLOAD, email: 'not-an-email', goals: [] };
    const { status, json } = await callPost(invalid);

    expect(status).toBe(400);
    expect((json as { error: string }).error).toBe('Validation failed');
    const fields = (json as { fields: Record<string, string> }).fields;
    expect(fields).toHaveProperty('email');
    expect(fields).toHaveProperty('goals');
    expect(sendIntakeNotification).not.toHaveBeenCalled();
  });

  it('returns 400 for non-JSON body', async () => {
    const req = new Request('http://localhost/api/intake', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'not json',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 200 when INTAKE_SHEETS_ENABLED is unset (sheets silently skipped)', async () => {
    const { status, json } = await callPost(VALID_PAYLOAD);
    expect(status).toBe(200);
    expect(json).toEqual({ ok: true });
  });

  it('returns 500 when email send fails and logs payload to stderr', async () => {
    sendIntakeNotification.mockRejectedValue(new Error('smtp error'));

    const stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const { status, json } = await callPost(VALID_PAYLOAD);

    expect(status).toBe(500);
    expect((json as { error: string }).error).toBe('Failed to send notification');

    const logged = stderrSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toContain('[intake] email send failed');

    stderrSpy.mockRestore();
  });

  it('returns 200 when sheets append fails after email succeeds', async () => {
    appendToSheet.mockRejectedValue(new Error('sheets error'));

    const stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const { status, json } = await callPost(VALID_PAYLOAD);

    expect(status).toBe(200);
    expect(json).toEqual({ ok: true });

    const logged = stderrSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toContain('[intake] sheets append failed (non-fatal)');

    stderrSpy.mockRestore();
  });
});
