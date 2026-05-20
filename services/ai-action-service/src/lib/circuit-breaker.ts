/**
 * Circuit breaker for external provider calls.
 *
 * State machine:  closed(0) → open(2) after FAILURE_THRESHOLD consecutive errors.
 *                 open(2)   → half_open(1) after PROBE_COOLDOWN_MS.
 *                 half_open(1) → closed(0) on success, → open(2) on failure.
 *
 * State stored in KV: cb:{provider}:state, cb:{provider}:failures, cb:{provider}:opened_at
 *
 * provider_circuit_state{provider} gauge:
 *   0 = closed (normal)
 *   1 = half_open (probing)
 *   2 = open (rejecting all calls) — triggers ConciergeProviderCircuitOpen alert
 */

import {
  CIRCUIT_CLOSED,
  CIRCUIT_HALF_OPEN,
  CIRCUIT_OPEN,
  type CircuitState,
  type ConciergeKV,
  emitMetricLog,
  setGauge,
} from "./metrics.js";

export { CIRCUIT_CLOSED, CIRCUIT_HALF_OPEN, CIRCUIT_OPEN };
export type { CircuitState };

const FAILURE_THRESHOLD = 3;
const PROBE_COOLDOWN_MS = 30_000;

export class ProviderCircuitOpen extends Error {
  constructor(public readonly provider: string) {
    super(`Circuit open for provider: ${provider}`);
    this.name = "ProviderCircuitOpen";
  }
}

interface CircuitRecord {
  state: CircuitState;
  failures: number;
  openedAt: string | null;
}

function stateKey(provider: string): string {
  return `cb:${provider}:record`;
}

async function loadRecord(kv: ConciergeKV, provider: string): Promise<CircuitRecord> {
  const raw = await kv.get(stateKey(provider));
  if (!raw) return { state: CIRCUIT_CLOSED, failures: 0, openedAt: null };
  return JSON.parse(raw) as CircuitRecord;
}

async function saveRecord(
  kv: ConciergeKV,
  provider: string,
  record: CircuitRecord,
): Promise<void> {
  await kv.put(stateKey(provider), JSON.stringify(record));
  await setGauge(kv, "provider_circuit_state", { provider }, record.state);
  emitMetricLog("provider_circuit_state", { provider }, record.state);
}

export async function getCircuitState(kv: ConciergeKV, provider: string): Promise<CircuitState> {
  const rec = await loadRecord(kv, provider);
  if (rec.state === CIRCUIT_OPEN && rec.openedAt) {
    const elapsed = Date.now() - new Date(rec.openedAt).getTime();
    if (elapsed >= PROBE_COOLDOWN_MS) {
      const updated: CircuitRecord = { ...rec, state: CIRCUIT_HALF_OPEN };
      await saveRecord(kv, provider, updated);
      return CIRCUIT_HALF_OPEN;
    }
  }
  return rec.state;
}

export async function recordSuccess(kv: ConciergeKV, provider: string): Promise<void> {
  const rec = await loadRecord(kv, provider);
  if (rec.state === CIRCUIT_CLOSED && rec.failures === 0) return;
  await saveRecord(kv, provider, { state: CIRCUIT_CLOSED, failures: 0, openedAt: null });
}

export async function recordFailure(kv: ConciergeKV, provider: string): Promise<CircuitState> {
  const rec = await loadRecord(kv, provider);
  const failures = rec.failures + 1;
  if (failures >= FAILURE_THRESHOLD || rec.state === CIRCUIT_HALF_OPEN) {
    const updated: CircuitRecord = {
      state: CIRCUIT_OPEN,
      failures,
      openedAt: new Date().toISOString(),
    };
    await saveRecord(kv, provider, updated);
    return CIRCUIT_OPEN;
  }
  await saveRecord(kv, provider, { ...rec, failures });
  return rec.state;
}

export async function resetCircuit(kv: ConciergeKV, provider: string): Promise<void> {
  await saveRecord(kv, provider, { state: CIRCUIT_CLOSED, failures: 0, openedAt: null });
}
