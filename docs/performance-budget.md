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
