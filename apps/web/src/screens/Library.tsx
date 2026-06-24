import { useEffect, useMemo, useRef, useState } from 'react';
import { api, type JoinedGuild, type SnapshotSummary } from '../api.js';
import { SkeletonCard } from '../components/Skeleton.js';
import { cx, shortId } from '../util.js';

const COUNT_ORDER = ['channels', 'roles', 'categories', 'emojis', 'automod', 'bots'];
type Sort = 'used' | 'captured' | 'name';

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
  const [sort, setSort] = useState<Sort>('used');
  const [editing, setEditing] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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

  async function patch(id: string, p: Parameters<typeof api.updateSnapshot>[1]) {
    setSnaps((prev) => prev.map((s) => (s.id === id ? { ...s, ...p } : s))); // optimistic
    try {
      await api.updateSnapshot(id, p);
    } catch {
      await load();
    }
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
    const sorted = [...xs].sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name);
      if (sort === 'captured') return b.capturedAt.localeCompare(a.capturedAt);
      return (b.lastUsedAt ?? '').localeCompare(a.lastUsedAt ?? ''); // used
    });
    // favorites always float to the top
    return sorted.sort((a, b) => Number(b.favorite) - Number(a.favorite));
  }, [snaps, search, tag, sort]);

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
      {importOpen && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(8,7,12,0.7)', backdropFilter: 'blur(4px)', zIndex: 50, display: 'grid', placeItems: 'center' }}
          className="p-4"
          onClick={() => !importingId && setImportOpen(false)}
        >
          <div className="panel p-5 md:p-6 rise w-full max-w-lg" style={{ maxHeight: '85vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
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
          </div>
        </div>
      )}

      {pending && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(8,7,12,0.7)', backdropFilter: 'blur(4px)', zIndex: 50, display: 'grid', placeItems: 'center', padding: 24 }}
          onClick={() => setPending(null)}
        >
          <div className="panel p-6 rise" style={{ width: '100%', maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
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
          </div>
        </div>
      )}

      <header className="flex items-end justify-between mb-5 gap-4 flex-wrap">
        <div>
          <div className="eyebrow mb-2">snapshot library</div>
          <h1 className="text-2xl">
            Templates, captured once. <span className="transform-text">Built many times.</span>
          </h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
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
          <button className="btn btn-ghost" onClick={() => { setSearch(''); setTag(null); }}>Clear search & filters</button>
        </div>
      ) : (
      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))' }}>
        {visible.map((s) => (
          <article key={s.id} className="panel p-5 flex flex-col">
            <CardThumb name={s.name} counts={s.counts} />
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <button
                  title={s.favorite ? 'Unfavorite' : 'Favorite'}
                  onClick={() => patch(s.id, { favorite: !s.favorite })}
                  style={{ color: s.favorite ? 'var(--color-gold)' : 'var(--color-faint)', fontSize: '1.1rem', lineHeight: 1 }}
                >
                  {s.favorite ? '★' : '☆'}
                </button>
                <h2 className="text-base leading-snug">{s.name}</h2>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
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

            {editing === s.id ? (
              <EditMeta s={s} onSave={async (p) => { await patch(s.id, p); setEditing(null); }} onCancel={() => setEditing(null)} />
            ) : (
              <>
                {s.note && <p className="text-[0.78rem] mb-3" style={{ color: 'var(--color-muted)' }}>{s.note}</p>}
                <div className="flex gap-2 mt-auto">
                  <button className="btn btn-primary justify-center flex-1" onClick={() => onBuild(s.id)}>
                    Rebrand & build →
                  </button>
                  <button className="btn btn-ghost" title="Edit tags / note / template" onClick={() => setEditing(s.id)}>✎</button>
                  <button className="btn btn-ghost" title="Export .discobundle" onClick={() => exportOne(s)}>↓</button>
                </div>
              </>
            )}
          </article>
        ))}
      </div>
      )}
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
