import { useEffect, useState } from 'react';
import { api, type OperatorAccount } from '../api.js';

/**
 * Admin-only team management (multi-operator / white-label): invite scoped operators, see the team,
 * remove access. Self-hides for non-admins — the /operators endpoint 403s and this renders nothing,
 * so a regular operator never even sees the panel.
 */
export function OperatorAccounts() {
  const [ops, setOps] = useState<OperatorAccount[] | null>(null);
  const [hidden, setHidden] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = () => api.operators().then(setOps).catch(() => setHidden(true));
  useEffect(() => { load(); }, []);

  async function invite() {
    if (!email || password.length < 8 || busy) return;
    setBusy(true); setErr(null);
    try {
      await api.inviteOperator(email.trim(), password);
      setEmail(''); setPassword('');
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not invite that operator.');
    } finally {
      setBusy(false);
    }
  }
  async function remove(o: OperatorAccount) {
    if (!confirm(`Remove ${o.email}? They lose access immediately; their builds stay on the record.`)) return;
    setOps((prev) => (prev ?? []).filter((x) => x.id !== o.id));
    await api.removeOperator(o.id).catch(load);
  }

  if (hidden) return null;

  return (
    <section className="panel p-5 mb-6" style={{ maxWidth: 560 }}>
      <div className="flex items-baseline gap-2 mb-1 flex-wrap">
        <span className="eyebrow">operators</span>
        <span className="text-[0.68rem]" style={{ color: 'var(--color-faint)' }}>invite scoped teammates — each sees only their own clients &amp; builds</span>
      </div>

      <div className="space-y-1.5 my-4">
        {ops === null ? (
          <div className="text-sm" style={{ color: 'var(--color-faint)' }}>Loading team…</div>
        ) : ops.length === 0 ? (
          <div className="text-sm" style={{ color: 'var(--color-faint)' }}>No additional operators yet — you're the only one. Invite a teammate below.</div>
        ) : (
          ops.map((o) => (
            <div key={o.id} className="panel-soft px-3 py-2.5 flex items-center gap-3">
              <span className="text-sm" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{o.email}</span>
              <span className="chip mono text-[0.62rem]" style={{ color: 'var(--color-muted)' }}>{o.role}</span>
              <button className="btn btn-ghost text-xs" style={{ padding: '0.2rem 0.55rem', color: 'var(--color-faint)' }} onClick={() => remove(o)} aria-label={`Remove ${o.email}`}>Remove</button>
            </div>
          ))
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-2 items-stretch">
        <input className="input" type="email" inputMode="email" value={email} onChange={(e) => { setEmail(e.target.value); setErr(null); }} placeholder="teammate@email.com" style={{ flex: 1 }} />
        <input className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => { setPassword(e.target.value); setErr(null); }} placeholder="Temp password (min 8)" style={{ flex: 1 }} />
        <button className="btn btn-primary shrink-0" disabled={!email || password.length < 8 || busy} onClick={invite}>{busy ? 'Inviting…' : 'Invite'}</button>
      </div>
      {err && <div className="text-xs mt-2" style={{ color: 'var(--color-danger)' }}>{err}</div>}
    </section>
  );
}
