import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { fixture } from './test-fixtures.mjs';

const fee = { kind: 'fee', amount: 200, currency: 'USD' };
const split = { kind: 'split', percent: 12 };
const ids = page => page.items.map(item => item.project.id);
async function rpc(client, method, ...args) {
  const response = await client.rpc(method, ...args);
  assert.equal(response.status, 200, await response.clone().text());
  return (await response.json()).result;
}
async function projects(client, query = '') {
  const response = await client.request(`/api/opportunities/projects?${query}`);
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
}
const create = (client, title, extra = {}) => rpc(client, 'createProject', { title, category: 'EP', goalAmount: 1000, status: 'published', ...extra });
async function offer(client, project, need, compensation = fee, extra = {}) {
  const response = await client.request(`/api/projects/${project.id}/offers`, 'POST', { need, deliverable: `Original ${need} contribution`, requirements: 'Separate stems', deadline: null, status: 'open', compensation, ...extra });
  assert.equal(response.status, 201, await response.clone().text());
  return response.json();
}
async function artist(app, name, profile = {}) {
  const client = app.client(), result = await client.register(name);
  // Do not accidentally use a registration-time legacy genre as a preference fixture.
  await rpc(client, 'updateArtist', { name, genreIds: [], ...profile });
  return { client, id: result.user.artistId };
}
const preference = (client, patch) => rpc(client, 'updateMyArtistPreferences', patch);
const close = async (client, value) => {
  const response = await client.request(`/api/offers/${value.id}`, 'PATCH', { action: 'close', revision: value.revision });
  assert.equal(response.status, 200, await response.clone().text());
};

// API-level ordering assertions intentionally describe the user-visible policy,
// independently of the ranker's implementation or private diagnostic tuples.
test('Home For You uses the current Artist intentions, not the owner role, and explicit interests override public-role fallback', async t => {
  const app = await fixture(t);
  const owner = await artist(app, 'HFYRoleOwner', { creativeRoles: ['vocalist'] });
  const producerOwner = await artist(app, 'HFYProducerOwner', { creativeRoles: ['producer'] });
  const a = await artist(app, 'HFYProductionViewer', { creativeRoles: ['producer'] });
  const b = await artist(app, 'HFYMixViewer', { creativeRoles: ['producer'] });
  const production = await create(owner.client, 'Production needed from any artist'); await offer(owner.client, production, 'Production');
  const mixing = await create(producerOwner.client, 'Producer-owned project needs a mix'); await offer(producerOwner.client, mixing, 'Mix');
  await preference(a.client, { discovery: { opportunityTypes: ['Production'] } });
  await preference(b.client, { collaboration: { opportunityTypes: ['Mix'], compensationKinds: ['fee'] } });
  assert.deepEqual(ids(await projects(a.client)), [production.id, mixing.id]);
  assert.deepEqual(ids(await projects(b.client)), [mixing.id, production.id]);
  // No arbitrary viewer reference can borrow another account's preferences.
  const forged = await a.client.request(`/api/opportunities/projects?viewerId=${b.id}`);
  if (forged.status === 200) assert.deepEqual(ids(await forged.json()), [production.id, mixing.id]);
  else assert.equal(forged.status, 400);
  await preference(a.client, { discovery: { opportunityTypes: [] } });
  assert.deepEqual(ids(await projects(a.client)), [production.id, mixing.id], 'public producer is a valid secondary need signal');
  assert.equal((await projects(a.client)).forYou.basis, 'profile');
  await preference(a.client, { discovery: { opportunityTypes: ['Mix'] } });
  assert.deepEqual(ids(await projects(a.client)), [mixing.id, production.id], 'explicit Mix replaces the public producer fallback');
  await rpc(a.client, 'updateArtist', { name: 'HFYProductionViewer', creativeRoles: ['mixing-engineer', 'producer'] });
  await preference(a.client, { discovery: { opportunityTypes: [] } });
  assert.deepEqual(ids(await projects(a.client)), [mixing.id, production.id], 'both public roles match; existing ID order resolves the tie');
  await rpc(a.client, 'updateArtist', { name: 'HFYProductionViewer', creativeRoles: ['composer'] });
  const neutral = await projects(a.client);
  assert.deepEqual(ids(neutral), [mixing.id, production.id]);
  assert.deepEqual(neutral.forYou, { basis: 'general', reason: 'no-signals' });
});

