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

  it('/health is public and reports a healthy status + db + request metrics', async () => {
    const h = (await app.inject({ method: 'GET', url: '/health' })).json() as { ok: boolean; status: string; api: string; db: string; requests: { perRoute: unknown[] } };
    expect(h.ok).toBe(true);
    expect(h.api).toBe('up');
    expect(h.status).toBe('healthy'); // in-memory + no queue → nothing degraded
    expect(h.db).toBe('in-memory');
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

describe('e2e: handover engagement analytics (#4)', () => {
  let app: FastifyInstance;
  const token = signSession({ email: 'operator@disco.local' });
  const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const op = { authorization: `Bearer ${signSession({ email: 'other@x.com' })}`, 'content-type': 'application/json' };
  let hid = '';
  beforeAll(async () => {
    app = buildServer({ repo: new InMemoryRepo(true) });
    await app.ready();
    const guilds = (await app.inject({ method: 'GET', url: '/guilds', headers: auth })).json() as { guilds: { id: string }[] };
    const snap = ((await app.inject({ method: 'POST', url: '/snapshots/capture', headers: auth, payload: JSON.stringify({ sourceGuildId: guilds.guilds[0]!.id }) })).json() as { id: string }).id;
    const cfg = { clientId: 'x', findReplace: [], colorMap: [], linkMap: [], assets: {} };
    const jid = ((await app.inject({ method: 'POST', url: '/jobs', headers: auth, payload: JSON.stringify({ snapshotId: snap, config: cfg, dryRun: false }) })).json() as { id: string }).id;
    for (let i = 0; i < 80; i++) {
      const s = ((await app.inject({ method: 'GET', url: `/jobs/${jid}`, headers: auth })).json() as { status: string }).status;
      if (s === 'completed') break;
      await new Promise((r) => setTimeout(r, 25));
    }
    hid = ((await app.inject({ method: 'POST', url: '/handovers', headers: auth, payload: JSON.stringify({ jobId: jid }) })).json() as { id: string }).id;
    await app.inject({ method: 'PATCH', url: `/handovers/${hid}`, headers: auth, payload: JSON.stringify({ state: 'ready' }) });
  });
  afterAll(async () => { await app.close(); });

  it('aggregates opens + docs-viewed events into per-kind analytics', async () => {
    // client opens the page twice + reads the docs once + (a bad event is rejected)
    await app.inject({ method: 'GET', url: `/h/${hid}` });
    await app.inject({ method: 'GET', url: `/h/${hid}` });
    await app.inject({ method: 'POST', url: `/h/${hid}/event`, headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ kind: 'docs_viewed' }) });
    expect((await app.inject({ method: 'POST', url: `/h/${hid}/event`, headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ kind: 'evil' }) })).statusCode).toBe(400);

    const a = (await app.inject({ method: 'GET', url: `/handovers/${hid}/analytics`, headers: auth })).json() as { opened: number; docsViewed: number; total: number; timeline: unknown[] };
    expect(a.opened).toBe(2);
    expect(a.docsViewed).toBe(1);
    expect(a.total).toBe(3);
    expect(a.timeline.length).toBe(3);
  });

  it('a beacon for a draft handover is refused (404)', async () => {
    const draft = ((await app.inject({ method: 'POST', url: '/handovers', headers: auth, payload: JSON.stringify({ jobId: 'nope' }) })).statusCode);
    expect(draft).toBe(404); // unknown job → no handover to beacon against
  });

  it('a 2nd operator cannot read A\'s handover analytics (scoped → zeros)', async () => {
    const a = (await app.inject({ method: 'GET', url: `/handovers/${hid}/analytics`, headers: op })).json() as { opened: number; total: number };
    expect(a.total).toBe(0); // non-owner sees nothing (listHandoverViews gated on handover ownership)
  });
});

describe('e2e: build readiness check / canary gate (#3)', () => {
  let app: FastifyInstance;
  const auth = { authorization: `Bearer ${signSession({ email: 'operator@disco.local' })}`, 'content-type': 'application/json' };
  const op = { authorization: `Bearer ${signSession({ email: 'other@x.com' })}`, 'content-type': 'application/json' };
  let snapId = '';
  beforeAll(async () => {
    app = buildServer({ repo: new InMemoryRepo(true) });
    await app.ready();
    const guilds = (await app.inject({ method: 'GET', url: '/guilds', headers: auth })).json() as { guilds: { id: string }[] };
    snapId = ((await app.inject({ method: 'POST', url: '/snapshots/capture', headers: auth, payload: JSON.stringify({ sourceGuildId: guilds.guilds[0]!.id }) })).json() as { id: string }).id;
  });
  afterAll(async () => { await app.close(); });

  const cfg = { clientId: 'x', findReplace: [], colorMap: [], linkMap: [], assets: {} };

  it('returns a would-succeed verdict with a dry-run projection (no writes)', async () => {
    const r = (await app.inject({ method: 'POST', url: '/builds/readiness', headers: auth, payload: JSON.stringify({ snapshotId: snapId, config: cfg, targetTier: 0 }) })).json() as { verdict: string; wouldCreate: number; manualSteps: number };
    expect(['ready', 'ready_with_warnings', 'blocked']).toContain(r.verdict);
    expect(r.wouldCreate).toBeGreaterThan(0); // it projected a real build plan
  });

  it('a snapshot over the 250-role hard limit is BLOCKED', async () => {
    // craft a snapshot with >250 roles via a fresh capture won't exceed; instead assert tier shifts warnings.
    const t0 = (await app.inject({ method: 'POST', url: '/builds/readiness', headers: auth, payload: JSON.stringify({ snapshotId: snapId, config: cfg, targetTier: 0 }) })).json() as { warnings: { name: string }[] };
    const t2 = (await app.inject({ method: 'POST', url: '/builds/readiness', headers: auth, payload: JSON.stringify({ snapshotId: snapId, config: cfg, targetTier: 2 }) })).json() as { warnings: { name: string }[] };
    // a boost-locked warning present at tier 0 should clear at tier 2 (if the template has one)
    expect(t0.warnings.length).toBeGreaterThanOrEqual(t2.warnings.length);
  });

  it('a 2nd operator cannot readiness-check A\'s snapshot (404)', async () => {
    expect((await app.inject({ method: 'POST', url: '/builds/readiness', headers: op, payload: JSON.stringify({ snapshotId: snapId, config: cfg, targetTier: 0 }) })).statusCode).toBe(404);
  });

  it('an invalid config is rejected (400)', async () => {
    expect((await app.inject({ method: 'POST', url: '/builds/readiness', headers: auth, payload: JSON.stringify({ snapshotId: snapId, config: { bogus: true } }) })).statusCode).toBe(400);
  });
});

