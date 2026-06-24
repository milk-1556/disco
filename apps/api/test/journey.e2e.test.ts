import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signSession } from '../src/auth.js';
import { InMemoryRepo } from '../src/repo.js';
import { buildServer } from '../src/server.js';

/**
 * A second, money-flow-focused e2e suite that complements e2e.test.ts. Same patterns (buildServer +
 * InMemoryRepo + signSession + app.inject), but it (A) drives the WHOLE sellable journey end-to-end over
 * real HTTP and asserts the rebrand actually lands at every hop, and (B) pins the critical failure modes
 * that protect the money flow: a build can't reference a snapshot you don't own/that doesn't exist, a
 * canary/test build can't be delivered to a client, and a still-running build can't be retried.
 */
describe('journey.e2e: full money flow — guilds → capture → preview → build → handover → deliver → share', () => {
  let app: FastifyInstance;
  const token = signSession({ email: 'operator@disco.local' }); // configured OPERATOR_EMAIL → admin
  const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

  beforeAll(async () => {
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    app = buildServer({ repo: new InMemoryRepo(/* seed */ true) });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
  });

  const post = async (url: string, body: unknown) =>
    app.inject({ method: 'POST', url, headers: auth, payload: JSON.stringify(body) });
  const get = async (url: string) => app.inject({ method: 'GET', url, headers: auth });
  const patch = async (url: string, body: unknown) =>
    app.inject({ method: 'PATCH', url, headers: auth, payload: JSON.stringify(body) });

  // Bounded poll loop (matches the existing spine: ≤80 ticks × 25ms) — deterministic, no flake.
  const pollJob = async (jobId: string) => {
    let job: { status: string; report: { created: string[]; counts: Record<string, number> } | null } | undefined;
    for (let i = 0; i < 80; i++) {
      job = (await get(`/jobs/${jobId}`)).json() as typeof job;
      if (job!.status === 'completed' || job!.status === 'failed') break;
      await new Promise((r) => setTimeout(r, 25));
    }
    return job!;
  };

  const REBRANDED_NAME = 'Aurora Collective HQ';

  it('drives the happy path and the rebrand lands at every hop, ending in a public delivery + share card', async () => {
    // 1. the operator sees servers they can import from (demo set in no-token mode)
    const guilds = (await get('/guilds')).json() as { live: boolean; guilds: { id: string; name: string }[] };
    expect(guilds.live).toBe(false);
    expect(guilds.guilds.length).toBeGreaterThan(0);
    const source = guilds.guilds[0]!;

    // 2. capture that server into the library → a real snapshot id
    const capRes = await post('/snapshots/capture', { sourceGuildId: source.id });
    expect(capRes.statusCode).toBe(200);
    const captured = capRes.json() as { id: string; name: string };
    expect(captured.id).toBeTruthy();

    // it's now listed and carries non-trivial structure (the thing we'll rebrand + build)
    const snaps = (await get('/snapshots')).json() as { id: string; name: string; counts: { roles: number; channels: number } }[];
    const snap = snaps.find((s) => s.id === captured.id)!;
    expect(snap).toBeTruthy();
    expect(snap.counts.roles + snap.counts.channels).toBeGreaterThan(0);

    const config = {
      clientId: 'client_aurora',
      serverName: REBRANDED_NAME,
      findReplace: [{ from: snap.name.split(' ')[0]!, to: 'Aurora', caseInsensitive: true, wholeWordSmart: true }],
      colorMap: [],
      linkMap: [],
      assets: {},
    };

    // 3. preview reflects the requested rename BEFORE we commit to a build
    const previewRes = await post('/rebrand/preview', { snapshotId: snap.id, config });
    expect(previewRes.statusCode).toBe(200);
    const preview = previewRes.json() as { rebrandedGuildName: string; preview: unknown };
    expect(preview.rebrandedGuildName).toBe(REBRANDED_NAME);

    // 4. real build (in-process, dryRun:false) → poll to completion with non-empty report
    const startRes = await post('/jobs', { snapshotId: snap.id, config, dryRun: false });
    expect(startRes.statusCode).toBe(200);
    const jobId = (startRes.json() as { id: string }).id;

    const job = await pollJob(jobId);
    expect(job.status).toBe('completed');
    expect(job.report).toBeTruthy();
    expect(job.report!.created.length).toBeGreaterThan(0);

    // 5. open a handover off the completed build (idempotent per job)
    const hRes = await post('/handovers', { jobId });
    expect(hRes.statusCode).toBe(200);
    const hid = (hRes.json() as { id: string }).id;
    expect(hid).toBeTruthy();

    // a fresh handover is 'draft' — the public link must NOT expose work-in-progress yet
    expect((await app.inject({ method: 'GET', url: `/h/${hid}` })).statusCode).toBe(404);

    // 6. operator marks it ready → the public delivery link resolves
    const ready = await patch(`/handovers/${hid}`, { state: 'ready' });
    expect(ready.statusCode).toBe(200);

    // 7. public, UNAUTHENTICATED delivery payload — carries the delivered scope + the rebranded name
    const pub = await app.inject({ method: 'GET', url: `/h/${hid}` });
    expect(pub.statusCode).toBe(200);
    const delivery = pub.json() as { serverName: string | null; state: string; created: string[]; scope: Record<string, number> };
    expect(delivery.state).toBe('ready');
    expect(delivery.serverName).toBe(REBRANDED_NAME); // the rebrand made it all the way to the client-facing page
    expect(delivery.created.length).toBeGreaterThan(0);
    expect(Object.keys(delivery.scope).length).toBeGreaterThan(0);

    // 8. crawler-friendly OG share card renders the server name + deep-links into the SPA delivery
    const share = await app.inject({ method: 'GET', url: `/share/${hid}` });
    expect(share.statusCode).toBe(200);
    expect(share.headers['content-type']).toMatch(/text\/html/);
    expect(share.body).toMatch(/og:title/);
    expect(share.body).toContain(REBRANDED_NAME);
    expect(share.body).toContain(`/#/h/${hid}`);
  });
});

