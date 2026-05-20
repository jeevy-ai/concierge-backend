import { Resend } from 'resend';
import type { IntakePayload } from './schema';

const CEO_EMAIL = 'noahlaux@gmail.com';

const CONTACT_PREF_LABELS: Record<IntakePayload['contactPreference'], string> = {
  pref_email_link: 'Email scheduling link',
  pref_slack: 'Slack',
  pref_whatsapp: 'WhatsApp',
  pref_async: 'Async (email/Loom)',
  pref_call: 'Phone call',
};

function buildPlainText(data: IntakePayload): string {
  const goals = data.goals
    .map((g) => `  - ${g}`)
    .concat(data.goalsOther ? [`  - Other: "${data.goalsOther}"`] : [])
    .join('\n');

  const calendars = [
    ...data.calendars,
    ...(data.calendarsOther ? [data.calendarsOther] : []),
  ].join(', ');

  const messaging = [
    ...data.messagingTools,
    ...(data.messagingOther ? [data.messagingOther] : []),
  ].join(', ');

  return [
    `Name: ${data.firstName} ${data.lastName}`,
    `Email: ${data.email}`,
    `Contact pref: ${CONTACT_PREF_LABELS[data.contactPreference]}`,
    '',
    'Goals:',
    goals,
    '',
    `Calendars: ${calendars}`,
    `Messaging: ${messaging}`,
    '',
    'Success criterion:',
    `  "${data.successCriterion}"`,
    '',
    `Submitted: ${data.submittedAt}`,
  ].join('\n');
}

function buildHtml(data: IntakePayload): string {
  const goals = [
    ...data.goals.map((g) => `<li>${g}</li>`),
    ...(data.goalsOther ? [`<li>Other: &ldquo;${data.goalsOther}&rdquo;</li>`] : []),
  ].join('');

  const calendars = [
    ...data.calendars,
    ...(data.calendarsOther ? [data.calendarsOther] : []),
  ].join(', ');

  const messaging = [
    ...data.messagingTools,
    ...(data.messagingOther ? [data.messagingOther] : []),
  ].join(', ');

  return `
<p><strong>Name:</strong> ${data.firstName} ${data.lastName}<br>
<strong>Email:</strong> ${data.email}<br>
<strong>Contact pref:</strong> ${CONTACT_PREF_LABELS[data.contactPreference]}</p>

<p><strong>Goals:</strong></p>
<ul>${goals}</ul>

<p><strong>Calendars:</strong> ${calendars}<br>
<strong>Messaging:</strong> ${messaging}</p>

<p><strong>Success criterion:</strong><br>
&ldquo;${data.successCriterion}&rdquo;</p>

<p><strong>Submitted:</strong> ${data.submittedAt}</p>
`.trim();
}

export async function sendIntakeNotification(data: IntakePayload): Promise<void> {
  const apiKey = process.env['RESEND_API_KEY'];
  if (!apiKey) {
    throw new Error('RESEND_API_KEY is not configured');
  }

  const resend = new Resend(apiKey);
  const subject = `New intake submission — ${data.firstName} ${data.lastName}`;

  const { error } = await resend.emails.send({
    from: 'Jeevy Intake <intake@jeevy.ai>',
    to: CEO_EMAIL,
    subject,
    text: buildPlainText(data),
    html: buildHtml(data),
  });

  if (error) {
    throw new Error(`Resend error: ${error.message}`);
  }
}
