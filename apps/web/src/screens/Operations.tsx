import { useState } from 'react';
import { api, type AuditEntry, type BuildEventEntry, type StatusInfo, type WebhookEvent } from '../api.js';
import { usePoll } from '../usePoll.js';

function ago(iso: string | null): string {
  if (!iso) return 'never';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function uptime(sec: number): string {
  if (sec < 60) return `${Math.floor(sec)}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  if (h < 24) return rm ? `${h}h ${rm}m` : `${h}h`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh ? `${d}d ${rh}h` : `${d}d`;
}

function pct(n: number): string {
  const v = n * 100;
  if (v === 0) return '0%';
  if (v < 0.1) return '<0.1%';
  return `${v.toFixed(v < 10 ? 1 : 0)}%`;
}

/** A status chip with a colored dot. */
function StatChip({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="panel-soft flex items-center gap-2 px-3 py-2 rounded-lg shrink-0">
      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
      <span className="label" style={{ color: 'var(--color-faint)' }}>{label}</span>
      <span className="text-sm mono" style={{ color: 'var(--color-bone)' }}>{value}</span>
    </div>
  );
}

/** A big-number stat in the request strip. */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel-soft px-4 py-3 rounded-lg flex-1 min-w-[7rem]">
      <div className="label mb-1" style={{ color: 'var(--color-faint)' }}>{label}</div>
      <div className="text-xl mono" style={{ color: 'var(--color-bone)' }}>{value}</div>
    </div>
  );
}

const workerColor = (w: StatusInfo['worker']) =>
  w === 'up' ? 'var(--color-jade)' : w === 'down' ? 'var(--color-danger)' : 'var(--color-faint)';

/** Map an audit action to a chip color (inline style — covers delete/cancel/password/else). */
function actionStyle(action: string): { color: string; bg: string; border: string } {
  const a = action.toLowerCase();
  if (a.includes('delete') || a.includes('destroy') || a.includes('purge'))
    return { color: 'var(--color-danger)', bg: 'color-mix(in srgb, var(--color-danger) 14%, transparent)', border: 'color-mix(in srgb, var(--color-danger) 35%, transparent)' };
  if (a.includes('cancel') || a.includes('abort') || a.includes('stop'))
    return { color: 'var(--color-gold)', bg: 'color-mix(in srgb, var(--color-gold) 14%, transparent)', border: 'color-mix(in srgb, var(--color-gold) 35%, transparent)' };
  if (a.includes('password') || a.includes('rotate') || a.includes('passcode') || a.includes('token'))
    return { color: 'var(--color-source)', bg: 'color-mix(in srgb, var(--color-source) 14%, transparent)', border: 'color-mix(in srgb, var(--color-source) 35%, transparent)' };
  return { color: 'var(--color-muted)', bg: 'var(--color-line-soft)', border: 'var(--color-line)' };
}

/** Map a build-event kind to a chip color (completed=jade, failed=danger, resumed=gold, running/queued=source). */
function buildKindStyle(kind: string): { color: string; bg: string; border: string } {
  const k = kind.toLowerCase();
  const accent =
    k === 'completed' ? 'var(--color-jade)' :
    k === 'failed' ? 'var(--color-danger)' :
    k === 'resumed' ? 'var(--color-gold)' :
    'var(--color-source)';
  return {
    color: accent,
    bg: `color-mix(in srgb, ${accent} 14%, transparent)`,
    border: `color-mix(in srgb, ${accent} 35%, transparent)`,
  };
}

/** Map a webhook outcome to a chip color (processed=jade, ignored=muted, rejected/failed=danger/gold). */
function outcomeStyle(outcome: string): { color: string; bg: string; border: string } {
  const o = outcome.toLowerCase();
  if (o === 'processed')
    return { color: 'var(--color-jade)', bg: 'color-mix(in srgb, var(--color-jade) 14%, transparent)', border: 'color-mix(in srgb, var(--color-jade) 35%, transparent)' };
  if (o === 'rejected')
    return { color: 'var(--color-danger)', bg: 'color-mix(in srgb, var(--color-danger) 14%, transparent)', border: 'color-mix(in srgb, var(--color-danger) 35%, transparent)' };
  if (o === 'failed')
    return { color: 'var(--color-gold)', bg: 'color-mix(in srgb, var(--color-gold) 14%, transparent)', border: 'color-mix(in srgb, var(--color-gold) 35%, transparent)' };
  // ignored & anything else → muted
  return { color: 'var(--color-muted)', bg: 'var(--color-line-soft)', border: 'var(--color-line)' };
}

const WEBHOOK_SOURCES = ['all', 'stripe', 'discord'] as const;
type WebhookSourceFilter = (typeof WEBHOOK_SOURCES)[number];

/** A premium, read-only ops dashboard: live system health + an accountability audit log. */
export function Operations() {
  const [status, setStatus] = useState<StatusInfo | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [builds, setBuilds] = useState<BuildEventEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [webhooks, setWebhooks] = useState<WebhookEvent[]>([]);
  const [webhooksOk, setWebhooksOk] = useState(false);
  const [webhookSource, setWebhookSource] = useState<WebhookSourceFilter>('all');

  usePoll(() => {
    void (async () => {
      try {
        const [s, a, b] = await Promise.all([api.status(), api.audit(), api.buildEvents()]);
        setStatus(s);
        setAudit(a);
        setBuilds(b);
        setLoaded(true);
      } catch {
        /* keep last good values on a transient blip */
      }
    })();
  }, 5000);

  // Webhook log is ADMIN-ONLY: api.req throws (e.g. 403) for non-admins.
  // Wrap in try/catch — on failure we simply never flip webhooksOk, so the section stays hidden.
  usePoll(() => {
    void (async () => {
      try {
        const w = await api.webhookEvents(webhookSource === 'all' ? undefined : webhookSource);
        setWebhooks(w);
        setWebhooksOk(true);
      } catch {
        setWebhooksOk(false);
      }
    })();
  }, 5000);

  const routes = status
    ? [...status.requests.perRoute].sort((a, b) => b.p95Ms - a.p95Ms).slice(0, 8)
    : [];

  return (
    <div className="px-4 py-6 md:p-8 max-w-3xl rise">
      <header className="mb-6">
        <div className="eyebrow mb-2">operations</div>
        <h1 className="text-2xl">
          System health &amp; <span className="transform-text">accountability</span>
        </h1>
      </header>

      {/* ── STATUS ─────────────────────────────────────────── */}
      {!loaded ? (
        <div className="panel p-8 flex items-center justify-center gap-3 mb-8" style={{ color: 'var(--color-muted)' }}>
          <span className="w-2 h-2 rounded-full live-dot" style={{ background: 'var(--color-source)' }} />
          <span className="text-sm">Taking the system's pulse…</span>
        </div>
      ) : status ? (
        <section className="mb-8" aria-label="System status">
          {/* status chips */}
          <div className="flex flex-wrap gap-2 mb-3">
            <StatChip label="api" value={status.api} color="var(--color-jade)" />
            <StatChip label="worker" value={status.worker} color={workerColor(status.worker)} />
            <StatChip label="queue" value={status.queue} color="var(--color-source)" />
            <StatChip label="store" value={status.persistence} color="var(--color-source)" />
            <StatChip label="uptime" value={uptime(status.uptimeSec)} color="var(--color-faint)" />
          </div>

          {/* request stats strip */}
          <div className="flex flex-wrap gap-2 mb-3">
            <Stat label="requests" value={status.requests.total.toLocaleString()} />
            <Stat label="error rate" value={pct(status.requests.errorRate)} />
            <Stat label="p50" value={`${Math.round(status.requests.p50Ms)}ms`} />
            <Stat label="p95" value={`${Math.round(status.requests.p95Ms)}ms`} />
          </div>

          {/* per-route table */}
          {routes.length > 0 && (
            <div className="panel p-2 mb-3">
              <div className="flex items-center gap-3 px-3 py-1.5 label" style={{ color: 'var(--color-faint)' }}>
                <span className="flex-1 min-w-0">route</span>
                <span className="w-12 text-right shrink-0">count</span>
                <span className="w-14 text-right shrink-0">p95</span>
                <span className="w-12 text-right shrink-0">err</span>
              </div>
              {routes.map((r, idx) => (
                <div
                  key={r.route}
                  className="flex items-center gap-3 px-3 py-2"
                  style={{ borderTop: idx === 0 ? 'none' : '1px solid var(--color-line-soft)' }}
                >
                  <span className="flex-1 min-w-0 truncate mono text-[0.78rem]" style={{ color: 'var(--color-bone)' }}>{r.route}</span>
                  <span className="w-12 text-right shrink-0 mono text-xs" style={{ color: 'var(--color-muted)' }}>{r.count.toLocaleString()}</span>
                  <span className="w-14 text-right shrink-0 mono text-xs" style={{ color: 'var(--color-muted)' }}>{Math.round(r.p95Ms)}ms</span>
                  <span
                    className="w-12 text-right shrink-0 mono text-xs"
                    style={{ color: r.errorRate > 0 ? 'var(--color-danger)' : 'var(--color-faint)' }}
                  >
                    {pct(r.errorRate)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* last build / last activity */}
          <div className="flex flex-wrap gap-x-6 gap-y-1 px-1 text-xs" style={{ color: 'var(--color-faint)' }}>
            <span>
              last build <span className="mono" style={{ color: 'var(--color-muted)' }}>{ago(status.lastBuildAt)}</span>
            </span>
            <span>
              last activity <span className="mono" style={{ color: 'var(--color-muted)' }}>{ago(status.lastActivityAt)}</span>
            </span>
          </div>
        </section>
      ) : null}

      {/* ── BUILD EVENTS ───────────────────────────────────── */}
      {loaded && (
        <section className="mb-8" aria-label="Build events">
          <div className="eyebrow mb-3">build events</div>
          {builds.length === 0 ? (
            <div className="panel p-8 text-center">
              <div className="text-sm font-medium mb-1">No builds yet</div>
              <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
                Run one from the Build console and its lifecycle shows here.
              </p>
            </div>
          ) : (
            <div className="panel p-2">
              {[...builds]
                .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
                .map((e, idx, arr) => {
                  const st = buildKindStyle(e.kind);
                  return (
                    <div
                      key={e.id}
                      className="flex items-start gap-3 px-3 py-2.5"
                      style={{ borderBottom: idx === arr.length - 1 ? 'none' : '1px solid var(--color-line-soft)' }}
                    >
                      <span
                        className="chip shrink-0 mt-0.5"
                        style={{ color: st.color, background: st.bg, borderColor: st.border }}
                      >
                        {e.kind}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm" style={{ color: 'var(--color-bone)' }}>{e.detail}</div>
                        <div className="text-[0.7rem] mono mt-0.5 truncate" style={{ color: 'var(--color-muted)' }}>{e.jobId}</div>
                      </div>
                      <span className="mono text-[0.7rem] shrink-0 mt-0.5" style={{ color: 'var(--color-faint)' }}>{ago(e.at)}</span>
                    </div>
                  );
                })}
            </div>
          )}
        </section>
      )}

      {/* ── AUDIT LOG ──────────────────────────────────────── */}
      {loaded && (
        <section aria-label="Audit log">
          <div className="eyebrow mb-3">audit log</div>
          {audit.length === 0 ? (
            <div className="panel p-8 text-center">
              <div className="text-sm font-medium mb-1">A clean record</div>
              <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
                No destructive actions recorded yet.
              </p>
            </div>
          ) : (
            <div className="panel p-2">
              {audit.map((e, idx) => {
                const st = actionStyle(e.action);
                return (
                  <div
                    key={e.id}
                    className="flex items-start gap-3 px-3 py-2.5"
                    style={{ borderBottom: idx === audit.length - 1 ? 'none' : '1px solid var(--color-line-soft)' }}
                  >
                    <span
                      className="chip shrink-0 mt-0.5"
                      style={{ color: st.color, background: st.bg, borderColor: st.border }}
                    >
                      {e.action}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm truncate" style={{ color: 'var(--color-bone)' }}>{e.target}</div>
                      {e.detail && (
                        <div className="text-[0.72rem] truncate" style={{ color: 'var(--color-faint)' }}>{e.detail}</div>
                      )}
                      <div className="text-[0.7rem] mono mt-0.5" style={{ color: 'var(--color-muted)' }}>{e.operator}</div>
                    </div>
                    <span className="mono text-[0.7rem] shrink-0 mt-0.5" style={{ color: 'var(--color-faint)' }}>{ago(e.at)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* ── WEBHOOK LOG (admin only) ───────────────────────── */}
      {webhooksOk && (
        <section className="mt-8" aria-label="Webhook log">
          <div className="flex flex-wrap items-center gap-3 mb-3">
            <div className="eyebrow">webhook log</div>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter webhooks by source">
              {WEBHOOK_SOURCES.map((s) => {
                const active = webhookSource === s;
                return (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setWebhookSource(s)}
                    className="chip"
                    style={{
                      cursor: 'pointer',
                      color: active ? 'var(--color-source)' : 'var(--color-muted)',
                      background: active ? 'color-mix(in srgb, var(--color-source) 14%, transparent)' : 'var(--color-line-soft)',
                      borderColor: active ? 'color-mix(in srgb, var(--color-source) 35%, transparent)' : 'var(--color-line)',
                      transition: 'color 120ms, background-color 120ms, border-color 120ms',
                    }}
                  >
                    {s}
                  </button>
                );
              })}
            </div>
          </div>

          {webhooks.length === 0 ? (
            <div className="panel p-8 text-center">
              <div className="text-sm font-medium mb-1">No webhooks received yet.</div>
              <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
                Inbound Stripe &amp; Discord receipts show here for delivery debugging.
              </p>
            </div>
          ) : (
            <div className="panel p-2">
              {webhooks.map((e, idx) => {
                const st = outcomeStyle(e.outcome);
                return (
                  <div
                    key={e.id}
                    className="flex items-start gap-3 px-3 py-2.5"
                    style={{ borderBottom: idx === webhooks.length - 1 ? 'none' : '1px solid var(--color-line-soft)' }}
                  >
                    <div className="flex flex-wrap items-center gap-1.5 shrink-0 mt-0.5">
                      <span
                        className="chip"
                        style={
                          e.signatureValid
                            ? { color: 'var(--color-jade)', background: 'color-mix(in srgb, var(--color-jade) 14%, transparent)', borderColor: 'color-mix(in srgb, var(--color-jade) 35%, transparent)' }
                            : { color: 'var(--color-danger)', background: 'color-mix(in srgb, var(--color-danger) 14%, transparent)', borderColor: 'color-mix(in srgb, var(--color-danger) 35%, transparent)' }
                        }
                      >
                        {e.signatureValid ? '✓ signed' : '⚠ unsigned/invalid'}
                      </span>
                      <span className="chip" style={{ color: st.color, background: st.bg, borderColor: st.border }}>
                        {e.outcome}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[0.78rem] mono truncate" style={{ color: 'var(--color-bone)' }}>
                        <span style={{ color: 'var(--color-faint)' }}>{e.source}</span>{' '}{e.eventType}
                      </div>
                      {e.detail && (
                        <div className="text-[0.72rem] truncate" style={{ color: 'var(--color-faint)' }}>{e.detail}</div>
                      )}
                    </div>
                    <span className="mono text-[0.7rem] shrink-0 mt-0.5" style={{ color: 'var(--color-faint)' }}>{ago(e.at)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
