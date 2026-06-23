import { type BuildJobDeps, PrismaRepo, RedisJobChannel, runBuildJob } from '@disco/api/runtime';
import { BUILD_QUEUE, type BuildJobData, redisConnection } from '@disco/core';
import type { RebuildReport } from '@disco/schema';
import { DiskAssetStore } from '@disco/sdk';
import { Worker } from 'bullmq';

/**
 * The scale-out build worker (§2/§6). Consumes rebuild jobs off the Redis queue and runs the SAME
 * engine (via the shared `runBuildJob`) the API runs in-process. DB-aware: resumes from the prior
 * persisted manifest so a BullMQ retry never duplicates Discord objects.
 */
export function startBuildWorker(): Worker<BuildJobData, RebuildReport> {
  const deps: BuildJobDeps = {
    repo: new PrismaRepo(),
    channel: new RedisJobChannel(),
    store: new DiskAssetStore(process.env.STORAGE_DISK_PATH ?? './storage'),
    token: process.env.DISCORD_BOT_TOKEN ?? '',
  };

  const worker = new Worker<BuildJobData, RebuildReport>(
    BUILD_QUEUE,
    (job) => runBuildJob(job.data, deps),
    {
      connection: redisConnection(),
      concurrency: Number(process.env.WORKER_CONCURRENCY ?? 2),
      maxStalledCount: 1, // a hard crash re-delivers exactly once → resume from the persisted manifest
    },
  );

  worker.on('completed', (job) => console.log(`[worker] build ${job.id} completed`));
  worker.on('failed', async (job, err) => {
    const attempts = job?.opts.attempts ?? 1;
    const isFinal = !job || job.attemptsMade >= attempts;
    console.error(`[worker] build ${job?.id} attempt ${job?.attemptsMade}/${attempts} failed: ${err.message}`);
    // Only expose 'failed' to the API after the LAST attempt — earlier attempts will be retried.
    if (job && isFinal) {
      await deps.repo.updateJob(job.data.jobId, { status: 'failed', error: err.message }).catch(() => {});
      await Promise.resolve(deps.channel.publish(job.data.jobId, { type: 'error', message: err.message })).catch(() => {});
    }
  });
  return worker;
}
