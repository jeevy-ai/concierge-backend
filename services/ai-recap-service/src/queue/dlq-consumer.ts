import type { Env } from "../index.js";

export async function processDlqBatch(
  batch: MessageBatch<unknown>,
  _env: Env
): Promise<void> {
  for (const message of batch.messages) {
    // Structured JSON alert — Tail Workers and log drains filter on event="dlq_alert"
    console.error(
      JSON.stringify({
        event: "dlq_alert",
        queue: batch.queue,
        messageId: message.id,
        attempts: message.attempts,
        bodyPreview: JSON.stringify(message.body).slice(0, 200),
        ts: new Date().toISOString(),
      })
    );
    message.ack();
  }
}
