import { expect, test } from 'vitest';
import { searchableArtistGenres, artistGenreLabel, artistGenreMatches, artistSearchText } from './artist-search-genres';
import { publicArtist, type StoredArtist } from './artist-identity';
import { createLocalStore, STORAGE_KEY } from './store';
import { filterOpportunityProjects, opportunitySuggestions, homeFacetOptions, normalizeHomeSearch, normalizeHomeFilters, addHomeCriterion } from './opportunity-search';
import { homeHistoryKey, readHomeHistory, rememberHomeSearch } from './home-search-history';
import type { ArtistSummary } from './types';
import type { OpportunityProject } from './opportunities';

const artist = (extra: Partial<StoredArtist> = {}): StoredArtist => ({ id: 1, name: 'Neutral creator', genre: null, basedIn: null, bio: null, picture: null, recordLabel: null, ...extra });
const summary = (a: StoredArtist): ArtistSummary => ({ ...publicArtist(a), projectCount: 1, totalRaised: 0, supportersCount: 0 });
const opportunity = { project: { id: 1, artistId: 1, artistName: 'Neutral creator', title: 'Neutral project', category: 'EP', status: 'funding' }, offers: [
  { need: 'Production', compensation: { kind: 'fee', amount: 100, currency: 'USD' } },
  { need: 'Mix', compensation: { kind: 'split', percent: 10 } },
] } as OpportunityProject;
const memory = () => { const data = new Map<string, string>(); return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } }; };

test('raw and public projections preserve structured precedence, explicit empty and legacy unknowns without writes', () => {
  for (const [record, expected] of [
    [artist({ genreIds: ['rnb', 'electronic'] }), ['rnb', 'electronic']],
    [artist({ genre: 'NORTEÑO' }), ['norteno']],
    [artist({ genre: 'Rock', genres: ['Jazz'], genreIds: ['rnb'] }), ['rnb']],
    [artist({ genre: 'Rock', genres: ['Jazz'], genreIds: [] }), []],
    [artist({ genre: 'Rock', genres: [] }), []],
    [artist({ genres: ['Hip hop', 'HIPHOP', 'RnB', 'R and B', 'Electrónica'] }), ['hip-hop', 'rnb', 'electronic']],
    [artist({ genre: 'Jazz / Soul' }), ['Jazz / Soul']],
  ] as [StoredArtist, string[]][]) {
    const before = JSON.stringify(record);
    expect(searchableArtistGenres(record).map(g => g.value)).toEqual(expected);
    expect(searchableArtistGenres(publicArtist(record))).toEqual(searchableArtistGenres(record));
    expect(JSON.stringify(record)).toBe(before);
  }
  const unknown = searchableArtistGenres(publicArtist(artist({ genre: 'Jazz / Soul' })));
  expect(unknown[0].canonical).toBe(false);
  expect(artistGenreLabel(unknown[0].value)).toBe('Jazz / Soul (legacy text)');
  expect(artistGenreMatches(unknown, 'jazz')).toBe(false);
  expect(artistSearchText(artist({ genre: 'Jazz / Soul' }))).toContain('jazz / soul');
  expect(artistGenreMatches(searchableArtistGenres(artist({ genreIds: ['house'] })), 'electronic')).toBe(false); // No inferred parent genres.
});

