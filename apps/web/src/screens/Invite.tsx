import { useState } from 'react';
import { api } from '../api.js';
import { cx } from '../util.js';

const INTENTS = [
  ['Guilds', 'enumerate channels / roles / settings'],
  ['Server Members', 'detect bot members'],
  ['Message Content', 'read info-channel content to copy'],
  ['Guild Expressions', 'read & re-upload emojis / stickers'],
  ['Guild Webhooks', 're-post copied content'],
  ['AutoMod Configuration', 'read & recreate AutoMod rules'],
];

export function Invite({ applicationId }: { applicationId: string | null }) {
  const [appId, setAppId] = useState(applicationId ?? '');
  const [mode, setMode] = useState<'administrator' | 'granular'>('administrator');
  const [result, setResult] = useState<{ url: string; permissions: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [pfGuild, setPfGuild] = useState('');
  const [pf, setPf] = useState<Awaited<ReturnType<typeof api.preflight>> | null>(null);
  const [pfErr, setPfErr] = useState<string | null>(null);
  const [pfBusy, setPfBusy] = useState(false);
  async function runPreflight() {
    setPfErr(null);
    setPf(null);
    setPfBusy(true);
    try {
      setPf(await api.preflight(pfGuild.trim()));
    } catch (e) {
      setPfErr(e instanceof Error ? e.message : String(e));
    } finally {
      setPfBusy(false);
    }
  }

  async function generate() {
    setErr(null);
    try {
      setResult(await api.inviteUrl(appId, mode));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="px-4 py-6 md:p-8 max-w-3xl rise">
      <div className="eyebrow mb-2">bot oauth</div>
      <h1 className="text-2xl mb-1">Add Disco to a server</h1>
      <p className="text-sm mb-6 max-w-xl" style={{ color: 'var(--color-muted)' }}>
        Generate the exact OAuth URL with the right permission integer for the source template and each
        target guild. Disco needs Administrator for a clean clone.
      </p>

      <div className="panel p-5 mb-5">
        <div className="label mb-1">Application ID</div>
        <input className="input mono mb-4" placeholder="123456789012345678" value={appId} onChange={(e) => setAppId(e.target.value)} />

        <div className="flex flex-wrap gap-2 mb-2">
          {(['administrator', 'granular'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={cx('btn', mode === m ? 'transform-ring' : 'btn-ghost')}
              style={mode === m ? { color: 'var(--color-bone)' } : undefined}
              aria-pressed={mode === m}
            >
              {m === 'administrator' ? 'Administrator (recommended)' : 'Granular permissions'}
            </button>
          ))}
        </div>
        <p className="text-[0.72rem] mb-4" style={{ color: 'var(--color-faint)' }}>
          {mode === 'administrator'
            ? 'Administrator grants everything a clean clone needs in one invite — the safest default.'
            : 'Granular requests only the specific permissions Disco uses. Pick this if the client won’t grant Administrator — but a build may stop at a Manual Step if a permission is missing.'}
        </p>

        <button className="btn btn-primary" onClick={generate} disabled={!appId}>
          Generate invite URL
        </button>
        {err && (
          <div className="text-sm mt-3" style={{ color: 'var(--color-danger)' }}>
            {err}
          </div>
        )}

        {result && (
          <div className="panel-soft p-3 mt-4">
            <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
              <span className="chip chip-gold">permissions {result.permissions}</span>
              <button
                className="btn btn-ghost text-xs"
                onClick={() => {
                  navigator.clipboard?.writeText(result.url);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <div className="mono text-xs break-all" style={{ color: 'var(--color-source)' }}>
              {result.url}
            </div>
          </div>
        )}
      </div>

      {/* pre-flight authority audit */}
      <div className="panel p-5 mb-5">
        <div className="flex items-baseline gap-2 mb-1">
          <span className="label">Pre-flight authority check</span>
          <span className="text-[0.68rem]" style={{ color: 'var(--color-faint)' }}>
            verify the bot can actually do the job — BEFORE a build touches the guild
          </span>
        </div>
        <div className="flex items-end gap-2 mt-3">
          <input className="input mono flex-1" placeholder="Guild ID to check" value={pfGuild} onChange={(e) => setPfGuild(e.target.value)} />
          <button className="btn" onClick={runPreflight} disabled={!pfGuild.trim() || pfBusy}>
            {pfBusy ? 'Checking…' : 'Run check'}
          </button>
        </div>
        {pfErr && <div className="text-sm mt-3" style={{ color: 'var(--color-danger)' }}>Couldn’t reach the guild: {pfErr}</div>}
        {pf && (
          <div className="panel-soft p-3 mt-3">
            {pf.ok ? (
              <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--color-jade)' }}>
                ✓ Ready — the bot {pf.hasAdmin ? 'has Administrator' : 'has every permission Disco needs'} in this guild.
              </div>
            ) : (
              <>
                <div className="text-sm mb-2" style={{ color: 'var(--color-danger)' }}>
                  ✗ Not ready — {pf.missing.length} permission(s) missing. Re-invite with the right perms first.
                </div>
                <div className="space-y-1">
                  {pf.missing.map((m) => (
                    <div key={m.name} className="text-[0.78rem] flex gap-2">
                      <span className="chip" style={{ color: 'var(--color-danger)', borderColor: 'color-mix(in srgb, var(--color-danger) 40%, transparent)' }}>{m.name}</span>
                      <span style={{ color: 'var(--color-muted)' }}>{m.why}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
            <div className="mono text-[0.66rem] mt-2" style={{ color: 'var(--color-faint)' }}>{pf.mode} mode · perms {pf.permissions}</div>
          </div>
        )}
      </div>

      <div className="panel p-5">
        <div className="flex items-baseline gap-2 mb-3 flex-wrap">
          <span className="eyebrow">privileged intents to enable in the dev portal</span>
          <span className="text-[0.68rem]" style={{ color: 'var(--color-faint)' }}>
            toggle these on the bot’s page — the invite link alone can’t flip them
          </span>
        </div>
        <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px,1fr))' }}>
          {INTENTS.map(([name, why]) => (
            <div key={name} className="panel-soft p-3">
              <div className="text-sm font-medium">{name}</div>
              <div className="text-[0.72rem] mt-0.5" style={{ color: 'var(--color-muted)' }}>
                {why}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
