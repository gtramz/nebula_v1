import { expect, test } from 'vitest';
import { createLocalStore, SESSION_KEY, STORAGE_KEY } from './store';
import { migrateTabData } from './browser';
function memory() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
}
const artist = { name: 'Artist', email: 'artist@example.invalid', password: 'preview123', role: 'artist' as const };

test('accounts survive new sessions, logout and demo cleanup while sessions stay independent', async () => {
  const disk = memory(), tab1 = memory(), tab2 = memory();
  const a = createLocalStore(disk, tab1), b = createLocalStore(disk, tab2);
  await a.register(artist);
  expect(JSON.parse(disk.getItem(STORAGE_KEY)!).currentAccountId).toBeNull();
  expect(b.getCurrentUser()).toBeNull();
  await b.login({ email: artist.email.toUpperCase(), password: artist.password });
  a.logout();
  expect(b.getCurrentUser()?.role).toBe('artist');
  b.createProject({ title: 'Demo', category: 'Album', goalAmount: 100, status: 'funding' });
  b.clearDemoData();
  expect(b.listProjects()).toEqual([]);
  expect(b.getCurrentUser()?.email).toBe(artist.email);
  const reopened = createLocalStore(disk, memory());
  await reopened.login(artist);
  expect(reopened.getCurrentUser()?.email).toBe(artist.email);
  expect(reopened.listAuthEvents().map(e => e.type)).toContain('demo_cleared');
  expect(disk.getItem(STORAGE_KEY)).not.toContain(artist.password);
});

test('login detects the role and signup rejects an existing email across roles', async () => {
  const store = createLocalStore(memory());
  await expect(store.login(artist)).rejects.toThrow('No account');
  await store.register(artist);
  store.logout();
  await expect(store.login({ ...artist, password: 'wrong' })).rejects.toThrow('Incorrect password');
  await expect(store.register({ ...artist, email: ' ARTIST@example.invalid ', role: 'investor' })).rejects.toThrow('already exists');
  await store.login({ email: artist.email, password: artist.password });
  expect(store.getCurrentUser()?.role).toBe('artist');
});

test('old duplicate emails authenticate by password without guessing an ambiguous role', async () => {
  const data = memory();
  const store = createLocalStore(data);
  await store.register(artist);
  await store.register({ ...artist, email: 'other@example.invalid', role: 'investor', password: 'investor123' });
  const state = JSON.parse(data.getItem(STORAGE_KEY)!);
  state.accounts[1].email = artist.email;
  state.currentAccountId = null;
  data.setItem(STORAGE_KEY, JSON.stringify(state));
  await store.login({ email: artist.email, password: 'investor123' });
  expect(store.getCurrentUser()?.role).toBe('investor');
  await store.login({ email: artist.email, password: artist.password });
  expect(store.getCurrentUser()?.role).toBe('artist');
  state.accounts[1].salt = state.accounts[0].salt;
  state.accounts[1].passwordDigest = state.accounts[0].passwordDigest;
  data.setItem(STORAGE_KEY, JSON.stringify(state));
  await expect(store.login({ email: artist.email, password: artist.password })).rejects.toThrow('duplicate older accounts');
  expect(store.getCurrentUser()).toBeNull();
  expect(JSON.parse(data.getItem(STORAGE_KEY)!).accounts).toHaveLength(2);
});

test('migrates old accounts without obsolete projects, keeps original and does not resurrect cleared data', async () => {
  const legacy = memory(), disk = memory();
  await createLocalStore(legacy).register(artist);
  const source = JSON.parse(legacy.getItem(STORAGE_KEY)!);
  source.version = 2;
  source.projects = [{ currency: 'EUR', invalid: true }];
  legacy.setItem('nebula-v1-shell', JSON.stringify(source));
  legacy.setItem(STORAGE_KEY, '');
  const original = legacy.getItem('nebula-v1-shell');
  await migrateTabData(disk, legacy);
  const store = createLocalStore(disk, legacy);
  await store.login(artist);
  expect(store.listProjects()).toEqual([]);
  expect(legacy.getItem('nebula-v1-shell')).toBe(original);
  const count = JSON.parse(disk.getItem(STORAGE_KEY)!).accounts.length;
  await migrateTabData(disk, legacy);
  expect(JSON.parse(disk.getItem(STORAGE_KEY)!).accounts).toHaveLength(count);
});

test('merges independent tab ids without changing credentials, receipts or privacy', async () => {
  const disk = memory(), source = memory();
  await createLocalStore(disk).register({ ...artist, email: 'other@example.invalid' });
  const before = createLocalStore(source);
  await before.register(artist);
  const project = before.createProject({ title: 'Migration', category: 'Album', goalAmount: 500, status: 'funding' });
  await before.register({ ...artist, email: 'investor@example.invalid', role: 'investor' });
  before.createInvestment({ projectId: project.id, amount: 100.25, publicVisibility: { showName: false, showAmount: true } });
  await migrateTabData(disk, source);
  const after = createLocalStore(disk, source);
  expect(after.getCurrentUser()?.email).toBe('investor@example.invalid');
  expect(after.listMyInvestments()[0]).toMatchObject({ amount: 100.25, currency: 'USD', publicVisibility: { showName: false, showAmount: true } });
  after.clearDemoData();
  await migrateTabData(disk, source);
  expect(after.listProjects()).toEqual([]);
  expect(JSON.parse(disk.getItem(STORAGE_KEY)!).accounts).toHaveLength(3);
});

test('corrupt or conflicting imports leave both originals unchanged', async () => {
  const disk = memory(), source = memory();
  await createLocalStore(disk).register(artist);
  await createLocalStore(source).register({ ...artist, password: 'different123' });
  const saved = disk.getItem(STORAGE_KEY), original = source.getItem(STORAGE_KEY);
  await expect(migrateTabData(disk, source)).rejects.toThrow('different credentials');
  expect(disk.getItem(STORAGE_KEY)).toBe(saved);
  expect(source.getItem(STORAGE_KEY)).toBe(original);
  source.setItem(STORAGE_KEY, '{broken');
  await expect(migrateTabData(disk, source)).rejects.toThrow('original data has been kept');
  expect(disk.getItem(STORAGE_KEY)).toBe(saved);
});

test('failed durable writes do not report a successful registration or leave an active session', async () => {
  const session = memory();
  const store = createLocalStore({ getItem: () => null, setItem: () => { throw new Error('quota'); } }, session);
  await expect(store.register(artist)).rejects.toThrow('full or unavailable');
  expect(session.getItem(SESSION_KEY)).toBe('');
  expect(store.getCurrentUser()).toBeNull();
});
