import { redisConnection } from '@disco/core';
import Redis from 'ioredis';
import type { JobChannel, JobEvent } from './jobChannel.js';

const LOG_TTL_SECONDS = 86400; // 24h — replay buffer survives an API restart this long

/**
 * Cross-process, durable job-log transport (§ design). Each event is RPUSHed to a per-job LIST
 * (the durable replay buffer) and PUBLISHed to a same-named channel (live fan-out). A monotonic
 * `seq` (from INCR) stamps every event so the SSE layer dedupes the replay↔live overlap, and
 * RPUSH-before-PUBLISH guarantees a late subscriber never loses an event to both. Survives an API
 * restart mid-build: a fresh /jobs/:id/logs replays the whole LIST then tails.
 */
export class RedisJobChannel implements JobChannel {
  private cmd: Redis;
  private subscribers = new Set<Redis>();

  constructor(url?: string) {
    this.cmd = new Redis(redisConnection(url));
  }

  private listKey(jobId: string) {
    return `disco:joblog:${jobId}`;
  }
  private channelName(jobId: string) {
    return `disco:joblog:${jobId}`;
  }

  async publish(jobId: string, ev: JobEvent): Promise<void> {
    const key = this.listKey(jobId);
    const seq = await this.cmd.incr(`${key}:seq`);
    const json = JSON.stringify({ ...ev, seq });
    // RPUSH BEFORE PUBLISH so an event landing during a subscriber's replay/subscribe gap is still
    // recoverable from the list.
    await this.cmd.rpush(key, json);
    await this.cmd.expire(key, LOG_TTL_SECONDS);
    await this.cmd.expire(`${key}:seq`, LOG_TTL_SECONDS);
    await this.cmd.publish(this.channelName(jobId), json);
  }

  async replay(jobId: string): Promise<JobEvent[]> {
    const items = await this.cmd.lrange(this.listKey(jobId), 0, -1);
    return items.map((s) => JSON.parse(s) as JobEvent);
  }

  async subscribe(jobId: string, fn: (ev: JobEvent) => void): Promise<() => void> {
    // A connection in subscriber mode can't run normal commands — use a dedicated one per stream.
    const sub = new Redis(redisConnection());
    this.subscribers.add(sub);
    await sub.subscribe(this.channelName(jobId));
    sub.on('message', (_channel, message) => {
      try {
        fn(JSON.parse(message) as JobEvent);
      } catch {
        /* ignore malformed */
      }
    });
    return () => {
      sub.removeAllListeners('message');
      void sub.quit().catch(() => sub.disconnect());
      this.subscribers.delete(sub);
    };
  }

  async close(): Promise<void> {
    for (const s of this.subscribers) await s.quit().catch(() => s.disconnect());
    await this.cmd.quit().catch(() => this.cmd.disconnect());
  }
}
