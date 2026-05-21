import { createServerCapture } from "@jeevy/analytics/server";
import { AnalyticsEventName } from "@jeevy/contracts";

/**
 * Save interview scheduling automation.
 *
 * KV key schema (in INTERVIEWS_KV):
 *   user:{userId}:last_value_event  →  ISO timestamp of most recent value event
 *   user:{userId}:nps               →  JSON { score: number; recordedAt: string }
 *   user:{userId}:save_invite       →  JSON { sentAt: string; status: "sent"|"booked"|"in_progress" }
 *   tracked_users                   →  JSON string[] of user IDs to monitor
 *
 * Trigger conditions (either):
 *   - No value event for 7 consecutive days
 *   - NPS score ≤ 6 submitted
 *
 * Dedup: one invite per user per 30-day rolling window; skip if invite status
 *   is "booked" or "in_progress".
 */

const VALUE_EVENT_GAP_MS = 7 * 24 * 60 * 60 * 1000;
const DEDUP_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const NPS_DETRACTOR_THRESHOLD = 6;

export interface InterviewsEnv {
  ENVIRONMENT: string;
  INTERVIEWS_KV: KVNamespace;
  RESEND_API_KEY: string;
  SCHEDULING_LINK: string;
  FROM_EMAIL: string;
  POSTHOG_API_KEY: string;
  POSTHOG_HOST: string;
}

interface NpsRecord {
  score: number;
  recordedAt: string;
}

interface SaveInviteRecord {
  sentAt: string;
  status: "sent" | "booked" | "in_progress";
}

interface UserProfile {
  userId: string;
  firstName?: string | undefined;
  email: string;
}

export async function recordValueEvent(kv: KVNamespace, userId: string): Promise<void> {
  await kv.put(`user:${userId}:last_value_event`, new Date().toISOString());
}

export async function recordNpsScore(
  kv: KVNamespace,
  userId: string,
  score: number,
): Promise<boolean> {
  const record: NpsRecord = { score, recordedAt: new Date().toISOString() };
  await kv.put(`user:${userId}:nps`, JSON.stringify(record));
  return score <= NPS_DETRACTOR_THRESHOLD;
}

export async function trackUser(kv: KVNamespace, userId: string): Promise<void> {
  const raw = await kv.get("tracked_users");
  const users: string[] = raw ? (JSON.parse(raw) as string[]) : [];
  if (!users.includes(userId)) {
    users.push(userId);
    await kv.put("tracked_users", JSON.stringify(users));
  }
}

export async function shouldSendInvite(
  kv: KVNamespace,
  userId: string,
): Promise<{ trigger: boolean; reason?: string }> {
  const inviteRaw = await kv.get(`user:${userId}:save_invite`);
  if (inviteRaw) {
    const invite = JSON.parse(inviteRaw) as SaveInviteRecord;
    if (invite.status === "booked" || invite.status === "in_progress") {
      return { trigger: false };
    }
    const sentAt = new Date(invite.sentAt).getTime();
    if (Date.now() - sentAt < DEDUP_WINDOW_MS) {
      return { trigger: false };
    }
  }

  const lastEventRaw = await kv.get(`user:${userId}:last_value_event`);
  if (lastEventRaw) {
    const lastEvent = new Date(lastEventRaw).getTime();
    if (Date.now() - lastEvent >= VALUE_EVENT_GAP_MS) {
      return { trigger: true, reason: "7_day_inactivity" };
    }
  } else {
    // Never had a value event — treat registration as day 0 start; defer to
    // explicit NPS signal. Don't trigger on missing data alone.
  }

  const npsRaw = await kv.get(`user:${userId}:nps`);
  if (npsRaw) {
    const nps = JSON.parse(npsRaw) as NpsRecord;
    if (nps.score <= NPS_DETRACTOR_THRESHOLD) {
      return { trigger: true, reason: "nps_detractor" };
    }
  }

  return { trigger: false };
}

