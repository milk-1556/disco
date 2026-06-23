import { type BuildJobData, meterPort, rebrand, rebuildGuild, resilient } from '@disco/core';
import type { RebuildReport } from '@disco/schema';
import { type AssetStore, DiscordGuildClient, MockGuild } from '@disco/sdk';
import type { JobChannel } from './jobChannel.js';
import type { Repo } from './repo.js';

export interface BuildJobDeps {
  repo: Repo;
  channel: JobChannel;
  store: AssetStore;
  /** Bot token for live builds; empty → MockGuild (demo). */
  token: string;
}

/**
 * Execute one rebuild job against persistence + log transport. Shared by the BullMQ worker and the
 * integration test so there is exactly one implementation. DB-aware: resumes from the prior persisted
 * manifest (so a retry never duplicates), checkpoints as it goes, and writes the terminal Job row
 * BEFORE publishing the 'done' log event (so a client GET right after stream-close sees 'completed').
 */
export async function runBuildJob(data: BuildJobData, deps: BuildJobDeps): Promise<RebuildReport> {
  const { repo, channel, store, token } = deps;
  const { jobId, snapshot, config, dryRun, targetGuildId, contentIdentity } = data;

  const pub = (ev: Parameters<JobChannel['publish']>[1]) =>
    void Promise.resolve(channel.publish(jobId, ev)).catch(() => {});

  // Serialize all DB writes for this job so the fire-and-forget progress/manifest checkpoints can't
  // land AFTER the terminal write and clobber the final status/progress (ordering, not just timing).
  let chain: Promise<unknown> = Promise.resolve();
  const persist = (patch: Parameters<Repo['updateJob']>[1]) =>
    (chain = chain.then(() => repo.updateJob(jobId, patch)).then(
      () => {},
      () => {},
    ));

  persist({ status: 'running' });
  const prior = (await repo.getJob(jobId))?.manifest ?? undefined;
  const { snapshot: rebranded } = rebrand(snapshot, config);
  const rawPort =
    token && targetGuildId
      ? new DiscordGuildClient({ token, guildId: targetGuildId, store })
      : new MockGuild('900000000000000000', rebranded.guild.name);
  // Meter UNDER resilient so retried calls count as the real API calls they are (cost analytics).
  const meter = meterPort(rawPort);
  const port = resilient(meter.port, { onLog: (m) => pub({ type: 'log', message: m }) });
  const startMs = Date.now();

  const { manifest, report } = await rebuildGuild(port, rebranded, {
    jobId,
    dryRun,
    targetGuildId: targetGuildId ?? null,
    contentIdentity: contentIdentity ?? 'server',
    markerRole: token && targetGuildId ? '⟜ Disco Build' : undefined,
    manifest: prior,
    onManifest: (m) => void persist({ manifest: m }),
    onLog: (m) => pub({ type: 'log', message: m }),
    onProgress: (pct, step) => {
      pub({ type: 'progress', progress: pct, step });
      void persist({ progress: pct });
    },
  });

  // Drain the (swallowed) checkpoint writes to preserve ordering, THEN write the terminal row WITHOUT
  // swallowing — 'done' must be gated on a confirmed terminal write. If this throws (transient PG
  // failure), it propagates: BullMQ retries (resuming idempotently from the checkpointed manifest) or
  // the worker's failed-handler records status:'failed'. Never publish a false 'done'.
  await chain;
  const metrics = { apiCalls: meter.count(), durationMs: Date.now() - startMs, objectsCreated: report.created.length };
  await repo.updateJob(jobId, { status: 'completed', progress: 1, manifest, report, metrics });
  await Promise.resolve(
    channel.publish(jobId, {
      type: 'done',
      message: dryRun
        ? `Dry-run complete: ${report.created.length} object(s) would be created, ${report.manualSteps.length} manual step(s).`
        : `Build complete: ${report.created.length} created, ${report.manualSteps.length} manual step(s).`,
    }),
  );
  return report;
}