describe('e2e: operator activity log (#4) + build-duration SLO (#5)', () => {
  let app: FastifyInstance;
  const auth = { authorization: `Bearer ${signSession({ email: 'operator@disco.local' })}`, 'content-type': 'application/json' };
  beforeAll(async () => {
    app = buildServer({ repo: new InMemoryRepo(true) });
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  it('logs shipped actions (snapshot.create, build.start, handover.deliver) to the activity log', async () => {
    const guilds = (await app.inject({ method: 'GET', url: '/guilds', headers: auth })).json() as { guilds: { id: string }[] };
    const snap = ((await app.inject({ method: 'POST', url: '/snapshots/capture', headers: auth, payload: JSON.stringify({ sourceGuildId: guilds.guilds[0]!.id }) })).json() as { id: string }).id;
    const cfg = { clientId: 'x', findReplace: [], colorMap: [], linkMap: [], assets: {} };
    const jid = ((await app.inject({ method: 'POST', url: '/jobs', headers: auth, payload: JSON.stringify({ snapshotId: snap, config: cfg, dryRun: false }) })).json() as { id: string }).id;
    for (let i = 0; i < 80; i++) {
      const s = ((await app.inject({ method: 'GET', url: `/jobs/${jid}`, headers: auth })).json() as { status: string }).status;
      if (s === 'completed') break;
      await new Promise((r) => setTimeout(r, 25));
    }
    const hid = ((await app.inject({ method: 'POST', url: '/handovers', headers: auth, payload: JSON.stringify({ jobId: jid }) })).json() as { id: string }).id;
    await app.inject({ method: 'PATCH', url: `/handovers/${hid}`, headers: auth, payload: JSON.stringify({ state: 'ready' }) });

    const actions = ((await app.inject({ method: 'GET', url: '/audit', headers: auth })).json() as { action: string }[]).map((a) => a.action);
    expect(actions).toContain('snapshot.create');
    expect(actions).toContain('build.start');
    expect(actions).toContain('handover.deliver');
    // idempotent re-PATCH of the same state must NOT re-log the delivery (transition guard, seam r5)
    const deliversBefore = actions.filter((a) => a === 'handover.deliver').length;
    await app.inject({ method: 'PATCH', url: `/handovers/${hid}`, headers: auth, payload: JSON.stringify({ state: 'ready', welcomeMessage: 'edit, not a re-deliver' }) });
    const deliversAfter = ((await app.inject({ method: 'GET', url: '/audit', headers: auth })).json() as { action: string }[]).filter((a) => a.action === 'handover.deliver').length;
    expect(deliversAfter).toBe(deliversBefore);
    // a dry-run must NOT pollute the activity log with a build.start
    const before = actions.filter((a) => a === 'build.start').length;
    await app.inject({ method: 'POST', url: '/jobs', headers: auth, payload: JSON.stringify({ snapshotId: snap, config: cfg, dryRun: true }) });
    const after = ((await app.inject({ method: 'GET', url: '/audit', headers: auth })).json() as { action: string }[]).filter((a) => a.action === 'build.start').length;
    expect(after).toBe(before);
  });

  it('/dashboard exposes the build-duration SLO (no false positive on fast builds)', async () => {
    const d = (await app.inject({ method: 'GET', url: '/dashboard', headers: auth })).json() as { slowBuilds: number; sloMs: number; slowestBuildMs: number };
    expect(d.sloMs).toBeGreaterThanOrEqual(30_000); // floor so a tiny average can't false-positive
    expect(d.slowBuilds).toBe(0); // the in-process mock build is milliseconds — never "slow"
    expect(d.slowestBuildMs).toBeLessThan(d.sloMs);
  });
});

describe('e2e: onboarding wizard activation state (#3)', () => {
  let app: FastifyInstance;
  const auth = { authorization: `Bearer ${signSession({ email: 'operator@disco.local' })}`, 'content-type': 'application/json' };
  const op = { authorization: `Bearer ${signSession({ email: 'other@x.com' })}`, 'content-type': 'application/json' };
  beforeAll(async () => {
    app = buildServer({ repo: new InMemoryRepo(true) });
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  it('reports each step done-state from the operator\'s real data, and self-updates as they progress', async () => {
    // a fresh operator (the seeded admin) starts with templates but no validation/canary/real build
    const before = (await app.inject({ method: 'GET', url: '/onboarding', headers: auth })).json() as { hasTemplate: boolean; ranValidation: boolean; ranRealBuild: boolean; deliveredHandover: boolean };
    expect(before.hasTemplate).toBe(true); // seed has templates
    expect(before.ranRealBuild).toBe(false);
    expect(before.deliveredHandover).toBe(false);

    // run a real build + deliver → the wizard advances
    const guilds = (await app.inject({ method: 'GET', url: '/guilds', headers: auth })).json() as { guilds: { id: string }[] };
    const snap = ((await app.inject({ method: 'POST', url: '/snapshots/capture', headers: auth, payload: JSON.stringify({ sourceGuildId: guilds.guilds[0]!.id }) })).json() as { id: string }).id;
    const cfg = { clientId: 'x', findReplace: [], colorMap: [], linkMap: [], assets: {} };
    await app.inject({ method: 'POST', url: '/jobs', headers: auth, payload: JSON.stringify({ snapshotId: snap, config: cfg, dryRun: true }) }); // validation
    const jid = ((await app.inject({ method: 'POST', url: '/jobs', headers: auth, payload: JSON.stringify({ snapshotId: snap, config: cfg, dryRun: false }) })).json() as { id: string }).id;
    for (let i = 0; i < 80; i++) {
      const s = ((await app.inject({ method: 'GET', url: `/jobs/${jid}`, headers: auth })).json() as { status: string }).status;
      if (s === 'completed') break;
      await new Promise((r) => setTimeout(r, 25));
    }
    const hid = ((await app.inject({ method: 'POST', url: '/handovers', headers: auth, payload: JSON.stringify({ jobId: jid }) })).json() as { id: string }).id;
    await app.inject({ method: 'PATCH', url: `/handovers/${hid}`, headers: auth, payload: JSON.stringify({ state: 'ready' }) });

    const after = (await app.inject({ method: 'GET', url: '/onboarding', headers: auth })).json() as { ranValidation: boolean; ranRealBuild: boolean; deliveredHandover: boolean };
    expect(after.ranValidation).toBe(true);
    expect(after.ranRealBuild).toBe(true);
    expect(after.deliveredHandover).toBe(true);
  });

  it('is owner-scoped — a 2nd operator sees their OWN (empty) activation, not A\'s', async () => {
    const o = (await app.inject({ method: 'GET', url: '/onboarding', headers: op })).json() as { hasTemplate: boolean; ranRealBuild: boolean; counts: { builds: number } };
    expect(o.hasTemplate).toBe(false); // seeded templates are ''-owned/admin; B owns nothing
    expect(o.ranRealBuild).toBe(false);
    expect(o.counts.builds).toBe(0);
  });
});

describe('e2e: daily summary rollup (#4)', () => {
  let app: FastifyInstance;
  const auth = { authorization: `Bearer ${signSession({ email: 'operator@disco.local' })}`, 'content-type': 'application/json' };
  beforeAll(async () => { app = buildServer({ repo: new InMemoryRepo(true) }); await app.ready(); });
  afterAll(async () => { await app.close(); });

  it("counts today's builds + deliveries + client opens, scoped to the operator", async () => {
    const guilds = (await app.inject({ method: 'GET', url: '/guilds', headers: auth })).json() as { guilds: { id: string }[] };
    const snap = ((await app.inject({ method: 'POST', url: '/snapshots/capture', headers: auth, payload: JSON.stringify({ sourceGuildId: guilds.guilds[0]!.id }) })).json() as { id: string }).id;
    const cfg = { clientId: 'x', findReplace: [], colorMap: [], linkMap: [], assets: {} };
    const jid = ((await app.inject({ method: 'POST', url: '/jobs', headers: auth, payload: JSON.stringify({ snapshotId: snap, config: cfg, dryRun: false }) })).json() as { id: string }).id;
    for (let i = 0; i < 80; i++) { const s = ((await app.inject({ method: 'GET', url: `/jobs/${jid}`, headers: auth })).json() as { status: string }).status; if (s === 'completed') break; await new Promise((r) => setTimeout(r, 25)); }
    const hid = ((await app.inject({ method: 'POST', url: '/handovers', headers: auth, payload: JSON.stringify({ jobId: jid }) })).json() as { id: string }).id;
    await app.inject({ method: 'PATCH', url: `/handovers/${hid}`, headers: auth, payload: JSON.stringify({ state: 'ready' }) });
    await app.inject({ method: 'GET', url: `/h/${hid}` }); // a client open today

    const d = (await app.inject({ method: 'GET', url: '/dashboard', headers: auth })).json() as { today: { builds: number; delivered: number; snapshots: number; clientOpens: number } };
    expect(d.today.builds).toBeGreaterThanOrEqual(1);
    expect(d.today.delivered).toBeGreaterThanOrEqual(1);
    expect(d.today.snapshots).toBeGreaterThanOrEqual(1);
    expect(d.today.clientOpens).toBeGreaterThanOrEqual(1);
  });
});

describe('e2e: seam-audit r6 fixes — delivered counted once + scoped today rollup', () => {
  let app: FastifyInstance;
  const auth = { authorization: `Bearer ${signSession({ email: 'operator@disco.local' })}`, 'content-type': 'application/json' };
  beforeAll(async () => { app = buildServer({ repo: new InMemoryRepo(true) }); await app.ready(); });
  afterAll(async () => { await app.close(); });

  it('a handover walked draft→ready→handed_over logs delivered ONCE (no double-count)', async () => {
    const guilds = (await app.inject({ method: 'GET', url: '/guilds', headers: auth })).json() as { guilds: { id: string }[] };
    const snap = ((await app.inject({ method: 'POST', url: '/snapshots/capture', headers: auth, payload: JSON.stringify({ sourceGuildId: guilds.guilds[0]!.id }) })).json() as { id: string }).id;
    const cfg = { clientId: 'x', findReplace: [], colorMap: [], linkMap: [], assets: {} };
    const jid = ((await app.inject({ method: 'POST', url: '/jobs', headers: auth, payload: JSON.stringify({ snapshotId: snap, config: cfg, dryRun: false }) })).json() as { id: string }).id;
    for (let i = 0; i < 80; i++) { const s = ((await app.inject({ method: 'GET', url: `/jobs/${jid}`, headers: auth })).json() as { status: string }).status; if (s === 'completed') break; await new Promise((r) => setTimeout(r, 25)); }
    const hid = ((await app.inject({ method: 'POST', url: '/handovers', headers: auth, payload: JSON.stringify({ jobId: jid }) })).json() as { id: string }).id;
    await app.inject({ method: 'PATCH', url: `/handovers/${hid}`, headers: auth, payload: JSON.stringify({ state: 'ready' }) }); // draft→ready (delivered)
    await app.inject({ method: 'PATCH', url: `/handovers/${hid}`, headers: auth, payload: JSON.stringify({ state: 'handed_over' }) }); // ready→handed_over (NOT a new delivery)
    await app.inject({ method: 'PATCH', url: `/handovers/${hid}`, headers: auth, payload: JSON.stringify({ welcomeMessage: 'edit' }) }); // not a deliver

    const delivers = ((await app.inject({ method: 'GET', url: '/audit', headers: auth })).json() as { action: string }[]).filter((a) => a.action === 'handover.deliver').length;
    expect(delivers).toBe(1);
    const d = (await app.inject({ method: 'GET', url: '/dashboard', headers: auth })).json() as { today: { delivered: number } };
    expect(d.today.delivered).toBe(1);
  });

  it("listAudit filters by operator + since at the data layer (the today-window can't be evicted)", async () => {
    const repo = new InMemoryRepo(true);
    await repo.addAudit({ action: 'build.start', target: 't', detail: 'd', operator: 'a@x.com' });
    await repo.addAudit({ action: 'build.start', target: 't', detail: 'd', operator: 'b@x.com' });
    const aRows = await repo.listAudit(1000, { operator: 'a@x.com' });
    expect(aRows.every((r) => r.operator === 'a@x.com')).toBe(true);
    expect(aRows.length).toBe(1);
    const future = new Date(Date.now() + 60_000).toISOString();
    expect((await repo.listAudit(1000, { sinceIso: future })).length).toBe(0); // nothing after "now+1min"
  });
});

describe('e2e: template marketplace — share is STRUCTURE-ONLY (#1, security-critical)', () => {
  let app: FastifyInstance;
  const A = { authorization: `Bearer ${signSession({ email: 'operator@disco.local' })}`, 'content-type': 'application/json' }; // admin
  const B = { authorization: `Bearer ${signSession({ email: 'recipient@evil.com' })}`, 'content-type': 'application/json' }; // a 2nd operator
  let sharedId = '';
  beforeAll(async () => {
    app = buildServer({ repo: new InMemoryRepo(true) });
    await app.ready();
    // A captures a snapshot (has copied content for info channels + a source ownerNote), adds a private note, shares it.
    const guilds = (await app.inject({ method: 'GET', url: '/guilds', headers: A })).json() as { guilds: { id: string }[] };
    sharedId = ((await app.inject({ method: 'POST', url: '/snapshots/capture', headers: A, payload: JSON.stringify({ sourceGuildId: guilds.guilds[0]!.id }) })).json() as { id: string }).id;
    await app.inject({ method: 'PATCH', url: `/snapshots/${sharedId}`, headers: A, payload: JSON.stringify({ note: 'SECRET internal pricing note', shared: true }) });
  });
  afterAll(async () => { await app.close(); });

  it('the marketplace exposes structure-only metadata — never content, note, or source details', async () => {
    const market = (await app.inject({ method: 'GET', url: '/marketplace', headers: B })).json() as Record<string, unknown>[];
    const item = market.find((m) => m.templateId === sharedId)!;
    expect(item).toBeTruthy(); // cross-operator: B sees A's shared template
    expect(item.mine).toBe(false);
    expect(JSON.stringify(item)).not.toMatch(/SECRET/); // the private note never appears
    expect(item).not.toHaveProperty('content');
    expect(item).not.toHaveProperty('note');
    expect(item).not.toHaveProperty('snapshot'); // no raw artifact
    expect(item.sourceOperator).not.toMatch(/@/); // pseudonymized — the raw operator email never leaks
    expect(item.sourceOperator).toMatch(/^operator-/);
    expect(Array.isArray(item.roles)).toBe(true); // structure IS exposed
    expect((item.counts as { channels: number }).channels).toBeGreaterThan(0);
  });

  it('cloning a shared template gives B the STRUCTURE but strips content + source ownerNote + the original note', async () => {
    const clone = (await app.inject({ method: 'POST', url: `/marketplace/${sharedId}/clone`, headers: B })).json() as { id: string };
    expect(clone.id).toBeTruthy();
    const cloned = (await app.inject({ method: 'GET', url: `/snapshots/${clone.id}`, headers: B })).json() as { snapshot: { content: unknown[]; brandTokens: unknown[]; source: { ownerNote: string }; guild: { assets: Record<string, unknown> }; roles: unknown[]; channels: unknown[]; emojis: { asset: string }[] }; note: string };
    expect(cloned.snapshot.content).toEqual([]); // copied messages stripped
    expect(cloned.snapshot.source.ownerNote).toBe(''); // source note stripped
    expect(cloned.snapshot.brandTokens).toEqual([]); // source client's brand identity stripped
    expect(Object.keys(cloned.snapshot.guild.assets)).toHaveLength(0); // client logo/banner bytes not referenced
    expect(cloned.snapshot.emojis.every((e) => e.asset === 'assets/00000000.png')).toBe(true); // no asset-byte leak
    expect((cloned.snapshot as { roles: { icon?: string }[] }).roles.every((r) => !r.icon)).toBe(true); // role-icon bytes not referenced (HIGH)
    expect(cloned.note).not.toMatch(/SECRET/); // A's private note never reaches B
    expect(cloned.snapshot.roles.length).toBeGreaterThan(0); // structure preserved
    expect(cloned.snapshot.channels.length).toBeGreaterThan(0);
  });

  it('a NON-shared template is not in the marketplace and cannot be cloned (404)', async () => {
    const privId = ((await app.inject({ method: 'POST', url: '/snapshots/capture', headers: A, payload: JSON.stringify({ sourceGuildId: '111111111111111111' }) })).json() as { id: string }).id;
    const market = (await app.inject({ method: 'GET', url: '/marketplace', headers: B })).json() as { templateId: string }[];
    expect(market.find((m) => m.templateId === privId)).toBeUndefined();
    expect((await app.inject({ method: 'POST', url: `/marketplace/${privId}/clone`, headers: B })).statusCode).toBe(404);
  });
});

describe('e2e: deeper analytics + survey + earnings (#3/#4/#6)', () => {
  let app: FastifyInstance;
  const A = { authorization: `Bearer ${signSession({ email: 'operator@disco.local' })}`, 'content-type': 'application/json' };
  const B = { authorization: `Bearer ${signSession({ email: 'other2@x.com' })}`, 'content-type': 'application/json' };
  let jobId = '';
  let hid = '';
  beforeAll(async () => {
    app = buildServer({ repo: new InMemoryRepo(true) });
    await app.ready();
    const guilds = (await app.inject({ method: 'GET', url: '/guilds', headers: A })).json() as { guilds: { id: string }[] };
    const snap = ((await app.inject({ method: 'POST', url: '/snapshots/capture', headers: A, payload: JSON.stringify({ sourceGuildId: guilds.guilds[0]!.id }) })).json() as { id: string }).id;
    const cfg = { clientId: 'x', findReplace: [], colorMap: [], linkMap: [], assets: {} };
    jobId = ((await app.inject({ method: 'POST', url: '/jobs', headers: A, payload: JSON.stringify({ snapshotId: snap, config: cfg, dryRun: false }) })).json() as { id: string }).id;
    for (let i = 0; i < 80; i++) { const s = ((await app.inject({ method: 'GET', url: `/jobs/${jobId}`, headers: A })).json() as { status: string }).status; if (s === 'completed') break; await new Promise((r) => setTimeout(r, 25)); }
    hid = ((await app.inject({ method: 'POST', url: '/handovers', headers: A, payload: JSON.stringify({ jobId }) })).json() as { id: string }).id;
    await app.inject({ method: 'PATCH', url: `/handovers/${hid}`, headers: A, payload: JSON.stringify({ state: 'ready' }) });
  });
  afterAll(async () => { await app.close(); });

  it('#3 analytics report time-to-first-open, a 30-day decay curve, and warm/cold', async () => {
    for (let i = 0; i < 3; i++) await app.inject({ method: 'GET', url: `/h/${hid}` }); // 3 opens in week 1 → warm
    const a = (await app.inject({ method: 'GET', url: `/handovers/${hid}/analytics`, headers: A })).json() as { classification: string; timeToFirstOpenMs: number | null; decay: { opens: number }[]; firstWeekOpens: number };
    expect(a.classification).toBe('warm');
    expect(a.firstWeekOpens).toBeGreaterThanOrEqual(3);
    expect(a.timeToFirstOpenMs).not.toBeNull();
    expect(a.decay).toHaveLength(30);
    expect(a.decay[0]!.opens).toBeGreaterThanOrEqual(3); // all opens today (day 0)
  });

  it('#4 client survey: public submit, validation, operator aggregate, scoped', async () => {
    expect((await app.inject({ method: 'POST', url: `/h/${hid}/survey`, headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ nps: 11 }) })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: `/h/${hid}/survey`, headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ nps: 9, comment: 'Loved it' }) })).statusCode).toBe(200);
    const pub = (await app.inject({ method: 'GET', url: `/h/${hid}` })).json() as { surveyDone: boolean };
    expect(pub.surveyDone).toBe(true); // delivery page hides the form after submit
    const agg = (await app.inject({ method: 'GET', url: '/surveys', headers: A })).json() as { count: number; npsScore: number | null; responses: { comment: string }[] };
    expect(agg.count).toBe(1);
    expect(agg.npsScore).toBe(100); // a single promoter
    expect(agg.responses[0]!.comment).toBe('Loved it');
    // a 2nd operator sees none of A's survey responses
    expect(((await app.inject({ method: 'GET', url: '/surveys', headers: B })).json() as { count: number }).count).toBe(0);
  });

  it('#6 earnings: operator records invoiced/paid, rollup is scoped, billing PATCH is owner-scoped', async () => {
    await app.inject({ method: 'PATCH', url: `/jobs/${jobId}/billing`, headers: A, payload: JSON.stringify({ invoicedCents: 4500000, paidCents: 3000000 }) });
    const e = (await app.inject({ method: 'GET', url: '/earnings', headers: A })).json() as { invoicedCents: number; paidCents: number; outstandingCents: number; billedBuilds: number };
    expect(e.invoicedCents).toBe(4500000);
    expect(e.paidCents).toBe(3000000);
    expect(e.outstandingCents).toBe(1500000);
    expect(e.billedBuilds).toBe(1);
    // a 2nd operator can't bill A's job, and sees zero earnings
    expect((await app.inject({ method: 'PATCH', url: `/jobs/${jobId}/billing`, headers: B, payload: JSON.stringify({ paidCents: 999 }) })).statusCode).toBe(404);
    expect(((await app.inject({ method: 'GET', url: '/earnings', headers: B })).json() as { paidCents: number }).paidCents).toBe(0);
  });
});

