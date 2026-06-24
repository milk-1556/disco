import { useState } from 'react';
import { api, setToken } from '../api.js';
import { Logo } from '../components/Logo.js';

export function Login({ onAuthed }: { onAuthed: () => void }) {
  const [email, setEmail] = useState('operator@disco.local');
  const [password, setPassword] = useState('disco');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { token } = await api.login(email, password);
      setToken(token);
      onAuthed();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-full grid place-items-center p-6">
      <div className="w-full max-w-sm rise">
        <div className="flex items-center gap-3 mb-8">
          <Logo size={34} />
          <div>
            <div className="text-xl font-semibold" style={{ fontFamily: 'var(--font-display)' }}>
              Disco
            </div>
            <div className="eyebrow mt-0.5">cloning console</div>
          </div>
        </div>

        <div className="panel p-6">
          <h1 className="text-lg mb-1">Sign in</h1>
          <p className="text-sm mb-5" style={{ color: 'var(--color-muted)' }}>
            One operator, every build. Pick up where the assembly line left off.
          </p>
          <form onSubmit={submit} className="space-y-3">
            <div>
              <div className="label mb-1">Email</div>
              <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" autoFocus />
            </div>
            <div>
              <div className="label mb-1">Password</div>
              <input
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>
            {error && (
              <div className="text-sm" style={{ color: 'var(--color-danger)' }}>
                {error}
              </div>
            )}
            <button className="btn btn-primary w-full justify-center" disabled={busy}>
              {busy ? 'Signing in…' : 'Enter the console'}
            </button>
          </form>
        </div>
        <p className="text-xs mt-4 text-center mono" style={{ color: 'var(--color-faint)' }}>
          demo mode · operator@disco.local · disco
        </p>
      </div>
    </div>
  );
}
