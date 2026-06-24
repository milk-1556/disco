import { auditAuthority, auditBuildLimits, type BuildJobData, BundleError, captureSnapshot, collectAssetKeys, exportBundle, makeSampleSnapshot, makeStarterPacks, parseBundle, rebrand } from '@disco/core';
import { defaultOwnershipSteps, RebrandConfig, SnapshotMetaPatch } from '@disco/schema';
import { DiscordGuildClient, DiskAssetStore, listJoinedGuilds, MockGuild, mockGuildFromSnapshot } from '@disco/sdk';
import { demoGuildSnapshot, listDemoGuilds } from './demoGuilds.js';
import cors from '@fastify/cors';
import bcrypt from 'bcryptjs';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { type Role, signSession, verifyCredentials, verifySession } from './auth.js';
import { type Actor, SYSTEM_ACTOR, scopeRepo } from './repoScope.js';
import { diffSnapshots } from './diff.js';
import { env, isLiveMode, usePrisma, useQueue } from './env.js';
import type { JobChannel, JobEvent } from './jobChannel.js';
import { runBuild } from './jobs.js';
import { buildInviteUrl } from './perms.js';
import type { HandoverPatch, Repo } from './repo.js';
import { getQueue, makeJobChannel, makeRepo } from './runtime.js';
import { getLastActivityAt, recordRequest, snapshotMetrics } from './metrics.js';
import { registerStripeRoutes } from './stripe.js';

const BOOT_AT = Date.now();

export interface BuildServerOptions {
  repo?: Repo;
  channel?: JobChannel;
}

