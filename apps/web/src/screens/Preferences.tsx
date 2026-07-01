import { useEffect, useId, useState } from 'react';
import { api, type OperatorPrefs, type OwnershipStep } from '../api.js';

// Relative "updated N ago" receipt — calm, single-line, never alarming.
function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 2_592_000) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

/**
 * #4 Operator preferences — per-operator build defaults that pre-fill new builds and client
 * handovers. A quiet settings page: load once, edit locally, save the changed fields. Custom
 * ownership checklist is opt-in (OFF → null → use the built-in steps).
 */
export function Preferences() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Server snapshot we diff against, so Save only sends changed fields.
  const [base, setBase] = useState<OperatorPrefs | null>(null);
  // Editable form state.
  const [canary, setCanary] = useState(false);
  const [dryRun, setDryRun] = useState(false);
  const [welcome, setWelcome] = useState('');
  const [steps, setSteps] = useState<OwnershipStep[] | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  function hydrate(p: OperatorPrefs) {
    setBase(p);
    setCanary(p.defaultCanary);
    setDryRun(p.defaultDryRun);
    setWelcome(p.defaultWelcomeMessage);
    setSteps(p.defaultOwnershipSteps ? p.defaultOwnershipSteps.map((s) => ({ ...s })) : null);
    setUpdatedAt(p.updatedAt);
  }

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      hydrate(await api.prefs());
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  // A custom checklist is "on" when steps is a list; off when null (built-in steps apply).
  const customSteps = steps !== null;
  function toggleCustomSteps(on: boolean) {
    setSaved(false);
    // Seed one empty step when turning on from null, so there's something to edit.
    setSteps(on ? (steps ?? [{ title: '', detail: '', done: false }]) : null);
  }
  function patchStep(i: number, p: Partial<OwnershipStep>) {
    setSaved(false);
    setSteps((prev) => (prev ? prev.map((s, idx) => (idx === i ? { ...s, ...p } : s)) : prev));
  }
  function addStep() {
    setSaved(false);
    setSteps((prev) => [...(prev ?? []), { title: '', detail: '', done: false }]);
  }
  function removeStep(i: number) {
    setSaved(false);
    setSteps((prev) => (prev ? prev.filter((_, idx) => idx !== i) : prev));
  }

  // Build a patch of only the fields that drifted from the loaded snapshot.
  function buildPatch(): Partial<OperatorPrefs> {
    if (!base) return {};
    const patch: Partial<OperatorPrefs> = {};
    if (canary !== base.defaultCanary) patch.defaultCanary = canary;
    if (dryRun !== base.defaultDryRun) patch.defaultDryRun = dryRun;
    if (welcome !== base.defaultWelcomeMessage) patch.defaultWelcomeMessage = welcome;
    // Drop empty steps before comparing/saving; an all-empty (or null) list collapses to null,
    // meaning "use the built-in steps".
    const cleaned = steps?.filter((s) => s.title.trim() || s.detail.trim()) ?? [];
    const normalized: OwnershipStep[] | null = cleaned.length > 0 ? cleaned : null;
    if (JSON.stringify(normalized) !== JSON.stringify(base.defaultOwnershipSteps)) {
      patch.defaultOwnershipSteps = normalized;
    }
    return patch;
  }

  const patch = base ? buildPatch() : {};
  const dirty = Object.keys(patch).length > 0;

  async function save() {
    if (!dirty || saving) return;
    setSaving(true);
    setErr(null);
    setSaved(false);
    try {
      const next = await api.setPrefs(patch);
      hydrate(next);
      setSaved(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="px-4 py-6 md:p-8 max-w-3xl rise">
      <header className="mb-6">
        <div className="eyebrow mb-2">preferences</div>
        <h1 className="text-2xl">
          Your <span className="transform-text">build defaults</span>
        </h1>
        <p className="text-sm mt-2" style={{ color: 'var(--color-muted)' }}>
          These quietly pre-fill every new build and client handover, so you start from your own house
          style instead of the app's. Change them once; they stick.
        </p>
      </header>

      {err && (
        <div className="panel-soft p-3 mb-4 text-sm flex items-center justify-between gap-3" style={{ color: 'var(--color-danger)' }}>
          <span>Couldn't load your preferences — {err}</span>
          <button className="btn btn-ghost shrink-0" onClick={() => void load()}>Retry</button>
        </div>
      )}

      {loading ? (
        <div className="panel p-6 text-center" style={{ color: 'var(--color-faint)' }}>
          <div className="eyebrow mb-2">loading</div>
          <p className="text-sm">Fetching your defaults…</p>
        </div>
      ) : !base ? null : (
        <>
          <section className="panel p-5 mb-4">
            <div className="eyebrow mb-3">build behavior</div>
            <div className="space-y-1">
              <Switch
                label="Default to canary builds"
                hint="Start new builds as a tiny verification slice — a handful of objects to prove the rebrand lands — instead of a full build."
                checked={canary}
                onChange={(v) => { setSaved(false); setCanary(v); }}
              />
              <div style={{ height: 1, background: 'var(--color-line)', margin: '4px 0' }} />
              <Switch
                label="Default to dry-run"
                hint="Plan only — preview every change the build would make, with no writes to the live server."
                checked={dryRun}
                onChange={(v) => { setSaved(false); setDryRun(v); }}
              />
            </div>
          </section>

          <section className="panel p-5 mb-4">
            <div className="eyebrow mb-2">welcome message</div>
            <p className="text-sm mb-3" style={{ color: 'var(--color-muted)' }}>
              The greeting that pre-fills the top of each client's handover page. Leave it blank to write a
              fresh one per client.
            </p>
            <textarea
              className="input"
              rows={4}
              value={welcome}
              placeholder="Welcome aboard — your new server is ready. Here's everything you need to take it over…"
              onChange={(e) => { setSaved(false); setWelcome(e.target.value); }}
            />
          </section>

          <section className="panel p-5 mb-4">
            <Switch
              label="Custom ownership checklist"
              hint="Off uses the built-in handover steps. On lets you write your own — the take-it-over checklist every client sees on their delivery page."
              checked={customSteps}
              onChange={toggleCustomSteps}
            />
            {customSteps && steps && (
              <div className="mt-4 space-y-2">
                {steps.length === 0 ? (
                  <div className="panel-soft p-3 text-sm" style={{ color: 'var(--color-faint)' }}>
                    No steps yet — add one below.
                  </div>
                ) : (
                  steps.map((s, i) => (
                    <div key={i} className="panel-soft p-3">
                      <div className="flex items-start gap-2">
                        <span
                          className="mono text-[0.72rem] mt-2 shrink-0"
                          style={{ color: 'var(--color-faint)', width: 18, textAlign: 'right' }}
                        >
                          {i + 1}.
                        </span>
                        <div className="flex-1 min-w-0 space-y-2">
                          <input
                            className="input"
                            value={s.title}
                            placeholder="Step title (e.g. Transfer server ownership)"
                            aria-label={`Step ${i + 1} title`}
                            onChange={(e) => patchStep(i, { title: e.target.value })}
                          />
                          <input
                            className="input"
                            value={s.detail}
                            placeholder="What the client needs to do"
                            aria-label={`Step ${i + 1} detail`}
                            onChange={(e) => patchStep(i, { detail: e.target.value })}
                          />
                        </div>
                        <button
                          className="btn btn-ghost shrink-0"
                          title="Remove this step"
                          aria-label={`Remove step ${i + 1}`}
                          onClick={() => removeStep(i)}
                          style={{ color: 'var(--color-faint)' }}
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  ))
                )}
                <button className="btn btn-ghost" onClick={addStep}>＋ Add step</button>
              </div>
            )}
          </section>

          <div className="flex items-center gap-3 flex-wrap">
            <button className="btn btn-primary" disabled={!dirty || saving} onClick={() => void save()}>
              {saving ? 'Saving…' : 'Save defaults'}
            </button>
            {saved && !dirty && (
              <span className="text-sm flex items-center gap-2" style={{ color: 'var(--color-jade)' }}>
                Saved ✓
                {updatedAt && (
                  <span className="mono text-[0.72rem]" style={{ color: 'var(--color-faint)' }}>
                    updated {ago(updatedAt)}
                  </span>
                )}
              </span>
            )}
            {!saved && !dirty && updatedAt && (
              <span className="mono text-[0.72rem]" style={{ color: 'var(--color-faint)' }}>
                last saved {ago(updatedAt)}
              </span>
            )}
            {dirty && !saving && (
              <span className="text-sm" style={{ color: 'var(--color-muted)' }}>Unsaved changes.</span>
            )}
          </div>
        </>
      )}

    </div>
  );
}

// Accessible on/off switch: a real button with role="switch" + aria-checked, label tied via id.
function Switch({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  const labelId = useId();
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <div className="min-w-0">
        <div id={labelId} className="text-sm font-medium">{label}</div>
        <p className="text-[0.78rem] mt-0.5" style={{ color: 'var(--color-muted)' }}>{hint}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        onClick={() => onChange(!checked)}
        className="shrink-0"
        style={{
          position: 'relative',
          width: 44,
          height: 26,
          borderRadius: 999,
          marginTop: 2,
          border: '1px solid var(--color-line)',
          background: checked ? 'var(--color-source)' : 'var(--color-line)',
          transition: 'background-color 160ms ease, border-color 160ms ease',
          cursor: 'pointer',
        }}
      >
        <span
          aria-hidden
          style={{
            position: 'absolute',
            top: 2,
            left: checked ? 20 : 2,
            width: 20,
            height: 20,
            borderRadius: '50%',
            background: 'var(--color-bone)',
            transition: 'left 160ms ease',
            boxShadow: '0 1px 3px rgba(8,7,12,0.5)',
          }}
        />
      </button>
    </div>
  );
}
