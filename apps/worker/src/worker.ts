import { rebrand, rebuildGuild } from '@disco/core';
import type { RebuildReport } from '@disco/schema';
import { DiscordGuildClient, DiskAssetStore, MockGuild } from '@disco/sdk';
import { Worker } from 'bullmq';
import { BUILD_QUEUE, redisConnection, type BuildJobData } from './queue.js';

/**
 * The scale-out build worker (§2/§6). Consumes rebuild jobs off the Redis queue and runs the SAME
 * engine the API runs in-process — so a crash mid-build resumes via the manifest, and many client
 * builds can be processed concurrently. In demo mode the target is an in-memory MockGuild; in live
 * mode it's a DiscordGuildClient against the job's target guild.
 *
 * Returns the RebuildReport as the job result (BullMQ persists it). Wiring the report back into the
 * API's job records is the Postgres/Prisma step (both share the DB in production).
 */
export function startBuildWorker(): Worker<BuildJobData, RebuildReport> {
  const store = new DiskAssetStore(process.env.STORAGE_DISK_PATH ?? './storage');
  const token = process.env.DISCORD_BOT_TOKEN ?? '';

  const worker = new Worker<BuildJobData, RebuildReport>(
    BUILD_QUEUE,
    async (job) => {
      const { jobId, snapshot, config, dryRun, targetGuildId, contentIdentity } = job.data;
      const { snapshot: rebranded } = rebrand(snapshot, config);

      const port =
        token && targetGuildId
          ? new DiscordGuildClient({ token, guildId: targetGuildId, store })
          : new MockGuild('900000000000000000', rebranded.guild.name);

      const { report } = await rebuildGuild(port, rebranded, {
        jobId,
        dryRun,
        targetGuildId: targetGuildId ?? null,
        contentIdentity: contentIdentity ?? 'server',
        onLog: (m) => job.updateProgress({ log: m }).catch(() => {}),
        onProgress: (pct) => job.updateProgress({ pct }).catch(() => {}),
      });
      return report;
    },
    { connection: redisConnection(), concurrency: Number(process.env.WORKER_CONCURRENCY ?? 2) },
  );

  worker.on('completed', (job) => console.log(`[worker] build ${job.id} completed`));
  worker.on('failed', (job, err) => console.error(`[worker] build ${job?.id} failed:`, err.message));
  return worker;
}
