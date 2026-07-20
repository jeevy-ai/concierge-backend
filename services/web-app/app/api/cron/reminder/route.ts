import { NextResponse } from "next/server";
import { Resend } from "resend";
import {
  type ReminderType,
  daysSinceSignup,
  formatProposedTime,
  renderReminder,
} from "./templates";

interface ClerkEmailAddress {
  email_address: string;
}

interface ClerkUser {
  id: string;
  first_name: string | null;
  email_addresses: ClerkEmailAddress[];
  created_at: number; // Unix ms
  unsafe_metadata?: { timezone?: string };
  public_metadata?: { timezone?: string };
}

async function fetchClerkUsers(secretKey: string): Promise<ClerkUser[]> {
  const users: ClerkUser[] = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const res = await fetch(`https://api.clerk.com/v1/users?limit=${limit}&offset=${offset}`, {
      headers: { Authorization: `Bearer ${secretKey}` },
    });
    if (!res.ok) {
      throw new Error(`Clerk API error ${res.status}: ${await res.text()}`);
    }
    const batch = (await res.json()) as ClerkUser[];
    users.push(...batch);
    if (batch.length < limit) break;
    offset += limit;
  }
  return users;
}

function getUserTimezone(user: ClerkUser): string | undefined {
  return user.public_metadata?.timezone ?? user.unsafe_metadata?.timezone ?? undefined;
}

export async function GET(request: Request): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const clerkSecretKey = process.env.CLERK_SECRET_KEY;
  const resendApiKey = process.env.RESEND_API_KEY;
  const productName = process.env.PRODUCT_NAME ?? "Jeevy";
  const founderName = process.env.FOUNDER_NAME ?? "Noah";
  const productDomain = process.env.PRODUCT_DOMAIN ?? "jeevy.ai";
  const fromAddress = `${founderName} at ${productName} <noah@${productDomain}>`;

  if (!clerkSecretKey || !resendApiKey) {
    console.error("[reminder-cron] missing CLERK_SECRET_KEY or RESEND_API_KEY");
    return NextResponse.json({ error: "Server misconfiguration" }, { status: 500 });
  }

  const now = new Date();
  const resend = new Resend(resendApiKey);

  let users: ClerkUser[];
  try {
    users = await fetchClerkUsers(clerkSecretKey);
  } catch (err) {
    console.error("[reminder-cron] failed to fetch Clerk users", err);
    return NextResponse.json({ error: "Failed to fetch users" }, { status: 500 });
  }

  const results: { userId: string; type: ReminderType | "skip"; error?: string }[] = [];

  for (const user of users) {
    const createdAt = new Date(user.created_at);
    const day = daysSinceSignup(createdAt, now);

    let reminderType: ReminderType | null = null;
    if (day === 6) reminderType = "day7";
    else if (day === 29) reminderType = "day30";

    if (!reminderType) {
      results.push({ userId: user.id, type: "skip" });
      continue;
    }

    const email = user.email_addresses[0]?.email_address;
    if (!email) {
      results.push({ userId: user.id, type: reminderType, error: "no email" });
      continue;
    }

    const firstName = user.first_name ?? email.split("@")[0] ?? "there";
    const timezone = getUserTimezone(user);
    const proposedTime = formatProposedTime(now, timezone);

    const { subject, text } = renderReminder(reminderType, {
      firstName,
      product: productName,
      founderName,
      ...(proposedTime !== undefined ? { proposedTime } : {}),
    });

    try {
      const { error } = await resend.emails.send({
        from: fromAddress,
        replyTo: fromAddress,
        to: email,
        subject,
        text,
      });
      if (error) throw new Error(error.message);
      results.push({ userId: user.id, type: reminderType });
      console.log(`[reminder-cron] sent ${reminderType} to ${user.id} (day ${day})`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ userId: user.id, type: reminderType, error: msg });
      console.error(`[reminder-cron] failed ${reminderType} for ${user.id}:`, msg);
    }
  }

  const sent = results.filter((r) => r.type !== "skip" && !r.error).length;
  const failed = results.filter((r) => r.error).length;
  console.log(`[reminder-cron] done. sent=${sent} failed=${failed} total=${users.length}`);

  return NextResponse.json({ ok: true, sent, failed, total: users.length });
}
