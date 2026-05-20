import { describe, expect, it, vi, afterEach } from "vitest";
import { validateRecapJob } from "../src/queue/types.js";
import { processRecapBatch } from "../src/queue/consumer.js";
import { processDlqBatch } from "../src/queue/dlq-consumer.js";
import { app } from "../src/index.js";
import workerModule from "../src/index.js";
import type { RecapJob } from "../src/queue/types.js";
import type { Env } from "../src/index.js";

// --- helpers ---

function makeMessage<T>(body: T, overrides?: Partial<{ id: string; attempts: number }>): Message<T> {
  return {
    id: overrides?.id ?? "msg-1",
    timestamp: new Date(),
    body,
    attempts: overrides?.attempts ?? 1,
    ack: vi.fn(),
    retry: vi.fn(),
  } as unknown as Message<T>;
}

function makeBatch<T>(queue: string, messages: Message<T>[]): MessageBatch<T> {
  return {
    queue,
    messages,
    ackAll: vi.fn(),
    retryAll: vi.fn(),
  } as unknown as MessageBatch<T>;
}

const validJob: RecapJob = {
  jobId: "job-001",
  userId: "user-abc",
  recapType: "daily",
  periodStart: "2026-05-19",
  periodEnd: "2026-05-20",
};

const stubEnv = {
  ENVIRONMENT: "test",
  TASKS_QUEUE: { send: vi.fn() } as unknown as Queue<RecapJob>,
} satisfies Env;

// --- validateRecapJob ---

describe("validateRecapJob", () => {
  it("accepts a valid job", () => {
    expect(() => validateRecapJob(validJob)).not.toThrow();
  });

  it("throws on missing jobId", () => {
    expect(() => validateRecapJob({ ...validJob, jobId: "" })).toThrow("missing or empty jobId");
  });

  it("throws on missing userId", () => {
    expect(() => validateRecapJob({ ...validJob, userId: undefined })).toThrow("missing or empty userId");
  });

  it("throws on invalid recapType", () => {
    expect(() => validateRecapJob({ ...validJob, recapType: "yearly" })).toThrow(
      "recapType must be daily|weekly|monthly"
    );
  });

  it("throws on missing periodStart", () => {
    expect(() => validateRecapJob({ ...validJob, periodStart: "" })).toThrow(
      "missing or empty periodStart"
    );
  });

  it("throws on non-object body", () => {
    expect(() => validateRecapJob("not-an-object")).toThrow("body must be an object");
  });
});

// --- processRecapBatch ---

describe("processRecapBatch", () => {
  it("acks valid messages", async () => {
    const msg = makeMessage(validJob);
    const batch = makeBatch<RecapJob>("tasks-default", [msg]);
    await processRecapBatch(batch, stubEnv);
    expect(msg.ack).toHaveBeenCalledOnce();
    expect(msg.retry).not.toHaveBeenCalled();
  });

  it("retries malformed messages", async () => {
    const malformed = { jobId: "x", recapType: "quarterly" } as unknown as RecapJob;
    const msg = makeMessage(malformed);
    const batch = makeBatch<RecapJob>("tasks-default", [msg]);
    await processRecapBatch(batch, stubEnv);
    expect(msg.retry).toHaveBeenCalledOnce();
    expect(msg.ack).not.toHaveBeenCalled();
  });

  it("acks valid messages and retries invalid ones in same batch", async () => {
    const goodMsg = makeMessage(validJob, { id: "good" });
    const badMsg = makeMessage({ jobId: "" } as unknown as RecapJob, { id: "bad" });
    const batch = makeBatch<RecapJob>("tasks-default", [goodMsg, badMsg]);
    await processRecapBatch(batch, stubEnv);
    expect(goodMsg.ack).toHaveBeenCalledOnce();
    expect(badMsg.retry).toHaveBeenCalledOnce();
  });
});

// --- processDlqBatch ---

