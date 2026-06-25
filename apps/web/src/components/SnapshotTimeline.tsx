import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import type { CategoryDiff, JobSummary, SnapshotDiff, SnapshotSummary } from '../api.js';

function relative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Date.now() - then;
  const abs = Math.abs(diff);
  const min = 60_000;
  const hr = 60 * min;
  const day = 24 * hr;
  const week = 7 * day;
  const month = 30 * day;
  const year = 365 * day;
  let n: number;
  let unit: string;
  if (abs < min) return 'just now';
  if (abs < hr) { n = Math.round(abs / min); unit = 'min'; }
  else if (abs < day) { n = Math.round(abs / hr); unit = 'hr'; }
  else if (abs < week) { n = Math.round(abs / day); unit = 'day'; }
  else if (abs < month) { n = Math.round(abs / week); unit = 'wk'; }
  else if (abs < year) { n = Math.round(abs / month); unit = 'mo'; }
  else { n = Math.round(abs / year); unit = 'yr'; }
  const label = `${n} ${unit}${n === 1 ? '' : 's'}`;
  return diff >= 0 ? `${label} ago` : `in ${label}`;
}

function absolute(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function isLiveBuild(job: JobSummary): boolean {
  return !job.dryRun && job.status === 'completed';
}

export function SnapshotTimeline({
  templateName,
  sourceGuildId,
  onClose,
}: {
  templateName: string;
  sourceGuildId: string;
  onClose: () => void;
}) {
  const [snapshots, setSnapshots] = useState<SnapshotSummary[] | null>(null);
  const [jobs, setJobs] = useState<JobSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Diff between each version and its prior, keyed by the NEWER snapshot's id.
  const [diffs, setDiffs] = useState<Map<string, SnapshotDiff>>(new Map());

  useEffect(() => {
    let alive = true;
    Promise.all([api.snapshots(), api.jobs()])
      .then(([snaps, js]) => {
        if (!alive) return;
        setSnapshots(snaps);
        setJobs(js);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setError(e instanceof Error ? e.message : 'Could not load history.');
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const line = useMemo(() => {
    if (!snapshots) return [];
    return snapshots
      .filter((s) => s.sourceGuildId === sourceGuildId)
      .sort((a, b) => b.version - a.version);
  }, [snapshots, sourceGuildId]);

  const buildsBySnapshot = useMemo(() => {
    const map = new Map<string, JobSummary[]>();
    if (!jobs) return map;
    for (const job of jobs) {
      if (!job.snapshotId) continue;
      if (!isLiveBuild(job) && !job.dryRun) continue;
      const arr = map.get(job.snapshotId) ?? [];
      arr.push(job);
      map.set(job.snapshotId, arr);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }
    return map;
  }, [jobs]);

  // After the version line resolves, fetch the diff for each adjacent pair
  // (older → newer). The list is sorted newest-first, so each version's prior
  // sits at the next index. Only a handful of versions, so sequential is fine.
  useEffect(() => {
    if (line.length < 2) return;
    let alive = true;
    const pairs: { newerId: string; olderId: string }[] = [];
    for (let i = 0; i < line.length - 1; i += 1) {
      pairs.push({ newerId: line[i].id, olderId: line[i + 1].id });
    }
    Promise.all(
      pairs.map((p) =>
        api
          .diff(p.newerId, p.olderId)
          .then((d) => [p.newerId, d] as const)
          .catch(() => null),
      ),
    ).then((results) => {
      if (!alive) return;
      const next = new Map<string, SnapshotDiff>();
      for (const r of results) {
        if (r) next.set(r[0], r[1]);
      }
      setDiffs(next);
    });
    return () => {
      alive = false;
    };
  }, [line]);

  const loading = snapshots === null || jobs === null;

  return (
    <div
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '1.5rem 1rem',
        overflowY: 'auto',
        background: 'rgba(8, 8, 14, 0.72)',
        backdropFilter: 'blur(3px)',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Version history for ${templateName}`}
        className="panel rise"
        style={{
          width: '100%',
          maxWidth: '42rem',
          maxHeight: 'calc(100vh - 3rem)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: '1rem',
            padding: '1.25rem 1.25rem 1rem',
            borderBottom: '1px solid var(--color-line)',
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div className="eyebrow">Provenance</div>
            <h2
              className="transform-text"
              style={{
                margin: '0.15rem 0 0',
                fontSize: '1.05rem',
                lineHeight: 1.2,
                overflowWrap: 'anywhere',
              }}
            >
              {templateName}
            </h2>
            <p className="label" style={{ margin: '0.3rem 0 0' }}>
              Version line · source <span className="mono">{sourceGuildId}</span>
            </p>
          </div>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onClose}
            aria-label="Close version history"
            style={{ flex: '0 0 auto', padding: '0.35rem 0.6rem' }}
          >
            Esc
          </button>
        </div>

        {/* Body */}
        <div style={{ overflowY: 'auto', padding: '1.25rem' }}>
          {error ? (
            <p className="label" style={{ color: 'var(--color-danger)' }}>
              {error}
            </p>
          ) : loading ? (
            <p className="label">Tracing the version line…</p>
          ) : line.length === 0 ? (
            <p className="label">
              No snapshots on this version line yet — capture one to start a history.
            </p>
          ) : line.length === 1 ? (
            <>
              <Spine line={line} buildsBySnapshot={buildsBySnapshot} diffs={diffs} />
              <p className="label" style={{ margin: '1rem 0 0', opacity: 0.85 }}>
                Just one version so far — re-snapshot to start a history.
              </p>
            </>
          ) : (
            <Spine line={line} buildsBySnapshot={buildsBySnapshot} diffs={diffs} />
          )}
        </div>
      </div>
    </div>
  );
}

function Spine({
  line,
  buildsBySnapshot,
  diffs,
}: {
  line: SnapshotSummary[];
  buildsBySnapshot: Map<string, JobSummary[]>;
  diffs: Map<string, SnapshotDiff>;
}) {
  return (
    <ol
      style={{
        listStyle: 'none',
        margin: 0,
        padding: 0,
        position: 'relative',
      }}
    >
      {/* Vertical spine: violet (newest, top) → rose (oldest, bottom) */}
      <span
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: '7px',
          top: '8px',
          bottom: '8px',
          width: '2px',
          borderRadius: '2px',
          background: 'linear-gradient(to bottom, var(--color-source), var(--color-client))',
          opacity: 0.55,
        }}
      />
      {line.map((s, i) => {
        const newest = i === 0;
        const oldest = i === line.length - 1;
        const builds = buildsBySnapshot.get(s.id) ?? [];
        const delta = diffs.get(s.id) ?? null;
        return (
          <li
            key={s.id}
            style={{
              position: 'relative',
              paddingLeft: '1.75rem',
              paddingBottom: i === line.length - 1 ? 0 : '1.4rem',
            }}
          >
            {/* Node */}
            <span
              aria-hidden="true"
              style={{
                position: 'absolute',
                left: 0,
                top: '4px',
                width: '16px',
                height: '16px',
                borderRadius: '50%',
                background: newest ? 'var(--color-source)' : 'var(--color-bg, #0c0c14)',
                border: `2px solid ${newest ? 'var(--color-source)' : 'var(--color-client)'}`,
                boxShadow: newest ? '0 0 0 4px color-mix(in srgb, var(--color-source) 22%, transparent)' : 'none',
              }}
            />

            <div
              className={newest ? 'panel-soft' : undefined}
              style={
                newest
                  ? {
                      padding: '0.75rem 0.85rem',
                      borderColor: 'color-mix(in srgb, var(--color-source) 45%, var(--color-line))',
                    }
                  : { padding: '0 0 0 0.1rem' }
              }
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  flexWrap: 'wrap',
                  gap: '0.5rem',
                }}
              >
                <span
                  className="mono transform-text"
                  style={{ fontSize: '0.95rem', fontWeight: 600 }}
                >
                  v{s.version}
                </span>
                {newest && <span className="chip chip-source">latest</span>}
                {s.favorite && <span className="chip chip-gold">★ pinned</span>}
                <span
                  className="label"
                  title={absolute(s.capturedAt)}
                  style={{ marginLeft: 'auto' }}
                >
                  {relative(s.capturedAt)} · {absolute(s.capturedAt)}
                </span>
              </div>

              {/* Counts */}
              <CountRow counts={s.counts} />

              {/* What changed vs the prior version */}
              <VersionDelta delta={delta} oldest={oldest} />

              {/* Builds that used this version */}
              {builds.length > 0 && (
                <ul style={{ listStyle: 'none', margin: '0.6rem 0 0', padding: 0, display: 'grid', gap: '0.3rem' }}>
                  {builds.map((b) => (
                    <li
                      key={b.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: '0.4rem',
                        fontSize: '0.8rem',
                      }}
                    >
                      <span
                        aria-hidden="true"
                        style={{
                          width: '5px',
                          height: '5px',
                          borderRadius: '50%',
                          flex: '0 0 auto',
                          background: b.dryRun ? 'var(--color-faint)' : 'var(--color-jade)',
                        }}
                      />
                      <span style={{ color: 'var(--color-muted)' }}>
                        built for{' '}
                        <span style={{ color: 'var(--color-bone)', fontWeight: 500 }}>
                          {b.clientName ?? 'unknown client'}
                        </span>{' '}
                        · {absolute(b.createdAt)}
                      </span>
                      {b.dryRun ? (
                        <span className="chip" style={{ fontSize: '0.65rem', padding: '0.05rem 0.4rem' }}>
                          dry-run
                        </span>
                      ) : (
                        <span className="chip chip-jade" style={{ fontSize: '0.65rem', padding: '0.05rem 0.4rem' }}>
                          live
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {builds.length === 0 && (
                <p className="label" style={{ margin: '0.5rem 0 0', opacity: 0.7 }}>
                  No builds off this version yet.
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function pluralChannels(n: number): string {
  return `${n} channel${n === 1 ? '' : 's'}`;
}

function pluralRoles(n: number): string {
  return `${n} role${n === 1 ? '' : 's'}`;
}

function categoryTotal(c: CategoryDiff): number {
  return c.added.length + c.removed.length + c.changed.length;
}

// A small +added / −removed pill pair, reusing the diff jade/danger vocabulary.
function DeltaPill({ added, removed, noun }: { added: number; removed: number; noun: string }) {
  if (added === 0 && removed === 0) return null;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: '0.3rem', fontSize: '0.72rem' }}>
      {added > 0 && (
        <span className="mono" style={{ color: 'var(--color-jade)' }}>
          +{noun === 'channels' ? pluralChannels(added) : `${added} ${noun}`}
        </span>
      )}
      {removed > 0 && (
        <span className="mono" style={{ color: 'var(--color-danger)' }}>
          −{noun === 'channels' ? pluralChannels(removed) : `${removed} ${noun}`}
        </span>
      )}
    </span>
  );
}

// Decoded permission delta for a single role: "+ Send Messages / − Mention Everyone".
function PermLine({ added, removed }: { added: string[]; removed: string[] }) {
  if (added.length === 0 && removed.length === 0) return null;
  return (
    <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: '0.25rem 0.45rem', fontSize: '0.68rem' }}>
      {added.map((p) => (
        <span key={`a-${p}`} className="mono" style={{ color: 'var(--color-jade)' }}>
          + {p}
        </span>
      ))}
      {removed.map((p) => (
        <span key={`r-${p}`} className="mono" style={{ color: 'var(--color-danger)' }}>
          − {p}
        </span>
      ))}
    </span>
  );
}

// Name chips for added / removed items in a category (jade = added, danger = removed).
function NameChips({ names, tone }: { names: string[]; tone: 'jade' | 'danger' }) {
  if (names.length === 0) return null;
  const color = tone === 'jade' ? 'var(--color-jade)' : 'var(--color-danger)';
  const sign = tone === 'jade' ? '+' : '−';
  return (
    <>
      {names.map((n) => (
        <span
          key={`${tone}-${n}`}
          className="chip mono"
          style={{
            fontSize: '0.65rem',
            padding: '0.05rem 0.4rem',
            color,
            borderColor: `color-mix(in srgb, ${color} 40%, var(--color-line))`,
          }}
        >
          {sign} {n}
        </span>
      ))}
    </>
  );
}

function VersionDelta({ delta, oldest }: { delta: SnapshotDiff | null; oldest: boolean }) {
  const [open, setOpen] = useState(false);

  if (oldest) {
    return (
      <p className="label" style={{ margin: '0.5rem 0 0', opacity: 0.7, fontStyle: 'italic' }}>
        initial capture · no prior version
      </p>
    );
  }
  if (!delta) {
    return (
      <p className="label" style={{ margin: '0.5rem 0 0', opacity: 0.6 }}>
        Comparing to prior version…
      </p>
    );
  }

  const channelAdded = delta.channels.added.length;
  const channelRemoved = delta.channels.removed.length;
  const roleChanges = categoryTotal(delta.roles);
  const overwriteCount = delta.overwriteChanges.length;
  const changedRoles = delta.roles.changed.filter(
    (r) => r.permissionDelta && (r.permissionDelta.added.length > 0 || r.permissionDelta.removed.length > 0),
  );

  const nothing =
    channelAdded === 0 &&
    channelRemoved === 0 &&
    roleChanges === 0 &&
    overwriteCount === 0 &&
    delta.channels.changed.length === 0 &&
    delta.guildNameChanged === null;

  if (nothing) {
    return (
      <p className="label" style={{ margin: '0.5rem 0 0', opacity: 0.7 }}>
        No structural changes from prior version.
      </p>
    );
  }

  const hasDetail =
    delta.channels.added.length > 0 ||
    delta.channels.removed.length > 0 ||
    changedRoles.length > 0 ||
    delta.guildNameChanged !== null;

  return (
    <div style={{ margin: '0.55rem 0 0' }}>
      {/* Summary row */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: '0.3rem 0.65rem',
        }}
      >
        <span className="eyebrow" style={{ opacity: 0.75 }}>
          vs prior
        </span>
        <DeltaPill added={channelAdded} removed={channelRemoved} noun="channels" />
        {roleChanges > 0 && (
          <span className="mono" style={{ fontSize: '0.72rem', color: 'var(--color-source)' }}>
            {pluralRoles(roleChanges)} changed
          </span>
        )}
        {overwriteCount > 0 && (
          <span className="mono" style={{ fontSize: '0.72rem', color: 'var(--color-muted)' }}>
            {overwriteCount} overwrite{overwriteCount === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {hasDetail && (
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          style={{ marginTop: '0.4rem', padding: '0.2rem 0.5rem', fontSize: '0.72rem' }}
        >
          {open ? 'Hide changes' : 'Show changes'}
        </button>
      )}

      {open && hasDetail && (
        <div
          style={{
            marginTop: '0.5rem',
            display: 'grid',
            gap: '0.5rem',
            paddingLeft: '0.6rem',
            borderLeft: '2px solid var(--color-line)',
          }}
        >
          {delta.guildNameChanged && (
            <div style={{ fontSize: '0.72rem' }}>
              <span className="label" style={{ marginRight: '0.4rem' }}>
                name
              </span>
              <span className="mono" style={{ color: 'var(--color-danger)' }}>
                − {delta.guildNameChanged.before}
              </span>{' '}
              <span className="mono" style={{ color: 'var(--color-jade)' }}>
                + {delta.guildNameChanged.after}
              </span>
            </div>
          )}

          {(delta.channels.added.length > 0 || delta.channels.removed.length > 0) && (
            <div>
              <div className="label" style={{ marginBottom: '0.3rem' }}>
                channels
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
                <NameChips names={delta.channels.added} tone="jade" />
                <NameChips names={delta.channels.removed} tone="danger" />
              </div>
            </div>
          )}

          {changedRoles.length > 0 && (
            <div>
              <div className="label" style={{ marginBottom: '0.3rem' }}>
                role permissions
              </div>
              <div style={{ display: 'grid', gap: '0.3rem' }}>
                {changedRoles.map((r) => (
                  <div key={r.name} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '0.4rem' }}>
                    <span className="mono" style={{ fontSize: '0.72rem', color: 'var(--color-bone)' }}>
                      {r.name}
                    </span>
                    <PermLine
                      added={r.permissionDelta?.added ?? []}
                      removed={r.permissionDelta?.removed ?? []}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CountRow({ counts }: { counts: Record<string, number> }) {
  const entries = Object.entries(counts).filter(([, v]) => v > 0);
  if (entries.length === 0) return null;
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '0.3rem 0.65rem',
        margin: '0.45rem 0 0',
      }}
    >
      {entries.map(([k, v]) => (
        <span key={k} className="label" style={{ fontSize: '0.72rem' }}>
          <span className="mono" style={{ color: 'var(--color-bone)' }}>{v}</span>{' '}
          <span style={{ color: 'var(--color-faint)' }}>{k}</span>
        </span>
      ))}
    </div>
  );
}
