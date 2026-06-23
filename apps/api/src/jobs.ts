import type { RebrandConfig, Snapshot } from '@disco/schema';
import { MemoryAssetStore } from '@disco/sdk';
import { runBuildJob } from './buildProcessor.js';
import type { JobChannel, JobEvent } from './jobChannel.js';
import type { Repo } from './repo.js';

export type { JobChannel, JobEvent };

export interface RunBuildInput {
  jobId: string;
  snapshot: Snapshot;
  config: RebrandConfig;
  dryRun: boolean;
}

/**
 * The DEMO/in-process build path (no Redis): runs the SAME `runBuildJob` the worker runs, so the
 * code path is uniform (serialized DB writes, manifest checkpoint, resume-from-prior). Errors are
 * caught here and surfaced as a failed job + error event, since there is no BullMQ retry layer.
 */
export async function runBuild(repo: Repo, channel: JobChannel, input: RunBuildInput): Promise<void> {
  const { jobId } = input;
  try {
    await runBuildJob(
      { jobId, snapshot: input.snapshot, config: input.config, dryRun: input.dryRun, targetGuildId: null },
      { repo, channel, store: new MemoryAssetStore(), token: '' },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await repo.updateJob(jobId, { status: 'failed', error: message });
    void Promise.resolve(channel.publish(jobId, { type: 'error', message })).catch(() => {});
  }
}
