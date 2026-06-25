import { performance } from 'node:perf_hooks';
import { makeSampleSnapshot } from '@disco/core';
import { MemoryAssetStore } from '@disco/sdk';
import type { FastifyInstance } from 'fastify';
import { afterAll, describe, expect, it } from 'vitest';
import { signSession } from '../src/auth.js';
import { runBuildJob } from '../src/buildProcessor.js';
import { JobBus } from '../src/jobChannel.js';
import { InMemoryRepo } from '../src/repo.js';
import { buildServer } from '../src/server.js';

/**
 * #1 LOAD / CONCURRENCY HARNESS — find the knee, don't guess it.
 *
 * The sibling perf.bench.test.ts times ONE request at a time (per-endpoint latency floor). This harness
 * does the opposite: it drives the system under CONCURRENT load along the three axes that actually
 * contend in production and reports p50/p95/p99 + the first thing that degrades.
 *
 *   1. Concurrent BUILDS      — runBuildJob() against MockGuild, ramped 1→2→5→10→20, to find the
 *                               compute knee (builds are the CPU/event-loop-bound path).
 *   2. 50 concurrent handover-view clicks — POST /h/:id/event over a real socket (the write-beacon path).
 *   3. 100 concurrent SSE listeners       — real /activity/stream connections + a measured fan-out.
 *
 * Backend is in-memory + the in-process JobChannel (no Postgres/Redis/Discord token): this measures the
 * APPLICATION's own concurrency behavior. The real-backend break point moves to infra limits (PG pool,
 * Redis subscriber connections) — called out in the printed analysis, not silently implied.
 */

const token = signSession({ email: 'operator@disco.local' });
const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

interface Stats { p50: number; p95: number; p99: number; min: number; max: number; mean: number; n: number }
function summarize(samples: number[]): Stats {
  const s = [...samples].sort((a, b) => a - b);
  const at = (q: number) => s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))]!;
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  return { p50: at(0.5), p95: at(0.95), p99: at(0.99), min: s[0]!, max: s[s.length - 1]!, mean, n: s.length };
}
const fmt = (n: number) => n.toFixed(2);
const log = (m: string) => console.log(m); // eslint-disable-line no-console

const report: string[] = [];

