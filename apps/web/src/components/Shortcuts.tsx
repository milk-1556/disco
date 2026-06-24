import { useEffect, useState } from 'react';
import type { View } from './Shell.js';
import { Modal } from './Modal.js';

const HELP: { keys: string; label: string }[] = [
  { keys: 'g t', label: 'Go to Today' },
  { keys: 'g l', label: 'Go to Library' },
  { keys: 'g q', label: 'Go to Queue' },
  { keys: 'g e', label: 'Go to Economics' },
  { keys: 'c', label: 'New client' },
  { keys: 's', label: 'Snapshot a server' },
  { keys: 'b', label: 'Build console' },
  { keys: '?', label: 'Show / hide this help' },
];

/** Global keyboard shortcuts + the "?" help overlay. Ignored while typing in a field. */
export function Shortcuts({ go }: { go: (v: View) => void }) {
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    let gPending = false;
    let gTimer: ReturnType<typeof setTimeout> | undefined;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === '?') return setShowHelp((s) => !s);
      if (e.key === 'Escape') return setShowHelp(false);

      if (gPending) {
        gPending = false;
        if (gTimer) clearTimeout(gTimer);
        const map: Record<string, View> = { t: 'today', l: 'library', q: 'queue', e: 'economics', c: 'clients' };
        if (map[e.key]) go(map[e.key]!);
        return;
      }
      if (e.key === 'g') {
        gPending = true;
        gTimer = setTimeout(() => (gPending = false), 800);
        return;
      }
      if (e.key === 'c') go('clients');
      else if (e.key === 's') go('library');
      else if (e.key === 'b') go('build');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go]);

  if (!showHelp) return null;
  return (
    <Modal title="Keyboard shortcuts" maxWidth={384} zIndex={60} onClose={() => setShowHelp(false)}>
      <div className="eyebrow mb-3">keyboard shortcuts</div>
      <div className="space-y-2">
        {HELP.map((s) => (
          <div key={s.keys} className="flex items-center justify-between text-sm">
            <span style={{ color: 'var(--color-muted)' }}>{s.label}</span>
            <kbd className="mono text-xs px-2 py-0.5" style={{ background: 'var(--color-line)', borderRadius: 6, color: 'var(--color-bone)', border: '1px solid var(--color-line-soft)' }}>{s.keys}</kbd>
          </div>
        ))}
      </div>
      <div className="text-[0.7rem] mono mt-4" style={{ color: 'var(--color-faint)' }}>esc or click to close</div>
    </Modal>
  );
}
