import { useEffect, useState } from 'react';
import { api, type SnapshotSummary } from '../api.js';
import { cx, shortId } from '../util.js';

const COUNT_ORDER = ['channels', 'roles', 'categories', 'emojis', 'automod', 'bots'];

export function Library({ onBuild }: { onBuild: (snapshotId: string) => void }) {
  const [snaps, setSnaps] = useState<SnapshotSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setSnaps(await api.snapshots());
  }
  useEffect(() => {
    load().catch((e) => setErr(String(e)));
  }, []);

  async function capture() {
    setBusy(true);
    setErr(null);
    try {
      await api.capture({});
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-8 max-w-5xl rise">
      <header className="flex items-end justify-between mb-7">
        <div>
          <div className="eyebrow mb-2">snapshot library</div>
          <h1 className="text-2xl">
            Templates, captured once. <span className="transform-text">Built many times.</span>
          </h1>
          <p className="text-sm mt-2 max-w-xl" style={{ color: 'var(--color-muted)' }}>
            Each snapshot is a portable, versioned copy of a finished server — channels, roles,
            permissions, emojis, AutoMod, and info-channel content. Re-capture any time to keep it current.
          </p>
        </div>
        <button className="btn" onClick={capture} disabled={busy}>
          {busy ? 'Capturing…' : '↻ New snapshot'}
        </button>
      </header>

      {err && (
        <div className="panel-soft p-3 mb-4 text-sm" style={{ color: 'var(--color-danger)' }}>
          {err}
        </div>
      )}

      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
        {snaps.map((s) => (
          <article key={s.id} className="panel p-5 flex flex-col">
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-base leading-snug">{s.name}</h2>
              <span className="chip chip-source">v{s.version}</span>
            </div>
            <div className="mono text-[0.72rem] mt-1.5" style={{ color: 'var(--color-faint)' }}>
              guild {shortId(s.sourceGuildId)}
            </div>

            <div className="grid grid-cols-3 gap-2 my-4">
              {COUNT_ORDER.map((k) => (
                <div key={k} className="panel-soft px-2.5 py-2">
                  <div className="text-lg leading-none" style={{ fontFamily: 'var(--font-display)' }}>
                    {s.counts[k] ?? 0}
                  </div>
                  <div className="text-[0.62rem] mono mt-1" style={{ color: 'var(--color-faint)' }}>
                    {k}
                  </div>
                </div>
              ))}
            </div>

            <button className={cx('btn btn-primary justify-center mt-auto')} onClick={() => onBuild(s.id)}>
              Rebrand & build →
            </button>
          </article>
        ))}
      </div>
    </div>
  );
}
