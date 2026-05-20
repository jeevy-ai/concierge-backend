import { Hono } from "hono";
import { cors } from "hono/cors";
import { processRecapBatch } from "./queue/consumer.js";
import { processDlqBatch } from "./queue/dlq-consumer.js";
import { validateRecapJob } from "./queue/types.js";
import type { RecapJob } from "./queue/types.js";

export type Env = {
  ENVIRONMENT: string;
  TASKS_QUEUE: Queue<RecapJob>;
};

const app = new Hono<{ Bindings: Env }>();

app.use("*", cors());

app.get("/health", (c) => {
  return c.json({ ok: true, service: "ai-recap-service", version: "0.1.0" });
});

app.get("/api/recaps", (c) => {
  return c.json({ recaps: [], message: "Recap service ready" });
});

app.post("/api/queue/requeue", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }

  let job: RecapJob;
  try {
    job = validateRecapJob(body);
  } catch (err) {
    return c.json({ error: "invalid_job", detail: String(err) }, 400);
  }

  await c.env.TASKS_QUEUE.send(job);
  console.log(`recap_requeue jobId=${job.jobId} userId=${job.userId}`);
  return c.json({ queued: true, jobId: job.jobId });
});

export { app };

export default {
  fetch: app.fetch,

  async queue(batch: MessageBatch<RecapJob | unknown>, env: Env): Promise<void> {
    if (batch.queue === "tasks-default" || batch.queue === "tasks-default-staging") {
      await processRecapBatch(batch as MessageBatch<RecapJob>, env);
    } else {
      await processDlqBatch(batch, env);
    }
  },
};
