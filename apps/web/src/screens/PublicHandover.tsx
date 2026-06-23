import { useEffect, useState } from 'react';
import { api, assetUrl, type PublicHandover as PublicHandoverData } from '../api.js';
import { BotSetupList } from '../components/BotSetupList.js';
import { Logo } from '../components/Logo.js';

const COUNT_ORDER = ['channels', 'roles', 'categories', 'emojis', 'automod', 'bots'];

/** The shareable, client-facing delivery page (unauthenticated, optionally password-gated). */
export function PublicHandover({ id }: { id: string }) {
  const [data, setData] = useState<PublicHandoverData | null>(null);
  const [needsPw, setNeedsPw] = useState(false);
  const [pw, setPw] = useState('');
  const [err, setErr] = useState<string | null>(null);

  async function load(password?: string) {
    setErr(null);
    try {
      setData(await api.publicHandover(id, password));
      setNeedsPw(false);
    } catch (e) {
      if (e instanceof Error && e.message === 'PASSWORD_REQUIRED') {
        setNeedsPw(true);
        if (password) setErr('Incorrect password.');
      } else setErr(e instanceof Error ? e.message : String(e));
    }
  }
  useEffect(() => {
    load();
  }, [id]);

  if (needsPw) {
    return (
      <div className="min-h-full grid place-items-center p-6">
        <div className="w-full max-w-sm panel p-6 rise">
          <div className="flex items-center gap-2 mb-4">
            <Logo size={26} />
            <span className="eyebrow">protected delivery</span>
          </div>
          <h1 className="text-lg mb-1">This handover is password-protected</h1>
          <p className="text-sm mb-4" style={{ color: 'var(--color-muted)' }}>
            Enter the password your builder shared with you.
          </p>
          <input className="input mb-3" type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Password" />
          {err && <div className="text-sm mb-3" style={{ color: 'var(--color-danger)' }}>{err}</div>}
          <button className="btn btn-primary w-full justify-center" onClick={() => load(pw)}>
            Unlock
          </button>
        </div>
      </div>
    );
  }

  if (err) return <div className="p-8" style={{ color: 'var(--color-danger)' }}>{err}</div>;
  if (!data) return <div className="p-8" style={{ color: 'var(--color-muted)' }}>Loading…</div>;

  return (
    <div className="min-h-full">
      <div className="max-w-3xl mx-auto p-8 rise">
        <header className="flex items-center gap-4 mb-8">
          {data.logoUrl ? (
            <img src={assetUrl(data.logoUrl)} alt="" style={{ width: 56, height: 56, borderRadius: 14, objectFit: 'cover' }} className="transform-ring" />
          ) : (
            <div className="transform-ring grid place-items-center" style={{ width: 56, height: 56, borderRadius: 14 }}>
              <Logo size={28} />
            </div>
          )}
          <div>
            <div className="eyebrow mb-1">your new community is ready</div>
            <h1 className="text-2xl transform-text">{data.serverName ?? 'Your server'}</h1>
          </div>
        </header>

        {data.welcomeMessage && (
          <div className="panel p-5 mb-6">
            <p className="text-sm leading-relaxed" style={{ color: 'var(--color-bone)' }}>{data.welcomeMessage}</p>
          </div>
        )}

        <section className="panel p-5 mb-6">
          <div className="eyebrow mb-3">what's included</div>
          <div className="grid grid-cols-3 gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(90px,1fr))' }}>
            {COUNT_ORDER.map((k) => (
              <div key={k} className="panel-soft px-3 py-3 text-center">
                <div className="text-2xl leading-none" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-jade)' }}>{data.scope[k] ?? 0}</div>
                <div className="text-[0.62rem] mono mt-1.5" style={{ color: 'var(--color-faint)' }}>{k}</div>
              </div>
            ))}
          </div>
        </section>

        {data.botSetup.length > 0 && (
          <section className="panel p-5 mb-6">
            <div className="eyebrow mb-3">bots to add</div>
            <BotSetupList entries={data.botSetup} />
          </section>
        )}

        <section className="panel p-5 mb-6">
          <div className="eyebrow mb-3">how to take ownership</div>
          <ol className="space-y-2">
            {data.ownershipSteps.map((s, i) => (
              <li key={i} className="panel-soft px-3 py-2 flex gap-3">
                <span className="mono text-xs" style={{ color: 'var(--color-client)' }}>{String(i + 1).padStart(2, '0')}</span>
                <div>
                  <div className="text-sm font-medium">{s.title}</div>
                  {s.detail && <div className="text-[0.72rem] mt-0.5" style={{ color: 'var(--color-muted)' }}>{s.detail}</div>}
                </div>
              </li>
            ))}
          </ol>
        </section>

        <footer className="text-center mono text-[0.7rem] py-4" style={{ color: 'var(--color-faint)' }}>
          delivered with Disco
        </footer>
      </div>
    </div>
  );
}
