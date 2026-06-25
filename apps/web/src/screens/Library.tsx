import { useEffect, useMemo, useRef, useState } from 'react';
import { api, type JoinedGuild, type MarketplaceItem, type ScanPreview, type SnapshotSummary, type StarterPack } from '../api.js';
import { Modal } from '../components/Modal.js';
import { SkeletonCard } from '../components/Skeleton.js';
import { SnapshotTimeline } from '../components/SnapshotTimeline.js';
import { cx, shortId } from '../util.js';

const COUNT_ORDER = ['channels', 'roles', 'categories', 'emojis', 'automod', 'bots'];
type Sort = 'used' | 'captured' | 'name';
type Category = 'all' | 'templates' | 'captures';

const STALE_DAYS = 30;
const DAY_MS = 86_400_000;
// Days since capture; null when unknown/unparseable.
function ageDays(capturedAt: string): number | null {
  const t = Date.parse(capturedAt);
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / DAY_MS);
}

// Deterministic visual identity for a template — same name always renders the same.
// FNV-1a-ish hash → stable hue blended between the source (violet) and client (rose) brand axes.
function nameHash(name: string): number {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// A stable accent color on the product's violet→rose brand arc (258°…330°).
function brandAccent(name: string): string {
  const h = nameHash(name);
  const arc = 258 + ((h >>> 8) % 73); // 258 (source violet) … 330 (client rose)
  const sat = 58 + ((h >>> 16) % 18); // 58..75
  const light = 60 + ((h >>> 20) % 10); // 60..69
  return `hsl(${arc} ${sat}% ${light}%)`;
}

// Tiny structure glyph: a few bars sized by the template's counts, capped for sanity.
function structureBars(counts: Record<string, number>): { k: string; h: number }[] {
  const keys = ['channels', 'roles', 'categories', 'emojis', 'bots'];
  const vals = keys.map((k) => counts[k] ?? 0);
  const max = Math.max(1, ...vals);
  return keys.map((k) => ({ k, h: Math.round(18 + (Math.min(counts[k] ?? 0, max) / max) * 30) }));
}

function CardThumb({ name, counts }: { name: string; counts: Record<string, number> }) {
  const accent = brandAccent(name);
  const bars = structureBars(counts);
  const initials = name.replace(/[^a-z0-9 ]/gi, '').trim().slice(0, 2).toUpperCase() || '··';
  return (
    <div
      aria-hidden
      className="mb-3"
      style={{
        height: 52,
        borderRadius: 10,
        overflow: 'hidden',
        position: 'relative',
        border: '1px solid var(--color-line-soft)',
        background: `linear-gradient(115deg, ${accent} 0%, color-mix(in oklab, ${accent} 35%, var(--color-source)) 55%, color-mix(in oklab, var(--color-source) 60%, #08070c) 100%)`,
      }}
    >
      {/* structure glyph: bars sized by counts */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'flex-end',
          gap: 4,
          padding: '0 12px 9px',
          justifyContent: 'flex-end',
        }}
      >
        {bars.map((b) => (
          <div
            key={b.k}
            title={`${b.k}: ${counts[b.k] ?? 0}`}
            style={{ width: 7, height: b.h, borderRadius: 3, background: 'rgba(255,255,255,0.62)' }}
          />
        ))}
      </div>
      {/* template initials, glassy */}
      <div
        className="mono"
        style={{
          position: 'absolute',
          left: 12,
          top: '50%',
          transform: 'translateY(-50%)',
          fontSize: '0.92rem',
          letterSpacing: '0.04em',
          fontWeight: 600,
          color: 'rgba(255,255,255,0.95)',
          textShadow: '0 1px 6px rgba(8,7,12,0.45)',
        }}
      >
        {initials}
      </div>
    </div>
  );
}

