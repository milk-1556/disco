import { useEffect, useRef, useState } from 'react';
import { api, streamJobLogs, type Job, type JobEvent, type JobSummary, type JoinedGuild } from '../api.js';
import { BuildSteps } from '../components/BuildSteps.js';
import { EmptyArt } from '../components/EmptyArt.js';
import { SkeletonRows } from '../components/Skeleton.js';
import { cx } from '../util.js';
import { usePoll } from '../usePoll.js';

const fmtMs = (ms: number) => (ms < 1000 ? `${Math.round(ms)}ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)}s` : `${(ms / 60000).toFixed(1)}m`);
const ago = (iso: string) => {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
};

const STATUS_CHIP: Record<string, string> = {
  completed: 'chip-jade',
  running: 'chip-source',
  queued: '',
  paused: 'chip-gold',
  failed: '',
  canceled: '',
};

/** One-word failure-mode tag derived from the error text, for at-a-glance triage. */
function failureTag(error: string | null): string | null {
  if (!error) return null;
  const e = error.toLowerCase();
  if (/rate limit|429|throttl/.test(e)) return 'rate-limit';
  if (/token|unauthorized|401|administrator|missing access|403/.test(e)) return 'auth';
  if (/timeout|econn|network|5\d\d|transient/.test(e)) return 'transient';
  if (/not found|404/.test(e)) return 'missing';
  return 'error';
}

/** Human, in-voice label for each failure tag — shown on the chip. */
const TAG_LABEL: Record<string, string> = {
  'rate-limit': 'Pending Discord-API limit',
  auth: 'Waiting on bot OAuth re-invite',
  transient: 'Transient — safe to retry',
  missing: 'Source not found',
  error: 'Build error',
};