test('Home scores one coherent eligible opportunity, sees matches beyond the card summary and respects the filtering pipeline', async t => {
  const app = await fixture(t), owner = await artist(app, 'HFYCoherentOwner'), viewer = await artist(app, 'HFYCoherentViewer');
  await preference(viewer.client, { collaboration: { opportunityTypes: ['Mix'], compensationKinds: ['fee'] } });
  const deep = await create(owner.client, 'Coherent buried fourth offer');
  await offer(owner.client, deep, 'Mix');
  for (const need of ['Feature', 'Verse', 'Master']) await offer(owner.client, deep, need, split);
  const b = await create(owner.client, 'Coherent B one matching opportunity'); await offer(owner.client, b, 'Mix');
  const a = await create(owner.client, 'Coherent A mismatched compensation'); await offer(owner.client, a, 'Mix', split); await offer(owner.client, a, 'Feature');
  const crowded = await create(owner.client, 'Coherent crowded royalties');
  for (let n = 0; n < 5; n++) await offer(owner.client, crowded, 'Mix', split);
  const other = await create(owner.client, 'Coherent Feature only'); await offer(owner.client, other, 'Feature');
  assert.deepEqual(ids(await projects(viewer.client)), [b.id, deep.id, crowded.id, a.id, other.id]);
  assert.deepEqual(ids(await projects(viewer.client, 'participation=Mix&compensationKinds=fee')), [b.id, deep.id]);
  assert.deepEqual(ids(await projects(viewer.client, 'participation=Feature&compensationKinds=fee')), [other.id, a.id], 'the ranking cannot borrow the filtered-out Mix offer from A');
  const filters = 'q=coherent&projectTypes=ep&projectTypes=album&participation=Mix&participation=Feature&compensationKinds=fee';
  assert.deepEqual(ids(await projects(viewer.client, filters)), [b.id, deep.id, other.id, a.id]);
  assert.equal(new Set(ids(await projects(viewer.client, filters))).size, 4);
  assert.deepEqual(ids(await projects(viewer.client, 'q=coherent&participation=Production')), []);
  assert.deepEqual(ids(await projects(viewer.client, 'q=Separate%20stems&need=Mix&compensation=fee')), [b.id, deep.id]);
  const hidden = await create(owner.client, 'Private matching work', { status: 'draft' }); await offer(owner.client, hidden, 'Mix');
  const closedProject = await create(owner.client, 'Closed matching work', { status: 'closed' }); await offer(owner.client, closedProject, 'Mix');
  const closedOfferProject = await create(owner.client, 'Closed opportunity work'); const closedOffer = await offer(owner.client, closedOfferProject, 'Mix'); await close(owner.client, closedOffer);
  const expired = await create(owner.client, 'Expired opportunity work'); const expiring = await offer(owner.client, expired, 'Mix');
  const db = new DatabaseSync(join(app.dataDir, 'nebula.sqlite'));
  try { const data = JSON.parse(db.prepare('SELECT data FROM collaboration_offers WHERE id=?').get(expiring.id).data); db.prepare('UPDATE collaboration_offers SET data=? WHERE id=?').run(JSON.stringify({ ...data, deadline: '2000-01-01' }), expiring.id); } finally { db.close(); }
  assert.deepEqual(ids(await projects(viewer.client, 'participation=Mix&compensationKinds=fee')), [b.id, deep.id]);
  assert.deepEqual(ids(await projects(owner.client, 'q=Private')), []);
  // Funding cannot inherit a creative offer's fee. The newer neutral funding wins the tie.
  const fundingWithFee = await create(owner.client, 'Funding with creative fee', { status: 'funding' }); await offer(owner.client, fundingWithFee, 'Feature');
  const fundingOnly = await create(owner.client, 'Funding without creative fee', { status: 'funding' });
  await preference(viewer.client, { collaboration: { opportunityTypes: [] }, discovery: { opportunityTypes: ['Funding'] } });
  assert.deepEqual(ids(await projects(viewer.client, 'participation=Funding')), [fundingOnly.id, fundingWithFee.id]);
  assert.deepEqual(ids(await projects(viewer.client, 'participation=Funding&compensationKinds=fee')), []);
});

