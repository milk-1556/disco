import { auditAuthority, auditBuildLimits, type BuildJobData, BundleError, captureSnapshot, collectAssetKeys, exportBundle, makeSampleSnapshot, parseBundle, rebrand } from '@disco/core';
import { defaultOwnershipSteps, RebrandConfig, SnapshotMetaPatch } from '@disco/schema';
import { DiscordGuildClient, DiskAssetStore, listJoinedGuilds, MockGuild, mockGuildFromSnapshot } from '@disco/sdk';
import { demoGuildSnapshot, listDemoGuilds } from './demoGuilds.js';
import cors from '@fastify/cors';
import bcrypt from 'bcryptjs';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { signSession, verifyCredentials, verifySession } from './auth.js';
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
  const app = Fastify({ logger: false });

  // Disco authenticates with Bearer tokens (not cookies), so CORS credentials are never needed — which
  // lets a public API safely allow any origin. When WEB_ORIGIN is an explicit (comma-sep) allowlist we
  // honor it; '*' means "public". credentials:false avoids the invalid '*'+credentials combo entirely.
  const allowedOrigins = env.webOrigin === '*' ? null : env.webOrigin.split(',').map((o) => o.trim()).filter(Boolean);
  app.register(cors, { origin: allowedOrigins ?? true, credentials: false });

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
  app.get('/snapshots', { preHandler: requireAuth }, async () =>
    (await repo.listSnapshots()).map((s) => ({
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
    const rec = await repo.updateSnapshot((req.params as { id: string }).id, parsed.data);
    if (!rec) return reply.code(404).send({ error: 'not found' });
    return { id: rec.id, name: rec.name, tags: rec.tags, note: rec.note, favorite: rec.favorite, isTemplate: rec.isTemplate };
  });

  app.delete('/snapshots/:id', { preHandler: requireAuth }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const rec = await repo.getSnapshot(id);
    if (!rec) return reply.code(404).send({ error: 'not found' });
    await repo.deleteSnapshot(id);
    await repo.addAudit({ action: 'snapshot.delete', target: rec.name, detail: `v${rec.version} · ${rec.sourceGuildId}`, operator: operatorOf(req) });
    pingActivity('snapshot');
    return { ok: true };
  });

  app.get('/snapshots/:id', { preHandler: requireAuth }, async (req, reply) => {
    const rec = await repo.getSnapshot((req.params as { id: string }).id);
    if (!rec) return reply.code(404).send({ error: 'not found' });
    return rec;
  });

  // Build-feasibility pre-flight: does this snapshot fit within Discord's hard limits?
  app.get('/snapshots/:id/feasibility', { preHandler: requireAuth }, async (req, reply) => {
    const rec = await repo.getSnapshot((req.params as { id: string }).id);
    if (!rec) return reply.code(404).send({ error: 'not found' });
    return auditBuildLimits(rec.snapshot);
  });

  app.get('/snapshots/:id/diff', { preHandler: requireAuth }, async (req, reply) => {
    const a = await repo.getSnapshot((req.params as { id: string }).id);
    const against = (req.query as { against?: string }).against;
    const b = against ? await repo.getSnapshot(against) : undefined;
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
      const existing = (await repo.listSnapshots()).filter((s) => s.sourceGuildId === snapshot.source.guildId);
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
      const rec = await repo.addSnapshot({
        name: body.name ?? `${snapshot.guild.name} (v${existing.length + 1})`,
        version: existing.length + 1,
        sourceGuildId: snapshot.source.guildId,
        capturedAt: snapshot.capturedAt,
        schemaVersion: snapshot.schemaVersion,
        snapshot,
      });
      pingActivity('imported');
      return { id: rec.id, name: rec.name, version: rec.version, unchanged: false };
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Export a snapshot (+ optional config) as a portable, checksummed .discobundle (§7).
  app.get('/snapshots/:id/export', { preHandler: requireAuth }, async (req, reply) => {
    const rec = await repo.getSnapshot((req.params as { id: string }).id);
    if (!rec) return reply.code(404).send({ error: 'not found' });
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
      const existing = (await repo.listSnapshots()).filter((s) => s.sourceGuildId === snapshot.source.guildId);
      const rec = await repo.addSnapshot({
        name: name || `${snapshot.guild.name} (imported)`,
        version: existing.length + 1,
        sourceGuildId: snapshot.source.guildId,
        capturedAt: snapshot.capturedAt,
        schemaVersion: snapshot.schemaVersion,
        snapshot,
      });
      return { id: rec.id, name: rec.name, version: rec.version };
    } catch (err) {
      if (err instanceof BundleError) return reply.code(400).send({ error: err.message });
      return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ── clients ──
  app.get('/clients', { preHandler: requireAuth }, async () => repo.listClients());
  app.post('/clients', { preHandler: requireAuth }, async (req) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    pingActivity('client');
    return repo.addClient({
      creatorName: String(b.creatorName ?? 'New Client'),
      handle: String(b.handle ?? ''),
      brandColors: Array.isArray(b.brandColors) ? (b.brandColors as string[]) : [],
      links: Array.isArray(b.links) ? (b.links as string[]) : [],
      assets: {},
      termSwaps: Array.isArray(b.termSwaps) ? (b.termSwaps as { from: string; to: string }[]) : [],
      notes: String(b.notes ?? ''),
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
    const c = await repo.getClient(id);
    await repo.deleteClient(id);
    if (c) await repo.addAudit({ action: 'client.delete', target: c.creatorName, detail: c.handle, operator: operatorOf(req) });
    return { ok: true };
  });

  // Operator accountability log of destructive operations.
  app.get('/audit', { preHandler: requireAuth }, async () => repo.listAudit(200));

  // ── rebrand preview ──
  app.post('/rebrand/preview', { preHandler: requireAuth }, async (req, reply) => {
    const body = (req.body ?? {}) as { snapshotId?: string; config?: unknown };
    const rec = body.snapshotId ? await repo.getSnapshot(body.snapshotId) : undefined;
    if (!rec) return reply.code(404).send({ error: 'snapshot not found' });
    const parsed = RebrandConfig.safeParse(body.config);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid config', detail: parsed.error.flatten() });
    const { snapshot, preview } = rebrand(rec.snapshot, parsed.data);
    return { preview, rebrandedGuildName: snapshot.guild.name, brandTokens: rec.snapshot.brandTokens };
  });

  // ── jobs ──
  app.post('/jobs', { preHandler: requireAuth }, async (req, reply) => {
    const body = (req.body ?? {}) as { snapshotId?: string; clientId?: string; config?: unknown; dryRun?: boolean };
    const rec = body.snapshotId ? await repo.getSnapshot(body.snapshotId) : undefined;
    if (!rec) return reply.code(404).send({ error: 'snapshot not found' });
    const parsed = RebrandConfig.safeParse(body.config);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid config', detail: parsed.error.flatten() });

    // Job.clientId is a real DB relation — only link a client that actually exists (the rebrand
    // config's logical clientId lives in rebrandConfig, not here). Unknown/absent → null.
    const clientId = body.clientId && (await repo.getClient(body.clientId)) ? body.clientId : null;

    const job = await repo.addJob({
      kind: 'rebuild',
      status: 'queued',
      snapshotId: rec.id,
      clientId,
      targetGuildId: null,
      dryRun: body.dryRun ?? false,
      rebrandConfig: parsed.data,
      metrics: null,
      progress: 0,
      manifest: null,
      report: null,
      error: null,
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

  app.get('/jobs', { preHandler: requireAuth }, async () => {
    // snapshotNames() is a cheap id→name select (no artifact-blob parse) — the /jobs list is the
    // hottest polled endpoint, so this avoids deserializing every snapshot on every tick.
    const [jobs, snaps, clients] = await Promise.all([repo.listJobs(), repo.snapshotNames(), repo.listClients()]);
    const snapName = new Map(snaps.map((s) => [s.id, s.name]));
    const clientName = new Map(clients.map((c) => [c.id, c.creatorName]));
    return jobs.map((j) => ({
      id: j.id,
      kind: j.kind,
      status: j.status,
      dryRun: j.dryRun,
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
    const j = await repo.getJob((req.params as { id: string }).id);
    if (!j) return reply.code(404).send({ error: 'not found' });
    return j;
  });

  // SSE live logs — works identically over the in-memory or Redis channel.
  app.get('/jobs/:id/logs', { preHandler: requireAuth }, async (req, reply) => {
    const jobId = (req.params as { id: string }).id;
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
    const job = await repo.getJob(id);
    if (!job) return reply.code(404).send({ error: 'not found' });
    if (job.status !== 'failed' && job.status !== 'canceled') {
      return reply.code(400).send({ error: `only failed or canceled jobs can be retried (status: ${job.status})` });
    }
    if (!job.snapshotId || !job.rebrandConfig) return reply.code(400).send({ error: 'job is missing its snapshot or config' });
    const snap = await repo.getSnapshot(job.snapshotId);
    if (!snap) return reply.code(404).send({ error: 'snapshot not found' });

    await repo.updateJob(id, { status: 'queued', error: null });
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
    const job = await repo.getJob(id);
    if (!job) return reply.code(404).send({ error: 'not found' });
    if (job.status === 'running') return reply.code(409).send({ error: 'job is already running and cannot be interrupted' });
    if (job.status !== 'queued' && job.status !== 'paused') return reply.code(400).send({ error: `cannot cancel a ${job.status} job` });
    if (useQueue()) await getQueue().remove(id).catch(() => {});
    await repo.updateJob(id, { status: 'canceled' });
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
      return reply.code(502).send({ error: err instanceof Error ? err.message : String(err), reachable: false });
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
  registerStripeRoutes(app, repo);

  // ── handover (delivery) ──
  // Create-or-fetch a handover for a completed job (idempotent per job).
  app.post('/handovers', { preHandler: requireAuth }, async (req, reply) => {
    const body = (req.body ?? {}) as { jobId?: string };
    const job = body.jobId ? await repo.getJob(body.jobId) : undefined;
    if (!job) return reply.code(404).send({ error: 'job not found' });
    const existing = await repo.getHandoverByJob(job.id);
    if (existing) return existing;
    pingActivity('handover');
    return repo.addHandover({
      jobId: job.id,
      clientId: job.clientId,
      state: 'draft',
      ownershipSteps: defaultOwnershipSteps(),
      upsellStatus: 'none',
    });
  });

  // Operator view: the handover + its job (with report = included scope + bot checklist + manual steps).
  app.get('/handovers/:id', { preHandler: requireAuth }, async (req, reply) => {
    const h = await repo.getHandover((req.params as { id: string }).id);
    if (!h) return reply.code(404).send({ error: 'not found' });
    const job = await repo.getJob(h.jobId);
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
    const h = await repo.updateHandover(id, patch);
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
    if (h.hasPassword) {
      if (rateLimited(`h:${req.ip}:${id}`, 10, 60_000)) return reply.code(429).send({ error: 'Too many attempts — wait a minute.' });
      const pw = (req.query as { pw?: string }).pw ?? '';
      const hash = await repo.getHandoverPasswordHash(id);
      if (!hash || !bcrypt.compareSync(pw, hash)) return reply.code(401).send({ error: 'password required', needsPassword: true });
    }
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
