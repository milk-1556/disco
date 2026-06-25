import type { JobManifest } from '../api.js';

const LABEL: Record<string, string> = {
  guild_settings: 'Guild settings',
  roles: 'Roles',
  expressions: 'Emojis & stickers',
  categories: 'Categories',
  channels: 'Channels',
  overwrites: 'Permissions',
  automod: 'AutoMod',
  pointers: 'Pointers',
  content: 'Content copy',
  bot_detection: 'Bot detection',
  report: 'Report',
};

function ms(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  return new Date(b).getTime() - new Date(a).getTime();
}
function fmt(d: number | null): string {
  if (d === null) return '—';
  if (d < 1000) return `${d}ms`;
  return `${(d / 1000).toFixed(d < 10000 ? 2 : 1)}s`;
}

/**
 * Per-step build timeline (§ analytics + resumability): shows each of the 11 steps with status and
 * how long it took, the total build time (the unit-economics number), and — for an interrupted
 * build — exactly which step it stopped at so a resume is legible.
 */
export function BuildSteps({ manifest, status }: { manifest: JobManifest; status: string }) {
  const steps = manifest.steps;
  if (!steps?.length) return null;
  const durations = steps.map((s) => ms(s.startedAt, s.finishedAt));
  const total = durations.reduce<number>((acc, d) => acc + (d ?? 0), 0);
  const stoppedAt = steps.findIndex((s) => s.status !== 'done');
  const interrupted = (status === 'failed' || status === 'paused') && stoppedAt >= 0;
  // A step entered more than once means a prior attempt failed there and the build resumed into it (#3).
  const retried = steps.filter((s) => (s.attempts ?? 0) > 1).length;

  return (
    <div className="panel-soft p-3">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-1">
        <span className="label">build steps</span>
        <span className="flex items-center gap-1">
          {retried > 0 && (
            <span className="mono text-xs chip" style={{ color: 'var(--color-gold)', borderColor: 'rgba(232,179,65,0.4)' }} title="steps a prior attempt failed in, then resumed">
              ↻ {retried} resumed
            </span>
          )}
          <span className="mono text-xs chip chip-jade">total {fmt(total)}</span>
        </span>
      </div>
      <div className="space-y-1">
        {steps.map((s, i) => {
          const dot =
            s.status === 'done' ? 'var(--color-jade)' : s.status === 'running' ? 'var(--color-source)' : s.status === 'failed' ? 'var(--color-danger)' : 'var(--color-line)';
          const isStop = interrupted && i === stoppedAt;
          return (
            <div key={s.step} className="flex items-center gap-2 text-[0.74rem]">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: dot }} />
              <span style={{ color: s.status === 'done' ? 'var(--color-bone)' : 'var(--color-muted)', minWidth: 130 }}>
                {LABEL[s.step] ?? s.step}
              </span>
              <span className="mono" style={{ color: 'var(--color-faint)' }}>{fmt(durations[i])}</span>
              {(s.attempts ?? 0) > 1 && (
                <span className="mono text-[0.66rem] chip" style={{ color: 'var(--color-gold)', borderColor: 'rgba(232,179,65,0.4)', padding: '0 5px' }} title={`entered ${s.attempts} times — a prior attempt failed here`}>
                  ↻×{s.attempts}
                </span>
              )}
              {isStop && (
                <span className="chip ml-auto" style={{ color: 'var(--color-gold)', borderColor: 'rgba(232,179,65,0.4)' }}>
                  ↻ resume from step {i + 1}/{steps.length}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
