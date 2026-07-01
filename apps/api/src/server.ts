import { auditAuthority, auditBuildLimits, type BuildJobData, BundleError, captureSnapshot, collectAssetKeys, dryRunReport, exportBundle, makeSampleSnapshot, makeStarterPacks, mergeSnapshots, type MergeResolutions, parseBundle, rebrand } from '@disco/core';
import { defaultOwnershipSteps, emptyOperatorPrefs, OperatorPrefsPatch, RebrandConfig, type SnapshotRecord, SnapshotMetaPatch } from '@disco/schema';
import { DiscordGuildClient, DiskAssetStore, listJoinedGuilds, MockGuild, mockGuildFromSnapshot } from '@disco/sdk';
import { demoGuildSnapshot, listDemoGuilds } from './demoGuilds.js';
import cors from '@fastify/cors';
import bcrypt from 'bcryptjs';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { type Role, roleFor, signSession, verifyCredentials, verifySession } from './auth.js';
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
    let dbOk = true; // the repo read below doubles as a DB reachability probe
    try {
      const completed = (await repo.listJobs()).filter((j) => j.status === 'completed').map((j) => j.updatedAt).sort();
      lastBuildAt = completed.length ? completed[completed.length - 1]! : null;
    } catch {
      dbOk = false; // repo/DB unreachable (status must never throw)
    }
    // DEGRADED when a configured dependency is down: the queue is Redis-backed but no worker is consuming,
    // or Postgres is the backend but a read failed. Monitoring can alert on status; HTTP stays 200 so a
    // transient worker restart doesn't flap a liveness probe (the API process itself is up).
    const degraded = (useQueue() && worker === 'down') || (usePrisma() && !dbOk);
    return {
      ok: true,
      status: (degraded ? 'degraded' : 'healthy') as 'healthy' | 'degraded',
      mode: isLiveMode() ? 'live' : 'demo',
      api: 'up' as const,
      worker,
      db: usePrisma() ? ((dbOk ? 'up' : 'down') as 'up' | 'down') : ('in-memory' as const),
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
    const email = (body.email ?? '').trim();
    const password = body.password ?? '';
    // 1) The env-configured bootstrap admin — unchanged path (always works, even if the DB is empty/down).
    let principal = '';
    if (await verifyCredentials(email, password)) {
      principal = email;
    } else if (email && password) {
      // 2) A DB-backed operator (multi-operator / white-label) — additive, inert until an admin invites one.
      // An admin email must ONLY authenticate via the env path above — never a DB row (which would mint an
      // admin token from a DB-stored password). So a DB op whose email resolves to admin is refused here.
      const op = await repo.getOperatorByEmail(email);
      if (op && roleFor(op.email) !== 'admin' && (await bcrypt.compare(password, op.passwordHash))) principal = op.email;
    }
    if (!principal) return reply.code(401).send({ error: 'invalid credentials' });
    return { token: signSession({ email: principal }), email: principal };
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
      shared: s.shared,
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
    return { id: rec.id, name: rec.name, tags: rec.tags, note: rec.note, favorite: rec.favorite, isTemplate: rec.isTemplate, shared: rec.shared };
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
      await repo.addAudit({ action: 'snapshot.create', target: rec.name, detail: `v${rec.version} captured`, operator: operatorOf(req) });
      return { id: rec.id, name: rec.name, version: rec.version, unchanged: false };
    } catch (err) {
      console.error('snapshot capture failed:', err); // detail server-side; generic to the client
      return reply.code(500).send({ error: 'capture failed' });
    }
  });

  // Read-only SCAN preview (#2): scan a guild and return a structural summary WITHOUT persisting, so the
  // operator reviews what a white-label import would pull before committing. Saving is the separate
  // /snapshots/capture step. Live use needs the bot token (read-only); demo uses the fixture guilds.
  app.post('/snapshots/scan', { preHandler: requireAuth }, async (req, reply) => {
    const body = (req.body ?? {}) as { sourceGuildId?: string };
    try {
      let snapshot;
      if (isLiveMode()) {
        if (!body.sourceGuildId) return reply.code(400).send({ error: 'Pick a server to scan.' });
        snapshot = await captureSnapshot(new DiscordGuildClient({ token: env.discordBotToken, guildId: body.sourceGuildId, store }), { ownerNote: 'scan preview' });
      } else if (body.sourceGuildId) {
        const source = demoGuildSnapshot(body.sourceGuildId);
        if (!source) return reply.code(404).send({ error: 'Unknown server.' });
        snapshot = await captureSnapshot(mockGuildFromSnapshot(source), { ownerNote: 'scan preview' });
      } else {
        snapshot = await captureSnapshot(mockGuildFromSnapshot(makeSampleSnapshot()), { ownerNote: 'scan preview' });
      }
      // Pure preview — NOT written to the library. The operator saves via /snapshots/capture.
      const adminRoles = snapshot.roles.filter((r) => !r.isEveryone && auditAuthority(r.permissions).hasAdmin).map((r) => r.name);
      return {
        live: isLiveMode(),
        sourceGuildId: snapshot.source.guildId,
        guildName: snapshot.guild.name,
        counts: {
          roles: snapshot.roles.length,
          channels: snapshot.channels.length,
          categories: snapshot.categories.length,
          emojis: snapshot.emojis.length,
          stickers: snapshot.stickers.length,
          automod: snapshot.automod.length,
          bots: snapshot.bots.length,
        },
        headsUp: [
          ...(adminRoles.length ? [`${adminRoles.length} role(s) carry Administrator — review before recreating on a client server: ${adminRoles.slice(0, 5).join(', ')}${adminRoles.length > 5 ? '…' : ''}`] : []),
          ...(snapshot.bots.length ? [`${snapshot.bots.length} third-party bot(s) detected — bots can't be cloned and will need manual re-invite + reconfigure.`] : []),
        ],
      };
    } catch (err) {
      console.error('snapshot scan failed:', err);
      return reply.code(isLiveMode() ? 502 : 500).send({ error: 'scan failed' });
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

  // ── operator preferences / defaults (#4): per-operator defaults for new builds + handovers ──
  // Always scoped to the caller's own prefs (scopeRepo forces the actor's email).
  app.get('/operator/prefs', { preHandler: requireAuth }, async (req) => {
    return (await scoped(req).getOperatorPrefs(operatorOf(req))) ?? emptyOperatorPrefs(operatorOf(req));
  });
  app.patch('/operator/prefs', { preHandler: requireAuth }, async (req, reply) => {
    const parsed = OperatorPrefsPatch.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'invalid prefs', detail: parsed.error.flatten() });
    return scoped(req).upsertOperatorPrefs(operatorOf(req), parsed.data);
  });

  // ── inbound webhook receipt log (#6): admin-only. Stripe/Discord hits + signature result + outcome. ──
  app.get('/admin/webhooks', { preHandler: requireAuth }, async (req, reply) => {
    if (actorOf(req).role !== 'admin') return reply.code(403).send({ error: 'admin only' });
    const q = req.query as { source?: string; limit?: string };
    const limit = Math.min(500, Math.max(1, Number(q.limit) || 200));
    const source = q.source === 'stripe' || q.source === 'discord' ? q.source : undefined;
    return repo.listWebhookEvents(limit, source); // system-wide log (not owner-scoped)
  });

  // ── DB-backed operator accounts (multi-operator / white-label). ADMIN-ONLY. The env OPERATOR_EMAIL is
  // the bootstrap admin (not in this list); these are additional SCOPED operators an admin invites.
  const isEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
  app.get('/operators', { preHandler: requireAuth }, async (req, reply) => {
    if (actorOf(req).role !== 'admin') return reply.code(403).send({ error: 'admin only' });
    return repo.listOperators();
  });
  app.post('/operators', { preHandler: requireAuth }, async (req, reply) => {
    if (actorOf(req).role !== 'admin') return reply.code(403).send({ error: 'admin only' });
    const b = (req.body ?? {}) as { email?: string; password?: string };
    const email = (b.email ?? '').trim().toLowerCase();
    const password = b.password ?? '';
    if (!isEmail(email)) return reply.code(400).send({ error: 'A valid email is required.' });
    if (password.length < 8) return reply.code(400).send({ error: 'Password must be at least 8 characters.' });
    // Reject ANY admin email (the whole ADMIN_EMAILS set, not just OPERATOR_EMAIL) — else a DB operator
    // whose email resolves to admin at verify time would escalate to admin on login. DB ops are scoped only.
    if (roleFor(email) === 'admin') return reply.code(409).send({ error: 'That email is an admin account — pick a different one.' });
    if (await repo.getOperatorByEmail(email)) return reply.code(409).send({ error: 'An operator with that email already exists.' });
    const acct = await repo.addOperator({ email, passwordHash: bcrypt.hashSync(password, 10), role: 'operator' }); // DB operators are never admin
    await repo.addAudit({ action: 'operator.create', target: email, detail: 'invited operator', operator: operatorOf(req) });
    return acct;
  });
  app.delete('/operators/:id', { preHandler: requireAuth }, async (req, reply) => {
    if (actorOf(req).role !== 'admin') return reply.code(403).send({ error: 'admin only' });
    const id = (req.params as { id: string }).id;
    const target = (await repo.listOperators()).find((o) => o.id === id);
    if (!target) return { ok: true };
    await repo.deleteOperator(id);
    await repo.addAudit({ action: 'operator.delete', target: target.email, detail: 'removed operator', operator: operatorOf(req) });
    return { ok: true };
  });

  // Self-service password change — an operator changes their OWN password. Requires the CURRENT password
  // (so a stolen session can't silently reset it). The env bootstrap admin can't change here (env-based).
  app.post('/auth/change-password', { preHandler: requireAuth }, async (req, reply) => {
    if (rateLimited(`chpw:${req.ip}`, 10, 60_000)) return reply.code(429).send({ error: 'Too many attempts — wait a minute.' });
    const b = (req.body ?? {}) as { currentPassword?: string; newPassword?: string };
    const me = operatorOf(req).toLowerCase();
    if (roleFor(me) === 'admin') {
      return reply.code(400).send({ error: 'The admin password is set via OPERATOR_PASSWORD_HASH — update the environment, not the app.' });
    }
    const op = await repo.getOperatorByEmail(me);
    if (!op) return reply.code(404).send({ error: 'account not found' });
    if (!(await bcrypt.compare(b.currentPassword ?? '', op.passwordHash))) return reply.code(401).send({ error: 'Current password is incorrect.' });
    if ((b.newPassword ?? '').length < 8) return reply.code(400).send({ error: 'New password must be at least 8 characters.' });
    await repo.setOperatorPassword(me, bcrypt.hashSync(b.newPassword!, 10));
    return { ok: true };
  });

  // ── snapshot composability (#5): merge two owned snapshots into a composite template ──
  // Both must be owned by the operator (scoped). Preview returns the name-collisions to resolve.
  app.post('/snapshots/merge/preview', { preHandler: requireAuth }, async (req, reply) => {
    const body = (req.body ?? {}) as { aId?: string; bId?: string };
    const r = scoped(req);
    const [a, b] = await Promise.all([body.aId ? r.getSnapshot(body.aId) : undefined, body.bId ? r.getSnapshot(body.bId) : undefined]);
    if (!a || !b) return reply.code(404).send({ error: 'snapshot(s) not found' });
    try {
      const { conflicts, snapshot } = mergeSnapshots(a.snapshot, b.snapshot);
      return {
        conflicts,
        counts: { roles: snapshot.roles.length, channels: snapshot.channels.length, categories: snapshot.categories.length, emojis: snapshot.emojis.length, automod: snapshot.automod.length },
      };
    } catch (err) {
      console.error('merge preview failed:', err);
      return reply.code(400).send({ error: 'these snapshots could not be merged' });
    }
  });

  app.post('/snapshots/merge', { preHandler: requireAuth }, async (req, reply) => {
    const body = (req.body ?? {}) as { aId?: string; bId?: string; resolutions?: MergeResolutions; name?: string };
    const r = scoped(req);
    const [a, b] = await Promise.all([body.aId ? r.getSnapshot(body.aId) : undefined, body.bId ? r.getSnapshot(body.bId) : undefined]);
    if (!a || !b) return reply.code(404).send({ error: 'snapshot(s) not found' });
    try {
      const { snapshot } = mergeSnapshots(a.snapshot, b.snapshot, body.resolutions ?? {});
      // A composite is its OWN template line (a fresh synthetic source id), not a version of either parent.
      const synthGuild = `${Date.now()}${String(Math.floor(Math.random() * 1e6)).padStart(6, '0')}`;
      snapshot.source = { ...snapshot.source, guildId: synthGuild, name: `${a.name} + ${b.name}`, ownerNote: '' };
      const name = (body.name || `${a.name} + ${b.name}`).slice(0, 120);
      const rec = await r.addSnapshot({
        name,
        version: 1,
        sourceGuildId: synthGuild,
        capturedAt: snapshot.capturedAt,
        schemaVersion: snapshot.schemaVersion,
        snapshot,
        ownerEmail: operatorOf(req),
      });
      await r.updateSnapshot(rec.id, { isTemplate: true, tags: ['composite'], note: `Composite of "${a.name}" + "${b.name}".` });
      await repo.addAudit({ action: 'snapshot.merge', target: name, detail: `${a.name} + ${b.name}`, operator: operatorOf(req) });
      pingActivity('imported');
      return { id: rec.id, name: rec.name, version: rec.version };
    } catch (err) {
      console.error('merge failed:', err);
      return reply.code(400).send({ error: 'these snapshots could not be merged' });
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

  // ── template marketplace (#1): operators share STRUCTURE-ONLY templates cross-operator ──
  // SECURITY: only the structural pack (guild settings, roles, categories, channels + their permission
  // overwrites, emojis, stickers, automod) is ever exposed. Private fields — the copied channel CONTENT
  // (messages), the source guild's ownerNote, and the operator's curation note — are NEVER shared.
  // A stable, non-reversible pseudonym for a sharing operator — never expose the raw login email
  // cross-operator (it's operator/agency-identifying PII). Owners see 'you'.
  const pseudoOperator = (email: string): string => {
    if (!email) return 'system';
    let h = 2166136261;
    for (let i = 0; i < email.length; i++) {
      h ^= email.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return `operator-${(h >>> 0).toString(36).slice(0, 6)}`;
  };

  const marketplaceItem = (rec: SnapshotRecord, mine: boolean) => ({
    templateId: rec.id,
    name: rec.name,
    sourceOperator: mine ? 'you' : pseudoOperator(rec.ownerEmail),
    version: rec.version,
    mine,
    counts: {
      roles: rec.snapshot.roles.length,
      channels: rec.snapshot.channels.length,
      categories: rec.snapshot.categories.length,
      emojis: rec.snapshot.emojis.length,
      automod: rec.snapshot.automod.length,
    },
    categories: rec.snapshot.categories.map((c) => c.name),
    sampleChannels: rec.snapshot.channels.slice(0, 12).map((c) => c.name),
    roles: rec.snapshot.roles.filter((r) => !r.isEveryone).map((r) => r.name),
  });

  app.get('/marketplace', { preHandler: requireAuth }, async (req) => {
    const me = operatorOf(req);
    const shared = await repo.listSharedSnapshots(); // cross-operator catalog (shared==true only)
    return shared.map((rec) => marketplaceItem(rec, rec.ownerEmail === me));
  });

  app.post('/marketplace/:id/clone', { preHandler: requireAuth }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const src = (await repo.listSharedSnapshots()).find((s) => s.id === id); // must be a SHARED template
    if (!src) return reply.code(404).send({ error: 'shared template not found' });
    // Sanitize to STRUCTURE-ONLY. Strip everything that carries the source operator's private/client
    // data or references their stored asset bytes (which /assets serves by capability-hash to anyone):
    //  • content       — copied channel messages
    //  • source.ownerNote — the source-capture note
    //  • guild.assets   — the client's icon/banner/splash (logo) bytes
    //  • brandTokens    — the source client's detected name/colors/links (identity)
    //  • emoji/sticker asset keys — the custom-expression image bytes (→ a harmless placeholder; the
    //    structure/names survive, the bytes don't, and the recipient's build skips a missing asset)
    const PLACEHOLDER = 'assets/00000000.png';
    const noSrc = <T extends { sourceId?: string }>(x: T): T => ({ ...x, sourceId: undefined });
    const safe = {
      ...src.snapshot,
      content: [],
      brandTokens: [],
      source: { ...src.snapshot.source, name: `${src.snapshot.guild.name} (shared)`, ownerNote: '' },
      // strip asset-byte refs (icon/banner/splash) + source-guild traceability
      guild: { ...src.snapshot.guild, assets: {}, sourceGuildId: undefined },
      // roles: strip the role-ICON asset key (A's image bytes, fetchable via /assets) + source id
      roles: src.snapshot.roles.map((r) => ({ ...r, icon: undefined, sourceId: undefined })),
      channels: src.snapshot.channels.map(noSrc),
      categories: src.snapshot.categories.map(noSrc),
      automod: src.snapshot.automod.map(noSrc),
      emojis: src.snapshot.emojis.map((e) => ({ ...e, asset: PLACEHOLDER, sourceId: undefined })),
      stickers: src.snapshot.stickers.map((s) => ({ ...s, asset: PLACEHOLDER, sourceId: undefined })),
    };
    const r = scoped(req);
    const mine = (await r.listSnapshots()).filter((s) => s.sourceGuildId === src.sourceGuildId);
    const rec = await r.addSnapshot({
      name: src.name,
      version: mine.length + 1,
      sourceGuildId: src.sourceGuildId,
      capturedAt: src.capturedAt,
      schemaVersion: src.schemaVersion,
      snapshot: safe,
      ownerEmail: operatorOf(req),
    });
    await r.updateSnapshot(rec.id, { isTemplate: true, tags: ['shared'], note: `Cloned from a shared template by ${src.ownerEmail || 'system'}.` });
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

  // Client detail — everything about one client in one place: profile + their build history + handovers
  // + an earnings rollup. Owner-scoped (404 for a non-owned client); all sub-lists are scoped too.
  app.get('/clients/:id', { preHandler: requireAuth }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const r = scoped(req);
    const client = await r.getClient(id);
    if (!client) return reply.code(404).send({ error: 'not found' });
    const [jobs, handovers, snapNames] = await Promise.all([r.listJobs(), r.listHandovers(), r.snapshotNames()]);
    const nameOf = new Map(snapNames.map((s) => [s.id, s.name]));
    const mine = jobs.filter((j) => j.clientId === id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const builds = mine.map((j) => ({
      id: j.id, status: j.status, dryRun: j.dryRun, canary: j.canary,
      snapshotName: j.snapshotId ? (nameOf.get(j.snapshotId) ?? null) : null,
      invoicedCents: j.invoicedCents, paidCents: j.paidCents, createdAt: j.createdAt,
    }));
    const hs = handovers.filter((h) => h.clientId === id).map((h) => ({ id: h.id, jobId: h.jobId, state: h.state, readyAt: h.readyAt, inviteUrl: h.inviteUrl }));
    const real = mine.filter((j) => !j.dryRun && !j.canary);
    const invoicedCents = real.reduce((s, j) => s + (j.invoicedCents || 0), 0);
    const paidCents = real.reduce((s, j) => s + (j.paidCents || 0), 0);
    return {
      client,
      builds,
      handovers: hs,
      totals: {
        builds: mine.length,
        realBuilds: real.length,
        completed: real.filter((j) => j.status === 'completed').length,
        invoicedCents,
        paidCents,
        outstandingCents: Math.max(0, invoicedCents - paidCents),
        mrrCents: Math.round((client.monthlyRetainer || 0) * 100),
      },
    };
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

  // Recent CLIENT opens across the operator's deliveries (owner-scoped) — the notification feed that lets
  // the operator know a client just viewed their finished server (an engagement/upsell signal). `since` is
  // an epoch-ms cursor so the poller only sees NEW opens. Privacy: timestamps + labels only, never IPs.
  app.get('/activity/client-opens', { preHandler: requireAuth }, async (req) => {
    const sinceMs = Math.max(0, Number((req.query as { since?: string }).since) || 0);
    const r = scoped(req);
    const [handovers, clients] = await Promise.all([r.listHandovers(), r.listClients()]);
    const clientName = new Map(clients.map((c) => [c.id, c.creatorName]));
    const nonDraft = handovers.filter((h) => h.state !== 'draft');
    const viewsPer = await Promise.all(nonDraft.map((h) => r.listHandoverViews(h.id)));
    const opens: { handoverId: string; jobId: string; label: string; at: string }[] = [];
    nonDraft.forEach((h, i) => {
      for (const v of viewsPer[i]!) {
        if (v.kind === 'opened' && new Date(v.at).getTime() > sinceMs) {
          opens.push({ handoverId: h.id, jobId: h.jobId, label: (h.clientId && clientName.get(h.clientId)) || 'A client', at: v.at });
        }
      }
    });
    opens.sort((a, b) => b.at.localeCompare(a.at));
    return { opens: opens.slice(0, 20) };
  });

  // Handover engagement analytics (#4): per-kind aggregate counts + a recent timeline, for the operator.
  // Privacy: built only from referrer-origin + timestamps + the event kind — never an IP or identity.
  app.get('/handovers/:id/analytics', { preHandler: requireAuth }, async (req) => {
    const id = (req.params as { id: string }).id;
    const r = scoped(req);
    const [views, handover] = await Promise.all([r.listHandoverViews(id), r.getHandover(id)]);
    const byKind: Record<string, number> = {};
    for (const v of views) byKind[v.kind] = (byKind[v.kind] ?? 0) + 1;
    const opens = views.filter((v) => v.kind === 'opened').map((v) => v.at).sort(); // ascending
    // Delivery baseline for the engagement curve — when it was actually DELIVERED (first draft→ready),
    // falling back to createdAt for handovers delivered before readyAt was tracked.
    const deliveredAt = handover?.readyAt ?? handover?.createdAt ?? null;
    const baseMs = deliveredAt ? new Date(deliveredAt).getTime() : null;
    const firstOpenMs = opens[0] ? new Date(opens[0]).getTime() : null;
    // #3 deeper analytics: time-to-first-open, a 30-day daily decay curve, and a warm/cold verdict.
    const timeToFirstOpenMs = baseMs !== null && firstOpenMs !== null ? Math.max(0, firstOpenMs - baseMs) : null;
    const DAY = 86_400_000;
    const decay = Array.from({ length: 30 }, (_, d) => ({
      day: d,
      opens: baseMs === null ? 0 : opens.filter((o) => { const dt = new Date(o).getTime() - baseMs; return dt >= d * DAY && dt < (d + 1) * DAY; }).length,
    }));
    const firstWeekOpens = baseMs === null ? opens.length : opens.filter((o) => new Date(o).getTime() - baseMs < 7 * DAY).length;
    const classification = firstWeekOpens >= 3 ? 'warm' : firstWeekOpens >= 1 ? 'cool' : 'cold';
    return {
      total: views.length,
      opened: byKind.opened ?? 0,
      reportDownloaded: byKind.report_downloaded ?? 0,
      docsViewed: byKind.docs_viewed ?? 0,
      shareViewed: byKind.share_viewed ?? 0,
      firstOpenedAt: opens[0] ?? null,
      lastSeenAt: views[0]?.at ?? null, // listHandoverViews returns newest-first
      deliveredAt,
      timeToFirstOpenMs,
      firstWeekOpens,
      classification, // warm (3+ opens in week 1) | cool (1-2) | cold (0)
      decay, // opens per day for 30 days from delivery
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

  // Client survey (#4): a public, one-time NPS (0-10) + open comment from the delivery page. Gated by
  // the handover id (the capability) + not-draft, exactly like /h/:id. Private to the operator afterward.
  app.post('/h/:id/survey', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const b = (req.body ?? {}) as { nps?: unknown; comment?: unknown };
    const npsNum = Number(b.nps);
    if (!Number.isInteger(npsNum) || npsNum < 0 || npsNum > 10) return reply.code(400).send({ error: 'nps must be an integer 0-10' });
    const comment = String(b.comment ?? '').slice(0, 2000);
    const h = await repo.getHandover(id);
    if (!h || h.state === 'draft') return reply.code(404).send({ error: 'not found' });
    await repo.recordHandoverSurvey(id, npsNum, comment);
    return { ok: true };
  });

  // Operator survey aggregate (#4): NPS score + the responses across this operator's own handovers.
  app.get('/surveys', { preHandler: requireAuth }, async (req) => {
    const handovers = await scoped(req).listHandovers();
    const responded = handovers.filter((h) => h.surveyNps !== null);
    const promoters = responded.filter((h) => (h.surveyNps ?? 0) >= 9).length;
    const detractors = responded.filter((h) => (h.surveyNps ?? 0) <= 6).length;
    return {
      count: responded.length,
      avgNps: responded.length ? Math.round((responded.reduce((a, h) => a + (h.surveyNps ?? 0), 0) / responded.length) * 10) / 10 : null,
      npsScore: responded.length ? Math.round(((promoters - detractors) / responded.length) * 100) : null, // -100..100
      promoters,
      detractors,
      responses: responded
        .map((h) => ({ handoverId: h.id, nps: h.surveyNps, comment: h.surveyComment, at: h.surveyAt }))
        .sort((a, b) => String(b.at).localeCompare(String(a.at)))
        .slice(0, 50),
    };
  });

  // Earnings tracker (#6): pure operator-entered receipts — invoiced/paid/outstanding + MRR-equivalent +
  // YTD + per-template revenue. NO payment processing; just tracking the money the operator records.
  app.get('/earnings', { preHandler: requireAuth }, async (req) => {
    const r = scoped(req);
    const [jobs, clients, names] = await Promise.all([r.listJobs(), r.listClients(), r.snapshotNames()]);
    const real = jobs.filter((j) => !j.dryRun && !j.canary);
    const invoicedCents = real.reduce((a, j) => a + (j.invoicedCents ?? 0), 0);
    const paidCents = real.reduce((a, j) => a + (j.paidCents ?? 0), 0);
    const year = new Date().getFullYear();
    const ytdPaidCents = real.filter((j) => new Date(j.createdAt).getFullYear() === year).reduce((a, j) => a + (j.paidCents ?? 0), 0);
    const mrrCents = clients.reduce((a, c) => a + Math.round((c.monthlyRetainer || 0) * 100), 0); // retainer is $/mo
    // per-template revenue (paid, grouped by the source template)
    const nameOf = new Map(names.map((n) => [n.id, n.name]));
    const perTemplateMap = new Map<string, { name: string; paidCents: number; builds: number }>();
    for (const j of real) {
      const key = j.snapshotId ?? 'unknown';
      const entry = perTemplateMap.get(key) ?? { name: j.snapshotId ? nameOf.get(j.snapshotId) ?? 'deleted template' : 'no template', paidCents: 0, builds: 0 };
      entry.paidCents += j.paidCents ?? 0;
      entry.builds += 1;
      perTemplateMap.set(key, entry);
    }
    return {
      invoicedCents,
      paidCents,
      outstandingCents: Math.max(0, invoicedCents - paidCents),
      ytdPaidCents,
      mrrCents,
      billedBuilds: real.filter((j) => (j.invoicedCents ?? 0) > 0).length,
      totalBuilds: real.length,
      perTemplate: [...perTemplateMap.values()].sort((a, b) => b.paidCents - a.paidCents).slice(0, 12),
    };
  });

  // First-real-build onboarding wizard (#3): the 6-step activation path, with each step's done-state
  // derived from the operator's REAL data (scoped) so the wizard self-updates as they progress.
  app.get('/onboarding', { preHandler: requireAuth }, async (req) => {
    const r = scoped(req);
    const [snaps, jobs, handovers] = await Promise.all([r.listSnapshots(), r.listJobs(), r.listHandovers()]);
    const completed = jobs.filter((j) => j.status === 'completed');
    return {
      liveMode: isLiveMode(),
      hasToken: env.discordBotToken.length > 0,
      hasTemplate: snaps.length > 0,
      ranValidation: jobs.some((j) => j.dryRun && j.status === 'completed'), // readiness/dry-run proxy
      ranCanary: jobs.some((j) => j.canary && j.status === 'completed'),
      ranRealBuild: completed.some((j) => !j.dryRun && !j.canary),
      deliveredHandover: handovers.some((h) => h.state === 'ready' || h.state === 'handed_over'),
      counts: { templates: snaps.length, builds: completed.filter((j) => !j.dryRun && !j.canary).length, handovers: handovers.length },
    };
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
    // Build-duration SLO (#5): a build is "slow" if it ran >2× the rolling average (with a floor so a
    // tiny average can't false-positive). Surfaced as a home-dashboard banner the operator can act on.
    const sloMs = Math.max(avgBuildMs * 2, 30_000);
    const slow = builds.filter((j) => (j.metrics?.durationMs ?? 0) > sloMs);
    const slowestMs = builds.reduce((m, j) => Math.max(m, j.metrics?.durationMs ?? 0), 0);
    // Stuck = a DELIVERED handover (not a draft) that's >72h old and the client has never opened.
    // Same pass counts today's client opens (#4). Parallelized + drafts skip the views query (a draft
    // can't be stuck and has no client opens) → no sequential N+1 over the handover list.
    const sameDay = (iso: string) => new Date(iso).toDateString() === new Date().toDateString();
    const nonDraft = handovers.filter((h) => h.state !== 'draft');
    const viewsPer = await Promise.all(nonDraft.map((h) => r.listHandoverViews(h.id)));
    let stuckHandovers = 0;
    let clientOpensToday = 0;
    nonDraft.forEach((h, i) => {
      const views = viewsPer[i]!;
      if (now - new Date(h.createdAt).getTime() >= H72 && views.length === 0) stuckHandovers += 1;
      clientOpensToday += views.filter((v) => v.kind === 'opened' && sameDay(v.at)).length;
    });
    // Daily summary (#4): from the operator's OWN activity-log rows for today — filtered at the data
    // layer (operator + since-midnight) so other operators' volume can't evict this operator's rows.
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    const mineToday = await repo.listAudit(1000, { operator: operatorOf(req), sinceIso: since.toISOString() });
    const today = {
      builds: mineToday.filter((a) => a.action === 'build.start' || a.action === 'build.canary').length,
      delivered: mineToday.filter((a) => a.action === 'handover.deliver').length,
      snapshots: mineToday.filter((a) => a.action === 'snapshot.create').length,
      clientOpens: clientOpensToday,
    };
    const retainedClients = clients.filter((c) => c.monthlyRetainer > 0).length;
    // Money at a glance (the operator's #1 daily signal): what's been invoiced/paid across REAL builds,
    // what's still owed, and the recurring monthly retainer base. From data already in hand — no new query.
    const realBilled = jobs.filter((j) => !j.dryRun && !j.canary);
    const invoicedCents = realBilled.reduce((s, j) => s + (j.invoicedCents || 0), 0);
    const paidCents = realBilled.reduce((s, j) => s + (j.paidCents || 0), 0);
    const money = {
      invoicedCents,
      paidCents,
      outstandingCents: Math.max(0, invoicedCents - paidCents),
      mrrCents: Math.round(clients.reduce((s, c) => s + (c.monthlyRetainer || 0), 0) * 100),
    };
    return {
      buildsThisWeek,
      avgBuildMs,
      stuckHandovers,
      totalClients: clients.length,
      retainedClients,
      clientRetentionRate: clients.length ? Math.round((retainedClients / clients.length) * 100) : 0,
      slowBuilds: slow.length,
      slowestBuildMs: slowestMs,
      sloMs,
      today,
      money,
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

  // Build readiness check (#3, "canary") — a synchronous, zero-write "would-this-build-succeed?" gate.
  // Runs ALL the guardrails (Discord hard limits + boost-tier cross-check) and a full dry-run projection
  // (channel/role/overwrite plan, what skips, manual steps) against the rebranded snapshot, and returns
  // a single verdict: ready | ready_with_warnings | blocked. Run this green, THEN flip to a real build.
  app.post('/builds/readiness', { preHandler: requireAuth }, async (req, reply) => {
    const body = (req.body ?? {}) as { snapshotId?: string; config?: unknown; targetTier?: number; targetGuildId?: string };
    const r = scoped(req);
    const rec = body.snapshotId ? await r.getSnapshot(body.snapshotId) : undefined;
    if (!rec) return reply.code(404).send({ error: 'snapshot not found' });
    const parsed = RebrandConfig.safeParse(body.config);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid config', detail: parsed.error.flatten() });
    const targetTier = Math.max(0, Math.min(3, Math.trunc(Number(body.targetTier)) || 0));

    const feasibility = auditBuildLimits(rec.snapshot, targetTier);
    const blocks = feasibility.findings.filter((f) => f.severity === 'block');
    const warnings = feasibility.findings.filter((f) => f.severity === 'warn');
    const { snapshot: rebranded } = rebrand(rec.snapshot, parsed.data);
    const report = dryRunReport(rebranded, 'readiness', new Date().toISOString());

    // (#1) Operator history — the caller's OWN real (non-dry, non-canary) build success rate. A run of
    // recent failures is itself a reason to pause before a $40k client build.
    const ownJobs = await r.listJobs();
    const real = ownJobs.filter((j) => !j.dryRun && !j.canary && (j.status === 'completed' || j.status === 'failed'));
    const completed = real.filter((j) => j.status === 'completed').length;
    const history = { realBuilds: real.length, completed, failed: real.length - completed, successRate: real.length ? completed / real.length : null };

    // (#1) Live target-guild probe — bot-token validity + permission audit + reachability (= rate-limit
    // headroom: a clean response means we're not currently throttled). Degrades gracefully in demo mode.
    let live: { mode: 'live' | 'demo'; reachable: boolean; tokenValid: boolean; permissions: ReturnType<typeof auditAuthority> | null; detail: string } | null = null;
    if (body.targetGuildId) {
      const guildId = body.targetGuildId;
      try {
        const perms = isLiveMode()
          ? await new DiscordGuildClient({ token: env.discordBotToken, guildId, store }).getBotPermissions()
          : await new MockGuild(guildId).getBotPermissions();
        live = { mode: isLiveMode() ? 'live' : 'demo', reachable: true, tokenValid: true, permissions: auditAuthority(perms), detail: isLiveMode() ? 'Reached Discord; bot token valid.' : 'Demo mode — simulated permissions (no real token used).' };
      } catch (err) {
        // In LIVE mode this is a hard block (the build will fail at the first API call); never leak the raw error.
        console.error('readiness live probe failed:', err);
        live = { mode: isLiveMode() ? 'live' : 'demo', reachable: false, tokenValid: false, permissions: null, detail: 'Could not reach Discord with the configured bot token — it may be missing, invalid, or rate-limited.' };
      }
    }

    // The bot lacking a required permission on the real target guild is a hard BLOCK — the build would
    // half-apply and strand a client server. Token/reachability failure in live mode blocks too.
    const liveBlocked = !!live && (!live.reachable || (live.permissions ? !live.permissions.ok : false));
    const verdict = blocks.length || liveBlocked ? 'blocked' : warnings.length || report.skipped.length ? 'ready_with_warnings' : 'ready';
    return {
      verdict,
      serverName: rebranded.guild.name,
      targetTier,
      wouldCreate: report.created.length,
      wouldSkip: report.skipped.length,
      manualSteps: report.manualSteps.length,
      counts: report.counts,
      blocks,
      warnings,
      skipped: report.skipped.slice(0, 20),
      steps: report.created.slice(0, 12), // a sample of the create plan, in dependency order
      history,
      live,
    };
  });

  // (#3) Per-build TRACE — roll the persisted manifest (per-step timing + attempts), the per-object
  // outcomes, the lifecycle events, and the metrics into one ordered timeline so an operator can see
  // exactly where a build spent its time and which step (if any) had to retry. Owner-scoped.
  app.get('/builds/:id/trace', { preHandler: requireAuth }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const r = scoped(req);
    const job = await r.getJob(id);
    if (!job) return reply.code(404).send({ error: 'not found' }); // non-owner → 404
    const events = await r.listBuildEvents(id, 200);
    const manifest = job.manifest;
    // entry.kind → the rebuild step that creates it, so per-object outcomes roll up under their step.
    const KIND_STEP: Record<string, string> = { role: 'roles', emoji: 'expressions', sticker: 'expressions', category: 'categories', channel: 'channels', automod: 'automod', webhook: 'content' };
    const ms = (a: string | null, b: string | null) => (a && b ? Math.max(0, Date.parse(b) - Date.parse(a)) : null);
    const steps = (manifest?.steps ?? []).map((s) => {
      const objs = (manifest?.entries ?? []).filter((e) => KIND_STEP[e.kind] === s.step);
      const tally = { created: 0, updated: 0, skipped: 0, failed: 0 };
      for (const o of objs) if (o.status in tally) tally[o.status as keyof typeof tally]++;
      return { step: s.step, status: s.status, attempts: s.attempts ?? 0, startedAt: s.startedAt, finishedAt: s.finishedAt, durationMs: ms(s.startedAt, s.finishedAt), objects: tally };
    });
    return {
      jobId: id,
      status: job.status,
      dryRun: job.dryRun,
      targetGuildId: job.targetGuildId,
      metrics: job.metrics ?? null,
      resumes: events.filter((e) => e.kind === 'resumed').length, // how many times this build resumed from a checkpoint
      retriedSteps: steps.filter((s) => s.attempts > 1).map((s) => s.step), // steps a prior attempt failed in
      steps,
      events: events.map((e) => ({ at: e.at, kind: e.kind, detail: e.detail })),
    };
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

    // Fall back to this operator's saved defaults (#4) when the request doesn't specify dryRun/canary.
    const prefs = await r.getOperatorPrefs(operatorOf(req));
    const job = await r.addJob({
      kind: 'rebuild',
      status: 'queued',
      snapshotId: rec.id,
      clientId,
      targetGuildId: body.targetGuildId ?? null,
      dryRun: body.dryRun ?? prefs?.defaultDryRun ?? false,
      canary: body.canary ?? prefs?.defaultCanary ?? false,
      rebrandConfig: parsed.data,
      metrics: null,
      progress: 0,
      manifest: null,
      report: null,
      error: null,
      ownerEmail: operatorOf(req),
      invoicedCents: 0,
      paidCents: 0,
    });

    // Operator activity log (#4): record what was shipped today (real builds + canary, not dry-runs).
    if (!job.dryRun) {
      await repo.addAudit({ action: job.canary ? 'build.canary' : 'build.start', target: rec.name, detail: `→ ${parsed.data.serverName ?? rec.snapshot.guild.name}`, operator: operatorOf(req) });
    }

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
      invoicedCents: j.invoicedCents,
      paidCents: j.paidCents,
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

  // Earnings entry (#6): the operator records what they invoiced/were paid for a build (cents). Owner-
  // scoped (updateJob no-ops → 404 for a non-owned job). No payment processing — just tracking.
  app.patch('/jobs/:id/billing', { preHandler: requireAuth }, async (req, reply) => {
    const b = (req.body ?? {}) as { invoicedCents?: unknown; paidCents?: unknown };
    const patch: { invoicedCents?: number; paidCents?: number } = {};
    if (b.invoicedCents !== undefined) patch.invoicedCents = Math.max(0, Math.trunc(Number(b.invoicedCents)) || 0);
    if (b.paidCents !== undefined) patch.paidCents = Math.max(0, Math.trunc(Number(b.paidCents)) || 0);
    const j = await scoped(req).updateJob((req.params as { id: string }).id, patch);
    if (!j) return reply.code(404).send({ error: 'not found' });
    return { id: j.id, invoicedCents: j.invoicedCents, paidCents: j.paidCents };
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

  /** Replay (#3): re-run an existing build's SAME snapshot + rebrand config against a NEW target guild —
   *  productizes delivery (sell the same template to the next client). A fresh job, owner-scoped to the
   *  caller; the parent must be owned (→ 404). dryRun/canary fall back to the operator's saved defaults. */
  app.post('/jobs/:id/replay', { preHandler: requireAuth }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const body = (req.body ?? {}) as { targetGuildId?: string; dryRun?: boolean; canary?: boolean };
    const r = scoped(req);
    const prior = await r.getJob(id);
    if (!prior) return reply.code(404).send({ error: 'not found' });
    if (!prior.snapshotId || !prior.rebrandConfig) return reply.code(400).send({ error: 'this build has no snapshot or config to replay' });
    const snap = await r.getSnapshot(prior.snapshotId);
    if (!snap) return reply.code(404).send({ error: 'snapshot not found' });
    const job = await r.addJob({
      kind: 'rebuild',
      status: 'queued',
      snapshotId: snap.id,
      clientId: prior.clientId,
      targetGuildId: body.targetGuildId ?? null,
      // A replay re-runs THE SAME build, so it MIRRORS the parent's safety posture unless explicitly
      // overridden — replaying a dry-run must never silently become a real live build (seam r8 MEDIUM).
      dryRun: body.dryRun ?? prior.dryRun,
      canary: body.canary ?? prior.canary,
      rebrandConfig: prior.rebrandConfig,
      metrics: null,
      progress: 0,
      manifest: null,
      report: null,
      error: null,
      ownerEmail: operatorOf(req),
      invoicedCents: 0,
      paidCents: 0,
    });
    if (!job.dryRun) await repo.addAudit({ action: 'build.replay', target: snap.name, detail: `replay of build ${id.slice(-6)} → ${prior.rebrandConfig.serverName ?? snap.snapshot.guild.name}`, operator: operatorOf(req) });
    const data: BuildJobData = { jobId: job.id, snapshot: snap.snapshot, config: prior.rebrandConfig, dryRun: job.dryRun, targetGuildId: job.targetGuildId, contentIdentity: 'server' };
    if (useQueue()) {
      await getQueue().add('rebuild', data, { jobId: job.id, attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: { age: 86400 }, removeOnFail: false });
    } else {
      void runBuild(repo, channel, { jobId: job.id, snapshot: snap.snapshot, config: prior.rebrandConfig, dryRun: job.dryRun });
    }
    void repo.updateSnapshot(snap.id, { lastUsedAt: new Date().toISOString() }).catch(() => {});
    pingActivity('build');
    return { id: job.id, status: job.status, replayOf: id };
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
    // Seed the welcome + ownership checklist from this operator's saved defaults (#4), if any.
    const prefs = await r.getOperatorPrefs(operatorOf(req));
    return r.addHandover({
      jobId: job.id,
      clientId: job.clientId,
      state: 'draft',
      welcomeMessage: prefs?.defaultWelcomeMessage || '',
      ownershipSteps: prefs?.defaultOwnershipSteps ?? defaultOwnershipSteps(),
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
      password?: string | null; welcomeMessage?: string; logo?: string | null; inviteUrl?: string;
    };
    const patch: HandoverPatch = {};
    if (b.state !== undefined) patch.state = b.state;
    if (b.ownershipSteps !== undefined) patch.ownershipSteps = b.ownershipSteps;
    if (b.upsellStatus !== undefined) patch.upsellStatus = b.upsellStatus;
    // The invite link is rendered as an href on the PUBLIC client page — validate it is a real Discord
    // invite (https, discord.gg/… or discord.com/invite/…). Rejecting other schemes/hosts blocks a
    // javascript:/data: XSS and an accidental/malicious off-Discord phishing link. Empty clears it.
    if (b.inviteUrl !== undefined) {
      const v = String(b.inviteUrl).trim();
      if (v !== '' && !isDiscordInvite(v)) {
        return reply.code(400).send({ error: 'The invite link must be a Discord invite — https://discord.gg/… or https://discord.com/invite/…' });
      }
      patch.inviteUrl = v;
    }
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
    const r = scoped(req);
    const prior = await r.getHandover(id); // for the transition guard below
    // Stamp the delivery time on the FIRST draft→ready/handed_over transition — the engagement baseline (#3).
    const isFirstDeliver = (b.state === 'ready' || b.state === 'handed_over') && prior?.state === 'draft';
    if (isFirstDeliver) patch.readyAt = new Date().toISOString();
    const h = await r.updateHandover(id, patch);
    if (!h) return reply.code(404).send({ error: 'not found' });
    // Activity log (#4): log "delivered" once — on the FIRST transition OUT of draft. A later ready→
    // handed_over (or an idempotent re-PATCH, or a logo/welcome edit) doesn't re-count the same delivery.
    if (isFirstDeliver) {
      await repo.addAudit({ action: 'handover.deliver', target: `handover ${id.slice(-6)}`, detail: b.state === 'handed_over' ? 'handed over' : 'marked ready to share', operator: operatorOf(req) });
    }
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
      inviteUrl: h.inviteUrl, // the client's "Open your server" link (validated Discord invite, or '')
      scope: job?.report?.counts ?? {},
      created: job?.report?.created ?? [],
      botChecklist: job?.report?.botChecklist ?? [],
      botSetup: job?.report?.botSetup ?? [],
      manualSteps: job?.report?.manualSteps ?? [],
      ownershipSteps: h.ownershipSteps,
      surveyDone: h.surveyNps !== null, // #4: the delivery page hides the survey once the client submits
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
/**
 * True only for a real Discord invite URL: https, host discord.gg/<code> or a Discord domain under
 * /invite/<code>. Everything else — javascript:/data: schemes, off-Discord hosts, http — is rejected,
 * so the operator can't (by typo or malice) put an XSS or phishing link on the client-facing page.
 */
function isDiscordInvite(v: string): boolean {
  try {
    const u = new URL(v);
    if (u.protocol !== 'https:') return false;
    if (u.username || u.password) return false; // no userinfo — a real Discord invite never has credentials
    const host = u.hostname.replace(/^www\./, '');
    if (host === 'discord.gg') return u.pathname.length > 1;
    if (['discord.com', 'discordapp.com', 'ptb.discord.com', 'canary.discord.com'].includes(host)) return /^\/invite\/[^/]+/.test(u.pathname);
    return false;
  } catch {
    return false;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
