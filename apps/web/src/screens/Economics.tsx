import { useEffect, useMemo, useState } from 'react';
import { api, type JobSummary } from '../api.js';
import { shortId } from '../util.js';

const fmtMs = (ms: number) => (ms < 1000 ? `${Math.round(ms)}ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)}s` : `${(ms / 60000).toFixed(1)}m`);
const fmt$ = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const monthKey = (iso: string) => iso.slice(0, 7);

/**
 * Unit economics (#2): per-build wall-clock + Discord API calls, aggregated by month, against the
 * operator's price + infra cost → margin. So Max can see "20 builds → $X compute → $30k revenue → 99%".
 */
export function Economics() {
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [price, setPrice] = useState(30000);
  const [infra, setInfra] = useState(40); // $/mo infra (postgres+redis+host)

  useEffect(() => {
    const tick = () => api.jobs().then(setJobs).catch(() => {});
    tick();
    const h = setInterval(tick, 4000);
    return () => clearInterval(h);
  }, []);

  // Only real (non-dry-run) completed builds with metrics count as revenue-bearing deliveries.
  const builds = useMemo(() => jobs.filter((j) => j.status === 'completed' && !j.dryRun && j.metrics), [jobs]);
  const thisMonth = new Date().toISOString().slice(0, 7);
  const monthBuilds = builds.filter((b) => monthKey(b.createdAt) === thisMonth);

  const totalMs = monthBuilds.reduce((a, b) => a + (b.metrics?.durationMs ?? 0), 0);
  const totalCalls = monthBuilds.reduce((a, b) => a + (b.metrics?.apiCalls ?? 0), 0);
  const n = monthBuilds.length;
  // compute cost: amortized infra over the month's builds + a token per-second rate.
  const computeCost = infra + (totalMs / 3_600_000) * 0.5; // ~$0.50/compute-hour
  const revenue = n * price;
  const margin = revenue > 0 ? ((revenue - computeCost) / revenue) * 100 : 0;

  const byMonth = useMemo(() => {
    const m = new Map<string, { n: number; ms: number }>();
    for (const b of builds) {
      const k = monthKey(b.createdAt);
      const cur = m.get(k) ?? { n: 0, ms: 0 };
      cur.n += 1;
      cur.ms += b.metrics?.durationMs ?? 0;
      m.set(k, cur);
    }
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 6);
  }, [builds]);

  return (
    <div className="px-4 py-6 md:p-8 max-w-4xl rise">
      <header className="mb-6">
        <div className="eyebrow mb-2">unit economics</div>
        <h1 className="text-2xl">What a build <span className="transform-text">actually costs</span></h1>
        <p className="text-sm mt-2" style={{ color: 'var(--color-muted)' }}>
          Live cost per build vs. what you charge. Compute is pennies — the margin is the whole point.
        </p>
      </header>

      <div className="grid gap-4 mb-6" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px,1fr))' }}>
        <Stat n={String(n)} label="builds this month" tone="bone" />
        <Stat n={n ? fmtMs(totalMs / n) : '—'} label="avg build time" tone="bone" />
        <Stat n={totalCalls.toLocaleString()} label="Discord API calls" tone="muted" />
        <Stat n={fmt$(computeCost)} label="compute cost / mo" tone="gold" />
        <Stat n={`${margin.toFixed(1)}%`} label="gross margin" tone="jade" />
      </div>

      <div className="panel p-5 mb-6">
        <div className="eyebrow mb-3">your numbers</div>
        <div className="flex flex-wrap gap-4">
          <label className="flex flex-col gap-1">
            <span className="label">Avg price / build</span>
            <input className="input mono" style={{ width: 140 }} type="number" value={price} onChange={(e) => setPrice(Number(e.target.value) || 0)} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="label">Monthly infra ($)</span>
            <input className="input mono" style={{ width: 140 }} type="number" value={infra} onChange={(e) => setInfra(Number(e.target.value) || 0)} />
          </label>
          <div className="flex-1 min-w-[200px] panel-soft p-3 self-end">
            <div className="text-sm">
              <span style={{ color: 'var(--color-muted)' }}>This month: </span>
              <span className="mono">{fmt$(revenue)}</span> revenue −{' '}
              <span className="mono" style={{ color: 'var(--color-gold)' }}>{fmt$(computeCost)}</span> cost ={' '}
              <span className="mono" style={{ color: 'var(--color-jade)' }}>{fmt$(revenue - computeCost)}</span> profit
            </div>
          </div>
        </div>
      </div>

      {byMonth.length > 0 && (
        <div className="panel p-5 mb-6">
          <div className="eyebrow mb-3">by month</div>
          <div className="space-y-1.5">
            {byMonth.map(([k, v]) => (
              <div key={k} className="panel-soft px-3 py-2 flex items-center gap-3 text-sm">
                <span className="mono" style={{ minWidth: 70 }}>{k}</span>
                <span style={{ color: 'var(--color-muted)' }}>{v.n} build{v.n === 1 ? '' : 's'}</span>
                <span className="mono ml-auto" style={{ color: 'var(--color-faint)' }}>{fmtMs(v.ms)} total · {fmtMs(v.ms / v.n)} avg</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {builds.length === 0 && (
        <div className="panel p-8 text-center" style={{ color: 'var(--color-muted)' }}>
          No real builds yet. Run a live (non-dry-run) build to start tracking economics.
        </div>
      )}

      {monthBuilds.length > 0 && (
        <div className="panel p-5">
          <div className="eyebrow mb-3">recent builds</div>
          <div className="space-y-1.5">
            {monthBuilds.slice(0, 12).map((b) => (
              <div key={b.id} className="panel-soft px-3 py-2 flex items-center gap-3 text-[0.8rem]">
                <span className="mono">{shortId(b.id)}</span>
                <span className="mono" style={{ color: 'var(--color-faint)' }}>{fmtMs(b.metrics!.durationMs)}</span>
                <span className="mono" style={{ color: 'var(--color-source)' }}>{b.metrics!.apiCalls} calls</span>
                <span className="mono ml-auto" style={{ color: 'var(--color-jade)' }}>{b.metrics!.objectsCreated} created</span>
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
      <div className="text-xl leading-none" style={{ fontFamily: 'var(--font-display)', color }}>{n}</div>
      <div className="text-[0.62rem] mono mt-1.5" style={{ color: 'var(--color-faint)' }}>{label}</div>
    </div>
  );
}
