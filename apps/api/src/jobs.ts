import { EventEmitter } from 'node:events';
import { rebrand, rebuildGuild } from '@disco/core';
import type { RebrandConfig, Snapshot } from '@disco/schema';
import { MockGuild } from '@disco/sdk';
import type { Repo } from './repo.js';

export interface JobEvent {
  type: 'log' | 'progress' | 'done' | 'error';
  message?: string;
  progress?: number;
  step?: string;
}

/** Pub/sub for live job logs (consumed by the SSE endpoint). Buffers history for late subscribers. */
export class JobBus {
  private emitter = new EventEmitter();
  private history = new Map<string, JobEvent[]>();

  emit(jobId: string, ev: JobEvent) {
    const list = this.history.get(jobId) ?? [];
    list.push(ev);
    this.history.set(jobId, list);
    this.emitter.emit(jobId, ev);
  }
  replay(jobId: string): JobEvent[] {
    return this.history.get(jobId) ?? [];
  }
  subscribe(jobId: string, fn: (ev: JobEvent) => void): () => void {
    this.emitter.on(jobId, fn);
    return () => this.emitter.off(jobId, fn);
  }
}

export interface RunBuildInput {
  jobId: string;
  snapshot: Snapshot;
  config: RebrandConfig;
  dryRun: boolean;
}

/**
 * Run a rebrand+build as a job, streaming logs/progress over the bus and persisting the final report
 * + manifest. In demo mode the target is a fresh in-memory MockGuild, so a full build runs with no
 * token and no risk. Swapping in a DiscordGuildClient (live) changes nothing about this orchestration
 * — the same engine drives both. A BullMQ worker can call this exact function off a Redis queue.
 */
export async function runBuild(repo: Repo, bus: JobBus, input: RunBuildInput): Promise<void> {
  const { jobId, snapshot, config, dryRun } = input;
  try {
    repo.updateJob(jobId, { status: 'running' });
    bus.emit(jobId, { type: 'log', message: `Rebranding "${snapshot.guild.name}" for ${config.clientId}…` });
    const { snapshot: rebranded, preview } = rebrand(snapshot, config);
    bus.emit(jobId, { type: 'log', message: `Rebrand preview: ${preview.changes.length} change(s).` });

    const target = new MockGuild('900000000000000000', rebranded.guild.name);
    const { manifest, report } = await rebuildGuild(target, rebranded, {
      jobId,
      dryRun,
      onLog: (m) => bus.emit(jobId, { type: 'log', message: m }),
      onProgress: (pct, step) => {
        bus.emit(jobId, { type: 'progress', progress: pct, step });
        repo.updateJob(jobId, { progress: pct });
      },
    });

    repo.updateJob(jobId, { status: 'completed', progress: 1, manifest, report });
    bus.emit(jobId, {
      type: 'done',
      message: dryRun
        ? `Dry-run complete: ${report.created.length} object(s) would be created, ${report.manualSteps.length} manual step(s).`
        : `Build complete: ${report.created.length} created, ${report.manualSteps.length} manual step(s).`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    repo.updateJob(jobId, { status: 'failed', error: message });
    bus.emit(jobId, { type: 'error', message });
  }
}
