import { createLocalStore, STORAGE_KEY, type LocalLogin } from './store';
import type { SessionUser } from './types';
import { getHomeRankingGeneration, invalidateHomeRanking } from './home-ranking-context';

export const isServerMode = () => typeof document !== 'undefined' && document.querySelector('meta[name="nebula-data-mode"]')?.getAttribute('content') === 'server';

let sessionGeneration = 0;

/** Domain IDs are only unique within their role; use both across session boundaries. */
export const sessionIdentity = (user: SessionUser | null) => user ? `${user.role}:${user.artistId ?? user.investorId}` : 'guest';

export class ApiError extends Error { constructor(message: string, public status: number) { super(message); } }

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const generation = sessionGeneration;
  let response: Response;
  try { response = await fetch(path, { ...options, credentials: 'same-origin', headers: { 'X-Nebula-Request': '1', ...options.headers } }); }
  catch (error) { if (options.signal?.aborted) throw new Error('Request cancelled.'); throw new Error('Cannot reach the server. Your saved data is safe; reconnect and try again.'); }
  const data = await response.json();
  if (!response.ok) { if (response.status === 401 && generation === sessionGeneration) window.dispatchEvent(new Event('nebula-session-expired')); throw new ApiError(data.error ?? 'The request could not be completed.', response.status); }
  return data as T;
}

type LocalStore = ReturnType<typeof createLocalStore>;
const methods = ['listAuthEvents', 'listProjects', 'listArtists', 'getProject', 'getArtist', 'listMyInvestments', 'listReceivedInvestments', 'getInvestment', 'register', 'login', 'logout', 'updateArtist', 'updateArtistIdentity', 'getMyArtistPreferences', 'getMyArtistOnboarding', 'getPublicArtist', 'updateMyArtistPreferences', 'createProject', 'updateProject', 'deleteProject', 'createInvestment', 'updateProjectVisibility', 'toggleProjectSupport'] as const;
type Method = typeof methods[number];
type RemoteMethods = { [K in Method]: (...args: Parameters<LocalStore[K]>) => Promise<Awaited<ReturnType<LocalStore[K]>>> };

const rankingProfileFields = ['creativeRoles', 'genreIds', 'genres', 'genre'] as const;
const rankingProfileSourceFields = [...rankingProfileFields, 'genreSource'] as const;
function rankingProfile(user: SessionUser | null) {
  return rankingProfileSourceFields.map(field => user?.artist?.[field] ?? null);
}
function changesHomeRanking(method: Method, args: unknown[]) {
  const input = args[0] as { profile?: Record<string, unknown>; preferences?: Record<string, unknown> } | undefined;
  const profile = method === 'updateArtist' ? input : method === 'updateArtistIdentity' ? input?.profile : undefined;
  const preferences = method === 'updateMyArtistPreferences' ? input : method === 'updateArtistIdentity' ? input?.preferences : undefined;
  return !!(profile && rankingProfileFields.some(field => Object.hasOwn(profile, field)))
    || !!(preferences && Object.values(preferences).some(group => group && typeof group === 'object' && Object.keys(group).length));
}

