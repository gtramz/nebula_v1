import { useState } from 'react';
import { getLocalStore } from '@nebula/local';

export function PreviewRecovery({ message, onRetry }: { message: string; onRetry: () => void }) {
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');

  async function attempt(action: () => void | Promise<void>) {
    setError('');
    try { await action(); } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'This action could not be completed.');
    }
  }

  return (
    <main className="min-h-dvh flex items-center justify-center p-6">
      <section className="max-w-lg border border-border bg-surface p-8 space-y-6">
        <h1 className="text-3xl font-bold text-ink">Recover your preview</h1>
        <p className="text-muted">{message}</p>
        <p className="text-sm text-muted">Your saved data has not been changed. You can download the original data before resetting this browser’s preview. Keep the backup private; it contains profile information.</p>
        <div className="flex flex-col gap-3">
          <button className="border border-border px-5 py-3 text-ink" onClick={() => attempt(() => {
            const raw = getLocalStore().exportData();
            if (raw === null) throw new Error('There is no saved preview to download.');
            const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
            const link = document.createElement('a');
            link.href = url;
            link.download = 'nebula-preview-backup.json';
            document.body.append(link);
            link.click();
            link.remove();
            window.setTimeout(() => URL.revokeObjectURL(url), 1000);
            setFeedback('Backup download started.');
          })}>Download backup</button>
          <button className="bg-cream px-5 py-3 text-bg font-bold" onClick={() => {
            if (!window.confirm('Reset all saved accounts and data in this browser? This affects every tab. Download a backup first if you want to keep them.')) return;
            attempt(async () => {
              await getLocalStore().reset();
              window.location.assign(import.meta.env.BASE_URL);
            });
          }}>Start new USD preview</button>
          <button className="px-5 py-3 text-muted" onClick={onRetry}>Try again</button>
        </div>
        {feedback && <p role="status" className="text-sm text-ink">{feedback}</p>}
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      </section>
    </main>
  );
}
