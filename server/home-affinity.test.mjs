import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHomeAffinitySignals, rankHomeProjects } from '../dist-server/server/home-affinity.js';
import { emptyArtistPreferences } from '../dist-server/lib/local/src/artist-identity.js';
import { emptyHomeFilters, filterOpportunityProjects } from '../dist-server/lib/local/src/opportunity-search.js';

const search = (criteria = {}, filters = {}) => ({ q: '', criteria, filters: { ...emptyHomeFilters(), ...filters } });
const preferences = (collaboration = {}, discovery = {}) => {
  const defaults = emptyArtistPreferences();
  return { collaboration: { ...defaults.collaboration, ...collaboration }, discovery: { ...defaults.discovery, ...discovery } };
};
const offer = (need, kind = 'fee', extra = {}) => ({
  id: 1, need, compensation: kind === 'fee' ? { kind, amount: 100, currency: 'USD' } : { kind, percent: 10 },
  available: true, status: 'open', deadline: null, deliverable: 'Stems', requirements: '', ...extra,
});
const project = (id, offers = [], extra = {}) => ({
  project: { id, artistId: 100 + id, artistName: `Artist ${id}`, title: `Project ${id}`, category: 'ep', status: 'published', createdAt: '2026-01-01T00:00:00Z', ...extra }, offers,
});
const rank = (items, prefs = null, profile = null, artists = [], query = search()) => rankHomeProjects(items, artists, query, buildHomeAffinitySignals(profile, prefs));
const ids = result => result.entries.map(entry => entry.item.project.id);
const score = (result, id) => result.entries.find(entry => entry.item.project.id === id).score;

test('canonical public role mapping is narrow, multi-role, and never a permission', () => {
  const mappings = {
    producer: ['Production'], 'mixing-engineer': ['Mix'], 'mastering-engineer': ['Master'],
    rapper: ['Feature', 'Verse'], vocalist: ['Feature'],
  };
  for (const [role, needs] of Object.entries(mappings)) {
    assert.deepEqual(buildHomeAffinitySignals({ creativeRoles: [role] }, null).participation, { values: needs, source: 'profile' });
  }
  assert.deepEqual(buildHomeAffinitySignals({ creativeRoles: ['producer', 'mixing-engineer', 'producer'] }, null).participation.values, ['Mix', 'Production']);
  for (const role of ['composer', 'songwriter', 'lyricist', 'recording-engineer', 'sound-designer', 'beatmaker']) {
    assert.deepEqual(buildHomeAffinitySignals({ creativeRoles: [role] }, null).participation.values, []);
  }
  const items = [project(1, [offer('Production')]), project(2, [offer('Master')])];
  assert.deepEqual(ids(rank(items, null, { creativeRoles: ['producer'] })), [1, 2]);
});

test('professional affinity matches opportunity need rather than the owner profession', () => {
  const producerOwner = project(90, [offer('Feature')]), needsProducer = project(1, [offer('Production')]);
  const artists = [{ id: 190, creativeRoles: ['producer'] }, { id: 101, creativeRoles: ['vocalist'] }];
  assert.deepEqual(ids(rank([producerOwner, needsProducer], preferences({ creativeRoles: ['producer'] }), null, artists)), [1, 90]);
});

test('explicit participation overrides public roles, including nonmatching or unmapped declarations', () => {
  const items = [project(90, [offer('Production')]), project(1, [offer('Mix')])], profile = { creativeRoles: ['producer'] };
  const explicit = rank(items, preferences({}, { opportunityTypes: ['Mix'] }), profile);
  assert.deepEqual(ids(explicit), [1, 90]);
  assert.equal(score(explicit, 90)[0], 0);
  for (const declaration of [preferences({ creativeRoles: ['songwriter'] }), preferences({ opportunityTypes: ['Master'] })]) {
    const result = rank(items, declaration, profile);
    assert.deepEqual(ids(result), [90, 1]);
    assert.ok(result.entries.every(entry => entry.score[0] === 0));
    assert.equal(result.summary.usesPublicProfile, false);
  }
});

