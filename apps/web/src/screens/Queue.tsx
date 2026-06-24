import { useEffect, useRef, useState } from 'react';
import { api, streamJobLogs, type Job, type JobEvent, type JobSummary } from '../api.js';
import { BuildSteps } from '../components/BuildSteps.js';
import { cx } from '../util.js';

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

export function Queue({ onOpen }: { onOpen: (jobId: string) => void }) {
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [detail, setDetail] = useState<Job | null>(null);
  const [logs, setLogs] = useState<JobEvent[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const logBoxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const tick = () => api.jobs().then(setJobs).catch(() => {});
    tick();
    const h = setInterval(tick, 1500);
    return () => clearInterval(h);
  }, []);

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

  const counts = jobs.reduce<Record<string, number>>((acc, j) => ((acc[j.status] = (acc[j.status] ?? 0) + 1), acc), {});

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

      {jobs.length === 0 && (
        <div className="panel p-8 text-center" style={{ color: 'var(--color-muted)' }}>
          No builds yet. Start one from a snapshot in the Library.
        </div>
      )}

      <div className="space-y-2">
        {jobs.map((j) => {
          const tag = failureTag(j.error);
          const isOpen = expanded === j.id;
          return (
            <div key={j.id} className="panel overflow-hidden">
              <div className="p-4 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium truncate" style={{ maxWidth: 220 }}>{j.snapshotName ?? 'build'}</span>
                    <span aria-hidden style={{ color: 'var(--color-faint)' }}>→</span>
                    <span className="text-sm" style={{ color: 'var(--color-client)' }}>{j.clientName ?? 'unbranded'}</span>
                    <span
                      className={cx('chip', STATUS_CHIP[j.status] ?? '')}
                      style={j.status === 'failed' || j.status === 'canceled' ? { color: 'var(--color-danger)' } : undefined}
                    >
                      {j.status}
                    </span>
                    {j.dryRun && <span className="chip chip-gold">dry-run</span>}
                    {tag && <span className="chip" style={{ color: 'var(--color-danger)', borderColor: 'color-mix(in srgb, var(--color-danger) 40%, transparent)' }}>{tag}</span>}
                  </div>
                  <div className="text-[0.72rem] mono mt-1.5 truncate" style={{ color: 'var(--color-faint)' }}>
                    {ago(j.createdAt)}
                    {j.metrics ? ` · built in ${fmtMs(j.metrics.durationMs)} · ${j.metrics.objectsCreated} objects` : ''}
                    {j.error ? ` · ${j.error}` : ''}
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

                <div className="flex items-center gap-1.5">
                  <button className="btn btn-ghost text-xs" onClick={() => setExpanded(isOpen ? null : j.id)}>
                    {isOpen ? 'Hide log' : 'Log'}
                  </button>
                  {j.status === 'completed' && !j.dryRun && (
                    <button className="btn text-xs" onClick={() => onOpen(j.id)}>
                      Delivery →
                    </button>
                  )}
                  {j.status === 'completed' && j.dryRun && (
                    <span className="label" style={{ color: 'var(--color-faint)' }}>preview only</span>
                  )}
                  {(j.status === 'failed' || j.status === 'canceled') && (
                    <button className="btn text-xs" disabled={busy === j.id} onClick={() => act(j.id, () => api.retryJob(j.id))}>
                      ↻ Retry
                    </button>
                  )}
                  {(j.status === 'queued' || j.status === 'paused') && (
                    <button className="btn btn-ghost text-xs" disabled={busy === j.id} onClick={() => act(j.id, () => api.cancelJob(j.id))}>
                      Cancel
                    </button>
                  )}
                </div>
              </div>

              {isOpen && (
                <div className="px-4 pb-4 space-y-3">
                  {detail?.manifest && <BuildSteps manifest={detail.manifest} status={detail.status} />}
                  <div ref={logBoxRef} className="term" style={{ maxHeight: 200 }}>
                    {logs.length === 0 ? (
                      <span style={{ color: 'var(--color-faint)' }}>waiting for log…</span>
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
