import { useEffect, useState } from 'react';
import { api, type JobSummary, type SnapshotSummary } from '../api.js';

const fmtMs = (ms: number) => (ms < 1000 ? `${Math.round(ms)}ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)}s` : `${(ms / 60000).toFixed(1)}m`);

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
    const t = new Date(j.updatedAt || j.createdAt).getTime();
    const deal = `${j.snapshotName ?? 'a template'} → ${j.clientName ?? 'unbranded'}`;
    const kind = j.dryRun ? 'Dry-run' : 'Build';
    if (j.status === 'running') items.push({ key: j.id, time: t, status: 'running', text: `${kind}: ${deal}`, detail: `${Math.round(j.progress * 100)}% complete` });
    else if (j.status === 'completed')
      items.push({
        key: j.id,
        time: t,
        status: 'completed',
        text: `${j.dryRun ? 'Previewed' : 'Delivered'} ${deal}`,
        detail: j.dryRun ? 'dry-run — nothing was changed' : j.metrics ? `${j.metrics.objectsCreated} objects built in ${fmtMs(j.metrics.durationMs)}` : 'server built',
      });
    else if (j.status === 'failed') items.push({ key: j.id, time: t, status: 'failed', text: `Build failed: ${deal}`, detail: j.error ?? '' });
    else if (j.status === 'queued') items.push({ key: j.id, time: t, status: 'queued', text: `Queued: ${deal}`, detail: 'waiting for a worker' });
  }
  for (const s of snaps) {
    const t = new Date(s.capturedAt).getTime();
    items.push({ key: `snap-${s.id}`, time: t, status: 'snapshot', text: `Imported "${s.name}"`, detail: `${s.counts.channels ?? 0} channels · ${s.counts.roles ?? 0} roles · ${s.counts.bots ?? 0} bots` });
  }
  return items.sort((a, b) => b.time - a.time).slice(0, 40);
}

/** A live, breathing activity feed across every build + snapshot — the system at a glance (#14). */
export function Activity() {
  const [items, setItems] = useState<Item[]>([]);
  const [running, setRunning] = useState(0);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const [jobs, snaps] = await Promise.all([api.jobs(), api.snapshots()]);
        if (!alive) return;
        setItems(build(jobs, snaps));
        setRunning(jobs.filter((j) => j.status === 'running' || j.status === 'queued').length);
        setLoaded(true);
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
        !loaded ? (
          <div className="panel p-8 flex items-center justify-center gap-3" style={{ color: 'var(--color-muted)' }}>
            <span className="w-2 h-2 rounded-full live-dot" style={{ background: 'var(--color-source)' }} />
            <span className="text-sm">Tuning into the assembly line…</span>
          </div>
        ) : (
          <div className="panel p-8 text-center">
            <div className="text-sm font-medium mb-1">The feed is quiet</div>
            <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
              Snapshot a template or start a build and every step will stream in here live.
            </p>
          </div>
        )
      ) : (
        <div className="panel p-2">
          {items.map((it, idx) => (
            <div
              key={it.key}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg"
              style={{ borderBottom: idx === items.length - 1 ? 'none' : '1px solid var(--color-line-soft)' }}
            >
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
