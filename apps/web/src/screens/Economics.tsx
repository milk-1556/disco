import { useMemo, useState } from 'react';
import { api, type Client, type Earnings, type JobSummary } from '../api.js';
import { SkeletonRows } from '../components/Skeleton.js';
import { usePoll } from '../usePoll.js';

const fmtMs = (ms: number) => (ms < 1000 ? `${Math.round(ms)}ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)}s` : `${(ms / 60000).toFixed(1)}m`);
// Wall-clock in client-facing units: "your build took N of operator time".
// < 1m → seconds; < 1h → "Xm Ys"; longer → hours so a marathon rebuild still reads honestly.
const fmtWallClock = (ms: number) => {
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3_600_000) {
    const totalSec = Math.round(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return sec === 0 ? `${min}m` : `${min}m ${sec}s`;
  }
  return `${(ms / 3_600_000).toFixed(1)} hrs`;
};
const fmt$ = (n: number) => `$${Math.round(n).toLocaleString()}`;
// Money stored in cents → dollars with cents precision (revenue is real money, show the change).
const fmtMoney = (cents: number) => `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
// Sub-dollar compute is the whole point — show cents precisely so "pennies" reads true.
const fmtCents = (n: number) => (n >= 1 ? `$${n.toFixed(2)}` : `${(n * 100).toFixed(n < 0.1 ? 1 : 0)}¢`);
const fmtKb = (kb: number) => (kb < 1024 ? `${Math.round(kb)} KB` : `${(kb / 1024).toFixed(1)} MB`);

/**
 * Real unit economics: one-time build fees + recurring management (MRR) + upsells, by client, with a
 * "won vs pipeline" split (a client is won once they have a delivered live build). Compute cost is
 * pennies — surfaced so the operator can see how far one retainer covers it.
 */
export function Economics() {
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [earnings, setEarnings] = useState<Earnings | null>(null);
  const [infra, setInfra] = useState(40); // $/mo infra (postgres + redis + host)
  const [loading, setLoading] = useState(true);

  const refresh = () =>
    Promise.allSettled([
      api.jobs().then(setJobs),
      api.clients().then(setClients),
      api.earnings().then(setEarnings),
    ]).finally(() => setLoading(false));

  usePoll(refresh, 4000);

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

    // Per-build cost: compute ($0.50/compute-hour) + a thin per-build slice of fixed infra,
    // amortized across this month's delivered builds. Egress is synthesized (~3KB/object).
    const COMPUTE_RATE = 0.5; // $/compute-hour
    const EGRESS_KB_PER_OBJECT = 3;
    const infraSlice = builds.length ? infra / builds.length : 0;
    const buildCost = (b: JobSummary) => (b.metrics!.durationMs / 3_600_000) * COMPUTE_RATE + infraSlice;
    const repPrice = avgBuild > 0 ? avgBuild : 3500; // representative won build fee, fallback $3,500
    const avgBuildCost = builds.length ? builds.reduce((a, b) => a + buildCost(b), 0) / builds.length : 0;
    const avgEgressKb = builds.length ? builds.reduce((a, b) => a + b.metrics!.objectsCreated * EGRESS_KB_PER_OBJECT, 0) / builds.length : 0;
    const avgMarginPct = repPrice > 0 ? (1 - avgBuildCost / repPrice) * 100 : 0;

    // Wall-clock operator time: the human-facing "your build took N" receipt.
    const avgMs = builds.length ? totalMs / builds.length : 0;
    const fastestMs = builds.length ? Math.min(...builds.map((b) => b.metrics!.durationMs)) : 0;
    const slowestMs = builds.length ? Math.max(...builds.map((b) => b.metrics!.durationMs)) : 0;

    // Resilience / cost-of-rebuild: real builds (non-dry-run, non-canary) that errored or failed.
    // We can't see checkpoint internals from the summary, so we surface the count of recoverable
    // failures and explain the engine resumes from a checkpoint — no full re-spend.
    const realRuns = jobs.filter((j) => j.kind === 'build' && !j.dryRun && !j.canary);
    const failedRuns = realRuns.filter((j) => j.status === 'failed' || j.status === 'error' || !!j.error);

    // Cost-by-template: group completed, real (non-dry-run, non-canary) builds by snapshotName and
    // measure how PREDICTABLE each template is. Spread (min–max) + stddev around the mean tells Max
    // which templates are safe to quote a flat fee on vs. which are risky. apiCalls-per-build is the
    // closest proxy we have for "work done" — a true per-operation breakdown (channels vs roles)
    // isn't instrumented (metrics only carries apiCalls/durationMs/objectsCreated).
    const tplBuilds = jobs.filter(
      (j) => j.status === 'completed' && !j.dryRun && !j.canary && j.metrics,
    );
    const tplMap = new Map<string, JobSummary[]>();
    for (const b of tplBuilds) {
      const key = b.snapshotName ?? 'untitled template';
      const arr = tplMap.get(key);
      if (arr) arr.push(b);
      else tplMap.set(key, [b]);
    }
    const templates = [...tplMap.entries()]
      .map(([name, bs]) => {
        const durations = bs.map((b) => b.metrics!.durationMs);
        const n = durations.length;
        const avg = durations.reduce((a, d) => a + d, 0) / n;
        const min = Math.min(...durations);
        const max = Math.max(...durations);
        const variance = durations.reduce((a, d) => a + (d - avg) ** 2, 0) / n;
        const stddev = Math.sqrt(variance);
        // Coefficient of variation: stddev as % of mean → unit-free predictability score.
        const cov = avg > 0 ? (stddev / avg) * 100 : 0;
        const avgCalls = bs.reduce((a, b) => a + b.metrics!.apiCalls, 0) / n;
        return { name, count: n, avg, min, max, stddev, cov, avgCalls };
      })
      .sort((a, b) => b.count - a.count);

    return {
      won, pipeline, oneTime, mrr, arr: mrr * 12, upsellRev, avgBuild, pipeOnce, pipeMrr, computeCost, builds, totalMs, dealOnce,
      buildCost, infraSlice, repPrice, avgBuildCost, avgEgressKb, avgMarginPct, COMPUTE_RATE, EGRESS_KB_PER_OBJECT,
      avgMs, fastestMs, slowestMs, failedRuns: failedRuns.length, realRuns: realRuns.length,
      templates,
    };
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
        <div className="panel p-5 mb-6">
          <div className="flex items-baseline justify-between gap-3 flex-wrap mb-1">
            <div className="eyebrow">what a build actually costs</div>
            <span className="label">vs {fmt$(m.repPrice)} build{m.avgBuild > 0 ? '' : ' (est.)'}</span>
          </div>
          <p className="text-sm mb-4" style={{ color: 'var(--color-muted)' }}>
            You charge thousands. The build itself costs cents — here’s where every penny goes.
          </p>

          {/* Headline margin */}
          <div className="panel-soft p-4 mb-4 flex items-end justify-between gap-4 flex-wrap">
            <div>
              <div className="text-[0.62rem] mono mb-1.5" style={{ color: 'var(--color-faint)' }}>margin per build (avg)</div>
              <div className="leading-none" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-jade)', fontSize: 'clamp(2.2rem, 9vw, 3.4rem)' }}>
                {m.avgMarginPct.toFixed(1)}%
              </div>
            </div>
            <div className="text-right">
              <div className="leading-none" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-jade)', fontSize: 'clamp(1.2rem, 4vw, 1.6rem)' }}>
                {fmt$(m.repPrice - m.avgBuildCost)}
              </div>
              <div className="text-[0.62rem] mono mt-1.5" style={{ color: 'var(--color-faint)' }}>
                {fmt$(m.repPrice)} price − {fmtCents(m.avgBuildCost)} cost
              </div>
            </div>
          </div>

          {/* Time per build, with receipts — wall-clock operator time in human units */}
          <div className="panel-soft p-4 mb-4">
            <div className="flex items-baseline justify-between gap-3 flex-wrap mb-1">
              <div className="eyebrow">time per build, with receipts</div>
              <span className="label">{m.builds.length} delivered</span>
            </div>
            <p className="text-sm mb-3" style={{ color: 'var(--color-muted)' }}>
              Hands-off wall-clock — tell a client “your server was built in{' '}
              <span className="mono" style={{ color: 'var(--color-bone)' }}>{fmtWallClock(m.avgMs)}</span> of operator time.”
            </p>
            <div className="flex items-end gap-4 flex-wrap">
              <div>
                <div className="leading-none" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-bone)', fontSize: 'clamp(1.8rem, 7vw, 2.6rem)' }}>
                  {fmtWallClock(m.avgMs)}
                </div>
                <div className="text-[0.62rem] mono mt-1.5" style={{ color: 'var(--color-faint)' }}>avg operator time / build</div>
              </div>
              {m.builds.length > 1 && (
                <div className="text-[0.72rem] mono pb-1" style={{ color: 'var(--color-faint)' }}>
                  fastest <span style={{ color: 'var(--color-jade)' }}>{fmtWallClock(m.fastestMs)}</span> · slowest{' '}
                  <span style={{ color: 'var(--color-muted)' }}>{fmtWallClock(m.slowestMs)}</span>
                </div>
              )}
            </div>
            <div className="space-y-1.5 mt-3">
              {m.builds.slice(0, 6).map((b) => (
                <div key={b.id} className="flex items-center gap-x-3 gap-y-0.5 flex-wrap text-[0.78rem]">
                  <span className="mono" style={{ color: 'var(--color-bone)', minWidth: 64 }}>{fmtWallClock(b.metrics!.durationMs)}</span>
                  <span className="mono" style={{ color: 'var(--color-faint)' }}>
                    {b.clientName ?? b.snapshotName ?? 'build'}
                  </span>
                  <span className="mono ml-auto" style={{ color: 'var(--color-faint)' }}>{b.metrics!.objectsCreated} objects</span>
                </div>
              ))}
            </div>
            <p className="text-[0.7rem] mono mt-3" style={{ color: 'var(--color-faint)' }}>
              {m.failedRuns > 0 ? (
                <>
                  {m.failedRuns} of {m.realRuns} run{m.realRuns === 1 ? '' : 's'} hit a snag and resumed from a checkpoint — re-run only the unfinished steps, no full re-spend.
                </>
              ) : (
                <>failed-then-resumed builds re-run from a checkpoint — only the unfinished steps repeat, never a full re-spend.</>
              )}
            </p>
          </div>

          {/* Average cost breakdown */}
          <div className="grid gap-2 mb-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(120px,1fr))' }}>
            <CostStat n={fmtMs(m.totalMs / m.builds.length)} label="compute / build" tone="source" />
            <CostStat n={`${(m.builds.reduce((a, b) => a + b.metrics!.apiCalls, 0) / m.builds.length).toFixed(0)}`} label="Discord API calls" tone="source" />
            <CostStat n={fmtKb(m.avgEgressKb)} label="egress (est.)" tone="muted" />
            <CostStat n={fmtCents(m.avgBuildCost)} label="compute $ / build" tone="gold" />
          </div>

          <div className="eyebrow mb-2">per recent build</div>
          <div className="space-y-1.5">
            {m.builds.slice(0, 6).map((b) => {
              const cost = m.buildCost(b);
              const egressKb = b.metrics!.objectsCreated * m.EGRESS_KB_PER_OBJECT;
              const marginPct = m.repPrice > 0 ? (1 - cost / m.repPrice) * 100 : 0;
              return (
                <div key={b.id} className="panel-soft px-3 py-2 flex items-center gap-x-3 gap-y-1 flex-wrap text-[0.78rem]">
                  <span className="mono" style={{ color: 'var(--color-faint)', minWidth: 52 }}>{fmtMs(b.metrics!.durationMs)}</span>
                  <span className="mono" style={{ color: 'var(--color-source)' }}>{b.metrics!.apiCalls} calls</span>
                  <span className="mono" style={{ color: 'var(--color-faint)' }}>{fmtKb(egressKb)} est.</span>
                  <span className="mono" style={{ color: 'var(--color-gold)' }}>{fmtCents(cost)}</span>
                  <span className="mono ml-auto" style={{ color: 'var(--color-jade)' }}>{marginPct.toFixed(1)}% margin</span>
                </div>
              );
            })}
          </div>
          <p className="text-[0.7rem] mono mt-3" style={{ color: 'var(--color-faint)' }}>
            cost = (duration × ${m.COMPUTE_RATE.toFixed(2)}/compute-hr) + {fmtCents(m.infraSlice)} infra slice · egress synthesized at {m.EGRESS_KB_PER_OBJECT}KB/object
          </p>
        </div>
      )}

      {m.templates.length > 0 && (
        <div className="panel p-5 mb-6">
          <div className="flex items-baseline justify-between gap-3 flex-wrap mb-1">
            <div className="eyebrow">build cost by template</div>
            <span className="label">{m.templates.length} template{m.templates.length === 1 ? '' : 's'} · {m.templates.reduce((a, t) => a + t.count, 0)} real build{m.templates.reduce((a, t) => a + t.count, 0) === 1 ? '' : 's'}</span>
          </div>
          <p className="text-sm mb-4" style={{ color: 'var(--color-muted)' }}>
            Which snapshots are <span style={{ color: 'var(--color-jade)' }}>predictable</span> to quote and which run{' '}
            <span style={{ color: 'var(--color-gold)' }}>hot-and-cold</span>. Spread is the min–max range; ± is the
            standard deviation around the mean.
          </p>
          <div className="space-y-1.5">
            {m.templates.map((t) => {
              // Tight (cov < 15%) → flat-fee safe; wide (cov > 40%) → risky/variable.
              const predictable = t.count < 2 ? null : t.cov < 15 ? 'tight' : t.cov > 40 ? 'wide' : 'mixed';
              return (
                <div key={t.name} className="panel-soft px-3 py-2.5">
                  <div className="flex items-center gap-2.5 flex-wrap text-sm mb-1.5">
                    <span className="font-medium truncate" style={{ maxWidth: 200 }}>{t.name}</span>
                    {predictable === 'tight' && <span className="chip chip-jade">predictable</span>}
                    {predictable === 'wide' && <span className="chip chip-gold">variable</span>}
                    {predictable === 'mixed' && <span className="chip">mixed</span>}
                    <span className="mono ml-auto" style={{ color: 'var(--color-bone)' }}>{fmtWallClock(t.avg)}</span>
                    <span className="text-[0.6rem] mono" style={{ color: 'var(--color-faint)' }}>avg</span>
                  </div>
                  <div className="flex items-center gap-x-3 gap-y-0.5 flex-wrap text-[0.72rem] mono" style={{ color: 'var(--color-faint)' }}>
                    <span>{t.count} build{t.count === 1 ? '' : 's'}</span>
                    {t.count > 1 ? (
                      <>
                        <span>
                          spread <span style={{ color: 'var(--color-jade)' }}>{fmtWallClock(t.min)}</span>–
                          <span style={{ color: 'var(--color-muted)' }}>{fmtWallClock(t.max)}</span>
                        </span>
                        <span>± {fmtWallClock(t.stddev)} <span style={{ color: t.cov > 40 ? 'var(--color-gold)' : 'var(--color-faint)' }}>({t.cov.toFixed(0)}% cov)</span></span>
                      </>
                    ) : (
                      <span>single build — no spread yet</span>
                    )}
                    <span className="ml-auto" style={{ color: 'var(--color-source)' }}>{t.avgCalls.toFixed(0)} API calls/build</span>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-[0.7rem] mono mt-3" style={{ color: 'var(--color-faint)' }}>
            per-operation cost (channel-create vs role-create) isn’t instrumented yet — metrics only carry
            apiCalls / durationMs / objectsCreated, so API-calls-per-build is the closest proxy for work done.
          </p>
        </div>
      )}

      {earnings && (
        <div className="panel p-5 mb-6">
          <div className="flex items-baseline justify-between gap-3 flex-wrap mb-1">
            <div className="eyebrow">receipts &amp; earnings</div>
            <span className="label">{earnings.billedBuilds} of {earnings.totalBuilds} build{earnings.totalBuilds === 1 ? '' : 's'} billed</span>
          </div>
          <p className="text-sm mb-4" style={{ color: 'var(--color-muted)' }}>
            What you’ve invoiced, what’s landed, and what’s still owed. Mark builds invoiced and paid below to
            keep this honest.
          </p>

          <div className="grid gap-3 mb-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px,1fr))' }}>
            <BigMoney n={fmtMoney(earnings.invoicedCents)} label="invoiced" tone="bone" />
            <BigMoney n={fmtMoney(earnings.paidCents)} label="paid" tone="jade" />
            <BigMoney n={fmtMoney(earnings.outstandingCents)} label="outstanding" tone={earnings.outstandingCents > 0 ? 'gold' : 'muted'} />
          </div>
          <div className="grid gap-3 mb-5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px,1fr))' }}>
            <BigMoney n={fmtMoney(earnings.ytdPaidCents)} label="paid YTD" tone="jade" small />
            <BigMoney n={`${fmtMoney(earnings.mrrCents)}/mo`} label="from retainers (MRR)" tone="bone" small />
          </div>

          {earnings.perTemplate.length > 0 && (
            <>
              <div className="eyebrow mb-2">revenue by template</div>
              <div className="space-y-1.5 mb-5">
                {earnings.perTemplate.map((t) => (
                  <div key={t.name} className="panel-soft px-3 py-2 flex items-center gap-2.5 flex-wrap text-[0.8rem]">
                    <span className="font-medium truncate" style={{ maxWidth: 200 }}>{t.name}</span>
                    <span className="text-[0.62rem] mono" style={{ color: 'var(--color-faint)' }}>{t.builds} build{t.builds === 1 ? '' : 's'}</span>
                    <span className="mono ml-auto" style={{ color: 'var(--color-jade)' }}>{fmtMoney(t.paidCents)}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="eyebrow mb-2">mark builds invoiced &amp; paid</div>
          <div className="space-y-1.5">
            {jobs
              .filter((j) => j.status === 'completed' && !j.dryRun && !j.canary)
              .slice(0, 8)
              .map((j) => (
                <BillingRow key={j.id} job={j} onSaved={refresh} />
              ))}
          </div>
          <p className="text-[0.7rem] mono mt-3" style={{ color: 'var(--color-faint)' }}>
            enter dollars — saved to the penny. outstanding = invoiced − paid across all builds.
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

function CostStat({ n, label, tone }: { n: string; label: string; tone: 'source' | 'gold' | 'muted' }) {
  const color = tone === 'source' ? 'var(--color-source)' : tone === 'gold' ? 'var(--color-gold)' : 'var(--color-muted)';
  return (
    <div className="panel-soft px-3 py-2.5">
      <div className="mono leading-none" style={{ color, fontSize: 'clamp(0.95rem, 2vw, 1.15rem)' }}>{n}</div>
      <div className="text-[0.6rem] mono mt-1.5" style={{ color: 'var(--color-faint)' }}>{label}</div>
    </div>
  );
}

function BigMoney({ n, label, tone, small }: { n: string; label: string; tone: 'bone' | 'jade' | 'gold' | 'muted'; small?: boolean }) {
  const color = tone === 'jade' ? 'var(--color-jade)' : tone === 'gold' ? 'var(--color-gold)' : tone === 'muted' ? 'var(--color-muted)' : 'var(--color-bone)';
  return (
    <div className="panel-soft px-3 py-3">
      <div
        className="leading-none"
        style={{ fontFamily: 'var(--font-display)', color, fontSize: small ? 'clamp(1.1rem, 3.4vw, 1.5rem)' : 'clamp(1.5rem, 5vw, 2.1rem)' }}
      >
        {n}
      </div>
      <div className="text-[0.62rem] mono mt-1.5" style={{ color: 'var(--color-faint)' }}>{label}</div>
    </div>
  );
}

// Inline billing editor: dollars in, cents out via api.setBilling, then refresh the page data.
function BillingRow({ job, onSaved }: { job: JobSummary; onSaved: () => void }) {
  const toDollars = (cents: number) => (cents > 0 ? (cents / 100).toFixed(2) : '');
  const [invoiced, setInvoiced] = useState(toDollars(job.invoicedCents));
  const [paid, setPaid] = useState(toDollars(job.paidCents));
  const [saving, setSaving] = useState(false);

  const dirty =
    invoiced !== toDollars(job.invoicedCents) || paid !== toDollars(job.paidCents);

  const save = async () => {
    setSaving(true);
    try {
      await api.setBilling(job.id, {
        invoicedCents: Math.round((Number(invoiced) || 0) * 100),
        paidCents: Math.round((Number(paid) || 0) * 100),
      });
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="panel-soft px-3 py-2.5 flex items-center gap-2.5 flex-wrap text-sm">
      <span className="font-medium truncate" style={{ maxWidth: 160 }}>
        {job.clientName ?? job.snapshotName ?? 'build'}
      </span>
      <label className="flex items-center gap-1.5 ml-auto">
        <span className="label">inv $</span>
        <input
          className="input mono"
          style={{ width: 84 }}
          type="number"
          min="0"
          step="0.01"
          inputMode="decimal"
          value={invoiced}
          onChange={(e) => setInvoiced(e.target.value)}
        />
      </label>
      <label className="flex items-center gap-1.5">
        <span className="label">paid $</span>
        <input
          className="input mono"
          style={{ width: 84 }}
          type="number"
          min="0"
          step="0.01"
          inputMode="decimal"
          value={paid}
          onChange={(e) => setPaid(e.target.value)}
        />
      </label>
      <button className="btn" disabled={!dirty || saving} onClick={save}>
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  );
}
