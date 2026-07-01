import { useState } from 'react';
import { api } from '../api.js';

/** Self-service password change (DB operators). The env bootstrap admin gets the server's clear message
 *  that their password is environment-managed. Requires the current password. */
export function ChangePassword() {
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const mismatch = next !== '' && confirm !== '' && next !== confirm;
  const canSubmit = cur && next && next === confirm && next.length >= 8 && !busy;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setMsg(null);
    try {
      await api.changePassword(cur, next);
      setMsg({ ok: true, text: 'Password changed.' });
      setCur(''); setNext(''); setConfirm('');
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : 'Could not change the password.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel p-5 mb-6" style={{ maxWidth: 420 }}>
      <div className="eyebrow mb-3">change password</div>
      <div className="space-y-2.5">
        <input className="input" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} placeholder="Current password" />
        <input className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="New password (min 8 characters)" />
        <input className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Confirm new password" style={mismatch ? { borderColor: 'var(--color-danger)' } : undefined} />
      </div>
      {mismatch && <div className="text-xs mt-2" style={{ color: 'var(--color-danger)' }}>Passwords don't match.</div>}
      {msg && <div className="text-xs mt-2" style={{ color: msg.ok ? 'var(--color-jade)' : 'var(--color-danger)' }}>{msg.text}</div>}
      <button className="btn btn-primary mt-3" disabled={!canSubmit} onClick={submit}>{busy ? 'Saving…' : 'Update password'}</button>
    </section>
  );
}
