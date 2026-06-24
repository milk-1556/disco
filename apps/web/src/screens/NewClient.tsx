import { useState } from 'react';
import { api, type Client } from '../api.js';

interface TermSwap {
  from: string;
  to: string;
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export function NewClient({ onCreated }: { onCreated: (client: Client) => void }) {
  const [creatorName, setCreatorName] = useState('');
  const [handle, setHandle] = useState('');
  const [brandColors, setBrandColors] = useState<string[]>(['']);
  const [links, setLinks] = useState<string[]>(['']);
  const [termSwaps, setTermSwaps] = useState<TermSwap[]>([{ from: '', to: '' }]);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // ── repeatable-list helpers ──
  function setColor(i: number, v: string) {
    setBrandColors((xs) => xs.map((x, j) => (j === i ? v : x)));
  }
  function setLink(i: number, v: string) {
    setLinks((xs) => xs.map((x, j) => (j === i ? v : x)));
  }
  function setSwap(i: number, key: keyof TermSwap, v: string) {
    setTermSwaps((xs) => xs.map((x, j) => (j === i ? { ...x, [key]: v } : x)));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!creatorName.trim()) {
      setErr('A creator name is required.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const payload = {
        creatorName: creatorName.trim(),
        handle: handle.trim(),
        brandColors: brandColors.map((c) => c.trim()).filter(Boolean),
        links: links.map((l) => l.trim()).filter(Boolean),
        termSwaps: termSwaps
          .map((s) => ({ from: s.from.trim(), to: s.to.trim() }))
          .filter((s) => s.from || s.to),
        notes: notes.trim(),
      };
      const client = await api.addClient(payload as Partial<Client>);
      onCreated(client);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : String(e2));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="px-4 py-6 md:p-8 max-w-3xl rise">
      <header className="mb-7">
        <div className="eyebrow mb-2">new client</div>
        <h1 className="text-2xl">
          The front door of every <span className="transform-text">rebrand</span>.
        </h1>
        <p className="text-sm mt-2 max-w-xl" style={{ color: 'var(--color-muted)' }}>
          Capture a creator's brand once — name, colors, links, and the literal term swaps — so any
          snapshot can be transformed into their identity in a single build.
        </p>
      </header>

      <form onSubmit={submit} className="panel p-6" style={{ maxWidth: 640 }}>
        {/* ── identity ── */}
        <div className="eyebrow mb-3">identity</div>
        <div className="grid gap-4 sm:grid-cols-2 mb-6">
          <div>
            <label className="label" htmlFor="nc-creator">
              Creator name <span style={{ color: 'var(--color-client)' }}>*</span>
            </label>
            <input
              id="nc-creator"
              className="input mt-1.5"
              placeholder="Nova Collective"
              value={creatorName}
              onChange={(e) => setCreatorName(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="nc-handle">
              Handle
            </label>
            <input
              id="nc-handle"
              className="input mono mt-1.5"
              placeholder="@creator"
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
            />
          </div>
        </div>

        {/* ── brand colors ── */}
        <div className="flex items-center justify-between mb-3">
          <div className="eyebrow">brand colors</div>
          <span className="label">hex, #rrggbb</span>
        </div>
        <div className="flex flex-col gap-2 mb-2">
          {brandColors.map((c, i) => {
            const valid = HEX_RE.test(c.trim());
            return (
              <div key={i} className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="shrink-0"
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 7,
                    border: '1px solid var(--color-line)',
                    background: valid ? c.trim() : 'transparent',
                  }}
                />
                <input
                  className="input mono"
                  placeholder="#7c6cf0"
                  value={c}
                  onChange={(e) => setColor(i, e.target.value)}
                  aria-label={`Brand color ${i + 1}`}
                />
                {brandColors.length > 1 && (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ padding: '0.5rem 0.7rem' }}
                    onClick={() => setBrandColors((xs) => xs.filter((_, j) => j !== i))}
                    aria-label={`Remove color ${i + 1}`}
                  >
                    ×
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <button
          type="button"
          className="btn btn-ghost text-sm mb-6"
          onClick={() => setBrandColors((xs) => [...xs, ''])}
        >
          + add color
        </button>

        {/* ── links ── */}
        <div className="flex items-center justify-between mb-3">
          <div className="eyebrow">links</div>
          <span className="label">Whop · affiliate · socials</span>
        </div>
        <div className="flex flex-col gap-2 mb-2">
          {links.map((l, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                className="input mono"
                type="url"
                placeholder="https://whop.com/nova"
                value={l}
                onChange={(e) => setLink(i, e.target.value)}
                aria-label={`Link ${i + 1}`}
              />
              {links.length > 1 && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ padding: '0.5rem 0.7rem' }}
                  onClick={() => setLinks((xs) => xs.filter((_, j) => j !== i))}
                  aria-label={`Remove link ${i + 1}`}
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
        <button
          type="button"
          className="btn btn-ghost text-sm mb-6"
          onClick={() => setLinks((xs) => [...xs, ''])}
        >
          + add link
        </button>

        {/* ── term swaps ── */}
        <div className="flex items-center justify-between mb-3">
          <div className="eyebrow">term swaps</div>
          <span className="label">find → replace</span>
        </div>
        <div className="flex flex-col gap-2 mb-2">
          {termSwaps.map((s, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                className="input"
                placeholder="OldName"
                value={s.from}
                onChange={(e) => setSwap(i, 'from', e.target.value)}
                aria-label={`Swap ${i + 1} find`}
                style={{ color: 'var(--color-source)' }}
              />
              <span aria-hidden className="shrink-0" style={{ color: 'var(--color-faint)' }}>
                →
              </span>
              <input
                className="input"
                placeholder="NovaName"
                value={s.to}
                onChange={(e) => setSwap(i, 'to', e.target.value)}
                aria-label={`Swap ${i + 1} replace`}
                style={{ color: 'var(--color-client)' }}
              />
              {termSwaps.length > 1 && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ padding: '0.5rem 0.7rem' }}
                  onClick={() => setTermSwaps((xs) => xs.filter((_, j) => j !== i))}
                  aria-label={`Remove swap ${i + 1}`}
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
        <button
          type="button"
          className="btn btn-ghost text-sm mb-6"
          onClick={() => setTermSwaps((xs) => [...xs, { from: '', to: '' }])}
        >
          + add swap
        </button>

        {/* ── notes ── */}
        <div className="eyebrow mb-3">notes</div>
        <label className="sr-only" htmlFor="nc-notes">
          Notes
        </label>
        <textarea
          id="nc-notes"
          className="input mb-6"
          rows={3}
          placeholder="Anything the builder should know — tone, do-not-touch channels, asset links…"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          style={{ resize: 'vertical', fontFamily: 'var(--font-body)' }}
        />

        {err && (
          <div className="panel-soft p-3 mb-4 text-sm" style={{ color: 'var(--color-danger)' }}>
            {err}
          </div>
        )}

        <div className="flex items-center gap-3">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save client →'}
          </button>
          <span className="label">
            <span style={{ color: 'var(--color-client)' }}>*</span> required
          </span>
        </div>
      </form>
    </div>
  );
}
