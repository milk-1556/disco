import { useEffect, useState } from 'react';
import { api, assetUrl, type HandoverBundle, type OwnershipStep } from '../api.js';
import { BotSetupList } from '../components/BotSetupList.js';
import { deliveredScope } from '../scope.js';
import { cx } from '../util.js';

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

export function HandoverPage({ jobId, onBack }: { jobId: string; onBack: () => void }) {
  const [bundle, setBundle] = useState<HandoverBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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
      <div className="p-8" style={{ color: 'var(--color-muted)' }}>
        Loading handover…
      </div>
    );
  }

  if (err && !bundle) {
    return (
      <div className="px-4 py-6 md:p-8 max-w-3xl rise">
        <button className="btn btn-ghost mb-4" onClick={onBack}>
          ← Back
        </button>
        <div className="panel-soft p-4 text-sm" style={{ color: 'var(--color-danger)' }}>
          {err}
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
      <header className="flex items-start justify-between gap-4 mb-7">
        <div>
          <div className="eyebrow mb-2">delivery</div>
          <h1 className="text-2xl flex items-center gap-3" style={{ fontFamily: 'var(--font-display)' }}>
            <span className="transform-text">{serverName}</span>
            <span className={cx('chip', stateChip.className)}>{stateChip.label}</span>
          </h1>
          <p className="text-sm mt-2 max-w-xl" style={{ color: 'var(--color-muted)' }}>
            The per-client delivery record — everything that was built, what still needs a human, and
            the steps to transfer full ownership to the client.
          </p>
        </div>
        <button className="btn btn-ghost" onClick={onBack}>
          ← Back
        </button>
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
            No build report attached to this job yet.
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

      {/* ── branding & sharing ── */}
      <Branding handover={handover} onPatch={patch} saving={saving} />

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
  const [pw, setPw] = useState('');
  const [copied, setCopied] = useState(false);
  const publicUrl = `${location.origin}/#/h/${handover.id}`;

  return (
    <section className="panel p-5 mb-6">
      <div className="flex items-baseline gap-2 mb-3">
        <span className="label">Branding &amp; sharing</span>
        <span className="text-[0.68rem]" style={{ color: 'var(--color-faint)' }}>
          make the delivery page feel like the client&apos;s own
        </span>
      </div>

      <div className="grid gap-4" style={{ gridTemplateColumns: 'auto 1fr' }}>
        <div className="flex flex-col items-center gap-2">
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

        <div className="space-y-3">
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