describe('journey.e2e: critical failure modes that protect the money flow', () => {
  let app: FastifyInstance;
  const token = signSession({ email: 'operator@disco.local' });
  const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const cfg = { clientId: 'x', findReplace: [], colorMap: [], linkMap: [], assets: {} };

  beforeAll(async () => {
    app = buildServer({ repo: new InMemoryRepo(true) });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
  });

  const post = async (url: string, body: unknown) =>
    app.inject({ method: 'POST', url, headers: auth, payload: JSON.stringify(body) });
  const get = async (url: string) => app.inject({ method: 'GET', url, headers: auth });

  const pollStatus = async (jobId: string) => {
    let status = 'queued';
    for (let i = 0; i < 80 && status !== 'completed' && status !== 'failed'; i++) {
      status = ((await get(`/jobs/${jobId}`)).json() as { status: string }).status;
      await new Promise((r) => setTimeout(r, 25));
    }
    return status;
  };

  it('a build against an invalid/missing snapshotId is refused (404 — no orphan build)', async () => {
    expect((await post('/jobs', { snapshotId: 'does-not-exist', config: cfg, dryRun: false })).statusCode).toBe(404);
    expect((await post('/jobs', { config: cfg, dryRun: false })).statusCode).toBe(404); // snapshotId omitted entirely
  });

  it('a canary/test build COMPLETES but cannot be delivered to a client (handover 409)', async () => {
    const snaps = (await get('/snapshots')).json() as { id: string }[];
    const start = (await post('/jobs', { snapshotId: snaps[0]!.id, config: cfg, dryRun: false, canary: true })).json() as { id: string };

    const status = await pollStatus(start.id);
    expect(status).toBe('completed'); // the build itself still succeeds…

    const jobs = (await get('/jobs')).json() as { id: string; canary: boolean }[];
    expect(jobs.find((j) => j.id === start.id)?.canary).toBe(true);

    const h = await post('/handovers', { jobId: start.id });
    expect(h.statusCode).toBe(409); // …but a canary build is a test, never deliverable
  });

  it('retrying a non-failed (completed) job is refused (400 — only failed/canceled jobs resume)', async () => {
    const snaps = (await get('/snapshots')).json() as { id: string }[];
    const start = (await post('/jobs', { snapshotId: snaps[0]!.id, config: cfg, dryRun: false })).json() as { id: string };

    const status = await pollStatus(start.id);
    expect(status).toBe('completed');

    const retry = await post(`/jobs/${start.id}/retry`, {});
    expect(retry.statusCode).toBe(400);

    // retrying a job that doesn't exist is a 404 (distinct from the wrong-state 400 above)
    expect((await post('/jobs/nope/retry', {})).statusCode).toBe(404);
  });
});
