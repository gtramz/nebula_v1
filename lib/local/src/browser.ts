import { createLocalStore, SESSION_KEY, STORAGE_KEY } from './store';
import { parseState, PreviewDataError, type State } from './state';
import { createRemoteStore, isServerMode } from './remote';

const LEGACY_KEY = 'nebula-v1-shell';
const LOCK = 'nebula-data-write';
type StorageAccess = Pick<Storage, 'getItem' | 'setItem'>;
const empty = (): State => ({ version: 3, nextId: 1, currentAccountId: null, accounts: [], artists: [], projects: [], investments: [], supports: [], visibility: [] });

// Called under the same cross-tab lock as every mutation. Original snapshots are
// retained in sessionStorage; a marker is written only after the durable commit.
export async function migrateTabData(persistent: StorageAccess, session: StorageAccess) {
  for (const key of [STORAGE_KEY, LEGACY_KEY]) {
    const raw = session.getItem(key);
    if (!raw) continue;
    const fingerprint = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))), b => b.toString(16).padStart(2, '0')).join('');
    const saved = persistent.getItem(STORAGE_KEY);
    const target = saved ? parseState(saved) : empty();
    if (target.imports?.includes(fingerprint)) continue;
    let source: State;
    try {
      if (key === STORAGE_KEY) source = parseState(raw);
      else {
        const old = JSON.parse(raw);
        if (![1, 2].includes(old.version) || !Array.isArray(old.accounts) || !Array.isArray(old.artists)) throw new Error();
        // Only identities survive the obsolete demo, never obsolete currencies.
        const accounts = old.accounts.map((account: State['accounts'][number]) => ({
          id: account.id, name: account.name, email: account.email.trim().toLowerCase(), role: account.role,
          salt: account.salt, passwordDigest: account.passwordDigest,
        }));
        const artists = old.artists.filter((artist: State['artists'][number]) => accounts.some((a: State['accounts'][number]) => a.role === 'artist' && a.id === artist.id));
        source = parseState(JSON.stringify({ ...empty(), accounts, artists, nextId: Math.max(0, ...accounts.map((a: State['accounts'][number]) => a.id)) + 1 }));
      }
    } catch { throw new PreviewDataError('An earlier preview needs recovery. Its original data has been kept. Download a backup before continuing.'); }
    if (key === STORAGE_KEY && !saved) {
      // Preserve existing receipt URLs and project IDs when this is the first import.
      persistent.setItem(STORAGE_KEY, JSON.stringify({ ...source, currentAccountId: null, imports: [...(source.imports ?? []), fingerprint] }));
      if (session.getItem(SESSION_KEY) === null) session.setItem(SESSION_KEY, String(source.currentAccountId ?? ''));
      continue;
    }
    const accountIds = new Map<number, number>();
    for (const account of source.accounts) {
      const existing = target.accounts.find(a => a.email === account.email && a.role === account.role);
      if (existing && (existing.salt !== account.salt || existing.passwordDigest !== account.passwordDigest)) {
        throw new PreviewDataError('Two earlier profiles use the same email and role with different credentials. Their data has been kept; download a backup to resolve the conflict.');
      }
      const id = existing?.id ?? target.nextId++;
      accountIds.set(account.id, id);
      if (!existing) {
        target.accounts.push({ ...account, id });
        const artist = source.artists.find(a => a.id === account.id);
        if (artist) target.artists.push({ ...artist, id });
      }
    }
    const projectIds = new Map<number, number>();
    for (const project of source.projects) {
      const artistId = accountIds.get(project.artistId)!;
      const existing = target.projects.find(p => p.artistId === artistId && p.createdAt === project.createdAt && p.title === project.title);
      const id = existing?.id ?? target.nextId++;
      projectIds.set(project.id, id);
      if (!existing) target.projects.push({ ...project, id, artistId });
    }
    const occurrences = new Map<string, number>();
    for (const investment of source.investments) {
      const investorId = accountIds.get(investment.investorId)!;
      const projectId = projectIds.get(investment.projectId!);
      if (!projectId) throw new PreviewDataError('An earlier receipt has no project. Its original data has been kept for recovery.');
      const receiptKey = JSON.stringify([investorId, projectId, investment.createdAt, investment.amount]);
      const occurrence = (occurrences.get(receiptKey) ?? 0) + 1;
      occurrences.set(receiptKey, occurrence);
      if (target.investments.filter(i => i.investorId === investorId && i.projectId === projectId && i.createdAt === investment.createdAt && i.amount === investment.amount).length < occurrence) {
        target.investments.push({ ...investment, id: target.nextId++, investorId, artistId: accountIds.get(investment.artistId!)!, projectId });
      }
    }
    for (const support of source.supports) {
      const projectId = projectIds.get(support.projectId)!;
      const artistId = accountIds.get(support.artistId)!;
      if (!target.supports.some(s => s.projectId === projectId && s.artistId === artistId)) target.supports.push({ ...support, projectId, artistId });
    }
    for (const visibility of source.visibility) {
      const projectId = projectIds.get(visibility.projectId)!;
      const investorId = accountIds.get(visibility.investorId)!;
      if (!target.visibility.some(v => v.projectId === projectId && v.investorId === investorId)) target.visibility.push({ ...visibility, projectId, investorId });
    }
    for (const activity of source.authEvents ?? []) {
      const accountId = activity.accountId === null ? null : accountIds.get(activity.accountId) ?? null;
      if (!(target.authEvents ?? []).some(e => e.accountId === accountId && e.type === activity.type && e.at === activity.at)) {
        target.authEvents = [...(target.authEvents ?? []), { ...activity, accountId }].slice(-200);
      }
    }
    target.currentAccountId = null;
    parseState(JSON.stringify(target));
    target.imports = [...(target.imports ?? []), fingerprint];
    persistent.setItem(STORAGE_KEY, JSON.stringify(target));
    if (key === STORAGE_KEY && session.getItem(SESSION_KEY) === null && source.currentAccountId !== null) {
      session.setItem(SESSION_KEY, String(accountIds.get(source.currentAccountId) ?? ''));
    }
  }
}

