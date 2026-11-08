import { expect, test } from 'vitest';
import { createLocalStore, STORAGE_KEY } from './store';
import { parseState } from './state';
import { validateArtistLinks } from './artist-identity';
const memory = () => { const values = new Map<string, string>(); return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } }; };
async function fixture() { const disk = memory(), store = createLocalStore(disk, undefined, 1); const artist = await store.register({ name: 'Artist identity', role: 'artist', email: 'artist@example.invalid', password: 'preview123' }); return { disk, store, artist }; }

test('onboarding patches existing identity atomically and persists separately from completeness', async () => {
  const { disk, store, artist } = await fixture();
  const untouched = disk.getItem(STORAGE_KEY);
  expect(store.getMyArtistOnboarding()).toEqual({ version: 1, step: 1, completedSteps: [], completedAt: null });
  expect(disk.getItem(STORAGE_KEY)).toBe(untouched);
  store.updateArtistIdentity({ profile: { name: 'Artist identity', creativeRoles: ['producer', 'vocalist'], genreIds: ['hip-hop'], externalLinks: [{ label: 'Site', url: 'https://example.com' }], publicInterests: ['Feature'] }, onboarding: { step: 3, completeStep: 2 } });
  store.updateArtistIdentity({ preferences: { discovery: { genreIds: ['electronic'], opportunityTypes: ['Mix'] }, collaboration: { creativeRoles: ['mixing-engineer'], compensationKinds: ['fee'] } }, onboarding: { step: 4, completeStep: 3 } });
  const resumed = createLocalStore(disk, undefined, 1);
  expect(resumed.getMyArtistOnboarding().step).toBe(4);
  expect(resumed.getMyArtistPreferences().discovery.genreIds).toEqual(['electronic']);
  const before = disk.getItem(STORAGE_KEY);
  expect(() => resumed.updateArtistIdentity({ profile: { name: 'Do not save' }, preferences: { discovery: { genreIds: ['unlisted'] as never } }, onboarding: { step: 4, finish: true } })).toThrow();
  expect(disk.getItem(STORAGE_KEY)).toBe(before);
  resumed.updateArtistIdentity({ onboarding: { step: 4, finish: true } });
  expect(resumed.getMyArtistOnboarding().completedAt).toBeTruthy();
  expect(resumed.getCurrentUser()!.artistId).toBe(artist.artistId);
  expect(resumed.getCurrentUser()!.artist!.genreIds).toEqual(['hip-hop']);
  expect(resumed.getCurrentUser()!.artist!.bio).toBeFalsy(); // Completion is not completeness.
  expect(parseState(disk.getItem(STORAGE_KEY)!).accounts).toHaveLength(1);
  expect(parseState(disk.getItem(STORAGE_KEY)!).artists).toHaveLength(1);
});

test('public profile reads omit drafts for the owner and never contain private preferences or progress', async () => {
  const { disk, store, artist } = await fixture();
  store.createProject({ title: 'Private draft', category: 'EP', goalAmount: 100, status: 'draft' });
  const publicProject = store.createProject({ title: 'Public work', category: 'EP', goalAmount: 100, status: 'funding' });
  store.updateArtistIdentity({ preferences: { discovery: { genres: ['PRIVATE TASTE'] } }, onboarding: { step: 2 }, profile: { name: 'Artist identity', publicInterests: ['Production'] } });
  const raw = disk.getItem(STORAGE_KEY);
  const detail = store.getPublicArtist(artist.artistId!)!;
  expect(detail.projects.map(p => p.id)).toEqual([publicProject.id]);
  expect(detail.opportunityProjectIds).toEqual([publicProject.id]);
  expect(detail.artist.publicInterests).toEqual(['Production']);
  for (const secret of ['PRIVATE TASTE', 'artistOnboarding', 'completedSteps', 'passwordDigest', 'totalRaised']) expect(JSON.stringify(detail)).not.toContain(secret);
  expect(store.getArtist(artist.artistId!)!.projects).toHaveLength(2); // Private management is preserved.
  expect(disk.getItem(STORAGE_KEY)).toBe(raw);
});

test('links, interests and onboarding reject malformed or forged writes without partial changes', async () => {
  const { disk, store } = await fixture(); const before = disk.getItem(STORAGE_KEY);
  const invalid = [
    { onboarding: { step: 0 } }, { onboarding: { step: 1, finish: true } }, { onboarding: { step: 1, completedAt: 'forged' } },
    { profile: { name: 'No', externalLinks: [{ label: 'x', url: 'javascript:alert(1)' }] } },
    { profile: { name: 'No', externalLinks: [{ label: 'x', url: 'https://user:pass@example.com' }] } },
    { profile: { name: 'No', publicInterests: ['Admin'] } }, { artistId: 2 }, { preferences: null },
  ];
  for (const input of invalid) expect(() => store.updateArtistIdentity(input as never)).toThrow();
  expect(disk.getItem(STORAGE_KEY)).toBe(before);
  expect(validateArtistLinks([{ label: ' Site ', url: 'https://example.com' }, { label: 'Site', url: 'https://example.com/' }])).toEqual([{ label: 'Site', url: 'https://example.com/' }]);
  store.updateArtistIdentity({ profile: { name: 'Artist identity', externalLinks: [], publicInterests: [] } });
  const state = JSON.parse(disk.getItem(STORAGE_KEY)!); state.accounts[0].artistOnboarding = { version: 1, step: 9, completedSteps: [], completedAt: null };
  expect(() => parseState(JSON.stringify(state))).toThrow();
});

test('investors and visitors cannot use artist identity or onboarding operations', async () => {
  const { store } = await fixture();
  store.logout();
  for (const run of [() => store.getMyArtistOnboarding(), () => store.updateArtistIdentity({ onboarding: { step: 1 } })]) expect(run).toThrow();
  await store.register({ name: 'Investor', email: 'investor@example.invalid', password: 'preview123', role: 'investor' });
  for (const run of [() => store.getMyArtistOnboarding(), () => store.updateArtistIdentity({ profile: { name: 'Forbidden' } })]) expect(run).toThrow();
  expect(store.getCurrentUser()!.role).toBe('investor');
});
