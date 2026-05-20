export type ReminderType = "day7" | "day30";

export interface ReminderTemplateVars {
  firstName: string;
  product: string;
  founderName: string;
  /** day+1 at 10:00 AM in user's timezone, or undefined if timezone unknown */
  proposedTime?: string;
}

export interface RenderedEmail {
  subject: string;
  text: string;
}

export function renderReminder(type: ReminderType, vars: ReminderTemplateVars): RenderedEmail {
  const { firstName, product, founderName, proposedTime } = vars;

  if (type === "day7") {
    const proposedLine = proposedTime
      ? `Tomorrow I'll reach out at ${proposedTime} for a quick 12-minute call to see if ${product} has been useful and whether anything needs fixing.`
      : `I'd love to connect for a quick 12-minute call to see if ${product} has been useful and whether anything needs fixing — reply to find a time.`;

    return {
      subject: "Your first week check-in — 15 min tomorrow?",
      text: [
        `Hi ${firstName},`,
        "",
        `It's been a week since you got started — I'd love to hear how it's going. ${proposedLine}`,
        "",
        `If that time doesn't work, just reply and we'll find a slot that does.`,
        "",
        "Talk soon,",
        founderName,
      ].join("\n"),
    };
  }

  // day30
  const proposedLine = proposedTime
    ? `Tomorrow I'll reach out at ${proposedTime} for a 15-minute call.`
    : `Reply and we'll find a time that works.`;

  return {
    subject: "Your 30-day check-in — 15 min tomorrow?",
    text: [
      `Hi ${firstName},`,
      "",
      `A month in — great milestone. I want to hear what's been working, what hasn't, and where we go from here. ${proposedLine}`,
      "",
      `If the time doesn't work, reply and we'll reschedule.`,
      "",
      founderName,
    ].join("\n"),
  };
}

/**
 * Returns the day ordinal (1-indexed) for a given signup date relative to now.
 * Day 1 = the day of signup. Day 6 = 5 full days after signup (triggers Day-7 email).
 */
export function daysSinceSignup(createdAt: Date, now: Date): number {
  const msPerDay = 1000 * 60 * 60 * 24;
  const signupDay = Date.UTC(
    createdAt.getUTCFullYear(),
    createdAt.getUTCMonth(),
    createdAt.getUTCDate(),
  );
  const nowDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.floor((nowDay - signupDay) / msPerDay) + 1;
}

/**
 * Formats "tomorrow at 10:00 AM" in a user-readable string for the given timezone.
 * Returns undefined if timezone is unknown or invalid.
 */
export function formatProposedTime(now: Date, timezone: string | undefined): string | undefined {
  if (!timezone) return undefined;
  try {
    // Validate timezone first
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });

    const tomorrow = new Date(now);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

    const datePart = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "long",
      month: "long",
      day: "numeric",
    }).format(tomorrow);

    const tzAbbr =
      new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        timeZoneName: "short",
      })
        .formatToParts(tomorrow)
        .find((p) => p.type === "timeZoneName")?.value ?? timezone;

    return `${datePart} at 10:00 AM ${tzAbbr}`;
  } catch {
    return undefined;
  }
}
