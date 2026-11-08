import { expect, test } from 'vitest';
import { createLocalStore, STORAGE_KEY } from './store';
import { parseState, PreviewDataError } from './state';
import { migrateTabData } from './browser';
import { artistPreferencesUpdate, creativeRoleTaxonomy, emptyArtistPreferences, normalizeArtistGenres, professionalIdentityUpdate, publicArtist } from './artist-identity';

function memory() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
}
const credentials = { role: 'artist' as const, name: 'Legacy Artist', email: 'identity@example.invalid', password: 'preview123' };
async function fixture() {
  const disk = memory(), session = memory(), store = createLocalStore(disk, session, 1);
  const user = await store.register(credentials);
  return { disk, session, store, id: user.artistId! };
}

test('legacy artists read structured defaults without changing original data or inferring roles', async () => {
  const { store, disk, id } = await fixture();
  store.updateArtist({ name: credentials.name, genre: '  Hip-hop / R&B  ', bio: 'Existing bio' });
  const before = disk.getItem(STORAGE_KEY);
  expect(store.getArtist(id)?.artist).toMatchObject({ genre: '  Hip-hop / R&B  ', genres: ['  Hip-hop / R&B  '], creativeRoles: [], collaborationAvailability: 'unspecified' });
  expect(store.getMyArtistPreferences()).toEqual(emptyArtistPreferences());
  store.getCurrentUser(); store.listArtists();
  expect(disk.getItem(STORAGE_KEY)).toBe(before);
  const state = parseState(before!);
  expect(state.artists[0].genres).toBeUndefined();
  expect(state.accounts[0].artistPreferences).toBeUndefined();
});

test('professional identity roundtrips and the legacy editor preserves new fields and private data', async () => {
  const { store, disk, session, id } = await fixture();
  store.updateArtist({ name: credentials.name, genre: 'Legacy genre', bio: 'Keep bio' });
  store.updateArtist({ name: credentials.name, creativeRoles: ['producer', 'vocalist', 'producer'], genres: ['  Hip-hop  ', 'hip-hop', 'Rock'], collaborationAvailability: 'open' });
  store.updateMyArtistPreferences({ discovery: { genres: ['Private taste'] } });
  store.updateArtist({ name: 'New name', genre: 'Edited legacy genre', bio: 'Edited bio', basedIn: '', recordLabel: '', picture: null });
  const reloaded = createLocalStore(disk, session, 1);
  expect(reloaded.getArtist(id)?.artist).toMatchObject({ name: 'New name', genre: 'Edited legacy genre', genres: ['Hip-hop', 'Rock'], creativeRoles: ['producer', 'vocalist'], collaborationAvailability: 'open' });
  expect(reloaded.getMyArtistPreferences().discovery.genres).toEqual(['Private taste']);
  reloaded.updateArtist({ name: 'New name', genres: [], creativeRoles: [], collaborationAvailability: 'unspecified' });
  expect(reloaded.getArtist(id)?.artist).toMatchObject({ genre: 'Edited legacy genre', genres: [], creativeRoles: [] });
});

test('private preference patches preserve other dimensions and never populate public capabilities', async () => {
  const { store, disk, id } = await fixture();
  store.updateMyArtistPreferences({ collaboration: { opportunityTypes: ['Mix', 'Production', 'Mix'], creativeRoles: ['producer', 'mixing-engineer'], compensationKinds: ['fee', 'split'] } });
  store.updateMyArtistPreferences({ discovery: { genres: ['  Ambient  ', 'ambient'], projectTypes: ['ep', 'album'], opportunityTypes: ['Funding', 'Feature'] } });
  store.updateMyArtistPreferences({ collaboration: { compensationKinds: [] } });
  expect(store.getMyArtistPreferences()).toEqual({ collaboration: { opportunityTypes: ['Mix', 'Production'], creativeRoles: ['producer', 'mixing-engineer'], compensationKinds: [] }, discovery: { genres: ['Ambient'], projectTypes: ['ep', 'album'], opportunityTypes: ['Funding', 'Feature'] } });
  expect(store.getArtist(id)?.artist.creativeRoles).toEqual([]);
  expect(store.getCurrentUser()).not.toHaveProperty('artistPreferences');
  expect(store.getCurrentUser()?.artist).not.toHaveProperty('discovery');
  expect(parseState(disk.getItem(STORAGE_KEY)!).accounts[0].artistPreferences).toBeDefined();
});