export function Library({ onBuild, onCompare }: { onBuild: (snapshotId: string) => void; onCompare: () => void }) {
  const [snaps, setSnaps] = useState<SnapshotSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [tag, setTag] = useState<string | null>(null);
  const [category, setCategory] = useState<Category>('all');
  const [sort, setSort] = useState<Sort>('used');
  const [editing, setEditing] = useState<string | null>(null);
  const [timelineFor, setTimelineFor] = useState<{ templateName: string; sourceGuildId: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Starter packs (#15): curated, sellable templates to clone into the library.
  const [packsOpen, setPacksOpen] = useState(false);
  const [packs, setPacks] = useState<StarterPack[] | null>(null);
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [importingPack, setImportingPack] = useState<string | null>(null);
  async function openPacks() {
    setPacksOpen(true);
    if (!packs) setPacks(await api.starterPacks().catch(() => []));
  }
  async function importPack(key: string) {
    setImportingPack(key);
    try {
      await api.importStarterPack(key);
      await load();
      setPacksOpen(false);
      setPreviewKey(null);
      setNote('Starter pack added to your library as a template.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setImportingPack(null);
    }
  }

  // Snapshot composability (#5): merge two selected snapshots into a composite template.
  const [merge, setMerge] = useState<{ aId: string; bId: string; aName: string; bName: string; conflicts: { kind: string; name: string }[]; resolutions: Record<string, 'a' | 'b'>; name: string; busy: boolean } | null>(null);
  async function openMerge(ids: string[]) {
    const [aId, bId] = ids;
    const a = snaps.find((s) => s.id === aId);
    const b = snaps.find((s) => s.id === bId);
    if (!a || !b) return;
    try {
      const { conflicts } = await api.mergePreview(aId, bId);
      setMerge({ aId, bId, aName: a.name, bName: b.name, conflicts, resolutions: {}, name: `${a.name} + ${b.name}`, busy: false });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }
  async function doMerge() {
    if (!merge) return;
    setMerge({ ...merge, busy: true });
    try {
      await api.mergeSnapshots(merge.aId, merge.bId, merge.resolutions, merge.name.trim() || undefined);
      await load();
      exitSelectMode();
      setMerge(null);
      setNote('Composite template created in your library.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setMerge((m) => (m ? { ...m, busy: false } : m));
    }
  }

  // Marketplace (#1 web): browse + clone shared operator templates into the library.
  const [marketOpen, setMarketOpen] = useState(false);
  const [market, setMarket] = useState<MarketplaceItem[] | null>(null);
  const [marketErr, setMarketErr] = useState<string | null>(null);
  const [marketPreview, setMarketPreview] = useState<string | null>(null);
  const [cloningId, setCloningId] = useState<string | null>(null);
  async function openMarket() {
    setMarketOpen(true);
    setMarketPreview(null);
    if (!market) {
      setMarketErr(null);
      try {
        setMarket(await api.marketplace());
      } catch (e) {
        setMarketErr(e instanceof Error ? e.message : String(e));
        setMarket([]);
      }
    }
  }
  async function cloneFromMarket(templateId: string) {
    setCloningId(templateId);
    setMarketErr(null);
    try {
      const r = await api.cloneMarketplace(templateId);
      await load();
      setMarketOpen(false);
      setMarketPreview(null);
      setNote(`Added “${r.name}” (v${r.version}) to your library as a template.`);
      setTimeout(() => setNote(null), 5000);
    } catch (e) {
      setMarketErr(e instanceof Error ? e.message : String(e));
    } finally {
      setCloningId(null);
    }
  }

  // Toggle a template's marketplace visibility (structure-only share), then reload.
  const [sharingId, setSharingId] = useState<string | null>(null);
  async function toggleShare(s: SnapshotSummary) {
    setSharingId(s.id);
    try {
      await api.updateSnapshot(s.id, { shared: !s.shared });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSharingId(null);
    }
  }

  // Bulk multi-select management.
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  async function load() {
    setSnaps(await api.snapshots());
  }
  useEffect(() => {
    load()
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  const [note, setNote] = useState<string | null>(null);

  // Import-a-server flow: pick a guild the bot is in → capture it into the library.
  const [importOpen, setImportOpen] = useState(false);
  const [guilds, setGuilds] = useState<JoinedGuild[] | null>(null);
  const [guildsLive, setGuildsLive] = useState(false);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [importErr, setImportErr] = useState<string | null>(null);

  async function openImport() {
    setImportOpen(true);
    setGuilds(null);
    setImportErr(null);
    try {
      const r = await api.guilds();
      setGuilds(r.guilds);
      setGuildsLive(r.live);
    } catch (e) {
      setImportErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function importGuild(g: JoinedGuild) {
    setImportingId(g.id);
    setImportErr(null);
    try {
      const r = await api.capture({ sourceGuildId: g.id });
      setNote(r.unchanged ? `${g.name} is already in your library (v${r.version}, no changes).` : `Imported ${r.name} into your library.`);
      setTimeout(() => setNote(null), 5000);
      await load();
      setImportOpen(false);
    } catch (e) {
      setImportErr(e instanceof Error ? e.message : String(e));
    } finally {
      setImportingId(null);
    }
  }

  // Scan-a-server flow: read-only preview of what an import would pull from a live
  // server, BEFORE persisting it as a library template. Helps the operator eyeball
  // the structure (and any heads-up caveats) before recreating it on a client server.
  const [scanOpen, setScanOpen] = useState(false);
  const [scanGuilds, setScanGuilds] = useState<JoinedGuild[] | null>(null);
  const [scanGuildsLive, setScanGuildsLive] = useState(false);
  const [scanSel, setScanSel] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scanPreview, setScanPreview] = useState<ScanPreview | null>(null);
  const [scanErr, setScanErr] = useState<string | null>(null);
  const [scanSaving, setScanSaving] = useState(false);

  async function openScan() {
    setScanOpen(true);
    setScanGuilds(null);
    setScanSel('');
    setScanPreview(null);
    setScanErr(null);
    try {
      const r = await api.guilds();
      setScanGuilds(r.guilds);
      setScanGuildsLive(r.live);
      setScanSel(r.guilds[0]?.id ?? '');
    } catch (e) {
      setScanErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function runScan() {
    setScanning(true);
    setScanErr(null);
    setScanPreview(null);
    try {
      setScanPreview(await api.scanGuild(scanSel || undefined));
    } catch (e) {
      setScanErr(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  }

  async function saveScan() {
    if (!scanPreview) return;
    setScanSaving(true);
    setScanErr(null);
    try {
      const r = await api.capture({ sourceGuildId: scanPreview.sourceGuildId });
      setNote(r.unchanged ? `${r.name} is already in your library (v${r.version}, no changes).` : `Saved ${r.name} as a template in your library.`);
      setTimeout(() => setNote(null), 5000);
      await load();
      setScanOpen(false);
    } catch (e) {
      setScanErr(e instanceof Error ? e.message : String(e));
    } finally {
      setScanSaving(false);
    }
  }

  async function patch(id: string, p: Parameters<typeof api.updateSnapshot>[1]) {
    setSnaps((prev) => prev.map((s) => (s.id === id ? { ...s, ...p } : s))); // optimistic
    try {
      await api.updateSnapshot(id, p);
    } catch {
      await load();
    }
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function exitSelectMode() {
    setSelectMode(false);
    setSelected(new Set());
  }

  // Apply a patch to every selected snapshot (optimistic), then reconcile on failure.
  async function bulkPatch(p: Parameters<typeof api.updateSnapshot>[1] | ((s: SnapshotSummary) => Parameters<typeof api.updateSnapshot>[1])) {
    const ids = [...selected];
    if (ids.length === 0) return;
    setBulkBusy(true);
    const byId = new Map(snaps.map((s) => [s.id, s]));
    const patches = new Map(ids.map((id) => [id, typeof p === 'function' ? p(byId.get(id)!) : p]));
    setSnaps((prev) => prev.map((s) => (patches.has(s.id) ? { ...s, ...patches.get(s.id) } : s)));
    try {
      await Promise.all(ids.map((id) => api.updateSnapshot(id, patches.get(id)!)));
    } catch {
      await load();
    } finally {
      setBulkBusy(false);
    }
  }

  async function bulkDelete() {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (!window.confirm(`Delete ${ids.length} snapshot${ids.length === 1 ? '' : 's'}? This can’t be undone.`)) return;
    setBulkBusy(true);
    setErr(null);
    try {
      await Promise.all(ids.map((id) => api.deleteSnapshot(id)));
      await load();
      exitSelectMode();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      await load();
    } finally {
      setBulkBusy(false);
    }
  }

  async function bulkTag() {
    const raw = window.prompt('Add a tag to the selected snapshots:');
    const t = raw?.trim().toLowerCase();
    if (!t) return;
    await bulkPatch((s) => ({ tags: [...new Set([...s.tags, t])] }));
  }

  async function exportOne(s: SnapshotSummary) {
    setErr(null);
    try {
      const bundle = await api.exportBundle(s.id);
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${s.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'snapshot'}.discobundle`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  // Two-step import: parse + PREVIEW the bundle structure, then confirm → import (→ optionally build).
  const [pending, setPending] = useState<{ raw: unknown; name: string; counts: Record<string, number>; hasConfig: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);

  async function importFile(file: File) {
    setErr(null);
    try {
      const raw = JSON.parse(await file.text());
      const snap = raw?.snapshot;
      if (!raw?.discobundle || !snap) throw new Error('Not a .discobundle file.');
      setPending({
        raw,
        name: raw.name || snap.guild?.name || 'imported',
        counts: {
          roles: snap.roles?.length ?? 0,
          channels: snap.channels?.length ?? 0,
          categories: snap.categories?.length ?? 0,
          emojis: snap.emojis?.length ?? 0,
          automod: snap.automod?.length ?? 0,
          bots: snap.bots?.length ?? 0,
        },
        hasConfig: !!raw.config,
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function confirmImport(thenBuild: boolean) {
    if (!pending) return;
    setErr(null);
    try {
      const r = await api.importBundle(pending.raw);
      setPending(null);
      await load();
      if (thenBuild) onBuild(r.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  const allTags = useMemo(() => [...new Set(snaps.flatMap((s) => s.tags).filter(Boolean))].sort(), [snaps]);
  const visible = useMemo(() => {
    let xs = snaps;
    if (search.trim()) {
      const q = search.toLowerCase();
      xs = xs.filter((s) => s.name.toLowerCase().includes(q) || s.tags.some((t) => t.includes(q)) || s.note.toLowerCase().includes(q));
    }
    if (tag) xs = xs.filter((s) => s.tags.includes(tag));
    if (category === 'templates') xs = xs.filter((s) => s.isTemplate);
    else if (category === 'captures') xs = xs.filter((s) => !s.isTemplate);
    const sorted = [...xs].sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name);
      if (sort === 'captured') return b.capturedAt.localeCompare(a.capturedAt);
      return (b.lastUsedAt ?? '').localeCompare(a.lastUsedAt ?? ''); // used
    });
    // favorites always float to the top
    return sorted.sort((a, b) => Number(b.favorite) - Number(a.favorite));
  }, [snaps, search, tag, category, sort]);

  // Cheap per-category counts honoring the active search + tag filters (but not the
  // category itself), so each segment shows how many snapshots it would reveal.
  const catCounts = useMemo(() => {
    let xs = snaps;
    if (search.trim()) {
      const q = search.toLowerCase();
      xs = xs.filter((s) => s.name.toLowerCase().includes(q) || s.tags.some((t) => t.includes(q)) || s.note.toLowerCase().includes(q));
    }
    if (tag) xs = xs.filter((s) => s.tags.includes(tag));
    let templates = 0;
    for (const s of xs) if (s.isTemplate) templates++;
    return { all: xs.length, templates, captures: xs.length - templates };
  }, [snaps, search, tag]);

  return (
    <div
      className="px-4 py-6 md:p-8 max-w-6xl rise"
      style={dragging ? { outline: '2px dashed var(--color-source)', outlineOffset: -8, borderRadius: 16 } : undefined}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const f = e.dataTransfer.files?.[0];
        if (f) void importFile(f);
      }}
    >
      {timelineFor && (
        <SnapshotTimeline templateName={timelineFor.templateName} sourceGuildId={timelineFor.sourceGuildId} onClose={() => setTimelineFor(null)} />
      )}

      {merge && (
        <Modal title="Merge into a composite template" onClose={() => setMerge(null)}>
          <p className="text-sm mb-4" style={{ color: 'var(--color-muted)' }}>
            Combining <span style={{ color: 'var(--color-source)' }}>{merge.aName}</span> + <span style={{ color: 'var(--color-client)' }}>{merge.bName}</span>. Unique
            channels/roles from both are kept; for any name that appears in both, pick which version wins.
          </p>
          <label className="label">Composite name</label>
          <input className="input mb-4 mt-1" value={merge.name} onChange={(e) => setMerge({ ...merge, name: e.target.value })} />
          {merge.conflicts.length === 0 ? (
            <div className="panel-soft p-3 mb-4 text-sm" style={{ color: 'var(--color-jade)' }}>✓ No name collisions — a clean union of both.</div>
          ) : (
            <div className="mb-4">
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <div className="label" style={{ flex: 1, minWidth: 120 }}>{merge.conflicts.length} name collision{merge.conflicts.length === 1 ? '' : 's'} — pick a winner</div>
                {merge.conflicts.length > 3 && (
                  <div className="flex gap-1">
                    {(['a', 'b'] as const).map((side) => (
                      <button
                        key={side}
                        className="btn btn-ghost text-xs"
                        title={`Keep every collision from ${side === 'a' ? merge.aName : merge.bName}`}
                        onClick={() => setMerge({ ...merge, resolutions: Object.fromEntries(merge.conflicts.map((c) => [`${c.kind}:${c.name}`, side])) })}
                      >
                        All {(side === 'a' ? merge.aName : merge.bName).slice(0, 12)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="space-y-1.5" style={{ maxHeight: 280, overflowY: 'auto' }}>
                {merge.conflicts.map((c) => {
                  const key = `${c.kind}:${c.name}`;
                  const pick = merge.resolutions[key] ?? 'a';
                  return (
                    <div key={key} className="panel-soft px-3 py-2 flex items-center gap-2 flex-wrap">
                      <span className="chip" style={{ color: 'var(--color-faint)' }}>{c.kind.replace(/s$/, '')}</span>
                      <span className="text-sm truncate" style={{ flex: 1, minWidth: 80 }}>{c.name}</span>
                      <div className="flex gap-1">
                        {(['a', 'b'] as const).map((side) => (
                          <button
                            key={side}
                            className="btn text-xs"
                            aria-pressed={pick === side}
                            onClick={() => setMerge({ ...merge, resolutions: { ...merge.resolutions, [key]: side } })}
                            style={pick === side ? { background: side === 'a' ? 'var(--color-source)' : 'var(--color-client)', borderColor: 'transparent', color: 'var(--color-ink)' } : undefined}
                          >
                            {side === 'a' ? merge.aName.slice(0, 14) : merge.bName.slice(0, 14)}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <button className="btn btn-primary w-full justify-center" disabled={merge.busy} onClick={doMerge}>
            {merge.busy ? 'Merging…' : '⊕ Create composite template'}
          </button>
        </Modal>
      )}

      {packsOpen && (
        <Modal title="Starter packs" onClose={() => { setPacksOpen(false); setPreviewKey(null); }}>
          <p className="text-sm mb-4" style={{ color: 'var(--color-muted)' }}>
            Curated, sellable server blueprints. Add one to your library as a reusable template, then rebrand &amp; build it for a client.
          </p>
          {!packs ? (
            <div className="text-sm" style={{ color: 'var(--color-faint)' }}>Loading packs…</div>
          ) : packs.length === 0 ? (
            <div className="text-sm" style={{ color: 'var(--color-faint)' }}>No starter packs available.</div>
          ) : (
            <div className="space-y-3">
              {packs.map((p) => {
                const open = previewKey === p.key;
                return (
                  <div key={p.key} className="panel-soft p-4">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-base font-medium" style={{ fontFamily: 'var(--font-display)' }}>{p.title}</span>
                          <span className="chip chip-source">{p.niche}</span>
                        </div>
                        <p className="text-sm mt-1" style={{ color: 'var(--color-muted)' }}>{p.pitch}</p>
                        <div className="text-[0.72rem] mono mt-2" style={{ color: 'var(--color-faint)' }}>
                          {p.counts.categories} categories · {p.counts.channels} channels · {p.counts.roles} roles · {p.counts.emojis} emojis
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button className="btn btn-ghost text-xs" onClick={() => setPreviewKey(open ? null : p.key)} aria-expanded={open}>
                          {open ? 'Hide' : 'Preview'}
                        </button>
                        <button className="btn btn-primary text-xs" disabled={importingPack === p.key} onClick={() => importPack(p.key)}>
                          {importingPack === p.key ? 'Adding…' : '＋ Add to library'}
                        </button>
                      </div>
                    </div>
                    {open && (
                      <div className="mt-3 pt-3 grid gap-3" style={{ borderTop: '1px solid var(--color-line)', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
                        <div>
                          <div className="label mb-1">categories</div>
                          <div className="flex flex-wrap gap-1">{p.categories.map((c) => <span key={c} className="chip">{c}</span>)}</div>
                        </div>
                        <div>
                          <div className="label mb-1">channels</div>
                          <div className="flex flex-wrap gap-1">{p.sampleChannels.map((c) => <span key={c} className="chip">#{c}</span>)}{p.counts.channels > p.sampleChannels.length && <span className="chip" style={{ color: 'var(--color-faint)' }}>+{p.counts.channels - p.sampleChannels.length}</span>}</div>
                        </div>
                        <div>
                          <div className="label mb-1">roles</div>
                          <div className="flex flex-wrap gap-1">{p.roles.map((rr) => <span key={rr} className="chip chip-gold">{rr}</span>)}</div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Modal>
      )}

      {marketOpen && (
        <Modal title="Operator marketplace" onClose={() => { setMarketOpen(false); setMarketPreview(null); }}>
          <p className="text-sm mb-4" style={{ color: 'var(--color-muted)' }}>
            Server structures other operators have shared — channels, roles &amp; permissions, no private messages or notes. Add one to your library, then rebrand &amp; build it for a client.
          </p>
          {marketErr && (
            <div className="panel-soft p-3 mb-3 text-sm flex items-center justify-between gap-3" style={{ color: 'var(--color-danger)' }}>
              <span>Couldn’t reach the marketplace — {marketErr}</span>
              <button className="btn btn-ghost shrink-0" disabled={!!cloningId} onClick={openMarket}>Retry</button>
            </div>
          )}
          {!market ? (
            <div className="text-sm" style={{ color: 'var(--color-faint)' }}>Loading shared templates…</div>
          ) : market.length === 0 && !marketErr ? (
            <div className="panel-soft p-6 text-center text-sm" style={{ color: 'var(--color-muted)' }}>
              Nothing shared yet. Be the first — flip <strong>🛒 Share</strong> on one of your templates and it’ll show up here for every operator.
            </div>
          ) : (
            <div className="space-y-3">
              {market.map((m) => {
                const open = marketPreview === m.templateId;
                const extraChannels = m.counts.channels - m.sampleChannels.length;
                return (
                  <div key={m.templateId} className="panel-soft p-4">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-base font-medium" style={{ fontFamily: 'var(--font-display)' }}>{m.name}</span>
                          <span className="chip chip-source">v{m.version}</span>
                          {m.mine && <span className="chip chip-jade">yours</span>}
                        </div>
                        <p className="text-sm mt-1" style={{ color: 'var(--color-muted)' }}>
                          {m.mine ? 'shared by you' : <>shared by <strong>{m.sourceOperator}</strong></>}
                        </p>
                        <div className="text-[0.72rem] mono mt-2" style={{ color: 'var(--color-faint)' }}>
                          {m.counts.categories} categories · {m.counts.channels} channels · {m.counts.roles} roles · {m.counts.emojis} emojis · {m.counts.automod} automod
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button className="btn btn-ghost text-xs" onClick={() => setMarketPreview(open ? null : m.templateId)} aria-expanded={open}>
                          {open ? 'Hide' : 'Preview'}
                        </button>
                        {m.mine ? (
                          <span className="chip chip-jade" title="This is your own template">yours</span>
                        ) : (
                          <button className="btn btn-primary text-xs" disabled={cloningId === m.templateId} onClick={() => cloneFromMarket(m.templateId)}>
                            {cloningId === m.templateId ? 'Adding…' : '＋ Add to library'}
                          </button>
                        )}
                      </div>
                    </div>
                    {open && (
                      <div className="mt-3 pt-3 grid gap-3" style={{ borderTop: '1px solid var(--color-line)', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
                        <div>
                          <div className="label mb-1">categories</div>
                          <div className="flex flex-wrap gap-1">{m.categories.map((c) => <span key={c} className="chip">{c}</span>)}</div>
                        </div>
                        <div>
                          <div className="label mb-1">channels</div>
                          <div className="flex flex-wrap gap-1">{m.sampleChannels.map((c) => <span key={c} className="chip">#{c}</span>)}{extraChannels > 0 && <span className="chip" style={{ color: 'var(--color-faint)' }}>+{extraChannels}</span>}</div>
                        </div>
                        <div>
                          <div className="label mb-1">roles</div>
                          <div className="flex flex-wrap gap-1">{m.roles.map((rr) => <span key={rr} className="chip chip-gold">{rr}</span>)}</div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Modal>
      )}

      {scanOpen && (
        <Modal
          title="Scan a server"
          maxWidth={560}
          closeOnBackdrop={!scanning && !scanSaving}
          onClose={() => !scanning && !scanSaving && setScanOpen(false)}
        >
          <div className="eyebrow mb-2">read-only preview</div>
          <h2 className="text-lg mb-1">Scan a server</h2>
          <p className="text-sm mb-4" style={{ color: 'var(--color-muted)' }}>
            Look at exactly what an import would pull — channels, roles, emojis, automod and more — before you save it as a template. Nothing is written until you choose <strong>Save as template</strong>.
          </p>

          <label htmlFor="scan-guild" className="label">Server to scan</label>
          <div className="flex items-center gap-2 mt-1 mb-2 flex-wrap">
            <select
              id="scan-guild"
              className="input"
              style={{ flex: 1, minWidth: 200 }}
              value={scanSel}
              disabled={!scanGuilds || scanning || scanSaving}
              onChange={(e) => setScanSel(e.target.value)}
            >
              {!scanGuilds ? (
                <option value="">Loading your servers…</option>
              ) : scanGuilds.length === 0 ? (
                <option value="">No servers available</option>
              ) : (
                scanGuilds.map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))
              )}
            </select>
            <button
              className="btn btn-primary shrink-0"
              disabled={!scanGuilds || scanGuilds.length === 0 || scanning || scanSaving}
              onClick={runScan}
            >
              {scanning ? 'Scanning…' : '🔍 Scan'}
            </button>
          </div>
          {scanGuilds && !scanGuildsLive && (
            <p className="text-[0.72rem] mb-3" style={{ color: 'var(--color-faint)' }}>
              Demo servers — a real bot token scans your actual Discord servers.
            </p>
          )}

          {scanErr && (
            <div className="panel-soft p-3 mb-3 text-sm flex items-center justify-between gap-3" style={{ color: 'var(--color-danger)' }}>
              <span>Couldn’t scan — {scanErr}</span>
              <button className="btn btn-ghost shrink-0" disabled={scanning || scanSaving} onClick={scanPreview ? saveScan : runScan}>Retry</button>
            </div>
          )}

          {scanPreview && (
            <div className="rise">
              <div className="panel-soft p-4 mb-4">
                <div className="eyebrow mb-1">would import</div>
                <h3 className="text-base mb-3" style={{ fontFamily: 'var(--font-display)' }}>{scanPreview.guildName}</h3>
                <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(86px, 1fr))' }}>
                  {([
                    ['roles', scanPreview.counts.roles],
                    ['channels', scanPreview.counts.channels],
                    ['categories', scanPreview.counts.categories],
                    ['emojis', scanPreview.counts.emojis],
                    ['stickers', scanPreview.counts.stickers],
                    ['automod', scanPreview.counts.automod],
                    ['bots', scanPreview.counts.bots],
                  ] as const).map(([k, v]) => (
                    <div key={k} className="panel-soft px-2.5 py-2">
                      <div className="text-lg leading-none" style={{ fontFamily: 'var(--font-display)' }}>{v}</div>
                      <div className="text-[0.62rem] mono mt-1" style={{ color: 'var(--color-faint)' }}>{k}</div>
                    </div>
                  ))}
                </div>
              </div>

              {scanPreview.headsUp.length > 0 && (
                <div className="mb-4">
                  <div className="label mb-2">heads-up before you recreate this</div>
                  <div className="space-y-1.5">
                    {scanPreview.headsUp.map((h, i) => (
                      <div key={i} className="panel-soft px-3 py-2 text-[0.82rem] flex items-start gap-2" style={{ color: 'var(--color-gold)' }}>
                        <span aria-hidden className="shrink-0">⚠</span>
                        <span>{h}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex gap-2">
                <button className="btn btn-primary flex-1 justify-center" disabled={scanSaving} onClick={saveScan}>
                  {scanSaving ? 'Saving…' : '＋ Save as template'}
                </button>
                <button className="btn btn-ghost" disabled={scanSaving} onClick={() => setScanOpen(false)}>Close</button>
              </div>
            </div>
          )}

          {!scanPreview && (
            <div className="flex justify-end mt-2">
              <button className="btn btn-ghost" disabled={scanning} onClick={() => setScanOpen(false)}>Close</button>
            </div>
          )}
        </Modal>
      )}

      {importOpen && (
        <Modal
          title="Pick a server to snapshot into your library"
          maxWidth={512}
          closeOnBackdrop={!importingId}
          onClose={() => !importingId && setImportOpen(false)}
        >
            <div className="eyebrow mb-2">snapshot a template</div>
            <h2 className="text-lg mb-1">Pick a server to snapshot into your library</h2>
            <p className="text-sm mb-4" style={{ color: 'var(--color-muted)' }}>
              {guildsLive
                ? 'Servers your bot has joined. Snapshotting copies the whole structure — channels, roles, permissions, emojis, automod — into a reusable template you can rebrand and build for clients.'
                : 'Demo mode — these are sample servers. Add a bot token and invite the bot to your real servers to snapshot them for real.'}
            </p>
            {!guilds && !importErr && <div className="text-sm py-4" style={{ color: 'var(--color-faint)' }}>Loading your servers…</div>}
            {guilds && guilds.length === 0 && (
              <div className="panel-soft p-4 text-sm" style={{ color: 'var(--color-muted)' }}>
                Your bot isn’t in any servers yet. Invite it from the <strong>Invite</strong> tab, then your servers show up here ready to snapshot.
              </div>
            )}
            <div className="space-y-2">
              {guilds?.map((g) => (
                <div key={g.id} className="panel-soft px-4 py-3 flex items-center gap-3">
                  <div className="grid place-items-center shrink-0" style={{ width: 38, height: 38, borderRadius: 10, background: 'var(--color-line)', overflow: 'hidden' }}>
                    {g.iconUrl ? <img src={g.iconUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span className="mono text-sm" style={{ color: 'var(--color-source)' }}>{g.name.slice(0, 2).toUpperCase()}</span>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{g.name}</div>
                    <div className="text-[0.68rem] mono" style={{ color: g.canManage ? 'var(--color-faint)' : 'var(--color-gold)' }}>
                      {g.canManage ? 'ready to snapshot' : 'needs Manage Server permission'}
                    </div>
                  </div>
                  <button className="btn btn-primary shrink-0" disabled={!!importingId || !g.canManage} onClick={() => importGuild(g)}>
                    {importingId === g.id ? 'Snapshotting…' : 'Snapshot →'}
                  </button>
                </div>
              ))}
            </div>
            {importErr && (
              <div className="panel-soft p-3 mt-3 text-sm flex items-center justify-between gap-3" style={{ color: 'var(--color-danger)' }}>
                <span>Couldn’t reach your servers — {importErr}</span>
                <button className="btn btn-ghost shrink-0" disabled={!!importingId} onClick={openImport}>Retry</button>
              </div>
            )}
            <div className="flex justify-end mt-4">
              <button className="btn btn-ghost" disabled={!!importingId} onClick={() => setImportOpen(false)}>Close</button>
            </div>
        </Modal>
      )}

      {pending && (
        <Modal title={`Preview .discobundle — ${pending.name}`} onClose={() => setPending(null)}>
            <div className="eyebrow mb-2">import .discobundle</div>
            <h2 className="text-lg mb-1">{pending.name}</h2>
            <p className="text-sm mb-4" style={{ color: 'var(--color-muted)' }}>
              A portable, checksum-verified snapshot{pending.hasConfig ? ' with a saved rebrand config' : ''}. Here’s what’s inside — review, then add it to your library.
            </p>
            <div className="grid grid-cols-3 gap-2 mb-5">
              {Object.entries(pending.counts).map(([k, v]) => (
                <div key={k} className="panel-soft px-2.5 py-2">
                  <div className="text-lg leading-none" style={{ fontFamily: 'var(--font-display)' }}>{v}</div>
                  <div className="text-[0.62rem] mono mt-1" style={{ color: 'var(--color-faint)' }}>{k}</div>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <button className="btn btn-primary flex-1 justify-center" onClick={() => confirmImport(true)}>Import & build →</button>
              <button className="btn" onClick={() => confirmImport(false)}>Import</button>
              <button className="btn btn-ghost" onClick={() => setPending(null)}>Cancel</button>
            </div>
        </Modal>
      )}

      <header className="flex items-end justify-between mb-5 gap-4 flex-wrap">
        <div>
          <div className="eyebrow mb-2">snapshot library</div>
          <h1 className="text-2xl">
            Templates, captured once. <span className="transform-text">Built many times.</span>
          </h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {snaps.length > 0 && (
            <button
              className={cx('btn', selectMode && 'btn-primary')}
              aria-pressed={selectMode}
              onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
            >
              {selectMode ? '✓ Done' : '☐ Select'}
            </button>
          )}
          {snaps.length >= 2 && <button className="btn" onClick={onCompare}>⇄ Compare</button>}
          <input
            ref={fileRef}
            type="file"
            accept=".discobundle,application/json"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importFile(f);
              e.target.value = '';
            }}
          />
          <button className="btn" onClick={() => fileRef.current?.click()}>↑ Import file</button>
          <button className="btn" onClick={openScan}>🔍 Scan a server</button>
          <button className="btn" onClick={openPacks}>✨ Starter packs</button>
          <button className="btn" onClick={openMarket}>🛒 Marketplace</button>
          <button className="btn btn-primary" onClick={openImport}>
            ＋ Snapshot a server
          </button>
        </div>
      </header>

      {/* search · sort · tag filters */}
      {snaps.length > 0 && (
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <input className="input" style={{ maxWidth: 280 }} placeholder="Search name, tag, note…" value={search} onChange={(e) => setSearch(e.target.value)} list="library-tag-suggestions" />
        {allTags.length > 0 && (
          <datalist id="library-tag-suggestions">
            {allTags.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        )}
        <select className="input" style={{ maxWidth: 170 }} value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
          <option value="used">Sort: last used</option>
          <option value="captured">Sort: captured</option>
          <option value="name">Sort: name</option>
        </select>
        <div className="flex items-center gap-1.5 flex-wrap" role="group" aria-label="Filter by category">
          {(['all', 'templates', 'captures'] as const).map((c) => (
            <button
              key={c}
              className={cx('chip', category === c && 'chip-source')}
              aria-pressed={category === c}
              onClick={() => setCategory(c)}
            >
              {c === 'all' ? 'All' : c === 'templates' ? '★ Templates' : 'Captures'} · {catCounts[c]}
            </button>
          ))}
        </div>
        {allTags.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {[null, ...allTags].map((t) => (
              <button
                key={t ?? '__all__'}
                className={cx('chip', (t === null ? !tag : tag === t) && 'chip-source')}
                onClick={() => setTag(t === null ? null : tag === t ? null : t)}
              >
                {t ?? 'all'}
              </button>
            ))}
          </div>
        )}
      </div>
      )}

      {err && (
        <div className="panel-soft p-3 mb-4 text-sm flex items-center justify-between gap-3" style={{ color: 'var(--color-danger)' }}>
          <span>Couldn’t load your library — {err}</span>
          <button className="btn btn-ghost shrink-0" onClick={() => { setErr(null); setLoading(true); load().catch((e) => setErr(e instanceof Error ? e.message : String(e))).finally(() => setLoading(false)); }}>Retry</button>
        </div>
      )}
      {note && <div className="panel-soft p-3 mb-4 text-sm" style={{ color: 'var(--color-jade)' }}>{note}</div>}

      {loading ? (
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(290px,1fr))' }}>
          <SkeletonCard lines={4} />
          <SkeletonCard lines={4} />
        </div>
      ) : snaps.length === 0 && !err ? (
        <div className="panel p-8 md:p-10 text-center rise">
          <div className="eyebrow mb-3">empty library</div>
          <h2 className="text-lg mb-2">No snapshots yet</h2>
          <p className="text-sm mx-auto mb-6" style={{ color: 'var(--color-muted)', maxWidth: 380 }}>
            Snapshot one of your Discord servers to capture its whole structure — channels, roles, emojis, automod — as a reusable template. Then rebrand and build it for any client.
          </p>
          <div className="flex items-center justify-center gap-2 flex-wrap">
            <button className="btn btn-primary" onClick={openImport}>＋ Snapshot a server</button>
            <button className="btn" onClick={() => fileRef.current?.click()}>↑ Import a .discobundle</button>
          </div>
        </div>
      ) : visible.length === 0 && !err ? (
        <div className="panel-soft p-8 text-center" style={{ color: 'var(--color-muted)' }}>
          <p className="text-sm mb-3">No snapshots match {search.trim() ? <>“{search.trim()}”</> : 'this filter'}.</p>
          <button className="btn btn-ghost" onClick={() => { setSearch(''); setTag(null); setCategory('all'); }}>Clear search & filters</button>
        </div>
      ) : (
      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))' }}>
        {visible.map((s) => {
          const days = ageDays(s.capturedAt);
          const stale = days !== null && days > STALE_DAYS;
          const isSel = selected.has(s.id);
          return (
          <article
            key={s.id}
            className={cx('panel p-5 flex flex-col', selectMode && isSel && 'rise')}
            style={{
              cursor: selectMode ? 'pointer' : undefined,
              borderColor: selectMode && isSel ? 'var(--color-source)' : stale ? 'color-mix(in oklab, var(--color-gold) 40%, var(--color-line))' : undefined,
              boxShadow: selectMode && isSel ? '0 0 0 1px var(--color-source)' : undefined,
            }}
            onClick={selectMode ? () => toggleSelect(s.id) : undefined}
          >
            <CardThumb name={s.name} counts={s.counts} />
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                {selectMode ? (
                  <input
                    type="checkbox"
                    checked={isSel}
                    aria-label={`Select ${s.name}`}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => toggleSelect(s.id)}
                    style={{ accentColor: 'var(--color-source)', width: 16, height: 16, flexShrink: 0 }}
                  />
                ) : (
                  <button
                    title={s.favorite ? 'Unfavorite' : 'Favorite'}
                    aria-label={`${s.favorite ? 'Unfavorite' : 'Favorite'} ${s.name}`}
                    aria-pressed={s.favorite}
                    onClick={() => patch(s.id, { favorite: !s.favorite })}
                    style={{ color: s.favorite ? 'var(--color-gold)' : 'var(--color-faint)', fontSize: '1.1rem', lineHeight: 1 }}
                  >
                    {s.favorite ? '★' : '☆'}
                  </button>
                )}
                <h2 className="text-base leading-snug truncate">{s.name}</h2>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {stale && <span className="chip chip-gold" title={`Captured ${days} days ago — may be out of date`}>stale · {days}d</span>}
                {s.isTemplate && <span className="chip chip-jade">template</span>}
                <span className="chip chip-source">v{s.version}</span>
              </div>
            </div>
            <div className="mono text-[0.72rem] mt-1.5" style={{ color: 'var(--color-faint)' }}>
              guild {shortId(s.sourceGuildId)}
              {s.lastUsedAt ? ` · last built ${new Date(s.lastUsedAt).toLocaleDateString()}` : ' · never built'}
            </div>

            {s.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {[...new Set(s.tags)].map((t) => (
                  <span key={t} className="chip" style={{ fontSize: '0.64rem' }}>{t}</span>
                ))}
              </div>
            )}

            <div className="grid grid-cols-3 gap-2 my-4">
              {COUNT_ORDER.map((k) => (
                <div key={k} className="panel-soft px-2.5 py-2">
                  <div className="text-lg leading-none" style={{ fontFamily: 'var(--font-display)' }}>{s.counts[k] ?? 0}</div>
                  <div className="text-[0.62rem] mono mt-1" style={{ color: 'var(--color-faint)' }}>{k}</div>
                </div>
              ))}
            </div>

            {selectMode ? (
              <>
                {s.note && <p className="text-[0.78rem] mb-3" style={{ color: 'var(--color-muted)' }}>{s.note}</p>}
                <div className="mt-auto text-[0.72rem] mono" style={{ color: isSel ? 'var(--color-source)' : 'var(--color-faint)' }}>
                  {isSel ? '✓ selected' : 'tap to select'}
                </div>
              </>
            ) : editing === s.id ? (
              <EditMeta s={s} onSave={async (p) => { await patch(s.id, p); setEditing(null); }} onCancel={() => setEditing(null)} />
            ) : (
              <>
                {s.note && <p className="text-[0.78rem] mb-3" style={{ color: 'var(--color-muted)' }}>{s.note}</p>}
                <div className="flex gap-2 mt-auto">
                  <button className="btn btn-primary justify-center flex-1" onClick={() => onBuild(s.id)}>
                    Rebrand & build →
                  </button>
                  <button
                    className="btn btn-ghost"
                    title={s.isTemplate ? 'Unmark as reusable template' : 'Save as a reusable template'}
                    aria-label={s.isTemplate ? `Unmark ${s.name} as template` : `Save ${s.name} as a reusable template`}
                    aria-pressed={s.isTemplate}
                    onClick={async () => { await api.updateSnapshot(s.id, { isTemplate: !s.isTemplate }).catch((e) => setErr(e instanceof Error ? e.message : String(e))); await load(); }}
                    style={s.isTemplate ? { color: 'var(--color-jade)' } : undefined}
                  >{s.isTemplate ? '★' : '☆'}</button>
                  {s.isTemplate && (
                    <button
                      className="btn btn-ghost"
                      title="Share the STRUCTURE (channels/roles/permissions) to the operator marketplace — your messages + notes stay private."
                      aria-label={s.shared ? `Stop sharing ${s.name} to the marketplace` : `Share ${s.name} to the marketplace`}
                      aria-pressed={s.shared}
                      disabled={sharingId === s.id}
                      onClick={() => toggleShare(s)}
                      style={s.shared ? { color: 'var(--color-source)' } : undefined}
                    >{sharingId === s.id ? '…' : s.shared ? '🛒 Shared' : '🛒 Share'}</button>
                  )}
                  <button className="btn btn-ghost" title="Version history & provenance" aria-label={`View version history for ${s.name}`} onClick={() => setTimelineFor({ templateName: s.name, sourceGuildId: s.sourceGuildId })}>🕓</button>
                  <button className="btn btn-ghost" title="Edit tags / note / template" aria-label={`Edit tags, note and template settings for ${s.name}`} onClick={() => setEditing(s.id)}>✎</button>
                  <button className="btn btn-ghost" title="Export .discobundle" aria-label={`Export ${s.name} as a .discobundle file`} onClick={() => exportOne(s)}>↓</button>
                </div>
              </>
            )}
          </article>
          );
        })}
      </div>
      )}

      {selectMode && selected.size > 0 && (() => {
        const sel = snaps.filter((s) => selected.has(s.id));
        const allStarred = sel.every((s) => s.favorite);
        const allTemplate = sel.every((s) => s.isTemplate);
        const allVisibleSelected = visible.length > 0 && visible.every((s) => selected.has(s.id));
        return (
          <div
            className="panel"
            style={{
              position: 'sticky',
              bottom: 12,
              marginTop: 16,
              zIndex: 20,
              padding: '10px 12px',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flexWrap: 'wrap',
              boxShadow: '0 -6px 24px rgba(8,7,12,0.45)',
            }}
          >
            <span className="label shrink-0" style={{ color: 'var(--color-source)' }}>{selected.size} selected</span>
            <button
              className="btn btn-ghost"
              disabled={bulkBusy}
              onClick={() => setSelected(allVisibleSelected ? new Set() : new Set(visible.map((s) => s.id)))}
            >
              {allVisibleSelected ? 'Clear' : 'Select all'}
            </button>
            <div style={{ flex: 1, minWidth: 8 }} />
            {selected.size === 2 && (
              <button className="btn" disabled={bulkBusy} onClick={() => openMerge([...selected])} title="Merge these two into a composite template">
                ⊕ Merge
              </button>
            )}
            <button className="btn" disabled={bulkBusy} onClick={() => bulkPatch({ favorite: !allStarred })}>
              {allStarred ? '☆ Unstar' : '★ Star'}
            </button>
            <button className="btn" disabled={bulkBusy} onClick={() => bulkPatch({ isTemplate: !allTemplate })}>
              {allTemplate ? 'Unpromote' : 'Promote to template'}
            </button>
            <button className="btn" disabled={bulkBusy} onClick={bulkTag}>Tag…</button>
            <button
              className="btn"
              disabled={bulkBusy}
              style={{ color: 'var(--color-danger)', borderColor: 'color-mix(in oklab, var(--color-danger) 50%, var(--color-line))' }}
              onClick={bulkDelete}
            >
              Delete ({selected.size})
            </button>
          </div>
        );
      })()}
    </div>
  );
}

function EditMeta({
  s,
  onSave,
  onCancel,
}: {
  s: SnapshotSummary;
  onSave: (p: { name: string; tags: string[]; note: string; isTemplate: boolean }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(s.name);
  const [tags, setTags] = useState(s.tags.join(', '));
  const [note, setNote] = useState(s.note);
  const [isTemplate, setIsTemplate] = useState(s.isTemplate);
  return (
    <div className="space-y-2 mt-auto">
      <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="name" />
      <input className="input" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="tags, comma separated" />
      <textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="note" />
      <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--color-muted)' }}>
        <input type="checkbox" checked={isTemplate} onChange={(e) => setIsTemplate(e.target.checked)} />
        Promote to master template
      </label>
      <div className="flex gap-2">
        <button
          className="btn btn-primary flex-1 justify-center"
          onClick={() => onSave({ name, tags: tags.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean), note, isTemplate })}
        >
          Save
        </button>
        <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
