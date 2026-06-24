/**
 * Tiny in-process request-metrics aggregator (no external APM dep). Records per-route latency +
 * error counts in a bounded ring so /health can report p50/p95/error-rate. Single-process scope —
 * fine for a single-operator agency tool; swap for a real metrics backend at multi-node scale.
 */
const CAP = 500; // latencies kept per route (ring)

interface RouteStat {
  count: number;
  errors: number;
  lat: number[]; // bounded ring of latency ms
}

const routes = new Map<string, RouteStat>();
let total = 0;
let totalErrors = 0;
let lastActivityAt: string | null = null;

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return Math.round(sorted[i]!);
}

/** Record one finished request. `route` should be the matched ROUTE pattern, not the raw URL. */
export function recordRequest(route: string, statusCode: number, latencyMs: number, mutated: boolean): void {
  total += 1;
  const isErr = statusCode >= 500;
  if (isErr) totalErrors += 1;
  const s = routes.get(route) ?? { count: 0, errors: 0, lat: [] };
  s.count += 1;
  if (isErr) s.errors += 1;
  s.lat.push(latencyMs);
  if (s.lat.length > CAP) s.lat.shift();
  routes.set(route, s);
  if (mutated && statusCode < 400) lastActivityAt = new Date().toISOString();
}

export function getLastActivityAt(): string | null {
  return lastActivityAt;
}

export interface RouteMetric {
  route: string;
  count: number;
  p95Ms: number;
  errorRate: number;
}
export interface RequestMetrics {
  total: number;
  errorRate: number;
  p50Ms: number;
  p95Ms: number;
  perRoute: RouteMetric[];
}

export function snapshotMetrics(): RequestMetrics {
  const allLat: number[] = [];
  const perRoute: RouteMetric[] = [];
  for (const [route, s] of routes) {
    const sorted = [...s.lat].sort((a, b) => a - b);
    allLat.push(...s.lat);
    perRoute.push({ route, count: s.count, p95Ms: pct(sorted, 95), errorRate: s.count ? +(s.errors / s.count).toFixed(3) : 0 });
  }
  allLat.sort((a, b) => a - b);
  perRoute.sort((a, b) => b.p95Ms - a.p95Ms);
  return {
    total,
    errorRate: total ? +(totalErrors / total).toFixed(3) : 0,
    p50Ms: pct(allLat, 50),
    p95Ms: pct(allLat, 95),
    perRoute: perRoute.slice(0, 12),
  };
}
