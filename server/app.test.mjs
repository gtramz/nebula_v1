import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createNebulaServer } from '../dist-server/server/app.js';

const audio = await readFile(new URL('../artifacts/nebula/public/discovery-demo/soft-signal.wav', import.meta.url));
import { fixture } from './test-fixtures.mjs';

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
test('historical collaboration lifecycle, immutable proposal terms, private messages/media, revisions and restart', async t => {
  const app = await fixture(t), owner = app.client(), applicant = app.client(), other = app.client(), investor = app.client(), guest = app.client();
  await owner.register('CollabOwner'); await applicant.register('CollabArtist'); await other.register('CollabOther'); await investor.register('CollabInvestor','investor');
  const project = (await (await owner.rpc('createProject', { title: 'Open EP', category: 'EP', goalAmount: 1000, status: 'published' })).json()).result;
  let offer = await (await owner.request(`/api/projects/${project.id}/offers`, 'POST', offerInput)).json();
  assert.equal(offer.available,true);
  assert.equal((await investor.request(`/api/offers/${offer.id}/conversations`, 'POST', {})).status,403);
  assert.equal((await owner.request(`/api/offers/${offer.id}/conversations`, 'POST', {})).status,400);
  const thread = await (await applicant.legacyConversation(offer.id)).json(), path = `/api/collaborations/${thread.id}`;
  assert.equal((await (await applicant.legacyConversation(offer.id)).json()).id,thread.id);
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
  const second = await (await other.legacyConversation(offer.id)).json();
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
  assert.equal((await applicant.request(`/api/offers/${offer.id}/conversations`)).status,409);
  assert.equal((await applicant.request(`/api/offers/${offer.id}`,'PATCH',offer)).status,404);
  assert.equal((await owner.request(`/api/projects/${project.id}/offers`,'POST',{...offerInput,compensation:{kind:'fee',amount:100,currency:'MXN'}})).status,400);
  assert.equal((await owner.request(`/api/projects/${project.id}/offers`,'POST',{...offerInput,compensation:{kind:'split',percent:101}})).status,400);
  assert.equal((await owner.request(`/api/projects/${project.id}/offers`,'POST',{...offerInput,deadline:'2026-02-30'})).status,400);
  await owner.rpc('updateProject',project.id,{status:'published'});
  const thread = await (await applicant.legacyConversation(offer.id)).json();
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
  const thread = await (await applicant.legacyConversation(offer.id)).json(), path=`/api/collaborations/${thread.id}`;
  await applicant.legacyConversation(offer.id);
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
async function newDraft(artist, original, requestKey = crypto.randomUUID()) {
  const response = await artist.request('/api/remix-drafts','POST',{sourceId:original.id,sourceRevision:original.revision,requestKey});
  assert.equal(response.status,201,await response.clone().text()); return response.json();
}
async function privateUpload(artist,draft,bytes=audio,kind='audio') {
  const response=await artist.request('/api/uploads','POST',bytes,{'X-Remix-Draft':draft.id,'X-Media-Kind':kind,'Content-Type':'application/octet-stream'});
  assert.equal(response.status,201,await response.clone().text());return response.json();
}
const draftInput=(draft,contribution,render,extra={})=>({revision:draft.revision,title:draft.title,description:draft.description,settings:{...draft.settings,startSeconds:1,endSeconds:5,contributionKind:contribution.kind},contributionId:contribution.id,contributionDuration:8,renderId:render?.id??null,...extra});
test('private editable drafts enforce ownership, source revisions, media privacy, retry and conflict across restart',async t=>{
 const app=await fixture(t),owner=app.client(),artist=app.client(),other=app.client(),guest=app.client(),investor=app.client();
 await owner.register('DraftOriginal');await artist.register('DraftArtist');await other.register('DraftOther');await investor.register('DraftInvestor','investor');
 const base=await(await owner.upload()).json();let original=await(await owner.request('/api/publications','POST',postInput(base,{status:'published',allowRemix:true}))).json();
 const key=crypto.randomUUID(),create={sourceId:original.id,sourceRevision:original.revision,requestKey:key};
 assert.equal((await guest.request('/api/remix-drafts')).status,401);assert.equal((await investor.request('/api/remix-drafts','POST',create)).status,403);
 assert.equal((await artist.request('/api/remix-drafts','POST',{...create,sourceRevision:999})).status,409);
 let draft=await newDraft(artist,original,key);const path=`/api/remix-drafts/${draft.id}`;
 assert.match(draft.id,/^[a-f0-9-]{36}$/);assert.equal((await(await artist.request('/api/remix-drafts','POST',create)).json()).id,draft.id);
 assert.equal((await(await other.request('/api/remix-drafts')).json()).items.length,0);
 for(const c of [other,owner,guest,investor]) assert.equal((await c.request(path)).status,c===guest?401:c===investor?403:404);
 const own=await privateUpload(artist,draft),mix=await privateUpload(artist,draft),input=draftInput(draft,own,mix,{title:'Private interpretation'});
 assert.equal((await other.request(path,'PATCH',input)).status,404);
 assert.equal((await artist.request(path,'PATCH',{...input,settings:{...input.settings,sourceId:999}})).status,400);
 assert.equal((await artist.request(path,'PATCH',{...input,settings:{...input.settings,endSeconds:100}})).status,400);
 draft=await(await artist.request(path,'PATCH',input)).json();assert.equal(draft.revision,2);assert.equal(draft.attribution.artistName,'DraftOriginal');
 assert.equal((await artist.request(path,'PATCH',input)).status,409);
 for(const media of [own,mix]) {for(const c of [guest,other,owner]) assert.equal((await c.request(media.url)).status,404);assert.equal((await artist.request(media.url)).status,200);assert.equal((await artist.request(media.url+'?download=1')).status,200);assert.equal((await artist.request(`/api/uploads/${media.id}`,'DELETE')).status,409);assert.equal((await artist.request('/api/publications','POST',postInput(media,{status:'published'}))).status,400);}
 assert.equal((await(await artist.request('/api/publications?mine=1')).json()).items.length,0);assert.equal((await(await guest.request('/api/feed')).json()).items.length,1);
 assert.equal((await artist.request('/api/publications','POST',postInput(await(await artist.upload()).json(),{remix:remixSettings(original)}))).status,409);
 assert.equal((await artist.request(path,'PATCH',draftInput(draft,own,mix,{settings:{...draft.settings,baseGain:.3}}))).status,409);
 await app.restart();assert.deepEqual(await(await artist.request(path)).json(),draft);
 const read=await artist.request(`/remix/${original.id}`);assert.equal(read.status,200);assert.equal((await(await artist.request('/api/remix-drafts')).json()).items.length,1);
 original=await(await owner.request(`/api/publications/${original.id}`,'PATCH',{...original,allowRemix:false})).json();
 assert.equal((await artist.request(path,'PATCH',draftInput(draft,own,mix))).status,409);assert.equal((await artist.request(path,'PATCH',{revision:draft.revision,action:'prepare-render'})).status,409);
 assert.equal((await artist.request('/api/uploads','POST',audio,{'X-Remix-Draft':draft.id,'X-Media-Kind':'audio','Content-Type':'application/octet-stream'})).status,409);
 assert.equal((await artist.request(path)).status,200); // Saved work is retained for its owner.
 await artist.rpc('logout');assert.equal((await artist.request(path)).status,401);assert.equal((await artist.request(mix.url)).status,404);
});

test('a private rendered remix shares only its final output through a proposal with durable credit',async t=>{
 const app=await fixture(t),owner=app.client(),artist=app.client(),other=app.client();await owner.register('ProposalOwner');await artist.register('ProposalArtist');await other.register('ProposalOther');
 const project=(await(await owner.rpc('createProject',{title:'Private remix project',category:'EP',goalAmount:1000,status:'published'})).json()).result;
 const offer=await(await owner.request(`/api/projects/${project.id}/offers`,'POST',offerInput)).json();const base=await(await owner.upload()).json();
 const original=await(await owner.request('/api/publications','POST',postInput(base,{status:'published',allowRemix:true,projectId:project.id}))).json();
 let draft=await newDraft(artist,original);const own=await privateUpload(artist,draft),mix=await privateUpload(artist,draft);
 draft=await(await artist.request(`/api/remix-drafts/${draft.id}`,'PATCH',draftInput(draft,own,mix,{title:'My private remix'}))).json();
 const thread=await(await artist.legacyConversation(offer.id)).json(),path=`/api/collaborations/${thread.id}`;
 const input={action:'submit',revision:thread.revision,offerRevision:offer.revision,acceptTerms:true,text:'My interpretation',mediaId:mix.id,mediaIds:[mix.id],remixDraftId:draft.id};
 assert.equal((await owner.request(mix.url)).status,404);
 assert.equal((await artist.request(path,'PATCH',{...input,remixDraftId:null})).status,400);
 assert.equal((await artist.request(path,'PATCH',{...input,mediaIds:[mix.id,own.id]})).status,400);
 assert.equal((await other.request(path,'PATCH',input)).status,404);
 assert.equal((await artist.request(path,'PATCH',input)).status,200);
 assert.equal((await owner.request(mix.url)).status,200);assert.equal((await owner.request(own.url)).status,404);assert.equal((await other.request(mix.url)).status,404);
 assert.equal((await owner.request(`/api/remix-drafts/${draft.id}`)).status,404);
 await artist.request(`/api/remix-drafts/${draft.id}`,'PATCH',draftInput(draft,own,mix,{title:'Changed after submitting'}));await app.restart();
 const detail=await(await owner.request(path)).json();assert.equal(detail.submissions[0].remix.title,'My private remix');assert.equal(detail.submissions[0].remix.originalArtist,'ProposalOwner');
});

test('multi-file work preserves every revision, downloads names and keeps all attachments private across restart', async t => {
  const app = await fixture(t), owner = app.client(), artist = app.client(), outsider = app.client(), guest = app.client();
  await owner.register('PackageOwner'); await artist.register('PackageArtist'); await outsider.register('PackageOutsider');
  const project = (await (await owner.rpc('createProject',{title:'Package project',category:'EP',goalAmount:1000,status:'published'})).json()).result;
  const offer = await (await owner.request(`/api/projects/${project.id}/offers`,'POST',offerInput)).json();
  const thread = await (await artist.legacyConversation(offer.id)).json(), path = `/api/collaborations/${thread.id}`;
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

test('private remix format matrix rejects audio over video and mismatched results',async t=>{
 const app=await fixture(t),owner=app.client(),artist=app.client();await owner.register('MatrixOwner');await artist.register('MatrixArtist');
 const video=await readFile(new URL('../artifacts/nebula/public/discovery-demo/after-hours.webm',import.meta.url));
 for(const baseKind of ['audio','video']) {
  const base=await(await owner.upload(baseKind==='audio'?audio:video,baseKind)).json();const original=await(await owner.request('/api/publications','POST',postInput(base,{status:'published',allowRemix:true}))).json();
  for(const ownKind of ['audio','video']) for(const outputKind of ['audio','video']) {
   const draft=await newDraft(artist,original),own=await privateUpload(artist,draft,ownKind==='audio'?audio:video,ownKind),mix=await privateUpload(artist,draft,outputKind==='audio'?audio:video,outputKind);
   const response=await artist.request(`/api/remix-drafts/${draft.id}`,'PATCH',draftInput(draft,own,mix));const allowed=!(baseKind==='video'&&ownKind==='audio')&&ownKind===outputKind;
   assert.equal(response.status,allowed?200:400,await response.clone().text());
  }
 }
});

test('historical public and flattened draft remixes remain intact, without enabling new public release',async t=>{
 const app=await fixture(t),owner=app.client(),artist=app.client(),guest=app.client();await owner.register('HistoricalOwner');const identity=await artist.register('HistoricalArtist');
 const base=await(await owner.upload()).json(),mixed=await(await artist.upload()).json();let original=await(await owner.request('/api/publications','POST',postInput(base,{status:'published',allowRemix:true,title:'Historical source'}))).json();
 const db=new DatabaseSync(join(app.dataDir,'nebula.sqlite')),now=new Date().toISOString();
 const data=postInput(mixed,{status:'published',remix:{...remixSettings(original),sourceMediaId:base.id,artistId:original.artistId,artistName:'HistoricalOwner',title:original.title,projectId:null,grantedAt:now}});delete data.remix.contributionKind;
 const publicId=Number(db.prepare('INSERT INTO posts(owner,data,created,updated) VALUES(?,?,?,?)').run(identity.user.artistId,JSON.stringify(data),now,now).lastInsertRowid);
 const privateId=Number(db.prepare('INSERT INTO posts(owner,data,created,updated) VALUES(?,?,?,?)').run(identity.user.artistId,JSON.stringify({...data,status:'draft'}),now,now).lastInsertRowid);db.close();
 await app.restart();let saved=await(await artist.request(`/api/publications/${publicId}`)).json();assert.equal(saved.media.id,mixed.id);assert.equal(saved.remix.contributionKind,undefined);assert.equal((await guest.request(mixed.url)).status,200);
 assert.equal((await artist.request(`/api/publications/${publicId}`,'PATCH',{...saved,remix:{...saved.remix,sourceId:999}})).status,400);
 saved=await(await artist.request(`/api/publications/${publicId}`,'PATCH',{...saved,title:'Renamed'})).json();assert.equal(saved.status,'published');assert.equal(saved.remix.title,'Historical source');
 const privateSaved=await(await artist.request(`/api/publications/${privateId}`)).json();assert.equal((await artist.request(`/api/publications/${privateId}`,'PATCH',{...privateSaved,status:'published'})).status,409);
 original=await(await owner.request(`/api/publications/${original.id}`,'PATCH',{...original,status:'withdrawn'})).json();assert.equal((await guest.request(base.url)).status,404);
 assert.equal((await(await guest.request(`/api/publications/${publicId}`)).json()).remix.available,false);
 saved=await(await artist.request(`/api/publications/${publicId}`,'PATCH',{...saved,status:'withdrawn'})).json();assert.equal((await guest.request(mixed.url)).status,404);assert.equal((await artist.request(`/api/publications/${publicId}`,'PATCH',{...saved,status:'published'})).status,409);
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

test('Home aggregates public opportunities without duplicates, respects lifecycle and preserves the catalog', async t => {
  const app = await fixture(t), owner = app.client(), guest = app.client();
  await owner.register('home-owner');
  const create = async (title, status = 'published', category = 'EP') => (await (await owner.rpc('createProject', { title, category, goalAmount: 2000, status })).json()).result;
  const creative = await create('Creative EP'), funding = await create('Funding EP', 'funding');
  const plain = await create('Catalog only'), draft = await create('Private draft', 'draft'), closed = await create('Closed project', 'closed');
  const expired = await create('Expired call'), archived = await create('Archived project', 'funding');
  const add = async (project, input = offerInput) => (await (await owner.request(`/api/projects/${project.id}/offers`, 'POST', input)).json());
  const first = await add(creative), second = await add(creative, { ...offerInput, need: 'Mix', compensation: { kind: 'fee', amount: 125, currency: 'USD' } });
  await add(draft); await add(closed); const old = await add(expired); await add(archived);
  await owner.rpc('deleteProject', archived.id);
  // Expire the disposable fixture without depending on wall-clock waits.
  const db = new DatabaseSync(join(app.dataDir, 'nebula.sqlite'));
  db.prepare('UPDATE collaboration_offers SET data=? WHERE id=?').run(JSON.stringify({ ...offerInput, deadline: '2000-01-01' }), old.id); db.close();
  const get = async (client = guest, query = '') => (await (await client.request('/api/opportunities/projects' + query)).json());
  let page = await get(); assert.deepEqual(page.items.map(i => i.project.id), [funding.id, creative.id]);
  assert.equal(page.items[1].offers.length, 2); assert.equal(page.items[1].offers[0].compensation.amount, 125);
  assert.deepEqual(await get(owner), page, 'Owners must not see drafts or unavailable offers in Home');
  await owner.request(`/api/offers/${first.id}`, 'PATCH', { action: 'close', revision: first.revision });
  await owner.request(`/api/offers/${second.id}`, 'PATCH', { action: 'close', revision: second.revision });
  assert.deepEqual((await get()).items.map(i => i.project.id), [funding.id]);
  assert.equal((await guest.rpc('getProject', creative.id)).status, 200);
  assert.ok((await (await guest.rpc('listProjects')).json()).result.some(p => p.id === plain.id));
  await owner.rpc('updateProject', funding.id, { status: 'funded' });
  assert.deepEqual((await get()).items, []);
  for (let i = 0; i < 27; i++) await create(`Page ${i}`, 'funding', 'Album');
  page = await get(guest, '?category=album'); assert.equal(page.items.length, 24); assert.ok(page.nextCursor);
  const next = await get(guest, `?category=album&before=${page.nextCursor}`);
  assert.equal(next.items.length, 3); assert.equal(next.nextCursor, null);
  assert.equal(new Set([...page.items, ...next.items].map(i => i.project.id)).size, 27);
  assert.equal((await guest.request('/api/opportunities/projects?before=-1')).status, 400);
  assert.equal((await guest.request('/api/opportunities/projects', 'POST', {})).status, 405);
  await app.restart();
  const restartedPage = await get(guest, '?category=album');
  assert.equal(typeof restartedPage.nextPageCursor, 'string'); assert.ok(restartedPage.nextPageCursor.length > 0);
  // Opaque authenticated tokens deliberately change and expire on server restart;
  // compare every semantic response field and verify the replacement still pages.
  assert.deepEqual({ ...restartedPage, nextPageCursor: null }, { ...page, nextPageCursor: null });
  assert.equal((await guest.request('/api/opportunities/projects?category=album&cursor=' + encodeURIComponent(page.nextPageCursor))).status, 400);
  assert.deepEqual(await get(guest, '?category=album&cursor=' + encodeURIComponent(restartedPage.nextPageCursor)), next);
});

test('Home search and suggestions search before pagination, combine real fields and validate public scope', async t => {
  const app = await fixture(t), owner = app.client(), guest = app.client();
  await owner.register('ContextArtist');
  assert.equal((await owner.rpc('updateArtist', { name: 'ContextArtist', genre: 'Hip-hop', bio: '', basedIn: '', recordLabel: '', picture: null })).status, 200);
  const create = async (title, status = 'published', category = 'EP') => {
    const response = await owner.rpc('createProject', { title, category, pitch: 'Trap sessions', story: 'Analog textures', goalAmount: 3000, status });
    assert.equal(response.status,200); return (await response.json()).result;
  };
  const project = await create('Buried Context Project');
  const add = async (p, need, compensation) => {
    const response = await owner.request(`/api/projects/${p.id}/offers`, 'POST', { ...offerInput, need, deliverable: 'Custom stems', compensation });
    assert.equal(response.status,201); return response.json();
  };
  const production = await add(project, 'Production', {kind:'fee', amount:180, currency:'USD'});
  await add(project, 'Mix', {kind:'split', percent:10});
  const secret = await create('Secret Context Project', 'draft'); await add(secret, 'Production', {kind:'split',percent:15});
  for (let i=0; i<26; i++) await create(`New funding ${i}`, 'funding', 'Album');
  const get = async query => (await (await guest.request(`/api/opportunities/projects?${query}`)).json());
  assert.equal((await get('')).items.some(x=>x.project.id===project.id),false);
  for (const q of ['buried', 'ContextArtist', 'Hip-hop', 'producer', 'Custom stems', 'USD payment', 'royalty share', 'Analog']) {
    const result=await get(`q=${encodeURIComponent(q)}&category=ep`); assert.deepEqual(result.items.map(x=>x.project.id),[project.id]);
  }
  assert.equal((await get('need=Production&compensation=split')).items.length,0);
  assert.deepEqual((await get('need=Production&compensation=fee&genre=Hip-hop&q=trap&category=ep')).items.map(x=>x.project.id),[project.id]);
  assert.equal((await get('opportunity=funding')).items.length,24);
  const suggestions=async(q,client=guest)=>(await(await client.request(`/api/opportunities/suggestions?q=${q}`)).json()).items;
  assert.equal((await suggestions('Secret')).length,0); assert.equal((await suggestions('Secret',owner)).length,0);
  assert.deepEqual(await suggestions('Buried'),[{id:`project:${project.id}`, label:project.title,type:'Project',action:'navigate',href:`/project/${project.id}`}]);
  assert.ok((await suggestions('prod')).some(s=>s.value==='Production'));
  assert.ok((await suggestions('ContextArtist')).some(s=>s.href===`/artist/${project.artistId}`));
  assert.ok((await suggestions('Hip')).some(s=>s.type==='Artist genre'));
  for (const route of ['projects','suggestions']) {
    for (const query of ['need=Composer','compensation=MXN','projectType=nope','q='+ 'x'.repeat(201)]) assert.equal((await guest.request(`/api/opportunities/${route}?${query}`)).status,400);
    assert.equal((await guest.request(`/api/opportunities/${route}`,'POST',{})).status,405);
  }
  await owner.request(`/api/offers/${production.id}`, 'PATCH', {action:'close',revision:production.revision});
  assert.equal((await suggestions('prod')).length,0); assert.equal((await get('need=Production')).items.length,0);
  await app.restart(); assert.equal((await get('q=Buried')).items.length,1);
});

test('Project Browser facets, truthful modes and cursor pagination use existing records without writes', async t => {
  const app=await fixture(t), owner=app.client(), guest=app.client();await owner.register('BrowserArtist');
  await owner.rpc('updateArtist',{name:'BrowserArtist',genre:'Hip-hop',basedIn:'',bio:'',recordLabel:'',picture:null});
  const create=async(title,category,status='funding')=>(await(await owner.rpc('createProject',{title,category,goalAmount:2000,status,pitch:'Browser fixture'})).json()).result;
  const projects=[];for(let i=0;i<27;i++) projects.push(await create(`Browser ${i}`,i%2?'EP':'Album'));
  const multi=projects[0], fee={kind:'fee',amount:300,currency:'USD'}, split={kind:'split',percent:15};
  for(const [need,compensation] of [['Production',fee],['Mix',split]]) assert.equal((await owner.request(`/api/projects/${multi.id}/offers`,'POST',{...offerInput,need,compensation})).status,201);
  const draft=await create('Invisible browser','Secret category','draft');
  const db=new DatabaseSync(join(app.dataDir,'nebula.sqlite'));const state=JSON.parse(db.prepare('SELECT value FROM state WHERE id=1').get().value);
  // Deliberately separate ID order from creation-date order, only in disposable fixtures.
  for(const [i,p] of state.projects.entries()) p.createdAt=new Date(Date.UTC(2025,0,28-i)).toISOString();
  state.projects.find(p=>p.id===projects[1].id).createdAt=state.projects.find(p=>p.id===multi.id).createdAt;
  db.prepare('UPDATE state SET value=? WHERE id=1').run(JSON.stringify(state));const before=db.prepare('SELECT value FROM state WHERE id=1').get().value;
  const get=async(q)=>(await(await guest.request('/api/opportunities/projects?'+q)).json());
  const general=await get(''),recent=await get('mode=recent');
  assert.equal(general.items[0].project.id,projects[26].id);assert.equal(recent.items[0].project.id,projects[1].id);assert.equal(recent.items[1].project.id,multi.id);
  const next=await get('mode=recent&cursor='+encodeURIComponent(recent.nextPageCursor));assert.equal(next.items.length,3);
  assert.equal(new Set([...recent.items,...next.items].map(i=>i.project.id)).size,27);
  assert.ok(recent.facets.artistGenres.includes('Hip-hop'));assert.equal(recent.facets.projectTypes.includes('secret category'),false);
  const match=await get('projectTypes=ep&projectTypes=album&artistGenres=Rock&artistGenres=Hip-hop&participation=Production&participation=Mix&compensationKinds=fee&compensationKinds=split&q=Browser');
  assert.deepEqual(match.items.map(i=>i.project.id),[multi.id]);
  assert.equal((await get('participation=Production&compensationKinds=split')).items.length,0);
  assert.equal((await get('participation=Funding&compensationKinds=fee')).items.length,0);
  assert.equal((await get('participation=Mix&participation=Funding')).items.length,24);
  for(const q of ['mode=unknown','compensationKinds=combined','compensationKinds=negotiable','participation=Songwriter','mode=recent&before=5','cursor=invalid','cursor='+encodeURIComponent(recent.nextPageCursor),'mode=recent&q=changed&cursor='+encodeURIComponent(recent.nextPageCursor)]) assert.equal((await guest.request('/api/opportunities/projects?'+q)).status,400);
  assert.equal((await get('before='+general.nextCursor)).items.length,3,'legacy cursor remains functional');
  const suggestions=await(await guest.request('/api/opportunities/suggestions?q=roy&participation=Production&compensationKinds=fee')).json();assert.deepEqual(suggestions.items,[]);
  assert.equal(db.prepare('SELECT value FROM state WHERE id=1').get().value,before);db.close();
});

test('artist identity additions preserve legacy accounts, related data and sessions across restart', async t => {
  const app = await fixture(t), owner = app.client(), applicant = app.client(), investor = app.client(), guest = app.client();
  const ownerId = (await owner.register('IdentityOwner')).user.artistId;
  await applicant.register('IdentityApplicant'); const investmentAccount = await investor.register('IdentityInvestor', 'investor');
  await owner.rpc('updateArtist', { name: 'IdentityOwner', genre: 'Hip-hop / R&B', bio: 'Original bio', basedIn: 'CDMX' });
  const project = (await (await owner.rpc('createProject', { title: 'Identity test project', category: 'EP', goalAmount: 1000, status: 'funding' })).json()).result;
  await investor.rpc('createInvestment', { projectId: project.id, amount: 100 });
  const media = await (await owner.upload()).json();
  const post = await (await owner.request('/api/publications', 'POST', postInput(media, { projectId: project.id, status: 'published', allowRemix: true }))).json();
  const offerResponse = await owner.request(`/api/projects/${project.id}/offers`, 'POST', { need: 'Production', deliverable: 'A track', requirements: '', deadline: null, compensation: { kind: 'fee', amount: 100, currency: 'USD' }, status: 'open' });
  assert.equal(offerResponse.status, 201); const offer = await offerResponse.json();
  const contact = await applicant.legacyConversation(offer.id);
  assert.equal(contact.status, 200); const thread = await contact.json();
  function snapshot() {
    const db = new DatabaseSync(join(app.dataDir, 'nebula.sqlite'));
    const state = JSON.parse(db.prepare('SELECT value FROM state WHERE id=1').get().value);
    const tables = {};
    for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT IN ('state','sessions','rate_limits') ORDER BY name").all()) tables[name] = db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all();
    db.close(); return { state, tables };
  }
  const before = snapshot();
  assert.equal(before.state.artists.find(a => a.id === ownerId).creativeRoles, undefined);
  const legacy = (await (await guest.rpc('getArtist', ownerId)).json()).result.artist;
  assert.deepEqual(legacy.genres, ['Hip-hop / R&B']); assert.deepEqual(legacy.creativeRoles, []);
  assert.deepEqual(snapshot().state, before.state); // Projection is read-only.
  const professional = await owner.rpc('updateArtist', { name: 'IdentityOwner', creativeRoles: ['producer','rapper','mixing-engineer','producer'], genres: [' Jazz ', 'jazz', 'Soul'], collaborationAvailability: 'limited' });
  assert.equal(professional.status, 200); const identity = (await professional.json()).result;
  assert.equal(identity.genre, 'Hip-hop / R&B'); assert.equal(identity.bio, 'Original bio');
  assert.deepEqual(identity.creativeRoles, ['producer','rapper','mixing-engineer']); assert.deepEqual(identity.genres, ['Jazz','Soul']);
  const preferences = { collaboration: { opportunityTypes: ['Feature','Production'], creativeRoles: ['rapper','producer'], compensationKinds: ['fee','split'] }, discovery: { genres: ['PRIVATE_PREFERENCE_MARKER'], projectTypes: ['ep','single'], opportunityTypes: ['Production','Funding'] } };
  assert.equal((await owner.rpc('updateMyArtistPreferences', preferences)).status, 200);
  // The old UI submits only legacy fields. Structured fields must survive.
  assert.equal((await owner.rpc('updateArtist', { name: 'IdentityOwner Edited', genre: 'Old editor changed genre', bio: 'Edited bio', basedIn: 'CDMX', picture: null, recordLabel: '' })).status, 200);
  const after = snapshot();
  assert.deepEqual(after.tables, before.tables);
  for (const field of ['projects','investments','supports','visibility']) assert.deepEqual(after.state[field], before.state[field]);
  assert.deepEqual(after.state.accounts.find(a => a.id === investmentAccount.user.investorId), before.state.accounts.find(a => a.id === investmentAccount.user.investorId));
  assert.deepEqual(after.state.artists.filter(a => a.id !== ownerId), before.state.artists.filter(a => a.id !== ownerId));
  await app.restart();
  const session = await (await owner.request('/api/session')).json();
  assert.equal(session.user.artistId, ownerId); assert.equal(session.user.role, 'artist');
  assert.deepEqual(session.user.artist.creativeRoles, identity.creativeRoles);
  assert.deepEqual((await (await owner.rpc('getMyArtistPreferences')).json()).result, preferences);
  assert.equal((await applicant.request(`/api/collaborations/${thread.id}`)).status, 200);
  assert.equal((await applicant.rpc('updateProject', project.id, { title: 'No access' })).status, 404);
  for (const client of [guest, investor, applicant, owner]) {
    for (const response of [await client.rpc('getArtist', ownerId), await client.rpc('listArtists'), await client.rpc('getProject', project.id), await client.request('/api/publications'), await client.request(`/api/publications/${post.id}`), await client.request('/api/opportunities/projects'), await client.request('/api/opportunities/suggestions?q=Identity'), await client.request('/api/session')]) {
      assert.equal(response.status, 200); const text = await response.text();
      assert.equal(text.includes('PRIVATE_PREFERENCE_MARKER'), false); assert.equal(text.includes('artistPreferences'), false);
    }
  }
  const secondBrowser = app.client();
  assert.equal((await secondBrowser.rpc('login', { email: 'identityowner@example.invalid', password: 'preview123' })).status, 200);
  assert.deepEqual((await (await secondBrowser.rpc('getMyArtistPreferences')).json()).result, preferences);
});

test('private preference operations enforce ownership, roles, CSRF and strict validation', async t => {
  const app = await fixture(t), owner = app.client(), other = app.client(), investor = app.client(), guest = app.client();
  const ownerId = (await owner.register('PrivateIdentity')).user.artistId;
  await other.register('OtherIdentity'); await investor.register('PrivateInvestor', 'investor');
  const baseline = (await (await owner.rpc('getMyArtistPreferences')).json()).result;
  assert.deepEqual(baseline.collaboration.creativeRoles, []);
  for (const method of ['getMyArtistPreferences','updateMyArtistPreferences']) {
    assert.equal((await guest.rpc(method, ...(method.startsWith('update') ? [{}] : []))).status, 401);
    assert.equal((await investor.rpc(method, ...(method.startsWith('update') ? [{}] : []))).status, 403);
  }
  assert.equal((await other.rpc('getMyArtistPreferences', ownerId)).status, 400);
  for (const input of [
    { artistId: ownerId }, { role: 'artist' }, { discovery: { ownerId } }, { discovery: { genres: null } },
    { collaboration: { compensationKinds: ['combined'] } }, { collaboration: { compensationKinds: ['negotiable'] } },
    { collaboration: { creativeRoles: ['Production'] } }, { discovery: { projectTypes: ['not-supported'] } },
    { discovery: { opportunityTypes: ['Songwriter'] } }, { discovery: { genres: Array(21).fill('Rock') } },
  ]) assert.equal((await owner.rpc('updateMyArtistPreferences', input)).status, 400, JSON.stringify(input));
  for (const input of [{ creativeRoles: ['admin'] }, { genres: [''] }, { genres: ['x'.repeat(121)] }, { collaborationAvailability: 'verified' }, { artistPreferences: {} }, { id: ownerId }, { role: 'investor' }]) {
    assert.equal((await owner.rpc('updateArtist', { name: 'PrivateIdentity', ...input })).status, 400);
  }
  assert.equal((await owner.request('/api/rpc', 'POST', { method: 'updateMyArtistPreferences', args: [{}] }, { Origin: 'https://other.invalid' })).status, 403);
  assert.deepEqual((await (await owner.rpc('getMyArtistPreferences')).json()).result, baseline);
  const updates = await Promise.all([
    owner.rpc('updateMyArtistPreferences', { collaboration: { creativeRoles: ['producer','vocalist'] } }),
    owner.rpc('updateMyArtistPreferences', { discovery: { genres: ['Soul'] } }),
  ]);
  assert.deepEqual(updates.map(r => r.status), [200,200]);
  const stored = (await (await owner.rpc('getMyArtistPreferences')).json()).result;
  assert.deepEqual(stored.collaboration.creativeRoles, ['producer','vocalist']); assert.deepEqual(stored.discovery.genres, ['Soul']);
  assert.deepEqual((await (await other.rpc('getMyArtistPreferences')).json()).result, baseline);
  await owner.rpc('updateMyArtistPreferences', { discovery: { genres: [] } });
  const cleared = (await (await owner.rpc('getMyArtistPreferences')).json()).result;
  assert.deepEqual(cleared.discovery.genres, []); assert.deepEqual(cleared.collaboration.creativeRoles, stored.collaboration.creativeRoles);
  await owner.rpc('logout'); assert.equal((await owner.rpc('getMyArtistPreferences')).status, 401);
});

test('canonical artist taxonomies validate on the server and preserve unresolved legacy identity', async t => {
  const app = await fixture(t), owner = app.client(), other = app.client(), investor = app.client(), guest = app.client();
  const id = (await owner.register('TaxonomyOwner')).user.artistId;
  const otherId = (await other.register('TaxonomyOther')).user.artistId;
  await investor.register('TaxonomyInvestor', 'investor');
  const project = (await (await owner.rpc('createProject', { title: 'Taxonomy project', category: 'EP', status: 'funding', goalAmount: 1000 })).json()).result;
  const db = new DatabaseSync(join(app.dataDir, 'nebula.sqlite'));
  const raw = JSON.parse(db.prepare('SELECT value FROM state WHERE id=1').get().value);
  Object.assign(raw.artists.find(a => a.id === id), { creativeRoles: ['Music Producer', 'Session Musician', 'Future legacy role'], genre: 'Demo projects', genres: ['Hip hop', 'RnB', 'Jazz / Soul'] });
  db.prepare('UPDATE state SET value=? WHERE id=1').run(JSON.stringify(raw)); db.close();
  await app.restart();
  const state = () => { const d = new DatabaseSync(join(app.dataDir, 'nebula.sqlite')); const s = JSON.parse(d.prepare('SELECT value FROM state WHERE id=1').get().value); d.close(); return s; };
  const before = state(), projects = await (await guest.request('/api/opportunities/projects?q=Taxonomy')).json();
  const legacy = (await (await guest.rpc('getArtist', id)).json()).result.artist;
  assert.deepEqual(legacy.creativeRoles, ['producer', 'session-musician']); assert.deepEqual(legacy.genreIds, ['hip-hop', 'rnb']);
  assert.deepEqual(legacy.identityReview, { creativeRoles: ['Future legacy role'], genres: ['Jazz / Soul', 'Demo projects'] });
  assert.deepEqual(state(), before); // No write-on-read or wholesale migration.
  const invalid = [{ creativeRoles: ['Music Producer'] }, { creativeRoles: ['Production'] }, { genreIds: ['R&B'] }, { genreIds: ['invented'] }, { genreIds: null }, { genreIds: Array(21).fill('jazz') }, { identityReview: {} }, { legacyCreativeRoles: [] }, { id: otherId }];
  for (const patch of invalid) {
    const response = await owner.rpc('updateArtist', { name: 'TaxonomyOwner', ...patch });
    assert.equal(response.status, 400, JSON.stringify(patch)); assert.ok((await response.json()).error);
  }
  assert.equal((await guest.rpc('updateArtist', { name: 'No', genreIds: ['rock'] })).status, 401);
  assert.equal((await investor.rpc('updateArtist', { name: 'No', genreIds: ['rock'] })).status, 403);
  assert.deepEqual(state(), before);
  const saved = await owner.rpc('updateArtist', { name: 'TaxonomyOwner', creativeRoles: ['recording-engineer','lyricist','producer','producer'], genreIds: ['deep-house','regional-mexican','deep-house'] });
  assert.equal(saved.status, 200);
  const profile = (await saved.json()).result;
  assert.deepEqual(profile.creativeRoles, ['recording-engineer','lyricist','producer']); assert.deepEqual(profile.genreIds, ['deep-house','regional-mexican']);
  assert.deepEqual(profile.identityReview, legacy.identityReview);
  assert.deepEqual(state().artists.find(a => a.id === id).legacyCreativeRoles, ['Future legacy role']);
  assert.deepEqual(state().artists.find(a => a.id === otherId), before.artists.find(a => a.id === otherId));
  assert.deepEqual(state().projects, before.projects);
  // Identity edits now update genre facets; catalog records, eligibility and pagination remain identical.
  assert.deepEqual(projects.facets.artistGenres, ['Hip-hop', 'Jazz / Soul', 'R&B']);
  assert.deepEqual(await (await guest.request('/api/opportunities/projects?q=Taxonomy')).json(), {
    ...projects, facets: { ...projects.facets, artistGenres: ['Deep House', 'Regional Mexican'] },
  });
  assert.equal((await other.rpc('updateProject', project.id, { title: 'Forbidden' })).status, 404);
  await app.restart();
  assert.deepEqual((await (await owner.request('/api/session')).json()).user.artist.genreIds, ['deep-house','regional-mexican']);
  assert.equal((await owner.rpc('updateArtist', { name: 'TaxonomyOwner', creativeRoles: [], genreIds: [] })).status, 200);
  await app.restart();
  const cleared = (await (await owner.rpc('getArtist', id)).json()).result.artist;
  assert.deepEqual(cleared.creativeRoles, []); assert.deepEqual(cleared.genreIds, []);
  assert.deepEqual(cleared.genres, legacy.genres); assert.equal(cleared.genre, 'Demo projects'); assert.deepEqual(cleared.identityReview, legacy.identityReview);
});

test('Artist 1.2 identity saves are atomic, resumable and private across restart and accounts', async t => {
  const app = await fixture(t), artist = app.client(), other = app.client(), guest = app.client(), investor = app.client();
  const user = (await artist.register('ProfileLifecycle')).user;
  await other.register('OtherProfile'); await investor.register('ProfileInvestor', 'investor');
  const state = () => { const db = new DatabaseSync(join(app.dataDir, 'nebula.sqlite')); const raw = db.prepare('SELECT value FROM state WHERE id=1').get().value; db.close(); return raw; };
  const baseline = state();
  assert.equal((await artist.rpc('getMyArtistOnboarding')).status, 200); assert.equal(state(), baseline);
  const identity = { name: 'ProfileLifecycle', creativeRoles: ['producer', 'recording-engineer'], genreIds: ['hip-hop'], externalLinks: [{ label: 'Music site', url: 'https://example.com/music' }], publicInterests: ['Feature'], collaborationAvailability: 'open' };
  const preferences = { discovery: { genreIds: ['electronic'], genres: ['PRIVATE_TASTE'], opportunityTypes: ['Mix'] }, collaboration: { creativeRoles: ['mixing-engineer'], compensationKinds: ['fee'] } };
  const response = await artist.rpc('updateArtistIdentity', { profile: identity, preferences, onboarding: { step: 4, completeStep: 3 } }); assert.equal(response.status, 200);
  const saved = state();
  for (const input of [{ profile: { name: 'MUST_NOT_SAVE' }, preferences: { discovery: { genreIds: ['fake'] } } }, { onboarding: { step: 1, finish: true } }, { profile: { name: 'No', externalLinks: [{ label: 'Unsafe', url: 'javascript:alert(1)' }] } }, { profile: { name: 'No', publicInterests: ['Unknown'] } }, { ownerId: user.artistId }, { onboarding: { step: 1, completedAt: 'forged' } }]) assert.equal((await artist.rpc('updateArtistIdentity', input)).status, 400);
  assert.equal(state(), saved);
  for (const method of ['getMyArtistOnboarding', 'updateArtistIdentity']) {
    const args = method.startsWith('update') ? [{}] : [];
    assert.equal((await guest.rpc(method, ...args)).status, 401); assert.equal((await investor.rpc(method, ...args)).status, 403);
  }
  assert.equal((await artist.rpc('getMyArtistOnboarding', user.artistId)).status, 400);
  assert.equal((await artist.request('/api/rpc', 'POST', { method: 'updateArtistIdentity', args: [{}] }, { Origin: 'https://untrusted.invalid' })).status, 403);
  for (const client of [guest, other, investor, artist]) {
    const publicResponse = await client.rpc('getPublicArtist', user.artistId); assert.equal(publicResponse.status, 200); const body = JSON.stringify((await publicResponse.json()).result);
    for (const secret of ['PRIVATE_TASTE', 'artistOnboarding', 'completedSteps', 'artistPreferences', 'passwordDigest', 'profilelifecycle@example.invalid']) assert.equal(body.includes(secret), false, secret);
    assert.equal(body.includes('electronic'), false); assert.equal(body.includes('hip-hop'), true);
  }
  await app.restart();
  assert.equal((await (await artist.rpc('getMyArtistOnboarding')).json()).result.step, 4);
  assert.equal((await (await other.rpc('getMyArtistOnboarding')).json()).result.step, 1);
  assert.deepEqual((await (await artist.rpc('getMyArtistPreferences')).json()).result.discovery.genreIds, ['electronic']);
  assert.equal((await artist.rpc('updateArtistIdentity', { onboarding: { step: 4, finish: true } })).status, 200);
  assert.ok((await (await artist.rpc('getMyArtistOnboarding')).json()).result.completedAt);
  assert.equal((await (await artist.request('/api/session')).json()).user.artistId, user.artistId);
  const stored = JSON.parse(state()); assert.equal(stored.artists.length, 2); assert.equal(stored.accounts.length, 3);
});

test('public artist catalog separates project audio, independent posts and private records before pagination', async t => {
  const app = await fixture(t), artist = app.client(), other = app.client(), guest = app.client();
  const id = (await artist.register('CatalogOwner')).user.artistId; await other.register('CatalogOther');
  const create = async (title, category, status) => (await (await artist.rpc('createProject', { title, category, status, goalAmount: 1000 })).json()).result;
  const ep = await create('Music EP', 'EP', 'published'), draft = await create('PRIVATE PROJECT', 'Album', 'draft'), tour = await create('Public tour', 'Tour', 'published'), closed = await create('Closed work', 'Single', 'closed');
  const media = await (await artist.upload()).json();
  const publish = async (title, projectId, status = 'published') => { const r = await artist.request('/api/publications', 'POST', postInput(media, { title, projectId, status })); assert.equal(r.status, 201); return r.json(); };
  const projectAudio = await publish('Actual project sound', ep.id); await publish('Not a music release', tour.id); await publish('PRIVATE POST', null, 'draft');
  for (let n = 0; n < 21; n++) await publish(`Independent ${n}`, null);
  await publish('WITHDRAWN POST', null, 'withdrawn');
  const otherMedia = await (await other.upload()).json(); await other.request('/api/publications', 'POST', postInput(otherMedia, { title: 'OTHER ARTIST', status: 'published' }));
  const offer = await artist.request(`/api/projects/${ep.id}/offers`, 'POST', { need: 'Feature', deliverable: 'A verse', requirements: '', deadline: null, compensation: { kind: 'split', percent: 10 }, status: 'open' }); assert.equal(offer.status, 201);
  const offerData = await offer.json();
  const thread = await other.legacyConversation(offerData.id); assert.equal(thread.status, 200);
  for (const viewer of [artist, guest, other]) {
    const profile = (await (await viewer.rpc('getPublicArtist', id)).json()).result;
    assert.deepEqual(profile.projects.map(p => p.id), [ep.id, tour.id, closed.id]); assert.deepEqual(profile.opportunityProjectIds, [ep.id]);
    assert.equal(JSON.stringify(profile).includes('PRIVATE PROJECT'), false);
    const music = await (await viewer.request(`/api/publications?artistId=${id}&projectAudio=1`)).json();
    assert.deepEqual(music.items.map(p => p.id), [projectAudio.id]); assert.equal(music.nextCursor, null);
    const first = await (await viewer.request(`/api/publications?artistId=${id}`)).json(); assert.equal(first.items.length, 20);
    const second = await (await viewer.request(`/api/publications?artistId=${id}&before=${first.nextCursor}`)).json();
    const posts = [...first.items, ...second.items]; assert.equal(posts.length, 23); assert.equal(new Set(posts.map(p => p.id)).size, 23);
    assert.ok(posts.every(p => p.artistId === id && p.status === 'published'));
    assert.equal(JSON.stringify(profile).includes('submissions'), false); assert.equal(JSON.stringify(profile).includes('messages'), false);
  }
  assert.equal((await artist.request(`/api/publications?mine=1&artistId=${id}`)).status, 400);
  await artist.rpc('updateProject', ep.id, { status: 'draft' });
  assert.equal((await (await guest.request(`/api/publications?artistId=${id}&projectAudio=1`)).json()).items.length, 0);
  const publicPost = (await (await guest.request(`/api/publications?artistId=${id}`)).json()).items;
  assert.ok(publicPost.every(p => p.project?.id !== ep.id));
  await artist.rpc('deleteProject', closed.id);
  assert.deepEqual((await (await guest.rpc('getPublicArtist', id)).json()).result.projects.map(p => p.id), [tour.id]);
  assert.ok((await (await artist.rpc('getArtist', id)).json()).result.projects.some(p => p.id === draft.id));
});

test('artist genre search integrates canonical identity, legacy compatibility, pagination, Following and visibility without changing project search', async t => {
  const app = await fixture(t), owner = app.client(), viewer = app.client(), legacy = app.client(), investor = app.client(), guest = app.client();
  const ownerId = (await owner.register('NeutralMaker')).user.artistId;
  await viewer.register('NeutralViewer'); await legacy.register('LegacyMaker'); await investor.register('GenreInvestor', 'investor');
  const rpc = async (client, method, ...args) => { const r = await client.rpc(method, ...args); assert.equal(r.status, 200, await r.clone().text()); return (await r.json()).result; };
  const create = (client, title, status = 'published') => rpc(client, 'createProject', { title, category: 'EP', goalAmount: 1000, status });
  const eligible = await create(owner, 'Eligible neutral work');
  for (const [need, compensation] of [['Production', { kind: 'fee', amount: 100, currency: 'USD' }], ['Mix', { kind: 'split', percent: 12 }]]) {
    assert.equal((await owner.request(`/api/projects/${eligible.id}/offers`, 'POST', { ...offerInput, need, compensation })).status, 201);
  }
  const publicOnly = await create(owner, 'Catalog neutral work');
  const privateOnly = await create(owner, 'Private neutral work', 'draft');
  const legacyProject = await create(legacy, 'Legacy eligible work', 'funding');
  await rpc(owner, 'updateArtist', { name: 'NeutralMaker', genreIds: ['rnb', 'electronic'] });
  await rpc(owner, 'updateMyArtistPreferences', { discovery: { genreIds: ['classical'] } });
  await rpc(legacy, 'updateArtist', { name: 'LegacyMaker', genre: 'NORTEÑO' });
  const projects = async (q, client = guest) => { const r = await client.request('/api/opportunities/projects?' + q); assert.equal(r.status, 200); return r.json(); };
  const ids = result => result.items.map(item => item.project.id);
  const artists = (query, client = guest) => rpc(client, 'listArtists', { search: query });
  for (const query of ['rnb', 'R&B', 'Rhythm and Blues', 'ELECTRÓNICA', 'electronic_music']) {
    assert.deepEqual(ids(await projects('q=' + encodeURIComponent(query))), [eligible.id]);
    assert.deepEqual((await artists(query)).map(a => a.id), [ownerId]);
  }
  assert.deepEqual(ids(await projects('genre=norteno')), [legacyProject.id]);
  assert.equal((await artists('norteño')).length, 1);
  assert.deepEqual(await artists('classical'), []);
  assert.equal((await artists('NeutralMaker'))[0].genreSource, 'structured');
  assert.equal((await artists('LegacyMaker'))[0].genreSource, 'legacy');
  // Canonical IDs take precedence over both legacy fields; unknown legacy text is not classified.
  await rpc(owner, 'updateArtist', { name: 'NeutralMaker', genre: 'Rock', genres: ['Jazz'] });
  for (const term of ['rock', 'jazz']) { assert.deepEqual(await artists(term), []); assert.deepEqual(ids(await projects('q=' + term)), []); }
  await rpc(legacy, 'updateArtist', { name: 'LegacyMaker', genre: 'Unmapped texture' });
  assert.equal((await artists('unmapped texture')).length, 1);
  assert.deepEqual(ids(await projects('artistGenres=Unmapped%20texture')), [legacyProject.id]);
  const hints = await (await guest.request('/api/opportunities/suggestions?q=unmapped')).json();
  assert.equal(hints.items[0].label, 'Unmapped texture (legacy text)');
  assert.deepEqual((await artists('LegacyMaker'))[0].genreIds, []);
  // Keep broader Global Search and owner-only draft visibility separate from Home eligibility.
  assert.deepEqual((await rpc(guest, 'listProjects', { search: 'Catalog neutral' })).map(p => p.id), [publicOnly.id]);
  assert.deepEqual(ids(await projects('q=Catalog')), []);
  assert.deepEqual(await rpc(guest, 'listProjects', { search: 'Private neutral' }), []);
  assert.deepEqual(await rpc(viewer, 'listProjects', { search: 'Private neutral' }), []);
  assert.deepEqual((await rpc(owner, 'listProjects', { search: 'Private neutral' })).map(p => p.id), [privateOnly.id]);
  assert.deepEqual(ids(await projects('q=Private', owner)), []);
  assert.deepEqual(await rpc(guest, 'listProjects', { search: 'electronic' }), []); // No inferred project genres.
  const filters = 'artistGenres=RnB&artistGenres=Electronic&projectTypes=ep&projectTypes=album&participation=Production&compensationKinds=fee';
  assert.deepEqual(ids(await projects(filters)), [eligible.id]);
  assert.deepEqual(ids(await projects(filters.replace('compensationKinds=fee', 'compensationKinds=split'))), []);
  assert.deepEqual(ids(await projects(filters.replace('participation=Production', 'participation=Funding'))), []);
  // Place the matching project beyond the first page; matching happens before pagination.
  for (let i = 0; i < 25; i++) await create(legacy, `Newer funding ${i}`, 'funding');
  assert.equal(ids(await projects('')).includes(eligible.id), false);
  assert.deepEqual(ids(await projects(filters)), [eligible.id]);
  assert.equal((await viewer.request(`/api/artists/${ownerId}/follow`, 'PUT')).status, 200);
  assert.deepEqual(ids(await projects('mode=following&' + filters, viewer)), [eligible.id]);
  assert.deepEqual(ids(await projects('mode=following&artistGenres=Unmapped%20texture', viewer)), []);
  assert.equal((await investor.request('/api/opportunities/projects?mode=following')).status, 403);
  assert.deepEqual((await artists('electronic', investor)).map(a => a.id), [ownerId]);
  assert.equal((await investor.rpc('updateArtist', { name: 'Forbidden', genreIds: ['rock'] })).status, 403);
  // Persist removals and explicit clearing; keep unrelated public/private records unchanged.
  const projectBefore = await rpc(owner, 'getProject', eligible.id);
  await rpc(owner, 'updateArtist', { name: 'NeutralMaker', genreIds: ['rnb'] });
  await app.restart();
  assert.deepEqual(await artists('electronic'), []); assert.deepEqual(ids(await projects('artistGenres=electronic')), []);
  assert.deepEqual(ids(await projects('artistGenres=R%26B')), [eligible.id]);
  await rpc(owner, 'updateArtist', { name: 'NeutralMaker', genreIds: [] });
  for (const term of ['rock', 'jazz', 'rnb']) { assert.deepEqual(await artists(term), []); assert.deepEqual(ids(await projects('q=' + term)), []); }
  assert.deepEqual(await rpc(owner, 'getProject', eligible.id), { ...projectBefore, artist: { ...projectBefore.artist, genreIds: [] } });
  assert.deepEqual((await rpc(owner, 'getMyArtistPreferences')).discovery.genreIds, ['classical']);
  assert.equal((await rpc(owner, 'getArtist', ownerId)).artist.genre, 'Rock');
  assert.equal((await viewer.request(`/api/artists/${ownerId}/follow`, 'DELETE')).status, 200);
  assert.deepEqual(ids(await projects('mode=following', viewer)), []);
  await rpc(viewer, 'logout');
  assert.equal((await viewer.request('/api/opportunities/projects?mode=following')).status, 401);
  await viewer.register('NewNeutralViewer');
  assert.deepEqual(ids(await projects('mode=following', viewer)), []);
  assert.deepEqual((await rpc(viewer, 'getMyArtistPreferences')).discovery.genreIds ?? [], []);
});
