import { analyticsFilters, readAnalytics } from "./analytics.ts";
import type { AnalyticsEnv, AnalyticsReport } from "./types.ts";

type Entry = { report: AnalyticsReport; expires: number; bytes: number };
type State = { entries: Map<string, Entry>; pending?: { key: string; promise: Promise<AnalyticsReport> }; retryAfter: number; generation: number };
const states = new WeakMap<D1Database, State>();
const TTL_MS = 60_000;
const MAX_ENTRIES = 16;
const MAX_BYTES = 4 * 1024 * 1024;

// Scope cache and backoff to the database binding, never to a bearer token or caller URL
function stateFor(db: D1Database): State {
  let state = states.get(db);
  if (!state) {
    state = { entries: new Map(), retryAfter: 0, generation: 0 };
    states.set(db, state);
  }
  return state;
}

// Expire local aggregates when identifiable data is erased or archived
export function invalidateReports(db: D1Database): void {
  const state = stateFor(db);
  state.entries.clear();
  state.generation++;
}

// Coalesce identical reads and bound distinct concurrent reports without an additional storage service
async function readCached(env: AnalyticsEnv, url: URL, now: number): Promise<AnalyticsReport> {
  const filters = analyticsFilters(env, url, now);
  const key = JSON.stringify(filters);
  const state = stateFor(env.ANALYTICS_DB);

  for (const [entryKey, entry] of state.entries) {
    if (entry.expires <= now) state.entries.delete(entryKey);
  }

  const cached = state.entries.get(key);
  if (cached) return cached.report;
  if (state.pending?.key === key) return state.pending.promise;
  if (state.pending || now < state.retryAfter) throw new Error("analytics busy");

  const generation = state.generation;
  const started = performance.now();
  const promise = readAnalytics(env, url, now).then((report) => {
    if (generation !== state.generation) throw new Error("analytics changed during read");
    const bytes = new TextEncoder().encode(JSON.stringify(report)).length;
    if (bytes <= MAX_BYTES) {
      let used = [...state.entries.values()].reduce((sum, entry) => sum + entry.bytes, 0);
      while (state.entries.size >= MAX_ENTRIES || used + bytes > MAX_BYTES) {
        const oldest = state.entries.keys().next().value!;
        used -= state.entries.get(oldest)!.bytes;
        state.entries.delete(oldest);
      }
      state.entries.set(key, { report, expires: now + TTL_MS, bytes });
    }
    return report;
  }).catch((error) => {
    state.retryAfter = now + (performance.now() - started) + 30_000;
    throw error;
  }).finally(() => { state.pending = undefined; });

  state.pending = { key, promise };
  return promise;
}

// Measure complete report latency including JavaScript aggregation without persisting filter values
export async function cachedAnalytics(env: AnalyticsEnv, url: URL, now: number): Promise<AnalyticsReport> {
  const started = performance.now();
  let outcome = "error";
  try {
    const report = await readCached(env, url, now);
    outcome = "ok";
    return report;
  } finally {
    if (env.D1_METRICS_ENABLED === "true") {
      try {
        console.info(JSON.stringify({ event: "analytics_report", database: `analytics-${env.PLAY_ENVIRONMENT}`,
          outcome, elapsedMs: Math.round(performance.now() - started) }));
      } catch { /* Diagnostics must not fail a report */ }
    }
  }
}
