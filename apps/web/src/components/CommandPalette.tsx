import { useEffect, useMemo, useRef, useState } from 'react';
import { api, type Client, type JobSummary, type SnapshotSummary } from '../api.js';
import type { View } from './Shell.js';

type Kind = 'nav' | 'client' | 'template' | 'build';
interface Item {
  id: string;
  kind: Kind;
  label: string;
  sub: string;
  keywords: string;
  run: () => void;
}

const KIND_META: Record<Kind, { tag: string; color: string }> = {
  nav: { tag: 'go', color: 'var(--color-muted)' },
  client: { tag: 'client', color: 'var(--color-client)' },
  template: { tag: 'template', color: 'var(--color-source)' },
  build: { tag: 'build', color: 'var(--color-jade)' },
};

const NAV: { v: View; label: string; kw: string }[] = [
  { v: 'today', label: 'Today', kw: 'home dashboard overview now' },
  { v: 'library', label: 'Library', kw: 'snapshots templates captures' },
  { v: 'build', label: 'Build', kw: 'rebrand ship console' },
  { v: 'queue', label: 'Queue', kw: 'jobs builds running' },
  { v: 'clients', label: 'Clients', kw: 'creators customers' },
  { v: 'activity', label: 'Activity', kw: 'feed log events live' },
  { v: 'economics', label: 'Economics', kw: 'costs earnings money pricing revenue' },
  { v: 'operations', label: 'Status', kw: 'health audit webhooks ops' },
  { v: 'preferences', label: 'Defaults', kw: 'settings preferences prefs config' },
  { v: 'invite', label: 'Invite', kw: 'bot oauth permissions' },
  { v: 'setup', label: 'Setup', kw: 'onboarding getting started' },
];

