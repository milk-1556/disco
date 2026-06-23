import { useEffect, useState } from 'react';
import { api, type JobSummary } from '../api.js';
import { cx, shortId } from '../util.js';

const STATUS_CHIP: Record<string, string> = {
  completed: 'chip-jade',
  running: 'chip-source',
  failed: '',
  queued: '',
};

export function Queue({ onOpen }: { onOpen: (jobId: string) => void }) {
  const [jobs, setJobs] = useState<JobSummary[]>([]);

  useEffect(() => {
    const tick = () => api.jobs().then(setJobs).catch(() => {});
    tick();
    const h = setInterval(tick, 2000);
    return () => clearInterval(h);
  }, []);

  return (
    <div className="p-8 max-w-4xl rise">
      <div className="eyebrow mb-2">build queue</div>
      <h1 className="text-2xl mb-6">Every build, on the record</h1>

      {jobs.length === 0 && (
        <div className="panel p-8 text-center" style={{ color: 'var(--color-muted)' }}>
          No builds yet. Start one from a snapshot in the Library.
        </div>
      )}

      <div className="space-y-2">
        {jobs.map((j) => (
          <button
            key={j.id}
            onClick={() => onOpen(j.id)}
            className="panel w-full text-left p-4 flex items-center gap-4 hover:border-[color:var(--color-faint)] transition"
          >
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="mono text-sm">{shortId(j.id)}</span>
                <span className={cx('chip', STATUS_CHIP[j.status] ?? '')} style={j.status === 'failed' ? { color: 'var(--color-danger)' } : undefined}>
                  {j.status}
                </span>
                {j.dryRun && <span className="chip chip-gold">dry-run</span>}
              </div>
              <div className="text-[0.72rem] mono mt-1.5" style={{ color: 'var(--color-faint)' }}>
                {j.clientId ?? 'no client'} · {new Date(j.createdAt).toLocaleString()}
              </div>
            </div>
            <div className="w-32">
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--color-line)' }}>
                <div className="h-full transform-bar" style={{ width: `${Math.round(j.progress * 100)}%` }} />
              </div>
              <div className="text-[0.65rem] mono mt-1 text-right" style={{ color: 'var(--color-faint)' }}>
                {Math.round(j.progress * 100)}%
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
