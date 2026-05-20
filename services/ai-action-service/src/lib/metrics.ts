/**
 * Prometheus-compatible metrics for Scenario 3 observability.
 *
 * CF Workers are stateless isolates. Counters are persisted in KV so they
 * survive across requests. Gauges are written atomically on state changes.
 *
 * Metric names match the runbook (YOU-317 Runbook 3):
 *   provider_call_total{provider, outcome}
 *   provider_circuit_state{provider}   — 0=closed, 1=half_open, 2=open
 *   workflow_in_flight{workflow_class, state}
 */

export interface ConciergeKV {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export type CircuitState = 0 | 1 | 2;
export const CIRCUIT_CLOSED: CircuitState = 0;
export const CIRCUIT_HALF_OPEN: CircuitState = 1;
export const CIRCUIT_OPEN: CircuitState = 2;

function metricKey(name: string, labels: Record<string, string>): string {
  const labelStr = Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}="${v}"`)
    .join(",");
  return `metric:${name}{${labelStr}}`;
}

export async function incrementCounter(
  kv: ConciergeKV,
  name: string,
  labels: Record<string, string>,
): Promise<void> {
  const key = metricKey(name, labels);
  const current = await kv.get(key);
  const next = (current ? parseInt(current, 10) : 0) + 1;
  await kv.put(key, String(next));
}

export async function setGauge(
  kv: ConciergeKV,
  name: string,
  labels: Record<string, string>,
  value: number,
): Promise<void> {
  const key = metricKey(name, labels);
  await kv.put(key, String(value));
}

export async function getGauge(
  kv: ConciergeKV,
  name: string,
  labels: Record<string, string>,
): Promise<number> {
  const key = metricKey(name, labels);
  const v = await kv.get(key);
  return v ? parseFloat(v) : 0;
}

export async function getCounter(
  kv: ConciergeKV,
  name: string,
  labels: Record<string, string>,
): Promise<number> {
  const key = metricKey(name, labels);
  const v = await kv.get(key);
  return v ? parseInt(v, 10) : 0;
}

export function emitMetricLog(
  name: string,
  labels: Record<string, string>,
  value: number,
): void {
  console.log(JSON.stringify({ metric: name, ...labels, value, ts: new Date().toISOString() }));
}