test('Home artist-genre affinity honors canonical and legacy resolution, explicit clearing and private preferences', async t => {
  const app = await fixture(t), electronicOwner = await artist(app, 'HFYElectronicOwner', { genreIds: ['electronic'] }), rnbOwner = await artist(app, 'HFYRnbOwner', { genreIds: ['rnb'] });
  const legacyOwner = app.client(); await legacyOwner.register('HFYLegacyOwner'); await rpc(legacyOwner, 'updateArtist', { name: 'HFYLegacyOwner', genre: 'NORTEÑO' });
  const clearedOwner = await artist(app, 'HFYClearedOwner', { genre: 'Electronic', genres: ['Electronic'], genreIds: [] });
  const viewer = await artist(app, 'HFYGenreViewer', { genreIds: ['rnb'] }), guest = app.client();
  const electronic = await create(electronicOwner.client, 'Electronic owner funding', { status: 'funding' });
  const rnb = await create(rnbOwner.client, 'Rnb owner funding', { status: 'funding' });
  const legacy = await create(legacyOwner, 'Legacy owner funding', { status: 'funding' });
  const cleared = await create(clearedOwner.client, 'Explicitly cleared owner funding', { status: 'funding' });
  await preference(viewer.client, { discovery: { genreIds: ['electronic'], genres: ['PRIVATE_HFY_GENRE_MARKER'] } });
  assert.deepEqual(ids(await projects(viewer.client)), [electronic.id, cleared.id, legacy.id, rnb.id]);
  await preference(viewer.client, { discovery: { genreIds: [] } });
  assert.deepEqual(ids(await projects(viewer.client)), [rnb.id, cleared.id, legacy.id, electronic.id], 'an empty canonical selection cannot revive its old legacy preferences');
  const legacyViewer = await artist(app, 'HFYLegacyViewer');
  await preference(legacyViewer.client, { discovery: { genres: ['Norteño'] } });
  assert.equal(ids(await projects(legacyViewer.client))[0], legacy.id);
  assert.deepEqual(ids(await projects(legacyViewer.client, 'artistGenres=norteno')), [legacy.id]);
  await preference(viewer.client, { discovery: { genreIds: ['classical'] } });
  const unmatched = await projects(viewer.client);
  assert.deepEqual(ids(unmatched), [cleared.id, legacy.id, rnb.id, electronic.id]);
  assert.deepEqual(unmatched.forYou, { basis: 'general', reason: 'no-matches' });
  for (const client of [guest, electronicOwner.client]) {
    for (const response of [await client.rpc('getArtist', viewer.id), await client.rpc('getPublicArtist', viewer.id), await client.rpc('listArtists'), await client.rpc('getProject', electronic.id), await client.request('/api/opportunities/projects'), await client.request('/api/opportunities/suggestions?q=HFY'), await client.request('/api/publications')]) {
      assert.equal(response.status, 200);
      const text = await response.text();
      for (const privateField of ['PRIVATE_HFY_GENRE_MARKER', 'artistPreferences', 'compensationKinds', 'opportunityTypes']) assert.equal(text.includes(privateField), false, privateField);
    }
  }
  assert.equal((await guest.rpc('getMyArtistPreferences')).status, 401);
  assert.equal((await electronicOwner.client.rpc('getMyArtistPreferences', viewer.id)).status, 400);
  await app.restart(); assert.deepEqual(ids(await projects(viewer.client)), ids(unmatched));
});

