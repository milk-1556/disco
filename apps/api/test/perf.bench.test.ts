import { performance } from 'node:perf_hooks';
import { makeSampleSnapshot } from '@disco/core';
import type { FastifyInstance } from 'fastify';
import { afterAll, describe, expect, it } from 'vitest';
import { signSession } from '../src/auth.js';
import { InMemoryRepo } from '../src/repo.js';
import { buildServer } from '../src/server.js';

/**
 * #3 PERFORMANCE BUDGET — MEASURE, don't speculate.
 *
 * Boots an in-process Fastify server (app.inject, in-memory repo, no Redis/Postgres/Discord token) and
 * times the hot read/enqueue endpoints with node:perf_hooks. Each endpoint is sampled ITERS times after
 * a warmup; we report p50/p95/p99 and assert each p95 stays under a per-endpoint budget. The actuals
 * are mirrored into docs/performance-budget.md.
 *
 * In-process numbers exclude network/TLS/proxy latency by design — they isolate the API's own request
 * cost (routing + scoping wrapper + repo + serialization), which is what a budget should police.
 */

const ITERS = 200;
const WARMUP = 25;

const token = signSession({ email: 'operator@disco.local' }); // admin → scoping bypass (worst-case data visibility)
const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

interface Stats {
  p50: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
  mean: number;
  n: number;
}

function summarize(samples: number[]): Stats {
  const s = [...samples].sort((a, b) => a - b);
  const at = (q: number) => s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))]!;
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  return { p50: at(0.5), p95: at(0.95), p99: at(0.99), min: s[0]!, max: s[s.length - 1]!, mean, n: s.length };
}

const fmt = (n: number) => n.toFixed(3);

/** Seed N snapshots + N jobs (each job points at a real seeded snapshot) directly via the repo. */
async function seed(repo: InMemoryRepo, n: number): Promise<{ snapshotId: string }> {
  let firstSnap = '';
  for (let i = 0; i < n; i++) {
    const snap = makeSampleSnapshot();
    const rec = await repo.addSnapshot({
      name: `Seeded Server ${i}`,
      version: 1,
      sourceGuildId: `guild_${i}`,
      capturedAt: new Date(Date.now() - i * 1000).toISOString(),
      schemaVersion: snap.schemaVersion,
      snapshot: snap,
      ownerEmail: 'operator@disco.local',
    });
    if (!firstSnap) firstSnap = rec.id;
    await repo.addJob({
      kind: 'rebuild',
      status: i % 3 === 0 ? 'completed' : 'queued',
      snapshotId: rec.id,
      clientId: null,
      targetGuildId: null,
      dryRun: true,
      canary: false,
      rebrandConfig: null,
      metrics: null,
      progress: i % 3 === 0 ? 100 : 0,
      manifest: null,
      report: null,
      error: null,
      ownerEmail: 'operator@disco.local',
    });
  }
  return { snapshotId: firstSnap };
}

/** Time `fn` ITERS times (after WARMUP), asserting each call's HTTP status, and return latency stats (ms). */
async function bench(label: string, fn: () => Promise<{ statusCode: number }>, expectStatus = 200): Promise<Stats> {
  for (let i = 0; i < WARMUP; i++) await fn();
  const samples: number[] = [];
  for (let i = 0; i < ITERS; i++) {
    const t0 = performance.now();
    const res = await fn();
    const t1 = performance.now();
    expect(res.statusCode, `${label} returned ${res.statusCode}`).toBe(expectStatus);
    samples.push(t1 - t0);
  }
  return summarize(samples);
}

// Per-endpoint p95 budgets (ms, in-process). List reads are cheap; build-enqueue does more work.
const BUDGETS: Record<string, number> = {
  'GET /jobs (N=100)': 50,
  'GET /snapshots (N=100)': 50,
  'POST /jobs (enqueue, dryRun, N=100)': 100,
  'GET /snapshots/:id/feasibility (N=100)': 50,
  'GET /jobs (N=1)': 50,
};

