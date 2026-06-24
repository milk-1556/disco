/** On-brand 404 — used for bad public links + any unknown route. */
export function NotFound({ message, onHome }: { message?: string; onHome?: () => void }) {
  const home = onHome ?? (() => { location.hash = ''; location.assign('/'); });
  return (
    <div className="grid place-items-center p-6" style={{ minHeight: '100vh' }}>
      <div className="panel p-8 rise text-center" style={{ maxWidth: 440 }}>
        <svg aria-hidden width="120" height="56" viewBox="0 0 120 56" className="mx-auto mb-4" style={{ opacity: 0.9 }}>
          <defs>
            <linearGradient id="nf-spine" x1="0" y1="0" x2="120" y2="0" gradientUnits="userSpaceOnUse">
              <stop stopColor="var(--color-source)" />
              <stop offset="1" stopColor="var(--color-client)" />
            </linearGradient>
          </defs>
          <circle cx="20" cy="28" r="9" fill="none" stroke="var(--color-source)" strokeWidth="2" />
          <path d="M31 28 H89" stroke="url(#nf-spine)" strokeWidth="2" strokeDasharray="2 5" strokeLinecap="round" />
          <path d="M84 20 L92 28 L84 36" fill="none" stroke="var(--color-client)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.5" />
          <circle cx="100" cy="28" r="9" fill="none" stroke="var(--color-client)" strokeWidth="2" strokeDasharray="3 4" />
        </svg>
        <div className="eyebrow mb-2" style={{ color: 'var(--color-client)' }}>404 · not found</div>
        <h1 className="text-xl mb-2">This page didn’t build</h1>
        <p className="text-sm mb-6 mx-auto" style={{ color: 'var(--color-muted)', maxWidth: 320 }}>
          {message ?? 'The link is broken or the page has moved. Nothing you’ve built is lost.'}
        </p>
        <button className="btn btn-primary" onClick={home}>Back to Disco</button>
      </div>
    </div>
  );
}
