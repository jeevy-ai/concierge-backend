import { describe, expect, it } from "vitest";
import {
  buildExternalActionMetric,
  checkExternalActionPolicy,
  KILL_SWITCH_KV_KEY,
} from "../src/lib/policy-engine.js";

type MockKV = { store: Record<string, string> };

function makeKV(initial: Record<string, string> = {}): MockKV & { get(k: string): Promise<string | null> } {
  const store = { ...initial };
  return {
    store,
    async get(k: string) {
      return store[k] ?? null;
    },
  };
}

const BASE_REQ = {
  actionClass: "outreach_send" as const,
  correlationId: "test-corr-id",
};

describe("checkExternalActionPolicy", () => {
  it("allows when token present and kill-switch not set", async () => {
    const kv = makeKV();
    const result = await checkExternalActionPolicy({ ...BASE_REQ, approvalToken: "tok-abc" }, kv);
    expect(result.allowed).toBe(true);
  });

  it("allows when token present and kill-switch explicitly enabled", async () => {
    const kv = makeKV({ [KILL_SWITCH_KV_KEY]: "true" });
    const result = await checkExternalActionPolicy({ ...BASE_REQ, approvalToken: "tok-abc" }, kv);
    expect(result.allowed).toBe(true);
  });

  it("rejects when approval token is missing", async () => {
    const kv = makeKV();
    const result = await checkExternalActionPolicy({ ...BASE_REQ, approvalToken: undefined }, kv);
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toBe("no_approval_token");
  });

  it("rejects when approval token is empty string", async () => {
    const kv = makeKV();
    const result = await checkExternalActionPolicy({ ...BASE_REQ, approvalToken: "   " }, kv);
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toBe("no_approval_token");
  });

  it("rejects when kill-switch is disabled (before token check)", async () => {
    const kv = makeKV({ [KILL_SWITCH_KV_KEY]: "false" });
    const result = await checkExternalActionPolicy({ ...BASE_REQ, approvalToken: "tok-abc" }, kv);
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toBe("kill_switch_disabled");
  });

  it("kill-switch rejected even without token (kill-switch checked first)", async () => {
    const kv = makeKV({ [KILL_SWITCH_KV_KEY]: "false" });
    const result = await checkExternalActionPolicy({ ...BASE_REQ, approvalToken: undefined }, kv);
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toBe("kill_switch_disabled");
  });
});

describe("buildExternalActionMetric", () => {
  it("emits approval_attached=true on allowed decision", () => {
    const decision = { allowed: true as const };
    const metric = buildExternalActionMetric({ ...BASE_REQ, approvalToken: "tok-abc" }, decision);
    expect(metric.name).toBe("external_action_total");
    expect(metric.approval_attached).toBe(true);
    expect(metric.action_class).toBe("outreach_send");
    expect(metric.outcome).toBe("allowed");
    expect(metric.correlationId).toBe("test-corr-id");
  });

  it("emits approval_attached=false + rejected_no_token on no-token rejection", () => {
    const decision = { allowed: false as const, reason: "no_approval_token" as const };
    const metric = buildExternalActionMetric({ ...BASE_REQ, approvalToken: undefined }, decision);
    expect(metric.approval_attached).toBe(false);
    expect(metric.outcome).toBe("rejected_no_token");
  });

  it("emits rejected_kill_switch on kill-switch rejection", () => {
    const decision = { allowed: false as const, reason: "kill_switch_disabled" as const };
    const metric = buildExternalActionMetric({ ...BASE_REQ, approvalToken: "tok-abc" }, decision);
    expect(metric.approval_attached).toBe(true);
    expect(metric.outcome).toBe("rejected_kill_switch");
  });
});
