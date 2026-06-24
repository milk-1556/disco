import { useEffect, useState } from 'react';
import { api, type SnapshotSummary, type SnapshotDiff as SnapshotDiffData } from '../api.js';

export function SnapshotDiff({
  snapshots,
  onBack,
}: {
  snapshots: SnapshotSummary[];
  onBack: () => void;
}) {
  const enough = snapshots.length >= 2;
  const [baseId, setBaseId] = useState(snapshots[1]?.id ?? '');
  const [compareId, setCompareId] = useState(snapshots[0]?.id ?? '');
  const [diff, setDiff] = useState<SnapshotDiffData | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Keep selections valid if the snapshot list changes underneath us.
  useEffect(() => {
    if (!snapshots.some((s) => s.id === baseId)) setBaseId(snapshots[1]?.id ?? '');
    if (!snapshots.some((s) => s.id === compareId)) setCompareId(snapshots[0]?.id ?? '');
  }, [snapshots, baseId, compareId]);

  async function compare() {
    if (!baseId || !compareId) return;
    setBusy(true);
    setErr(null);
    try {
      // api.diff(id, against) computes against→id, i.e. base→compare.
      setDiff(await api.diff(compareId, baseId));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const label = (s: SnapshotSummary) => `${s.name} · v${s.version}`;

  return (
    <div className="px-4 py-6 md:p-8 max-w-5xl rise">
      <button className="btn btn-ghost text-sm mb-4 -ml-2" onClick={onBack}>
        ← back
      </button>

      <header className="mb-7">
        <div className="eyebrow mb-2">snapshot diff</div>
        <h1 className="text-2xl">
          What changed <span className="transform-text">between captures</span>
        </h1>
        <p className="text-sm mt-2 max-w-xl" style={{ color: 'var(--color-muted)' }}>
          Pick two versions of a snapshot to see exactly which roles, channels, and emojis were added
          or removed — and how the counts moved.
        </p>
      </header>

      {!enough ? (
        <div className="panel-soft p-4 text-sm" style={{ color: 'var(--color-muted)' }}>
          Capture another version to compare.
        </div>
      ) : (
        <>
          <div className="panel p-5 mb-6">
            <div className="grid gap-4" style={{ gridTemplateColumns: '1fr auto 1fr auto' }}>
              <div>
                <div className="label mb-1" style={{ color: 'var(--color-source)' }}>
                  base · before
                </div>
                <select
                  className="input mono"
                  value={baseId}
                  onChange={(e) => setBaseId(e.target.value)}
                >
                  {snapshots.map((s) => (
                    <option key={s.id} value={s.id}>
                      {label(s)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-end pb-2" style={{ color: 'var(--color-faint)' }}>
                →
              </div>

              <div>
                <div className="label mb-1" style={{ color: 'var(--color-client)' }}>
                  compare · after
                </div>
                <select
                  className="input mono"
                  value={compareId}
                  onChange={(e) => setCompareId(e.target.value)}
                >
                  {snapshots.map((s) => (
                    <option key={s.id} value={s.id}>
                      {label(s)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-end">
                <button
                  className="btn justify-center"
                  onClick={compare}
                  disabled={busy || !baseId || !compareId}
                >
                  {busy ? 'Comparing…' : 'Compare'}
                </button>
              </div>
            </div>
          </div>

          {err && (
            <div
              className="panel-soft p-3 mb-6 text-sm"
              style={{ color: 'var(--color-danger)' }}
            >
              {err}
            </div>
          )}

          {diff && <DiffReport diff={diff} />}
        </>
      )}
    </div>
  );
}

function DiffReport({ diff }: { diff: SnapshotDiffData }) {
  const sections: [string, SnapshotDiffData['roles']][] = [
    ['roles', diff.roles],
    ['channels', diff.channels],
    ['emojis', diff.emojis],
    ['automod', diff.automod],
  ];
  const countKeys = Object.keys(diff.counts);

  return (
    <div className="space-y-6 rise">
      {diff.guildNameChanged && (
        <div className="panel p-5">
          <div className="eyebrow mb-3">server renamed</div>
          <div className="flex items-center gap-4">
            <div
              className="panel-soft px-3 py-3 flex-1"
              style={{
                borderColor: 'color-mix(in srgb, var(--color-source) 40%, transparent)',
              }}
            >
              <div
                className="font-semibold text-sm leading-tight"
                style={{ fontFamily: 'var(--font-display)', color: 'var(--color-source)' }}
              >
                {diff.guildNameChanged.before}
              </div>
            </div>
            <div style={{ color: 'var(--color-faint)' }}>→</div>
            <div
              className="panel-soft px-3 py-3 flex-1"
              style={{
                borderColor: 'color-mix(in srgb, var(--color-client) 40%, transparent)',
              }}
            >
              <div
                className="font-semibold text-sm leading-tight"
                style={{ fontFamily: 'var(--font-display)', color: 'var(--color-client)' }}
              >
                {diff.guildNameChanged.after}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
        {sections.map(([title, sec]) => (
          <DiffSection key={title} title={title} added={sec.added} removed={sec.removed} changed={sec.changed} />
        ))}
      </div>

      <div className="panel p-5">
        <div className="eyebrow mb-3">counts</div>
        <div className="space-y-1.5">
          {countKeys.length === 0 && (
            <div className="text-xs" style={{ color: 'var(--color-faint)' }}>
              no counts recorded
            </div>
          )}
          {countKeys.map((k) => {
            const { before, after } = diff.counts[k];
            const delta = after - before;
            const deltaColor =
              delta > 0
                ? 'var(--color-jade)'
                : delta < 0
                  ? 'var(--color-danger)'
                  : 'var(--color-muted)';
            return (
              <div
                key={k}
                className="panel-soft px-3 py-2 flex items-center gap-3 text-sm"
              >
                <span className="label" style={{ minWidth: 96 }}>
                  {k}
                </span>
                <span className="mono text-xs" style={{ color: 'var(--color-source)' }}>
                  {before}
                </span>
                <span style={{ color: 'var(--color-faint)' }}>→</span>
                <span className="mono text-xs" style={{ color: 'var(--color-client)' }}>
                  {after}
                </span>
                <span
                  className="mono text-xs ml-auto"
                  style={{ color: deltaColor }}
                >
                  {delta > 0 ? `+${delta}` : delta < 0 ? `${delta}` : '±0'}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function DiffSection({
  title,
  added,
  removed,
  changed,
}: {
  title: string;
  added: string[];
  removed: string[];
  changed: SnapshotDiffData['roles']['changed'];
}) {
  const total = added.length + removed.length + changed.length;
  return (
    <div className="panel p-5 self-start">
      <div className="flex items-center justify-between mb-3">
        <span className="label">{title}</span>
        <span className="chip">
          {total > 0 ? `+${added.length} ~${changed.length} −${removed.length}` : 'unchanged'}
        </span>
      </div>

      {total === 0 ? (
        <div className="text-xs" style={{ color: 'var(--color-faint)' }}>
          no changes
        </div>
      ) : (
        <div className="space-y-3">
          {added.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {added.map((name, i) => (
                <span key={`a-${i}`} className="chip chip-jade">+ {name}</span>
              ))}
            </div>
          )}
          {removed.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {removed.map((name, i) => (
                <span
                  key={`r-${i}`}
                  className="chip"
                  style={{
                    color: 'var(--color-danger)',
                    borderColor: 'color-mix(in srgb, var(--color-danger) 40%, transparent)',
                    background: 'color-mix(in srgb, var(--color-danger) 12%, transparent)',
                    textDecoration: 'line-through',
                  }}
                >
                  − {name}
                </span>
              ))}
            </div>
          )}
          {/* per-field expansion: which exact field changed on a matched object */}
          {changed.map((c, i) => (
            <details key={`c-${i}`} className="panel-soft px-3 py-2">
              <summary className="text-sm cursor-pointer" style={{ color: 'var(--color-gold)' }}>
                ~ {c.name} <span className="mono text-[0.66rem]" style={{ color: 'var(--color-faint)' }}>({c.fields.length} field{c.fields.length === 1 ? '' : 's'})</span>
              </summary>
              <div className="mt-2 space-y-1">
                {c.fields.map((f, j) => (
                  <div key={j} className="flex items-center gap-2 text-[0.72rem]">
                    <span className="label" style={{ minWidth: 80 }}>{f.field}</span>
                    <span className="mono truncate" style={{ color: 'var(--color-source)', maxWidth: 120 }}>{f.before}</span>
                    <span style={{ color: 'var(--color-faint)' }}>→</span>
                    <span className="mono truncate" style={{ color: 'var(--color-client)', maxWidth: 120 }}>{f.after}</span>
                  </div>
                ))}
              </div>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
