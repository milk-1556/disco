import { useEffect, useState, type CSSProperties } from 'react';
import {
  api,
  assetUrl,
  type HandoverAnalytics,
  type HandoverBundle,
  type OwnershipStep,
  type SurveyAggregate,
} from '../api.js';
import { BotSetupList } from '../components/BotSetupList.js';
import { printReport } from '../components/ReportPrint.js';
import { deliveredScope } from '../scope.js';
import { cx } from '../util.js';
import { ManagingGuide } from './PublicHandover.js';

const UPSELL_OPTIONS: { value: HandoverBundle['handover']['upsellStatus']; label: string }[] = [
  { value: 'none', label: 'No upsell' },
  { value: 'proposed', label: 'Proposed' },
  { value: 'retained', label: 'Retained' },
  { value: 'redesign', label: 'Redesign' },
];

const STATE_CHIP: Record<HandoverBundle['handover']['state'], { className: string; label: string }> = {
  draft: { className: 'chip-gold', label: '● draft' },
  ready: { className: 'chip-jade', label: '● ready' },
  handed_over: { className: 'chip-jade', label: '✓ handed over' },
};

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const secs = Math.round((Date.now() - then) / 1000);
  if (secs < 45) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.round(months / 12)}y ago`;
}

// Referrers come in as origins (or 'direct' when the browser sent none). We only ever know the
// origin + timestamp — never identity — so surface no more than that.
function referrerLabel(ref: string): string {
  if (!ref || ref === 'direct') return 'direct link';
  try {
    return new URL(ref).host;
  } catch {
    return ref;
  }
}

export function HandoverPage({ jobId, onBack }: { jobId: string; onBack: () => void }) {
  const [bundle, setBundle] = useState<HandoverBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [analytics, setAnalytics] = useState<HandoverAnalytics | null>(null);
  const [viewsOpen, setViewsOpen] = useState(false);
  const [survey, setSurvey] = useState<SurveyAggregate['responses'][number] | null>(null);

  const handoverId = bundle?.handover.id ?? null;

  useEffect(() => {
    if (!handoverId) return;
    let alive = true;
    (async () => {
      try {
        const s = await api.surveys();
        if (alive) setSurvey(s.responses.find((r) => r.handoverId === handoverId) ?? null);
      } catch {
        // survey feedback is a soft signal — stay silent if it can't load
        if (alive) setSurvey(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [handoverId]);

  useEffect(() => {
    if (!handoverId) return;
    let alive = true;
    (async () => {
      try {
        const a = await api.handoverAnalytics(handoverId);
        if (alive) setAnalytics(a);
      } catch {
        // engagement is a non-critical signal — stay silent if it can't load
        if (alive) setAnalytics(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [handoverId]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setErr(null);
    (async () => {
      try {
        const created = await api.createHandover(jobId); // idempotent
        const got = await api.getHandover(created.id);
        if (alive) setBundle(got);
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [jobId]);

  async function patch(p: Parameters<typeof api.updateHandover>[1]) {
    if (!bundle) return;
    setErr(null);
    setSaving(true);
    try {
      const updated = await api.updateHandover(bundle.handover.id, p);
      setBundle((prev) => (prev ? { ...prev, handover: updated } : prev));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      // resync from server so optimistic state can't drift
      try {
        const fresh = await api.getHandover(bundle.handover.id);
        setBundle(fresh);
      } catch {
        /* keep last good state */
      }
    } finally {
      setSaving(false);
    }
  }

  function toggleStep(idx: number) {
    if (!bundle) return;
    const current = bundle.handover.ownershipSteps;
    const nextSteps: OwnershipStep[] = current.map((s, i) =>
      i === idx ? { ...s, done: !s.done } : s,
    );
    // optimistic update
    setBundle((prev) =>
      prev ? { ...prev, handover: { ...prev.handover, ownershipSteps: nextSteps } } : prev,
    );
    patch({ ownershipSteps: nextSteps });
  }

  if (loading) {
    return (
      <div className="px-4 py-6 md:p-8 flex items-center gap-3" style={{ color: 'var(--color-muted)' }}>
        <span className="w-2 h-2 rounded-full live-dot" style={{ background: 'var(--color-source)' }} />
        <span className="text-sm">Assembling the delivery record…</span>
      </div>
    );
  }

  if (err && !bundle) {
    return (
      <div className="px-4 py-6 md:p-8 max-w-3xl rise">
        <button className="btn btn-ghost mb-4" onClick={onBack}>
          ← Back
        </button>
        <div className="panel p-5">
          <div className="text-sm font-medium mb-1">Couldn’t open this handover</div>
          <p className="text-sm mb-3" style={{ color: 'var(--color-muted)' }}>
            The build may still be running, or the record isn’t ready yet. Head back and reopen it in a moment.
          </p>
          <div className="panel-soft p-3 text-xs mono break-words" style={{ color: 'var(--color-danger)' }}>
            {err}
          </div>
        </div>
      </div>
    );
  }

  if (!bundle) return null;

  const { handover, job } = bundle;
  const report = job?.report ?? null;

  // Derive the rebranded server name from the build report when available.
  const serverName =
    report?.created.find((c) => c.toLowerCase().startsWith('guild'))?.replace(/^guild[:\s/]*/i, '').trim() ||
    'Handover';

  const stateChip = STATE_CHIP[handover.state];
  const doneCount = handover.ownershipSteps.filter((s) => s.done).length;
  const totalSteps = handover.ownershipSteps.length;

  return (
    <div className="px-4 py-6 md:p-8 max-w-4xl rise">
      {/* ── header ── */}
      <header className="flex flex-wrap items-start justify-between gap-4 mb-7">
        <div className="min-w-0">
          <div className="eyebrow mb-2">delivery</div>
          <h1 className="text-2xl flex items-center gap-3 flex-wrap" style={{ fontFamily: 'var(--font-display)' }}>
            <span className="transform-text break-words">{serverName}</span>
            <span className={cx('chip', stateChip.className)}>{stateChip.label}</span>
          </h1>
          <p className="text-sm mt-2 max-w-xl" style={{ color: 'var(--color-muted)' }}>
            The per-client delivery record — everything that was built, what still needs a human, and
            the steps to transfer full ownership to the client.
          </p>
          {analytics && <ClientEngagement a={analytics} open={viewsOpen} onToggle={() => setViewsOpen((o) => !o)} />}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {report && (
            <button
              type="button"
              className="btn"
              onClick={() => printReport({ serverName, report })}
            >
              Download report (PDF)
            </button>
          )}
          <button className="btn btn-ghost" onClick={onBack}>
            ← Back
          </button>
        </div>
      </header>

      {err && (
        <div className="panel-soft p-3 mb-5 text-sm" style={{ color: 'var(--color-danger)' }}>
          {err}
        </div>
      )}

      {/* ── what's included ── */}
      <section className="panel p-5 mb-6">
        <div className="eyebrow mb-3">what&apos;s included</div>
        {report ? (
          <div
            className="grid gap-2"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))' }}
          >
            {deliveredScope(report.created, report.botSetup.length).map((t) => (
              <div key={t.label} className="panel-soft px-3 py-3 text-center">
                <div
                  className="text-2xl leading-none"
                  style={{ fontFamily: 'var(--font-display)', color: 'var(--color-jade)' }}
                >
                  {t.value}
                </div>
                <div className="text-[0.62rem] mono mt-1.5" style={{ color: 'var(--color-faint)' }}>
                  {t.label}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm" style={{ color: 'var(--color-faint)' }}>
            No build report yet — run the build for this job and the delivered scope will appear here.
          </p>
        )}
      </section>

      {/* ── bot setup checklist ── */}
      {report && (report.botSetup?.length ?? 0) > 0 && (
        <section className="panel p-5 mb-6">
          <div className="flex items-baseline gap-2 mb-3">
            <span className="label">Bot Setup Checklist</span>
            <span className="text-[0.68rem]" style={{ color: 'var(--color-faint)' }}>
              re-invite &amp; reconfigure — vendor settings can&apos;t be cloned
            </span>
          </div>
          <BotSetupList entries={report.botSetup} />
        </section>
      )}

      {/* ── ownership transfer checklist ── */}
      <section className="panel p-5 mb-6">
        <div className="flex items-baseline justify-between gap-2 mb-3">
          <div className="flex items-baseline gap-2">
            <span className="label">Ownership Transfer Checklist</span>
            <span className="text-[0.68rem]" style={{ color: 'var(--color-faint)' }}>
              hand the keys to the client
            </span>
          </div>
          {totalSteps > 0 && (
            <span className="chip mono">
              {doneCount}/{totalSteps}
            </span>
          )}
        </div>
        {totalSteps === 0 ? (
          <p className="text-sm" style={{ color: 'var(--color-faint)' }}>
            No transfer steps recorded.
          </p>
        ) : (
          <div className="space-y-1.5">
            {handover.ownershipSteps.map((step, i) => (
              <button
                key={i}
                type="button"
                onClick={() => toggleStep(i)}
                disabled={saving}
                className="panel-soft px-3 py-2.5 w-full flex items-start gap-3 text-left transition"
                style={{ background: 'var(--color-ink-panel)' }}
                aria-pressed={step.done}
              >
                <span
                  className="shrink-0 grid place-items-center transition"
                  style={{
                    width: 18,
                    height: 18,
                    marginTop: 1,
                    borderRadius: 5,
                    border: `1px solid ${step.done ? 'var(--color-jade)' : 'var(--color-line)'}`,
                    background: step.done ? 'var(--color-jade)' : 'transparent',
                    color: '#06231a',
                    fontSize: '0.7rem',
                    fontWeight: 700,
                  }}
                  aria-hidden="true"
                >
                  {step.done ? '✓' : ''}
                </span>
                <span>
                  <span
                    className="text-sm font-medium"
                    style={{
                      color: step.done ? 'var(--color-muted)' : 'var(--color-bone)',
                      textDecoration: step.done ? 'line-through' : 'none',
                    }}
                  >
                    {step.title}
                  </span>
                  <span
                    className="block text-[0.72rem] mt-0.5"
                    style={{ color: 'var(--color-muted)' }}
                  >
                    {step.detail}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* ── manual steps ── */}
      {report && report.manualSteps.length > 0 && (
        <section className="panel p-5 mb-6">
          <div className="flex items-baseline gap-2 mb-3">
            <span className="label">Manual steps</span>
            <span className="text-[0.68rem]" style={{ color: 'var(--color-faint)' }}>
              surfaced honestly — never silently skipped
            </span>
          </div>
          <div className="space-y-1.5">
            {report.manualSteps.map((s, i) => (
              <div key={i} className="panel-soft px-3 py-2">
                <div className="text-sm font-medium" style={{ color: 'var(--color-muted)' }}>
                  {s.title}
                </div>
                <div className="text-[0.72rem] mt-0.5" style={{ color: 'var(--color-faint)' }}>
                  {s.reason}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── managing-your-community guide (preview of what the client sees) ── */}
      {report && (
        <ManagingGuide
          serverName={serverName}
          created={report.created}
          botSetup={report.botSetup}
          manualSteps={report.manualSteps}
          preview
        />
      )}

      {/* ── branding & sharing ── */}
      <Branding handover={handover} onPatch={patch} saving={saving} />

      {/* ── client survey (NPS feedback) ── */}
      <ClientSurvey survey={survey} />

      {/* ── footer: upsell tracker + hand-over action ── */}
      <footer className="panel p-5 flex flex-wrap items-center gap-4">
        <div className="flex flex-col gap-2">
          <span className="eyebrow">upsell</span>
          <div className="flex flex-wrap gap-2">
            {UPSELL_OPTIONS.map((opt) => {
              const selected = handover.upsellStatus === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  disabled={saving}
                  onClick={() => patch({ upsellStatus: opt.value })}
                  className={cx('btn', selected ? 'transform-ring' : 'btn-ghost')}
                  style={selected ? { color: 'var(--color-bone)' } : undefined}
                  aria-pressed={selected}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="ml-auto flex items-center gap-3">
          {handover.state === 'handed_over' ? (
            <span className="chip chip-jade">✓ handed over</span>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              disabled={saving}
              onClick={() => patch({ state: handover.state === 'ready' ? 'handed_over' : 'ready' })}
            >
              {handover.state === 'ready' ? 'Confirm hand-over ✓' : 'Mark ready to hand over →'}
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}

const EVENT_LABEL: Record<string, string> = {
  opened: 'opened',
  docs_viewed: 'read the docs',
  report_downloaded: 'downloaded report',
  share_viewed: 'viewed share card',
};

const CLASSIFICATION: Record<
  HandoverAnalytics['classification'],
  { className: string; style?: CSSProperties; label: string }
> = {
  warm: { className: 'chip-jade', label: '🔥 warm' },
  cool: { className: 'chip-gold', label: '🌤 cool' },
  cold: { className: 'chip', style: { color: 'var(--color-faint)' }, label: '🧊 cold' },
};

// 'opened N min/hrs after delivery', or null when we have no first-open timestamp yet.
function timeToFirstOpenLabel(ms: number | null): string | null {
  if (ms == null) return null;
  const mins = Math.round(ms / 60000);
  if (mins < 1) return 'opened seconds after delivery';
  if (mins < 60) return `opened ${mins} min after delivery`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `opened ${hrs} ${hrs === 1 ? 'hr' : 'hrs'} after delivery`;
  const days = Math.round(hrs / 24);
  return `opened ${days} ${days === 1 ? 'day' : 'days'} after delivery`;
}

// A tiny pure-CSS bar row — no animation, so it's inherently reduced-motion safe.
function DecaySparkline({ decay }: { decay: HandoverAnalytics['decay'] }) {
  if (decay.length === 0) return null;
  const max = decay.reduce((m, d) => Math.max(m, d.opens), 0);
  return (
    <div className="mt-2">
      <div className="flex items-end gap-px" style={{ height: 24 }} aria-hidden="true">
        {decay.map((d) => (
          <div
            key={d.day}
            className="flex-1 rounded-sm"
            style={{
              minWidth: 2,
              height: `${max > 0 ? Math.max(8, (d.opens / max) * 100) : 8}%`,
              background: d.opens > 0 ? 'var(--color-source)' : 'var(--color-line)',
              opacity: d.opens > 0 ? 1 : 0.5,
            }}
          />
        ))}
      </div>
      <span className="block text-[0.62rem] mt-1" style={{ color: 'var(--color-faint)' }}>
        opens per day since delivery
      </span>
    </div>
  );
}

function ClientEngagement({
  a,
  open,
  onToggle,
}: {
  a: HandoverAnalytics;
  open: boolean;
  onToggle: () => void;
}) {
  const cls = CLASSIFICATION[a.classification];
  const ttfo = timeToFirstOpenLabel(a.timeToFirstOpenMs);

  if (a.opened === 0) {
    return (
      <div className="mt-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="chip" style={{ color: 'var(--color-faint)' }}>○ Not opened yet</span>
          <span className={cx('chip', cls.className)} style={cls.style}>{cls.label}</span>
        </div>
        <span className="block text-[0.68rem] mt-1.5" style={{ color: 'var(--color-faint)' }}>
          We&apos;ll show a signal here the first time the client opens the delivery page.
        </span>
      </div>
    );
  }

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className={cx('chip', cls.className)} style={cls.style}>{cls.label}</span>
        <span className="chip chip-jade">✓ Opened {a.opened}×{a.lastSeenAt ? ` · last ${relativeTime(a.lastSeenAt)}` : ''}</span>
        {a.docsViewed > 0 && <span className="chip chip-source">📖 Read docs {a.docsViewed}×</span>}
        {a.reportDownloaded > 0 && <span className="chip chip-gold">↓ Downloaded {a.reportDownloaded}×</span>}
        {a.timeline.length > 0 && (
          <button
            type="button"
            className="text-[0.68rem] underline-offset-2 hover:underline"
            style={{ color: 'var(--color-muted)' }}
            onClick={onToggle}
            aria-expanded={open}
          >
            {open ? 'Hide activity' : 'Recent activity'}
          </button>
        )}
      </div>
      {open && a.timeline.length > 0 && (
        <ul className="mt-2 space-y-1">
          {a.timeline.map((v, i) => (
            <li key={i} className="flex items-baseline gap-2 text-[0.72rem]">
              <span className="mono shrink-0" style={{ color: 'var(--color-muted)' }}>{relativeTime(v.at)}</span>
              <span style={{ color: 'var(--color-bone)' }}>{EVENT_LABEL[v.kind] ?? v.kind}</span>
              <span className="truncate" style={{ color: 'var(--color-faint)' }}>· {referrerLabel(v.referrer)}</span>
            </li>
          ))}
        </ul>
      )}
      <span className="block text-[0.68rem] mt-1.5" style={{ color: 'var(--color-muted)' }}>
        {ttfo ?? 'not opened yet'}
      </span>
      <DecaySparkline decay={a.decay} />
      <span className="block text-[0.62rem] mt-1.5" style={{ color: 'var(--color-faint)' }}>
        Engagement events &amp; referrer origin only — never who, never an IP.
      </span>
    </div>
  );
}

function npsColor(nps: number): string {
  if (nps >= 9) return 'var(--color-jade)';
  if (nps >= 7) return 'var(--color-gold)';
  return 'var(--color-danger)';
}

function ClientSurvey({ survey }: { survey: SurveyAggregate['responses'][number] | null }) {
  return (
    <section className="panel p-5 mb-6">
      <div className="flex items-baseline gap-2 mb-3">
        <span className="label">Client survey</span>
        <span className="text-[0.68rem]" style={{ color: 'var(--color-faint)' }}>
          how the handover landed
        </span>
      </div>
      {survey && survey.nps != null ? (
        <div className="space-y-3">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span
              className="text-2xl leading-none"
              style={{ fontFamily: 'var(--font-display)', color: npsColor(survey.nps) }}
            >
              {survey.nps}
            </span>
            <span className="text-[0.72rem] mono" style={{ color: 'var(--color-faint)' }}>
              / 10 NPS
            </span>
            {survey.at && (
              <span className="text-[0.68rem] ml-auto" style={{ color: 'var(--color-muted)' }}>
                {relativeTime(survey.at)}
              </span>
            )}
          </div>
          {survey.comment.trim() && (
            <blockquote
              className="panel-soft px-3 py-2.5 text-sm"
              style={{
                color: 'var(--color-bone)',
                borderLeft: '2px solid var(--color-source)',
                fontStyle: 'italic',
              }}
            >
              “{survey.comment.trim()}”
            </blockquote>
          )}
        </div>
      ) : (
        <p className="text-sm" style={{ color: 'var(--color-faint)' }}>
          No survey response yet.
        </p>
      )}
    </section>
  );
}

function Branding({
  handover,
  onPatch,
  saving,
}: {
  handover: HandoverBundle['handover'];
  onPatch: (p: Parameters<typeof api.updateHandover>[1]) => void | Promise<void>;
  saving: boolean;
}) {
  const [welcome, setWelcome] = useState(handover.welcomeMessage);
  const [invite, setInvite] = useState(handover.inviteUrl);
  const [inviteErr, setInviteErr] = useState<string | null>(null);
  const [pw, setPw] = useState('');
  const [copied, setCopied] = useState(false);
  const saveInvite = () => {
    const v = invite.trim();
    if (v !== '' && !/^https:\/\/(www\.)?(discord\.gg\/.+|(canary\.|ptb\.)?discord(app)?\.com\/invite\/.+)/.test(v)) {
      return setInviteErr('Must be a Discord invite (https://discord.gg/… or https://discord.com/invite/…)');
    }
    setInviteErr(null);
    if (v !== handover.inviteUrl) void onPatch({ inviteUrl: v });
  };
  // The /share/:id link carries social-preview meta (og:title etc.) and forwards humans to the
  // delivery page — so it unfurls nicely when the operator drops it in Discord / email / a DM.
  const publicUrl = `${location.origin}/share/${handover.id}`;

  return (
    <section className="panel p-5 mb-6">
      <div className="flex items-baseline gap-2 mb-3">
        <span className="label">Branding &amp; sharing</span>
        <span className="text-[0.68rem]" style={{ color: 'var(--color-faint)' }}>
          make the delivery page feel like the client&apos;s own
        </span>
      </div>

      <div className="flex flex-col sm:flex-row gap-4">
        <div className="flex flex-col items-center gap-2 shrink-0">
          {handover.logoKey ? (
            <img src={assetUrl(`/${handover.logoKey}`)} alt="" style={{ width: 64, height: 64, borderRadius: 14, objectFit: 'cover' }} className="transform-ring" />
          ) : (
            <div className="transform-ring grid place-items-center text-xs" style={{ width: 64, height: 64, borderRadius: 14, color: 'var(--color-faint)' }}>logo</div>
          )}
          <label className="btn btn-ghost text-xs cursor-pointer">
            Upload
            <input
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                const reader = new FileReader();
                reader.onload = () => void onPatch({ logo: String(reader.result) });
                reader.readAsDataURL(f);
                e.target.value = '';
              }}
            />
          </label>
          {handover.logoKey && (
            <button className="btn btn-ghost text-xs" onClick={() => onPatch({ logo: null })}>Remove</button>
          )}
        </div>

        <div className="space-y-3 flex-1 min-w-0">
          <div>
            <div className="label mb-1">Welcome message (shown to the client)</div>
            <textarea
              className="input"
              rows={2}
              value={welcome}
              onChange={(e) => setWelcome(e.target.value)}
              onBlur={() => welcome !== handover.welcomeMessage && onPatch({ welcomeMessage: welcome })}
              placeholder="Welcome to your new community hub — here's everything that's set up…"
            />
          </div>

          <div>
            <div className="label mb-1 flex items-center gap-2">
              <span>Server invite link {handover.inviteUrl ? '· set' : ''}</span>
              <span style={{ color: 'var(--color-faint)' }}>— the client's “Open your server” button</span>
            </div>
            <input
              className="input"
              type="url"
              inputMode="url"
              value={invite}
              onChange={(e) => { setInvite(e.target.value); setInviteErr(null); }}
              onBlur={saveInvite}
              placeholder="https://discord.gg/your-invite"
            />
            {inviteErr && <div className="text-xs mt-1" style={{ color: 'var(--color-danger)' }}>{inviteErr}</div>}
          </div>

          <div className="flex items-end gap-2">
            <div className="flex-1">
              <div className="label mb-1">
                Password {handover.hasPassword ? '· set' : '· none'}
              </div>
              <input className="input" type="text" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Optional password to gate the public page" />
            </div>
            <button className="btn" disabled={saving} onClick={() => { onPatch({ password: pw || null }); setPw(''); }}>
              {pw ? 'Set' : 'Clear'}
            </button>
          </div>

          <div className="panel-soft p-3 flex items-center gap-2">
            <span className="mono text-xs truncate flex-1" style={{ color: 'var(--color-source)' }}>{publicUrl}</span>
            <button
              className="btn btn-primary text-xs"
              onClick={() => { navigator.clipboard?.writeText(publicUrl); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
            >
              {copied ? 'Copied ✓' : 'Copy public link'}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
