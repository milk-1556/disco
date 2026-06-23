import { useEffect, useState } from 'react';
import { api, type Client } from '../api.js';
import { NewClient } from './NewClient.js';

export function Clients() {
  const [clients, setClients] = useState<Client[]>([]);
  const [adding, setAdding] = useState(false);

  const load = () => api.clients().then(setClients).catch(() => {});
  useEffect(() => {
    load();
  }, []);

  if (adding) {
    return (
      <NewClient
        onCreated={() => {
          setAdding(false);
          load();
        }}
      />
    );
  }

  return (
    <div className="p-8 max-w-4xl rise">
      <header className="flex items-end justify-between mb-7">
        <div>
          <div className="eyebrow mb-2">clients</div>
          <h1 className="text-2xl">Every creator, on file</h1>
          <p className="text-sm mt-2" style={{ color: 'var(--color-muted)' }}>
            Saved brands power repeat builds and upsells. Reuse a client's colors, links, and term swaps
            on the next rebrand.
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setAdding(true)}>
          + New client
        </button>
      </header>

      {clients.length === 0 ? (
        <div className="panel p-8 text-center" style={{ color: 'var(--color-muted)' }}>
          No clients yet. Add your first creator to start an assembly line.
        </div>
      ) : (
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px,1fr))' }}>
          {clients.map((c) => (
            <article key={c.id} className="panel p-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-base">{c.creatorName}</h2>
                {c.handle && <span className="chip">{c.handle}</span>}
              </div>
              <div className="flex flex-wrap gap-1.5 mt-3">
                {c.brandColors.map((hex) => (
                  <span key={hex} className="inline-flex items-center gap-1 chip mono" style={{ fontSize: '0.66rem' }}>
                    <span style={{ width: 10, height: 10, borderRadius: 3, background: hex, display: 'inline-block' }} />
                    {hex}
                  </span>
                ))}
              </div>
              {c.links.length > 0 && (
                <div className="mono text-[0.7rem] mt-2 truncate" style={{ color: 'var(--color-source)' }}>
                  {c.links[0]}
                </div>
              )}
              {c.notes && (
                <p className="text-[0.78rem] mt-2" style={{ color: 'var(--color-muted)' }}>
                  {c.notes}
                </p>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
