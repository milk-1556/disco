import { useEffect, useState } from 'react';
import { api, type JobSummary, type SnapshotSummary } from '../api.js';
import { shortId } from '../util.js';

interface Item {
  key: string;
  time: number;
  text: string;
  detail: string;
  status: 'running' | 'completed' | 'failed' | 'queued' | 'snapshot';
}

const DOT: Record<Item['status'], string> = {
  running: 'var(--color-source)',
  completed: 'var(--color-jade)',
  failed: 'var(--color-danger)',
  queued: 'var(--color-gold)',
  snapshot: 'var(--color-client)',
};

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function build(jobs: JobSummary[], snaps: SnapshotSummary[]): Item[] {
  const items: Item[] = [];
  for (const j of jobs) {
    const id = shortId(j.id);
    const t = new Date(j.updatedAt || j.createdAt).getTime();
    if (j.status === 'running') items.push({ key: j.id, time: t, status: 'running', text: `Build ${id} is running`, detail: `step ${Math.round(j.progress * 11)}/11 · ${Math.round(j.progress * 100)}%` });
    else if (j.status === 'completed') items.push({ key: j.id, time: t, status: 'completed', text: `Build ${id} delivered`, detail: j.dryRun ? 'dry-run complete' : 'server built' });
    else if (j.status === 'failed') items.push({ key: j.id, time: t, status: 'failed', text: `Build ${id} failed`, detail: j.error ?? '' });
    else if (j.status === 'queued') items.push({ key: j.id, time: t, status: 'queued', text: `Build ${id} queued`, detail: 'waiting for a worker' });
  }
  for (const s of snaps) {
    const t = new Date(s.lastUsedAt ?? s.capturedAt).getTime();
    items.push({ key: `snap-${s.id}`, time: t, status: 'snapshot', text: `Snapshot "${s.name}"`, detail: s.lastUsedAt ? `last built ${ago(s.lastUsedAt)}` : `captured · ${s.counts.channels ?? 0} channels` });
  }
  return items.sort((a, b) => b.time - a.time).slice(0, 40);
}

/** A live, breathing activity feed across every build + snapshot — the system at a glance (#14). */
export function Activity() {
  const [items, setItems] = useState<Item[]>([]);
  const [running, setRunning] = useState(0);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const [jobs, snaps] = await Promise.all([api.jobs(), api.snapshots()]);
        if (!alive) return;
        setItems(build(jobs, snaps));
        setRunning(jobs.filter((j) => j.status === 'running' || j.status === 'queued').length);
      } catch {
        /* keep last */
      }
    };
    tick();
    const h = setInterval(tick, 1500);
    return () => {
      alive = false;
      clearInterval(h);
    };
  }, []);

  return (
    <div className="px-4 py-6 md:p-8 max-w-3xl rise">
      <header className="flex items-end justify-between mb-6">
        <div>
          <div className="eyebrow mb-2">activity</div>
          <h1 className="text-2xl">The system, <span className="transform-text">breathing</span></h1>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full live-dot" style={{ background: running > 0 ? 'var(--color-jade)' : 'var(--color-faint)' }} />
          <span className="mono text-xs" style={{ color: 'var(--color-muted)' }}>
            {running > 0 ? `${running} active` : 'idle'}
          </span>
        </div>
      </header>

      {items.length === 0 ? (
        <div className="panel p-8 text-center" style={{ color: 'var(--color-muted)' }}>
          Nothing yet. Capture a snapshot or start a build to see the feed come alive.
        </div>
      ) : (
        <div className="panel p-2">
          {items.map((it) => (
            <div key={it.key} className="flex items-center gap-3 px-3 py-2.5 rounded-lg" style={{ borderBottom: '1px solid var(--color-line-soft)' }}>
              <span
                className={it.status === 'running' ? 'w-2.5 h-2.5 rounded-full live-dot shrink-0' : 'w-2.5 h-2.5 rounded-full shrink-0'}
                style={{ background: DOT[it.status] }}
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm">{it.text}</div>
                <div className="text-[0.72rem] mono truncate" style={{ color: 'var(--color-faint)' }}>{it.detail}</div>
              </div>
              <span className="mono text-[0.7rem] shrink-0" style={{ color: 'var(--color-faint)' }}>{ago(new Date(it.time).toISOString())}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
