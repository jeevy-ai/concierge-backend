export type RecapJob = {
  jobId: string;
  userId: string;
  recapType: "daily" | "weekly" | "monthly";
  periodStart: string;
  periodEnd: string;
  metadata?: Record<string, unknown>;
};

export function validateRecapJob(body: unknown): RecapJob {
  if (!body || typeof body !== "object") {
    throw new Error("recap_job_invalid: body must be an object");
  }
  const obj = body as Record<string, unknown>;

  if (typeof obj["jobId"] !== "string" || !obj["jobId"]) {
    throw new Error("recap_job_invalid: missing or empty jobId");
  }
  if (typeof obj["userId"] !== "string" || !obj["userId"]) {
    throw new Error("recap_job_invalid: missing or empty userId");
  }
  if (
    obj["recapType"] !== "daily" &&
    obj["recapType"] !== "weekly" &&
    obj["recapType"] !== "monthly"
  ) {
    throw new Error(
      `recap_job_invalid: recapType must be daily|weekly|monthly, got ${String(obj["recapType"])}`
    );
  }
  if (typeof obj["periodStart"] !== "string" || !obj["periodStart"]) {
    throw new Error("recap_job_invalid: missing or empty periodStart");
  }
  if (typeof obj["periodEnd"] !== "string" || !obj["periodEnd"]) {
    throw new Error("recap_job_invalid: missing or empty periodEnd");
  }

  const metadata =
    typeof obj["metadata"] === "object" && obj["metadata"] !== null
      ? (obj["metadata"] as Record<string, unknown>)
      : undefined;

  return {
    jobId: obj["jobId"],
    userId: obj["userId"],
    recapType: obj["recapType"],
    periodStart: obj["periodStart"],
    periodEnd: obj["periodEnd"],
    ...(metadata !== undefined ? { metadata } : {}),
  };
}
