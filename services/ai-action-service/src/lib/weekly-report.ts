/**
 * Weekly board metrics report — YOU-323.
 *
 * Pulls: Stripe billing metrics, activation funnel from CONCIERGE_KV,
 * NPS from INTERVIEWS_KV. Posts to Slack webhook (primary) or Resend
 * email (fallback) every Monday.
 *
 * Activation data source: KV key enumeration via kv.list(), not PostHog Query API,
 * so no extra personal-API-key secret is required.
 *
 * KV schemas consumed:
 *   CONCIERGE_KV:
 *     activation:{userId}:first_action_fired  → "1"
 *     activation:{userId}:completion_count    → JSON number
 *     activation:{userId}:nth_fired:{n}       → "1"
 *   INTERVIEWS_KV:
 *     tracked_users                           → JSON string[]
 *     user:{userId}:nps                       → JSON { score: number; recordedAt: string }
 */

import { fetchBillingMetrics } from "./stripe-reporting.js";

export interface WeeklyReportEnv {
  STRIPE_SECRET_KEY: string;
  CONCIERGE_KV: KVNamespace;
  INTERVIEWS_KV: KVNamespace;
  RESEND_API_KEY: string;
  FROM_EMAIL: string;
  // Explicit union so caller can pass Env.SLACK_WEBHOOK_URL (string | undefined) directly.
  SLACK_WEBHOOK_URL: string | undefined;
}

export interface WeeklyMetrics {
  reportDate: string;
  billing: {
    paidUsers: number;
    mrrCents: number;
    churnedThisWeek: number;
  };
  activation: {
    usersAttempted: number;
    usersFirstValue: number;
    usersNthValue: number;
  };
  nps: {
    score: number | null;
    respondents: number;
    promoters: number;
    passives: number;
    detractors: number;
  };
}

interface NpsRecord {
  score: number;
  recordedAt: string;
}

const NPS_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

async function fetchActivationMetrics(kv: KVNamespace): Promise<WeeklyMetrics["activation"]> {
  const keys = await kv.list({ prefix: "activation:" });

  const attempted = new Set<string>();
  const firstValue = new Set<string>();
  const nthValue = new Set<string>();

  for (const key of keys.keys) {
    const name = key.name;
    const parts = name.split(":");
    if (parts.length < 3) continue;
    const userId = parts[1];
    if (!userId) continue;

    if (name.endsWith(":first_action_fired")) {
      attempted.add(userId);
    } else if (name.endsWith(":completion_count")) {
      const val = await kv.get(name);
      if (val && parseInt(val, 10) >= 1) firstValue.add(userId);
    } else if (name.includes(":nth_fired:")) {
      nthValue.add(userId);
    }
  }

  return {
    usersAttempted: attempted.size,
    usersFirstValue: firstValue.size,
    usersNthValue: nthValue.size,
  };
}

async function fetchNpsMetrics(kv: KVNamespace): Promise<WeeklyMetrics["nps"]> {
  const raw = await kv.get("tracked_users");
  const userIds: string[] = raw ? (JSON.parse(raw) as string[]) : [];

  const cutoff = Date.now() - NPS_WINDOW_MS;
  let promoters = 0;
  let passives = 0;
  let detractors = 0;

  for (const userId of userIds) {
    const npsRaw = await kv.get(`user:${userId}:nps`);
    if (!npsRaw) continue;
    const record = JSON.parse(npsRaw) as NpsRecord;
    if (new Date(record.recordedAt).getTime() < cutoff) continue;

    if (record.score >= 9) promoters++;
    else if (record.score >= 7) passives++;
    else detractors++;
  }

  const respondents = promoters + passives + detractors;
  const score = respondents > 0 ? Math.round(((promoters - detractors) / respondents) * 100) : null;

  return { score, respondents, promoters, passives, detractors };
}

export async function collectWeeklyMetrics(env: WeeklyReportEnv): Promise<WeeklyMetrics> {
  const [billing, activation, nps] = await Promise.all([
    fetchBillingMetrics(env.STRIPE_SECRET_KEY),
    fetchActivationMetrics(env.CONCIERGE_KV),
    fetchNpsMetrics(env.INTERVIEWS_KV),
  ]);

  return {
    reportDate: new Date().toISOString().split("T")[0] ?? "",
    billing,
    activation,
    nps,
  };
}

function formatMrr(cents: number): string {
  if (cents === 0) return "$0";
  const dollars = cents / 100;
  return dollars >= 1000
    ? `$${(dollars / 1000).toFixed(1)}k`
    : `$${dollars.toFixed(0)}`;
}

