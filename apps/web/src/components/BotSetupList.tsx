import { useState } from 'react';
import type { BotSetupEntry } from '../api.js';

/** Render the actionable Bot Setup Checklist — per-bot OAuth re-invite + reconfigure steps + copy. */
export function BotSetupList({ entries }: { entries: BotSetupEntry[] }) {
  const [copied, setCopied] = useState(false);
  if (!entries.length) {
    return (
      <div className="panel-soft p-3 text-sm" style={{ color: 'var(--color-muted)' }}>
        No third-party bots detected — nothing to re-invite.
      </div>
    );
  }

  const markdown = entries
    .map((e) => {
      const lines = [`### ${e.name}${e.vendor && e.vendor !== e.name ? ` · ${e.vendor}` : ''}`];
      if (e.oauthUrl) lines.push(`- Re-invite: ${e.oauthUrl}`);
      if (e.dashboardUrl) lines.push(`- Configure at: ${e.dashboardUrl}`);
      for (const r of e.reconfigure) lines.push(`- ${r}`);
      return lines.join('\n');
    })
    .join('\n\n');

  return (
    <div className="space-y-2">
      <div className="flex justify-end -mt-1">
        <button
          className="btn btn-ghost text-xs"
          onClick={() => {
            navigator.clipboard?.writeText(markdown);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? 'Copied markdown ✓' : 'Copy as markdown'}
        </button>
      </div>
      {entries.map((e, i) => (
        <div key={i} className="panel-soft p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-medium">
              {e.name}
              {e.vendor && e.vendor !== e.name && (
                <span className="chip ml-2" style={{ fontSize: '0.66rem' }}>
                  {e.vendor}
                </span>
              )}
            </div>
            <div className="flex gap-1.5">
              {e.oauthUrl && (
                <a className="btn btn-primary text-xs" href={e.oauthUrl} target="_blank" rel="noreferrer">
                  Re-invite →
                </a>
              )}
              {e.dashboardUrl && (
                <a className="btn text-xs" href={e.dashboardUrl} target="_blank" rel="noreferrer">
                  Configure
                </a>
              )}
            </div>
          </div>
          {e.reconfigure.length > 0 && (
            <ul className="mt-2 space-y-1">
              {e.reconfigure.map((r, j) => (
                <li key={j} className="text-[0.78rem] flex gap-2" style={{ color: 'var(--color-muted)' }}>
                  <span style={{ color: 'var(--color-client)' }}>›</span>
                  {r}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
