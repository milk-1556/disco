import { BUILD_QUEUE, redisConnection } from '@disco/core';
import { MemoryAssetStore } from '@disco/sdk';
import { Worker } from 'bullmq';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signSession } from '../src/auth.js';
import {
  getPrisma,
  PrismaRepo,
  RedisJobChannel,
  runBuildJob,
  seedIfEmpty,
  type JobChannel,
  type Repo,
} from '../src/runtime.js';
import { buildServer } from '../src/server.js';

/**
 * End-to-end through REAL Prisma(Postgres) + BullMQ(Redis): the API enqueues a job → a separate
 * in-process worker (its own repo + Redis channel, exactly like the deployed worker) consumes it,
 * runs the engine, and writes results to Postgres → the API reads them back, and the SSE log stream
 * delivers the events cross-process. Proves §5 of the wire-up plan.
 */
describe('queue + persistence end-to-end (Postgres + Redis)', () => {
  let app: FastifyInstance;
  let worker: Worker;
  let apiChannel: JobChannel & { close?: () => Promise<void> };
  let repo: Repo;
  let baseUrl: string;
  let token: string;
  let snapshotId: string;
  const createdJobs: string[] = [];

  beforeAll(async () => {
    repo = new PrismaRepo();
    await seedIfEmpty(repo);
    snapshotId = (await repo.listSnapshots())[0]!.id;

    // The worker: independent repo + Redis channel + asset store, same Redis/Postgres as the API.
    const workerDeps = { repo: new PrismaRepo(), channel: new RedisJobChannel(), store: new MemoryAssetStore(), token: '' };
    worker = new Worker(BUILD_QUEUE, (job) => runBuildJob(job.data, workerDeps), {
      connection: redisConnection(),
      concurrency: 2,
    });
    await worker.waitUntilReady();

    apiChannel = new RedisJobChannel();
    app = buildServer({ repo, channel: apiChannel });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    baseUrl = typeof addr === 'object' && addr ? `http://127.0.0.1:${addr.port}` : '';
    token = signSession({ email: 'operator@disco.local' });
  });

  afterAll(async () => {
    if (createdJobs.length) await getPrisma().job.deleteMany({ where: { id: { in: createdJobs } } }).catch(() => {});
    await worker?.close();
    await apiChannel?.close?.();
    await app?.close();
    await getPrisma().$disconnect();
  });

  const post = (path: string, body: unknown) =>
    fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  const get = (path: string) => fetch(`${baseUrl}${path}`, { headers: { authorization: `Bearer ${token}` } });

  const config = {
    clientId: 'client_int',
    serverName: 'Nova Slots HQ',
    findReplace: [{ from: 'Acme', to: 'Nova' }],
    colorMap: [{ from: '#7C3AED', to: '#E11D48' }],
    linkMap: [],
    assets: {},
  };

  it('enqueues → worker executes → result persisted → API reads it back', async () => {
    const res = await post('/jobs', { snapshotId, config, dryRun: true });
    expect(res.status).toBe(200);
    const { id } = (await res.json()) as { id: string };
    createdJobs.push(id);

    // Poll the API (reading Postgres) until the worker finishes.
    let job: { status: string; progress: number; report: { created: string[] } | null; manifest: unknown } | undefined;
    for (let i = 0; i < 60; i++) {
      job = (await (await get(`/jobs/${id}`)).json()) as typeof job;
      if (job && (job.status === 'completed' || job.status === 'failed')) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    expect(job?.status).toBe('completed');
    expect(job?.progress).toBe(1);
    expect(job?.report?.created.some((c) => c.includes('rules'))).toBe(true);
    expect(job?.manifest).toBeTruthy(); // manifest checkpoint persisted by the worker
  });

  it('streams cross-process logs over SSE and ends with done', async () => {
    const res = await post('/jobs', { snapshotId, config, dryRun: true });
    const { id } = (await res.json()) as { id: string };
    createdJobs.push(id);

    const stream = await get(`/jobs/${id}/logs`);
    const reader = stream.body!.getReader();
    const dec = new TextDecoder();
    const types = new Set<string>();
    let buf = '';
    const deadline = Date.now() + 20000;
    outer: while (Date.now() < deadline) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split('\n\n');
      buf = parts.pop() ?? '';
      for (const p of parts) {
        const line = p.replace(/^data: /, '').trim();
        if (!line) continue;
        const ev = JSON.parse(line) as { type: string };
        types.add(ev.type);
        if (ev.type === 'done' || ev.type === 'error') break outer;
      }
    }
    await reader.cancel().catch(() => {});
    expect(types.has('log')).toBe(true);
    expect(types.has('progress')).toBe(true);
    expect(types.has('done')).toBe(true);
  });

  it('short-circuits SSE for an already-finished job (no hang after the log TTL)', async () => {
    const res = await post('/jobs', { snapshotId, config, dryRun: true });
    const { id } = (await res.json()) as { id: string };
    createdJobs.push(id);
    // wait for completion
    for (let i = 0; i < 60; i++) {
      const j = (await (await get(`/jobs/${id}`)).json()) as { status: string };
      if (j.status === 'completed' || j.status === 'failed') break;
      await new Promise((r) => setTimeout(r, 250));
    }
    // a fresh SSE connection must still terminate with a synthetic done
    const stream = await get(`/jobs/${id}/logs`);
    const reader = stream.body!.getReader();
    const dec = new TextDecoder();
    let sawDone = false;
    let buf = '';
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      if (/"type":"done"/.test(buf)) {
        sawDone = true;
        break;
      }
    }
    await reader.cancel().catch(() => {});
    expect(sawDone).toBe(true);
  });
});
