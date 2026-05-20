import type { Env } from "../index.js";
import { validateRecapJob } from "./types.js";
import type { RecapJob } from "./types.js";

export async function processRecapBatch(
  batch: MessageBatch<RecapJob>,
  _env: Env
): Promise<void> {
  for (const message of batch.messages) {
    try {
      const job = validateRecapJob(message.body);
      console.log(
        `recap_consumer_processing queue=${batch.queue} jobId=${job.jobId} userId=${job.userId} recapType=${job.recapType}`
      );
      // TODO: generate and deliver the recap (future work)
      message.ack();
    } catch (err) {
      const bodyObj = message.body as Record<string, unknown>;
      const jobIdStr = String(bodyObj?.["jobId"] ?? "unknown");
      console.error(
        `recap_consumer_error queue=${batch.queue} jobId=${jobIdStr} err=${String(err)}`
      );
      message.retry();
    }
  }
}
