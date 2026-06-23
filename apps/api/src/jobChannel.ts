import { EventEmitter } from 'node:events';

export interface JobEvent {
  type: 'log' | 'progress' | 'done' | 'error';
  message?: string;
  progress?: number;
  step?: string;
  /** Monotonic per-job sequence — lets the SSE layer dedupe the replay/live overlap. */
  seq?: number;
}

/**
 * The single transport the SSE endpoint and the build runner speak to, so server code is identical
 * in demo (in-memory) and prod (Redis) modes. publish appends durably + fans out live; replay
 * returns history for a late subscriber; subscribe tails new events.
 */
export interface JobChannel {
  publish(jobId: string, ev: JobEvent): void | Promise<void>;
  replay(jobId: string): JobEvent[] | Promise<JobEvent[]>;
  subscribe(jobId: string, fn: (ev: JobEvent) => void): (() => void) | Promise<() => void>;
  /** Optional cleanup of connections (Redis). */
  close?(): Promise<void>;
}

/** In-memory transport for the zero-setup demo (single process). Buffers history for late subscribers. */
export class JobBus implements JobChannel {
  private emitter = new EventEmitter();
  private history = new Map<string, JobEvent[]>();
  private seqs = new Map<string, number>();

  publish(jobId: string, ev: JobEvent): void {
    const seq = (this.seqs.get(jobId) ?? 0) + 1;
    this.seqs.set(jobId, seq);
    const stamped = { ...ev, seq };
    const list = this.history.get(jobId) ?? [];
    list.push(stamped);
    this.history.set(jobId, list);
    this.emitter.emit(jobId, stamped);
  }
  /** Back-compat alias so existing call sites (runBuild) need no change. */
  emit(jobId: string, ev: JobEvent): void {
    this.publish(jobId, ev);
  }
  replay(jobId: string): JobEvent[] {
    return this.history.get(jobId) ?? [];
  }
  subscribe(jobId: string, fn: (ev: JobEvent) => void): () => void {
    this.emitter.on(jobId, fn);
    return () => this.emitter.off(jobId, fn);
  }
}
