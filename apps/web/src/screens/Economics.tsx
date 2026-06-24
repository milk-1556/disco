import { useMemo, useState } from 'react';
import { api, type Client, type JobSummary } from '../api.js';
import { SkeletonRows } from '../components/Skeleton.js';
import { usePoll } from '../usePoll.js';

const fmtMs = (ms: number) => (ms < 1000 ? `${Math.round(ms)}ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)}s` : `${(ms / 60000).toFixed(1)}m`);
const fmt$ = (n: number) => `$${Math.round(n).toLocaleString()}`;

/**
 * Real unit economics: one-time build fees + recurring management (MRR) + upsells, by client, with a
 * "won vs pipeline" split (a client is won once they have a delivered live build). Compute cost is
 * pennies — surfaced so the operator can see how far one retainer covers it.
 */
export function Economics() {
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [infra, setInfra] = useState(40); // $/mo infra (postgres + redis + host)
  const [loading, setLoading] = useState(true);

  usePoll(() => {
    Promise.allSettled([
      api.jobs().then(setJobs),
      api.clients().then(setClients),
    ]).finally(() => setLoading(false));
  }, 4000);

  const m = useMemo(() => {
    const dealOnce = (c: Client) => c.buildPrice + c.upsells.reduce((a, u) => a + u.price, 0);
    // A client is "won" once they have at least one delivered (completed, non-dry-run) build.
    const wonIds = new Set(jobs.filter((j) => j.status === 'completed' && !j.dryRun && j.clientId).map((j) => j.clientId as string));
    const won = clients.filter((c) => wonIds.has(c.id));
    const pipeline = clients.filter((c) => !wonIds.has(c.id) && (dealOnce(c) > 0 || c.monthlyRetainer > 0));

    const oneTime = won.reduce((a, c) => a + dealOnce(c), 0);
    const mrr = won.reduce((a, c) => a + c.monthlyRetainer, 0);
    const upsellRev = won.reduce((a, c) => a + c.upsells.reduce((s, u) => s + u.price, 0), 0);
    const avgBuild = won.length ? won.reduce((a, c) => a + c.buildPrice, 0) / won.length : 0; // build fee only, excl. upsells
    const pipeOnce = pipeline.reduce((a, c) => a + dealOnce(c), 0);
    const pipeMrr = pipeline.reduce((a, c) => a + c.monthlyRetainer, 0);

    const builds = jobs.filter((j) => j.status === 'completed' && !j.dryRun && j.metrics);
    const totalMs = builds.reduce((a, b) => a + (b.metrics?.durationMs ?? 0), 0);
    const computeCost = infra + (totalMs / 3_600_000) * 0.5; // ~$0.50/compute-hour over native infra
    return { won, pipeline, oneTime, mrr, arr: mrr * 12, upsellRev, avgBuild, pipeOnce, pipeMrr, computeCost, builds, totalMs, dealOnce };
  }, [jobs, clients, infra]);

  const rows = [...m.won.map((c) => ({ c, won: true })), ...m.pipeline.map((c) => ({ c, won: false }))];

  return (
    <div className="px-4 py-6 md:p-8 max-w-5xl rise">
      <header className="mb-6">
        <div className="eyebrow mb-2">economics</div>
        <h1 className="text-2xl">What your book of business <span className="transform-text">is worth</span></h1>
        <p className="text-sm mt-2" style={{ color: 'var(--color-muted)' }}>
          One-time builds, recurring management, and upsells — by client. Compute is pennies; the deal is the product.
        </p>
      </header>

      <div className="grid gap-3 mb-6" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px,1fr))' }}>
        <Stat n={fmt$(m.oneTime)} label="one-time booked" tone="jade" />
        <Stat n={`${fmt$(m.mrr)}/mo`} label="recurring (MRR)" tone="jade" />
        <Stat n={fmt$(m.arr)} label="annual recurring" tone="bone" />
        <Stat n={m.won.length ? fmt$(m.avgBuild) : '—'} label="avg build price" tone="bone" />
        <Stat n={`${fmt$(m.pipeOnce)} + ${fmt$(m.pipeMrr)}/mo`} label={`pipeline · ${m.pipeline.length} lead${m.pipeline.length === 1 ? '' : 's'}`} tone="gold" />
        <Stat n={`${fmt$(m.computeCost)}/mo`} label="compute cost" tone="muted" />
      </div>

      <div className="panel p-5 mb-6">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <div className="eyebrow">the math</div>
          <label className="flex items-center gap-2 text-sm">
            <span className="label">infra $/mo</span>
            <input className="input mono" style={{ width: 90 }} type="number" min="0" value={infra} onChange={(e) => setInfra(Number(e.target.value) || 0)} />
          </label>
        </div>
        <div className="panel-soft p-4 text-sm leading-relaxed">
          You’ve booked <span className="mono" style={{ color: 'var(--color-jade)' }}>{fmt$(m.oneTime)}</span> one-time across{' '}
          <span className="mono">{m.won.length}</span> client{m.won.length === 1 ? '' : 's'}
          {m.upsellRev > 0 && <> (incl. <span className="mono">{fmt$(m.upsellRev)}</span> upsells)</>}, plus{' '}
          <span className="mono" style={{ color: 'var(--color-jade)' }}>{fmt$(m.mrr)}/mo</span> recurring —{' '}
          <span className="mono">{fmt$(m.arr)}</span>/yr. Compute runs{' '}
          <span className="mono" style={{ color: 'var(--color-gold)' }}>{fmt$(m.computeCost)}/mo</span>
          {m.mrr > 0 && m.computeCost > 0 && <>, so recurring alone covers it <span className="mono">{Math.floor(m.mrr / m.computeCost)}×</span> over</>}.
        </div>
      </div>

      {loading ? (
        <div className="panel p-5 mb-6">
          <div className="eyebrow mb-3">deals by client</div>
          <SkeletonRows count={3} h={44} />
        </div>
      ) : rows.length > 0 ? (
        <div className="panel p-5 mb-6">
          <div className="flex items-baseline justify-between gap-3 flex-wrap mb-3">
            <div className="eyebrow">deals by client</div>
            <span className="label">
              {m.won.length} closed won · {m.pipeline.length} in pipeline
            </span>
          </div>
          <div className="space-y-1.5">
            {rows.map(({ c, won }) => {
              const once = m.dealOnce(c);
              return (
                <div key={c.id} className="panel-soft px-3 py-2.5 flex items-center gap-2.5 flex-wrap text-sm">
                  <span
                    className={won ? 'chip chip-jade' : 'chip chip-gold'}
                    style={{ minWidth: 88, justifyContent: 'center' }}
                  >
                    {won ? 'Closed won' : 'Pipeline'}
                  </span>
                  <span className="font-medium">{c.creatorName}</span>
                  {c.upsells.length > 0 && (
                    <span className="text-[0.7rem]" style={{ color: 'var(--color-faint)' }}>
                      +{c.upsells.length} upsell{c.upsells.length === 1 ? '' : 's'}
                    </span>
                  )}
                  <span className="mono ml-auto" style={{ color: once > 0 ? 'var(--color-bone)' : 'var(--color-faint)' }}>
                    {once > 0 ? fmt$(once) : '—'}
                  </span>
                  <span className="mono" style={{ color: c.monthlyRetainer > 0 ? 'var(--color-muted)' : 'var(--color-faint)', minWidth: 92, textAlign: 'right' }}>
                    {c.monthlyRetainer > 0 ? `${fmt$(c.monthlyRetainer)}/mo` : 'no retainer'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="panel p-10 text-center mb-6">
          <div className="eyebrow mb-2" style={{ color: 'var(--color-gold)' }}>nothing booked yet</div>
          <h2 className="text-lg">No priced clients yet</h2>
          <p className="text-sm mt-2 mx-auto" style={{ color: 'var(--color-muted)', maxWidth: 360 }}>
            Add a client with a build price and monthly management fee, and your pipeline and closed-won
            numbers land here automatically.
          </p>
        </div>
      )}

      {m.builds.length > 0 && (
        <div className="panel p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="eyebrow">compute, per build</div>
            <span className="label">{m.builds.length} delivered · {fmtMs(m.totalMs / m.builds.length)} avg</span>
          </div>
          <div className="space-y-1.5">
            {m.builds.slice(0, 8).map((b) => (
              <div key={b.id} className="panel-soft px-3 py-2 flex items-center gap-3 text-[0.8rem]">
                <span className="mono" style={{ color: 'var(--color-faint)' }}>{fmtMs(b.metrics!.durationMs)}</span>
                <span className="mono" style={{ color: 'var(--color-source)' }}>{b.metrics!.apiCalls} API calls</span>
                <span className="mono ml-auto" style={{ color: 'var(--color-jade)' }}>{b.metrics!.objectsCreated} objects</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ n, label, tone }: { n: string; label: string; tone: 'bone' | 'jade' | 'gold' | 'muted' }) {
  const color = tone === 'jade' ? 'var(--color-jade)' : tone === 'gold' ? 'var(--color-gold)' : tone === 'muted' ? 'var(--color-muted)' : 'var(--color-bone)';
  return (
    <div className="panel-soft px-3 py-3">
      <div className="leading-none" style={{ fontFamily: 'var(--font-display)', color, fontSize: 'clamp(1rem, 2.2vw, 1.3rem)' }}>{n}</div>
      <div className="text-[0.62rem] mono mt-1.5" style={{ color: 'var(--color-faint)' }}>{label}</div>
    </div>
  );
}
