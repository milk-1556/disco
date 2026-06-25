import { useEffect, useState } from 'react';
import { api, type OnboardingState } from '../api.js';
import type { View } from '../components/Shell.js';

interface Step {
  done: boolean;
  title: string;
  detail: string;
  gate?: boolean; // a hard gate that requires the operator to act deliberately (token / real build)
  cta?: { label: string; view: View };
}

/** First-real-build onboarding wizard (#3): connect → import a pack → validate → canary → real build →
 *  deliver. Each step's done-state comes from the operator's real data (GET /onboarding), so it
 *  self-updates as they progress — the activation roadmap to a graceful first real Discord build. */
function fmtElapsed(ms: number): string {
  const m = ms / 60000;
  if (m < 60) return `${Math.max(1, Math.round(m))} min`;
  const h = m / 60;
  if (h < 48) return `${h.toFixed(1)} hrs`;
  return `${Math.round(h / 24)} days`;
}

function stepsFor(o: OnboardingState): Step[] {
  return [
    {
      done: o.hasToken,
      gate: true,
      title: '1 · Connect your Discord bot',
      detail: o.hasToken
        ? 'A bot token is configured — Disco is in LIVE mode.'
        : 'Set DISCORD_BOT_TOKEN in .env (with the required permissions) to go live. Until then you’re in safe DEMO mode against a mock guild. See docs/operator-runbook.md.',
      cta: { label: 'Invite & check perms', view: 'invite' },
    },
    {
      done: o.hasTemplate,
      title: '2 · Import a starter pack',
      detail: o.hasTemplate
        ? `${o.counts.templates} template${o.counts.templates === 1 ? '' : 's'} in your library.`
        : 'Add a curated server blueprint (Slots / IRL Vlogger / Casino Sponsor) — or snapshot your own server.',
      cta: { label: 'Browse starter packs', view: 'library' },
    },
    {
      done: o.ranValidation,
      title: '3 · Validate with a readiness check',
      detail: o.ranValidation
        ? 'You’ve validated a build — guardrails + a zero-write dry-run projection ran clean.'
        : 'Run the 🔍 Readiness check (and a ◐ Dry-run) in the Build console — a zero-write “would this succeed?” gate.',
      cta: { label: 'Open Build console', view: 'build' },
    },
    {
      done: o.ranCanary,
      title: '4 · Canary into a test guild',
      detail: o.ranCanary
        ? 'You’ve run a canary build — a real build you inspected before pointing at a client guild.'
        : 'Build into a throwaway TEST guild first (the Canary toggle). Inspect it, confirm it looks right.',
      cta: { label: 'Build a canary', view: 'build' },
    },
    {
      done: o.ranRealBuild,
      gate: true,
      title: '5 · Run your first real build',
      detail: o.ranRealBuild
        ? `${o.counts.builds} real build${o.counts.builds === 1 ? '' : 's'} delivered.`
        : 'The deliberate trigger: uncheck Canary, point at the client guild, and Build the server →. Your call.',
      cta: { label: 'Open Build console', view: 'build' },
    },
    {
      done: o.deliveredHandover,
      title: '6 · Deliver the handover',
      detail: o.deliveredHandover
        ? 'You’ve delivered a handover — the client has their delivery page + management guide.'
        : 'Mark the handover ready and send the public link. Then watch the engagement analytics.',
      cta: { label: 'Go to Queue', view: 'queue' },
    },
  ];
}

export function Setup({ go }: { go: (v: View) => void }) {
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [journey, setJourney] = useState<{ start: string; firstDelivery: string | null } | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setErr(null);
        const [o, snaps, jobs] = await Promise.all([
          api.onboarding(),
          api.snapshots().catch(() => []),
          api.jobs().catch(() => []),
        ]);
        if (!alive) return;
        setSteps(stepsFor(o));
        const starts = [...snaps.map((s) => s.capturedAt), ...jobs.map((j) => j.createdAt)].sort();
        const firstDelivery = jobs.filter((j) => j.status === 'completed' && !j.dryRun && !j.canary).map((j) => j.updatedAt).sort()[0];
        if (starts[0]) setJourney({ start: starts[0], firstDelivery: firstDelivery ?? null });
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [reload]);

  const done = steps?.filter((s) => s.done).length ?? 0;
  const total = steps?.length ?? 6;

  return (
    <div className="px-4 py-6 md:p-8 max-w-2xl rise">
      <header className="mb-6">
        <div className="eyebrow mb-2">get started</div>
        <h1 className="text-2xl">
          Zero to your <span className="transform-text">first real build</span>
        </h1>
        <p className="text-sm mt-2" style={{ color: 'var(--color-muted)' }}>
          Six steps from connecting a bot to delivering a client a finished server — safely. Disco works in
          demo mode out of the box; the token + first real build are your deliberate calls.
        </p>
      </header>

      {err && !steps ? (
        <div className="panel-soft px-4 py-3 mb-5 flex items-center gap-3 flex-wrap">
          <span className="text-sm" style={{ color: 'var(--color-danger)' }}>Couldn’t load your progress.</span>
          <button className="btn btn-ghost text-xs ml-auto" onClick={() => setReload((n) => n + 1)}>Retry</button>
        </div>
      ) : !steps ? (
        <div className="panel-soft px-4 py-3 mb-5 flex items-center gap-3" style={{ color: 'var(--color-muted)' }}>
          <span className="w-2 h-2 rounded-full live-dot" style={{ background: 'var(--color-source)' }} />
          <span className="text-sm">Checking where you are on the assembly line…</span>
        </div>
      ) : (
        <div className="panel-soft px-4 py-3 mb-5 flex items-center gap-3">
          <div className="h-2 flex-1 rounded-full overflow-hidden" style={{ background: 'var(--color-line)' }}>
            <div className="h-full transform-bar transition-all" style={{ width: `${(done / total) * 100}%` }} />
          </div>
          <span className="mono text-xs whitespace-nowrap" style={{ color: 'var(--color-muted)' }}>
            {done === total ? 'all set ✓' : `${done}/${total}`}
          </span>
        </div>
      )}

      <ol className="space-y-2">
        {(steps ?? []).map((s, i) => (
          <li key={i} className="panel p-4 flex flex-wrap items-start gap-3">
            <span
              className="grid place-items-center shrink-0 mt-0.5"
              style={{
                width: 22, height: 22, borderRadius: 999,
                background: s.done ? 'var(--color-jade)' : 'transparent',
                border: s.done ? 'none' : '1px solid var(--color-line)',
                color: '#0a0910', fontSize: '0.7rem',
              }}
            >
              {s.done ? '✓' : i + 1}
            </span>
            <div className="flex-1 min-w-0" style={{ flexBasis: '12rem' }}>
              <div className="text-sm font-medium flex items-center gap-2 flex-wrap" style={{ fontFamily: 'var(--font-display)' }}>
                {s.title}
                {s.gate && <span className="chip chip-gold" title="A deliberate, operator-only action">your call</span>}
              </div>
              <div className="text-[0.78rem] mt-0.5" style={{ color: 'var(--color-muted)' }}>{s.detail}</div>
            </div>
            {s.cta && !s.done && (
              <button className="btn text-xs shrink-0 ml-auto" onClick={() => go(s.cta!.view)}>
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
              first real delivery in{' '}
              <span className="mono">{fmtElapsed(new Date(journey.firstDelivery).getTime() - new Date(journey.start).getTime())}</span>
            </span>
          ) : (
            <span style={{ color: 'var(--color-faint)' }}>no real delivery yet — the runbook (docs/operator-runbook.md) walks you through it</span>
          )}
        </div>
      )}
    </div>
  );
}