test('public allowlists protect artist, project, list and session responses', async () => {
  const { store, disk, id } = await fixture();
  store.updateMyArtistPreferences({ discovery: { genres: ['PRIVATE_SENTINEL'] } });
  const project = store.createProject({ title: 'Public work', category: 'EP', goalAmount: 100, status: 'published' });
  // Even an unexpected storage field must not cross the public DTO boundary.
  const state = JSON.parse(disk.getItem(STORAGE_KEY)!);
  state.artists[0].discovery = { secret: 'PRIVATE_SENTINEL' };
  disk.setItem(STORAGE_KEY, JSON.stringify(state));
  for (const result of [store.getCurrentUser(), store.getArtist(id), store.listArtists(), store.getProject(project.id)]) {
    expect(JSON.stringify(result)).not.toContain('PRIVATE_SENTINEL');
    expect(JSON.stringify(result)).not.toContain('artistPreferences');
  }
  expect(publicArtist({ id: 1, name: 'Only public', ...({ passwordDigest: 'PRIVATE_SENTINEL' } as object) })).not.toHaveProperty('passwordDigest');
});

test('professional roles never change account type, ownership or private preference access', async () => {
  const { store, disk, id } = await fixture();
  store.updateArtist({ name: credentials.name, creativeRoles: creativeRoleTaxonomy.map(role => role.id) });
  store.updateMyArtistPreferences({ discovery: { genres: ['Secret'] } });
  const project = store.createProject({ title: 'Owner project', category: 'EP', goalAmount: 100, status: 'draft' });
  await store.register({ ...credentials, name: 'Other artist', email: 'other@example.invalid' });
  store.updateArtist({ name: 'Other artist', creativeRoles: ['producer'], collaborationAvailability: 'unavailable' });
  expect(store.getMyArtistPreferences()).toEqual(emptyArtistPreferences());
  expect(() => store.updateProject(project.id, { title: 'Stolen' })).toThrow();
  expect(() => store.updateArtist({ name: 'Forged', id } as never)).toThrow('Unsupported');
  expect(() => store.updateMyArtistPreferences({ artistId: id } as never)).toThrow('Unsupported');
  await store.register({ ...credentials, name: 'Investor', role: 'investor', email: 'investor@example.invalid' });
  const before = disk.getItem(STORAGE_KEY);
  expect(() => store.getMyArtistPreferences()).toThrow();
  expect(() => store.updateMyArtistPreferences({})).toThrow();
  expect(() => store.updateArtist({ name: 'Investor', creativeRoles: ['producer'] })).toThrow();
  expect(disk.getItem(STORAGE_KEY)).toBe(before);
  expect(store.getCurrentUser()).toMatchObject({ role: 'investor', artist: null });
  store.logout(); expect(() => store.getMyArtistPreferences()).toThrow();
});

test('taxonomy and preference validation rejects unsupported fields and keeps previous data on failure', async () => {
  const { store, disk } = await fixture();
  const before = disk.getItem(STORAGE_KEY);
  for (const payload of [
    { creativeRoles: ['Production'] }, { creativeRoles: ['admin'] }, { genres: null }, { genres: [''] },
    { genres: ['x'.repeat(121)] }, { genres: Array(21).fill('Rock') }, { genres: ['Rock\nJazz'] },
    { creativeRoles: Array(51).fill('producer') }, { collaborationAvailability: 'verified' }, { artistPreferences: {} },
  ]) expect(() => store.updateArtist({ name: credentials.name, ...payload } as never)).toThrow();
  for (const payload of [
    { discovery: null }, { discovery: { projectTypes: ['unsupported'] } }, { discovery: { opportunityTypes: ['Songwriter'] } },
    { collaboration: { compensationKinds: ['combined'] } }, { collaboration: { creativeRoles: ['Mix'] } },
    { collaboration: { availability: 'open' } }, { investorId: 2 }, { role: 'artist' },
  ]) expect(() => store.updateMyArtistPreferences(payload as never)).toThrow();
  expect(disk.getItem(STORAGE_KEY)).toBe(before);
  expect(normalizeArtistGenres([' Cafe\u0301  jazz ', 'Café jazz'])).toEqual(['Café jazz']);
  expect(professionalIdentityUpdate({ creativeRoles: [] }).creativeRoles).toEqual([]);
  expect(artistPreferencesUpdate({})).toEqual({});
});

