import { BUILD_QUEUE, extractBrandTokens, makeProductionTraceSnapshot, makeSampleSnapshot, redisConnection } from '@disco/core';
import type { Client } from '@disco/schema';
import { Queue } from 'bullmq';
import { env, usePrisma, useQueue } from './env.js';
import { JobBus, type JobChannel } from './jobChannel.js';
import { PrismaRepo } from './prismaRepo.js';
import { RedisJobChannel } from './redisJobChannel.js';
import { InMemoryRepo, type Repo } from './repo.js';

/** Persistence: Postgres when DATABASE_URL is set, else the zero-setup in-memory store. */
export function makeRepo(): Repo {
  return usePrisma() ? new PrismaRepo() : new InMemoryRepo();
}

/** Log transport: cross-process Redis when REDIS_URL is set, else in-process EventEmitter. */
export function makeJobChannel(): JobChannel {
  return useQueue() ? new RedisJobChannel(env.redisUrl) : new JobBus();
}

let _queue: Queue | undefined;
/** Lazy BullMQ producer — constructed only under REDIS_URL so the demo never connects Redis. */
export function getQueue(): Queue {
  return (_queue ??= new Queue(BUILD_QUEUE, { connection: redisConnection(env.redisUrl) }));
}

/**
 * Seed the sample template + client when the store is empty, so the Postgres-backed dashboard is as
 * useful on first boot as the in-memory demo. No-op when something already exists.
 */
export async function seedIfEmpty(repo: Repo): Promise<void> {
  if ((await repo.listSnapshots()).length > 0) return;
  const snap = makeSampleSnapshot();
  snap.brandTokens = extractBrandTokens(snap);
  await repo.addSnapshot({
    name: 'Acme Slots HQ (sample template)',
    version: 1,
    sourceGuildId: snap.source.guildId,
    capturedAt: snap.capturedAt,
    schemaVersion: snap.schemaVersion,
    snapshot: snap,
    ownerEmail: '', // system/unowned demo seed — admin-visible via bypass (matches InMemoryRepo.seed)
  });
  // A second, higher-fidelity template — a realistic ~$30k community.
  const trace = makeProductionTraceSnapshot();
  trace.brandTokens = extractBrandTokens(trace);
  await repo.addSnapshot({
    name: 'Stakehaus (production template)',
    version: 1,
    sourceGuildId: trace.source.guildId,
    capturedAt: trace.capturedAt,
    schemaVersion: trace.schemaVersion,
    snapshot: trace,
    ownerEmail: '', // system/unowned demo seed — admin-visible via bypass (matches InMemoryRepo.seed)
  });
  const client: Omit<Client, 'id' | 'createdAt'> = {
    creatorName: 'Nova',
    handle: '@novaplays',
    brandColors: ['#E11D48'],
    links: ['https://whop.com/nova-vip'],
    assets: {},
    termSwaps: [{ from: 'Acme', to: 'Nova' }],
    notes: 'Sample client for the Nova rebrand.',
    buildPrice: 3500,
    monthlyRetainer: 500,
    upsells: [],
    ownerEmail: '', // system/unowned demo seed — admin-visible via bypass (matches InMemoryRepo.seed)
  };
  await repo.addClient(client);
}

// Re-exports the worker imports via @disco/api/runtime (one PrismaRepo + RedisJobChannel, no drift).
export { runBuildJob, type BuildJobDeps } from './buildProcessor.js';
export { JobBus } from './jobChannel.js';
export type { JobChannel, JobEvent } from './jobChannel.js';
export { PrismaRepo, getPrisma } from './prismaRepo.js';
export { RedisJobChannel } from './redisJobChannel.js';
export type { Repo } from './repo.js';