const fmtAgo = (iso: string): string => {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

/**
 * ⌘K / Ctrl-K command palette — search across screens, clients, templates and builds, and jump or act
 * in one keystroke. The operator-speed upgrade every serious tool has. Data is fetched (owner-scoped)
 * on open; results rank exact/prefix over substring and are grouped by kind. Fully keyboard-driven.
 */
export function CommandPalette({
  go,
  onBuildSnapshot,
  onOpenHandover,
}: {
  go: (v: View) => void;
  onBuildSnapshot: (snapshotId: string) => void;
  onOpenHandover: (jobId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [data, setData] = useState<{ clients: Client[]; snaps: SnapshotSummary[]; jobs: JobSummary[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // ⌘K / Ctrl-K toggles; Esc closes. Registered once, global.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // On open: reset, focus, and fetch the searchable corpus (owner-scoped, best-effort).
  useEffect(() => {
    if (!open) return;
    setQ('');
    setActive(0);
    setTimeout(() => inputRef.current?.focus(), 0);
    setLoading(true);
    Promise.all([api.clients().catch(() => []), api.snapshots().catch(() => []), api.jobs().catch(() => [])])
      .then(([clients, snaps, jobs]) => setData({ clients, snaps, jobs }))
      .finally(() => setLoading(false));
  }, [open]);

  const items = useMemo<Item[]>(() => {
    const nav: Item[] = NAV.map((n) => ({ id: `nav:${n.v}`, kind: 'nav', label: n.label, sub: 'Jump to screen', keywords: `${n.label} ${n.kw}`, run: () => go(n.v) }));
    const clients: Item[] = (data?.clients ?? []).map((c) => ({ id: `c:${c.id}`, kind: 'client', label: c.creatorName, sub: c.handle ? `@${c.handle}` : 'Client', keywords: `${c.creatorName} ${c.handle}`, run: () => go('clients') }));
    const snaps: Item[] = (data?.snaps ?? []).map((s) => ({ id: `s:${s.id}`, kind: 'template', label: s.name, sub: `v${s.version}${s.isTemplate ? ' · template' : ''}`, keywords: `${s.name} ${s.tags.join(' ')}`, run: () => onBuildSnapshot(s.id) }));
    const builds: Item[] = (data?.jobs ?? []).map((j) => ({ id: `j:${j.id}`, kind: 'build', label: j.snapshotName ?? j.clientName ?? 'Build', sub: `${j.status}${j.clientName ? ` · ${j.clientName}` : ''} · ${fmtAgo(j.createdAt)}`, keywords: `${j.snapshotName ?? ''} ${j.clientName ?? ''} ${j.status}`, run: () => onOpenHandover(j.id) }));
    return [...nav, ...clients, ...snaps, ...builds];
  }, [data, go, onBuildSnapshot, onOpenHandover]);

  const results = useMemo<Item[]>(() => {
    const term = q.trim().toLowerCase();
    if (!term) {
      // Empty query: nav + the most recent handful of builds/clients, so it's useful on open.
      const recentBuilds = items.filter((i) => i.kind === 'build').slice(0, 5);
      const recentClients = items.filter((i) => i.kind === 'client').slice(0, 4);
      return [...items.filter((i) => i.kind === 'nav'), ...recentClients, ...recentBuilds];
    }
    const scored = items
      .map((i) => {
        const hay = `${i.label} ${i.keywords}`.toLowerCase();
        const lab = i.label.toLowerCase();
        if (!hay.includes(term)) return null;
        const score = lab === term ? 0 : lab.startsWith(term) ? 1 : hay.startsWith(term) ? 2 : 3;
        return { i, score };
      })
      .filter((x): x is { i: Item; score: number } => x !== null)
      .sort((a, b) => a.score - b.score);
    return scored.slice(0, 24).map((x) => x.i);
  }, [q, items]);

  // Keep the active index in range + scrolled into view as results change.
  useEffect(() => { setActive((a) => Math.min(a, Math.max(0, results.length - 1))); }, [results.length]);
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') return setOpen(false);
    if (e.key === 'ArrowDown') { e.preventDefault(); return setActive((a) => Math.min(results.length - 1, a + 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); return setActive((a) => Math.max(0, a - 1)); }
    if (e.key === 'Enter') {
      e.preventDefault();
      const hit = results[active];
      if (hit) { hit.run(); setOpen(false); }
    }
  };

  let lastKind: Kind | null = null;
  return (
    <div
      role="presentation"
      onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
      style={{ position: 'fixed', inset: 0, zIndex: 90, display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: '12vh 16px 16px', background: 'rgba(8,7,12,0.62)', backdropFilter: 'blur(3px)' }}
    >
      <div
        role="dialog"
        aria-label="Command palette"
        className="panel rise"
        style={{ width: '100%', maxWidth: 560, overflow: 'hidden', boxShadow: '0 40px 90px -30px rgba(0,0,0,0.7)' }}
        onKeyDown={onKeyDown}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderBottom: '1px solid var(--color-line-soft)' }}>
          <span aria-hidden style={{ color: 'var(--color-faint)', fontFamily: 'var(--font-mono)' }}>⌕</span>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search clients, templates, builds — or jump to a screen…"
            aria-label="Search Disco"
            style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'var(--color-bone)', fontSize: '0.98rem', fontFamily: 'var(--font-body)' }}
          />
          <kbd className="mono" style={{ fontSize: '0.62rem', color: 'var(--color-faint)', border: '1px solid var(--color-line)', borderRadius: 6, padding: '1px 6px' }}>esc</kbd>
        </div>

        <div ref={listRef} role="listbox" aria-label="Results" style={{ maxHeight: '52vh', overflowY: 'auto', padding: '6px' }}>
          {results.length === 0 ? (
            <div className="text-sm" style={{ color: 'var(--color-faint)', padding: '24px 12px', textAlign: 'center' }}>
              {loading ? 'Searching…' : `No matches for “${q.trim()}”`}
            </div>
          ) : (
            results.map((r, idx) => {
              const meta = KIND_META[r.kind];
              const header = r.kind !== lastKind ? (lastKind = r.kind, r.kind) : null;
              return (
                <div key={r.id}>
                  {header && (
                    <div className="eyebrow" style={{ padding: '10px 10px 5px', color: 'var(--color-faint)' }}>
                      {header === 'nav' ? 'go to' : header === 'template' ? 'templates' : `${header}s`}
                    </div>
                  )}
                  <button
                    data-idx={idx}
                    role="option"
                    aria-selected={idx === active}
                    onMouseMove={() => setActive(idx)}
                    onClick={() => { r.run(); setOpen(false); }}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left',
                      padding: '9px 10px', borderRadius: 9, border: 'none', cursor: 'pointer',
                      background: idx === active ? 'var(--color-line)' : 'transparent', color: 'var(--color-bone)',
                    }}
                  >
                    <span className="mono" style={{ fontSize: '0.58rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: meta.color, border: `1px solid color-mix(in srgb, ${meta.color} 35%, transparent)`, borderRadius: 999, padding: '2px 7px', flex: 'none', minWidth: 58, textAlign: 'center' }}>
                      {meta.tag}
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.9rem' }}>{r.label}</span>
                      <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.72rem', color: 'var(--color-faint)' }}>{r.sub}</span>
                    </span>
                    {idx === active && <span aria-hidden className="mono" style={{ fontSize: '0.66rem', color: 'var(--color-faint)' }}>↵</span>}
                  </button>
                </div>
              );
            })
          )}
        </div>

        <div className="mono" style={{ display: 'flex', gap: 14, padding: '9px 14px', borderTop: '1px solid var(--color-line-soft)', fontSize: '0.66rem', color: 'var(--color-faint)' }}>
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}
