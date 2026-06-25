import { useEffect, useRef, useState } from 'react';
import { api, assetUrl, type BotSetupEntry, type ManualStep, type PublicHandover as PublicHandoverData } from '../api.js';
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

        <ManagingGuide
          serverName={data.serverName ?? 'your server'}
          created={data.created}
          botSetup={data.botSetup}
          manualSteps={data.manualSteps}
          onFirstOpen={() => api.trackHandoverEvent(id, 'docs_viewed')}
        />

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

        <ClientSurvey id={id} done={data.surveyDone} />

        <footer className="flex items-center justify-center gap-2 py-6">
          <Logo size={14} />
          <span className="mono text-[0.7rem]" style={{ color: 'var(--color-faint)' }}>delivered with Disco</span>
        </footer>
      </div>
    </div>
  );
}

/**
 * One-question client feedback card (#4): an NPS "how likely to recommend" selector plus an
 * optional free-text comment. Friendly, non-technical, creator-facing voice — this is the client,
 * not the operator. Submits via the public fire-and-forget survey endpoint, then flips to a local
 * thank-you state. If feedback was already given (`done`), shows only the confirmation.
 */
function ClientSurvey({ id, done }: { id: string; done: boolean }) {
  const [sent, setSent] = useState(done);
  const [nps, setNps] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);

  if (sent) {
    return (
      <section className="panel p-5 mb-6">
        <div className="flex items-center gap-2.5">
          <span
            className="grid place-items-center shrink-0"
            style={{ width: 26, height: 26, borderRadius: 999, background: 'color-mix(in srgb, var(--color-jade) 18%, transparent)', color: 'var(--color-jade)' }}
            aria-hidden="true"
          >
            ✓
          </span>
          <p className="text-sm" style={{ color: 'var(--color-bone)' }}>
            Thanks for your feedback ✓
          </p>
        </div>
      </section>
    );
  }

  async function send() {
    if (nps === null || sending) return;
    setSending(true);
    setFailed(false);
    const ok = await api.submitSurvey(id, nps, comment.trim());
    setSending(false);
    if (ok) setSent(true); // only show the thank-you when it actually sent
    else setFailed(true);
  }

  return (
    <section className="panel p-5 mb-6">
      <div className="eyebrow mb-2">one quick thing</div>
      <h2 className="text-sm font-medium mb-1">How likely are you to recommend us?</h2>
      <p className="text-[0.78rem] leading-relaxed mb-4" style={{ color: 'var(--color-faint)' }}>
        Tap a number, from 0 (not likely) to 10 (absolutely). It takes a second and really helps us.
      </p>

      <div className="flex flex-wrap gap-1.5 mb-4" role="group" aria-label="Recommendation score from 0 to 10">
        {Array.from({ length: 11 }, (_, n) => {
          const selected = nps === n;
          return (
            <button
              key={n}
              type="button"
              onClick={() => setNps(n)}
              aria-pressed={selected}
              className="mono text-sm grid place-items-center transition"
              style={{
                width: 38,
                height: 38,
                borderRadius: 10,
                border: '1px solid var(--color-line)',
                background: selected ? 'var(--color-client)' : 'transparent',
                color: selected ? '#fff' : 'var(--color-muted)',
                borderColor: selected ? 'var(--color-client)' : 'var(--color-line)',
                fontWeight: selected ? 600 : 400,
              }}
            >
              {n}
            </button>
          );
        })}
      </div>

      <label className="label block mb-1.5" htmlFor="survey-comment">
        Anything you’d like us to know? <span style={{ color: 'var(--color-faint)' }}>(optional)</span>
      </label>
      <textarea
        id="survey-comment"
        className="input mb-4"
        rows={3}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="What you loved, what we could do better…"
        style={{ resize: 'vertical' }}
      />

      <button
        type="button"
        className="btn btn-primary w-full justify-center"
        disabled={nps === null || sending}
        onClick={send}
      >
        {sending ? 'Sending…' : 'Send feedback'}
      </button>
      {failed && (
        <p className="text-[0.72rem] mt-2 text-center" style={{ color: 'var(--color-danger)' }}>
          Couldn’t send that — check your connection and try again.
        </p>
      )}
    </section>
  );
}

/**
 * Plain-language "how to run your community" guide, derived entirely from the handover data
 * (no new server fields). Non-technical voice for a creator, and honest — every claim is
 * grounded in something that was actually built. Used on the public delivery page and mirrored
 * as a preview on the operator handover page so the operator sees exactly what the client gets.
 */
