import type { Env } from "../index.js";

export async function processDlqBatch(
  batch: MessageBatch<unknown>,
  _env: Env
): Promise<void> {
  for (const message of batch.messages) {
    // Every message arriving here has exhausted retries on tasks-default.
    // Log as structured error so Cloudflare Tail Workers / log drains can alert on it.
    console.error(
      `[DEAD_LETTER] queue=${batch.queue} messageId=${message.id} attempts=${message.attempts} body=${JSON.stringify(message.body)}`
    );
    message.ack();
  }
}