async function lock<T>(action: () => T | Promise<T>): Promise<T> {
  if (!navigator.locks) return Promise.reject(new Error('This browser cannot safely synchronize data. Use a current browser on localhost or HTTPS.'));
  return await navigator.locks.request(LOCK, async () => await action());
}

function makeBrowserStore() {
  const store = createLocalStore(window.localStorage, window.sessionStorage);
  const writes = ['register', 'login', 'logout', 'reset', 'clearDemoData', 'updateArtist', 'updateArtistIdentity', 'updateMyArtistPreferences', 'createProject', 'updateProject', 'deleteProject', 'createInvestment', 'updateProjectVisibility', 'toggleProjectSupport'] as const;
  type AsyncWrites = { [K in typeof writes[number]]: (...args: Parameters<typeof store[K]>) => Promise<Awaited<ReturnType<typeof store[K]>>> };
  const locked = Object.fromEntries(writes.map(name => [name, (...args: unknown[]) => lock(() => (store[name] as (...args: unknown[]) => unknown)(...args))])) as AsyncWrites;
  window.addEventListener('storage', event => {
    if (event.storageArea === window.localStorage && (event.key === STORAGE_KEY || event.key === null)) store.notify();
  });
  return { ...store, ...locked };
}

let browserStore: ReturnType<typeof makeBrowserStore> | undefined;
let remoteStore: ReturnType<typeof createRemoteStore> | undefined;
export function getLocalStore() {
  if (isServerMode()) return remoteStore ??= createRemoteStore();
  try { return browserStore ??= makeBrowserStore(); }
  catch { throw new PreviewDataError('Browser storage is unavailable. Allow browser storage and try again.'); }
}

export async function initializeLocalStore() {
  if (isServerMode()) { await (remoteStore ??= createRemoteStore()).refresh(); return; }
  await lock(() => migrateTabData(window.localStorage, window.sessionStorage));
  getLocalStore();
}

export function exportBrowserBackup() {
  const data: Record<string, string | null> = {};
  for (const key of [STORAGE_KEY, LEGACY_KEY]) {
    data[`persistent:${key}`] = window.localStorage.getItem(key);
    data[`tab:${key}`] = window.sessionStorage.getItem(key);
  }
  return JSON.stringify(data, null, 2);
}
