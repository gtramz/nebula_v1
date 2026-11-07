import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import { initializeLocalStore, exportBrowserBackup, isServerMode } from '@nebula/local';

import App from './App';
import { ErrorBoundary } from '@/components/error-boundary';

import './index.css';

function Startup() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  function start() {
    setError('');
    initializeLocalStore().then(() => setReady(true)).catch(cause => setError(cause instanceof Error ? cause.message : 'Unable to open browser data.'));
  }
  useEffect(start, []);
  if (ready) return <App />;
  return <main className="min-h-dvh flex items-center justify-center p-6"><section className="max-w-lg space-y-6">
    <h1 className="text-3xl font-bold">{isServerMode() ? (error ? 'Cannot connect to Nebula' : 'Connecting to Nebula…') : (error ? 'Your saved accounts need attention' : 'Opening your saved accounts…')}</h1>
    {error && <><p role="alert">{error}</p><p>{isServerMode() ? 'Check that the server is running, then retry.' : 'The original data has been kept. A backup contains private profile information.'}</p>
      {!isServerMode() && <button className="border px-5 py-3" onClick={() => {
        try {
          const url = URL.createObjectURL(new Blob([exportBrowserBackup()], { type: 'application/json' }));
          const link = document.createElement('a'); link.href = url; link.download = 'nebula-accounts-backup.json'; link.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch { setError('Browser storage cannot be read. Allow storage in your browser settings and retry.'); }
      }}>Download backup</button>}
      <button className="border px-5 py-3" onClick={start}>Try again</button></>}
  </section></main>;
}

createRoot(document.getElementById('root')!, {
  // Keeps caught errors off reportError(), which would raise the dev overlay.
  onCaughtError: (error, errorInfo) => {
    console.error(error, errorInfo.componentStack);
  },
}).render(
  <ErrorBoundary>
    <Startup />
  </ErrorBoundary>,
);
