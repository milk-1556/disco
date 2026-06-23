import type { RebrandConfig, Snapshot } from '@disco/schema';

/** The BullMQ queue name for rebuild jobs (no `:` — BullMQ reserves it as a key separator). */
export const BUILD_QUEUE = 'disco-builds';

/**
 * Payload enqueued for a rebuild. The snapshot + config travel with the job so the worker is
 * stateless and self-sufficient on resume (it reads the job row's manifest, not the API's memory).
 */
export interface BuildJobData {
  jobId: string;
  snapshot: Snapshot;
  config: RebrandConfig;
  dryRun: boolean;
  /** When set (live mode), the worker builds into this real guild via a DiscordGuildClient. */
  targetGuildId?: string | null;
  contentIdentity?: 'preserve' | 'server';
}

/** Parse REDIS_URL into an ioredis connection config (BullMQ requires maxRetriesPerRequest: null). */
export function redisConnection(url = process.env.REDIS_URL ?? 'redis://localhost:6379') {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    ...(u.password ? { password: u.password } : {}),
    ...(u.username ? { username: u.username } : {}),
    maxRetriesPerRequest: null as null,
  };
}