export function buildServer(opts: BuildServerOptions = {}): FastifyInstance {
  const repo = opts.repo ?? makeRepo();
  const channel: JobChannel = opts.channel ?? makeJobChannel();
  const store = new DiskAssetStore(env.storageDiskPath);
  // trustProxy: the API runs behind a reverse proxy / Cloudflare Tunnel in every real deployment, so
  // req.ip must resolve from X-Forwarded-For to the actual client — otherwise the per-IP rate limiters
  // (login, handover-password) collapse into a single shared bucket for everyone behind the proxy.
  const app = Fastify({ logger: false, trustProxy: true });

  // Disco authenticates with Bearer tokens (not cookies), so CORS credentials are never needed — which
  // lets a public API safely allow any origin. When WEB_ORIGIN is an explicit (comma-sep) allowlist we
  // honor it; '*' means "public". credentials:false avoids the invalid '*'+credentials combo entirely.
  const allowedOrigins = env.webOrigin === '*' ? null : env.webOrigin.split(',').map((o) => o.trim()).filter(Boolean);
  app.register(cors, { origin: allowedOrigins ?? true, credentials: false });

  // Baseline security headers on every response. The API is JSON + a couple of public HTML/SVG routes;
  // these stop MIME-sniffing, clickjacking, and referrer leakage. Per-route CSP is tightened on the
  // HTML (/share) and user-asset (/assets/*) routes where untrusted bytes are served.
  app.addHook('onSend', async (_req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  });

  // ── brute-force guard: in-memory fixed-window rate limiter (per process) for the unauthenticated,
  // secret-guessing surfaces (login + the password-gated handover). Returns true when over the cap. ──
  const rlBuckets = new Map<string, { count: number; resetAt: number }>();
  const rateLimited = (key: string, limit: number, windowMs: number): boolean => {
    const now = Date.now();
    const b = rlBuckets.get(key);
    if (!b || now > b.resetAt) {
      rlBuckets.set(key, { count: 1, resetAt: now + windowMs });
      if (rlBuckets.size > 5000) for (const [k, v] of rlBuckets) if (now > v.resetAt) rlBuckets.delete(k); // bound memory
      return false;
    }
    b.count += 1;
    return b.count > limit;
  };

  // ── observability: per-request metrics + a structured access log line (one compact JSON per req).
  // Skips the high-frequency pollers (/health, /activity/stream) to keep the log + ring useful.
  app.addHook('onResponse', async (req, reply) => {
    const route = ((req as FastifyRequest & { routeOptions?: { url?: string } }).routeOptions?.url) ?? req.url;
    if (route === '/health' || route === '/activity/stream') return;
    const ms = Math.round(reply.elapsedTime);
    recordRequest(route, reply.statusCode, ms, req.method !== 'GET');
    const op = (req as FastifyRequest & { session?: { email?: string } }).session?.email ?? null;
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ t: new Date().toISOString(), id: req.id, route, m: req.method, s: reply.statusCode, ms, op }));
  });

  // Activity live-feed transport: a reserved channel key fans out a "something changed" ping over the
  // SAME (in-memory or Redis) bus the job logs use — so /activity/stream sees worker build-completions
  // cross-process with zero new infra. The client refetches on each ping (event-driven, not polling).
  const ACTIVITY_KEY = '__activity__';
  const pingActivity = (message: string) => void Promise.resolve(channel.publish(ACTIVITY_KEY, { type: 'log', message })).catch(() => {});

  const operatorOf = (req: FastifyRequest): string => (req as FastifyRequest & { session?: { email?: string } }).session?.email ?? 'operator';
  // The authenticated principal + an owner-scoped repo view for this request. ALL owned-resource access
  // (snapshots/clients/jobs/handovers) must go through `scoped(req)` so a non-admin operator can never
  // read or mutate another operator's records. System/public paths use the raw `repo` deliberately.
  const actorOf = (req: FastifyRequest): Actor => {
    const s = (req as FastifyRequest & { session?: { email?: string; role?: Role } }).session;
    return s?.email ? { email: s.email, role: s.role ?? 'operator' } : SYSTEM_ACTOR;
  };
  const scoped = (req: FastifyRequest): Repo => scopeRepo(repo, actorOf(req));

  // ── auth guard ──
  const requireAuth = async (req: FastifyRequest, reply: FastifyReply) => {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const session = verifySession(token);
    if (!session) {
      reply.code(401).send({ error: 'unauthorized' });
      return;
    }
    (req as FastifyRequest & { session?: unknown }).session = session;
  };

  // ── public ──
  // Read-only status page (no auth) — a trust signal + the Operations screen's data source.
  app.get('/health', async () => {
    let worker: 'up' | 'down' | 'n/a' = 'n/a';
    if (useQueue()) {
      try {
        const q = getQueue();
        worker = q && (await q.getWorkers()).length > 0 ? 'up' : 'down';
      } catch {
        worker = 'down';
      }
    }
    let lastBuildAt: string | null = null;
    try {
      const completed = (await repo.listJobs()).filter((j) => j.status === 'completed').map((j) => j.updatedAt).sort();
      lastBuildAt = completed.length ? completed[completed.length - 1]! : null;
    } catch {
      /* status must never throw */
    }
    return {
      ok: true,
      mode: isLiveMode() ? 'live' : 'demo',
      api: 'up' as const,
      worker,
      queue: useQueue() ? 'redis' : 'in-process',
      persistence: usePrisma() ? 'postgres' : 'in-memory',
      uptimeSec: Math.round((Date.now() - BOOT_AT) / 1000),
      lastBuildAt,
      lastActivityAt: getLastActivityAt(),
      requests: snapshotMetrics(),
    };
  });

  // Public basics (the login screen + app routing need these) are returned to anyone; the operator
  // identity + deployment internals are ONLY included for an authenticated caller (the Setup screen),
  // so an anonymous visitor can't harvest the login email or fingerprint the deployment.
  app.get('/config', async (req) => {
    const base = { mode: isLiveMode() ? 'live' : 'demo', applicationId: env.discordApplicationId || null };
    const header = req.headers.authorization ?? '';
    const session = verifySession(header.startsWith('Bearer ') ? header.slice(7) : '');
    if (!session) return base;
    return {
      ...base,
      operatorEmail: env.operatorEmail,
      hasToken: env.discordBotToken.length > 0,
      storageDriver: process.env.STORAGE_DRIVER ?? 'disk',
      persistence: usePrisma() ? 'postgres' : 'in-memory',
      queue: useQueue() ? 'redis' : 'in-process',
    };
  });

  app.post('/auth/login', async (req, reply) => {
    if (rateLimited(`login:${req.ip}`, 10, 60_000)) return reply.code(429).send({ error: 'Too many attempts — wait a minute and try again.' });
    const body = (req.body ?? {}) as { email?: string; password?: string };
    const ok = await verifyCredentials(body.email ?? '', body.password ?? '');
    if (!ok) return reply.code(401).send({ error: 'invalid credentials' });
    return { token: signSession({ email: body.email! }), email: body.email };
  });

  // ── snapshots ──
  app.get('/snapshots', { preHandler: requireAuth }, async (req) =>
    (await scoped(req).listSnapshots()).map((s) => ({
      id: s.id,
      name: s.name,
      version: s.version,
      sourceGuildId: s.sourceGuildId,
      capturedAt: s.capturedAt,
      tags: s.tags,
      note: s.note,
      favorite: s.favorite,
      isTemplate: s.isTemplate,
      lastUsedAt: s.lastUsedAt,
      counts: {
        roles: s.snapshot.roles.length,
        channels: s.snapshot.channels.length,
        categories: s.snapshot.categories.length,
        emojis: s.snapshot.emojis.length,
        automod: s.snapshot.automod.length,
        bots: s.snapshot.bots.length,
      },
    })),
  );

  app.patch('/snapshots/:id', { preHandler: requireAuth }, async (req, reply) => {
    const parsed = SnapshotMetaPatch.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid patch', detail: parsed.error.flatten() });
    const rec = await scoped(req).updateSnapshot((req.params as { id: string }).id, parsed.data);
    if (!rec) return reply.code(404).send({ error: 'not found' });
    return { id: rec.id, name: rec.name, tags: rec.tags, note: rec.note, favorite: rec.favorite, isTemplate: rec.isTemplate };
  });

  app.delete('/snapshots/:id', { preHandler: requireAuth }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const r = scoped(req);
    const rec = await r.getSnapshot(id);
    if (!rec) return reply.code(404).send({ error: 'not found' });
    await r.deleteSnapshot(id);
    await repo.addAudit({ action: 'snapshot.delete', target: rec.name, detail: `v${rec.version} · ${rec.sourceGuildId}`, operator: operatorOf(req) });
    pingActivity('snapshot');
    return { ok: true };
  });

  app.get('/snapshots/:id', { preHandler: requireAuth }, async (req, reply) => {
    const rec = await scoped(req).getSnapshot((req.params as { id: string }).id);
    if (!rec) return reply.code(404).send({ error: 'not found' });
    return rec;
  });

  // Build-feasibility pre-flight: does this snapshot fit within Discord's hard limits?
  app.get('/snapshots/:id/feasibility', { preHandler: requireAuth }, async (req, reply) => {
    const rec = await scoped(req).getSnapshot((req.params as { id: string }).id);
    if (!rec) return reply.code(404).send({ error: 'not found' });
    // Target boost tier the operator is building INTO (0 = a fresh, unboosted guild; the safe default).
    const raw = Number((req.query as { targetTier?: string }).targetTier);
    const targetTier = Number.isFinite(raw) ? Math.max(0, Math.min(3, Math.trunc(raw))) : 0;
    return { ...auditBuildLimits(rec.snapshot, targetTier), targetTier };
  });

  app.get('/snapshots/:id/diff', { preHandler: requireAuth }, async (req, reply) => {
    const r = scoped(req);
    const a = await r.getSnapshot((req.params as { id: string }).id);
    const against = (req.query as { against?: string }).against;
    const b = against ? await r.getSnapshot(against) : undefined;
    if (!a || !b) return reply.code(404).send({ error: 'snapshot(s) not found' });
    return diffSnapshots(b.snapshot, a.snapshot);
  });

  // List the servers the bot can import from — its real joined guilds (live) or the demo set.
  app.get('/guilds', { preHandler: requireAuth }, async (_req, reply) => {
    try {
      const guilds = isLiveMode() ? await listJoinedGuilds(env.discordBotToken) : listDemoGuilds();
      return { live: isLiveMode(), guilds };
    } catch (err) {
      return reply.code(502).send({ error: err instanceof Error ? err.message : 'failed to list guilds' });
    }
  });

  app.post('/snapshots/capture', { preHandler: requireAuth }, async (req, reply) => {
    const body = (req.body ?? {}) as { sourceGuildId?: string; name?: string };
    try {
      let snapshot;
      if (isLiveMode()) {
        if (!body.sourceGuildId) return reply.code(400).send({ error: 'Pick a server to import.' });
        const client = new DiscordGuildClient({ token: env.discordBotToken, guildId: body.sourceGuildId, store });
        snapshot = await captureSnapshot(client, { ownerNote: 'captured live' });
      } else if (body.sourceGuildId) {
        // demo: import the chosen demo server (each backed by a fixture, re-stamped name + id)
        const source = demoGuildSnapshot(body.sourceGuildId);
        if (!source) return reply.code(404).send({ error: 'Unknown server.' });
        snapshot = await captureSnapshot(mockGuildFromSnapshot(source), { ownerNote: 'demo import' });
      } else {
        // demo back-compat: re-snapshot the seeded sample template
        snapshot = await captureSnapshot(mockGuildFromSnapshot(makeSampleSnapshot()), { ownerNote: 'demo capture' });
      }
      const r = scoped(req);
      const existing = (await r.listSnapshots()).filter((s) => s.sourceGuildId === snapshot.source.guildId);
      // Delta optimization: if the latest version is structurally identical, don't bloat the library
      // with a no-op version — surface "no changes" and reuse it (a fast incremental re-snapshot).
      const latest = existing.sort((a, b) => b.version - a.version)[0];
      if (latest) {
        const d = diffSnapshots(latest.snapshot, snapshot);
        const noChange =
          !d.guildNameChanged &&
          [d.roles, d.channels, d.categories, d.emojis, d.automod].every((c) => !c.added.length && !c.removed.length && !c.changed.length);
        if (noChange) return { id: latest.id, name: latest.name, version: latest.version, unchanged: true };
      }
      const rec = await r.addSnapshot({
        name: body.name ?? `${snapshot.guild.name} (v${existing.length + 1})`,
        version: existing.length + 1,
        sourceGuildId: snapshot.source.guildId,
        capturedAt: snapshot.capturedAt,
        schemaVersion: snapshot.schemaVersion,
        snapshot,
        ownerEmail: operatorOf(req),
      });
      pingActivity('imported');
      return { id: rec.id, name: rec.name, version: rec.version, unchanged: false };
    } catch (err) {
      console.error('snapshot capture failed:', err); // detail server-side; generic to the client
      return reply.code(500).send({ error: 'capture failed' });
    }
  });

  // Export a snapshot (+ optional config) as a portable, checksummed .discobundle (§7).
  app.get('/snapshots/:id/export', { preHandler: requireAuth }, async (req, reply) => {
    const rec = await scoped(req).getSnapshot((req.params as { id: string }).id);
    if (!rec) return reply.code(404).send({ error: 'not found' }); // non-owner → 404 (no cross-operator export)
    // Embed asset bytes best-effort (skip any that aren't in storage — e.g. demo fixtures).
    const assets: Record<string, string> = {};
    for (const key of collectAssetKeys(rec.snapshot)) {
      try {
        assets[key] = (await store.get(key)).toString('base64');
      } catch {
        /* asset bytes not present — bundle stays valid without them */
      }
    }
    const bundle = exportBundle({ snapshot: rec.snapshot, assets, name: rec.name, exportedAt: new Date().toISOString() });
    const filename = `${rec.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'snapshot'}.discobundle`;
    reply.header('Content-Type', 'application/json');
    reply.header('Content-Disposition', `attachment; filename="${filename}"`);
    return bundle;
  });

  // Import a .discobundle → a new snapshot (writing any embedded assets back at their exact keys).
  app.post('/bundles/import', { preHandler: requireAuth }, async (req, reply) => {
    try {
      const { snapshot, assets, name } = parseBundle(req.body);
      for (const [key, b64] of Object.entries(assets)) {
        await store.putAt(key, Buffer.from(b64, 'base64')).catch(() => {});
      }
      const r = scoped(req);
      const existing = (await r.listSnapshots()).filter((s) => s.sourceGuildId === snapshot.source.guildId);
      const rec = await r.addSnapshot({
        name: name || `${snapshot.guild.name} (imported)`,
        version: existing.length + 1,
        sourceGuildId: snapshot.source.guildId,
        capturedAt: snapshot.capturedAt,
        schemaVersion: snapshot.schemaVersion,
        snapshot,
        ownerEmail: operatorOf(req),
      });
      return { id: rec.id, name: rec.name, version: rec.version };
    } catch (err) {
      if (err instanceof BundleError) return reply.code(400).send({ error: err.message }); // controlled, safe
      console.error('bundle import failed:', err); // detail server-side; generic to the client
      return reply.code(500).send({ error: 'could not import bundle' });
    }
  });

  // ── starter packs (#15): curated, sellable template snapshots an operator clones into their library ──
  app.get('/starter-packs', { preHandler: requireAuth }, async () =>
    makeStarterPacks().map((p) => ({
      key: p.key,
      title: p.title,
      pitch: p.pitch,
      niche: p.niche,
      guildName: p.snapshot.guild.name,
      counts: {
        roles: p.snapshot.roles.length,
        channels: p.snapshot.channels.length,
        categories: p.snapshot.categories.length,
        emojis: p.snapshot.emojis.length,
      },
      // enough structure for a browse/preview without shipping the whole artifact
      categories: p.snapshot.categories.map((c) => c.name),
      sampleChannels: p.snapshot.channels.slice(0, 10).map((c) => c.name),
      roles: p.snapshot.roles.filter((r) => !r.isEveryone).map((r) => r.name),
    })),
  );

  app.post('/starter-packs/:key/import', { preHandler: requireAuth }, async (req, reply) => {
    const pack = makeStarterPacks().find((p) => p.key === (req.params as { key: string }).key);
    if (!pack) return reply.code(404).send({ error: 'unknown starter pack' });
    const r = scoped(req);
    const existing = (await r.listSnapshots()).filter((s) => s.sourceGuildId === pack.snapshot.source.guildId);
    // Re-importing the same pack is a no-op — return the copy this operator already has rather than
    // spawning duplicate v2/v3… snapshots (bounds growth from repeated clicks).
    const already = existing.find((s) => s.name === pack.title);
    if (already) return { id: already.id, name: already.name, version: already.version, unchanged: true };
    const rec = await r.addSnapshot({
      name: pack.title,
      version: existing.length + 1,
      sourceGuildId: pack.snapshot.source.guildId,
      capturedAt: pack.snapshot.capturedAt,
      schemaVersion: pack.snapshot.schemaVersion,
      snapshot: pack.snapshot,
      ownerEmail: operatorOf(req),
    });
    // Clones land as reusable templates, tagged + noted with the pack pitch.
    await r.updateSnapshot(rec.id, { isTemplate: true, tags: [pack.key, 'starter-pack'], note: pack.pitch });
    pingActivity('imported');
    return { id: rec.id, name: rec.name, version: rec.version };
  });

  // ── clients ──
  app.get('/clients', { preHandler: requireAuth }, async (req) => scoped(req).listClients());
  app.post('/clients', { preHandler: requireAuth }, async (req) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    pingActivity('client');
    // Bound free-text lengths (defense-in-depth — keep unbounded operator input out of the DB).
    const clamp = (v: unknown, max: number) => String(v ?? '').slice(0, max);
    const arr = (v: unknown, max: number) => (Array.isArray(v) ? v.slice(0, max) : []);
    return scoped(req).addClient({
      ownerEmail: operatorOf(req),
      creatorName: clamp(b.creatorName || 'New Client', 120),
      handle: clamp(b.handle, 120),
      brandColors: arr(b.brandColors, 24) as string[],
      links: arr(b.links, 24) as string[],
      assets: {},
      termSwaps: arr(b.termSwaps, 200) as { from: string; to: string }[],
      notes: clamp(b.notes, 5000),
      // clamp to non-negative — a negative price would corrupt every Economics/Today money figure
      buildPrice: Math.max(0, Number(b.buildPrice) || 0),
      monthlyRetainer: Math.max(0, Number(b.monthlyRetainer) || 0),
      upsells: Array.isArray(b.upsells)
        ? (b.upsells as { name: string; price: number }[]).map((u) => ({ name: String(u?.name ?? ''), price: Math.max(0, Number(u?.price) || 0) }))
        : [],
    });
  });
  app.delete('/clients/:id', { preHandler: requireAuth }, async (req) => {
    const id = (req.params as { id: string }).id;
    const r = scoped(req);
    const c = await r.getClient(id);
    if (!c) return { ok: true }; // not owned / not found → nothing to delete (no cross-operator delete)
    await r.deleteClient(id);
    await repo.addAudit({ action: 'client.delete', target: c.creatorName, detail: c.handle, operator: operatorOf(req) });
    return { ok: true };
  });

  // Operator accountability log of destructive operations. Scoped: an admin sees every operator's
  // actions; a regular operator sees only their own (multi-operator readiness).
  app.get('/audit', { preHandler: requireAuth }, async (req) => {
    const session = (req as FastifyRequest & { session?: { email: string; role: string } }).session;
    const all = await repo.listAudit(500);
    return (session?.role === 'admin' ? all : all.filter((a) => a.operator === session?.email)).slice(0, 200);
  });

  // Build-lifecycle event log (#12): every build's started/resumed/completed/failed transitions.
  app.get('/events', { preHandler: requireAuth }, async (req) => {
    const jobId = (req.query as { jobId?: string }).jobId;
    return scoped(req).listBuildEvents(jobId, 200);
  });

  // Engagement signal for a delivered handover (#14): how many times the client opened it + when.
  app.get('/handovers/:id/views', { preHandler: requireAuth }, async (req) => {
    const views = await scoped(req).listHandoverViews((req.params as { id: string }).id);
    return { count: views.length, recent: views.slice(0, 50) };
  });

  // Handover engagement analytics (#4): per-kind aggregate counts + a recent timeline, for the operator.
  // Privacy: built only from referrer-origin + timestamps + the event kind — never an IP or identity.
  app.get('/handovers/:id/analytics', { preHandler: requireAuth }, async (req) => {
    const views = await scoped(req).listHandoverViews((req.params as { id: string }).id);
    const byKind: Record<string, number> = {};
    for (const v of views) byKind[v.kind] = (byKind[v.kind] ?? 0) + 1;
    const opens = views.filter((v) => v.kind === 'opened').map((v) => v.at).sort();
    return {
      total: views.length,
      opened: byKind.opened ?? 0,
      reportDownloaded: byKind.report_downloaded ?? 0,
      docsViewed: byKind.docs_viewed ?? 0,
      shareViewed: byKind.share_viewed ?? 0,
      firstOpenedAt: opens[0] ?? null,
      lastSeenAt: views[0]?.at ?? null, // listHandoverViews returns newest-first
      timeline: views.slice(0, 30).map((v) => ({ at: v.at, kind: v.kind, referrer: v.referrer })),
    };
  });

  // Public, anonymous engagement beacon (#4): the delivery page calls this when the client downloads
  // the report or expands the docs. Allowlisted kinds only; no auth (the handover id is the capability).
  app.post('/h/:id/event', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const kind = ((req.body ?? {}) as { kind?: string }).kind ?? '';
    if (!['report_downloaded', 'docs_viewed'].includes(kind)) return reply.code(400).send({ error: 'unknown event' });
    const h = await repo.getHandover(id); // raw repo: public capability path, gated by its own rules
    if (!h || h.state === 'draft') return reply.code(404).send({ error: 'not found' });
    void repo.recordHandoverView(id, 'beacon', kind);
    return { ok: true };
  });

  // Operator productivity widgets (#6): read-only rollups over this operator's own data (scoped).
  app.get('/dashboard', { preHandler: requireAuth }, async (req) => {
    const r = scoped(req);
    const now = Date.now();
    const WEEK = 7 * 24 * 3600 * 1000;
    const H72 = 72 * 3600 * 1000;
    const [jobs, clients, handovers] = await Promise.all([r.listJobs(), r.listClients(), r.listHandovers()]);
    const builds = jobs.filter((j) => j.status === 'completed' && !j.dryRun);
    const buildsThisWeek = builds.filter((j) => now - new Date(j.createdAt).getTime() < WEEK).length;
    const durations = builds.map((j) => j.metrics?.durationMs ?? 0).filter((d) => d > 0);
    const avgBuildMs = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;
    // Stuck = a DELIVERED handover (not a draft) that's >72h old and the client has never opened.
    let stuckHandovers = 0;
    for (const h of handovers) {
      if (h.state === 'draft' || now - new Date(h.createdAt).getTime() < H72) continue;
      if ((await r.listHandoverViews(h.id)).length === 0) stuckHandovers += 1;
    }
    const retainedClients = clients.filter((c) => c.monthlyRetainer > 0).length;
    return {
      buildsThisWeek,
      avgBuildMs,
      stuckHandovers,
      totalClients: clients.length,
      retainedClients,
      clientRetentionRate: clients.length ? Math.round((retainedClients / clients.length) * 100) : 0,
    };
  });

  // ── rebrand preview ──
  app.post('/rebrand/preview', { preHandler: requireAuth }, async (req, reply) => {
    const body = (req.body ?? {}) as { snapshotId?: string; config?: unknown };
    const rec = body.snapshotId ? await scoped(req).getSnapshot(body.snapshotId) : undefined;
    if (!rec) return reply.code(404).send({ error: 'snapshot not found' });
    const parsed = RebrandConfig.safeParse(body.config);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid config', detail: parsed.error.flatten() });
    const { snapshot, preview } = rebrand(rec.snapshot, parsed.data);
    return { preview, rebrandedGuildName: snapshot.guild.name, brandTokens: rec.snapshot.brandTokens };
  });

  // ── jobs ──
  app.post('/jobs', { preHandler: requireAuth }, async (req, reply) => {
    const body = (req.body ?? {}) as { snapshotId?: string; clientId?: string; config?: unknown; dryRun?: boolean; canary?: boolean; targetGuildId?: string };
    const r = scoped(req);
    const rec = body.snapshotId ? await r.getSnapshot(body.snapshotId) : undefined;
    if (!rec) return reply.code(404).send({ error: 'snapshot not found' });
    const parsed = RebrandConfig.safeParse(body.config);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid config', detail: parsed.error.flatten() });

    // Job.clientId is a real DB relation — only link a client this operator owns (the rebrand config's
    // logical clientId lives in rebrandConfig, not here). Unknown/unowned/absent → null.
    const clientId = body.clientId && (await r.getClient(body.clientId)) ? body.clientId : null;

    const job = await r.addJob({
      kind: 'rebuild',
      status: 'queued',
      snapshotId: rec.id,
      clientId,
      targetGuildId: body.targetGuildId ?? null,
      dryRun: body.dryRun ?? false,
      canary: !!body.canary,
      rebrandConfig: parsed.data,
      metrics: null,
      progress: 0,
      manifest: null,
      report: null,
      error: null,
      ownerEmail: operatorOf(req),
    });

    if (useQueue()) {
      // Cross-process: enqueue to BullMQ; the worker executes and writes results to Postgres.
      // jobId === Postgres id === log channel, so a duplicate add is idempotent. Retries are safe to
      // resume because the whole build — including the content/webhook step — is reconciled and
      // checkpointed in the manifest, so a retry never duplicates Discord objects or re-posts content.
      const data: BuildJobData = {
        jobId: job.id,
        snapshot: rec.snapshot,
        config: parsed.data,
        dryRun: job.dryRun,
        targetGuildId: job.targetGuildId,
        contentIdentity: 'server',
      };
      await getQueue().add('rebuild', data, {
        jobId: job.id,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: { age: 86400 },
        removeOnFail: false,
      });
    } else {
      // In-process demo path; logs stream over the in-memory channel.
      void runBuild(repo, channel, { jobId: job.id, snapshot: rec.snapshot, config: parsed.data, dryRun: job.dryRun });
    }
    // Bump "last used" so the library can surface recently-built templates.
    void repo.updateSnapshot(rec.id, { lastUsedAt: new Date().toISOString() }).catch(() => {});
    pingActivity('build');
    return { id: job.id, status: job.status };
  });

  app.get('/jobs', { preHandler: requireAuth }, async (req) => {
    // snapshotNames() is a cheap id→name select (no artifact-blob parse) — the /jobs list is the
    // hottest polled endpoint, so this avoids deserializing every snapshot on every tick.
    const r = scoped(req);
    const [jobs, snaps, clients] = await Promise.all([r.listJobs(), r.snapshotNames(), r.listClients()]);
    const snapName = new Map(snaps.map((s) => [s.id, s.name]));
    const clientName = new Map(clients.map((c) => [c.id, c.creatorName]));
    return jobs.map((j) => ({
      id: j.id,
      kind: j.kind,
      status: j.status,
      dryRun: j.dryRun,
      canary: j.canary,
      progress: j.progress,
      snapshotId: j.snapshotId,
      snapshotName: j.snapshotId ? snapName.get(j.snapshotId) ?? null : null,
      clientId: j.clientId,
      clientName: j.clientId ? clientName.get(j.clientId) ?? null : null,
      error: j.error,
      metrics: j.metrics,
      createdAt: j.createdAt,
      updatedAt: j.updatedAt,
    }));
  });

  app.get('/jobs/:id', { preHandler: requireAuth }, async (req, reply) => {
    const j = await scoped(req).getJob((req.params as { id: string }).id);
    if (!j) return reply.code(404).send({ error: 'not found' });
    // Redact Discord webhook tokens before returning the manifest. A content-step webhook entry stores
    // newId = `${webhookId}:${webhookToken}`; that token is a live, unauthenticated post-to-channel
    // credential for the CLIENT's guild — it must never reach the browser (or a DB backup taken via API).
    if (j.manifest?.entries?.some((e) => e.kind === 'webhook')) {
      return {
        ...j,
        manifest: {
          ...j.manifest,
          entries: j.manifest.entries.map((e) =>
            e.kind === 'webhook' && typeof e.newId === 'string' && e.newId.includes(':')
              ? { ...e, newId: `${e.newId.slice(0, e.newId.indexOf(':'))}:***redacted***` }
              : e,
          ),
        },
      };
    }
    return j;
  });

  // SSE live logs — works identically over the in-memory or Redis channel.
  app.get('/jobs/:id/logs', { preHandler: requireAuth }, async (req, reply) => {
    const jobId = (req.params as { id: string }).id;
    // Ownership gate BEFORE hijacking the socket — a non-owner must not stream another operator's build
    // logs (target guild id, channel/role names, content). 404 (opaque) if not owned/not found.
    if (!(await scoped(req).getJob(jobId))) return reply.code(404).send({ error: 'not found' });
    // Take over the raw socket — Fastify must not also try to send/serialize a response.
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      // raw responses bypass the CORS plugin — set the header so the browser can read the stream.
      // Never reflect an arbitrary Origin: when an allowlist is set, echo only a member (else its
      // first entry); when public ('*'), '*' is safe because we don't use credentials.
      'Access-Control-Allow-Origin': allowedOrigins
        ? allowedOrigins.includes(req.headers.origin ?? '')
          ? req.headers.origin!
          : allowedOrigins[0]!
        : '*',
    });

    let closed = false;
    let unsub: (() => void) | undefined;
    const sent = new Set<number>(); // seq dedup for the replay↔live overlap
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      unsub?.();
      if (!closed) {
        closed = true;
        reply.raw.end();
      }
    };
    // Register teardown BEFORE any await — a client that disconnects during the awaits below would
    // otherwise emit 'close' before we attach the handler, leaking the Redis subscriber connection.
    req.raw.on('close', cleanup);

    const send = (ev: JobEvent) => {
      if (closed) return;
      if (ev.seq !== undefined) {
        if (sent.has(ev.seq)) return;
        sent.add(ev.seq);
      }
      reply.raw.write(`data: ${JSON.stringify(ev)}\n\n`);
      if (ev.type === 'done' || ev.type === 'error') cleanup();
    };

    try {
      // Terminal short-circuit: if the job already finished (e.g. reconnect after the log TTL expired),
      // emit a synthetic terminal event so the client never hangs waiting for a 'done' that won't come.
      const existing = await repo.getJob(jobId);
      if (existing && (existing.status === 'completed' || existing.status === 'failed')) {
        for (const ev of await channel.replay(jobId)) send(ev);
        if (!closed) {
          send(
            existing.status === 'completed'
              ? { type: 'done', message: 'Build already complete.' }
              : { type: 'error', message: existing.error ?? 'Build failed.' },
          );
        }
        cleanup();
        return;
      }

      // Subscribe FIRST, then replay — so an event landing in the gap is delivered live (and deduped
      // by seq), never lost. Gap-free + duplicate-free.
      unsub = await channel.subscribe(jobId, send);
      if (cleaned) {
        unsub(); // client disconnected during subscribe — tear down immediately
        return;
      }
      for (const ev of await channel.replay(jobId)) send(ev);
    } catch (err) {
      // Post-hijack rejection: Fastify can't send an error response on a hijacked reply, so surface it
      // as a synthetic SSE error and close the socket ourselves.
      send({ type: 'error', message: err instanceof Error ? err.message : 'log stream error' });
      cleanup();
    }
  });

  // SSE live activity feed: pushes a ping whenever something happens (a build finishes, a server is
  // imported, a handover is created, a client is added) so the Activity screen refetches instantly.
  app.get('/activity/stream', { preHandler: requireAuth }, async (req, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': allowedOrigins ? (allowedOrigins.includes(req.headers.origin ?? '') ? req.headers.origin! : allowedOrigins[0]!) : '*',
    });
    let closed = false;
    const cleanup = async () => {
      if (closed) return;
      closed = true;
      (await unsubP)?.();
      reply.raw.end();
    };
    req.raw.on('close', () => void cleanup());
    reply.raw.write(`data: ${JSON.stringify({ type: 'open' })}\n\n`); // prompt the client to do an initial load
    const unsubP = Promise.resolve(
      channel.subscribe(ACTIVITY_KEY, (ev) => {
        if (!closed) reply.raw.write(`data: ${JSON.stringify({ type: 'ping', message: ev.message })}\n\n`);
      }),
    ).catch(() => undefined);
    // heartbeat so proxies don't drop an idle connection
    const hb = setInterval(() => !closed && reply.raw.write(': hb\n\n'), 25_000);
    req.raw.on('close', () => clearInterval(hb));
  });

  /** Re-run a failed/canceled job. The persisted manifest means it RESUMES, not restarts. */
  app.post('/jobs/:id/retry', { preHandler: requireAuth }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const r = scoped(req);
    const job = await r.getJob(id);
    if (!job) return reply.code(404).send({ error: 'not found' });
    if (job.status !== 'failed' && job.status !== 'canceled') {
      return reply.code(400).send({ error: `only failed or canceled jobs can be retried (status: ${job.status})` });
    }
    if (!job.snapshotId || !job.rebrandConfig) return reply.code(400).send({ error: 'job is missing its snapshot or config' });
    const snap = await r.getSnapshot(job.snapshotId);
    if (!snap) return reply.code(404).send({ error: 'snapshot not found' });

    await r.updateJob(id, { status: 'queued', error: null });
    const data: BuildJobData = {
      jobId: id,
      snapshot: snap.snapshot,
      config: job.rebrandConfig,
      dryRun: job.dryRun,
      targetGuildId: job.targetGuildId,
      contentIdentity: 'server',
    };
    if (useQueue()) {
      const q = getQueue();
      await q.remove(id).catch(() => {}); // clear any stale failed job so the id is reusable
      await q.add('rebuild', data, { jobId: id, attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: { age: 86400 }, removeOnFail: false });
    } else {
      void runBuild(repo, channel, { jobId: id, snapshot: snap.snapshot, config: job.rebrandConfig, dryRun: job.dryRun });
    }
    return { id, status: 'queued' };
  });

  /** Cancel a queued (not-yet-started) job. A running build can't be interrupted mid-flight — be honest. */
  app.post('/jobs/:id/cancel', { preHandler: requireAuth }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const r = scoped(req);
    const job = await r.getJob(id);
    if (!job) return reply.code(404).send({ error: 'not found' });
    if (job.status === 'running') return reply.code(409).send({ error: 'job is already running and cannot be interrupted' });
    if (job.status !== 'queued' && job.status !== 'paused') return reply.code(400).send({ error: `cannot cancel a ${job.status} job` });
    if (useQueue()) await getQueue().remove(id).catch(() => {});
    await r.updateJob(id, { status: 'canceled' });
    await repo.addAudit({ action: 'build.cancel', target: `job ${id.slice(-6)}`, detail: job.kind, operator: operatorOf(req) });
    return { id, status: 'canceled' };
  });

  // Pre-flight authority audit: does the bot have the perms Disco needs in this guild? (§ before live)
  app.get('/preflight/:guildId', { preHandler: requireAuth }, async (req, reply) => {
    const guildId = (req.params as { guildId: string }).guildId;
    try {
      const perms = isLiveMode()
        ? await new DiscordGuildClient({ token: env.discordBotToken, guildId, store }).getBotPermissions()
        : await new MockGuild(guildId).getBotPermissions();
      return { guildId, mode: isLiveMode() ? 'live' : 'demo', ...auditAuthority(perms) };
    } catch (err) {
      console.error('preflight/guild fetch failed:', err); // detail server-side; generic to the client
      return reply.code(502).send({ error: 'could not reach Discord', reachable: false });
    }
  });

  // ── invite-link generator ──
  app.get('/invite-url', { preHandler: requireAuth }, async (req, reply) => {
    const q = req.query as { mode?: 'administrator' | 'granular'; guildId?: string; applicationId?: string };
    const applicationId = q.applicationId || env.discordApplicationId;
    if (!applicationId) return reply.code(400).send({ error: 'applicationId required (set DISCORD_APPLICATION_ID or pass ?applicationId=)' });
    return buildInviteUrl({ applicationId, mode: q.mode ?? 'administrator', guildId: q.guildId });
  });

  // ── Stripe sales-flow scaffold (checkout + webhook → auto-create client) ──
  registerStripeRoutes(app, repo, rateLimited);

  // ── handover (delivery) ──
  // Create-or-fetch a handover for a completed job (idempotent per job).
  app.post('/handovers', { preHandler: requireAuth }, async (req, reply) => {
    const body = (req.body ?? {}) as { jobId?: string };
    const r = scoped(req);
    const job = body.jobId ? await r.getJob(body.jobId) : undefined;
    if (!job) return reply.code(404).send({ error: 'job not found' });
    if (job.canary) return reply.code(409).send({ error: 'This is a canary/test build — rebuild without canary to deliver it to a client.' });
    const existing = await r.getHandoverByJob(job.id);
    if (existing) return existing;
    pingActivity('handover');
    return r.addHandover({
      jobId: job.id,
      clientId: job.clientId,
      state: 'draft',
      ownershipSteps: defaultOwnershipSteps(),
      upsellStatus: 'none',
      ownerEmail: operatorOf(req),
    });
  });

  // Operator view: the handover + its job (with report = included scope + bot checklist + manual steps).
  app.get('/handovers/:id', { preHandler: requireAuth }, async (req, reply) => {
    const r = scoped(req);
    const h = await r.getHandover((req.params as { id: string }).id);
    if (!h) return reply.code(404).send({ error: 'not found' });
    const job = await r.getJob(h.jobId);
    return { handover: h, job };
  });

  app.patch('/handovers/:id', { preHandler: requireAuth }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const b = (req.body ?? {}) as {
      state?: HandoverPatch['state']; ownershipSteps?: HandoverPatch['ownershipSteps']; upsellStatus?: HandoverPatch['upsellStatus'];
      password?: string | null; welcomeMessage?: string; logo?: string | null;
    };
    const patch: HandoverPatch = {};
    if (b.state !== undefined) patch.state = b.state;
    if (b.ownershipSteps !== undefined) patch.ownershipSteps = b.ownershipSteps;
    if (b.upsellStatus !== undefined) patch.upsellStatus = b.upsellStatus;
    if (b.password !== undefined) {
      patch.passwordHash = b.password ? bcrypt.hashSync(b.password, 10) : null;
      await repo.addAudit({ action: 'handover.password', target: `handover ${id.slice(-6)}`, detail: b.password ? 'password set' : 'password cleared', operator: operatorOf(req) });
    }
    if (b.welcomeMessage !== undefined) patch.welcomeMessage = b.welcomeMessage;
    if (b.logo !== undefined) {
      if (b.logo === null) patch.logoKey = null;
      else {
        // accept a data URL or raw base64; store the bytes and reference the key.
        const m = b.logo.match(/^data:image\/(\w+);base64,(.*)$/s);
        const ext = m ? m[1]! : 'png';
        const data = m ? m[2]! : b.logo;
        patch.logoKey = await store.put(Buffer.from(data, 'base64'), ext);
      }
    }
    const h = await scoped(req).updateHandover(id, patch);
    if (!h) return reply.code(404).send({ error: 'not found' });
    return h;
  });

  // Public asset serve (handover logos). Key format: assets/<hash>.<ext> — capture via wildcard.
  app.get('/assets/*', async (req, reply) => {
    const key = `assets/${(req.params as Record<string, string>)['*']}`;
    if (!/^assets\/[a-z0-9]+\.[a-z0-9]+$/i.test(key)) return reply.code(400).send({ error: 'bad key' });
    try {
      const bytes = await store.get(key);
      const ext = key.split('.').pop() ?? 'png';
      reply.header('Content-Type', ext === 'svg' ? 'image/svg+xml' : `image/${ext === 'jpg' ? 'jpeg' : ext}`);
      reply.header('Cache-Control', 'public, max-age=86400');
      // A user-supplied SVG served as image/svg+xml can execute script if opened top-level — lock it
      // down so it can only ever be an inert image, never an XSS vector.
      reply.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
      return reply.send(bytes);
    } catch {
      return reply.code(404).send({ error: 'not found' });
    }
  });

  // Public, shareable, read-only delivery page (optionally password-gated). No auth.
  app.get('/h/:id', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const h = await repo.getHandover(id);
    if (!h) return reply.code(404).send({ error: 'not found' });
    // A draft handover is work-in-progress — never expose its build scope/manual-steps publicly. The
    // operator marks it ready/handed_over before the share link resolves. (Opaque 404, no WIP leak.)
    if (h.state === 'draft') return reply.code(404).send({ error: 'not found' });
    if (h.hasPassword) {
      if (rateLimited(`h:${req.ip}:${id}`, 10, 60_000)) return reply.code(429).send({ error: 'Too many attempts — wait a minute.' });
      const pw = (req.query as { pw?: string }).pw ?? '';
      const hash = await repo.getHandoverPasswordHash(id);
      if (!hash || !bcrypt.compareSync(pw, hash)) return reply.code(401).send({ error: 'password required', needsPassword: true });
    }
    // Record an anonymous open (#14) — referrer ORIGIN only, never an IP or any identifier.
    const referrer = (() => {
      const r = req.headers.referer;
      if (!r) return 'direct';
      try { return new URL(r).origin; } catch { return 'direct'; }
    })();
    void repo.recordHandoverView(id, referrer);

    const job = await repo.getJob(h.jobId);
    const snap = job?.snapshotId ? await repo.getSnapshot(job.snapshotId) : undefined;
    return {
      serverName: job?.rebrandConfig?.serverName ?? snap?.snapshot.guild.name ?? null,
      sourceName: snap?.name ?? null,
      state: h.state,
      logoUrl: h.logoKey ? `/${h.logoKey}` : null,
      welcomeMessage: h.welcomeMessage,
      scope: job?.report?.counts ?? {},
      created: job?.report?.created ?? [],
      botChecklist: job?.report?.botChecklist ?? [],
      botSetup: job?.report?.botSetup ?? [],
      manualSteps: job?.report?.manualSteps ?? [],
      ownershipSteps: h.ownershipSteps,
    };
  });

  // Crawler-friendly share preview. Social/preview bots don't run JS or follow #/h/:id hash
  // fragments, so they can't read the SPA delivery page — serve them server-rendered OG/Twitter
  // meta + a clean human-facing card that links into the real SPA delivery page. No auth (public,
  // like GET /h/:id). A password-GATED handover stays opaque: generic title/description, no details.
  app.get('/share/:id', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const h = await repo.getHandover(id);
    if (!h) return reply.code(404).send({ error: 'not found' });

    // Gated handovers must not leak scope — only resolve the real server name when it's open.
    let serverName: string | null = null;
    if (!h.hasPassword) {
      const job = await repo.getJob(h.jobId);
      const snap = job?.snapshotId ? await repo.getSnapshot(job.snapshotId) : undefined;
      serverName = job?.rebrandConfig?.serverName ?? snap?.snapshot.guild.name ?? null;
    }

    const titleName = serverName ?? 'Your community';
    const ogTitle = `${titleName} is ready`;
    const ogDescription = 'Your fully-branded community — built and delivered with Disco.';
    // Absolute base for canonical/image URLs — only usable when WEB_ORIGIN is a real origin
    // (the demo default '*' is not), else omit absolute URLs rather than fabricate a broken one.
    const origin = env.webOrigin && env.webOrigin !== '*' ? env.webOrigin.replace(/\/+$/, '') : '';
    const ogUrl = origin ? `${origin}/share/${encodeURIComponent(id)}` : `/share/${id}`;
    const deliveryHref = origin ? `${origin}/#/h/${encodeURIComponent(id)}` : `/#/h/${id}`;
    // og:image only when there's an absolute logo to point at — never invent one.
    const ogImage = origin && h.logoKey ? `${origin}/${h.logoKey}` : null;

    const e = escapeHtml;
    const imageTags = ogImage
      ? `\n    <meta property="og:image" content="${e(ogImage)}" />\n    <meta name="twitter:image" content="${e(ogImage)}" />`
      : '';

    const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${e(ogTitle)}</title>
    <meta property="og:title" content="${e(ogTitle)}" />
    <meta property="og:description" content="${e(ogDescription)}" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="${e(ogUrl)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${e(ogTitle)}" />
    <meta name="twitter:description" content="${e(ogDescription)}" />${imageTags}
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet" />
    <style>
      :root { color-scheme: dark; }
      * { box-sizing: border-box; }
      body {
        margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px;
        font-family: 'Space Grotesk', ui-sans-serif, system-ui, sans-serif;
        background: radial-gradient(1200px 600px at 50% -10%, #1c1240 0%, transparent 60%), #07060d;
        color: #ece9f6;
      }
      .card {
        width: 100%; max-width: 520px; padding: 40px 36px; border-radius: 22px; text-align: center;
        background: linear-gradient(180deg, rgba(28,22,52,0.9), rgba(13,10,26,0.92));
        border: 1px solid rgba(167,139,250,0.22);
        box-shadow: 0 30px 80px -30px rgba(124,58,237,0.45), inset 0 1px 0 rgba(255,255,255,0.04);
      }
      .logo {
        width: 84px; height: 84px; margin: 0 auto 22px; border-radius: 18px; object-fit: cover; display: block;
        border: 1px solid rgba(255,255,255,0.12);
      }
      .eyebrow {
        font-size: 12px; letter-spacing: 0.18em; text-transform: uppercase; font-weight: 600; margin: 0 0 14px;
        background: linear-gradient(90deg, #a78bfa, #fb7185); -webkit-background-clip: text;
        background-clip: text; color: transparent;
      }
      h1 { font-size: 30px; line-height: 1.15; font-weight: 700; margin: 0 0 12px; }
      h1 .name {
        background: linear-gradient(90deg, #c4b5fd, #fb7185); -webkit-background-clip: text;
        background-clip: text; color: transparent;
      }
      p.sub { margin: 0 0 30px; font-size: 16px; line-height: 1.5; color: #b3aecb; }
      a.cta {
        display: inline-block; text-decoration: none; font-weight: 700; font-size: 16px;
        padding: 14px 28px; border-radius: 12px; color: #1a1205;
        background: linear-gradient(90deg, #f5c451, #e0a93a);
        box-shadow: 0 12px 30px -10px rgba(224,169,58,0.6);
      }
      .foot { margin-top: 26px; font-size: 12px; letter-spacing: 0.04em; color: #6f6a86; }
    </style>
  </head>
  <body>
    <main class="card">
      ${ogImage ? `<img class="logo" src="${e(ogImage)}" alt="${e(titleName)} logo" />` : ''}
      <p class="eyebrow">Delivered with Disco</p>
      <h1><span class="name">${e(titleName)}</span><br />Your community is ready</h1>
      <p class="sub">${e(ogDescription)}</p>
      <a class="cta" href="${e(deliveryHref)}">Open your delivery →</a>
      <div class="foot">Powered by Disco</div>
    </main>
  </body>
</html>`;

    reply.header('Content-Type', 'text/html; charset=utf-8');
    // The share card is server-rendered HTML with an inline <style> + Google Fonts + an OG image. No
    // scripts at all, so default-src 'none' with only style/font/img allowances closes injection.
    reply.header(
      'Content-Security-Policy',
      "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src https: data:; base-uri 'none'; form-action 'none'",
    );
    return reply.send(html);
  });

  return app;
}

/** Escape a string for safe interpolation into HTML text and double-quoted attributes. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
