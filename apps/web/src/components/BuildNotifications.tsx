import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

interface Toast {
  id: string;
  kind: 'done' | 'failed' | 'open';
  title: string;
  sub: string;
  jobId: string;
}

/**
 * Global build-completion notifications. Polls the (cheap, owner-scoped) jobs list and toasts when a
 * REAL build (non-dry-run) transitions into completed/failed — so the operator gets told the moment a
 * build lands instead of having to camp on the Queue. Dry-runs are skipped (fast + noisy). Optional
 * onOpen jumps to the finished build. Inert on first load (it only reacts to *transitions*, so a page
 * refresh never replays old completions).
 */
export function BuildNotifications({ onOpen }: { onOpen?: (jobId: string) => void }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const prev = useRef<Map<string, string> | null>(null); // jobId → last-seen status; null until first poll
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const dismiss = (id: string) => {
    setToasts((t) => t.filter((x) => x.id !== id));
    const h = timers.current[id];
    if (h) { clearTimeout(h); delete timers.current[id]; }
  };

  useEffect(() => {
    let live = true;
    let seq = 0;
    const poll = async () => {
      const jobs = await api.jobs().catch(() => null);
      if (!live || !jobs) return;
      const now = new Map(jobs.map((j) => [j.id, j.status]));
      const before = prev.current;
      prev.current = now;
      if (!before) return; // first poll seeds the baseline — never toast historical state
      for (const j of jobs) {
        if (j.dryRun) continue; // skip dry-run noise
        const was = before.get(j.id);
        const terminal = j.status === 'completed' || j.status === 'failed';
        const wasTerminal = was === 'completed' || was === 'failed';
        // Toast when a build BECOMES terminal — including a fast build that appeared already-completed
        // since the last poll (was === undefined). The baseline (first) poll seeds `before`, so a page
        // load never replays already-finished builds.
        if (terminal && !wasTerminal) {
          const id = `${j.id}:${j.status}:${seq++}`;
          const name = j.snapshotName ?? j.clientName ?? 'Build';
          const toast: Toast = j.status === 'completed'
            ? { id, kind: 'done', title: `${name} built`, sub: `${j.canary ? 'Canary ' : ''}build completed`, jobId: j.id }
            : { id, kind: 'failed', title: `${name} failed`, sub: j.error ? j.error.slice(0, 80) : 'Build failed — open to retry', jobId: j.id };
          setToasts((t) => [toast, ...t].slice(0, 4));
          timers.current[id] = setTimeout(() => dismiss(id), 9000);
        }
      }
    };
    const iv = setInterval(poll, 6000);
    void poll();
    return () => { live = false; clearInterval(iv); Object.values(timers.current).forEach(clearTimeout); };
  }, []);

  // Client-open notifications: poll for deliveries a client just opened. Seed the cursor to "now" on mount
  // so a page load never replays historical opens; only opens newer than the cursor toast.
  useEffect(() => {
    let live = true;
    let cursor = Date.now();
    let seq = 0;
    const poll = async () => {
      const res = await api.clientOpens(cursor).catch(() => null);
      if (!live || !res || res.opens.length === 0) return;
      cursor = Math.max(cursor, ...res.opens.map((o) => Date.parse(o.at)));
      // Toast EVERY surfaced open (the server already caps the batch at 20) — otherwise advancing the
      // cursor past an un-toasted open would silently drop that notification. Oldest-first so the newest
      // ends on top; the toast stack's own slice(0,4) caps how many are visible at once.
      for (const o of [...res.opens].reverse()) {
        const id = `open:${o.handoverId}:${seq++}`;
        setToasts((t) => [{ id, kind: 'open' as const, title: `${o.label} opened their delivery`, sub: 'Client viewed their finished server', jobId: o.jobId }, ...t].slice(0, 4));
        timers.current[id] = setTimeout(() => dismiss(id), 9000);
      }
    };
    const iv = setInterval(poll, 8000);
    void poll();
    return () => { live = false; clearInterval(iv); };
  }, []);

  if (toasts.length === 0) return null;
  return (
    <div style={{ position: 'fixed', top: 16, right: 16, zIndex: 80, display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 'min(360px, calc(100vw - 32px))' }} aria-live="polite">
      {toasts.map((t) => {
        const accent = t.kind === 'done' ? 'var(--color-jade)' : t.kind === 'open' ? 'var(--color-client)' : 'var(--color-danger)';
        const glyph = t.kind === 'done' ? '●' : t.kind === 'open' ? '◆' : '▲';
        return (
          <div key={t.id} className="panel rise" style={{ padding: '11px 13px', display: 'flex', alignItems: 'flex-start', gap: 10, borderColor: `color-mix(in srgb, ${accent} 45%, var(--color-line))` }}>
            <span aria-hidden style={{ color: accent, marginTop: 1 }}>{glyph}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="text-sm" style={{ color: 'var(--color-bone)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</div>
              <div className="text-[0.72rem]" style={{ color: 'var(--color-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.sub}</div>
              {onOpen && (
                <button className="btn btn-ghost text-xs mt-1.5" style={{ padding: '0.2rem 0.55rem' }} onClick={() => { onOpen(t.jobId); dismiss(t.id); }}>
                  Open →
                </button>
              )}
            </div>
            <button aria-label="Dismiss" onClick={() => dismiss(t.id)} style={{ background: 'none', border: 'none', color: 'var(--color-faint)', cursor: 'pointer', fontSize: '1rem', lineHeight: 1 }}>×</button>
          </div>
        );
      })}
    </div>
  );
}
