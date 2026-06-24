import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import type { JobSummary, SnapshotSummary } from '../api.js';

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
              <Spine line={line} buildsBySnapshot={buildsBySnapshot} />
              <p className="label" style={{ margin: '1rem 0 0', opacity: 0.85 }}>
                Just one version so far — re-snapshot to start a history.
              </p>
            </>
          ) : (
            <Spine line={line} buildsBySnapshot={buildsBySnapshot} />
          )}
        </div>
      </div>
    </div>
  );
}

function Spine({
  line,
  buildsBySnapshot,
}: {
  line: SnapshotSummary[];
  buildsBySnapshot: Map<string, JobSummary[]>;
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
        const builds = buildsBySnapshot.get(s.id) ?? [];
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
