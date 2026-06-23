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

  async function generate() {
    setErr(null);
    try {
      setResult(await api.inviteUrl(appId, mode));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="p-8 max-w-3xl rise">
      <div className="eyebrow mb-2">bot oauth</div>
      <h1 className="text-2xl mb-1">Add Disco to a server</h1>
      <p className="text-sm mb-6 max-w-xl" style={{ color: 'var(--color-muted)' }}>
        Generate the exact OAuth URL with the right permission integer for the source template and each
        target guild. Disco needs Administrator for a clean clone.
      </p>

      <div className="panel p-5 mb-5">
        <div className="label mb-1">Application ID</div>
        <input className="input mono mb-4" placeholder="123456789012345678" value={appId} onChange={(e) => setAppId(e.target.value)} />

        <div className="flex gap-2 mb-4">
          {(['administrator', 'granular'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={cx('btn', mode === m ? 'transform-ring' : 'btn-ghost')}
              style={mode === m ? { color: 'var(--color-bone)' } : undefined}
            >
              {m === 'administrator' ? 'Administrator (recommended)' : 'Granular permissions'}
            </button>
          ))}
        </div>

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
            <div className="flex items-center justify-between gap-2 mb-2">
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

      <div className="panel p-5">
        <div className="eyebrow mb-3">privileged intents to enable in the dev portal</div>
        <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px,1fr))' }}>
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