export function Queue({ onOpen }: { onOpen: (jobId: string) => void }) {
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [detail, setDetail] = useState<Job | null>(null);
  const [logs, setLogs] = useState<JobEvent[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  // Replay: which job's panel is open, its form fields, joined-guild picker, and per-job "queued ✓" flash.
  const [replayFor, setReplayFor] = useState<string | null>(null);
  const [replayGuild, setReplayGuild] = useState('');
  const [replayDryRun, setReplayDryRun] = useState(true);
  const [replayBusy, setReplayBusy] = useState(false);
  const [replayDone, setReplayDone] = useState<string | null>(null);
  const [guildOpts, setGuildOpts] = useState<JoinedGuild[] | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const logBoxRef = useRef<HTMLDivElement>(null);

  usePoll(
    () =>
      void api
        .jobs()
        .then(setJobs)
        .catch(() => {})
        .finally(() => setLoaded(true)),
    1500,
  );

  // Stream the expanded job's logs inline + load its full detail (manifest/steps for timing).
  useEffect(() => {
    stopRef.current?.();
    stopRef.current = null;
    setLogs([]);
    setDetail(null);
    if (!expanded) return;
    api.job(expanded).then(setDetail).catch(() => {});
    stopRef.current = streamJobLogs(expanded, (ev) => {
      setLogs((prev) => [...prev, ev]);
      if (ev.type === 'done' || ev.type === 'error') api.job(expanded).then(setDetail).catch(() => {});
    });
    return () => {
      stopRef.current?.();
      stopRef.current = null;
    };
  }, [expanded]);

  useEffect(() => {
    logBoxRef.current?.scrollTo({ top: logBoxRef.current.scrollHeight });
  }, [logs]);

  const act = async (id: string, fn: () => Promise<unknown>) => {
    setBusy(id);
    try {
      await fn();
      setJobs(await api.jobs());
    } catch {
      /* surfaced via the list refresh */
    } finally {
      setBusy(null);
    }
  };

  // Open the replay panel for a job, resetting the form; lazily fetch the joined-guild picker once.
  const openReplay = (id: string) => {
    setReplayFor((cur) => (cur === id ? null : id));
    setReplayGuild('');
    setReplayDryRun(true);
    setReplayDone(null);
    if (guildOpts === null) api.guilds().then((r) => setGuildOpts(r.guilds)).catch(() => setGuildOpts([]));
  };

  const submitReplay = async (id: string) => {
    setReplayBusy(true);
    try {
      const targetGuildId = replayGuild.trim();
      await api.replayJob(id, { dryRun: replayDryRun, ...(targetGuildId ? { targetGuildId } : {}) });
      setReplayFor(null);
      setReplayDone(id);
      setJobs(await api.jobs());
      setTimeout(() => setReplayDone((cur) => (cur === id ? null : cur)), 3000);
    } catch {
      /* surfaced via the list refresh */
    } finally {
      setReplayBusy(false);
    }
  };

  const counts = jobs.reduce<Record<string, number>>((acc, j) => ((acc[j.status] = (acc[j.status] ?? 0) + 1), acc), {});

  // Bulk actions — retry every failed/canceled build or cancel every queued/paused one in one confirm.
  const failedJobs = jobs.filter((j) => j.status === 'failed' || j.status === 'canceled');
  const queuedJobs = jobs.filter((j) => j.status === 'queued' || j.status === 'paused');
  const bulkAct = async (ids: string[], fn: (id: string) => Promise<unknown>, verb: string) => {
    if (!confirm(`${verb} ${ids.length} build${ids.length === 1 ? '' : 's'}?`)) return;
    setBulkBusy(true);
    for (const id of ids) await fn(id).catch(() => {}); // best-effort; one failure doesn't block the rest
    setJobs(await api.jobs());
    setBulkBusy(false);
  };

  return (
    <div className="px-4 py-6 md:p-8 max-w-4xl rise">
      <div className="flex items-end justify-between mb-6">
        <div>
          <div className="eyebrow mb-2">build queue</div>
          <h1 className="text-2xl">Every build, on the record</h1>
        </div>
        <div className="flex gap-1.5">
          {(['running', 'queued', 'completed', 'failed'] as const).map(
            (s) => counts[s] ? <span key={s} className={cx('chip', STATUS_CHIP[s])}>{counts[s]} {s}</span> : null,
          )}
        </div>
      </div>

      {(failedJobs.length > 1 || queuedJobs.length > 1) && (
        <div className="panel-soft p-2.5 mb-5 flex items-center gap-2 flex-wrap text-sm">
          <span className="label">bulk</span>
          {failedJobs.length > 1 && (
            <button className="btn text-xs" disabled={bulkBusy} onClick={() => bulkAct(failedJobs.map((j) => j.id), (id) => api.retryJob(id), 'Retry')}>
              ↻ Retry all failed ({failedJobs.length})
            </button>
          )}
          {queuedJobs.length > 1 && (
            <button className="btn btn-ghost text-xs" disabled={bulkBusy} onClick={() => bulkAct(queuedJobs.map((j) => j.id), (id) => api.cancelJob(id), 'Cancel')}>
              Cancel all queued ({queuedJobs.length})
            </button>
          )}
          {bulkBusy && <span className="mono text-xs" style={{ color: 'var(--color-faint)' }}>working…</span>}
        </div>
      )}

      {jobs.length === 0 && !loaded && <SkeletonRows count={3} h={72} />}

      {jobs.length === 0 && loaded && (
        <div className="panel p-8 text-center">
          <EmptyArt name="queue" className="mx-auto mb-3" />
          <div className="text-base mb-1" style={{ color: 'var(--color-bone)' }}>No builds yet</div>
          <p className="text-sm mb-4" style={{ color: 'var(--color-muted)' }}>
            Snapshot a template, then build it for a client — every run shows up here, on the record.
          </p>
        </div>
      )}

      <div className="space-y-2">
        {jobs.map((j) => {
          const tag = failureTag(j.error);
          const isOpen = expanded === j.id;
          return (
            <div key={j.id} className="panel overflow-hidden">
              <div className="p-4 flex flex-wrap items-center gap-x-4 gap-y-3">
                <div className="flex-1 min-w-0" style={{ minWidth: 180 }}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium truncate" style={{ maxWidth: 200 }} title={j.snapshotName ?? 'build'}>{j.snapshotName ?? 'build'}</span>
                    <span aria-hidden style={{ color: 'var(--color-faint)' }}>→</span>
                    <span className="text-sm truncate" style={{ color: 'var(--color-client)', maxWidth: 160 }} title={j.clientName ?? 'unbranded'}>{j.clientName ?? 'unbranded'}</span>
                    <span
                      className={cx('chip', STATUS_CHIP[j.status] ?? '')}
                      style={j.status === 'failed' || j.status === 'canceled' ? { color: 'var(--color-danger)' } : undefined}
                    >
                      {j.status}
                    </span>
                    {j.dryRun && <span className="chip chip-gold">dry-run</span>}
                    {j.canary && <span className="chip chip-source">canary</span>}
                    {tag && <span className="chip" style={{ color: 'var(--color-danger)', borderColor: 'color-mix(in srgb, var(--color-danger) 40%, transparent)' }}>{TAG_LABEL[tag] ?? tag}</span>}
                  </div>
                  <div className="text-[0.72rem] mono mt-1.5 truncate" style={{ color: 'var(--color-faint)' }} title={j.error ?? undefined}>
                    {ago(j.createdAt)}
                    {j.metrics ? ` · built in ${fmtMs(j.metrics.durationMs)} · ${j.metrics.objectsCreated} objects` : ''}
                    {j.error ? ` · ` : ''}
                    {j.error && <span style={{ color: 'var(--color-danger)' }}>{j.error}</span>}
                  </div>
                </div>

                <div className="w-28">
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--color-line)' }}>
                    <div className="h-full transform-bar transition-all" style={{ width: `${Math.round(j.progress * 100)}%` }} />
                  </div>
                  <div className="text-[0.65rem] mono mt-1 text-right" style={{ color: 'var(--color-faint)' }}>
                    {Math.round(j.progress * 100)}%
                  </div>
                </div>

                <div className="flex items-center gap-1.5 flex-wrap ml-auto">
                  <button className="btn btn-ghost text-xs" onClick={() => setExpanded(isOpen ? null : j.id)} aria-expanded={isOpen}>
                    {isOpen ? 'Hide log' : 'Log'}
                  </button>
                  {j.status === 'completed' && !j.dryRun && !j.canary && (
                    <button className="btn text-xs" onClick={() => onOpen(j.id)}>
                      Delivery →
                    </button>
                  )}
                  {j.status === 'completed' && (j.dryRun || j.canary) && (
                    <span className="label" style={{ color: 'var(--color-faint)' }}>{j.canary ? 'canary — inspect, then build for real' : 'preview only'}</span>
                  )}
                  {j.status === 'completed' && j.snapshotId && (
                    replayDone === j.id ? (
                      <span className="chip chip-jade" role="status">Queued replay ✓</span>
                    ) : (
                      <button
                        className="btn btn-ghost text-xs"
                        onClick={() => openReplay(j.id)}
                        aria-expanded={replayFor === j.id}
                        title="Re-run this build's snapshot + config for a new client"
                      >
                        ⤳ Replay
                      </button>
                    )
                  )}
                  {(j.status === 'failed' || j.status === 'canceled') && (
                    <button className="btn text-xs" disabled={busy === j.id} onClick={() => act(j.id, () => api.retryJob(j.id))}>
                      {busy === j.id ? 'Retrying…' : '↻ Retry'}
                    </button>
                  )}
                  {(j.status === 'queued' || j.status === 'paused') && (
                    <button className="btn btn-ghost text-xs" disabled={busy === j.id} onClick={() => act(j.id, () => api.cancelJob(j.id))}>
                      {busy === j.id ? 'Canceling…' : 'Cancel'}
                    </button>
                  )}
                </div>
              </div>

              {replayFor === j.id && (
                <div className="px-4 pb-4">
                  <div className="panel-soft p-4 space-y-3">
                    <div>
                      <div className="eyebrow mb-1">replay this build</div>
                      <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                        Re-runs the same snapshot <span style={{ color: 'var(--color-source)' }}>{j.snapshotName ?? 'template'}</span> and config against a new target — sell this template to the next client.
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-3 items-end">
                      <div className="flex-1" style={{ minWidth: 180 }}>
                        <label className="label block mb-1" htmlFor={`replay-guild-${j.id}`}>target guild</label>
                        {guildOpts && guildOpts.length > 0 ? (
                          <select
                            id={`replay-guild-${j.id}`}
                            className="input w-full"
                            value={replayGuild}
                            onChange={(e) => setReplayGuild(e.target.value)}
                          >
                            <option value="">Same as original</option>
                            {guildOpts.map((g) => (
                              <option key={g.id} value={g.id}>{g.name}</option>
                            ))}
                          </select>
                        ) : (
                          <input
                            id={`replay-guild-${j.id}`}
                            className="input w-full"
                            placeholder={guildOpts === null ? 'Loading guilds…' : 'Guild ID (blank = same as original)'}
                            value={replayGuild}
                            onChange={(e) => setReplayGuild(e.target.value)}
                          />
                        )}
                      </div>
                    </div>

                    <label className="flex items-center gap-2 text-sm cursor-pointer select-none" htmlFor={`replay-dry-${j.id}`}>
                      <input
                        id={`replay-dry-${j.id}`}
                        type="checkbox"
                        className="accent-[var(--color-source)]"
                        checked={replayDryRun}
                        onChange={(e) => setReplayDryRun(e.target.checked)}
                      />
                      <span>Dry-run first <span style={{ color: 'var(--color-faint)' }}>— preview without touching the target (safer)</span></span>
                    </label>

                    <div className="flex gap-2 items-center">
                      <button className="btn btn-primary text-xs" disabled={replayBusy} onClick={() => submitReplay(j.id)}>
                        {replayBusy ? 'Queuing…' : 'Replay build'}
                      </button>
                      <button className="btn btn-ghost text-xs" disabled={replayBusy} onClick={() => setReplayFor(null)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {isOpen && (
                <div className="px-4 pb-4 space-y-3">
                  {detail?.manifest && <BuildSteps manifest={detail.manifest} status={detail.status} />}
                  <div ref={logBoxRef} className="term" style={{ maxHeight: 200 }}>
                    {logs.length === 0 ? (
                      <span style={{ color: 'var(--color-faint)' }}>Pulling the build log…</span>
                    ) : (
                      logs.map((e, i) => (
                        <div key={i} style={{ color: e.type === 'error' ? 'var(--color-danger)' : e.type === 'done' ? 'var(--color-jade)' : 'var(--color-muted)' }}>
                          <span style={{ color: 'var(--color-faint)' }}>{e.type === 'progress' ? '·' : '›'} </span>
                          {e.message ?? (e.step ? `${e.step} ${Math.round((e.progress ?? 0) * 100)}%` : '')}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