export function buildInterviewEmailHtml(firstName: string, schedulingLink: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>We&rsquo;d love 20 minutes to help</title>
</head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:48px 20px">
    <tr><td align="center">
      <table role="presentation" width="580" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;border:1px solid #e5e7eb;overflow:hidden;max-width:580px">
        <tr>
          <td style="background:#4f46e5;padding:24px 32px">
            <span style="font-size:22px;font-weight:700;color:#ffffff;letter-spacing:-0.3px">Jeevy</span>
            <span style="font-size:12px;color:#a5b4fc;margin-left:8px">AI Concierge</span>
          </td>
        </tr>
        <tr>
          <td style="padding:32px 32px 8px;color:#111827;font-size:15px;line-height:1.6">
            <p style="margin:0 0 16px">Hi ${firstName},</p>
            <p style="margin:0 0 16px">We noticed you haven&rsquo;t had a chance to get much use out of Jeevy recently. That&rsquo;s on us &mdash; we want to understand why and see if we can fix it.</p>
            <p style="margin:0 0 16px">Could you spare 20 minutes for a quick call? I&rsquo;ll listen, take notes, and share anything useful we learn with the team.</p>
            <p style="margin:0 0 24px">No agenda, no sales pitch &mdash; just an honest conversation.</p>
          </td>
        </tr>
        <tr>
          <td style="padding:0 32px 32px;text-align:center">
            <a href="${schedulingLink}"
               style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:14px 28px;border-radius:8px">
              Pick a time that works for you
            </a>
          </td>
        </tr>
        <tr>
          <td style="padding:0 32px 24px;text-align:center">
            <p style="margin:0;color:#6b7280;font-size:13px">&mdash; The Jeevy team</p>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 32px;border-top:1px solid #f3f4f6;background:#f9fafb">
            <p style="margin:0;color:#9ca3af;font-size:12px;line-height:1.5">
              You received this because you are a registered Jeevy user. To manage your preferences, visit your account settings.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export async function sendSaveInterviewEmail(
  env: InterviewsEnv,
  user: UserProfile,
  reason: string,
): Promise<void> {
  const firstName = user.firstName ?? "there";
  const subject = "We'd love 20 minutes to help — can you find a time?";
  const text = [
    `Hi ${firstName},`,
    "",
    "We noticed you haven't had a chance to get much use out of Jeevy recently.",
    "That's on us — we want to understand why and see if we can fix it.",
    "",
    "Could you spare 20 minutes for a quick call? I'll listen, take notes,",
    "and share anything useful we learn with the team.",
    "",
    `→ Pick a time: ${env.SCHEDULING_LINK}`,
    "",
    "No agenda, no sales pitch — just an honest conversation.",
    "",
    "— The Jeevy team",
  ].join("\n");

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.FROM_EMAIL,
      to: user.email,
      subject,
      text,
      html: buildInterviewEmailHtml(firstName, env.SCHEDULING_LINK),
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Resend API error ${response.status}: ${err}`);
  }

  const record: SaveInviteRecord = {
    sentAt: new Date().toISOString(),
    status: "sent",
  };
  await env.INTERVIEWS_KV.put(
    `user:${user.userId}:save_invite`,
    JSON.stringify({ ...record, reason }),
  );

  const capture = createServerCapture({
    apiKey: env.POSTHOG_API_KEY,
    host: env.POSTHOG_HOST,
  });
  await capture({
    distinctId: user.userId,
    event: AnalyticsEventName.SAVE_INTERVIEW_INVITE_SENT,
    props: { userId: user.userId, trigger: reason },
    superProps: { env: env.ENVIRONMENT as "production" | "staging" | "development", app_version: "0.1.0", surface: "app" },
  }).catch((err) => {
    console.error("[save-interview] analytics capture failed (non-fatal):", err);
  });
}

export async function maybeInviteUser(
  env: InterviewsEnv,
  user: UserProfile,
): Promise<{ sent: boolean; reason?: string }> {
  const check = await shouldSendInvite(env.INTERVIEWS_KV, user.userId);
  if (!check.trigger) return { sent: false };
  const reason = check.reason ?? "unknown";
  await sendSaveInterviewEmail(env, user, reason);
  return { sent: true, reason };
}

/** Nightly cron: scan all tracked users and send invites where triggered. */
export async function runDailyAtRiskScan(
  env: InterviewsEnv,
  getUser: (userId: string) => Promise<UserProfile | null>,
): Promise<{ processed: number; invited: number }> {
  const raw = await env.INTERVIEWS_KV.get("tracked_users");
  const userIds: string[] = raw ? (JSON.parse(raw) as string[]) : [];

  let invited = 0;
  for (const userId of userIds) {
    const user = await getUser(userId);
    if (!user) continue;
    const result = await maybeInviteUser(env, user);
    if (result.sent) invited++;
  }

  return { processed: userIds.length, invited };
}
