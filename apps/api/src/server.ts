import { auditAuthority, type BuildJobData, BundleError, captureSnapshot, collectAssetKeys, exportBundle, makeSampleSnapshot, parseBundle, rebrand } from '@disco/core';
import { defaultOwnershipSteps, RebrandConfig, SnapshotMetaPatch } from '@disco/schema';
import { DiscordGuildClient, DiskAssetStore, MockGuild, mockGuildFromSnapshot } from '@disco/sdk';
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

export interface BuildServerOptions {
  repo?: Repo;
  channel?: JobChannel;
}

export function buildServer(opts: BuildServerOptions = {}): FastifyInstance {
  const repo = opts.repo ?? makeRepo();
  const channel: JobChannel = opts.channel ?? makeJobChannel();
  const store = new DiskAssetStore(env.storageDiskPath);
  const app = Fastify({ logger: false });

  app.register(cors, { origin: env.webOrigin, credentials: true });

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
  app.get('/health', async () => ({ ok: true, mode: isLiveMode() ? 'live' : 'demo' }));

  app.get('/config', async () => ({
    mode: isLiveMode() ? 'live' : 'demo',
    applicationId: env.discordApplicationId || null,
    operatorEmail: env.operatorEmail,
    hasToken: env.discordBotToken.length > 0,
    storageDriver: process.env.STORAGE_DRIVER ?? 'disk',
    persistence: usePrisma() ? 'postgres' : 'in-memory',
    queue: useQueue() ? 'redis' : 'in-process',
  }));

  app.post('/auth/login', async (req, reply) => {
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

  app.get('/snapshots/:id', { preHandler: requireAuth }, async (req, reply) => {
    const rec = await repo.getSnapshot((req.params as { id: string }).id);
    if (!rec) return reply.code(404).send({ error: 'not found' });
    return rec;
  });

  app.get('/snapshots/:id/diff', { preHandler: requireAuth }, async (req, reply) => {
    const a = await repo.getSnapshot((req.params as { id: string }).id);
    const against = (req.query as { against?: string }).against;
    const b = against ? await repo.getSnapshot(against) : undefined;
    if (!a || !b) return reply.code(404).send({ error: 'snapshot(s) not found' });
    return diffSnapshots(b.snapshot, a.snapshot);
  });

  app.post('/snapshots/capture', { preHandler: requireAuth }, async (req, reply) => {
    const body = (req.body ?? {}) as { sourceGuildId?: string; name?: string };
    try {
      let snapshot;
      if (isLiveMode()) {
        if (!body.sourceGuildId) return reply.code(400).send({ error: 'sourceGuildId required in live mode' });
        const client = new DiscordGuildClient({ token: env.discordBotToken, guildId: body.sourceGuildId, store });
        snapshot = await captureSnapshot(client, { ownerNote: 'captured live' });
      } else {
        // demo: re-snapshot the seeded sample template via the MockGuild
        const source = mockGuildFromSnapshot(makeSampleSnapshot());
        snapshot = await captureSnapshot(source, { ownerNote: 'demo capture' });
      }
      const existing = (await repo.listSnapshots()).filter((s) => s.sourceGuildId === snapshot.source.guildId);
      const rec = await repo.addSnapshot({
        name: body.name ?? `${snapshot.guild.name} (v${existing.length + 1})`,
        version: existing.length + 1,
        sourceGuildId: snapshot.source.guildId,
        capturedAt: snapshot.capturedAt,
        schemaVersion: snapshot.schemaVersion,
        snapshot,
      });
      return { id: rec.id, name: rec.name, version: rec.version };
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
    return repo.addClient({
      creatorName: String(b.creatorName ?? 'New Client'),
      handle: String(b.handle ?? ''),
      brandColors: Array.isArray(b.brandColors) ? (b.brandColors as string[]) : [],
      links: Array.isArray(b.links) ? (b.links as string[]) : [],
      assets: {},
      termSwaps: Array.isArray(b.termSwaps) ? (b.termSwaps as { from: string; to: string }[]) : [],
      notes: String(b.notes ?? ''),
    });
  });

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
    return { id: job.id, status: job.status };
  });

  app.get('/jobs', { preHandler: requireAuth }, async () =>
    (await repo.listJobs()).map((j) => ({
      id: j.id,
      kind: j.kind,
      status: j.status,
      dryRun: j.dryRun,
      progress: j.progress,
      snapshotId: j.snapshotId,
      clientId: j.clientId,
      error: j.error,
      createdAt: j.createdAt,
      updatedAt: j.updatedAt,
    })),
  );

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
      'Access-Control-Allow-Origin': req.headers.origin ?? env.webOrigin,
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

  // ── handover (delivery) ──
  // Create-or-fetch a handover for a completed job (idempotent per job).
  app.post('/handovers', { preHandler: requireAuth }, async (req, reply) => {
    const body = (req.body ?? {}) as { jobId?: string };
    const job = body.jobId ? await repo.getJob(body.jobId) : undefined;
    if (!job) return reply.code(404).send({ error: 'job not found' });
    const existing = await repo.getHandoverByJob(job.id);
    if (existing) return existing;
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
    if (b.password !== undefined) patch.passwordHash = b.password ? bcrypt.hashSync(b.password, 10) : null;
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

  return app;
}
