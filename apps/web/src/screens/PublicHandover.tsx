import { useEffect, useState } from 'react';
import { api, assetUrl, type PublicHandover as PublicHandoverData } from '../api.js';
import { BotSetupList } from '../components/BotSetupList.js';
import { Logo } from '../components/Logo.js';
import { deliveredScope } from '../scope.js';

/** The shareable, client-facing delivery page (unauthenticated, optionally password-gated). */
export function PublicHandover({ id }: { id: string }) {
  const [data, setData] = useState<PublicHandoverData | null>(null);
  const [needsPw, setNeedsPw] = useState(false);
  const [pw, setPw] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load(password?: string) {
    setErr(null);
    setBusy(true);
    try {
      setData(await api.publicHandover(id, password));
      setNeedsPw(false);
    } catch (e) {
      if (e instanceof Error && e.message === 'PASSWORD_REQUIRED') {
        setNeedsPw(true);
        if (password) setErr('That password didn’t match. Double-check it with your builder.');
      } else setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    load();
  }, [id]);

  if (needsPw) {
    return (
      <div className="min-h-full grid place-items-center px-4 py-6 md:p-8">
        <div className="w-full max-w-sm panel p-6 rise">
          <div className="flex items-center gap-2 mb-4">
            <Logo size={26} />
            <span className="eyebrow">protected delivery</span>
          </div>
          <h1 className="text-lg mb-1">This handover is password-protected</h1>
          <p className="text-sm mb-4" style={{ color: 'var(--color-muted)' }}>
            Enter the password your builder shared with you to view your new community.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (pw && !busy) load(pw);
            }}
          >
            <input
              className="input mb-3"
              type="password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              placeholder="Password"
              autoFocus
              autoComplete="off"
            />
            {err && <div className="text-sm mb-3" style={{ color: 'var(--color-danger)' }}>{err}</div>}
            <button className="btn btn-primary w-full justify-center" disabled={!pw || busy}>
              {busy ? 'Unlocking…' : 'Unlock'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (err) {
    return (
      <div className="min-h-full grid place-items-center px-4 py-6 md:p-8">
        <div className="w-full max-w-sm panel p-6 rise text-center">
          <div className="flex items-center justify-center gap-2 mb-4">
            <Logo size={26} />
            <span className="eyebrow">delivery</span>
          </div>
          <h1 className="text-lg mb-1">We couldn’t load this handover</h1>
          <p className="text-sm mb-4" style={{ color: 'var(--color-muted)' }}>
            The link may have expired or moved. Ask your builder for a fresh delivery link, then try again.
          </p>
          <div className="panel-soft p-3 mb-4 text-xs mono break-words" style={{ color: 'var(--color-danger)' }}>
            {err}
          </div>
          <button className="btn btn-primary w-full justify-center" disabled={busy} onClick={() => load()}>
            {busy ? 'Retrying…' : 'Try again'}
          </button>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-full grid place-items-center px-4 py-6 md:p-8">
        <div className="flex items-center gap-3 rise" style={{ color: 'var(--color-muted)' }}>
          <span className="w-2 h-2 rounded-full live-dot" style={{ background: 'var(--color-jade)' }} />
          <span className="text-sm">Loading your community…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full">
      <div className="max-w-3xl mx-auto px-4 py-6 md:p-8 rise">
        <header className="flex items-center gap-4 mb-8">
          {data.logoUrl ? (
            <img src={assetUrl(data.logoUrl)} alt="" style={{ width: 56, height: 56, borderRadius: 14, objectFit: 'cover' }} className="transform-ring shrink-0" />
          ) : (
            <div className="transform-ring grid place-items-center shrink-0" style={{ width: 56, height: 56, borderRadius: 14 }}>
              <Logo size={28} />
            </div>
          )}
          <div className="min-w-0">
            <div className="eyebrow mb-1 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--color-jade)' }} />
              your new community is ready
            </div>
            <h1 className="text-2xl transform-text break-words">{data.serverName ?? 'Your server'}</h1>
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
            {deliveredScope(data.created, data.botSetup.length).map((t) => (
              <div key={t.label} className="panel-soft px-3 py-3 text-center">
                <div className="text-2xl leading-none" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-jade)' }}>{t.value}</div>
                <div className="text-[0.62rem] mono mt-1.5" style={{ color: 'var(--color-faint)' }}>{t.label}</div>
              </div>
            ))}
          </div>
        </section>

        {data.botSetup.length > 0 && (
          <section className="panel p-5 mb-6">
            <div className="flex items-baseline gap-2 mb-3 flex-wrap">
              <span className="eyebrow">bots to add</span>
              <span className="text-[0.68rem]" style={{ color: 'var(--color-faint)' }}>
                each one re-invites with its own settings — vendor configs can’t be copied for you
              </span>
            </div>
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

        <footer className="flex items-center justify-center gap-2 py-6">
          <Logo size={14} />
          <span className="mono text-[0.7rem]" style={{ color: 'var(--color-faint)' }}>delivered with Disco</span>
        </footer>
      </div>
    </div>
  );
}
