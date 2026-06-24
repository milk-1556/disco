import { useEffect, useMemo, useState } from 'react';
import { api, type Client, type JobSummary, type SnapshotSummary } from '../api.js';
import type { View } from '../components/Shell.js';

const fmt$ = (n: number) => `$${Math.round(n).toLocaleString()}`;
const daysSince = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
const STALE_DAYS = 30;

/**
 * The operator's home: what needs attention right now. Pulls from existing endpoints (jobs/clients/
 * snapshots) and buckets the work — builds running, deliveries ready, deals to close, intake to
 * finish, templates due for a refresh — plus the quick actions to start the next one.
 */
export function Today({ go, onOpenHandover }: { go: (v: View) => void; onOpenHandover: (jobId: string) => void }) {
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [snaps, setSnaps] = useState<SnapshotSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const tick = () =>
      Promise.allSettled([api.jobs().then(setJobs), api.clients().then(setClients), api.snapshots().then(setSnaps)]).finally(() => setLoading(false));
    tick();
    const h = setInterval(tick, 4000);
    return () => clearInterval(h);
  }, []);

  const b = useMemo(() => {
    const inProgress = jobs.filter((j) => j.status === 'running' || j.status === 'queued');
    const readyToShare = jobs.filter((j) => j.status === 'completed' && !j.dryRun);
    const wonIds = new Set(readyToShare.map((j) => j.clientId).filter(Boolean));
    const dealValue = (c: Client) => c.buildPrice + c.upsells.reduce((a, u) => a + u.price, 0);
    const pipeline = clients
      .filter((c) => !wonIds.has(c.id) && (dealValue(c) > 0 || c.monthlyRetainer > 0))
      .sort((x, y) => dealValue(y) + y.monthlyRetainer * 12 - (dealValue(x) + x.monthlyRetainer * 12));
    const intake = clients.filter((c) => dealValue(c) === 0 && c.monthlyRetainer === 0);
    const stale = snaps.filter((s) => daysSince(s.capturedAt) >= STALE_DAYS).sort((x, y) => daysSince(y.capturedAt) - daysSince(x.capturedAt));
    const pipelineValue = pipeline.reduce((a, c) => a + dealValue(c), 0);
    return { inProgress, readyToShare, pipeline, intake, stale, pipelineValue };
  }, [jobs, clients, snaps]);

  const nothingPending = !b.inProgress.length && !b.readyToShare.length && !b.pipeline.length && !b.intake.length && !b.stale.length;

  return (
    <div className="px-4 py-6 md:p-8 max-w-5xl rise">
      <header className="mb-6">
        <div className="eyebrow mb-2">today</div>
        <h1 className="text-2xl">
          What needs you <span className="transform-text">right now</span>
        </h1>
        <p className="text-sm mt-2" style={{ color: 'var(--color-muted)' }}>
          Your assembly line at a glance — builds in flight, deliveries ready, and deals to close.
        </p>
      </header>

      {/* quick actions */}
      <div className="flex flex-wrap gap-2 mb-6">
        <button className="btn btn-primary" onClick={() => go('clients')}>＋ New client</button>
        <button className="btn" onClick={() => go('library')}>＋ Snapshot a server</button>
        <button className="btn" onClick={() => go('economics')}>Review pipeline →</button>
      </div>

      {loading ? (
        <div className="panel p-6 flex items-center gap-2" style={{ color: 'var(--color-muted)' }}>
          <span className="live-dot" /> <span className="text-sm">Pulling today’s work together…</span>
        </div>
      ) : nothingPending ? (
        <div className="panel p-10 text-center">
          <div className="eyebrow mb-2" style={{ color: 'var(--color-jade)' }}>all caught up</div>
          <h2 className="text-lg">Nothing waiting on you</h2>
          <p className="text-sm mt-2 mx-auto" style={{ color: 'var(--color-muted)', maxWidth: 380 }}>
            No builds in flight, no deliveries pending, no open deals. Snapshot a server or add a client to start the next build.
          </p>
        </div>
      ) : (
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
          {/* builds in progress */}
          <Card title="builds in progress" count={b.inProgress.length} tone="source">
            {b.inProgress.length === 0 ? (
              <Empty>No builds running right now.</Empty>
            ) : (
              b.inProgress.map((j) => (
                <Row key={j.id} onClick={() => go('queue')}>
                  <span className="truncate">{j.snapshotName ?? 'build'} <span style={{ color: 'var(--color-faint)' }}>→</span> <span style={{ color: 'var(--color-client)' }}>{j.clientName ?? 'unbranded'}</span></span>
                  <span className="mono ml-auto shrink-0" style={{ color: 'var(--color-source)' }}>{j.status === 'queued' ? 'queued' : `${Math.round(j.progress * 100)}%`}</span>
                </Row>
              ))
            )}
          </Card>

          {/* deliveries ready to share */}
          <Card title="ready to hand over" count={b.readyToShare.length} tone="jade">
            {b.readyToShare.length === 0 ? (
              <Empty>No finished builds waiting to deliver.</Empty>
            ) : (
              b.readyToShare.slice(0, 5).map((j) => (
                <Row key={j.id} onClick={() => onOpenHandover(j.id)}>
                  <span className="truncate"><span style={{ color: 'var(--color-client)' }}>{j.clientName ?? 'unbranded'}</span> — {j.snapshotName ?? 'build'}</span>
                  <span className="mono ml-auto shrink-0" style={{ color: 'var(--color-jade)' }}>Share →</span>
                </Row>
              ))
            )}
          </Card>

          {/* pipeline — close these */}
          <Card title={`pipeline · ${fmt$(b.pipelineValue)} open`} count={b.pipeline.length} tone="gold">
            {b.pipeline.length === 0 ? (
              <Empty>No open deals. Add a quoted client to build a pipeline.</Empty>
            ) : (
              b.pipeline.slice(0, 5).map((c) => (
                <Row key={c.id} onClick={() => go('economics')}>
                  <span className="truncate">{c.creatorName}</span>
                  <span className="mono ml-auto shrink-0" style={{ color: 'var(--color-bone)' }}>
                    {c.buildPrice > 0 ? fmt$(c.buildPrice) : '—'}
                    {c.monthlyRetainer > 0 && <span style={{ color: 'var(--color-faint)' }}> +{fmt$(c.monthlyRetainer)}/mo</span>}
                  </span>
                </Row>
              ))
            )}
          </Card>

          {/* clients waiting on intake */}
          {b.intake.length > 0 && (
            <Card title="waiting on intake" count={b.intake.length} tone="muted">
              {b.intake.slice(0, 5).map((c) => (
                <Row key={c.id} onClick={() => go('clients')}>
                  <span className="truncate">{c.creatorName}</span>
                  <span className="mono ml-auto shrink-0" style={{ color: 'var(--color-faint)' }}>price the deal →</span>
                </Row>
              ))}
            </Card>
          )}

          {/* snapshots due for refresh */}
          <Card title="templates due for refresh" count={b.stale.length} tone="muted">
            {b.stale.length === 0 ? (
              <Empty>Every template is fresh (re-snapshotted within {STALE_DAYS} days).</Empty>
            ) : (
              b.stale.slice(0, 5).map((s) => (
                <Row key={s.id} onClick={() => go('library')}>
                  <span className="truncate">{s.name}</span>
                  <span className="mono ml-auto shrink-0" style={{ color: 'var(--color-gold)' }}>{daysSince(s.capturedAt)}d old</span>
                </Row>
              ))
            )}
          </Card>
        </div>
      )}
    </div>
  );
}

function Card({ title, count, tone, children }: { title: string; count: number; tone: 'source' | 'jade' | 'gold' | 'muted'; children: React.ReactNode }) {
  const color = tone === 'jade' ? 'var(--color-jade)' : tone === 'gold' ? 'var(--color-gold)' : tone === 'source' ? 'var(--color-source)' : 'var(--color-faint)';
  return (
    <section className="panel p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="eyebrow">{title}</div>
        <span className="mono text-sm" style={{ color }}>{count}</span>
      </div>
      <div className="space-y-1.5">{children}</div>
    </section>
  );
}

function Row({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className="panel-soft px-3 py-2 flex items-center gap-2 text-sm w-full text-left transition" style={{ cursor: 'pointer' }}>
      {children}
    </button>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="text-[0.8rem] px-1 py-1" style={{ color: 'var(--color-faint)' }}>{children}</div>;
}
