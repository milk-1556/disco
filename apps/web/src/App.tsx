import { useEffect, useState } from 'react';
import { api, getToken, setToken, type SnapshotSummary } from './api.js';
import { Shell, type View } from './components/Shell.js';
import { Activity } from './screens/Activity.js';
import { BuildConsole } from './screens/BuildConsole.js';
import { Clients } from './screens/Clients.js';
import { Economics } from './screens/Economics.js';
import { HandoverPage } from './screens/HandoverPage.js';
import { Invite } from './screens/Invite.js';
import { Library } from './screens/Library.js';
import { Login } from './screens/Login.js';
import { PublicHandover } from './screens/PublicHandover.js';
import { Queue } from './screens/Queue.js';
import { Setup } from './screens/Setup.js';
import { Today } from './screens/Today.js';
import { SnapshotDiff } from './screens/SnapshotDiff.js';

function usePublicHandoverId(): string | null {
  const [id, setId] = useState(() => location.hash.match(/^#\/h\/(.+)$/)?.[1] ?? null);
  useEffect(() => {
    const on = () => setId(location.hash.match(/^#\/h\/(.+)$/)?.[1] ?? null);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return id;
}

export default function App() {
  const publicId = usePublicHandoverId();
  const [authed, setAuthed] = useState(!!getToken());
  const [view, setView] = useState<View>('today');
  const [mode, setMode] = useState('demo');
  const [applicationId, setApplicationId] = useState<string | null>(null);
  const [buildSnapshot, setBuildSnapshot] = useState<string | null>(null);
  const [diffSnapshots, setDiffSnapshots] = useState<SnapshotSummary[] | null>(null);
  const [handoverJob, setHandoverJob] = useState<string | null>(null);

  useEffect(() => {
    api
      .config()
      .then((c) => {
        setMode(c.mode);
        setApplicationId(c.applicationId);
      })
      .catch(() => {});
  }, [authed]);

  // Public, shareable, unauthenticated delivery page — bypasses login entirely.
  if (publicId) return <PublicHandover id={publicId} />;

  if (!authed) return <Login onAuthed={() => setAuthed(true)} />;

  const go = (v: View) => {
    setHandoverJob(null);
    setDiffSnapshots(null);
    setView(v);
  };

  return (
    <Shell
      view={view}
      setView={go}
      mode={mode}
      onSignOut={() => {
        setToken(null);
        setAuthed(false);
      }}
    >
      {handoverJob ? (
        <HandoverPage jobId={handoverJob} onBack={() => setHandoverJob(null)} />
      ) : diffSnapshots ? (
        <SnapshotDiff snapshots={diffSnapshots} onBack={() => setDiffSnapshots(null)} />
      ) : view === 'today' ? (
        <Today go={go} onOpenHandover={(jobId) => setHandoverJob(jobId)} />
      ) : view === 'library' ? (
        <Library
          onBuild={(id) => {
            setBuildSnapshot(id);
            setView('build');
          }}
          onCompare={async () => setDiffSnapshots(await api.snapshots())}
        />
      ) : view === 'build' ? (
        buildSnapshot ? (
          <BuildConsole snapshotId={buildSnapshot} />
        ) : (
          <div className="p-8" style={{ color: 'var(--color-muted)' }}>
            Pick a snapshot in the Library to start a build.
          </div>
        )
      ) : view === 'queue' ? (
        <Queue onOpen={(jobId) => setHandoverJob(jobId)} />
      ) : view === 'clients' ? (
        <Clients />
      ) : view === 'activity' ? (
        <Activity />
      ) : view === 'economics' ? (
        <Economics />
      ) : view === 'setup' ? (
        <Setup go={go} />
      ) : (
        <Invite applicationId={applicationId} />
      )}
    </Shell>
  );
}
