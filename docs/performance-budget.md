# Performance budget (#3)

**Measure, don't speculate.** This document records real, measured latencies for Disco's hottest API
endpoints against per-endpoint p95 budgets. The numbers below are produced by an executable benchmark —
not estimates — so a regression is caught by a failing test, not by a guess.

- **Benchmark:** [`apps/api/test/perf.bench.test.ts`](../apps/api/test/perf.bench.test.ts)
- **Run it:** `cd apps/api && npx vitest run test/perf.bench.test.ts`
- **Last measured:** 2026-06-24 (Apple M1, Node, in-process)

## Budget table

| Endpoint | Scenario | Budget p95 | Measured p50 | **Measured p95** | Measured p99 | Status |
|---|---|---:|---:|---:|---:|:--:|
| `GET /jobs` | N=100 jobs+snapshots | ≤ 50 ms | 0.34 ms | **0.63 ms** | 1.18 ms | ✅ PASS |
| `GET /snapshots` | N=100 snapshots | ≤ 50 ms | 0.28 ms | **0.53 ms** | 1.31 ms | ✅ PASS |
| `POST /jobs` (enqueue, dryRun) | N=100 | ≤ 100 ms | 0.50 ms | **1.37 ms** | 2.96 ms | ✅ PASS |
| `GET /snapshots/:id/feasibility` | N=100 (pre-flight) | ≤ 50 ms | 0.10 ms | **0.17 ms** | 0.23 ms | ✅ PASS |
| `GET /jobs` | N=1 (scaling baseline) | ≤ 50 ms | 0.08 ms | **0.15 ms** | 0.34 ms | ✅ PASS |

> Run-to-run p95 varies by a few tenths of a millisecond (GC, scheduler jitter). Across repeated runs
> every endpoint stays **one-to-two orders of magnitude under budget** — the table reflects a
> representative run; re-run the benchmark for fresh actuals.

**Result: nothing exceeds budget.** Every endpoint clears its p95 threshold with > 35× of headroom; the
tightest is `POST /jobs` at 1.37 ms against a 100 ms budget (~73× headroom).

## Scaling: N=1 → N=100

`GET /jobs` is the hottest endpoint (the dashboard polls it). Going from 1 to 100 rows:

```
GET /jobs  N=1  p50 = 0.08 ms   →   N=100  p50 = 0.34 ms
```

A 100× increase in row count yields only a ~4× increase in p50 latency — the endpoint scales
**sub-linearly** and stays far below budget. This is expected: the list path is a single in-memory map
walk plus a cheap `id → name` join (`snapshotNames()` deliberately avoids deserializing snapshot
artifact blobs — see the comment at `GET /jobs` in `apps/api/src/server.ts`), so per-row cost is tiny
and dominated by fixed request overhead (routing, the owner-scoping wrapper, JSON serialization).

## Methodology

- **Harness:** Fastify `app.inject()` (no socket/network), timed with `node:perf_hooks` `performance.now()`.
  This isolates the API's own per-request cost — routing + the `scopeRepo` owner-scoping chokepoint +
  repo access + serialization — and deliberately excludes network, TLS, and reverse-proxy latency, which
  are environment-specific and not what an application budget should police.
- **Backend:** the in-memory `InMemoryRepo` (no Postgres, no Redis, no Discord token — demo mode). The
  in-memory store is the floor for repo cost; the Prisma/Postgres backend will add DB round-trip time on
  top and should get its own integration-level budget if/when it becomes the hot path.
- **Seeding:** N snapshots + N jobs are inserted directly through the repo **before** the server is
  built (clean repo, `seed=false`, so N is exact). Each job references a real seeded snapshot so the
  `GET /jobs` name-join does real work.
- **Sampling:** each endpoint is warmed up 25× (JIT + allocation warmup), then sampled **200×**. We
  report p50/p95/p99 from the sorted sample. Every sampled call's HTTP status is asserted (200), so a
  silently-failing fast path can't masquerade as good latency.
- **Auth principal:** the admin operator (`operator@disco.local`), which **bypasses** owner-scoping —
  the worst case for data visibility (it sees all seeded rows, so the list/serialize work is maximal).

## Worst-regression callout

**None.** No endpoint is over — or even near — its budget on the last run. The closest-to-budget
endpoint by absolute p95 is `POST /jobs` at **1.37 ms vs a 100 ms budget**; by ratio every endpoint sits
under ~3% of its allowance. If a future change pushes any p95 over budget, the benchmark's
`expect(...).toBeLessThanOrEqual(budget)` assertions fail the test and name the offending endpoint, and
this section should be updated to call out the regression (endpoint, measured p95, budget, and the
suspected cause).

### If a budget is ever blown