test('Home uses all current artist genres in text, facets, suggestions and same-offer multiselect', () => {
  const artists = [summary(artist({ genre: 'Rock', genreIds: ['rnb', 'electronic'] }))];
  for (const q of ['rnb', 'R&B', 'Rhythm and Blues', 'ELECTRÓNICA', 'electronic', 'electronic_music']) expect(filterOpportunityProjects([opportunity], artists, { q, criteria: {} })).toHaveLength(1);
  for (const q of ['rock', 'jazz', '___']) expect(filterOpportunityProjects([opportunity], artists, { q, criteria: {} })).toEqual([]);
  const filters = normalizeHomeFilters({ artistGenres: ['RnB', 'R&B', 'electrónica'], projectTypes: ['album', 'ep'], participation: ['Production'], compensationKinds: ['fee'] });
  expect(filters.artistGenres).toEqual(['rnb', 'electronic']);
  expect(filterOpportunityProjects([opportunity], artists, { q: 'neutral', criteria: {}, filters })).toHaveLength(1);
  expect(filterOpportunityProjects([opportunity], artists, { q: '', criteria: {}, filters: { ...filters, compensationKinds: ['split'] } })).toEqual([]);
  expect(filterOpportunityProjects([opportunity], artists, { q: '', criteria: {}, filters: { ...filters, participation: ['Funding'] } })).toEqual([]);
  expect(homeFacetOptions([opportunity], artists).artistGenres).toEqual(['Electronic', 'R&B']);
  const suggestions = opportunitySuggestions([opportunity], artists, { q: 'electronic_music', criteria: {} });
  expect(suggestions).toEqual([expect.objectContaining({ label: 'Electronic', type: 'Artist genre', value: 'Electronic' })]);
  expect(opportunitySuggestions([opportunity], artists, { q: 'RnB', criteria: {}, filters })).toEqual([]);
  expect(opportunitySuggestions([opportunity], artists, { q: '___', criteria: {} })).toEqual([]);
  expect(opportunitySuggestions([opportunity], artists, { q: 'RnB', criteria: {} })[0]).toMatchObject({ id: 'genre:rnb', value: 'R&B' });
  expect(addHomeCriterion({ q: 'RnB', criteria: {} }, 'genre', 'R&B').filters.artistGenres).toEqual(['rnb']);
  const cleared = [summary(artist({ genre: 'Rock', genreIds: [] }))];
  expect(homeFacetOptions([opportunity], cleared).artistGenres).toEqual([]);
  expect(opportunitySuggestions([opportunity], cleared, { q: 'Rock', criteria: {} })).toEqual([]);
});

test('legacy criteria and history normalize safely, deduplicate aliases and keep unknown text', () => {
  const disk = memory();
  disk.setItem(homeHistoryKey('genre-compat'), JSON.stringify([{ q: '', criteria: { genre: 'HIP HOP' } }, { q: '', criteria: { genre: 'Jazz / Soul' } }]));
  const entries = readHomeHistory('genre-compat', disk);
  expect(normalizeHomeSearch(entries[0]).filters.artistGenres).toEqual(['hip-hop']);
  expect(normalizeHomeSearch(entries[1]).filters.artistGenres).toEqual(['Jazz / Soul']);
  rememberHomeSearch('genre-compat', { q: '', criteria: {}, filters: normalizeHomeFilters({ artistGenres: ['hip-hop'] }) }, disk);
  expect(readHomeHistory('genre-compat', disk)).toHaveLength(2);
  expect(readHomeHistory('another-account', disk)).toEqual([]);
});

test('browser store search updates on save/reload, preserves originals and does not search private preferences or infer project genres', async () => {
  const disk = memory(), store = createLocalStore(disk, undefined, 1);
  const user = await store.register({ name: 'Neutral creator', email: 'genre-test@example.invalid', password: 'preview123', role: 'artist' });
  const project = store.createProject({ title: 'Neutral project', category: 'EP', status: 'funding', goalAmount: 100 });
  store.updateArtist({ name: user.name, genre: 'Rock' });
  expect(store.listArtists({ search: 'rock' })).toHaveLength(1);
  store.updateMyArtistPreferences({ discovery: { genreIds: ['classical'] } });
  store.updateArtist({ name: user.name, genreIds: ['rnb', 'electronic'] });
  for (const search of ['rnb', 'Rhythm and Blues', 'Electrónica', 'NEUTRAL']) expect(store.listArtists({ search })).toHaveLength(1);
  for (const search of ['rock', 'classical', '___']) expect(store.listArtists({ search })).toEqual([]);
  expect(store.listProjects({ search: 'electronic' })).toEqual([]);
  store.updateArtist({ name: user.name, genreIds: ['rnb'] });
  const reloaded = createLocalStore(disk, undefined, 1);
  expect(reloaded.listArtists({ search: 'electronic' })).toEqual([]);
  expect(reloaded.listArtists({ search: 'rnb' })).toHaveLength(1);
  reloaded.updateArtist({ name: user.name, genreIds: [] });
  for (const search of ['rock', 'rnb']) expect(reloaded.listArtists({ search })).toEqual([]);
  const stored = JSON.parse(disk.getItem(STORAGE_KEY)!);
  expect(stored.artists[0].genre).toBe('Rock');
  expect(stored.artists[0]).not.toHaveProperty('genreSource');
  expect(reloaded.getProject(project.id)!.project.title).toBe('Neutral project');
  expect(() => reloaded.updateArtist({ name: user.name, genreSource: 'legacy' } as never)).toThrow();
});
