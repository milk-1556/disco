/** Shown when the API is unreachable — a calm, on-brand "we're down briefly" instead of a broken app. */
export function Maintenance() {
  return (
    <div className="grid place-items-center p-6" style={{ minHeight: '100vh' }}>
      <div className="panel p-8 rise text-center" style={{ maxWidth: 440 }}>
        <div className="mx-auto mb-4 transform-ring grid place-items-center" style={{ width: 56, height: 56, borderRadius: 16 }}>
          <span className="live-dot" style={{ background: 'var(--color-gold)' }} />
        </div>
        <div className="eyebrow mb-2" style={{ color: 'var(--color-gold)' }}>maintenance</div>
        <h1 className="text-xl mb-2">Disco is taking a quick break</h1>
        <p className="text-sm mb-6 mx-auto" style={{ color: 'var(--color-muted)', maxWidth: 330 }}>
          The console can’t reach the server right now. Nothing you’ve built is lost — this is almost always brief.
        </p>
        <button className="btn btn-primary" onClick={() => location.reload()}>Try again</button>
      </div>
    </div>
  );
}