test('only explicit participation-intent fields combine; availability and public interests do not', () => {
  const prefs = preferences({ opportunityTypes: ['Mix'], creativeRoles: ['rapper', 'mixing-engineer'] }, { opportunityTypes: ['Funding', 'Mix'] });
  const profile = { creativeRoles: ['producer'], publicInterests: ['Master'], collaborationAvailability: 'open' };
  assert.deepEqual(buildHomeAffinitySignals(profile, prefs).participation, { values: ['Feature', 'Funding', 'Mix', 'Verse'], source: 'explicit' });
  assert.deepEqual(buildHomeAffinitySignals({ publicInterests: ['Production'], collaborationAvailability: 'open' }, null).participation.values, []);
});

test('mixing plus fixed payment must come from one coherent opportunity', () => {
  const a = project(90, [offer('Mix', 'split'), offer('Feature', 'fee')]);
  const b = project(1, [offer('Mix', 'fee')]);
  const prefs = preferences({ opportunityTypes: ['Mix'], compensationKinds: ['fee'] });
  const result = rank([a, b], prefs);
  assert.deepEqual(ids(result), [1, 90]);
  assert.deepEqual(score(result, 90), [2, 0, 0, 0]);
  assert.deepEqual(score(result, 1), [2, 1, 0, 0]);
  const query = search({}, { participation: ['Mix'], compensationKinds: ['fee'] });
  const filtered = filterOpportunityProjects([a, b], [], query);
  assert.deepEqual(ids(rank(filtered, prefs, null, [], query)), [1]);
});

test('structured legacy criteria and facets restrict which offer can contribute affinity', () => {
  const a = project(90, [offer('Production', 'fee'), offer('Mix', 'split')]);
  const b = project(1, [offer('Mix', 'fee')]);
  const prefs = preferences({ opportunityTypes: ['Production'], compensationKinds: ['fee'] });
  const query = search({ need: 'Mix' }, { participation: ['Production', 'Mix'], compensationKinds: ['fee', 'split'] });
  const result = rank([a, b], prefs, null, [], query);
  assert.deepEqual(ids(result), [1, 90]);
  assert.deepEqual(score(result, 90), [0, 0, 0, 0]);
  assert.deepEqual(score(result, 1), [0, 1, 0, 0]);
  const strict = search({ need: 'Mix', compensation: 'fee' }, { participation: ['Mix', 'Master'] });
  assert.deepEqual(ids(rank(filterOpportunityProjects([a, b], [], strict), prefs, null, [], strict)), [1]);
});

test('best fourth and fifth offers count, while repeated offers and labels add no boost', () => {
  const prefs = preferences({ opportunityTypes: ['Mix', 'Mix'], compensationKinds: ['fee', 'fee'] });
  const laterOffer = project(1, [offer('Feature'), offer('Production'), offer('Master'), offer('Mix', 'split'), offer('Mix')]);
  const manyUnrelated = project(90, Array.from({ length: 15 }, () => offer('Feature')));
  assert.deepEqual(ids(rank([manyUnrelated, laterOffer], prefs)), [1, 90]);
  const duplicateMatching = project(1, Array.from({ length: 12 }, () => offer('Mix')));
  const singleMatching = project(90, [offer('Mix')]);
  const result = rank([duplicateMatching, singleMatching], prefs);
  assert.deepEqual(ids(result), [90, 1]);
  assert.deepEqual(score(result, 90), score(result, 1));
  assert.equal(result.entries.length, 2);
});

test('closed and expired offers do not contribute even when present in an input summary', () => {
  const stale = project(90, [offer('Mix', 'fee', { available: false, deadline: '2000-01-01' }), offer('Mix', 'fee', { status: 'closed' }), offer('Feature', 'split')]);
  const current = project(1, [offer('Mix')]);
  const result = rank([stale, current], preferences({ opportunityTypes: ['Mix'], compensationKinds: ['fee'] }));
  assert.deepEqual(ids(result), [1, 90]);
  assert.deepEqual(score(result, 90), [0, 0, 0, 0]);
});