1. Re-run `npx vitest run test/perf.bench.test.ts` to confirm it's not jitter.
2. Check whether the offending endpoint started deserializing snapshot artifact blobs in a list path
   (the classic O(n) blob-parse trap `snapshotNames()` was introduced to avoid).
3. Check the `scopeRepo` wrapper for an accidental O(n²) filter (e.g. a per-row ownership re-fetch).
4. Only after fixing the cause — never by loosening the budget to make the table green.

---

# Load & concurrency (#1)

The benchmark above times **one request at a time** — the latency floor. This section measures the
opposite: the system under **concurrent load** along the three axes that actually contend in production,
and reports where the first thing degrades.

- **Harness:** [`apps/api/test/load.harness.test.ts`](../apps/api/test/load.harness.test.ts)
- **Run it:** `cd apps/api && npx vitest run test/load.harness.test.ts` (the printed report block is the
  source of truth; numbers below are a representative M1 run, 2026-06-25)
- **Backend:** in-memory repo + the in-process `JobBus` — no Postgres/Redis/Discord token. This isolates
  the **application's own** concurrency behavior; the real-backend ceiling is infra (see §Where it breaks).

## 1. Concurrent builds — `runBuildJob()` against MockGuild (dry-run), ramped

| Concurrency | per-build p50 | p95 | p99 | wall | throughput | slowdown× |
|---:|---:|---:|---:|---:|---:|---:|
| 1  | 2.54 ms | 2.54 | 2.54 | 2.56 ms | 390 builds/s | 1.00 |
| 2  | 0.89 ms | 0.89 | 0.89 | 0.91 ms | 2202 builds/s | 0.35 |
| 5  | 1.63 ms | 1.64 | 1.64 | 1.67 ms | 3000 builds/s | 0.64 |
| 10 | 2.85 ms | 2.88 | 2.88 | 2.92 ms | 3425 builds/s | 1.12 |
| 20 | 4.33 ms | 4.41 | 4.41 | 4.44 ms | 4505 builds/s | 1.71 |

Throughput rises monotonically to 20 — the in-process compute path has headroom well past the
10-concurrent target. **Caveat (the real finding):** at concurrency 20 the *tail* becomes GC-sensitive
and bimodal run-to-run — a representative second run spiked p99 from ~4 ms to ~20 ms (an 8× slowdown) on
a garbage-collection pause, while median stayed flat. So **~10 concurrent in-process builds is the
comfortable ceiling**; past that, expect GC-driven tail spikes and scale horizontally (more workers)
rather than packing one process. The harness asserts 10 concurrent dry-run builds finish < 10 s wall.

## 2. 50 concurrent handover-view beacons — `POST /h/:id/event` over a real socket

| Metric | Value |
|---|---|
| latency p50 / p95 / p99 | **38.9 / 42.0 / 42.4 ms** |
| writes recorded | **50 / 50** (zero dropped) |

The write-beacon path absorbs 50 simultaneous clicks with every view persisted and p95 ~42 ms (dominated
by real-socket round-trip, not repo cost). The harness asserts all 50 are recorded and p95 < 250 ms.

## 3. 100 concurrent SSE listeners — `/activity/stream` + measured fan-out

| Metric | p50 | p95 | p99 |
|---|---:|---:|---:|
| connection accept | 28.9 ms | 35.6 ms | 36.1 ms |
| **fan-out** (1 ping → all 100 receive) | **3.4 ms** | 4.2 ms | 4.4 ms |

100 listeners connect and a single `pingActivity` fans out to all of them in ~4 ms p95. The harness
asserts all 100 connect and fan-out p95 < 1 s.

## Where it breaks first

In-process, **nothing in the 10-build / 50-click / 100-listener envelope breaks** — the application layer
has headroom. The first real ceiling is **infrastructure this harness deliberately does not stub**, in
likely order:

1. **BullMQ worker concurrency** — real builds run in the worker, not the API; throughput is gated by
   how many workers × their concurrency setting, not by the in-process numbers above.
2. **Postgres connection pool** — under the Prisma backend, concurrent builds each hold a connection for
   their checkpoint writes; the pool size (not CPU) caps simultaneous in-flight builds.
3. **Redis subscriber connections** — each SSE listener holds a pub/sub subscription; at thousands of
   concurrent delivery pages, Redis `maxclients` / file descriptors bound it, not the ~4 ms fan-out.
4. **GC tail latency** — already visible at ~20 in-process builds (above); a single-process box should
   cap build concurrency to ~10 and scale out.

These are named, not measured, because measuring them requires the live infra and would make the test
flaky/non-hermetic. When the Prisma+Redis backend becomes the hot path, give it its own integration-level
load test with the real pool sizes — that is where a production budget for these limits belongs.