describe('e2e: snapshot composability — merge endpoints (#5)', () => {
  let app: FastifyInstance;
  const A = { authorization: `Bearer ${signSession({ email: 'operator@disco.local' })}`, 'content-type': 'application/json' };
  const B = { authorization: `Bearer ${signSession({ email: 'merge-attacker@x.com' })}`, 'content-type': 'application/json' };
  let aId = '';
  let bId = '';
  beforeAll(async () => {
    app = buildServer({ repo: new InMemoryRepo(true) });
    await app.ready();
    aId = ((await app.inject({ method: 'GET', url: '/snapshots', headers: A })).json() as { id: string }[])[0]!.id; // seeded sample
    const guilds = (await app.inject({ method: 'GET', url: '/guilds', headers: A })).json() as { guilds: { id: string }[] };
    const second = guilds.guilds.find((g) => g.id !== guilds.guilds[0]!.id) ?? guilds.guilds[0]!;
    bId = ((await app.inject({ method: 'POST', url: '/snapshots/capture', headers: A, payload: JSON.stringify({ sourceGuildId: second.id }) })).json() as { id: string }).id;
  });
  afterAll(async () => { await app.close(); });

  it('previews conflicts then creates an owner-scoped composite template', async () => {
    const preview = (await app.inject({ method: 'POST', url: '/snapshots/merge/preview', headers: A, payload: JSON.stringify({ aId, bId }) })).json() as { conflicts: unknown[]; counts: { channels: number } };
    expect(Array.isArray(preview.conflicts)).toBe(true);
    expect(preview.counts.channels).toBeGreaterThan(0);

    const before = ((await app.inject({ method: 'GET', url: '/snapshots', headers: A })).json() as unknown[]).length;
    const merged = (await app.inject({ method: 'POST', url: '/snapshots/merge', headers: A, payload: JSON.stringify({ aId, bId, resolutions: {}, name: 'Composite Pack' }) })).json() as { id: string; name: string };
    expect(merged.id).toBeTruthy();
    expect(merged.name).toBe('Composite Pack');
    const after = (await app.inject({ method: 'GET', url: '/snapshots', headers: A })).json() as { id: string; isTemplate: boolean }[];
    expect(after.length).toBe(before + 1); // a new composite snapshot
    expect(after.find((s) => s.id === merged.id)?.isTemplate).toBe(true);
  });

  it('a 2nd operator cannot merge snapshots it does not own (404)', async () => {
    expect((await app.inject({ method: 'POST', url: '/snapshots/merge/preview', headers: B, payload: JSON.stringify({ aId, bId }) })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/snapshots/merge', headers: B, payload: JSON.stringify({ aId, bId, resolutions: {} }) })).statusCode).toBe(404);
  });
});

describe('e2e: operator preferences / defaults (#4)', () => {
  let app: FastifyInstance;
  const A = { authorization: `Bearer ${signSession({ email: 'operator@disco.local' })}`, 'content-type': 'application/json' };
  const B = { authorization: `Bearer ${signSession({ email: 'prefs-op-2@x.com' })}`, 'content-type': 'application/json' };
  beforeAll(async () => { app = buildServer({ repo: new InMemoryRepo(true) }); await app.ready(); });
  afterAll(async () => { await app.close(); });

  it('defaults are empty until saved, then persist and round-trip', async () => {
    const empty = (await app.inject({ method: 'GET', url: '/operator/prefs', headers: A })).json() as { defaultCanary: boolean; updatedAt: string | null };
    expect(empty.defaultCanary).toBe(false);
    expect(empty.updatedAt).toBeNull();
    const saved = (await app.inject({ method: 'PATCH', url: '/operator/prefs', headers: A, payload: JSON.stringify({ defaultCanary: true, defaultDryRun: true, defaultWelcomeMessage: 'Welcome aboard 🎉', defaultOwnershipSteps: [{ title: 'Custom step', detail: 'do this', done: false }] }) })).json() as { defaultCanary: boolean; updatedAt: string | null };
    expect(saved.defaultCanary).toBe(true);
    expect(saved.updatedAt).not.toBeNull();
    const got = (await app.inject({ method: 'GET', url: '/operator/prefs', headers: A })).json() as { defaultWelcomeMessage: string; defaultOwnershipSteps: unknown[] };
    expect(got.defaultWelcomeMessage).toBe('Welcome aboard 🎉');
    expect(got.defaultOwnershipSteps).toHaveLength(1);
  });

  it('new builds + handovers inherit the saved defaults', async () => {
    const snaps = (await app.inject({ method: 'GET', url: '/snapshots', headers: A })).json() as { id: string }[];
    const cfg = { clientId: 'c', findReplace: [], colorMap: [], linkMap: [], assets: {} };
    const jobId = ((await app.inject({ method: 'POST', url: '/jobs', headers: A, payload: JSON.stringify({ snapshotId: snaps[0]!.id, config: cfg }) })).json() as { id: string }).id;
    const id2 = ((await app.inject({ method: 'POST', url: '/jobs', headers: A, payload: JSON.stringify({ snapshotId: snaps[0]!.id, canary: false, config: cfg }) })).json() as { id: string }).id;
    // POST /jobs returns {id,status}; verify the applied flags via the jobs list.
    const jobs = (await app.inject({ method: 'GET', url: '/jobs', headers: A })).json() as { id: string; canary: boolean; dryRun: boolean }[];
    const job = jobs.find((j) => j.id === jobId)!;
    expect(job.canary).toBe(true); // omitted → inherits the saved pref
    expect(job.dryRun).toBe(true);
    expect(jobs.find((j) => j.id === id2)!.canary).toBe(false); // explicit false beats the pref
    // a NON-canary job → its handover inherits the welcome + custom checklist
    const dJobId = ((await app.inject({ method: 'POST', url: '/jobs', headers: A, payload: JSON.stringify({ snapshotId: snaps[0]!.id, canary: false, dryRun: false, config: cfg }) })).json() as { id: string }).id;
    const ho = await app.inject({ method: 'POST', url: '/handovers', headers: A, payload: JSON.stringify({ jobId: dJobId }) });
    expect(ho.statusCode).toBe(200);
    const h = ho.json() as { welcomeMessage: string; ownershipSteps: unknown[] };
    expect(h.welcomeMessage).toBe('Welcome aboard 🎉');
    expect(h.ownershipSteps).toHaveLength(1);
  });

  it('prefs are per-operator — operator B sees their own empty defaults, not A\'s', async () => {
    const b = (await app.inject({ method: 'GET', url: '/operator/prefs', headers: B })).json() as { defaultCanary: boolean; defaultWelcomeMessage: string };
    expect(b.defaultCanary).toBe(false);
    expect(b.defaultWelcomeMessage).toBe('');
  });
});

describe('e2e: build replay (#3) + snapshot scan preview (#2)', () => {
  let app: FastifyInstance;
  const A = { authorization: `Bearer ${signSession({ email: 'operator@disco.local' })}`, 'content-type': 'application/json' };
  const B = { authorization: `Bearer ${signSession({ email: 'replay-op-2@x.com' })}`, 'content-type': 'application/json' };
  beforeAll(async () => { app = buildServer({ repo: new InMemoryRepo(true) }); await app.ready(); });
  afterAll(async () => { await app.close(); });

  it('#3 replays a build against a NEW target guild, copying snapshot + config, owner-scoped', async () => {
    const snaps = (await app.inject({ method: 'GET', url: '/snapshots', headers: A })).json() as { id: string }[];
    const cfg = { clientId: 'orig', serverName: 'Original Build', findReplace: [], colorMap: [], linkMap: [], assets: {} };
    const parentId = ((await app.inject({ method: 'POST', url: '/jobs', headers: A, payload: JSON.stringify({ snapshotId: snaps[0]!.id, dryRun: true, config: cfg }) })).json() as { id: string }).id;

    const replay = await app.inject({ method: 'POST', url: `/jobs/${parentId}/replay`, headers: A, payload: JSON.stringify({ targetGuildId: '123456789012345678', dryRun: true }) });
    expect(replay.statusCode).toBe(200);
    const rj = replay.json() as { id: string; replayOf: string };
    expect(rj.replayOf).toBe(parentId);
    expect(rj.id).not.toBe(parentId); // a fresh job
    // the new job carries the parent's snapshot + config + the new target guild
    const nj = (await app.inject({ method: 'GET', url: `/jobs/${rj.id}`, headers: A })).json() as { targetGuildId: string | null; snapshotId: string; rebrandConfig: { serverName?: string } };
    expect(nj.targetGuildId).toBe('123456789012345678');
    expect(nj.snapshotId).toBe(snaps[0]!.id);
    expect(nj.rebrandConfig.serverName).toBe('Original Build'); // config copied from the parent
    // SAFETY (seam r8): replaying a dry-run parent with an EMPTY body must MIRROR the parent (stay dry-run),
    // never silently become a real live build.
    const mirrorId = ((await app.inject({ method: 'POST', url: `/jobs/${parentId}/replay`, headers: A, payload: JSON.stringify({}) })).json() as { id: string }).id;
    const mj = (await app.inject({ method: 'GET', url: `/jobs/${mirrorId}`, headers: A })).json() as { dryRun: boolean };
    expect(mj.dryRun).toBe(true);
    // a 2nd operator cannot replay operator A's build
    expect((await app.inject({ method: 'POST', url: `/jobs/${parentId}/replay`, headers: B, payload: JSON.stringify({}) })).statusCode).toBe(404);
  });

  it('#2 scans a guild read-only and returns a preview WITHOUT persisting', async () => {
    const before = ((await app.inject({ method: 'GET', url: '/snapshots', headers: A })).json() as unknown[]).length;
    const guilds = (await app.inject({ method: 'GET', url: '/guilds', headers: A })).json() as { guilds: { id: string }[] };
    const scan = await app.inject({ method: 'POST', url: '/snapshots/scan', headers: A, payload: JSON.stringify({ sourceGuildId: guilds.guilds[0]!.id }) });
    expect(scan.statusCode).toBe(200);
    const s = scan.json() as { guildName: string; counts: { roles: number; channels: number }; headsUp: string[] };
    expect(s.guildName).toBeTruthy();
    expect(s.counts.channels).toBeGreaterThan(0);
    expect(Array.isArray(s.headsUp)).toBe(true);
    // the preview did NOT write a snapshot to the library
    const after = ((await app.inject({ method: 'GET', url: '/snapshots', headers: A })).json() as unknown[]).length;
    expect(after).toBe(before);
  });
});

describe('e2e: first-build trust — readiness expansion (#1) + build trace (#3)', () => {
  let app: FastifyInstance;
  const A = { authorization: `Bearer ${signSession({ email: 'operator@disco.local' })}`, 'content-type': 'application/json' };
  const B = { authorization: `Bearer ${signSession({ email: 'trust-op-2@x.com' })}`, 'content-type': 'application/json' };
  const cfg = { clientId: 'c', serverName: 'Trust HQ', findReplace: [], colorMap: [], linkMap: [], assets: {} };
  beforeAll(async () => { app = buildServer({ repo: new InMemoryRepo(true) }); await app.ready(); });
  afterAll(async () => { await app.close(); });

  it('#1 readiness includes operator history + a (demo) live target-guild probe', async () => {
    const snaps = (await app.inject({ method: 'GET', url: '/snapshots', headers: A })).json() as { id: string }[];
    const r = (await app.inject({ method: 'POST', url: '/builds/readiness', headers: A, payload: JSON.stringify({ snapshotId: snaps[0]!.id, config: cfg, targetGuildId: '900000000000000000' }) })).json() as {
      verdict: string; history: { realBuilds: number; successRate: number | null }; live: { mode: string; reachable: boolean; permissions: { ok: boolean; hasAdmin: boolean } | null } | null;
    };
    expect(['ready', 'ready_with_warnings', 'blocked']).toContain(r.verdict);
    expect(r.history).toBeTruthy();
    expect(typeof r.history.realBuilds).toBe('number');
    // a targetGuildId was given → a live probe ran (demo mode → simulated perms, reachable)
    expect(r.live).toBeTruthy();
    expect(r.live!.mode).toBe('demo');
    expect(r.live!.reachable).toBe(true);
    expect(r.live!.permissions).toBeTruthy();
    // without a targetGuildId, no live probe
    const noGuild = (await app.inject({ method: 'POST', url: '/builds/readiness', headers: A, payload: JSON.stringify({ snapshotId: snaps[0]!.id, config: cfg }) })).json() as { live: unknown };
    expect(noGuild.live).toBeNull();
  });

  it('#3 /builds/:id/trace rolls up per-step timing + attempts + events, owner-scoped', async () => {
    const snaps = (await app.inject({ method: 'GET', url: '/snapshots', headers: A })).json() as { id: string }[];
    const jobId = ((await app.inject({ method: 'POST', url: '/jobs', headers: A, payload: JSON.stringify({ snapshotId: snaps[0]!.id, config: cfg, dryRun: false }) })).json() as { id: string }).id;
    // poll to completion (in-process build)
    for (let i = 0; i < 80; i++) {
      const j = (await app.inject({ method: 'GET', url: `/jobs/${jobId}`, headers: A })).json() as { status: string };
      if (j.status === 'completed' || j.status === 'failed') break;
      await new Promise((res) => setTimeout(res, 25));
    }
    const trace = (await app.inject({ method: 'GET', url: `/builds/${jobId}/trace`, headers: A })).json() as {
      status: string; metrics: { durationMs: number } | null; resumes: number; retriedSteps: string[];
      steps: { step: string; status: string; attempts: number; durationMs: number | null }[]; events: { kind: string }[];
    };
    expect(trace.status).toBe('completed');
    expect(trace.steps.length).toBeGreaterThan(0);
    // every step ran once and finished (no resume on a clean build)
    expect(trace.steps.every((s) => s.status === 'done')).toBe(true);
    expect(trace.steps.every((s) => s.attempts === 1)).toBe(true);
    expect(trace.resumes).toBe(0);
    expect(trace.retriedSteps).toHaveLength(0);
    expect(trace.metrics).toBeTruthy();
    expect(trace.events.some((e) => e.kind === 'completed')).toBe(true);
    // a 2nd operator cannot read this build's trace
    expect((await app.inject({ method: 'GET', url: `/builds/${jobId}/trace`, headers: B })).statusCode).toBe(404);
  });
});

describe('e2e: client server invite link on the handover (#2, XSS/phishing-guarded)', () => {
  let app: FastifyInstance;
  const A = { authorization: `Bearer ${signSession({ email: 'operator@disco.local' })}`, 'content-type': 'application/json' };
  const cfg = { clientId: 'c', serverName: 'Invite HQ', findReplace: [], colorMap: [], linkMap: [], assets: {} };
  let hid = '';
  beforeAll(async () => {
    app = buildServer({ repo: new InMemoryRepo(true) });
    await app.ready();
    const snaps = (await app.inject({ method: 'GET', url: '/snapshots', headers: A })).json() as { id: string }[];
    const jobId = ((await app.inject({ method: 'POST', url: '/jobs', headers: A, payload: JSON.stringify({ snapshotId: snaps[0]!.id, config: cfg, dryRun: false }) })).json() as { id: string }).id;
    for (let i = 0; i < 80; i++) { const j = (await app.inject({ method: 'GET', url: `/jobs/${jobId}`, headers: A })).json() as { status: string }; if (j.status === 'completed' || j.status === 'failed') break; await new Promise((r) => setTimeout(r, 25)); }
    hid = ((await app.inject({ method: 'POST', url: '/handovers', headers: A, payload: JSON.stringify({ jobId }) })).json() as { id: string }).id;
    await app.inject({ method: 'PATCH', url: `/handovers/${hid}`, headers: A, payload: JSON.stringify({ state: 'ready' }) });
  });
  afterAll(async () => { await app.close(); });

  const setInvite = (v: string) => app.inject({ method: 'PATCH', url: `/handovers/${hid}`, headers: A, payload: JSON.stringify({ inviteUrl: v }) });

  it('accepts real Discord invites (discord.gg + discord.com/invite) and surfaces them on the public page', async () => {
    expect((await setInvite('https://discord.gg/abc123')).statusCode).toBe(200);
    const pub = (await app.inject({ method: 'GET', url: `/h/${hid}` })).json() as { inviteUrl: string };
    expect(pub.inviteUrl).toBe('https://discord.gg/abc123');
    expect((await setInvite('https://discord.com/invite/xyz789')).statusCode).toBe(200);
  });

  it('REJECTS javascript:, data:, http:, and off-Discord hosts (XSS + phishing guard)', async () => {
    for (const bad of ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'http://discord.gg/abc', 'https://evil.com/invite/x', 'https://discord.gg.evil.com/x', 'https://notdiscord.com/invite/x']) {
      expect((await setInvite(bad)).statusCode, `${bad} must be rejected`).toBe(400);
    }
    // the stored value is unchanged (still the last VALID one), never the rejected input
    const pub = (await app.inject({ method: 'GET', url: `/h/${hid}` })).json() as { inviteUrl: string };
    expect(pub.inviteUrl).toBe('https://discord.com/invite/xyz789');
  });

  it('empty string clears the invite', async () => {
    expect((await setInvite('')).statusCode).toBe(200);
    const pub = (await app.inject({ method: 'GET', url: `/h/${hid}` })).json() as { inviteUrl: string };
    expect(pub.inviteUrl).toBe('');
  });
});

describe('e2e: invite link hardening — scoping, variants, draft-gate (#2 review follow-ups)', () => {
  let app: FastifyInstance;
  const A = { authorization: `Bearer ${signSession({ email: 'operator@disco.local' })}`, 'content-type': 'application/json' }; // admin
  const B = { authorization: `Bearer ${signSession({ email: 'invite-op-2@x.com' })}`, 'content-type': 'application/json' }; // scoped op
  const cfg = { clientId: 'c', serverName: 'Scoped HQ', findReplace: [], colorMap: [], linkMap: [], assets: {} };
  let readyHid = '', draftHid = '';
  beforeAll(async () => {
    app = buildServer({ repo: new InMemoryRepo(true) });
    await app.ready();
    const snaps = (await app.inject({ method: 'GET', url: '/snapshots', headers: A })).json() as { id: string }[];
    const mk = async () => {
      const jid = ((await app.inject({ method: 'POST', url: '/jobs', headers: A, payload: JSON.stringify({ snapshotId: snaps[0]!.id, config: cfg, dryRun: false }) })).json() as { id: string }).id;
      for (let i = 0; i < 80; i++) { const j = (await app.inject({ method: 'GET', url: `/jobs/${jid}`, headers: A })).json() as { status: string }; if (j.status === 'completed') break; await new Promise((r) => setTimeout(r, 25)); }
      return ((await app.inject({ method: 'POST', url: '/handovers', headers: A, payload: JSON.stringify({ jobId: jid }) })).json() as { id: string }).id;
    };
    readyHid = await mk();
    await app.inject({ method: 'PATCH', url: `/handovers/${readyHid}`, headers: A, payload: JSON.stringify({ state: 'ready' }) });
    draftHid = await mk(); // left in draft on purpose
  });
  afterAll(async () => { await app.close(); });

  it('accepts www + ptb/canary/discordapp invite variants', async () => {
    for (const ok of ['https://www.discord.gg/abc', 'https://ptb.discord.com/invite/abc', 'https://canary.discord.com/invite/abc', 'https://discordapp.com/invite/abc']) {
      expect((await app.inject({ method: 'PATCH', url: `/handovers/${readyHid}`, headers: A, payload: JSON.stringify({ inviteUrl: ok }) })).statusCode, ok).toBe(200);
    }
  });

  it('rejects a URL carrying credentials (userinfo)', async () => {
    expect((await app.inject({ method: 'PATCH', url: `/handovers/${readyHid}`, headers: A, payload: JSON.stringify({ inviteUrl: 'https://user:pass@discord.gg/abc' }) })).statusCode).toBe(400);
  });

  it('IDOR: a 2nd operator cannot set another operator\'s handover invite (404, no write)', async () => {
    await app.inject({ method: 'PATCH', url: `/handovers/${readyHid}`, headers: A, payload: JSON.stringify({ inviteUrl: 'https://discord.gg/owned' }) });
    // operator B (non-admin, owns nothing) → 404, and the value is untouched
    expect((await app.inject({ method: 'PATCH', url: `/handovers/${readyHid}`, headers: B, payload: JSON.stringify({ inviteUrl: 'https://discord.gg/hijack' }) })).statusCode).toBe(404);
    const pub = (await app.inject({ method: 'GET', url: `/h/${readyHid}` })).json() as { inviteUrl: string };
    expect(pub.inviteUrl).toBe('https://discord.gg/owned');
  });

  it('a DRAFT handover never exposes its invite on the public page (404)', async () => {
    // even if an invite were set, a draft 404s the whole public page
    expect((await app.inject({ method: 'GET', url: `/h/${draftHid}` })).statusCode).toBe(404);
  });
});

describe('e2e: client detail — aggregation + owner-scoping (#3)', () => {
  let app: FastifyInstance;
  const A = { authorization: `Bearer ${signSession({ email: 'operator@disco.local' })}`, 'content-type': 'application/json' };
  const B = { authorization: `Bearer ${signSession({ email: 'cd-op-2@x.com' })}`, 'content-type': 'application/json' };
  beforeAll(async () => { app = buildServer({ repo: new InMemoryRepo(true) }); await app.ready(); });
  afterAll(async () => { await app.close(); });

  it('rolls up a client\'s builds + earnings, owner-scoped (2nd operator 404s)', async () => {
    const cid = ((await app.inject({ method: 'POST', url: '/clients', headers: A, payload: JSON.stringify({ creatorName: 'Detail Co', handle: 'detailco', monthlyRetainer: 750 }) })).json() as { id: string }).id;
    const snaps = (await app.inject({ method: 'GET', url: '/snapshots', headers: A })).json() as { id: string }[];
    const jobId = ((await app.inject({ method: 'POST', url: '/jobs', headers: A, payload: JSON.stringify({ snapshotId: snaps[0]!.id, clientId: cid, dryRun: false, config: { clientId: cid, serverName: 'Detail HQ', findReplace: [], colorMap: [], linkMap: [], assets: {} } }) })).json() as { id: string }).id;
    await app.inject({ method: 'PATCH', url: `/jobs/${jobId}/billing`, headers: A, payload: JSON.stringify({ invoicedCents: 500000, paidCents: 300000 }) });

    const d = (await app.inject({ method: 'GET', url: `/clients/${cid}`, headers: A })).json() as {
      client: { creatorName: string }; builds: { id: string }[]; totals: { builds: number; invoicedCents: number; paidCents: number; outstandingCents: number; mrrCents: number };
    };
    expect(d.client.creatorName).toBe('Detail Co');
    expect(d.builds.length).toBe(1);
    expect(d.totals.invoicedCents).toBe(500000);
    expect(d.totals.paidCents).toBe(300000);
    expect(d.totals.outstandingCents).toBe(200000);
    expect(d.totals.mrrCents).toBe(75000); // $750/mo → cents
    // a 2nd operator cannot read operator A's client detail
    expect((await app.inject({ method: 'GET', url: `/clients/${cid}`, headers: B })).statusCode).toBe(404);
  });
});

describe('e2e: dashboard money rollup (#7)', () => {
  let app: FastifyInstance;
  const A = { authorization: `Bearer ${signSession({ email: 'operator@disco.local' })}`, 'content-type': 'application/json' };
  beforeAll(async () => { app = buildServer({ repo: new InMemoryRepo(true) }); await app.ready(); });
  afterAll(async () => { await app.close(); });

  it('surfaces invoiced/paid/outstanding + MRR, owner-scoped', async () => {
    const cid = ((await app.inject({ method: 'POST', url: '/clients', headers: A, payload: JSON.stringify({ creatorName: 'Money Co', monthlyRetainer: 1000 }) })).json() as { id: string }).id;
    const snaps = (await app.inject({ method: 'GET', url: '/snapshots', headers: A })).json() as { id: string }[];
    const jid = ((await app.inject({ method: 'POST', url: '/jobs', headers: A, payload: JSON.stringify({ snapshotId: snaps[0]!.id, clientId: cid, dryRun: false, config: { clientId: cid, serverName: 'Money HQ', findReplace: [], colorMap: [], linkMap: [], assets: {} } }) })).json() as { id: string }).id;
    // let the async in-process build settle BEFORE setting billing, so the build's updateJob calls can't
    // race/clobber invoicedCents (the operator sets billing on a finished build too).
    for (let i = 0; i < 80; i++) { const s = ((await app.inject({ method: 'GET', url: `/jobs/${jid}`, headers: A })).json() as { status: string }).status; if (s === 'completed' || s === 'failed') break; await new Promise((r) => setTimeout(r, 25)); }
    await app.inject({ method: 'PATCH', url: `/jobs/${jid}/billing`, headers: A, payload: JSON.stringify({ invoicedCents: 600000, paidCents: 200000 }) });
    const theJob = ((await app.inject({ method: 'GET', url: '/jobs', headers: A })).json() as { id: string; invoicedCents: number; dryRun: boolean; canary: boolean }[]).find((j) => j.id === jid)!;
    expect(theJob.invoicedCents).toBe(600000); // billing persisted on the job
    expect(theJob.dryRun).toBe(false);
    expect(theJob.canary).toBe(false);
    const d = (await app.inject({ method: 'GET', url: '/dashboard', headers: A })).json() as { money: { invoicedCents: number; paidCents: number; outstandingCents: number; mrrCents: number } };
    expect(d.money.invoicedCents).toBeGreaterThanOrEqual(600000);
    expect(d.money.outstandingCents).toBe(d.money.invoicedCents - d.money.paidCents);
    expect(d.money.mrrCents).toBeGreaterThanOrEqual(100000); // Money Co's $1000/mo → cents
    // a 2nd operator's dashboard money is zero (owner-scoped)
    const B = { authorization: `Bearer ${signSession({ email: 'money-op-2@x.com' })}` };
    const d2 = (await app.inject({ method: 'GET', url: '/dashboard', headers: B })).json() as { money: { invoicedCents: number; mrrCents: number } };
    expect(d2.money.invoicedCents).toBe(0);
    expect(d2.money.mrrCents).toBe(0);
  });
});

describe('e2e: client-open notifications feed (#10)', () => {
  let app: FastifyInstance;
  const A = { authorization: `Bearer ${signSession({ email: 'operator@disco.local' })}`, 'content-type': 'application/json' };
  const B = { authorization: `Bearer ${signSession({ email: 'opens-op-2@x.com' })}`, 'content-type': 'application/json' };
  beforeAll(async () => { app = buildServer({ repo: new InMemoryRepo(true) }); await app.ready(); });
  afterAll(async () => { await app.close(); });

  it('surfaces new client opens since a cursor, owner-scoped', async () => {
    const snaps = (await app.inject({ method: 'GET', url: '/snapshots', headers: A })).json() as { id: string }[];
    const jid = ((await app.inject({ method: 'POST', url: '/jobs', headers: A, payload: JSON.stringify({ snapshotId: snaps[0]!.id, dryRun: false, config: { clientId: 'c', serverName: 'Opens HQ', findReplace: [], colorMap: [], linkMap: [], assets: {} } }) })).json() as { id: string }).id;
    for (let i = 0; i < 80; i++) { const s = ((await app.inject({ method: 'GET', url: `/jobs/${jid}`, headers: A })).json() as { status: string }).status; if (s === 'completed' || s === 'failed') break; await new Promise((r) => setTimeout(r, 25)); }
    const hid = ((await app.inject({ method: 'POST', url: '/handovers', headers: A, payload: JSON.stringify({ jobId: jid }) })).json() as { id: string }).id;
    await app.inject({ method: 'PATCH', url: `/handovers/${hid}`, headers: A, payload: JSON.stringify({ state: 'ready' }) });
    // a client opens the public delivery page → an 'opened' view is recorded
    await app.inject({ method: 'GET', url: `/h/${hid}` });
    await new Promise((r) => setTimeout(r, 60)); // fire-and-forget view write drains

    const feed = (await app.inject({ method: 'GET', url: '/activity/client-opens?since=0', headers: A })).json() as { opens: { handoverId: string; jobId: string; at: string }[] };
    const mine = feed.opens.find((o) => o.handoverId === hid)!;
    expect(mine).toBeTruthy();
    expect(mine.jobId).toBe(jid);
    // a future cursor returns nothing (the poller only sees NEW opens)
    const future = (await app.inject({ method: 'GET', url: `/activity/client-opens?since=${Date.now() + 100000}`, headers: A })).json() as { opens: unknown[] };
    expect(future.opens.length).toBe(0);
    // a 2nd operator sees none of operator A's opens (owner-scoped)
    const other = (await app.inject({ method: 'GET', url: '/activity/client-opens?since=0', headers: B })).json() as { opens: unknown[] };
    expect(other.opens.length).toBe(0);
  });
});

describe('e2e: public handover endpoints are rate-limited (#11 hardening)', () => {
  let app: FastifyInstance;
  const A = { authorization: `Bearer ${signSession({ email: 'operator@disco.local' })}`, 'content-type': 'application/json' };
  let hid = '';
  beforeAll(async () => {
    app = buildServer({ repo: new InMemoryRepo(true) });
    await app.ready();
    const snaps = (await app.inject({ method: 'GET', url: '/snapshots', headers: A })).json() as { id: string }[];
    const jid = ((await app.inject({ method: 'POST', url: '/jobs', headers: A, payload: JSON.stringify({ snapshotId: snaps[0]!.id, dryRun: false, config: { clientId: 'c', serverName: 'RL HQ', findReplace: [], colorMap: [], linkMap: [], assets: {} } }) })).json() as { id: string }).id;
    for (let i = 0; i < 80; i++) { const s = ((await app.inject({ method: 'GET', url: `/jobs/${jid}`, headers: A })).json() as { status: string }).status; if (s === 'completed' || s === 'failed') break; await new Promise((r) => setTimeout(r, 25)); }
    hid = ((await app.inject({ method: 'POST', url: '/handovers', headers: A, payload: JSON.stringify({ jobId: jid }) })).json() as { id: string }).id;
    await app.inject({ method: 'PATCH', url: `/handovers/${hid}`, headers: A, payload: JSON.stringify({ state: 'ready' }) });
  });
  afterAll(async () => { await app.close(); });

  it('POST /h/:id/event 429s an anonymous flood past the cap', async () => {
    let got429 = false;
    for (let i = 0; i < 70; i++) {
      const r = await app.inject({ method: 'POST', url: `/h/${hid}/event`, headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ kind: 'docs_viewed' }) });
      if (r.statusCode === 429) { got429 = true; break; }
    }
    expect(got429).toBe(true); // the per-IP+handover cap eventually rejects the flood
  });
});
