import { useEffect, useMemo, useRef, useState } from 'react';
import { api, type SnapshotSummary } from '../api.js';
import { cx, shortId } from '../util.js';

const COUNT_ORDER = ['channels', 'roles', 'categories', 'emojis', 'automod', 'bots'];
type Sort = 'used' | 'captured' | 'name';

export function Library({ onBuild, onCompare }: { onBuild: (snapshotId: string) => void; onCompare: () => void }) {
  const [snaps, setSnaps] = useState<SnapshotSummary[]>([]);
  const [busy, setBusy] = useState(false);
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
    load().catch((e) => setErr(String(e)));
  }, []);

  const [note, setNote] = useState<string | null>(null);
  async function capture() {
    setBusy(true);
    setErr(null);
    setNote(null);
    try {
      const r = await api.capture({});
      setNote(r.unchanged ? `No changes since v${r.version} — nothing to re-capture.` : `Captured ${r.name}.`);
      setTimeout(() => setNote(null), 4000);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
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

  async function importFile(file: File) {
    setErr(null);
    try {
      await api.importBundle(JSON.parse(await file.text()));
      await load();
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
    <div className="p-8 max-w-6xl rise">
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
          <button className="btn" onClick={() => fileRef.current?.click()}>↑ Import</button>
          <button className="btn btn-primary" onClick={capture} disabled={busy}>
            {busy ? 'Capturing…' : '↻ New snapshot'}
          </button>
        </div>
      </header>

      {/* search · sort · tag filters */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <input className="input" style={{ maxWidth: 280 }} placeholder="Search name, tag, note…" value={search} onChange={(e) => setSearch(e.target.value)} />
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

      {err && <div className="panel-soft p-3 mb-4 text-sm" style={{ color: 'var(--color-danger)' }}>{err}</div>}
      {note && <div className="panel-soft p-3 mb-4 text-sm" style={{ color: 'var(--color-jade)' }}>{note}</div>}

      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))' }}>
        {visible.map((s) => (
          <article key={s.id} className="panel p-5 flex flex-col">
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
              {s.lastUsedAt ? ` · used ${new Date(s.lastUsedAt).toLocaleDateString()}` : ' · never built'}
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