export function ManagingGuide({
  serverName,
  created,
  botSetup,
  manualSteps,
  defaultOpen = false,
  preview = false,
  onFirstOpen,
}: {
  serverName: string;
  created: string[];
  botSetup: BotSetupEntry[];
  manualSteps: ManualStep[];
  defaultOpen?: boolean;
  preview?: boolean;
  /** Fired once when the client first expands the guide — an engagement beacon (#4). Omitted in preview. */
  onFirstOpen?: () => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const fired = useRef(false);
  const toggle = () =>
    setOpen((o) => {
      if (!o && !fired.current) {
        fired.current = true;
        onFirstOpen?.();
      }
      return !o;
    });

  const count = (kind: string) => created.filter((c) => c.startsWith(`${kind}:`)).length;
  const channels = count('channel');
  const categories = count('category');
  const roles = count('role');

  // First sentence of a bot's reconfigure notes, made client-readable.
  const oneLine = (b: BotSetupEntry): string => {
    const first = b.reconfigure.find((r) => r.trim().length > 0);
    if (!first) return 'A helper bot that adds extra features to your server.';
    let s = first.split(/(?<=[.!?])\s/)[0].trim();
    s = s.replace(/\s+/g, ' ');
    return s.length > 120 ? `${s.slice(0, 117).trimEnd()}…` : s;
  };

  // Manual steps reframed as friendly "do this" items (title only — reasons are operator-facing).
  const healthItems = manualSteps.map((m) => m.title.trim()).filter(Boolean);

  const hasContent = channels + categories + roles > 0 || botSetup.length > 0 || healthItems.length > 0;
  if (!hasContent) return null;

  return (
    <section className="panel p-5 mb-6">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 text-left"
      >
        <span className="min-w-0">
          <span className="eyebrow block mb-1">
            {preview ? 'managing your community · client preview' : 'managing your community'}
          </span>
          <span className="text-sm font-medium block">
            A plain-language guide to running {serverName} day-to-day
          </span>
        </span>
        <span
          className="shrink-0 mono text-xs grid place-items-center transition"
          style={{
            width: 26,
            height: 26,
            borderRadius: 8,
            border: '1px solid var(--color-line)',
            color: 'var(--color-muted)',
            transform: open ? 'rotate(180deg)' : 'none',
          }}
          aria-hidden="true"
        >
          ⌄
        </span>
      </button>

      {open && (
        <div className="mt-4 space-y-4">
          <p className="text-sm leading-relaxed" style={{ color: 'var(--color-bone)' }}>
            Here’s how {serverName} is organized and how to run it day-to-day. No technical know-how
            needed — this is a friendly map of what’s set up and how to keep it humming.
          </p>

          {(channels > 0 || categories > 0) && (
            <div className="panel-soft p-3">
              <div className="text-sm font-medium mb-1">Your channels</div>
              <p className="text-[0.8rem] leading-relaxed" style={{ color: 'var(--color-muted)' }}>
                You’ve got {channels} {channels === 1 ? 'channel' : 'channels'} for your members to
                talk, post, and hang out in
                {categories > 0
                  ? `. They’re tidied into ${categories} ${categories === 1 ? 'category' : 'categories'} — the labeled groups in your sidebar that keep related channels together.`
                  : '.'}{' '}
                Members tap a channel to jump into that conversation.
              </p>
            </div>
          )}

          {roles > 0 && (
            <div className="panel-soft p-3">
              <div className="text-sm font-medium mb-1">Roles &amp; permissions</div>
              <p className="text-[0.8rem] leading-relaxed" style={{ color: 'var(--color-muted)' }}>
                There are {roles} {roles === 1 ? 'role' : 'roles'} set up. Roles are the badges you
                give members (like “Mod” or “VIP”) — they decide who can see and do what, so you can
                open up perks or lock down sensitive channels without touching everyone at once.
              </p>
            </div>
          )}

          {botSetup.length > 0 && (
            <div className="panel-soft p-3">
              <div className="text-sm font-medium mb-2">Your bots</div>
              <p className="text-[0.78rem] leading-relaxed mb-2" style={{ color: 'var(--color-faint)' }}>
                Bots are little helpers that run automatically in your server. Yours:
              </p>
              <ul className="space-y-1.5">
                {botSetup.map((b, i) => (
                  <li key={i} className="text-[0.8rem] flex gap-2" style={{ color: 'var(--color-muted)' }}>
                    <span style={{ color: 'var(--color-client)' }}>›</span>
                    <span>
                      <span className="font-medium" style={{ color: 'var(--color-bone)' }}>{b.name}</span>
                      {' — '}
                      {oneLine(b)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {healthItems.length > 0 && (
            <div className="panel-soft p-3">
              <div className="text-sm font-medium mb-2">Keeping it healthy</div>
              <p className="text-[0.78rem] leading-relaxed mb-2" style={{ color: 'var(--color-faint)' }}>
                A few things to take care of so everything keeps working smoothly:
              </p>
              <ul className="space-y-1.5">
                {healthItems.map((t, i) => (
                  <li key={i} className="text-[0.8rem] flex gap-2" style={{ color: 'var(--color-muted)' }}>
                    <span style={{ color: 'var(--color-gold)' }}>○</span>
                    <span>{t}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-[0.74rem] leading-relaxed" style={{ color: 'var(--color-faint)' }}>
            Want a hand keeping {serverName} growing — new channels, events, or a fresh look? Your
            builder can help. Just reply to the message that delivered this page.
          </p>
        </div>
      )}
    </section>
  );
}
