import { useEffect, useState } from 'react';
import { api } from '../api.js';
import type { View } from '../components/Shell.js';

interface Step {
  done: boolean;
  title: string;
  detail: string;
  cta?: { label: string; view?: View; href?: string };
}

/** First-run onboarding: walk the operator from connecting a bot → storage → first capture → first build (#13). */
function fmtElapsed(ms: number): string {
  const m = ms / 60000;
  if (m < 60) return `${Math.max(1, Math.round(m))} min`;
  const h = m / 60;
  if (h < 48) return `${h.toFixed(1)} hrs`;
  return `${Math.round(h / 24)} days`;
}

export function Setup({ go }: { go: (v: View) => void }) {
  const [steps, setSteps] = useState<Step[]>([]);
  const [loading, setLoading] = useState(true);
  const [journey, setJourney] = useState<{ start: string; firstDelivery: string | null } | null>(null);

  useEffect(() => {
    (async () => {
      const [cfg, snaps, clients, jobs] = await Promise.all([
        api.config(),
        api.snapshots().catch(() => []),
        api.clients().catch(() => []),
        api.jobs().catch(() => []),
      ]);
      // Onboarding metric: time from first activity to first real delivery.
      const starts = [...snaps.map((s) => s.capturedAt), ...jobs.map((j) => j.createdAt)].sort();
      const firstDelivery = jobs
        .filter((j) => j.status === 'completed' && !j.dryRun)
        .map((j) => j.updatedAt)
        .sort()[0];
      if (starts[0]) setJourney({ start: starts[0], firstDelivery: firstDelivery ?? null });
      setSteps([
        {
          done: cfg.hasToken,
          title: 'Connect your Discord bot',
          detail: cfg.hasToken
            ? 'A bot token is configured — Disco is in LIVE mode.'
            : 'Set DISCORD_BOT_TOKEN in .env to go live. Until then you’re in safe DEMO mode (mock guild).',
          cta: { label: 'Invite & check perms', view: 'invite' },
        },
        {
          done: true,
          title: 'Asset storage',
          detail: `Storing snapshot assets via "${cfg.storageDriver}". Persistence: ${cfg.persistence} · queue: ${cfg.queue}.`,
        },
        {
          done: snaps.length > 0,
          title: 'Import your first server',
          detail: snaps.length > 0 ? `${snaps.length} template(s) in the library.` : 'Add the bot to a server, then copy it into your library as a reusable template.',
          cta: { label: 'Import a server', view: 'library' },
        },
        {
          done: clients.length > 0,
          title: 'Add your first client',
          detail: clients.length > 0 ? `${clients.length} client(s) on file.` : 'Capture a creator’s brand so a rebrand is one click.',
          cta: { label: 'New client', view: 'clients' },
        },
        {
          done: jobs.length > 0,
          title: 'Run your first build',
          detail: jobs.length > 0 ? `${jobs.length} build(s) on the record.` : 'Rebrand a template and build it — dry-run first, then for real.',
          cta: { label: 'Build console', view: 'build' },
        },
      ]);
      setLoading(false);
    })();
  }, []);

  const done = steps.filter((s) => s.done).length;

  return (
    <div className="p-8 max-w-2xl rise">
      <header className="mb-6">
        <div className="eyebrow mb-2">get started</div>
        <h1 className="text-2xl">
          Set up your <span className="transform-text">assembly line</span>
        </h1>
        <p className="text-sm mt-2" style={{ color: 'var(--color-muted)' }}>
          A few steps to go from zero to selling builds. Disco works in demo mode out of the box.
        </p>
      </header>

      {!loading && (
        <div className="panel-soft px-4 py-3 mb-5 flex items-center gap-3">
          <div className="h-2 flex-1 rounded-full overflow-hidden" style={{ background: 'var(--color-line)' }}>
            <div className="h-full transform-bar transition-all" style={{ width: `${(done / steps.length) * 100}%` }} />
          </div>
          <span className="mono text-xs" style={{ color: 'var(--color-muted)' }}>{done}/{steps.length}</span>
        </div>
      )}

      <ol className="space-y-2">
        {steps.map((s, i) => (
          <li key={i} className="panel p-4 flex items-start gap-3">
            <span
              className="grid place-items-center shrink-0 mt-0.5"
              style={{
                width: 22,
                height: 22,
                borderRadius: 999,
                background: s.done ? 'var(--color-jade)' : 'transparent',
                border: s.done ? 'none' : '1px solid var(--color-line)',
                color: '#0a0910',
                fontSize: '0.7rem',
              }}
            >
              {s.done ? '✓' : i + 1}
            </span>
            <div className="flex-1">
              <div className="text-sm font-medium" style={{ fontFamily: 'var(--font-display)' }}>{s.title}</div>
              <div className="text-[0.78rem] mt-0.5" style={{ color: 'var(--color-muted)' }}>{s.detail}</div>
            </div>
            {s.cta && !s.done && (
              <button className="btn text-xs shrink-0" onClick={() => s.cta!.view && go(s.cta!.view)}>
                {s.cta.label} →
              </button>
            )}
          </li>
        ))}
      </ol>

      {journey && (
        <div className="panel-soft px-4 py-3 mt-5 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
          <span className="label">your journey</span>
          <span style={{ color: 'var(--color-muted)' }}>
            started <span className="mono">{new Date(journey.start).toLocaleDateString()}</span>
          </span>
          {journey.firstDelivery ? (
            <span style={{ color: 'var(--color-jade)' }}>
              first delivery in{' '}
              <span className="mono">{fmtElapsed(new Date(journey.firstDelivery).getTime() - new Date(journey.start).getTime())}</span>
            </span>
          ) : (
            <span style={{ color: 'var(--color-faint)' }}>no delivery yet — ship your first build</span>
          )}
        </div>
      )}
    </div>
  );
}
