import { useMemo, useState } from 'react';
import { api, type Client, type DashboardStats, type JobSummary, type SnapshotSummary } from '../api.js';
import type { View } from '../components/Shell.js';
import { SkeletonCard } from '../components/Skeleton.js';
import { usePoll } from '../usePoll.js';

const fmt$ = (n: number) => `$${Math.round(n).toLocaleString()}`;
const daysSince = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
const fmtDuration = (ms: number) => (ms < 1000 ? `${ms}ms` : ms < 60_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms / 60_000)}m`);
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
  const [dash, setDash] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  usePoll(
    () =>
      void Promise.allSettled([
        api.jobs().then(setJobs),
        api.clients().then(setClients),
        api.snapshots().then(setSnaps),
        api.dashboard().then(setDash),
      ])
        // If EVERY fetch failed (e.g. an expired session, a transient API error), don't fall through to
        // the "all caught up" empty state — that would falsely tell the operator nothing needs them.
        .then((results) => setLoadError(results.every((r) => r.status === 'rejected')))
        .finally(() => setLoading(false)),
    4000,
  );

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

      {/* money at a glance — the operator's #1 daily signal (outstanding is the actionable one) */}
      {dash && (dash.money.invoicedCents > 0 || dash.money.mrrCents > 0) && (
        <div className="grid gap-3 mb-6" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
          <Widget
            label="outstanding"
            value={fmt$(dash.money.outstandingCents / 100)}
            hint="invoiced − paid"
            tone={dash.money.outstandingCents > 0 ? 'gold' : 'muted'}
            onClick={dash.money.outstandingCents > 0 ? () => go('economics') : undefined}
          />
          <Widget label="paid to date" value={fmt$(dash.money.paidCents / 100)} tone="jade" />
          <Widget label="recurring" value={`${fmt$(dash.money.mrrCents / 100)}/mo`} hint="MRR from retainers" tone={dash.money.mrrCents > 0 ? 'jade' : 'muted'} />
        </div>
      )}

      {/* daily recap (#4) — what you shipped today, read-only */}
      {dash && (dash.today.builds + dash.today.delivered + dash.today.snapshots + dash.today.clientOpens > 0) && (
        <div className="panel-soft p-3 mb-4 flex items-center gap-2 flex-wrap text-sm">
          <span className="label">today</span>
          <span style={{ color: 'var(--color-muted)' }}>
            {[
              dash.today.builds > 0 ? `ran ${dash.today.builds} build${dash.today.builds === 1 ? '' : 's'}` : null,
              dash.today.delivered > 0 ? `delivered ${dash.today.delivered} handover${dash.today.delivered === 1 ? '' : 's'}` : null,
              dash.today.snapshots > 0 ? `added ${dash.today.snapshots} template${dash.today.snapshots === 1 ? '' : 's'}` : null,
              dash.today.clientOpens > 0 ? `${dash.today.clientOpens} client open${dash.today.clientOpens === 1 ? '' : 's'}` : null,
            ].filter(Boolean).join(' · ') || 'nothing shipped yet'}
            .
          </span>
        </div>
      )}

      {/* build-duration SLO watcher (#5) — flag builds that ran >2× the rolling average */}
      {dash && dash.slowBuilds > 0 && (
        <div className="panel-soft p-3 mb-4 flex items-center gap-3 flex-wrap" style={{ borderColor: 'color-mix(in srgb, var(--color-gold) 45%, transparent)' }}>
          <span className="chip chip-gold">⚠ SLO</span>
          <span className="text-sm" style={{ color: 'var(--color-bone)' }}>
            {dash.slowBuilds} build{dash.slowBuilds === 1 ? '' : 's'} ran past the {fmtDuration(dash.sloMs)} duration budget (slowest {fmtDuration(dash.slowestBuildMs)}).
          </span>
          <button className="btn btn-ghost text-xs ml-auto" onClick={() => go('queue')}>Review in Queue →</button>
        </div>
      )}

      {/* operator productivity widgets (#6) — read-only rollups over your own work */}
      {dash && (
        <div className="grid gap-3 mb-6" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
          <Widget label="builds this week" value={String(dash.buildsThisWeek)} />
          <Widget label="avg build time" value={dash.avgBuildMs ? fmtDuration(dash.avgBuildMs) : '—'} />
          <Widget
            label="stuck handovers"
            value={String(dash.stuckHandovers)}
            hint=">72h, unopened"
            tone={dash.stuckHandovers > 0 ? 'gold' : 'muted'}
            onClick={dash.stuckHandovers > 0 ? () => go('queue') : undefined}
          />
          <Widget label="client retention" value={`${dash.clientRetentionRate}%`} hint={`${dash.retainedClients}/${dash.totalClients} on retainer`} tone="jade" />
        </div>
      )}

      {loadError && !dash ? (
        <div className="panel p-8 text-center">
          <div className="eyebrow mb-2" style={{ color: 'var(--color-gold)' }}>couldn't load</div>
          <h2 className="text-lg">Your dashboard didn't load</h2>
          <p className="text-sm mt-2 mx-auto" style={{ color: 'var(--color-muted)', maxWidth: 360 }}>
            The connection dropped or your session expired. It retries automatically every few seconds — or reload the page.
          </p>
          <button className="btn btn-ghost text-sm mt-4" onClick={() => location.reload()}>Reload</button>
        </div>
      ) : loading ? (
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
          <SkeletonCard lines={3} />
          <SkeletonCard lines={2} />
          <SkeletonCard lines={3} />
          <SkeletonCard lines={2} />
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

const TONE: Record<'jade' | 'gold' | 'muted', string> = { jade: 'var(--color-jade)', gold: 'var(--color-gold)', muted: 'var(--color-bone)' };
function Widget({ label, value, hint, tone = 'muted', onClick }: { label: string; value: string; hint?: string; tone?: 'jade' | 'gold' | 'muted'; onClick?: () => void }) {
  return (
    <button
      type="button"
      className="panel-soft p-4 text-left"
      onClick={onClick}
      disabled={!onClick}
      style={{ cursor: onClick ? 'pointer' : 'default', borderColor: tone === 'gold' ? 'color-mix(in srgb, var(--color-gold) 40%, transparent)' : undefined }}
    >
      <div className="text-2xl leading-none" style={{ fontFamily: 'var(--font-display)', color: TONE[tone] }}>{value}</div>
      <div className="label mt-2">{label}</div>
      {hint && <div className="text-[0.66rem] mono mt-1" style={{ color: 'var(--color-faint)' }}>{hint}</div>}
    </button>
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
