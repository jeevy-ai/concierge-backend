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
  INTERVIEWS_KV: KVNamespace;
  RESEND_API_KEY: string;
  SCHEDULING_LINK: string;
  FROM_EMAIL: string;
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

export async function recordValueEvent(
  kv: KVNamespace,
  userId: string,
): Promise<void> {
  await kv.put(
    `user:${userId}:last_value_event`,
    new Date().toISOString(),
  );
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

export async function sendSaveInterviewEmail(
  env: InterviewsEnv,
  user: UserProfile,
  reason: string,
): Promise<void> {
  const firstName = user.firstName ?? "there";
  const subject = "We'd love 20 minutes to help — can you find a time?";
  const body = [
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
      text: body,
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