export function buildSlackBlocks(metrics: WeeklyMetrics): object[] {
  const { billing, activation, nps } = metrics;
  const npsStr =
    nps.score === null
      ? "n/a (no responses yet)"
      : `${nps.score > 0 ? "+" : ""}${nps.score} (n=${nps.respondents})`;

  return [
    {
      type: "header",
      text: { type: "plain_text", text: `Weekly Metrics — ${metrics.reportDate}`, emoji: false },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: [
          "*Billing*",
          `• Paid users: *${billing.paidUsers}*`,
          `• MRR: *${formatMrr(billing.mrrCents)}*`,
          `• Churned this week: *${billing.churnedThisWeek}*`,
        ].join("\n"),
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: [
          "*Activation (cumulative funnel)*",
          `• First action attempted: *${activation.usersAttempted}* users`,
          `• First value delivered: *${activation.usersFirstValue}* users`,
          `• 3rd value delivered: *${activation.usersNthValue}* users`,
        ].join("\n"),
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: [
          "*NPS (last 30 days)*",
          `• Score: *${npsStr}*`,
          ...(nps.respondents > 0
            ? [
                `• Promoters: ${nps.promoters} | Passives: ${nps.passives} | Detractors: ${nps.detractors}`,
              ]
            : []),
        ].join("\n"),
      },
    },
    { type: "divider" },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: "Generated by Jeevy weekly-report cron. Source: Stripe + CONCIERGE_KV + INTERVIEWS_KV.",
        },
      ],
    },
  ];
}

function buildEmailHtml(metrics: WeeklyMetrics): string {
  const { billing, activation, nps } = metrics;
  const npsStr =
    nps.score === null
      ? "n/a"
      : `${nps.score > 0 ? "+" : ""}${nps.score} (n=${nps.respondents})`;

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Weekly Metrics ${metrics.reportDate}</title></head>
<body style="font-family:-apple-system,sans-serif;max-width:600px;margin:32px auto;color:#111">
  <h2 style="margin:0 0 20px">Weekly Metrics — ${metrics.reportDate}</h2>

  <h3 style="margin:0 0 8px;color:#4f46e5">Billing</h3>
  <ul>
    <li>Paid users: <strong>${billing.paidUsers}</strong></li>
    <li>MRR: <strong>${formatMrr(billing.mrrCents)}</strong></li>
    <li>Churned this week: <strong>${billing.churnedThisWeek}</strong></li>
  </ul>

  <h3 style="margin:16px 0 8px;color:#4f46e5">Activation (cumulative funnel)</h3>
  <ul>
    <li>First action attempted: <strong>${activation.usersAttempted}</strong> users</li>
    <li>First value delivered: <strong>${activation.usersFirstValue}</strong> users</li>
    <li>3rd value delivered: <strong>${activation.usersNthValue}</strong> users</li>
  </ul>

  <h3 style="margin:16px 0 8px;color:#4f46e5">NPS (last 30 days)</h3>
  <ul>
    <li>Score: <strong>${npsStr}</strong></li>
    ${
      nps.respondents > 0
        ? `<li>Promoters: ${nps.promoters} | Passives: ${nps.passives} | Detractors: ${nps.detractors}</li>`
        : ""
    }
  </ul>

  <p style="margin:24px 0 0;font-size:12px;color:#6b7280">
    Generated by Jeevy weekly-report cron (YOU-323). Source: Stripe + KV.
  </p>
</body>
</html>`;
}

async function postToSlack(webhookUrl: string, metrics: WeeklyMetrics): Promise<void> {
  const blocks = buildSlackBlocks(metrics);
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ blocks }),
  });
  if (!res.ok) {
    throw new Error(`Slack webhook returned ${res.status}: ${await res.text()}`);
  }
}

async function sendReportEmail(env: WeeklyReportEnv, metrics: WeeklyMetrics): Promise<void> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.FROM_EMAIL,
      to: "noahlaux@gmail.com",
      subject: `Weekly Metrics — ${metrics.reportDate}`,
      html: buildEmailHtml(metrics),
    }),
  });
  if (!res.ok) {
    throw new Error(`Resend API error ${res.status}: ${await res.text()}`);
  }
}

export async function runWeeklyReport(env: WeeklyReportEnv): Promise<{
  delivered: "slack" | "email";
  metrics: WeeklyMetrics;
}> {
  const metrics = await collectWeeklyMetrics(env);

  if (env.SLACK_WEBHOOK_URL) {
    await postToSlack(env.SLACK_WEBHOOK_URL, metrics);
    return { delivered: "slack", metrics };
  }

  await sendReportEmail(env, metrics);
  return { delivered: "email", metrics };
}
