import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createRemoteStore } from './remote';
import { getHomeRankingGeneration, subscribeHomeRanking } from './home-ranking-context';
import { searchableArtistGenres } from './artist-search-genres';

const artist = { role: 'artist', artistId: 1, name: 'First', artist: { id: 1, name: 'First' } };
const investor = { role: 'investor', investorId: 2, name: 'Second' };
const response = (user: unknown, result: unknown = null, status = 200) => new Response(JSON.stringify({ user, result, error: 'Unauthorized' }), { status });
function deferred() { let resolve!: (value: Response) => void; const promise = new Promise<Response>(r => { resolve = r; }); return { promise, resolve }; }
beforeEach(() => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('sessionStorage', { getItem: () => null, removeItem: () => {} });
  vi.stubGlobal('BroadcastChannel', undefined);
});
afterEach(() => vi.unstubAllGlobals());

test('late refresh and RPC results cannot restore identity after logout', async () => {
  const refresh = deferred(), read = deferred(); let sessions = 0;
  vi.stubGlobal('fetch', vi.fn((path, options) => {
    if (path === '/api/session') return ++sessions === 1 ? Promise.resolve(response(artist)) : refresh.promise;
    return JSON.parse(options.body).method === 'logout' ? Promise.resolve(response(null)) : read.promise;
  }));
  const store = createRemoteStore(); await store.refresh();
  const pendingRefresh = store.refresh(); const pendingRead = store.getMyArtistPreferences();
  const rejected = expect(pendingRead).rejects.toThrow('Session changed');
  await store.logout(); refresh.resolve(response(artist)); read.resolve(response(artist));
  await pendingRefresh; await rejected; expect(store.getCurrentUser()).toBeNull();
});

test('a stale 401 from a previous identity does not sign out the new account', async () => {
  const read = deferred();
  vi.stubGlobal('fetch', vi.fn((path, options) => {
    if (path === '/api/session') return Promise.resolve(response(artist));
    return JSON.parse(options.body).method === 'login' ? Promise.resolve(response(investor, investor)) : read.promise;
  }));
  const store = createRemoteStore(); await store.refresh();
  const pending = store.getMyArtistPreferences(); const rejected = expect(pending).rejects.toThrow('Unauthorized');
  await store.login({ email: 'second@example.invalid', password: 'preview123' });
  read.resolve(response(null, null, 401)); await rejected;
  expect(store.getCurrentUser()).toEqual(investor);
});

test('a read completed while logout is pending cannot restore identity', async () => {
  const logout = deferred(), read = deferred();
  vi.stubGlobal('fetch', vi.fn((path, options) => {
    if (path === '/api/session') return Promise.resolve(response(artist));
    return JSON.parse(options.body).method === 'logout' ? logout.promise : read.promise;
  }));
  const store = createRemoteStore(); await store.refresh(); const closing = store.logout();
  const pending = store.getMyArtistPreferences(); const rejected = expect(pending).rejects.toThrow('Session changed');
  read.resolve(response(artist)); await rejected; expect(store.getCurrentUser()).toBeNull();
  logout.resolve(response(null)); await closing;
});

test('an older logout response cannot invalidate a newer pending login', async () => {
  const logout = deferred(), login = deferred();
  vi.stubGlobal('fetch', vi.fn((path, options) => {
    if (path === '/api/session') return Promise.resolve(response(artist));
    return JSON.parse(options.body).method === 'logout' ? logout.promise : login.promise;
  }));
  const store = createRemoteStore(); await store.refresh();
  const closing = store.logout(); const rejected = expect(closing).rejects.toThrow('Session changed');
  const opening = store.login({ email: 'second@example.invalid', password: 'preview123' });
  logout.resolve(response(null)); await rejected;
  login.resolve(response(investor, investor)); await opening;
  expect(store.getCurrentUser()).toEqual(investor);
});

test('old successful reads and session refreshes cannot replace a newly logged-in identity', async () => {
  const refresh = deferred(), read = deferred(); let sessions = 0;
  vi.stubGlobal('fetch', vi.fn((path, options) => {
    if (path === '/api/session') return ++sessions === 1 ? Promise.resolve(response(artist)) : refresh.promise;
    const method = JSON.parse(options.body).method;
    return method === 'logout' ? Promise.resolve(response(null)) : method === 'login' ? Promise.resolve(response(investor, investor)) : read.promise;
  }));
  const store = createRemoteStore(); await store.refresh();
  const pendingRefresh = store.refresh(), pendingRead = store.getMyArtistPreferences();
  const rejected = expect(pendingRead).rejects.toThrow('Session changed');
  await store.logout(); await store.login({ email: 'second@example.invalid', password: 'preview123' });
  refresh.resolve(response(artist)); read.resolve(response(artist)); await pendingRefresh; await rejected;
  expect(store.getCurrentUser()).toEqual(investor);
});

