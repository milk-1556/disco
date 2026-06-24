import { Component, type ReactNode } from 'react';

/** App-level crash guard — a render error shows an on-brand recovery card instead of a white screen. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-full grid place-items-center p-6" style={{ minHeight: '100vh' }}>
          <div className="panel p-8 rise text-center" style={{ maxWidth: 440 }}>
            <div className="eyebrow mb-2" style={{ color: 'var(--color-danger)' }}>something broke</div>
            <h1 className="text-xl mb-2">The console hit an unexpected error</h1>
            <p className="text-sm mb-5 mx-auto" style={{ color: 'var(--color-muted)', maxWidth: 340 }}>
              Reload to get back to work — nothing you’ve built is lost. If it keeps happening, the build log in Queue usually has the detail.
            </p>
            <button className="btn btn-primary" onClick={() => location.reload()}>
              Reload Disco
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
