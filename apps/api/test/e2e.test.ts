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

    // a fresh handover is 'draft' — the public link must NOT expose work-in-progress (SEC fix)
    expect((await app.inject({ method: 'GET', url: `/h/${hid}` })).statusCode).toBe(404);

    // operator marks it ready → now the public delivery link resolves
    await app.inject({ method: 'PATCH', url: `/handovers/${hid}`, headers: auth, payload: JSON.stringify({ state: 'ready' }) });

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

describe('e2e: multi-operator audit scoping (#6) + canary build (#9)', () => {
  let app: FastifyInstance;
  const adminTok = signSession({ email: 'operator@disco.local' }); // the configured operator → admin
  const opTok = signSession({ email: 'second@disco.local' }); // a 2nd operator → scoped
  const admin = { authorization: `Bearer ${adminTok}`, 'content-type': 'application/json' };
  const op = { authorization: `Bearer ${opTok}`, 'content-type': 'application/json' };
  beforeAll(async () => {
    app = buildServer({ repo: new InMemoryRepo(true) });
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  it('operator sees only their own audit rows; admin sees all', async () => {
    const c1 = (await app.inject({ method: 'POST', url: '/clients', headers: admin, payload: JSON.stringify({ creatorName: 'A' }) })).json() as { id: string };
    // c2 is created BY the 2nd operator, so they own it and may delete it (each operator deletes its own).
    const c2 = (await app.inject({ method: 'POST', url: '/clients', headers: op, payload: JSON.stringify({ creatorName: 'B' }) })).json() as { id: string };
    await app.inject({ method: 'DELETE', url: `/clients/${c1.id}`, headers: admin }); // operator: operator@disco.local
    await app.inject({ method: 'DELETE', url: `/clients/${c2.id}`, headers: op }); // operator: second@disco.local

    const adminAudit = (await app.inject({ method: 'GET', url: '/audit', headers: admin })).json() as { operator: string }[];
    const opAudit = (await app.inject({ method: 'GET', url: '/audit', headers: op })).json() as { operator: string }[];
    expect(new Set(adminAudit.map((a) => a.operator)).size).toBe(2); // admin sees both operators' actions
    expect(opAudit.every((a) => a.operator === 'second@disco.local')).toBe(true); // operator scoped to own
    expect(opAudit.length).toBe(1);
  });

  it('a canary build cannot be delivered (handover refused 409)', async () => {
    const snaps = (await app.inject({ method: 'GET', url: '/snapshots', headers: admin })).json() as { id: string }[];
    const config = { clientId: 'x', findReplace: [], colorMap: [], linkMap: [], assets: {} };
    const start = (await app.inject({ method: 'POST', url: '/jobs', headers: admin, payload: JSON.stringify({ snapshotId: snaps[0]!.id, config, dryRun: false, canary: true }) })).json() as { id: string };
    let status = 'queued';
    for (let i = 0; i < 80 && status !== 'completed' && status !== 'failed'; i++) {
      status = ((await app.inject({ method: 'GET', url: `/jobs/${start.id}`, headers: admin })).json() as { status: string }).status;
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(status).toBe('completed');
    const jobs = (await app.inject({ method: 'GET', url: '/jobs', headers: admin })).json() as { id: string; canary: boolean }[];
    expect(jobs.find((j) => j.id === start.id)?.canary).toBe(true);
    const h = await app.inject({ method: 'POST', url: '/handovers', headers: admin, payload: JSON.stringify({ jobId: start.id }) });
    expect(h.statusCode).toBe(409); // canary builds are not deliverable
  });
});

describe('e2e: multi-operator IDOR — operator B cannot touch operator A\'s records', () => {
  let app: FastifyInstance;
  // A = the default OPERATOR_EMAIL → admin (bypasses scoping). B = a 2nd operator → scoped.
  const A = { authorization: `Bearer ${signSession({ email: 'operator@disco.local' })}`, 'content-type': 'application/json' };
  const B = { authorization: `Bearer ${signSession({ email: 'attacker@evil.com' })}`, 'content-type': 'application/json' };
  let aSnapId = '';
  let aClientId = '';
  let aJobId = '';
  let aHandoverId = '';

  beforeAll(async () => {
    app = buildServer({ repo: new InMemoryRepo(true) });
    await app.ready();
    // A captures a snapshot, makes a client, runs a (dry) build, opens a handover — all owned by A.
    const guilds = (await app.inject({ method: 'GET', url: '/guilds', headers: A })).json() as { guilds: { id: string }[] };
    aSnapId = ((await app.inject({ method: 'POST', url: '/snapshots/capture', headers: A, payload: JSON.stringify({ sourceGuildId: guilds.guilds[0]!.id }) })).json() as { id: string }).id;
    aClientId = ((await app.inject({ method: 'POST', url: '/clients', headers: A, payload: JSON.stringify({ creatorName: 'A-Client' }) })).json() as { id: string }).id;
    const cfg = { clientId: 'x', findReplace: [], colorMap: [], linkMap: [], assets: {} };
    aJobId = ((await app.inject({ method: 'POST', url: '/jobs', headers: A, payload: JSON.stringify({ snapshotId: aSnapId, config: cfg, dryRun: false }) })).json() as { id: string }).id;
    for (let i = 0; i < 80; i++) {
      const s = ((await app.inject({ method: 'GET', url: `/jobs/${aJobId}`, headers: A })).json() as { status: string }).status;
      if (s === 'completed' || s === 'failed') break;
      await new Promise((r) => setTimeout(r, 25));
    }
    aHandoverId = ((await app.inject({ method: 'POST', url: '/handovers', headers: A, payload: JSON.stringify({ jobId: aJobId }) })).json() as { id: string }).id;
  });
  afterAll(async () => { await app.close(); });

  it('B cannot LIST A\'s snapshots / clients / jobs (filtered out)', async () => {
    const snaps = (await app.inject({ method: 'GET', url: '/snapshots', headers: B })).json() as { id: string }[];
    expect(snaps.find((s) => s.id === aSnapId)).toBeUndefined();
    const clients = (await app.inject({ method: 'GET', url: '/clients', headers: B })).json() as { id: string }[];
    expect(clients.find((c) => c.id === aClientId)).toBeUndefined();
    const jobs = (await app.inject({ method: 'GET', url: '/jobs', headers: B })).json() as { id: string }[];
    expect(jobs.find((j) => j.id === aJobId)).toBeUndefined();
  });

  it('B cannot READ or EXPORT A\'s snapshot / job / handover by id (404)', async () => {
    expect((await app.inject({ method: 'GET', url: `/snapshots/${aSnapId}`, headers: B })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/snapshots/${aSnapId}/feasibility`, headers: B })).statusCode).toBe(404);
    // export is the route the red-team caught — a non-owner must not drain A's full .discobundle
    expect((await app.inject({ method: 'GET', url: `/snapshots/${aSnapId}/export`, headers: B })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/jobs/${aJobId}`, headers: B })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/handovers/${aHandoverId}`, headers: B })).statusCode).toBe(404);
  });

  it('B cannot STREAM A\'s build logs (SSE 404 before hijack)', async () => {
    expect((await app.inject({ method: 'GET', url: `/jobs/${aJobId}/logs`, headers: B })).statusCode).toBe(404);
  });

  it('B cannot MUTATE A\'s records (patch/cancel/retry → 404; delete → no-op)', async () => {
    expect((await app.inject({ method: 'PATCH', url: `/snapshots/${aSnapId}`, headers: B, payload: JSON.stringify({ note: 'pwned' }) })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: `/jobs/${aJobId}/cancel`, headers: B })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: `/jobs/${aJobId}/retry`, headers: B })).statusCode).toBe(404);
    expect((await app.inject({ method: 'PATCH', url: `/handovers/${aHandoverId}`, headers: B, payload: JSON.stringify({ state: 'ready' }) })).statusCode).toBe(404);
    // delete returns ok:true but must NOT actually remove A's records
    await app.inject({ method: 'DELETE', url: `/snapshots/${aSnapId}`, headers: B });
    await app.inject({ method: 'DELETE', url: `/clients/${aClientId}`, headers: B });
    expect((await app.inject({ method: 'GET', url: `/snapshots/${aSnapId}`, headers: A })).statusCode).toBe(200); // still there
    expect(((await app.inject({ method: 'GET', url: '/clients', headers: A })).json() as { id: string }[]).find((c) => c.id === aClientId)).toBeTruthy();
  });

  it('B cannot read A\'s build events or handover views', async () => {
    const events = (await app.inject({ method: 'GET', url: `/events?jobId=${aJobId}`, headers: B })).json() as unknown[];
    expect(events.length).toBe(0);
    const views = (await app.inject({ method: 'GET', url: `/handovers/${aHandoverId}/views`, headers: B })).json() as { count: number };
    expect(views.count).toBe(0);
  });

  it('A (admin) CAN see everything, and B can see its OWN records (scoping is not a blanket deny)', async () => {
    // admin bypass: A sees its own snapshot/job/handover
    expect((await app.inject({ method: 'GET', url: `/jobs/${aJobId}`, headers: A })).statusCode).toBe(200);
    // B can create + read its own client
    const bClientId = ((await app.inject({ method: 'POST', url: '/clients', headers: B, payload: JSON.stringify({ creatorName: 'B-Client' }) })).json() as { id: string }).id;
    expect(((await app.inject({ method: 'GET', url: '/clients', headers: B })).json() as { id: string }[]).find((c) => c.id === bClientId)).toBeTruthy();
  });

  it('a starter-pack import is OWNED by the importer (B), re-import is a no-op, and admin sees it', async () => {
    const imp = (await app.inject({ method: 'POST', url: '/starter-packs/slots/import', headers: B })).json() as { id: string; unchanged?: boolean };
    expect(imp.id).toBeTruthy();
    // owned by B → in B's library, marked template
    const bSnaps = (await app.inject({ method: 'GET', url: '/snapshots', headers: B })).json() as { id: string; isTemplate: boolean }[];
    expect(bSnaps.find((s) => s.id === imp.id)?.isTemplate).toBe(true);
    // re-import is a no-op (no duplicate v2)
    const again = (await app.inject({ method: 'POST', url: '/starter-packs/slots/import', headers: B })).json() as { id: string; unchanged?: boolean };
    expect(again.id).toBe(imp.id);
    expect(again.unchanged).toBe(true);
    expect((bSnaps.filter((s) => s.id === imp.id)).length).toBe(1);
    // admin (bypass) sees B's imported pack; unknown pack key → 404
    expect(((await app.inject({ method: 'GET', url: '/snapshots', headers: A })).json() as { id: string }[]).find((s) => s.id === imp.id)).toBeTruthy();
    expect((await app.inject({ method: 'POST', url: '/starter-packs/nope/import', headers: B })).statusCode).toBe(404);
  });
});