test('funding is a separate candidate and cannot inherit creative compensation', () => {
  const funded = project(1, [offer('Feature', 'fee')], { status: 'funding' });
  const unrelated = project(90, [offer('Feature', 'fee')]);
  const prefs = preferences({ compensationKinds: ['fee'] }, { opportunityTypes: ['Funding'] });
  const result = rank([funded, unrelated], prefs);
  assert.deepEqual(ids(result), [1, 90]);
  assert.deepEqual(score(result, 1), [2, 0, 0, 0]);
  const onlyFunding = search({}, { participation: ['Funding'] });
  assert.deepEqual(score(rank([funded], prefs, null, [], onlyFunding), 1), [2, 0, 0, 0]);
  const fundingWithFee = search({}, { participation: ['Funding'], compensationKinds: ['fee'] });
  assert.deepEqual(filterOpportunityProjects([funded], [], fundingWithFee), []);
  assert.deepEqual(score(rank([funded], prefs, null, [], fundingWithFee), 1), [0, 0, 0, 0]);
  const mixingFilter = search({ need: 'Mix' });
  assert.deepEqual(score(rank([funded], prefs, null, [], mixingFilter), 1), [0, 0, 0, 0]);
});

test('legacy funding alone scores only funding while its creative conjunction preserves existing semantics', () => {
  const funded = project(1, [offer('Mix', 'fee')], { status: 'funding' });
  const unfunded = project(90, [offer('Mix', 'fee')]);
  const prefs = preferences({ opportunityTypes: ['Mix'], compensationKinds: ['fee'] });
  const fundingOnly = search({ opportunity: 'funding' });
  const selected = filterOpportunityProjects([funded, unfunded], [], fundingOnly);
  assert.deepEqual(ids(rank(selected, prefs, null, [], fundingOnly)), [1]);
  assert.deepEqual(score(rank(selected, prefs, null, [], fundingOnly), 1), [0, 0, 0, 0]);
  const legacyConjunction = search({ opportunity: 'funding', need: 'Mix', compensation: 'fee' });
  assert.deepEqual(ids(rank(filterOpportunityProjects([funded, unfunded], [], legacyConjunction), prefs, null, [], legacyConjunction)), [1]);
  assert.deepEqual(score(rank([funded], prefs, null, [], legacyConjunction), 1), [2, 1, 0, 0]);
  const facetAlternatives = search({ opportunity: 'funding' }, { participation: ['Funding', 'Mix'] });
  assert.deepEqual(score(rank([funded], prefs, null, [], facetAlternatives), 1), [2, 1, 0, 0]);
});

test('lexicographic policy keeps participation above compensation, project type and owner genre', () => {
  const prefs = preferences({ opportunityTypes: ['Mix'], compensationKinds: ['fee'] }, { projectTypes: ['album'], genreIds: ['electronic'] });
  const relevant = project(1, [offer('Mix', 'split')]);
  const other = project(90, [offer('Feature', 'fee')], { category: 'album' });
  const artists = [{ id: 101, genreIds: ['jazz'] }, { id: 190, genreIds: ['electronic'] }];
  assert.deepEqual(ids(rank([other, relevant], prefs, null, artists)), [1, 90]);
  const matchingFee = project(2, [offer('Mix')]);
  const matchingAlbum = project(3, [offer('Mix', 'split')], { category: 'album' });
  const matchingGenre = project(4, [offer('Mix', 'split')]);
  artists.push({ id: 104, genreIds: ['electronic'] });
  assert.deepEqual(ids(rank([matchingGenre, matchingAlbum, matchingFee, relevant], prefs, null, artists)), [2, 3, 4, 1]);
});

test('explicit discovery genres override public genres and refer only to the owning artist', () => {
  const profile = { genreIds: ['hip-hop'] };
  const prefs = preferences({}, { genreIds: ['electronic'], genres: ['Hip hop'] });
  const artists = [{ id: 101, genreIds: ['house'] }, { id: 102, genres: ['Electrónica'] }, { id: 190, genreIds: ['hip-hop'] }];
  const items = [project(90, [offer('Mix')], { title: 'Electronic', genre: 'electronic' }), project(1, [offer('Mix')]), project(2, [offer('Mix')])];
  const result = rank(items, prefs, profile, artists);
  assert.deepEqual(ids(result), [2, 90, 1]);
  assert.equal(score(result, 2)[3], 2);
  assert.equal(score(result, 90)[3], 0);
  assert.equal(score(result, 1)[3], 0); // A taxonomy parent is not an implicit selection.
});

