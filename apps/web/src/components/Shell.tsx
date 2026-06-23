import type { ReactNode } from 'react';
import { cx } from '../util.js';
import { Logo } from './Logo.js';

export type View = 'library' | 'build' | 'queue' | 'invite';

const NAV: { id: View; label: string; hint: string }[] = [
  { id: 'library', label: 'Library', hint: 'snapshots' },
  { id: 'build', label: 'Build', hint: 'rebrand & ship' },
  { id: 'queue', label: 'Queue', hint: 'jobs' },
  { id: 'invite', label: 'Invite', hint: 'bot OAuth' },
];

export function Shell({
  view,
  setView,
  mode,
  onSignOut,
  children,
}: {
  view: View;
  setView: (v: View) => void;
  mode: string;
  onSignOut: () => void;
  children: ReactNode;
}) {
  return (
    <div className="min-h-full grid" style={{ gridTemplateColumns: '236px 1fr' }}>
      <aside
        className="flex flex-col gap-1 p-4 border-r"
        style={{ borderColor: 'var(--color-line-soft)', background: 'rgba(13,12,18,0.6)' }}
      >
        <div className="flex items-center gap-2.5 px-2 py-3 mb-3">
          <Logo size={26} />
          <div>
            <div className="font-semibold leading-none" style={{ fontFamily: 'var(--font-display)' }}>
              Disco
            </div>
            <div className="eyebrow mt-1">cloning console</div>
          </div>
        </div>

        {NAV.map((n) => (
          <button
            key={n.id}
            onClick={() => setView(n.id)}
            className={cx('text-left rounded-lg px-3 py-2.5 transition', view === n.id ? 'transform-ring' : '')}
            style={{
              background: view === n.id ? undefined : 'transparent',
              color: view === n.id ? 'var(--color-bone)' : 'var(--color-muted)',
            }}
          >
            <div className="text-sm font-medium" style={{ fontFamily: 'var(--font-display)' }}>
              {n.label}
            </div>
            <div className="text-[0.7rem] mono mt-0.5" style={{ color: 'var(--color-faint)' }}>
              {n.hint}
            </div>
          </button>
        ))}

        <div className="mt-auto px-2">
          <div
            className={cx('chip', mode === 'live' ? 'chip-jade' : '')}
            style={mode === 'live' ? undefined : { color: 'var(--color-gold)', borderColor: 'rgba(232,179,65,0.4)' }}
          >
            {mode === 'live' ? '● live guild' : '◐ demo · mock guild'}
          </div>
          <button className="btn btn-ghost w-full justify-start mt-3 px-2" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </aside>

      <main className="overflow-auto" style={{ maxHeight: '100vh' }}>
        {children}
      </main>
    </div>
  );
}