describe("processDlqBatch", () => {
  afterEach(() => vi.restoreAllMocks());

  it("acks all dead-letter messages", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const msg1 = makeMessage({ jobId: "dead-1" }, { id: "dlq-1", attempts: 4 });
    const msg2 = makeMessage("malformed-string", { id: "dlq-2", attempts: 4 });
    const batch = makeBatch<unknown>("tasks-default-dlq", [msg1, msg2]);
    await processDlqBatch(batch, stubEnv);
    expect(msg1.ack).toHaveBeenCalledOnce();
    expect(msg2.ack).toHaveBeenCalledOnce();
  });

  it("emits one structured dlq_alert log per message", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const msg = makeMessage({ jobId: "dead-1" }, { id: "dlq-alert-1", attempts: 4 });
    const batch = makeBatch<unknown>("tasks-default-dlq", [msg]);
    await processDlqBatch(batch, stubEnv);
    expect(errorSpy).toHaveBeenCalledOnce();
    const parsed = JSON.parse(errorSpy.mock.calls[0][0] as string);
    expect(parsed.event).toBe("dlq_alert");
    expect(parsed.queue).toBe("tasks-default-dlq");
    expect(parsed.messageId).toBe("dlq-alert-1");
    expect(parsed.attempts).toBe(4);
    expect(typeof parsed.ts).toBe("string");
    expect(typeof parsed.bodyPreview).toBe("string");
  });

  it("emits one alert per message in batch", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const msgs = [
      makeMessage("bad-1", { id: "d1" }),
      makeMessage("bad-2", { id: "d2" }),
      makeMessage("bad-3", { id: "d3" }),
    ];
    const batch = makeBatch<unknown>("tasks-default-dlq", msgs);
    await processDlqBatch(batch, stubEnv);
    expect(errorSpy).toHaveBeenCalledTimes(3);
  });

  it("truncates bodyPreview to 200 chars", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const longBody = { data: "x".repeat(500) };
    const msg = makeMessage(longBody, { id: "long-body-1" });
    const batch = makeBatch<unknown>("tasks-default-dlq", [msg]);
    await processDlqBatch(batch, stubEnv);
    const parsed = JSON.parse(errorSpy.mock.calls[0][0] as string);
    expect(parsed.bodyPreview.length).toBeLessThanOrEqual(200);
  });
});

// --- worker queue dispatch routing ---

describe("worker queue dispatch", () => {
  afterEach(() => vi.restoreAllMocks());

  it("routes tasks-default to recap consumer (acks valid job)", async () => {
    const msg = makeMessage(validJob);
    const batch = makeBatch<RecapJob>("tasks-default", [msg]);
    await workerModule.queue(batch, stubEnv);
    expect(msg.ack).toHaveBeenCalledOnce();
  });

  it("routes tasks-default-staging to recap consumer (acks valid job)", async () => {
    const msg = makeMessage(validJob);
    const batch = makeBatch<RecapJob>("tasks-default-staging", [msg]);
    await workerModule.queue(batch, stubEnv);
    expect(msg.ack).toHaveBeenCalledOnce();
  });

  it("routes tasks-default-dlq to dlq consumer (emits dlq_alert)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const msg = makeMessage({ bad: true }, { id: "route-dlq-1" });
    const batch = makeBatch<unknown>("tasks-default-dlq", [msg]);
    await workerModule.queue(batch, stubEnv);
    expect(msg.ack).toHaveBeenCalledOnce();
    const parsed = JSON.parse(errorSpy.mock.calls[0][0] as string);
    expect(parsed.event).toBe("dlq_alert");
  });

  it("routes unknown queue names to dlq consumer", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const msg = makeMessage({ unknown: true }, { id: "unknown-queue-1" });
    const batch = makeBatch<unknown>("some-other-queue", [msg]);
    await workerModule.queue(batch, stubEnv);
    expect(msg.ack).toHaveBeenCalledOnce();
    const parsed = JSON.parse(errorSpy.mock.calls[0][0] as string);
    expect(parsed.event).toBe("dlq_alert");
    expect(parsed.queue).toBe("some-other-queue");
  });
});

// --- /api/queue/requeue ---

describe("POST /api/queue/requeue", () => {
  it("enqueues valid job and returns 200", async () => {
    const sendMock = vi.fn().mockResolvedValue(undefined);
    const env: Env = { ENVIRONMENT: "test", TASKS_QUEUE: { send: sendMock } as unknown as Queue<RecapJob> };
    const res = await app.request(
      "/api/queue/requeue",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validJob),
      },
      env
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { queued: boolean; jobId: string };
    expect(body.queued).toBe(true);
    expect(body.jobId).toBe("job-001");
    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({ jobId: "job-001" }));
  });

  it("returns 400 on invalid job payload", async () => {
    const env: Env = { ENVIRONMENT: "test", TASKS_QUEUE: { send: vi.fn() } as unknown as Queue<RecapJob> };
    const res = await app.request(
      "/api/queue/requeue",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "u1" }),
      },
      env
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_job");
  });

  it("returns 400 on non-JSON body", async () => {
    const env: Env = { ENVIRONMENT: "test", TASKS_QUEUE: { send: vi.fn() } as unknown as Queue<RecapJob> };
    const res = await app.request(
      "/api/queue/requeue",
      {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: "not-json",
      },
      env
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_json");
  });
});
