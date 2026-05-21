import type { MessagingAdapter, OutreachRequest, OutreachResult } from "@jeevy/contracts";

type ResendPayload = {
  from: string;
  to: string[];
  subject: string;
  text: string;
  html: string;
};

type ResendResponse = { id: string } | { name: string; message: string; statusCode: number };

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildOutreachHtml(subject: string, text: string): string {
  const bodyHtml = text
    .split(/\n\n+/)
    .map((block) =>
      `<p style="margin:0 0 16px;line-height:1.6">${escapeHtml(block).replace(/\n/g, "<br>")}</p>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(subject)}</title>
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
          <td style="padding:32px;color:#111827;font-size:15px">
            ${bodyHtml}
          </td>
        </tr>
        <tr>
          <td style="padding:20px 32px;border-top:1px solid #f3f4f6;background:#f9fafb">
            <p style="margin:0;color:#9ca3af;font-size:12px;line-height:1.5">
              You received this from Jeevy AI Concierge. To manage your preferences, visit your account settings.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export function createResendMessagingAdapter(
  apiKey: string,
  fromEmail: string,
): MessagingAdapter {
  return {
    async send(req: OutreachRequest): Promise<OutreachResult> {
      if (req.channel !== "email") {
        return { ok: false, error: `Unsupported channel: ${req.channel}` };
      }

      const subject = req.subject ?? "(no subject)";
      const payload: ResendPayload = {
        from: fromEmail,
        to: req.to,
        subject,
        text: req.body,
        html: buildOutreachHtml(subject, req.body),
      };

      let res: Response;
      try {
        res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });
      } catch (err) {
        return { ok: false, error: `Network error: ${String(err)}` };
      }

      const body = (await res.json()) as ResendResponse;

      if (!res.ok || "statusCode" in body) {
        const errBody = body as { name: string; message: string };
        return { ok: false, error: `Resend error: ${errBody.message ?? res.status}` };
      }

      return { ok: true, messageIds: [(body as { id: string }).id] };
    },
  };
}