test('canonical and legacy genres share the existing resolver without reviving cleared values', () => {
  const legacy = buildHomeAffinitySignals(null, preferences({}, { genres: ['Hip hop', 'Electronica', 'local experimental'] }));
  assert.deepEqual(legacy.artistGenre.values, ['electronic', 'hip-hop', 'local experimental']);
  const cleared = buildHomeAffinitySignals({ genreIds: ['jazz'], genre: 'Rock' }, preferences({}, { genreIds: [], genres: ['Electronic'] }));
  assert.deepEqual(cleared.artistGenre, { values: ['jazz'], source: 'profile' });
  const allCleared = buildHomeAffinitySignals({ genreIds: [], genre: 'Rock' }, preferences({}, { genreIds: [], genres: ['Electronic'] }));
  assert.deepEqual(allCleared.artistGenre.values, []);
  const artists = [{ id: 101, genreIds: [], genres: ['Electronic'], genre: 'Electronic' }, { id: 102, genreSource: 'legacy', genreIds: ['electronic'], genres: ['Electronic'] }];
  const result = rank([project(1, [offer('Mix')]), project(2, [offer('Mix')])], preferences({}, { genreIds: ['electronic'] }), null, artists);
  assert.equal(score(result, 1)[3], 0);
  assert.equal(score(result, 2)[3], 2);
});

test('unknown explicit genre does not substitute a more convenient public genre', () => {
  const profile = { genreIds: ['rock'] };
  const prefs = preferences({}, { genres: ['Unlisted Experimental Genre'] });
  const result = rank([project(1, [offer('Mix')])], prefs, profile, [{ id: 101, genreIds: ['rock'] }]);
  assert.equal(score(result, 1)[3], 0);
  assert.equal(result.summary.usesExplicitPreferences, true);
  assert.equal(result.summary.usesPublicProfile, false);
  assert.equal(result.summary.hasMatches, false);
});

test('no useful signals and no matches preserve general order without hiding eligible projects', () => {
  const items = [project(2, [offer('Feature')]), project(90, [], { status: 'funding' }), project(1, [offer('Feature')])];
  const before = JSON.stringify(items);
  const noSignals = rank(items);
  assert.deepEqual(ids(noSignals), [90, 2, 1]);
  assert.deepEqual(noSignals.summary, { hasSignals: false, hasMatches: false, usesExplicitPreferences: false, usesPublicProfile: false });
  const noMatches = rank(items, preferences({ opportunityTypes: ['Master'] }));
  assert.deepEqual(ids(noMatches), [90, 2, 1]);
  assert.equal(noMatches.summary.hasSignals, true);
  assert.equal(noMatches.summary.hasMatches, false);
  assert.equal(JSON.stringify(items), before);
});

test('summary exposes provenance booleans only and supports mixed explicit/public dimensions', () => {
  const prefs = preferences({ compensationKinds: ['fee'] });
  const result = rank([project(1, [offer('Production')])], prefs, { creativeRoles: ['producer'] });
  assert.deepEqual(result.summary, { hasSignals: true, hasMatches: true, usesExplicitPreferences: true, usesPublicProfile: true });
  assert.deepEqual(score(result, 1), [1, 1, 0, 0]);
  assert.ok(!JSON.stringify(result.summary).includes('producer'));
  assert.ok(!JSON.stringify(result.summary).includes('fee'));
});

test('ordering is deterministic over a multi-page inventory and ignores input order', () => {
  const items = Array.from({ length: 65 }, (_, index) => project(index + 1, [offer(index % 3 === 0 ? 'Mix' : 'Feature')]));
  const prefs = preferences({ opportunityTypes: ['Mix'] });
  const first = ids(rank(items, prefs));
  const reversed = ids(rank([...items].reverse(), prefs));
  assert.deepEqual(first, reversed);
  assert.equal(new Set(first).size, 65);
  assert.deepEqual(first.slice(0, 22), items.filter(item => item.offers[0].need === 'Mix').map(item => item.project.id).reverse());
});
