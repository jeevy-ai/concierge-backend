import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const appendMock = vi.fn();

vi.mock("googleapis", () => ({
  google: {
    auth: {
      GoogleAuth: vi.fn().mockImplementation(() => ({})),
    },
    sheets: vi.fn().mockReturnValue({
      spreadsheets: {
        values: {
          append: appendMock,
        },
      },
    }),
  },
}));

import { appendToSheet } from "../sheets";

const PAYLOAD = {
  submittedAt: "2026-05-07T12:34:56Z",
  firstName: "Jane",
  lastName: "Doe",
  email: "Jane@Example.COM",
  contactPreference: "pref_email_link" as const,
  goals: ["Zero scheduling back-and-forth"],
  goalsOther: "custom goal",
  calendars: ["Google Calendar"],
  calendarsOther: "Fantastical",
  messagingTools: ["Slack"],
  messagingOther: "Teams",
  successCriterion: "No double-bookings and 3 hours of deep work per day",
};

describe("appendToSheet row shape", () => {
  beforeEach(() => {
    process.env.INTAKE_SHEETS_ENABLED = "true";
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = Buffer.from('{"type":"service_account"}').toString(
      "base64",
    );
    process.env.INTAKE_SHEET_ID = "test-sheet-id";
    appendMock.mockResolvedValue({});
  });

  afterEach(() => {
    process.env.INTAKE_SHEETS_ENABLED = undefined;
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = undefined;
    process.env.INTAKE_SHEET_ID = undefined;
    vi.clearAllMocks();
  });

  it("appends to Tracker!A:Y range", async () => {
    await appendToSheet(PAYLOAD);

    const call = appendMock.mock.calls[0][0] as { range: string };
    expect(call.range).toBe("Tracker!A:Y");
  });

  it("writes exactly 25 columns", async () => {
    await appendToSheet(PAYLOAD);

    const call = appendMock.mock.calls[0][0] as { requestBody: { values: unknown[][] } };
    const row = call.requestBody.values[0];
    expect(row).toHaveLength(25);
  });

  it("lowercases email (col D, index 3)", async () => {
    await appendToSheet(PAYLOAD);

    const call = appendMock.mock.calls[0][0] as { requestBody: { values: unknown[][] } };
    const row = call.requestBody.values[0];
    expect(row[3]).toBe("jane@example.com");
  });

  it("sets stage=intake (col L, index 11)", async () => {
    await appendToSheet(PAYLOAD);

    const call = appendMock.mock.calls[0][0] as { requestBody: { values: unknown[][] } };
    const row = call.requestBody.values[0];
    expect(row[11]).toBe("intake");
  });

  it("sets owner=CEO (col M, index 12)", async () => {
    await appendToSheet(PAYLOAD);

    const call = appendMock.mock.calls[0][0] as { requestBody: { values: unknown[][] } };
    const row = call.requestBody.values[0];
    expect(row[12]).toBe("CEO");
  });

  it("sets last_touch_at=submittedAt (col X, index 23)", async () => {
    await appendToSheet(PAYLOAD);

    const call = appendMock.mock.calls[0][0] as { requestBody: { values: unknown[][] } };
    const row = call.requestBody.values[0];
    expect(row[23]).toBe(PAYLOAD.submittedAt);
  });

  it("serializes goals with other field (col F, index 5)", async () => {
    await appendToSheet(PAYLOAD);

    const call = appendMock.mock.calls[0][0] as { requestBody: { values: unknown[][] } };
    const row = call.requestBody.values[0];
    expect(row[5]).toBe(JSON.stringify({ goals: PAYLOAD.goals, other: "custom goal" }));
  });

  it("serializes calendars with other field (col G, index 6)", async () => {
    await appendToSheet(PAYLOAD);

    const call = appendMock.mock.calls[0][0] as { requestBody: { values: unknown[][] } };
    const row = call.requestBody.values[0];
    expect(row[6]).toBe(JSON.stringify({ calendars: PAYLOAD.calendars, other: "Fantastical" }));
  });

  it("serializes messaging tools with other field (col H, index 7)", async () => {
    await appendToSheet(PAYLOAD);

    const call = appendMock.mock.calls[0][0] as { requestBody: { values: unknown[][] } };
    const row = call.requestBody.values[0];
    expect(row[7]).toBe(JSON.stringify({ tools: PAYLOAD.messagingTools, other: "Teams" }));
  });

  it("uses null for missing optional *Other fields", async () => {
    const payloadNoOthers = {
      ...PAYLOAD,
      goalsOther: undefined,
      calendarsOther: undefined,
      messagingOther: undefined,
    };

    await appendToSheet(payloadNoOthers);

    const call = appendMock.mock.calls[0][0] as { requestBody: { values: unknown[][] } };
    const row = call.requestBody.values[0];
    expect(row[5]).toBe(JSON.stringify({ goals: PAYLOAD.goals, other: null }));
    expect(row[6]).toBe(JSON.stringify({ calendars: PAYLOAD.calendars, other: null }));
    expect(row[7]).toBe(JSON.stringify({ tools: PAYLOAD.messagingTools, other: null }));
  });

  it("does nothing when INTAKE_SHEETS_ENABLED is not true", async () => {
    process.env.INTAKE_SHEETS_ENABLED = "false";

    await appendToSheet(PAYLOAD);

    expect(appendMock).not.toHaveBeenCalled();
  });
});