export function createRemoteStore() {
  let user: SessionUser | null = null;
  let revision = 0;
  let authPending: number | null = null;
  let refreshSequence = 0;
  let authQueue: Promise<void> = Promise.resolve();
  const listeners = new Set<() => void>();
  const notify = () => { revision++; listeners.forEach(listener => listener()); };
  function setUser(next: SessionUser | null) {
    const previousArtist = user?.artistId, nextArtist = next?.artistId;
    if (previousArtist !== nextArtist) {
      if (previousArtist) invalidateHomeRanking(previousArtist);
      if (nextArtist) invalidateHomeRanking(nextArtist);
    } else if (nextArtist && JSON.stringify(rankingProfile(user)) !== JSON.stringify(rankingProfile(next))) invalidateHomeRanking(nextArtist);
    try { const pointer = JSON.parse(sessionStorage.getItem('nebula-active-remix') ?? 'null'); if (pointer && pointer.owner !== next?.artistId) sessionStorage.removeItem('nebula-active-remix'); } catch { /* Storage may be unavailable. */ }
    window.dispatchEvent(new CustomEvent('nebula-session-identity', { detail: next?.artistId ?? null }));
    if (JSON.stringify(user) !== JSON.stringify(next)) { user = next; notify(); }
  }
  window.addEventListener('nebula-session-expired', () => { sessionGeneration++; setUser(null); });
  const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('nebula-server-session') : null;
  async function refresh() {
    if (authPending) return;
    const generation = sessionGeneration, sequence = ++refreshSequence;
    const data = await apiRequest<{ user: SessionUser | null }>('/api/session');
    if (generation !== sessionGeneration || sequence !== refreshSequence || authPending) return;
    if (sessionIdentity(user) !== sessionIdentity(data.user)) sessionGeneration++;
    setUser(data.user);
  }
  channel?.addEventListener('message', event => {
    if (event.data === 'session') sessionGeneration++;
    // A private-only edit does not change /api/session's public Artist payload.
    // Invalidate Home explicitly without broadcasting the preference contents.
    if (event.data?.type === 'artist-identity' && user?.artistId === event.data.artistId) invalidateHomeRanking(event.data.artistId);
    void refresh().catch(() => {});
  });
  window.addEventListener('focus', () => { void refresh().catch(() => {}); });
  const rpc = Object.fromEntries(methods.map(method => [method, async (...args: unknown[]) => {
    const auth = ['login', 'logout', 'register'].includes(method);
    const previousAuth = authQueue;
    let releaseAuth: (() => void) | undefined;
    // Cookie-changing requests must settle in order as well as their UI responses.
    if (auth) authQueue = new Promise<void>(resolve => { releaseAuth = resolve; });
    if (auth) { sessionGeneration++; authPending = sessionGeneration; if (method === 'logout') setUser(null); }
    const generation = sessionGeneration;
    try {
      if (auth) {
        await previousAuth;
        if (generation !== sessionGeneration) throw new Error('Session changed. Please try again.');
      }
      const response = await apiRequest<{ result: unknown; user: SessionUser | null }>('/api/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method, args }) });
      if (generation !== sessionGeneration || (!auth && authPending)) throw new Error('Session changed. Please try again.');
      const artistId = response.user?.artistId, rankingGeneration = getHomeRankingGeneration(artistId);
      setUser(response.user);
      if (!method.startsWith('list') && !method.startsWith('get')) {
        const rankingChanged = !!artistId && changesHomeRanking(method, args);
        if (rankingChanged && getHomeRankingGeneration(artistId) === rankingGeneration) invalidateHomeRanking(artistId!);
        notify();
        channel?.postMessage(auth ? 'session' : rankingChanged ? { type: 'artist-identity', artistId } : 'changed');
      }
      return response.result;
    } finally {
      releaseAuth?.();
      // Only the newest authentication attempt may close its generation. An older
      // logout/login response must not invalidate a newer pending authentication.
      if (auth && authPending === generation) {
        authPending = null;
        if (generation === sessionGeneration) sessionGeneration++;
      }
    }
  }])) as RemoteMethods;
  return {
    async searchCatalog(search: string, signal: AbortSignal) {
      const generation = sessionGeneration;
      const request = new AbortController();
      const abort = () => request.abort(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
      async function read<K extends 'listArtists' | 'listProjects'>(method: K) {
        const response = await apiRequest<{ result: ReturnType<LocalStore[K]>; user: SessionUser | null }>('/api/rpc', {
          method: 'POST', signal: request.signal, headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ method, args: [{ search }] }),
        });
        request.signal.throwIfAborted();
        if (generation !== sessionGeneration || authPending) throw new Error('Session changed. Please try again.');
        setUser(response.user);
        return response.result;
      }
      try {
        const [artists, projects] = await Promise.all([read('listArtists'), read('listProjects')]);
        return { artists, projects };
      } catch (error) {
        // Do not leave the other half running after this query has failed.
        request.abort();
        throw error;
      } finally { signal.removeEventListener('abort', abort); }
    },
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
  const artist = verified.artist;
  const registration = { ...input, name: verified.name, role: verified.role,
    ...(artist ? { profile: { name: artist.name, genre: artist.genre, bio: artist.bio, picture: artist.picture,
      basedIn: artist.basedIn, recordLabel: artist.recordLabel, creativeRoles: artist.creativeRoles,
      genres: artist.genres, genreIds: artist.genreIds, collaborationAvailability: artist.collaborationAvailability, externalLinks: artist.externalLinks, publicInterests: artist.publicInterests } } : {}) };
  await apiRequest('/api/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method: 'register', args: [registration] }) });
}
