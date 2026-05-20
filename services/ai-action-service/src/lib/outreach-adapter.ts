import type { MessagingAdapter, OutreachRequest, OutreachResult } from "@jeevy/contracts";

type ResendPayload = {
  from: string;
  to: string[];
  subject: string;
  text: string;
};

type ResendResponse = { id: string } | { name: string; message: string; statusCode: number };

export function createResendMessagingAdapter(
  apiKey: string,
  fromEmail: string,
): MessagingAdapter {
  return {
    async send(req: OutreachRequest): Promise<OutreachResult> {
      if (req.channel !== "email") {
        return { ok: false, error: `Unsupported channel: ${req.channel}` };
      }

      const payload: ResendPayload = {
        from: fromEmail,
        to: req.to,
        subject: req.subject ?? "(no subject)",
        text: req.body,
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
