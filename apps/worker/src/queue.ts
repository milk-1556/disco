import type { RebrandConfig, Snapshot } from '@disco/schema';

export const BUILD_QUEUE = 'disco:builds';

/** Payload enqueued for a rebuild. The snapshot travels with the job so the worker is stateless. */
export interface BuildJobData {
  jobId: string;
  snapshot: Snapshot;
  config: RebrandConfig;
  dryRun: boolean;
  /** When set (live mode), the worker builds into this real guild via a DiscordGuildClient. */
  targetGuildId?: string | null;
  contentIdentity?: 'preserve' | 'server';
}

export const redisConnection = (url = process.env.REDIS_URL ?? 'redis://localhost:6379') => {
  // BullMQ requires maxRetriesPerRequest: null on the shared connection.
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    ...(u.password ? { password: u.password } : {}),
    maxRetriesPerRequest: null as null,
  };
};