test('only committed ranking edits restart Home and broadcast an identity reference without preferences', async () => {
  class Channel extends EventTarget {
    static instances: Channel[] = [];
    messages: unknown[] = [];
    constructor(public name: string) { super(); Channel.instances.push(this); }
    postMessage(message: unknown) { this.messages.push(message); }
  }
  vi.stubGlobal('BroadcastChannel', Channel);
  let fail = false;
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(response(artist, null, fail ? 400 : 200))));
  const store = createRemoteStore(); await store.refresh();
  const initial = getHomeRankingGeneration(1), changes = vi.fn();
  const unsubscribe = subscribeHomeRanking(changes);
  await store.updateMyArtistPreferences({ discovery: { opportunityTypes: ['Mix'], genreIds: ['electronic'] } });
  expect(getHomeRankingGeneration(1)).toBe(initial + 1);
  expect(changes).toHaveBeenCalledTimes(1);
  expect(Channel.instances[0].messages).toEqual([{ type: 'artist-identity', artistId: 1 }]);
  await store.createProject({ title: 'Unrelated write', category: 'EP', goalAmount: 1000 });
  await store.updateArtistIdentity({ onboarding: { step: 2 } });
  expect(getHomeRankingGeneration(1)).toBe(initial + 1);
  fail = true;
  await expect(store.updateMyArtistPreferences({ discovery: { opportunityTypes: ['Feature'] } })).rejects.toThrow();
  expect(getHomeRankingGeneration(1)).toBe(initial + 1);
  unsubscribe();
});

test('cross-tab identity notices restart only the current artist ranking and account rotation abandons its old generation', async () => {
  class Channel extends EventTarget {
    static instance: Channel;
    constructor() { super(); Channel.instance = this; }
    postMessage() {}
  }
  vi.stubGlobal('BroadcastChannel', Channel);
  let current: unknown = artist;
  vi.stubGlobal('fetch', vi.fn((path, options) => {
    if (path === '/api/rpc') {
      const method = JSON.parse(options.body).method;
      if (method === 'logout') current = null;
      if (method === 'login') current = investor;
    }
    return Promise.resolve(response(current));
  }));
  const store = createRemoteStore(); await store.refresh();
  const before = getHomeRankingGeneration(1);
  Channel.instance.dispatchEvent(new MessageEvent('message', { data: { type: 'artist-identity', artistId: 9999 } }));
  expect(getHomeRankingGeneration(1)).toBe(before);
  Channel.instance.dispatchEvent(new MessageEvent('message', { data: { type: 'artist-identity', artistId: 1 } }));
  expect(getHomeRankingGeneration(1)).toBe(before + 1);
  await store.logout();
  expect(getHomeRankingGeneration(1)).toBe(before + 2);
  await store.login({ email: 'second@example.invalid', password: 'preview123' });
  const rotated = getHomeRankingGeneration(1);
  Channel.instance.dispatchEvent(new MessageEvent('message', { data: { type: 'artist-identity', artistId: 1 } }));
  expect(getHomeRankingGeneration(1)).toBe(rotated);
  expect(store.getCurrentUser()).toEqual(investor);
});

test('session refresh restarts Home when genre provenance changes the effective genres without changing projected values', async () => {
  let current = { ...artist, artist: { ...artist.artist, genreIds: ['electronic'], genres: ['Electronic', 'Local scene'], genreSource: 'legacy' as 'legacy' | 'structured' } };
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(response(current))));
  const store = createRemoteStore(); await store.refresh();
  expect(searchableArtistGenres(store.getCurrentUser()!.artist!).map(genre => genre.value)).toEqual(['electronic', 'Local scene']);
  const before = getHomeRankingGeneration(1);
  current = { ...current, artist: { ...current.artist, genreSource: 'structured' } };
  await store.refresh();
  expect(searchableArtistGenres(store.getCurrentUser()!.artist!).map(genre => genre.value)).toEqual(['electronic']);
  expect(getHomeRankingGeneration(1)).toBe(before + 1);
  await store.refresh();
  expect(getHomeRankingGeneration(1)).toBe(before + 1);
});


test('cross-tab role changes invalidate pending reads even when numeric domain IDs coincide', async () => {
  const read = deferred(); let current: unknown = artist;
  vi.stubGlobal('fetch', vi.fn((path) => path === '/api/session' ? Promise.resolve(response(current)) : read.promise));
  const store = createRemoteStore(); await store.refresh();
  const pending = store.getMyArtistPreferences(); const rejected = expect(pending).rejects.toThrow('Session changed');
  current = { ...investor, investorId: artist.artistId };
  await store.refresh();
  read.resolve(response(artist)); await rejected;
  expect(store.getCurrentUser()).toEqual(current);
});
