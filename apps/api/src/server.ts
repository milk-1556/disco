import { captureSnapshot, rebrand } from '@disco/core';
import { RebrandConfig } from '@disco/schema';
import { DiscordGuildClient, DiskAssetStore, mockGuildFromSnapshot } from '@disco/sdk';
import { makeSampleSnapshot } from '@disco/core';
import cors from '@fastify/cors';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { signSession, verifyCredentials, verifySession } from './auth.js';
import { diffSnapshots } from './diff.js';
import { env, isLiveMode } from './env.js';
import { JobBus, runBuild } from './jobs.js';
import { buildInviteUrl } from './perms.js';
import { InMemoryRepo, type Repo } from './repo.js';

export interface BuildServerOptions {
  repo?: Repo;
}

export function buildServer(opts: BuildServerOptions = {}): FastifyInstance {
  const repo = opts.repo ?? new InMemoryRepo();
  const bus = new JobBus();
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
  }));

  app.post('/auth/login', async (req, reply) => {
    const body = (req.body ?? {}) as { email?: string; password?: string };
    const ok = await verifyCredentials(body.email ?? '', body.password ?? '');
    if (!ok) return reply.code(401).send({ error: 'invalid credentials' });
    return { token: signSession({ email: body.email! }), email: body.email };
  });

  // ── snapshots ──
  app.get('/snapshots', { preHandler: requireAuth }, async () =>
    repo.listSnapshots().map((s) => ({
      id: s.id,
      name: s.name,
      version: s.version,
      sourceGuildId: s.sourceGuildId,
      capturedAt: s.capturedAt,
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

  app.get('/snapshots/:id', { preHandler: requireAuth }, async (req, reply) => {
    const rec = repo.getSnapshot((req.params as { id: string }).id);
    if (!rec) return reply.code(404).send({ error: 'not found' });
    return rec;
  });

  app.get('/snapshots/:id/diff', { preHandler: requireAuth }, async (req, reply) => {
    const a = repo.getSnapshot((req.params as { id: string }).id);
    const against = (req.query as { against?: string }).against;
    const b = against ? repo.getSnapshot(against) : undefined;
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
      const existing = repo.listSnapshots().filter((s) => s.sourceGuildId === snapshot.source.guildId);
      const rec = repo.addSnapshot({
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
    const rec = body.snapshotId ? repo.getSnapshot(body.snapshotId) : undefined;
    if (!rec) return reply.code(404).send({ error: 'snapshot not found' });
    const parsed = RebrandConfig.safeParse(body.config);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid config', detail: parsed.error.flatten() });
    const { snapshot, preview } = rebrand(rec.snapshot, parsed.data);
    return { preview, rebrandedGuildName: snapshot.guild.name, brandTokens: rec.snapshot.brandTokens };
  });

  // ── jobs ──
  app.post('/jobs', { preHandler: requireAuth }, async (req, reply) => {
    const body = (req.body ?? {}) as { snapshotId?: string; clientId?: string; config?: unknown; dryRun?: boolean };
    const rec = body.snapshotId ? repo.getSnapshot(body.snapshotId) : undefined;
    if (!rec) return reply.code(404).send({ error: 'snapshot not found' });
    const parsed = RebrandConfig.safeParse(body.config);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid config', detail: parsed.error.flatten() });

    const job = repo.addJob({
      kind: 'rebuild',
      status: 'queued',
      snapshotId: rec.id,
      clientId: body.clientId ?? parsed.data.clientId ?? null,
      targetGuildId: null,
      dryRun: body.dryRun ?? false,
      progress: 0,
      manifest: null,
      report: null,
      error: null,
    });
    // Run asynchronously; logs stream over SSE.
    void runBuild(repo, bus, { jobId: job.id, snapshot: rec.snapshot, config: parsed.data, dryRun: job.dryRun });
    return { id: job.id, status: job.status };
  });

  app.get('/jobs', { preHandler: requireAuth }, async () =>
    repo.listJobs().map((j) => ({
      id: j.id,
      kind: j.kind,
      status: j.status,
      dryRun: j.dryRun,
      progress: j.progress,
      snapshotId: j.snapshotId,
      clientId: j.clientId,
      createdAt: j.createdAt,
    })),
  );

  app.get('/jobs/:id', { preHandler: requireAuth }, async (req, reply) => {
    const j = repo.getJob((req.params as { id: string }).id);
    if (!j) return reply.code(404).send({ error: 'not found' });
    return j;
  });

  // SSE live logs
  app.get('/jobs/:id/logs', { preHandler: requireAuth }, async (req, reply) => {
    const jobId = (req.params as { id: string }).id;
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    const send = (ev: unknown) => reply.raw.write(`data: ${JSON.stringify(ev)}\n\n`);
    for (const ev of bus.replay(jobId)) send(ev);
    const unsub = bus.subscribe(jobId, (ev) => {
      send(ev);
      if (ev.type === 'done' || ev.type === 'error') reply.raw.end();
    });
    req.raw.on('close', unsub);
  });

  // ── invite-link generator ──
  app.get('/invite-url', { preHandler: requireAuth }, async (req, reply) => {
    const q = req.query as { mode?: 'administrator' | 'granular'; guildId?: string; applicationId?: string };
    const applicationId = q.applicationId || env.discordApplicationId;
    if (!applicationId) return reply.code(400).send({ error: 'applicationId required (set DISCORD_APPLICATION_ID or pass ?applicationId=)' });
    return buildInviteUrl({ applicationId, mode: q.mode ?? 'administrator', guildId: q.guildId });
  });

  return app;
}
