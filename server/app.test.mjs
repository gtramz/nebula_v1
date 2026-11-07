import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createNebulaServer } from '../dist-server/server/app.js';

const audio = await readFile(new URL('../artifacts/nebula/public/discovery-demo/soft-signal.wav', import.meta.url));
async function fixture(t, options = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'nebula-server-test-'));
  let server, origin;
  async function start() {
    server = await createNebulaServer({ dataDir, publicDir: resolve('artifacts/nebula/dist/public'), ...options });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${server.address().port}`;
  }
  async function stop() { await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); }
  await start();
  t.after(async () => { await stop(); await rm(dataDir, { recursive: true, force: true }); });
  function client() {
    let cookie = '';
    return {
      async request(path, method = 'GET', body, headers = {}) {
        const response = await fetch(origin + path, { method, headers: { Origin: origin, 'X-Nebula-Request': '1', ...(cookie ? { Cookie: cookie } : {}), ...(body && !Buffer.isBuffer(body) ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body) });
        if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
        return response;
      },
      async rpc(method, ...args) { return this.request('/api/rpc', 'POST', { method, args }); },
      async register(name, role = 'artist') {
        const response = await this.rpc('register', { name, email: `${name}@example.invalid`, password: 'preview123', role });
        assert.equal(response.status, 200, await response.clone().text()); return response.json();
      },
      async upload(bytes = audio, kind = 'audio') {
        const response = await this.request('/api/uploads', 'POST', bytes, { 'X-Media-Kind': kind, 'Content-Type': 'application/octet-stream' });
        return response;
      },
    };
  }
  return { client, dataDir, restart: async () => { await stop(); await start(); }, get origin() { return origin; } };
}
const postInput = (media, extra = {}) => ({ title: 'A real sound', description: 'Original publication', mediaId: media.id, coverId: null, projectId: null, allowRemix: false, status: 'draft', ...extra });

test('durable accounts, private drafts, publishing, range playback and withdrawal across clients and restart', async t => {
  const app = await fixture(t), artist = app.client(), guest = app.client(), secondBrowser = app.client();
  const registration = await artist.register('artist');
  assert.equal(registration.user.role, 'artist');
  assert.equal(JSON.stringify(registration).includes('passwordDigest'), false);
  const uploaded = await artist.upload(); assert.equal(uploaded.status, 201);
  const media = await uploaded.json();
  assert.equal((await guest.request(media.url)).status, 404);
  const draft = await (await artist.request('/api/publications', 'POST', postInput(media))).json();
  assert.equal((await guest.request(`/api/publications/${draft.id}`)).status, 404);
  assert.equal((await (await guest.request('/api/publications')).json()).items.length, 0);
  const publishedResponse = await artist.request(`/api/publications/${draft.id}`, 'PATCH', { ...draft, status: 'published' });
  assert.equal(publishedResponse.status, 200); const published = await publishedResponse.json();
  const publicList = await (await guest.request('/api/publications')).json();
  assert.equal(publicList.items[0].artistName, 'artist');
  const range = await guest.request(media.url, 'GET', undefined, { Range: 'bytes=0-43' });
  assert.equal(range.status, 206); assert.equal((await range.arrayBuffer()).byteLength, 44);
  assert.equal(range.headers.get('content-type'), 'audio/wav');
  assert.equal((await guest.request(media.url, 'GET', undefined, { Range: 'bytes=99999999-' })).status, 416);
  const login = await secondBrowser.rpc('login', { email: 'artist@example.invalid', password: 'preview123' });
  assert.equal(login.status, 200); assert.match(login.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  await app.restart();
  assert.equal((await (await artist.request('/api/session')).json()).user.name, 'artist');
  assert.equal((await (await secondBrowser.request('/api/publications?mine=1')).json()).items.length, 1);
  const withdrawn = await secondBrowser.request(`/api/publications/${published.id}`, 'PATCH', { ...published, status: 'withdrawn' });
  assert.equal(withdrawn.status, 200);
  assert.equal((await guest.request(media.url)).status, 404);
  assert.equal((await guest.request(`/api/publications/${published.id}`)).status, 404);
  assert.equal((await artist.request(media.url)).status, 200);
  await artist.rpc('logout');
  assert.equal((await artist.request('/api/publications?mine=1')).status, 401);
});

test('server rejects forged ownership, foreign assets, unpublished projects, CSRF and stale edits', async t => {
  const app = await fixture(t), artist = app.client(), other = app.client(), investor = app.client(), guest = app.client();
  await artist.register('owner'); await other.register('other'); await investor.register('investor', 'investor');
  assert.equal((await investor.upload()).status, 403); assert.equal((await guest.upload()).status, 401);
  const media = await (await artist.upload()).json();
  assert.equal((await other.request('/api/publications', 'POST', postInput(media))).status, 400);
  const projectResponse = await artist.rpc('createProject', { title: 'Private project', category: 'EP', goalAmount: 1000, status: 'draft', artistId: 999, id: 999 });
  assert.equal(projectResponse.status, 200); const project = (await projectResponse.json()).result;
  assert.notEqual(project.artistId, 999); assert.notEqual(project.id, 999);
  assert.equal((await artist.request('/api/publications', 'POST', postInput(media, { projectId: project.id, status: 'published' }))).status, 400);
  await artist.rpc('updateProject', project.id, { status: 'published' });
  const post = await (await artist.request('/api/publications', 'POST', postInput(media, { projectId: project.id, status: 'published', allowRemix: true }))).json();
  assert.equal(post.project.title, 'Private project');
  assert.equal((await other.request(`/api/publications/${post.id}`, 'PATCH', post)).status, 404);
  assert.equal((await artist.request(`/api/publications/${post.id}`, 'PATCH', post, { Origin: 'https://attacker.invalid' })).status, 403);
  assert.equal((await artist.request(`/api/publications/${post.id}`, 'PATCH', { ...post, title: 'Edited' })).status, 200);
  assert.equal((await artist.request(`/api/publications/${post.id}`, 'PATCH', post)).status, 409);
  assert.equal((await artist.rpc('exportData')).status, 404);
  assert.equal((await artist.rpc('clearDemoData')).status, 404);
  assert.equal((await guest.request('/api/publications?mine=1')).status, 401);
});

test('upload format checks and deletion cannot expose or delete another artist’s files', async t => {
  const app = await fixture(t), artist = app.client(), other = app.client();
  await artist.register('owner'); await other.register('other');
  assert.equal((await artist.upload(Buffer.from('<script>alert(1)</script>'), 'video')).status, 415);
  const media = await (await artist.upload()).json();
  assert.equal((await other.request(`/api/uploads/${media.id}`, 'DELETE')).status, 404);
  const unused = await (await artist.request('/api/uploads')).json(); assert.equal(unused.length, 1);
  const post = await (await artist.request('/api/publications', 'POST', postInput(media))).json();
  assert.equal((await artist.request(`/api/uploads/${media.id}`, 'DELETE')).status, 409);
  const replacement = await (await artist.upload()).json();
  assert.equal((await artist.request(`/api/publications/${post.id}`, 'PATCH', { ...post, mediaId: replacement.id })).status, 200);
  assert.equal((await artist.request(`/api/uploads/${media.id}`, 'DELETE')).status, 200);
  assert.equal((await artist.request(media.url)).status, 404);
});

test('concurrent duplicate registrations preserve one account and server quotas are enforced', async t => {
  const app = await fixture(t, { maxStorageBytes: 1000 }), first = app.client(), second = app.client();
  const registration = { name: 'Same Artist', email: 'same@example.invalid', role: 'artist', password: 'preview123' };
  const responses = await Promise.all([first.rpc('register', registration), second.rpc('register', registration)]);
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
  const owner = responses[0].status === 200 ? first : second;
  assert.equal((await owner.upload()).status, 413);
  assert.equal((await (await owner.request('/api/uploads')).json()).length, 0);
});

test('social permissions, idempotent stars, private saves, comment moderation and restart persistence', async t => {
  const app = await fixture(t), owner = app.client(), investor = app.client(), stranger = app.client(), guest = app.client();
  await owner.register('SocialOwner'); await investor.register('SocialInvestor', 'investor'); await stranger.register('Stranger', 'investor');
  const media = await (await owner.upload()).json();
  const post = await (await owner.request('/api/publications', 'POST', postInput(media, { status: 'published' }))).json();
  const path = `/api/publications/${post.id}`;
  assert.equal((await guest.request(`${path}/star`, 'PUT', { enabled: true })).status, 401);
  assert.equal((await guest.request('/api/saved')).status, 401);
  for (let i = 0; i < 3; i++) assert.equal((await investor.request(`${path}/star`, 'PUT', { enabled: true })).status, 200);
  await owner.request(`${path}/star`, 'PUT', { enabled: true });
  await investor.request(`${path}/save`, 'PUT', { enabled: true });
  assert.deepEqual((await (await guest.request(path)).json()).social, { stars: 2, comments: 0, starred: false, saved: false });
  assert.equal((await (await stranger.request('/api/saved?account=2')).json()).items.length, 0);
  assert.equal((await investor.request(`${path}/star`, 'PUT', { enabled: 'yes' })).status, 400);
  assert.equal((await investor.request(`${path}/star`, 'PUT', { enabled: true }, { Origin: 'https://evil.invalid' })).status, 403);
  assert.equal((await investor.request(`${path}/comments`, 'POST', { text: '   ' })).status, 400);
  assert.equal((await investor.request(`${path}/comments`, 'POST', { text: 'x'.repeat(501) })).status, 400);
  const comment = await (await investor.request(`${path}/comments`, 'POST', { text: '<script>literal text</script>' })).json();
  const publicComments = await (await guest.request(`${path}/comments`)).json();
  assert.equal(publicComments.items[0].author, 'SocialInvestor');
  assert.equal(publicComments.items[0].canDelete, false);
  assert.equal(JSON.stringify(publicComments).includes('@'), false);
  assert.equal((await stranger.request(`${path}/comments/${comment.id}`, 'DELETE')).status, 404);
  await app.restart();
  assert.equal((await (await investor.request(path)).json()).social.starred, true);
  assert.equal((await (await investor.request('/api/saved')).json()).items[0].id, post.id);
  assert.equal((await owner.request(`${path}/comments/${comment.id}`, 'DELETE')).status, 200);
  const ownComment = await (await investor.request(`${path}/comments`, 'POST', { text: 'My comment' })).json();
  assert.equal((await investor.request(`${path}/comments/${ownComment.id}`, 'DELETE')).status, 200);
  await investor.request(`${path}/star`, 'PUT', { enabled: false });
  assert.equal((await (await guest.request(path)).json()).social.stars, 1);
  await owner.request(path, 'PATCH', { ...post, status: 'withdrawn' });
  assert.equal((await (await investor.request('/api/saved')).json()).items.length, 0);
  assert.equal((await investor.request(`${path}/comments`)).status, 404);
  assert.equal((await investor.request(`${path}/star`, 'PUT', { enabled: true })).status, 404);
  assert.equal((await investor.request(`${path}/save`, 'PUT', { enabled: false })).status, 200);
  const draft = await (await owner.request('/api/publications', 'POST', postInput(media))).json();
  assert.equal((await investor.request(`/api/publications/${draft.id}/comments`, 'POST', { text: 'No' })).status, 404);
});

test('feed snapshots keep order and pagination stable while counts update and withdrawal takes effect', async t => {
  const app = await fixture(t), owner = app.client(), investor = app.client(), guest = app.client();
  await owner.register('FeedArtist'); await investor.register('FeedInvestor', 'investor');
  const media = await (await owner.upload()).json(), posts = [];
  for (let i = 0; i < 24; i++) posts.push(await (await owner.request('/api/publications', 'POST', postInput(media, { status: 'published', title: `Sound ${i}` }))).json());
  const feed = await (await guest.request('/api/feed')).json();
  assert.equal(feed.items.length, 20); assert.equal(feed.nextCursor, 20);
  const last = posts[0]; await investor.request(`/api/publications/${last.id}/star`, 'PUT', { enabled: true });
  const stable = await (await guest.request(`/api/feed?snapshot=${feed.snapshot}`)).json();
  assert.deepEqual(stable.items.map(p => p.id), feed.items.map(p => p.id));
  const next = await (await guest.request(`/api/feed?snapshot=${feed.snapshot}&offset=20`)).json();
  assert.equal(new Set([...stable.items, ...next.items].map(p => p.id)).size, 24);
  const fresh = await (await guest.request('/api/feed')).json(); assert.equal(fresh.items[0].id, last.id);
  await owner.request(`/api/publications/${last.id}`, 'PATCH', { ...last, status: 'withdrawn' });
  const withdrawn = await (await guest.request(`/api/feed?snapshot=${fresh.snapshot}`)).json();
  assert.equal(withdrawn.items.some(p => p.id === last.id), false);
  assert.equal((await guest.request('/api/feed?snapshot=unknown')).status, 410);
  assert.equal((await guest.request('/api/feed?offset=-1')).status, 400);
});

test('server funding history remains USD, grouped publicly, private by account and durable after archive', async t => {
  const app = await fixture(t), owner = app.client(), investor = app.client(), stranger = app.client(), guest = app.client();
  await owner.register('HistoryArtist'); await investor.register('HistoryInvestor', 'investor'); await stranger.register('HistoryStranger', 'investor');
  const project = (await (await owner.rpc('createProject', { title: 'History EP', category: 'EP', goalAmount: 2000, status: 'funding' })).json()).result;
  const receipt = (await (await investor.rpc('createInvestment', { projectId: project.id, amount: 100.10 })).json()).result;
  await investor.rpc('createInvestment', { projectId: project.id, amount: 200.20 });
  const detail = (await (await guest.rpc('getProject', project.id)).json()).result;
  assert.equal(detail.project.currency, 'USD'); assert.equal(detail.project.raisedAmount, 300.30);
  assert.equal(detail.backers.length, 1); assert.equal(detail.backers[0].name, null); assert.equal(detail.backers[0].amount, null);
  assert.equal((await guest.rpc('listMyInvestments')).status, 401);
  assert.equal((await (await stranger.rpc('getInvestment', receipt.id)).json()).result, null);
  assert.equal((await investor.rpc('listReceivedInvestments')).status, 403);
  await investor.rpc('updateProjectVisibility', project.id, { showName: true, showAmount: true });
  const visible = (await (await guest.rpc('getProject', project.id)).json()).result;
  assert.equal(visible.backers[0].name, 'HistoryInvestor'); assert.equal(visible.backers[0].amount, 300.30);
  assert.equal((await stranger.rpc('deleteProject', project.id)).status, 403);
  await owner.rpc('deleteProject', project.id); await app.restart();
  assert.equal((await (await guest.rpc('getProject', project.id)).json()).result, null);
  const history = (await (await investor.rpc('listMyInvestments')).json()).result;
  assert.equal(history.length, 2); assert.equal(history[0].projectArchived, true);
  assert.equal((await (await owner.rpc('listReceivedInvestments')).json()).result.length, 2);
  assert.equal((await (await investor.rpc('getInvestment', receipt.id)).json()).result.amount, 100.10);
});

const offerInput = { need: 'Verse', deliverable: '16 bars and dry vocals', requirements: 'Original lyrics, one revision. Credit included.', deadline: null, compensation: { kind: 'split', percent: 15 }, status: 'open' };
test('collaboration lifecycle, immutable proposal terms, private messages/media, revisions and restart', async t => {
  const app = await fixture(t), owner = app.client(), applicant = app.client(), other = app.client(), investor = app.client(), guest = app.client();
  await owner.register('CollabOwner'); await applicant.register('CollabArtist'); await other.register('CollabOther'); await investor.register('CollabInvestor','investor');
  const project = (await (await owner.rpc('createProject', { title: 'Open EP', category: 'EP', goalAmount: 1000, status: 'published' })).json()).result;
  let offer = await (await owner.request(`/api/projects/${project.id}/offers`, 'POST', offerInput)).json();
  assert.equal(offer.available,true);
  assert.equal((await investor.request(`/api/offers/${offer.id}/conversations`, 'POST', {})).status,403);
  assert.equal((await owner.request(`/api/offers/${offer.id}/conversations`, 'POST', {})).status,400);
  const thread = await (await applicant.request(`/api/offers/${offer.id}/conversations`, 'POST', {})).json(), path = `/api/collaborations/${thread.id}`;
  assert.equal((await (await applicant.request(`/api/offers/${offer.id}/conversations`, 'POST', {})).json()).id,thread.id);
  assert.equal((await other.request(path)).status,404); assert.equal((await guest.request(path)).status,401);
  await applicant.request(`${path}/messages`, 'POST', { text: 'Can I send Spanish vocals?' });
  await owner.request(`${path}/messages`, 'POST', { text: 'Yes, please.' });
  const media = await (await applicant.upload()).json();
  assert.equal((await owner.request(media.url)).status,404);
  let current = await (await applicant.request(path)).json();
  assert.equal(current.messages.length,2);
  assert.equal((await applicant.request(path, 'PATCH', { action:'submit', revision:current.revision, offerRevision:offer.revision, acceptTerms:false, text:'My idea', mediaId:media.id })).status,400);
  current = await (await applicant.request(path, 'PATCH', { action:'submit', revision:current.revision, offerRevision:offer.revision, acceptTerms:true, text:'My idea', mediaId:media.id })).json();
  assert.equal(current.status,'submitted'); assert.equal((await owner.request(media.url)).status,200); assert.equal((await other.request(media.url)).status,404);
  assert.equal((await applicant.request(`/api/uploads/${media.id}`, 'DELETE')).status,409);
  assert.equal((await (await applicant.request('/api/uploads')).json()).some(m=>m.id===media.id),false);
  offer = await (await owner.request(`/api/offers/${offer.id}`, 'PATCH', { ...offer, compensation:{kind:'fee',amount:250.25,currency:'USD'} })).json();
  const saved = await (await applicant.request(path)).json(); assert.equal(saved.terms.compensation.percent,15); assert.equal(saved.currentOffer.compensation.amount,250.25);
  assert.equal((await applicant.request(path, 'PATCH', { action:'accept', revision:current.revision })).status,403);
  current = await (await owner.request(path, 'PATCH', { action:'request_changes', revision:current.revision, feedback:'Please add a second harmony.' })).json();
  assert.equal(current.status,'changes_requested');
  current = await (await applicant.request(path, 'PATCH', { action:'submit', revision:current.revision, offerRevision:offer.revision, acceptTerms:true, text:'Revised proposal', mediaId:media.id })).json();
  assert.equal(current.terms.compensation.amount,250.25);
  const second = await (await other.request(`/api/offers/${offer.id}/conversations`, 'POST', {})).json();
  current = await (await owner.request(path, 'PATCH', { action:'accept', revision:current.revision })).json(); assert.equal(current.status,'accepted');
  assert.equal((await (await other.request(`/api/collaborations/${second.id}`)).json()).status,'rejected');
  assert.equal((await (await guest.request(`/api/projects/${project.id}/offers`)).json()).length,0);
  const closed = (await (await owner.request(`/api/projects/${project.id}/offers`)).json())[0];
  assert.equal((await owner.request(`/api/offers/${offer.id}`, 'PATCH', { ...closed,status:'open' })).status,409);
  assert.equal((await applicant.request(path, 'PATCH', { action:'withdraw',revision:current.revision })).status,409);
  await owner.rpc('deleteProject',project.id); // Existing work and private conversations survive archive.
  current = await (await applicant.request(path, 'PATCH', { action:'deliver', revision:current.revision,text:'Final vocals',mediaId:media.id })).json(); assert.equal(current.status,'delivered');
  current = await (await owner.request(path, 'PATCH', { action:'request_changes',revision:current.revision,feedback:'Less reverb, please.' })).json(); assert.equal(current.status,'accepted');
  current = await (await applicant.request(path, 'PATCH', { action:'deliver',revision:current.revision,text:'Dry stems',mediaId:media.id })).json();
  current = await (await owner.request(path, 'PATCH', { action:'complete', revision:current.revision })).json(); assert.equal(current.status,'completed');
  await app.restart(); assert.equal((await (await applicant.request(path)).json()).status,'completed');
  assert.equal((await owner.request(`${path}/messages`, 'POST', {text:'Thank you!'})).status,201);
  const history = (await (await applicant.request(path)).json()).submissions;
  assert.equal(history.length,4);
  assert.equal(history.at(-1).terms.compensation.percent,15);
  assert.equal(history[0].terms.compensation.amount,250.25);
  const ownerAlerts = await (await owner.request('/api/notifications')).json();
  assert.deepEqual(ownerAlerts.items.map(item => item.kind).reverse(), ['contact','message','submit','submit','contact','deliver','deliver']);
  const applicantAlerts = await (await applicant.request('/api/notifications')).json();
  assert.deepEqual(applicantAlerts.items.map(item => item.kind).reverse(), ['message','offer_updated','request_changes','accept','request_changes','complete','message']);
  assert.equal(applicantAlerts.items.every(item => item.actorName === 'CollabOwner' && item.collaborationId === thread.id), true);
  const rejectedAlerts = await (await other.request('/api/notifications')).json();
  assert.equal(rejectedAlerts.items.length,1); assert.equal(rejectedAlerts.items[0].kind,'reject');
  assert.equal(rejectedAlerts.items[0].collaborationId,second.id);
});

test('offer visibility, USD validation, ownership and stale terms are enforced', async t => {
  const app = await fixture(t), owner = app.client(), applicant = app.client(), guest = app.client();
  await owner.register('TermsOwner'); await applicant.register('TermsApplicant');
  const project = (await (await owner.rpc('createProject',{title:'Draft collaboration',category:'EP',goalAmount:1000,status:'draft'})).json()).result;
  let offer = await (await owner.request(`/api/projects/${project.id}/offers`,'POST',offerInput)).json();
  assert.equal(offer.available,false); assert.equal((await guest.request(`/api/projects/${project.id}/offers`)).status,404);
  assert.equal((await applicant.request(`/api/offers/${offer.id}/conversations`,'POST',{})).status,409);
  assert.equal((await applicant.request(`/api/offers/${offer.id}`,'PATCH',offer)).status,404);
  assert.equal((await owner.request(`/api/projects/${project.id}/offers`,'POST',{...offerInput,compensation:{kind:'fee',amount:100,currency:'MXN'}})).status,400);
  assert.equal((await owner.request(`/api/projects/${project.id}/offers`,'POST',{...offerInput,compensation:{kind:'split',percent:101}})).status,400);
  assert.equal((await owner.request(`/api/projects/${project.id}/offers`,'POST',{...offerInput,deadline:'2026-02-30'})).status,400);
  await owner.rpc('updateProject',project.id,{status:'published'});
  const thread = await (await applicant.request(`/api/offers/${offer.id}/conversations`,'POST',{})).json();
  const path=`/api/collaborations/${thread.id}`, media=await (await applicant.upload()).json();
  offer=await (await owner.request(`/api/offers/${offer.id}`,'PATCH',{...offer,requirements:'New terms'})).json();
  assert.equal((await applicant.request(path,'PATCH',{action:'submit',revision:thread.revision,offerRevision:1,acceptTerms:true,text:'My proposal',mediaId:media.id})).status,409);
  assert.equal((await applicant.request(path,'PATCH',{action:'submit',revision:thread.revision,offerRevision:offer.revision,acceptTerms:true,text:'My proposal',mediaId:media.id})).status,200);
  assert.equal((await owner.request(path,'PATCH',{action:'accept',revision:1})).status,409);
  assert.equal((await guest.request('/api/collaborations')).status,401);
  assert.equal((await applicant.request(`${path}/messages`,'POST',{text:' '})).status,400);
});

test('notifications are private, paginated, durable and preserve arrivals after mark-all snapshot', async t => {
  const app = await fixture(t), owner = app.client(), applicant = app.client(), other = app.client(), investor = app.client(), guest = app.client();
  await owner.register('NoticeOwner'); await applicant.register('NoticeApplicant'); await other.register('NoticeOther'); await investor.register('NoticeInvestor','investor');
  for (const path of ['/api/notifications', '/api/notifications/summary']) {
    assert.equal((await guest.request(path)).status,401);
    assert.equal((await investor.request(path)).status,403);
  }
  assert.equal((await guest.request('/api/notifications/read','PATCH',{id:1})).status,401);
  assert.equal((await investor.request('/api/notifications/read','PATCH',{id:1})).status,403);
  assert.deepEqual(await (await owner.request('/api/notifications/summary')).json(),{unreadCount:0,latestId:null});
  const project = (await (await owner.rpc('createProject',{title:'Notice EP',category:'EP',goalAmount:1000,status:'published'})).json()).result;
  const offer = await (await owner.request(`/api/projects/${project.id}/offers`,'POST',offerInput)).json();
  const thread = await (await applicant.request(`/api/offers/${offer.id}/conversations`,'POST',{})).json(), path=`/api/collaborations/${thread.id}`;
  await applicant.request(`/api/offers/${offer.id}/conversations`,'POST',{});
  assert.equal((await (await owner.request('/api/notifications/summary')).json()).unreadCount,1); // Existing conversation does not notify twice.
  assert.equal((await (await applicant.request('/api/notifications/summary')).json()).unreadCount,0); // No self-notification.
  for (let i=0;i<35;i++) assert.equal((await applicant.request(`${path}/messages`,'POST',{text:`Private message ${i}`})).status,201);
  const first = await (await owner.request('/api/notifications')).json();
  assert.equal(first.items.length,30); assert.equal(first.unreadCount,36);
  assert.equal(JSON.stringify(first).includes('Private message'),false); // Inbox does not copy message contents.
  const earlier = await (await owner.request(`/api/notifications?before=${first.nextCursor}`)).json();
  assert.equal(earlier.items.length,6); assert.equal(earlier.nextCursor,null);
  assert.equal(new Set([...first.items,...earlier.items].map(item=>item.id)).size,36);
  assert.equal((await (await other.request('/api/notifications')).json()).items.length,0);
  assert.equal((await other.request('/api/notifications/read','PATCH',{id:first.latestId})).status,404);
  assert.equal((await other.request('/api/notifications/read','PATCH',{throughId:first.latestId})).status,404);
  assert.equal((await owner.request('/api/notifications/read','PATCH',{id:first.latestId},{Origin:'https://attacker.invalid'})).status,403);
  assert.equal((await owner.request('/api/notifications/read','PATCH',{id:first.latestId,throughId:first.latestId})).status,400);
  assert.equal((await owner.request('/api/notifications/read','PATCH',{throughId:-1})).status,400);
  assert.equal((await owner.request('/api/notifications?before=invalid')).status,400);
  for (let i=0;i<2;i++) assert.equal((await (await owner.request('/api/notifications/read','PATCH',{id:first.latestId})).json()).unreadCount,35);
  const readAt = (await (await owner.request('/api/notifications')).json()).items[0].readAt;
  assert.equal(typeof readAt,'string');
  await applicant.request(`${path}/messages`,'POST',{text:'Arrived after the inbox snapshot'});
  assert.equal((await (await owner.request('/api/notifications/read','PATCH',{throughId:first.latestId})).json()).unreadCount,1);
  await app.restart();
  const restored = await (await owner.request('/api/notifications')).json();
  assert.equal(restored.unreadCount,1); assert.equal(restored.items[0].readAt,null); assert.equal(restored.items[1].readAt,readAt);
  await owner.rpc('logout');
  assert.equal((await owner.request('/api/notifications')).status,401);
  await owner.rpc('login',{email:'NoticeOwner@example.invalid',password:'preview123'});
  assert.equal((await (await owner.request('/api/notifications/summary')).json()).unreadCount,1);
  assert.equal((await owner.request(`/api/offers/${offer.id}`,'PATCH',{revision:offer.revision,action:'close'})).status,200);
  assert.equal((await (await applicant.request('/api/notifications')).json()).items[0].kind,'offer_closed');
  assert.equal((await applicant.request(path,'PATCH',{revision:thread.revision,action:'withdraw'})).status,200);
  assert.equal((await (await owner.request('/api/notifications')).json()).items[0].kind,'withdraw');
  const beforeFailure = await (await owner.request('/api/notifications/summary')).json();
  assert.equal((await applicant.request(path,'PATCH',{revision:thread.revision,action:'withdraw'})).status,409);
  assert.deepEqual(await (await owner.request('/api/notifications/summary')).json(),beforeFailure);
});

const remixSettings = original => ({ contributionKind: original.media.kind, sourceId: original.id, sourceRevision: original.revision, startSeconds: 1, endSeconds: 5, baseGain: .5, voiceGain: .5, voiceOffset: 0 });
test('audio remixes enforce current permission and immutable credit without exposing withdrawn originals', async t => {
  const app = await fixture(t), owner = app.client(), artist = app.client(), guest = app.client(), investor = app.client();
  await owner.register('RemixOriginal'); await artist.register('RemixArtist'); await investor.register('RemixInvestor','investor');
  const base = await (await owner.upload()).json(), mixed = await (await artist.upload()).json(), replacement = await (await artist.upload()).json();
  let original = await (await owner.request('/api/publications','POST',postInput(base,{title:'Original sound',status:'published',allowRemix:true}))).json();
  const input = postInput(mixed,{title:'Remixed sound',remix:{...remixSettings(original),artistName:'Forged credit',title:'Fake original'}});
  assert.equal((await investor.request('/api/publications','POST',input)).status,403);
  assert.equal((await artist.request('/api/publications','POST',{...input,mediaId:base.id})).status,400);
  assert.equal((await artist.request('/api/publications','POST',{...input,remix:{...input.remix,sourceRevision:999}})).status,409);
  assert.equal((await artist.request('/api/publications','POST',{...input,remix:{...input.remix,endSeconds:100}})).status,400);
  assert.equal((await artist.request('/api/publications','POST',{...input,remix:{...input.remix,endSeconds:1.01}})).status,400);
  assert.equal((await artist.request('/api/publications','POST',{...input,remix:{...input.remix,baseGain:0}})).status,400);
  const draft = await (await artist.request('/api/publications','POST',input)).json();
  assert.equal(draft.remix.artistName,'RemixOriginal'); assert.equal(draft.remix.title,'Original sound');
  assert.equal(JSON.stringify(draft).includes('sourceMediaId'),false);
  assert.equal((await guest.request(`/api/publications/${draft.id}`)).status,404);
  let published = await (await artist.request('/api/publications','POST',{...input,status:'published'})).json();
  assert.equal((await artist.request('/api/publications','POST',{...input,remix:remixSettings(published)})).status,409);
  assert.equal((await artist.request(`/api/publications/${published.id}`,'PATCH',{...published,remix:null})).status,400);
  assert.equal((await artist.request(`/api/publications/${published.id}`,'PATCH',{...published,remix:{...published.remix,sourceId:999}})).status,400);
  assert.equal((await artist.request(`/api/publications/${published.id}`,'PATCH',{...published,mediaId:replacement.id})).status,400);
  assert.equal((await artist.request(`/api/publications/${published.id}`,'PATCH',{...published,allowRemix:true})).status,400);
  original = await (await owner.request(`/api/publications/${original.id}`,'PATCH',{...original,allowRemix:false})).json();
  assert.equal((await artist.request('/api/publications','POST',{...input,remix:remixSettings(original)})).status,409);
  assert.equal((await artist.request(`/api/publications/${draft.id}`,'PATCH',{...draft,status:'published'})).status,409);
  published = await (await artist.request(`/api/publications/${published.id}`,'PATCH',{...published,title:'Renamed remix'})).json();
  assert.equal(published.status,'published'); assert.equal(published.remix.title,'Original sound');
  original = await (await owner.request(`/api/publications/${original.id}`,'PATCH',{...original,status:'withdrawn',title:'Private changed title'})).json();
  assert.equal((await guest.request(base.url)).status,404);
  const visible = await (await guest.request(`/api/publications/${published.id}`)).json();
  assert.equal(visible.remix.available,false); assert.equal(visible.remix.title,'Original sound'); assert.equal((await guest.request(mixed.url)).status,200);
  await app.restart();
  assert.equal((await (await guest.request(`/api/publications/${published.id}`)).json()).remix.artistName,'RemixOriginal');
  published = await (await artist.request(`/api/publications/${published.id}`,'PATCH',{...published,status:'withdrawn'})).json();
  assert.equal((await artist.request(`/api/publications/${published.id}`,'PATCH',{...published,status:'published'})).status,409);
  original = await (await owner.request(`/api/publications/${original.id}`,'PATCH',{...original,status:'published',allowRemix:true})).json();
  const newBase = await (await owner.upload()).json();
  await owner.request(`/api/publications/${original.id}`,'PATCH',{...original,mediaId:newBase.id});
  assert.equal((await artist.request(`/api/publications/${draft.id}`,'PATCH',{...draft,status:'published'})).status,409);
});

test('a private saved remix becomes a separately reviewed proposal with durable attribution', async t => {
  const app = await fixture(t), owner = app.client(), artist = app.client(), outsider = app.client();
  await owner.register('RemixProjectOwner'); await artist.register('RemixApplicant'); await outsider.register('RemixOutsider');
  const project = (await (await owner.rpc('createProject',{title:'Remix project',category:'EP',goalAmount:1000,status:'published'})).json()).result;
  const offer = await (await owner.request(`/api/projects/${project.id}/offers`,'POST',offerInput)).json();
  const base = await (await owner.upload()).json(), mixed = await (await artist.upload()).json();
  const original = await (await owner.request('/api/publications','POST',postInput(base,{status:'published',allowRemix:true,projectId:project.id}))).json();
  let remix = await (await artist.request('/api/publications','POST',postInput(mixed,{title:'My saved remix',remix:remixSettings(original)}))).json();
  assert.equal((await owner.request(mixed.url)).status,404);
  assert.equal((await (await owner.request('/api/collaborations')).json()).items.length,0); // Remix is not an application.
  const thread = await (await artist.request(`/api/offers/${offer.id}/conversations`,'POST',{})).json();
  const input = {action:'submit',revision:thread.revision,offerRevision:offer.revision,acceptTerms:true,text:'My interpretation',mediaId:mixed.id,publicationId:remix.id};
  assert.equal((await outsider.request(`/api/collaborations/${thread.id}`,'PATCH',input)).status,404);
  assert.equal((await artist.request(`/api/collaborations/${thread.id}`,'PATCH',{...input,publicationId:original.id})).status,400);
  assert.equal((await artist.request(`/api/collaborations/${thread.id}`,'PATCH',input)).status,200);
  const detail = await (await owner.request(`/api/collaborations/${thread.id}`)).json();
  assert.equal(detail.status,'submitted'); assert.equal(detail.submissions[0].remix.title,'My saved remix');
  assert.equal(detail.submissions[0].remix.originalArtist,'RemixProjectOwner');
  assert.equal((await owner.request(mixed.url)).status,200); assert.equal((await outsider.request(mixed.url)).status,404);
  assert.equal((await owner.request(`/api/publications/${remix.id}`)).status,404); // Submission access does not expose a draft post.
  remix = await (await artist.request(`/api/publications/${remix.id}`,'PATCH',{...remix,title:'Later title'})).json();
  await app.restart();
  assert.equal((await (await owner.request(`/api/collaborations/${thread.id}`)).json()).submissions[0].remix.title,'My saved remix');
});

test('multi-file work preserves every revision, downloads names and keeps all attachments private across restart', async t => {
  const app = await fixture(t), owner = app.client(), artist = app.client(), outsider = app.client(), guest = app.client();
  await owner.register('PackageOwner'); await artist.register('PackageArtist'); await outsider.register('PackageOutsider');
  const project = (await (await owner.rpc('createProject',{title:'Package project',category:'EP',goalAmount:1000,status:'published'})).json()).result;
  const offer = await (await owner.request(`/api/projects/${project.id}/offers`,'POST',offerInput)).json();
  const thread = await (await artist.request(`/api/offers/${offer.id}/conversations`,'POST',{})).json(), path = `/api/collaborations/${thread.id}`;
  const upload = async (bytes, kind, name) => {
    const response = await artist.request('/api/uploads','POST',bytes,{'X-Media-Kind':kind,'X-File-Name':encodeURIComponent(name)}); assert.equal(response.status,201, await response.clone().text()); return response.json();
  };
  const vocal = await upload(audio,'audio','Voz principal.wav'), instrumental = await upload(audio,'audio','Instrumental.wav');
  const pdf = await upload(Buffer.from('%PDF-1.7\nA small test document\n%%EOF'),'document','../Créditos.pdf');
  const zip = await upload(Buffer.concat([Buffer.from([80,75,5,6]),Buffer.alloc(18)]),'archive','Stems.zip');
  const foreign = await (await outsider.upload()).json();
  assert.equal(pdf.name,'Créditos.pdf');
  const unicode = await upload(audio,'audio',`${'a'.repeat(179)}🎶.wav`);
  assert.equal((await artist.request(`${unicode.url}?download=1`)).status,200);
  assert.equal((await artist.request(`/api/uploads/${unicode.id}`,'DELETE')).status,200);
  assert.equal((await artist.request('/api/publications','POST',postInput(pdf))).status,400);
  assert.equal((await artist.upload(Buffer.from('<html>fake pdf file</html>'),'document')).status,415);
  for (const file of [vocal,instrumental,pdf,zip]) assert.equal((await owner.request(file.url)).status,404);
  const input = { action:'submit',revision:thread.revision,offerRevision:offer.revision,acceptTerms:true,text:'Full proposal package',mediaId:vocal.id,mediaIds:[vocal.id,instrumental.id,pdf.id,zip.id] };
  for (const files of [[],Array(11).fill(vocal.id),[vocal.id,vocal.id],[vocal.id,foreign.id]]) assert.equal((await artist.request(path,'PATCH',{...input,mediaIds:files})).status,400);
  assert.equal((await artist.request(path,'PATCH',{...input,mediaId:foreign.id})).status,400);
  assert.equal((await outsider.request(path,'PATCH',input)).status,404);
  let result = await artist.request(path,'PATCH',input); assert.equal(result.status,200,await result.clone().text());
  let row = await result.json();
  const detail = await (await owner.request(path)).json(); assert.deepEqual(detail.submissions[0].files.map(file=>file.id),input.mediaIds);
  for (const file of [vocal,instrumental,pdf,zip]) {
    assert.equal((await owner.request(file.url)).status,200);
    assert.equal((await guest.request(file.url)).status,404); assert.equal((await outsider.request(file.url)).status,404);
    assert.equal((await artist.request(`/api/uploads/${file.id}`,'DELETE')).status,409);
  }
  const download = await owner.request(pdf.url); assert.match(download.headers.get('content-disposition'),/^attachment;/); assert.match(download.headers.get('content-disposition'),/Cr%C3%A9ditos.pdf/); assert.equal(download.headers.get('content-type'),'application/pdf');
  assert.match((await owner.request(`${vocal.url}?download=1`)).headers.get('content-disposition'),/attachment/);
  assert.equal((await (await artist.request('/api/uploads')).json()).length,0);
  row = await (await owner.request(path,'PATCH',{action:'accept',revision:row.revision})).json();
  const final = await upload(audio,'audio','Final.wav');
  row = await (await artist.request(path,'PATCH',{action:'deliver',revision:row.revision,text:'Final stems and credits',mediaIds:[final.id,pdf.id,zip.id]})).json();
  assert.equal(row.status,'delivered');
  await app.restart();
  const restored = await (await owner.request(path)).json(); assert.equal(restored.submissions.length,2);
  assert.equal(restored.submissions[0].files[0].name,'Final.wav'); assert.equal(restored.submissions[1].files.length,4);
  assert.equal((await owner.request(zip.url)).status,200); assert.equal((await guest.request(zip.url)).status,404);
  assert.equal((await owner.request(path,'PATCH',{action:'complete',revision:row.revision})).status,200);
});

test('video originals and video remixes share permission, attribution and publication protections', async t => {
  const app = await fixture(t), owner = app.client(), artist = app.client(), guest = app.client();
  await owner.register('VideoOriginal'); await artist.register('VideoRemixer');
  const bytes = await readFile(new URL('../artifacts/nebula/public/discovery-demo/after-hours.webm',import.meta.url));
  const originalMedia = await (await owner.upload(bytes,'video')).json(), mixed = await (await artist.upload(bytes,'video')).json();
  let original = await (await owner.request('/api/publications','POST',postInput(originalMedia,{status:'published',allowRemix:true}))).json();
  const input = postInput(mixed,{remix:remixSettings(original)});
  let response = await artist.request('/api/publications','POST',input); assert.equal(response.status,201,await response.clone().text());
  const draft = await response.json(); assert.equal(draft.media.kind,'video'); assert.equal(draft.remix.artistName,'VideoOriginal');
  assert.equal((await guest.request(mixed.url)).status,404);
  response = await artist.request('/api/publications','POST',{...input,status:'published'}); assert.equal(response.status,201); const published = await response.json();
  original = await (await owner.request(`/api/publications/${original.id}`,'PATCH',{...original,allowRemix:false})).json();
  assert.equal((await artist.request('/api/publications','POST',{...input,remix:remixSettings(original)})).status,409);
  assert.equal((await artist.request(`/api/publications/${draft.id}`,'PATCH',{...draft,status:'published'})).status,409);
  assert.equal((await guest.request(`/api/publications/${published.id}`)).status,200);
  assert.equal((await artist.request(`/api/publications/${published.id}`,'PATCH',{...published,mediaId:originalMedia.id})).status,400);
  await app.restart(); assert.equal((await (await guest.request(`/api/publications/${published.id}`)).json()).remix.artistName,'VideoOriginal');
});

test('unified remix format matrix is enforced and historical remixes retain their original data', async t => {
  const app = await fixture(t), owner=app.client(), artist=app.client();
  await owner.register('UnifiedOwner');await artist.register('UnifiedArtist');
  const bytes=await readFile(new URL('../artifacts/nebula/public/discovery-demo/after-hours.webm',import.meta.url));
  const audioBase=await(await owner.upload()).json(),videoBase=await(await owner.upload(bytes,'video')).json();
  const audioOwn=await(await artist.upload()).json(),videoOwn=await(await artist.upload(bytes,'video')).json();
  const originals=[];
  for(const media of [audioBase,videoBase]) originals.push(await(await owner.request('/api/publications','POST',postInput(media,{status:'published',allowRemix:true}))).json());
  let legacy;
  for(const original of originals) for(const contributionKind of ['audio','video']) for(const result of [audioOwn,videoOwn]) {
    const response=await artist.request('/api/publications','POST',postInput(result,{remix:{...remixSettings(original),contributionKind}}));
    const allowed=!(original.media.kind==='video'&&contributionKind==='audio')&&result.kind===contributionKind;
    assert.equal(response.status,allowed?201:400,await response.clone().text());
    if(allowed){const saved=await response.json();assert.equal(saved.remix.contributionKind,contributionKind);if(original.media.kind==='video') legacy=saved;}
  }
  const missing={...remixSettings(originals[0])};delete missing.contributionKind;
  assert.equal((await artist.request('/api/publications','POST',postInput(audioOwn,{remix:missing}))).status,400);
  const db=new DatabaseSync(join(app.dataDir,'nebula.sqlite'));
  const row=db.prepare('SELECT data FROM posts WHERE id=?').get(legacy.id),previous=JSON.parse(row.data);
  delete previous.remix.contributionKind;previous.mediaId=audioOwn.id; // Existing audio-over-video draft from before the rule.
  db.prepare('UPDATE posts SET data=? WHERE id=?').run(JSON.stringify(previous),legacy.id);db.close();
  await app.restart();
  legacy=await(await artist.request(`/api/publications/${legacy.id}`)).json();
  assert.equal(legacy.remix.contributionKind,undefined);assert.equal(legacy.media.kind,'audio');
  const published=await artist.request(`/api/publications/${legacy.id}`,'PATCH',{...legacy,status:'published'});
  assert.equal(published.status,200,await published.clone().text());
  const saved=await published.json();assert.equal(saved.remix.contributionKind,undefined);assert.equal(saved.media.id,audioOwn.id);
  assert.equal((await artist.request(`/api/publications/${saved.id}`,'PATCH',{...saved,remix:{...saved.remix,contributionKind:'audio'}})).status,400);
  await app.restart();assert.equal((await(await artist.request(`/api/publications/${saved.id}`)).json()).media.id,audioOwn.id);
});

test('waveform API requires artist access and current original permission even after caching', async t => {
 const app=await fixture(t),owner=app.client(),artist=app.client(),investor=app.client(),guest=app.client();
 await owner.register('wave-owner');await artist.register('wave-artist');await investor.register('wave-investor','investor');
 const media=await(await owner.upload()).json();let post=await(await owner.request('/api/publications','POST',postInput(media,{status:'published',allowRemix:true}))).json();
 const route=`/api/publications/${post.id}/waveform`;
 assert.equal((await guest.request(route)).status,401);assert.equal((await investor.request(route)).status,403);
 const generated=await artist.request(route);assert.equal(generated.status,200);const wave=await generated.json();assert.equal(wave.mediaId,media.id);assert.equal(wave.hasAudio,true);assert.ok(wave.peaks.some(n=>n>0));
 await app.restart();assert.deepEqual(await(await artist.request(route)).json(),wave);
 post=await(await owner.request(`/api/publications/${post.id}`,'PATCH',{...post,allowRemix:false})).json();assert.equal((await artist.request(route)).status,404);
 post=await(await owner.request(`/api/publications/${post.id}`,'PATCH',{...post,allowRemix:true,status:'draft'})).json();assert.equal((await owner.request(route)).status,404);
 assert.equal((await guest.request(route)).status,401);
});
