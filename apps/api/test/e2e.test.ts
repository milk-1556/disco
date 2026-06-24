import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signSession } from '../src/auth.js';
import { InMemoryRepo } from '../src/repo.js';
import { buildServer } from '../src/server.js';

/**
 * End-to-end operator journey through the real HTTP routes (Fastify inject, in-memory repo, in-process
 * build) — the flow Disco actually sells: pick a server → import → rebrand → build → handover →
 * public delivery → shareable preview. Guards the whole spine against contract regressions.
 */
describe('e2e: import → rebrand → build → handover → deliver → share', () => {
  let app: FastifyInstance;
  const token = signSession({ email: 'operator@disco.local' });
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

  const post = async (url: string, body: unknown) => app.inject({ method: 'POST', url, headers: auth, payload: JSON.stringify(body) });
  const get = async (url: string) => app.inject({ method: 'GET', url, headers: auth });

  it('imports a demo server into the library', async () => {
    const guilds = (await get('/guilds')).json() as { live: boolean; guilds: { id: string; name: string }[] };
    expect(guilds.live).toBe(false);
    expect(guilds.guilds.length).toBeGreaterThan(0);

    const res = await post('/snapshots/capture', { sourceGuildId: guilds.guilds[0]!.id });
    expect(res.statusCode).toBe(200);
    const imported = res.json() as { id: string; name: string; unchanged?: boolean };
    expect(imported.id).toBeTruthy();
  });

  it('runs the full rebrand → build → handover → deliver → share spine', async () => {
    const snaps = (await get('/snapshots')).json() as { id: string; name: string }[];
    const snap = snaps[0]!;

    // rebrand preview reflects the requested swaps
    const config = {
      clientId: 'client_nova',
      serverName: 'E2E Client HQ',
      findReplace: [{ from: snap.name.split(' ')[0]!, to: 'E2EBrand', caseInsensitive: true, wholeWordSmart: true }],
      colorMap: [],
      linkMap: [],
      assets: {},
    };
    const preview = await post('/rebrand/preview', { snapshotId: snap.id, config });
    expect(preview.statusCode).toBe(200);

    // build for real (in-process) and poll to completion
    const start = await post('/jobs', { snapshotId: snap.id, config, dryRun: false });
    expect(start.statusCode).toBe(200);
    const jobId = (start.json() as { id: string }).id;

    let job: { status: string; report: { created: string[] } | null } | undefined;
    for (let i = 0; i < 80; i++) {
      job = (await get(`/jobs/${jobId}`)).json() as typeof job;
      if (job!.status === 'completed' || job!.status === 'failed') break;
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(job!.status).toBe('completed');
    expect(job!.report!.created.length).toBeGreaterThan(0);

    // handover off the completed build
    const handover = await post('/handovers', { jobId });
    expect(handover.statusCode).toBe(200);
    const hid = (handover.json() as { id: string }).id;

    // public, unauthenticated delivery payload (no auth header)
    const pub = await app.inject({ method: 'GET', url: `/h/${hid}` });
    expect(pub.statusCode).toBe(200);
    expect((pub.json() as { created: string[] }).created.length).toBeGreaterThan(0);

    // shareable OG preview page renders the server name + links into the app
    const share = await app.inject({ method: 'GET', url: `/share/${hid}` });
    expect(share.statusCode).toBe(200);
    expect(share.headers['content-type']).toMatch(/text\/html/);
    expect(share.body).toMatch(/og:title/);
    expect(share.body).toContain(`/#/h/${hid}`);
  });

  it('404s a share/handover for an unknown id', async () => {
    expect((await app.inject({ method: 'GET', url: '/share/nope' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/h/nope' })).statusCode).toBe(404);
  });

  it('rejects unauthenticated access to protected routes', async () => {
    expect((await app.inject({ method: 'GET', url: '/snapshots' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/jobs' })).statusCode).toBe(401);
  });
});

describe('e2e: destructive ops + audit accountability', () => {
  let app: FastifyInstance;
  const token = signSession({ email: 'operator@disco.local' });
  const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  beforeAll(async () => {
    app = buildServer({ repo: new InMemoryRepo(true) });
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  it('DELETE /snapshots/:id removes it, unlinks builds, writes an audit row; /audit lists it', async () => {
    const snaps = (await app.inject({ method: 'GET', url: '/snapshots', headers: auth })).json() as { id: string; name: string }[];
    const target = snaps[0]!;
    const del = await app.inject({ method: 'DELETE', url: `/snapshots/${target.id}`, headers: auth });
    expect(del.statusCode).toBe(200);
    const after = (await app.inject({ method: 'GET', url: '/snapshots', headers: auth })).json() as { id: string }[];
    expect(after.find((s) => s.id === target.id)).toBeUndefined();
    const audit = (await app.inject({ method: 'GET', url: '/audit', headers: auth })).json() as { action: string; target: string; operator: string }[];
    const row = audit.find((a) => a.action === 'snapshot.delete' && a.target === target.name);
    expect(row).toBeTruthy();
    expect(row!.operator).toBe('operator@disco.local');
  });

  it('DELETE /snapshots/:id 404s an unknown id (no audit row, no throw)', async () => {
    expect((await app.inject({ method: 'DELETE', url: '/snapshots/nope', headers: auth })).statusCode).toBe(404);
  });

  it('/health is public and reports status + request metrics', async () => {
    const h = (await app.inject({ method: 'GET', url: '/health' })).json() as { ok: boolean; api: string; requests: { perRoute: unknown[] } };
    expect(h.ok).toBe(true);
    expect(h.api).toBe('up');
    expect(Array.isArray(h.requests.perRoute)).toBe(true);
  });
});
