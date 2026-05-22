import { describe, expect, it } from "vitest";
import { daysSinceSignup, formatProposedTime, renderReminder } from "../templates";

describe("daysSinceSignup", () => {
  const signup = new Date("2026-01-01T10:00:00Z");

  it("returns 1 on the day of signup", () => {
    expect(daysSinceSignup(signup, new Date("2026-01-01T23:59:00Z"))).toBe(1);
  });

  it("returns 6 five days after signup (triggers day-7 email)", () => {
    expect(daysSinceSignup(signup, new Date("2026-01-06T09:00:00Z"))).toBe(6);
  });

  it("returns 29 twenty-eight days after signup (triggers day-30 email)", () => {
    expect(daysSinceSignup(signup, new Date("2026-01-29T09:00:00Z"))).toBe(29);
  });

  it("does not trigger on day 7 or day 30 directly", () => {
    expect(daysSinceSignup(signup, new Date("2026-01-07T09:00:00Z"))).toBe(7);
    expect(daysSinceSignup(signup, new Date("2026-01-30T09:00:00Z"))).toBe(30);
  });
});

describe("renderReminder — day7", () => {
  const vars = {
    firstName: "Alice",
    product: "Jeevy",
    founderName: "Noah",
    proposedTime: "Wednesday, January 7th at 10:00 AM CET",
  };

  it("has correct subject", () => {
    const { subject } = renderReminder("day7", vars);
    expect(subject).toBe("Your first week check-in — 15 min tomorrow?");
  });

  it("body contains first name", () => {
    const { text } = renderReminder("day7", vars);
    expect(text).toContain("Hi Alice,");
  });

  it("body contains product name", () => {
    const { text } = renderReminder("day7", vars);
    expect(text).toContain("Jeevy");
  });

  it("body contains proposed time when provided", () => {
    const { text } = renderReminder("day7", vars);
    expect(text).toContain("Wednesday, January 7th at 10:00 AM CET");
  });

  it("omits proposed time when undefined and uses fallback phrasing", () => {
    const { text } = renderReminder("day7", { ...vars, proposedTime: undefined });
    expect(text).not.toContain("Wednesday");
    expect(text).toContain("reply to find a time");
  });

  it("ends with founder name", () => {
    const { text } = renderReminder("day7", vars);
    expect(text.trimEnd()).toMatch(/Noah$/);
  });
});

describe("renderReminder — day30", () => {
  const vars = {
    firstName: "Bob",
    product: "Jeevy",
    founderName: "Noah",
    proposedTime: "Tuesday, February 3rd at 10:00 AM CET",
  };

  it("has correct subject", () => {
    const { subject } = renderReminder("day30", vars);
    expect(subject).toBe("Your 30-day check-in — 15 min tomorrow?");
  });

  it("body contains first name", () => {
    const { text } = renderReminder("day30", vars);
    expect(text).toContain("Hi Bob,");
  });

  it("body contains proposed time when provided", () => {
    const { text } = renderReminder("day30", vars);
    expect(text).toContain("Tuesday, February 3rd at 10:00 AM CET");
  });

  it("omits proposed time when undefined", () => {
    const { text } = renderReminder("day30", { ...vars, proposedTime: undefined });
    expect(text).not.toContain("Tuesday");
    expect(text).toContain("Reply and we'll find a time that works.");
  });
});

describe("formatProposedTime", () => {
  const now = new Date("2026-01-06T14:00:00Z");

  it("returns undefined for undefined timezone", () => {
    expect(formatProposedTime(now, undefined)).toBeUndefined();
  });

  it("returns undefined for invalid timezone", () => {
    expect(formatProposedTime(now, "Not/ATimezone")).toBeUndefined();
  });

  it("returns a formatted string for a valid timezone", () => {
    const result = formatProposedTime(now, "Europe/Copenhagen");
    expect(result).toBeDefined();
    expect(typeof result).toBe("string");
    expect(result).toContain("10:00 AM");
  });
});