test('Home For You paginates the whole ranked inventory without duplicates, isolates cursors and rechecks live eligibility', async t => {
  const app = await fixture(t), owner = await artist(app, 'HFYPagingOwner'), a = await artist(app, 'HFYPagingMix'), b = await artist(app, 'HFYPagingProduction'), guest = app.client();
  await preference(a.client, { discovery: { opportunityTypes: ['Mix'] } });
  await preference(b.client, { discovery: { opportunityTypes: ['Production'] } });
  const all = [], offers = new Map();
  for (let index = 0; index < 56; index++) {
    const project = await create(owner.client, `Paging opportunity ${index}`);
    const need = index % 2 ? 'Production' : 'Mix';
    offers.set(project.id, await offer(owner.client, project, need)); all.push({ project, need });
  }
  const expected = [...all.filter(item => item.need === 'Mix').reverse(), ...all.filter(item => item.need === 'Production').reverse()].map(item => item.project.id);
  const first = await projects(a.client, 'q=Paging'); assert.equal(first.items.length, 24); assert.ok(first.nextPageCursor);
  let page = first; const seen = ids(page), cursors = new Set();
  while (page.nextPageCursor) {
    assert.equal(cursors.has(page.nextPageCursor), false); cursors.add(page.nextPageCursor);
    page = await projects(a.client, 'q=Paging&cursor=' + encodeURIComponent(page.nextPageCursor)); seen.push(...ids(page));
  }
  assert.deepEqual(seen, expected); assert.equal(new Set(seen).size, 56); assert.equal(cursors.size, 2);
  const cursor = encodeURIComponent(first.nextPageCursor);
  for (const client of [b.client, guest]) assert.equal((await client.request('/api/opportunities/projects?q=Paging&cursor=' + cursor)).status, 400);
  for (const query of ['q=changed', 'q=Paging&participation=Mix', 'q=Paging&mode=recent']) assert.equal((await a.client.request('/api/opportunities/projects?' + query + '&cursor=' + cursor)).status, 400);
  const decoded = Buffer.from(first.nextPageCursor, 'base64url').toString('utf8');
  for (const privateValue of ['opportunityTypes', 'compensationKinds', 'HFYPagingMix', 'participationMatch']) assert.equal(decoded.includes(privateValue), false);
  const future = expected[24]; await close(owner.client, offers.get(future));
  page = await projects(a.client, 'q=Paging&cursor=' + cursor); const remaining = ids(page);
  while (page.nextPageCursor) { page = await projects(a.client, 'q=Paging&cursor=' + encodeURIComponent(page.nextPageCursor)); remaining.push(...ids(page)); }
  assert.deepEqual(remaining, expected.slice(24).filter(id => id !== future), 'a closed offer is not delivered from a stale rank position');
  // If every positive match expires, keep the original score boundary: switching
  // to numeric-ID pagination would skip newer, still-eligible neutral projects.
  const db = new DatabaseSync(join(app.dataDir, 'nebula.sqlite'));
  const expiredRows = all.filter(item => item.need === 'Mix').map(item => db.prepare('SELECT id,data FROM collaboration_offers WHERE id=?').get(offers.get(item.project.id).id));
  try {
    for (const row of expiredRows) db.prepare('UPDATE collaboration_offers SET data=? WHERE id=?').run(JSON.stringify({ ...JSON.parse(row.data), deadline: '2000-01-01' }), row.id);
    page = await projects(a.client, 'q=Paging&cursor=' + cursor);
    const afterExpiry = ids(page);
    while (page.nextPageCursor) { page = await projects(a.client, 'q=Paging&cursor=' + encodeURIComponent(page.nextPageCursor)); afterExpiry.push(...ids(page)); }
    assert.deepEqual(afterExpiry, all.filter(item => item.need === 'Production').map(item => item.project.id).reverse());
    assert.deepEqual(page.forYou, { basis: 'general', reason: 'no-matches' });
  } finally {
    for (const row of expiredRows) db.prepare('UPDATE collaboration_offers SET data=? WHERE id=?').run(row.data, row.id);
    db.close();
  }
  await preference(a.client, { discovery: { opportunityTypes: ['Production'] } });
  assert.equal((await a.client.request('/api/opportunities/projects?q=Paging&cursor=' + cursor)).status, 400);
  assert.equal(ids(await projects(a.client))[0], all.at(-1).project.id);
  const anonymousOrder = all.map(item => item.project.id).filter(id => id !== future).reverse();
  assert.deepEqual(ids(await projects(guest)), anonymousOrder.slice(0, 24));
  await rpc(a.client, 'logout');
  assert.equal((await a.client.request('/api/opportunities/projects?q=Paging&cursor=' + cursor)).status, 400);
  assert.deepEqual(ids(await projects(a.client)), anonymousOrder.slice(0, 24));
});