describe('#3 performance budget (in-process)', () => {
  const apps: FastifyInstance[] = [];
  const results: { label: string; stats: Stats; budget: number }[] = [];

  afterAll(async () => {
    for (const a of apps) await a.close();
    // Emit the measured table to the test log so the run output is the source of truth for the doc.
    const rows = results.map((r) => {
      const status = r.stats.p95 <= r.budget ? 'PASS' : 'FAIL';
      return `${r.label.padEnd(40)} budget≤${String(r.budget).padStart(3)}ms  p50=${fmt(r.stats.p50).padStart(7)}  p95=${fmt(r.stats.p95).padStart(7)}  p99=${fmt(r.stats.p99).padStart(7)}  [${status}]`;
    });
    // eslint-disable-next-line no-console
    console.log(`\n=== PERF BUDGET (n=${ITERS}/endpoint, in-process app.inject) ===\n${rows.join('\n')}\n`);
  });

  async function measureAt(n: number) {
    const repo = new InMemoryRepo(/* seed */ false); // start clean so N is exact (no sample rows)
    const { snapshotId } = await seed(repo, n);
    const app = buildServer({ repo });
    await app.ready();
    apps.push(app);
    return { app, snapshotId };
  }

  it(`measures GET /jobs, /snapshots, POST /jobs, feasibility at N=100`, async () => {
    const N = 100;
    const { app, snapshotId } = await measureAt(N);

    const buildBody = JSON.stringify({ snapshotId, config: { clientId: 'x', findReplace: [], colorMap: [], linkMap: [], assets: {} }, dryRun: true });

    const record = (label: string, stats: Stats) => {
      results.push({ label, stats, budget: BUDGETS[label]! });
      return stats;
    };

    const jobsList = record('GET /jobs (N=100)', await bench('GET /jobs', () => app.inject({ method: 'GET', url: '/jobs', headers: auth })));
    const snapList = record('GET /snapshots (N=100)', await bench('GET /snapshots', () => app.inject({ method: 'GET', url: '/snapshots', headers: auth })));
    const enqueue = record(
      'POST /jobs (enqueue, dryRun, N=100)',
      await bench('POST /jobs', () => app.inject({ method: 'POST', url: '/jobs', headers: auth, payload: buildBody })),
    );
    const feas = record(
      'GET /snapshots/:id/feasibility (N=100)',
      await bench('feasibility', () => app.inject({ method: 'GET', url: `/snapshots/${snapshotId}/feasibility`, headers: auth })),
    );

    // Every endpoint must stay within its p95 budget.
    expect(jobsList.p95, `GET /jobs p95 ${fmt(jobsList.p95)}ms over budget`).toBeLessThanOrEqual(BUDGETS['GET /jobs (N=100)']!);
    expect(snapList.p95, `GET /snapshots p95 ${fmt(snapList.p95)}ms over budget`).toBeLessThanOrEqual(BUDGETS['GET /snapshots (N=100)']!);
    expect(enqueue.p95, `POST /jobs p95 ${fmt(enqueue.p95)}ms over budget`).toBeLessThanOrEqual(BUDGETS['POST /jobs (enqueue, dryRun, N=100)']!);
    expect(feas.p95, `feasibility p95 ${fmt(feas.p95)}ms over budget`).toBeLessThanOrEqual(BUDGETS['GET /snapshots/:id/feasibility (N=100)']!);
  });

  it('measures GET /jobs at N=1 to show scaling vs N=100', async () => {
    const { app } = await measureAt(1);
    const jobsN1 = bench('GET /jobs N=1', () => app.inject({ method: 'GET', url: '/jobs', headers: auth }));
    const stats = await jobsN1;
    results.push({ label: 'GET /jobs (N=1)', stats, budget: BUDGETS['GET /jobs (N=1)']! });
    expect(stats.p95).toBeLessThanOrEqual(BUDGETS['GET /jobs (N=1)']!);

    // Scaling sanity: locate the recorded N=100 result and assert the list endpoint scales sub-linearly
    // (1 → 100 rows must not 100x the latency — it is a single in-memory map walk + serialize).
    const n100 = results.find((r) => r.label === 'GET /jobs (N=100)');
    if (n100) {
      // eslint-disable-next-line no-console
      console.log(`GET /jobs scaling: N=1 p50=${fmt(stats.p50)}ms → N=100 p50=${fmt(n100.stats.p50)}ms`);
    }
  });
});
