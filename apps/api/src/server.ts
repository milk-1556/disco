import { type BuildJobData, captureSnapshot, makeSampleSnapshot, rebrand } from '@disco/core';
import { RebrandConfig } from '@disco/schema';
import { DiscordGuildClient, DiskAssetStore, mockGuildFromSnapshot } from '@disco/sdk';
import cors from '@fastify/cors';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { signSession, verifyCredentials, verifySession } from './auth.js';
import { diffSnapshots } from './diff.js';
import { env, isLiveMode, useQueue } from './env.js';
import type { JobChannel, JobEvent } from './jobChannel.js';
import { runBuild } from './jobs.js';
import { buildInviteUrl } from './perms.js';
import type { Repo } from './repo.js';
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
      // jobId === Postgres id === log channel, so a duplicate add is idempotent. The content step is
      // not yet reconciled, so a real LIVE build runs with attempts:1 to avoid duplicate webhook posts.
      const live = !job.dryRun && job.targetGuildId !== null;
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
        attempts: live ? 1 : 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: { age: 86400 },
        removeOnFail: false,
      });
    } else {
      // In-process demo path; logs stream over the in-memory channel.
      void runBuild(repo, channel, { jobId: job.id, snapshot: rec.snapshot, config: parsed.data, dryRun: job.dryRun });
    }
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
      createdAt: j.createdAt,
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
    const sent = new Set<number>(); // seq dedup for the replay↔live overlap
    const end = () => {
      if (!closed) {
        closed = true;
        reply.raw.end();
      }
    };
    const send = (ev: JobEvent) => {
      if (closed) return;
      if (ev.seq !== undefined) {
        if (sent.has(ev.seq)) return;
        sent.add(ev.seq);
      }
      reply.raw.write(`data: ${JSON.stringify(ev)}\n\n`);
      if (ev.type === 'done' || ev.type === 'error') end();
    };

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
      return;
    }

    // Subscribe FIRST, then replay — so an event landing in the gap is delivered live (and deduped
    // by seq), never lost. Gap-free + duplicate-free.
    const unsub = await channel.subscribe(jobId, send);
    for (const ev of await channel.replay(jobId)) send(ev);
    req.raw.on('close', () => {
      unsub();
      end();
    });
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
