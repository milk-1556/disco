import { useEffect, useState } from 'react';
import { api, type Client } from '../api.js';
import { NewClient } from './NewClient.js';

export function Clients() {
  const [clients, setClients] = useState<Client[]>([]);
  const [adding, setAdding] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = () => {
    setError(false);
    return api
      .clients()
      .then(setClients)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    load();
  }, []);

  async function remove(c: Client) {
    if (!confirm(`Remove ${c.creatorName}? Their builds stay on the record but get unlinked.`)) return;
    setClients((prev) => prev.filter((x) => x.id !== c.id)); // optimistic
    await api.deleteClient(c.id).catch(load);
  }
  const fmt$ = (n: number) => `$${Math.round(n).toLocaleString()}`;

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
    <div className="px-4 py-6 md:p-8 max-w-4xl rise">
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

      {loading ? (
        <div className="panel p-8 text-center" style={{ color: 'var(--color-muted)' }}>
          Loading your client roster…
        </div>
      ) : error ? (
        <div className="panel p-8 text-center">
          <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
            Couldn't reach your client roster. Check the connection and try again.
          </p>
          <button className="btn btn-ghost text-sm mt-4" onClick={() => { setLoading(true); load(); }}>
            Retry
          </button>
        </div>
      ) : clients.length === 0 ? (
        <div className="panel p-10 text-center">
          <div className="eyebrow mb-2" style={{ color: 'var(--color-client)' }}>your roster is empty</div>
          <h2 className="text-lg">Add your first creator</h2>
          <p className="text-sm mt-2 mx-auto" style={{ color: 'var(--color-muted)', maxWidth: 360 }}>
            Save a creator's brand once — colors, links, term swaps, and the deal — and every future rebrand
            ships in their identity from a single snapshot.
          </p>
          <button className="btn btn-primary mt-5" onClick={() => setAdding(true)}>
            + New client
          </button>
        </div>
      ) : (
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px,1fr))' }}>
          {clients.map((c) => (
            <article key={c.id} className="panel p-4 flex flex-col">
              <div className="flex items-start justify-between gap-2">
                <h2 className="text-base leading-tight">{c.creatorName}</h2>
                {c.handle && <span className="chip mono shrink-0" style={{ color: 'var(--color-client)' }}>{c.handle}</span>}
              </div>
              {c.brandColors.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {c.brandColors.map((hex) => (
                    <span key={hex} className="inline-flex items-center gap-1 chip mono" style={{ fontSize: '0.66rem' }}>
                      <span style={{ width: 10, height: 10, borderRadius: 3, background: hex, display: 'inline-block' }} />
                      {hex}
                    </span>
                  ))}
                </div>
              )}
              {c.links.length > 0 && (
                <div className="mono text-[0.7rem] mt-2 truncate" style={{ color: 'var(--color-source)' }} title={c.links[0]}>
                  {c.links[0]}
                </div>
              )}
              {c.notes && (
                <p className="text-[0.78rem] mt-2" style={{ color: 'var(--color-muted)' }}>
                  {c.notes}
                </p>
              )}
              <div className="flex items-end gap-2 mt-auto pt-3 text-[0.72rem]" style={{ borderTop: '1px solid var(--color-line-soft)', marginTop: c.brandColors.length || c.links.length || c.notes ? undefined : '0.75rem' }}>
                {c.buildPrice > 0 || c.monthlyRetainer > 0 ? (
                  <div className="leading-snug">
                    <span className="mono text-sm" style={{ color: 'var(--color-jade)' }}>
                      {c.buildPrice > 0 ? fmt$(c.buildPrice) : '—'}
                    </span>
                    {c.monthlyRetainer > 0 && (
                      <span className="mono" style={{ color: 'var(--color-muted)' }}> + {fmt$(c.monthlyRetainer)}/mo</span>
                    )}
                    {c.upsells.length > 0 && (
                      <div className="mono mt-0.5" style={{ color: 'var(--color-faint)', fontSize: '0.66rem' }}>
                        +{c.upsells.length} upsell{c.upsells.length === 1 ? '' : 's'}
                      </div>
                    )}
                  </div>
                ) : (
                  <span style={{ color: 'var(--color-faint)' }}>No deal priced yet</span>
                )}
                <button className="btn btn-ghost text-xs ml-auto shrink-0" style={{ padding: '0.3rem 0.6rem', color: 'var(--color-faint)' }} onClick={() => remove(c)} aria-label={`Remove ${c.creatorName}`}>
                  Remove
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