test('malformed persisted extensions fail closed without overwriting the original', async () => {
  const { disk, store } = await fixture();
  const original = disk.getItem(STORAGE_KEY)!;
  for (const mutate of [
    (v: any) => { v.artists[0].creativeRoles = [123]; },
    (v: any) => { v.artists[0].genreIds = ['not-a-genre']; },
    (v: any) => { v.accounts[0].artistPreferences = { discovery: { genres: [] } }; },
    (v: any) => { v.accounts[0].artistPreferences = { ...emptyArtistPreferences(), hidden: true }; },
  ]) {
    const value = JSON.parse(original); mutate(value); const raw = JSON.stringify(value); disk.setItem(STORAGE_KEY, raw);
    expect(() => store.getCurrentUser()).toThrow(PreviewDataError); expect(disk.getItem(STORAGE_KEY)).toBe(raw);
  }
  const investor = JSON.parse(original); investor.accounts[0].role = 'investor'; investor.artists = []; investor.accounts[0].artistPreferences = emptyArtistPreferences();
  expect(() => parseState(JSON.stringify(investor))).toThrow(PreviewDataError);
});

test('existing browser migration carries identity extensions without changing source or duplicating accounts', async () => {
  const source = memory(), disk = memory();
  const store = createLocalStore(source, undefined, 1);
  await store.register(credentials);
  store.updateArtist({ name: credentials.name, genre: 'Legacy', genres: ['Jazz', 'Soul'], creativeRoles: ['composer'] });
  store.updateMyArtistPreferences({ discovery: { projectTypes: ['single'] } });
  const raw = source.getItem(STORAGE_KEY);
  await migrateTabData(disk, source);
  const imported = parseState(disk.getItem(STORAGE_KEY)!);
  expect(imported.artists[0]).toMatchObject({ genre: 'Legacy', genres: ['Jazz', 'Soul'], creativeRoles: ['composer'] });
  expect(imported.accounts[0].artistPreferences?.discovery.projectTypes).toEqual(['single']);
  await migrateTabData(disk, source);
  expect(parseState(disk.getItem(STORAGE_KEY)!).accounts).toHaveLength(1);
  expect(source.getItem(STORAGE_KEY)).toBe(raw);
});

test('identity patches merge unrelated changes and reject same-field conflicts atomically', async () => {
  const { store } = await fixture();
  const expected = { profile: store.getCurrentUser()!.artist!, preferences: store.getMyArtistPreferences() };
  store.updateArtistIdentity({ profile: { bio: 'Newer bio' }, preferences: { discovery: { projectTypes: ['ep'] } } });
  store.updateArtistIdentity({ profile: { name: 'Renamed safely' }, preferences: { discovery: { opportunityTypes: ['Funding'] } }, expected });
  expect(store.getCurrentUser()!.artist).toMatchObject({ name: 'Renamed safely', bio: 'Newer bio' });
  expect(store.getMyArtistPreferences().discovery).toMatchObject({ projectTypes: ['ep'], opportunityTypes: ['Funding'] });
  expect(() => store.updateArtistIdentity({ profile: { bio: 'Stale bio' }, preferences: { collaboration: { creativeRoles: ['producer'] } }, expected })).toThrow('changed in another tab');
  expect(store.getMyArtistPreferences().collaboration.creativeRoles).toEqual([]);
  expect(() => store.updateArtistIdentity({ preferences: { discovery: { projectTypes: ['single'] } }, expected })).toThrow('changed in another tab');
  const latest = { profile: store.getCurrentUser()!.artist!, preferences: store.getMyArtistPreferences() };
  store.updateArtistIdentity({ profile: { bio: '' }, expected: latest });
  expect(store.getCurrentUser()!.artist!.bio).toBe('');
});