test('For You preference updates preserve Recent, Following, Discovery snapshots, Global Search and the Investor environment', async t => {
  const app = await fixture(t), owner = await artist(app, 'HFYPreserveOwner'), other = await artist(app, 'HFYPreserveOther'), viewer = await artist(app, 'HFYPreserveViewer'), guest = app.client(), investor = app.client();
  await investor.register('HFYPreserveInvestor', 'investor');
  const mix = await create(owner.client, 'Preserve first mixing project'); await offer(owner.client, mix, 'Mix');
  const production = await create(owner.client, 'Preserve newer production project'); await offer(owner.client, production, 'Production');
  const outside = await create(other.client, 'Preserve unfollowed project'); await offer(other.client, outside, 'Production');
  assert.equal((await viewer.client.request(`/api/artists/${owner.id}/follow`, 'PUT')).status, 200);
  const db = new DatabaseSync(join(app.dataDir, 'nebula.sqlite'));
  try {
    const state = JSON.parse(db.prepare('SELECT value FROM state WHERE id=1').get().value);
    for (const project of state.projects) project.createdAt = new Date(Date.UTC(2025, 0, 20 - project.id)).toISOString();
    db.prepare('UPDATE state SET value=? WHERE id=1').run(JSON.stringify(state));
  } finally { db.close(); }
  const media = await (await owner.client.upload()).json();
  for (const project of [mix, production]) {
    const response = await owner.client.request('/api/publications', 'POST', { title: `Preserved ${project.title}`, description: 'Independent audiovisual feed fixture', mediaId: media.id, coverId: null, projectId: project.id, allowRemix: false, status: 'published' });
    assert.equal(response.status, 201, await response.clone().text());
  }
  const recent = await projects(viewer.client, 'mode=recent'); assert.deepEqual(ids(recent), [mix.id, production.id, outside.id]);
  const following = await projects(viewer.client, 'mode=following'); assert.deepEqual(ids(following), [production.id, mix.id]);
  const discovery = await (await viewer.client.request('/api/feed?offset=0')).json();
  const global = await rpc(viewer.client, 'listProjects', { search: 'Preserve' });
  const publicArtists = await rpc(guest, 'listArtists', { search: 'HFYPreserve' });
  const investorCatalog = await rpc(investor, 'listProjects');
  const investorHome = ids(await projects(investor));
  await preference(viewer.client, { discovery: { opportunityTypes: ['Mix'], projectTypes: ['ep'], genreIds: ['electronic'] }, collaboration: { compensationKinds: ['fee'] } });
  assert.equal(ids(await projects(viewer.client))[0], mix.id);
  assert.deepEqual(await projects(viewer.client, 'mode=recent'), recent);
  assert.deepEqual(await projects(viewer.client, 'mode=following'), following);
  assert.deepEqual(ids(await projects(viewer.client, 'mode=following&participation=Production&compensationKinds=fee')), [production.id]);
  assert.deepEqual(await (await viewer.client.request('/api/feed?offset=0&snapshot=' + encodeURIComponent(discovery.snapshot))).json(), discovery);
  assert.deepEqual(await rpc(viewer.client, 'listProjects', { search: 'Preserve' }), global);
  assert.deepEqual(await rpc(guest, 'listArtists', { search: 'HFYPreserve' }), publicArtists);
  assert.deepEqual(await rpc(investor, 'listProjects'), investorCatalog);
  assert.deepEqual(ids(await projects(investor)), investorHome); assert.deepEqual(ids(await projects(guest)), investorHome);
  assert.equal((await investor.request('/api/opportunities/projects?mode=following')).status, 403);
  assert.equal((await investor.rpc('getMyArtistPreferences')).status, 403);
  assert.equal((await investor.request(`/api/projects/${mix.id}/offers`, 'POST', { need: 'Mix', compensation: fee, deliverable: 'Forbidden', requirements: '', deadline: null, status: 'open' })).status, 403);
});