describe('#1 load / concurrency harness', () => {
  const servers: FastifyInstance[] = [];
  afterAll(async () => {
    for (const s of servers) await s.close();
    log(`\n=== LOAD HARNESS (in-process, in-memory repo + JobChannel) ===\n${report.join('\n')}\n`);
  });

  // ── 1. Concurrent build executions, ramped, to find the compute knee ──────────────────────────────
  it('ramps concurrent builds 1→20 and locates the throughput knee', async () => {
    const store = new MemoryAssetStore();
    const snapshot = makeSampleSnapshot();
    const config = { clientId: 'load', findReplace: [], colorMap: [], linkMap: [], assets: {} };

    // Run `c` builds concurrently against a fresh repo/channel; return per-build durations + wall-clock.
    async function runWave(c: number): Promise<{ durations: number[]; wallMs: number }> {
      const repo = new InMemoryRepo(false);
      const channel = new JobBus();
      const ids: string[] = [];
      for (let i = 0; i < c; i++) {
        const job = await repo.addJob({
          kind: 'rebuild', status: 'queued', snapshotId: null, clientId: null, targetGuildId: null,
          dryRun: true, canary: false, rebrandConfig: null, metrics: null, progress: 0, manifest: null,
          report: null, error: null, ownerEmail: 'operator@disco.local',
        });
        ids.push(job.id);
      }
      const t0 = performance.now();
      const durations = await Promise.all(
        ids.map(async (jobId) => {
          const s0 = performance.now();
          const r = await runBuildJob({ jobId, snapshot, config, dryRun: true, targetGuildId: null, contentIdentity: 'server' }, { repo, channel, store, token: '' });
          expect(r.created.length, 'each concurrent build must produce a plan').toBeGreaterThan(0);
          return performance.now() - s0;
        }),
      );
      const wallMs = performance.now() - t0;
      // all jobs landed 'completed'
      for (const id of ids) expect((await repo.getJob(id))?.status).toBe('completed');
      return { durations, wallMs };
    }

    await runWave(2); // discarded warmup: absorb JIT/allocation cold-start so the baseline below is WARM
    const levels = [1, 2, 5, 10, 20];
    const rows: { c: number; stats: Stats; wallMs: number; perBuild: number }[] = [];
    for (const c of levels) {
      const { durations, wallMs } = await runWave(c);
      rows.push({ c, stats: summarize(durations), wallMs, perBuild: wallMs / c });
    }
    // Baseline = the warm steady-state FLOOR (min p50 across levels), not the first wave — otherwise a
    // cold-start-inflated concurrency=1 sample would raise the bar and MASK a real knee (seam r8 LOW).
    const base = Math.min(...rows.map((r) => r.stats.p50));
    report.push('\n[1] CONCURRENT BUILDS (runBuildJob → MockGuild, dry-run)');
    report.push('  concurrency │ per-build p50/p95/p99 (ms) │ wall (ms) │ throughput (builds/s) │ slowdown×');
    for (const r of rows) {
      const tput = (r.c / (r.wallMs / 1000)).toFixed(1);
      report.push(`     ${String(r.c).padStart(3)}      │ ${fmt(r.stats.p50).padStart(7)}/${fmt(r.stats.p95).padStart(7)}/${fmt(r.stats.p99).padStart(7)} │ ${fmt(r.wallMs).padStart(8)} │ ${tput.padStart(10)}         │ ${(r.stats.p50 / base).toFixed(2)}`);
    }
    // The knee = first level where per-build p50 inflates >2× the WARM baseline (real contention).
    const knee = rows.find((r) => r.stats.p50 > base * 2);
    report.push(`  → knee: ${knee ? `per-build latency >2× baseline at concurrency ${knee.c}` : 'none in 1..20 — builds stay near-baseline (CPU headroom)'}`);

    // Sanity budget: 10 concurrent dry-run builds must all finish well under 10s wall-clock in-process.
    const ten = rows.find((r) => r.c === 10)!;
    expect(ten.wallMs, `10 concurrent builds wall-clock ${fmt(ten.wallMs)}ms`).toBeLessThan(10_000);
  });

  // ── 2. 50 concurrent handover-view clicks over a real socket ──────────────────────────────────────
  it('handles 50 concurrent handover-view beacons and records them all', async () => {
    const repo = new InMemoryRepo(false);
    const app = buildServer({ repo, channel: new JobBus() });
    await app.listen({ port: 0, host: '127.0.0.1' });
    servers.push(app);
    const addr = app.server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    const origin = `http://127.0.0.1:${port}`;

    // a delivered (non-draft) handover to click on
    const snap = await repo.addSnapshot({ name: 'L', version: 1, sourceGuildId: 'g', capturedAt: new Date().toISOString(), schemaVersion: makeSampleSnapshot().schemaVersion, snapshot: makeSampleSnapshot(), ownerEmail: 'operator@disco.local' });
    const job = await repo.addJob({ kind: 'rebuild', status: 'completed', snapshotId: snap.id, clientId: null, targetGuildId: null, dryRun: false, canary: false, rebrandConfig: null, metrics: null, progress: 1, manifest: null, report: null, error: null, ownerEmail: 'operator@disco.local' });
    const ho = await repo.addHandover({ jobId: job.id, clientId: null, state: 'ready', logoKey: null, welcomeMessage: '', ownershipSteps: [], upsellStatus: 'none', passwordHash: null, ownerEmail: 'operator@disco.local' });

    const N = 50;
    const latencies = await Promise.all(
      Array.from({ length: N }, async () => {
        const t0 = performance.now();
        const res = await fetch(`${origin}/h/${ho.id}/event`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'docs_viewed' }) });
        const ms = performance.now() - t0;
        expect(res.status, `view beacon returned ${res.status}`).toBeLessThan(300);
        return ms;
      }),
    );
    await new Promise((r) => setTimeout(r, 150)); // let the fire-and-forget recordHandoverView writes drain
    const views = await repo.listHandoverViews(ho.id);
    const stats = summarize(latencies);
    report.push('\n[2] 50 CONCURRENT HANDOVER-VIEW BEACONS (POST /h/:id/event over real socket)');
    report.push(`  latency p50/p95/p99 = ${fmt(stats.p50)}/${fmt(stats.p95)}/${fmt(stats.p99)} ms · recorded ${views.length}/${N}`);
    expect(views.length, 'every concurrent beacon must be persisted (no dropped writes)').toBe(N);
    expect(stats.p95, `view-beacon p95 ${fmt(stats.p95)}ms`).toBeLessThan(250);
  });

  // ── 3. 100 concurrent SSE listeners + fan-out latency ─────────────────────────────────────────────
  it('serves 100 concurrent SSE listeners and fans an activity ping to all of them', async () => {
    const repo = new InMemoryRepo(false);
    const app = buildServer({ repo, channel: new JobBus() });
    await app.listen({ port: 0, host: '127.0.0.1' });
    servers.push(app);
    const addr = app.server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    const origin = `http://127.0.0.1:${port}`;

    // One SSE listener: resolves `connected` when it sees the {type:'open'} prelude (= accept latency),
    // and `pinged` when it sees the first {type:'ping'} fan-out event (= broadcast latency from t0).
    function listen(t0Ref: { t0: number }) {
      const ctl = new AbortController();
      let onOpen = (_: number) => {};
      let onPing = (_: number) => {};
      const connected = new Promise<number>((res) => (onOpen = res));
      const pinged = new Promise<number>((res) => (onPing = res));
      const start = performance.now();
      (async () => {
        const res = await fetch(`${origin}/activity/stream`, { headers: auth, signal: ctl.signal });
        const reader = res.body!.getReader();
        const dec = new TextDecoder();
        let buf = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          if (buf.includes('"type":"open"')) onOpen(performance.now() - start);
          if (buf.includes('"type":"ping"')) { onPing(performance.now() - t0Ref.t0); break; }
        }
      })().catch(() => {});
      return { connected, pinged, close: () => ctl.abort() };
    }

    const N = 100;
    const t0Ref = { t0: 0 };
    const conns = Array.from({ length: N }, () => listen(t0Ref));
    const accept = await Promise.all(conns.map((c) => withTimeout(c.connected, 5000, 'SSE connect')));

    // Trigger one activity ping (POST /clients → pingActivity('client')) and time the fan-out to all 100.
    t0Ref.t0 = performance.now();
    const created = await fetch(`${origin}/clients`, { method: 'POST', headers: auth, body: JSON.stringify({ creatorName: 'Fanout Trigger' }) });
    expect(created.status).toBeLessThan(300);
    const fanout = await Promise.all(conns.map((c) => withTimeout(c.pinged, 5000, 'SSE fanout')));
    for (const c of conns) c.close();

    const acc = summarize(accept);
    const fan = summarize(fanout);
    report.push('\n[3] 100 CONCURRENT SSE LISTENERS (/activity/stream)');
    report.push(`  accept  p50/p95/p99 = ${fmt(acc.p50)}/${fmt(acc.p95)}/${fmt(acc.p99)} ms`);
    report.push(`  fan-out p50/p95/p99 = ${fmt(fan.p50)}/${fmt(fan.p95)}/${fmt(fan.p99)} ms (trigger→all 100 received)`);
    report.push('  → in-process fan-out is O(subscribers) on the event loop; the real-backend ceiling is Redis');
    report.push('    subscriber connections + PG pool, not this number — see docs/performance-budget.md §Load.');
    expect(accept.length).toBe(N);
    expect(fan.p95, `SSE fan-out p95 ${fmt(fan.p95)}ms to 100 listeners`).toBeLessThan(1000);
  });
});

/** Reject if a promise doesn't settle in `ms` — so a stuck SSE socket fails the test instead of hanging it. */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms))]);
}
