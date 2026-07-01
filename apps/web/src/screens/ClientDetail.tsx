import { useEffect, useState } from 'react';
import { api, type ClientDetail as ClientDetailData } from '../api.js';

const STATUS_CHIP: Record<string, string> = { completed: 'chip-jade', running: 'chip-source', failed: '', queued: '', paused: '', canceled: '' };
const money = (cents: number) => `$${Math.round(cents / 100).toLocaleString()}`;
const ago = (iso: string) => {
  const d = Math.max(0, (Date.now() - Date.parse(iso)) / 86400000);
  if (d < 1) return 'today';
  if (d < 2) return 'yesterday';
  if (d < 30) return `${Math.floor(d)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

/**
 * Everything about one client on a single screen: profile + deal + an earnings rollup + their full build
 * history and deliveries. An operator running a per-client service thinks this way — this is the drill-in
 * the roster list was missing. All data is owner-scoped by the /clients/:id endpoint.
 */
export function ClientDetail({ id, onBack, onOpenHandover }: { id: string; onBack: () => void; onOpenHandover?: (jobId: string) => void }) {
  const [data, setData] = useState<ClientDetailData | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let live = true;
    setData(null);
    setErr(false);
    api.clientDetail(id).then((d) => live && setData(d)).catch(() => live && setErr(true));
    return () => { live = false; };
  }, [id]);

  if (err) {
    return (
      <div className="px-4 py-6 md:p-8 max-w-4xl rise">
        <button className="btn btn-ghost text-sm mb-4 -ml-2" onClick={onBack}>← back to clients</button>
        <div className="panel p-8 text-center text-sm" style={{ color: 'var(--color-muted)' }}>Couldn't load this client. <button onClick={() => { setErr(false); api.clientDetail(id).then(setData).catch(() => setErr(true)); }} style={{ color: 'var(--color-source)', background: 'none', border: 'none', cursor: 'pointer' }}>Retry</button></div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="px-4 py-6 md:p-8 max-w-4xl rise">
        <button className="btn btn-ghost text-sm mb-4 -ml-2" onClick={onBack}>← back to clients</button>
        <div className="panel p-8 text-center text-sm" style={{ color: 'var(--color-faint)' }}>Loading client…</div>
      </div>
    );
  }

  const { client: c, builds, handovers, totals } = data;
  const stats: { label: string; value: string; color?: string }[] = [
    { label: 'builds', value: `${totals.completed}/${totals.realBuilds || 0}`, color: 'var(--color-source)' },
    { label: 'invoiced', value: money(totals.invoicedCents), color: 'var(--color-bone)' },
    { label: 'paid', value: money(totals.paidCents), color: 'var(--color-jade)' },
    { label: 'outstanding', value: money(totals.outstandingCents), color: totals.outstandingCents > 0 ? 'var(--color-gold)' : 'var(--color-faint)' },
    { label: 'mrr', value: money(totals.mrrCents), color: totals.mrrCents > 0 ? 'var(--color-client)' : 'var(--color-faint)' },
  ];

  return (
    <div className="px-4 py-6 md:p-8 max-w-4xl rise">
      <button className="btn btn-ghost text-sm mb-4 -ml-2" onClick={onBack}>← back to clients</button>

      <header className="flex items-start justify-between gap-3 flex-wrap mb-6">
        <div className="min-w-0">
          <div className="eyebrow mb-1">client</div>
          <h1 className="text-2xl break-words">{c.creatorName}</h1>
          {c.handle && <span className="chip mono mt-2 inline-flex" style={{ color: 'var(--color-client)' }}>{c.handle}</span>}
        </div>
        {(c.buildPrice > 0 || c.monthlyRetainer > 0) && (
          <div className="text-right shrink-0">
            <div className="mono text-lg" style={{ color: 'var(--color-jade)' }}>{c.buildPrice > 0 ? `$${Math.round(c.buildPrice).toLocaleString()}` : '—'}</div>
            {c.monthlyRetainer > 0 && <div className="mono text-xs" style={{ color: 'var(--color-muted)' }}>+ ${Math.round(c.monthlyRetainer).toLocaleString()}/mo</div>}
          </div>
        )}
      </header>

      {/* earnings + activity rollup */}
      <div className="grid gap-2 mb-6" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(96px,1fr))' }}>
        {stats.map((s) => (
          <div key={s.label} className="panel-soft px-3 py-3 text-center">
            <div className="text-xl leading-none mono" style={{ color: s.color }}>{s.value}</div>
            <div className="text-[0.6rem] mono mt-1.5" style={{ color: 'var(--color-faint)' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* build history */}
      <section className="panel p-5 mb-6">
        <div className="eyebrow mb-3">build history</div>
        {builds.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--color-faint)' }}>No builds yet for this client.</p>
        ) : (
          <div className="space-y-1.5">
            {builds.map((b) => (
              <div key={b.id} className="panel-soft px-3 py-2.5 flex items-center gap-3 flex-wrap">
                <span className={`chip ${STATUS_CHIP[b.status] ?? ''}`} style={STATUS_CHIP[b.status] ? undefined : { color: b.status === 'failed' ? 'var(--color-danger)' : 'var(--color-muted)' }}>{b.status}</span>
                <span className="text-sm min-w-0 truncate" style={{ flex: 1 }}>{b.snapshotName ?? 'build'}{(b.dryRun || b.canary) && <span className="mono text-[0.66rem] ml-2" style={{ color: 'var(--color-faint)' }}>{b.dryRun ? 'dry-run' : 'canary'}</span>}</span>
                {(b.invoicedCents > 0 || b.paidCents > 0) && (
                  <span className="mono text-[0.72rem]" style={{ color: b.paidCents >= b.invoicedCents && b.invoicedCents > 0 ? 'var(--color-jade)' : 'var(--color-gold)' }}>
                    {money(b.paidCents)}/{money(b.invoicedCents)}
                  </span>
                )}
                <span className="mono text-[0.68rem]" style={{ color: 'var(--color-faint)' }}>{ago(b.createdAt)}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* deliveries */}
      {handovers.length > 0 && (
        <section className="panel p-5 mb-6">
          <div className="eyebrow mb-3">deliveries</div>
          <div className="space-y-1.5">
            {handovers.map((h) => (
              <div key={h.id} className="panel-soft px-3 py-2.5 flex items-center gap-3 flex-wrap">
                <span className={`chip ${h.state === 'handed_over' ? 'chip-jade' : h.state === 'ready' ? 'chip-gold' : ''}`} style={h.state === 'draft' ? { color: 'var(--color-faint)' } : undefined}>{h.state.replace('_', ' ')}</span>
                <span className="text-sm" style={{ flex: 1, color: 'var(--color-muted)' }}>{h.readyAt ? `delivered ${ago(h.readyAt)}` : 'not delivered yet'}</span>
                {h.inviteUrl && <span className="mono text-[0.66rem] chip chip-jade">invite set</span>}
                {onOpenHandover && <button className="btn btn-ghost text-xs" style={{ padding: '0.25rem 0.6rem' }} onClick={() => onOpenHandover(h.jobId)}>Open →</button>}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* brand + notes */}
      {(c.brandColors.length > 0 || c.links.length > 0 || c.notes || c.upsells.length > 0) && (
        <section className="panel p-5 mb-6">
          <div className="eyebrow mb-3">brand &amp; notes</div>
          {c.brandColors.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {c.brandColors.map((hex) => (
                <span key={hex} className="inline-flex items-center gap-1 chip mono" style={{ fontSize: '0.66rem' }}>
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: hex, display: 'inline-block' }} />{hex}
                </span>
              ))}
            </div>
          )}
          {c.links.map((l) => (
            <div key={l} className="mono text-[0.72rem] truncate mb-1" style={{ color: 'var(--color-source)' }} title={l}>{l}</div>
          ))}
          {c.notes && <p className="text-sm mt-2" style={{ color: 'var(--color-muted)' }}>{c.notes}</p>}
          {c.upsells.length > 0 && (
            <div className="mono text-[0.7rem] mt-3" style={{ color: 'var(--color-faint)' }}>
              {c.upsells.length} upsell{c.upsells.length === 1 ? '' : 's'} tracked
            </div>
          )}
        </section>
      )}
    </div>
  );
}
