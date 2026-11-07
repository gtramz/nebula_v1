import { createLocalStore, STORAGE_KEY, type AccountRegistration, type LocalLogin } from './store';
import type { SessionUser } from './types';

export const isServerMode = () => typeof document !== 'undefined' && document.querySelector('meta[name="nebula-data-mode"]')?.getAttribute('content') === 'server';

export class ApiError extends Error { constructor(message: string, public status: number) { super(message); } }

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try { response = await fetch(path, { ...options, credentials: 'same-origin', headers: { 'X-Nebula-Request': '1', ...options.headers } }); }
  catch (error) { if (options.signal?.aborted) throw new Error('Request cancelled.'); throw new Error('Cannot reach the server. Your saved data is safe; reconnect and try again.'); }
  const data = await response.json();
  if (!response.ok) { if (response.status === 401) window.dispatchEvent(new Event('nebula-session-expired')); throw new ApiError(data.error ?? 'The request could not be completed.', response.status); }
  return data as T;
}

type LocalStore = ReturnType<typeof createLocalStore>;
const methods = ['listAuthEvents', 'listProjects', 'listArtists', 'getProject', 'getArtist', 'listMyInvestments', 'listReceivedInvestments', 'getInvestment', 'register', 'login', 'logout', 'updateArtist', 'createProject', 'updateProject', 'deleteProject', 'createInvestment', 'updateProjectVisibility', 'toggleProjectSupport'] as const;
type Method = typeof methods[number];
type RemoteMethods = { [K in Method]: (...args: Parameters<LocalStore[K]>) => Promise<Awaited<ReturnType<LocalStore[K]>>> };

export function createRemoteStore() {
  let user: SessionUser | null = null;
  let revision = 0;
  const listeners = new Set<() => void>();
  const notify = () => { revision++; listeners.forEach(listener => listener()); };
  function setUser(next: SessionUser | null) {
    try { const pointer = JSON.parse(sessionStorage.getItem('nebula-active-remix') ?? 'null'); if (pointer && pointer.owner !== next?.artistId) sessionStorage.removeItem('nebula-active-remix'); } catch { /* Storage may be unavailable. */ }
    window.dispatchEvent(new CustomEvent('nebula-session-identity', { detail: next?.artistId ?? null }));
    if (JSON.stringify(user) !== JSON.stringify(next)) { user = next; notify(); }
  }
  window.addEventListener('nebula-session-expired', () => setUser(null));
  const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('nebula-server-session') : null;
  async function refresh() {
    const data = await apiRequest<{ user: SessionUser | null }>('/api/session');
    setUser(data.user);
  }
  channel?.addEventListener('message', () => { void refresh().catch(() => {}); });
  window.addEventListener('focus', () => { void refresh().catch(() => {}); });
  const rpc = Object.fromEntries(methods.map(method => [method, async (...args: unknown[]) => {
    const response = await apiRequest<{ result: unknown; user: SessionUser | null }>('/api/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method, args }) });
    setUser(response.user);
    if (!method.startsWith('list') && !method.startsWith('get')) { notify(); channel?.postMessage('changed'); }
    return response.result;
  }])) as RemoteMethods;
  return {
    ...rpc, refresh, getCurrentUser: () => user, getSnapshot: () => String(revision),
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    notify,
    exportData: (): string | null => { throw new Error('Server backups are managed by the server operator.'); },
    reset: async () => { throw new Error('Shared server data cannot be reset from the browser.'); },
    clearDemoData: async () => { throw new Error('Shared server data cannot be cleared from the browser.'); },
  };
}

// Transfer only the selected, password-verified identity. Browser data is read-only.
export async function transferBrowserAccount(input: LocalLogin) {
  const raw = localStorage.getItem(STORAGE_KEY) ?? sessionStorage.getItem(STORAGE_KEY) ?? sessionStorage.getItem('nebula-v1-shell');
  if (!raw) throw new Error('No browser-only account was found here.');
  const data = JSON.parse(raw);
  const source = { version: 3, nextId: Math.max(0, ...data.accounts.map((item: { id: number }) => item.id)) + 1,
    currentAccountId: null, accounts: data.accounts, artists: data.artists, projects: [], investments: [], supports: [], visibility: [] };
  let scratch = JSON.stringify(source);
  const temporary = createLocalStore({ getItem: () => scratch, setItem: (_key, value) => { scratch = value; } });
  const verified = await temporary.login(input);
  const registration: AccountRegistration & { profile?: SessionUser['artist'] } = { ...input, name: verified.name, role: verified.role, profile: verified.artist };
  await apiRequest('/api/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method: 'register', args: [registration] }) });
}
