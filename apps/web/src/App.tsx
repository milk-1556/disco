import { useEffect, useState } from 'react';
import { api, getToken, setToken } from './api.js';
import { Shell, type View } from './components/Shell.js';
import { BuildConsole } from './screens/BuildConsole.js';
import { Invite } from './screens/Invite.js';
import { Library } from './screens/Library.js';
import { Login } from './screens/Login.js';
import { Queue } from './screens/Queue.js';

export default function App() {
  const [authed, setAuthed] = useState(!!getToken());
  const [view, setView] = useState<View>('library');
  const [mode, setMode] = useState('demo');
  const [applicationId, setApplicationId] = useState<string | null>(null);
  const [buildSnapshot, setBuildSnapshot] = useState<string | null>(null);

  useEffect(() => {
    api
      .config()
      .then((c) => {
        setMode(c.mode);
        setApplicationId(c.applicationId);
      })
      .catch(() => {});
  }, [authed]);

  if (!authed) return <Login onAuthed={() => setAuthed(true)} />;

  return (
    <Shell
      view={view}
      setView={setView}
      mode={mode}
      onSignOut={() => {
        setToken(null);
        setAuthed(false);
      }}
    >
      {view === 'library' && (
        <Library
          onBuild={(id) => {
            setBuildSnapshot(id);
            setView('build');
          }}
        />
      )}
      {view === 'build' &&
        (buildSnapshot ? (
          <BuildConsole snapshotId={buildSnapshot} />
        ) : (
          <div className="p-8" style={{ color: 'var(--color-muted)' }}>
            Pick a snapshot in the Library to start a build.
          </div>
        ))}
      {view === 'queue' && <Queue onOpen={() => setView('queue')} />}
      {view === 'invite' && <Invite applicationId={applicationId} />}
    </Shell>
  );
}
