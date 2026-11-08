import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createNebulaServer } from '../dist-server/server/app.js';

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
    };
  }
  return { client, dataDir, restart: async () => { await stop(); await start(); }, get origin() { return origin; } };
}

const inbox = client => client.request('/api/notifications').then(r => r.json());

test('effective follows notify only the recipient, survive retries/restarts, and refollows create a new occurrence', async t => {
 const app=await fixture(t),a=app.client(),b=app.client(),other=app.client(),guest=app.client(),investor=app.client();
 const A=(await a.register('NoticeA')).user.artistId, B=(await b.register('NoticeB')).user.artistId;
 const C=(await other.register('NoticeC')).user.artistId;
 await investor.register('NoticeInvestor','investor');
 const path=`/api/artists/${B}/follow`;
 assert.equal((await guest.request(path,'PUT')).status,401); assert.equal((await investor.request(path,'PUT')).status,403);
 assert.equal((await a.request(`/api/artists/${A}/follow`,'PUT')).status,400);
 assert.equal((await a.request('/api/artists/999/follow','PUT')).status,404);
 assert.equal((await a.request(path,'PUT',undefined,{Origin:'https://untrusted.invalid'})).status,403);
 assert.equal((await a.request('/api/notifications','POST',{recipient:B,actor:C,kind:'artist.followed'})).status,405);
 // Body-supplied references never control the actor, recipient or navigation destination.
 const attempts=await Promise.all(Array.from({length:8},()=>a.request(path,'PUT',{followerId:C,artistId:C,url:'https://untrusted.invalid'})));
 assert.ok(attempts.every(r=>r.status===200));
 let page=await inbox(b);assert.equal(page.items.length,1); assert.equal(page.unreadCount,1);
 const first=page.items[0];assert.equal(first.kind,'artist.followed'); assert.equal(first.actorId,A);assert.equal(first.actorName,'NoticeA');
 assert.deepEqual(first.target,{type:'artist',id:A,available:true});assert.equal('collaborationId' in first,false);
 assert.equal((await inbox(a)).items.length,0);assert.equal((await inbox(other)).items.length,0);
 assert.equal((await other.request('/api/notifications/read','PATCH',{id:first.id})).status,404);
 assert.equal((await a.request('/api/notifications/read','PATCH',{throughId:first.id})).status,404);
 await b.request('/api/notifications/read','PATCH',{id:first.id});const read=(await inbox(b)).items[0];assert.ok(read.readAt);
 // Discard an acknowledged response, then retry exactly as after a lost response.
 const lost=await a.request(path,'PUT');await lost.body.cancel();await app.restart();assert.equal((await a.request(path,'PUT')).status,200);
 assert.deepEqual((await inbox(b)).items,[read]);
 await a.request(path,'DELETE');await a.request(path,'DELETE');
 assert.equal((await(await b.request(`/api/artists/${B}/social`)).json()).followers,0);
 assert.deepEqual((await inbox(b)).items,[read]);
 await app.restart();await a.request(path,'PUT');page=await inbox(b);
 assert.equal(page.items.length,2);assert.equal(page.unreadCount,1);assert.ok(page.items[0].id>first.id);assert.deepEqual(page.items[1],read);
 const db=new DatabaseSync(join(app.dataDir,'nebula.sqlite'));t.after(()=>db.close());
 const rows=db.prepare('SELECT occurrence_key FROM artist_notifications ORDER BY id').all();
 const relationship=db.prepare('SELECT id FROM artist_follows WHERE follower=? AND artist=?').get(A,B);
 assert.equal(rows[1].occurrence_key,`artist.followed:${relationship.id}`);assert.notEqual(rows[0].occurrence_key,rows[1].occurrence_key);
 await app.restart();assert.equal((await inbox(b)).items.length,2);
});

test('notification insertion failure atomically rolls back a new follow and allows a safe retry', async t => {
 const app=await fixture(t),a=app.client(),b=app.client();
 const A=(await a.register('RollbackA')).user.artistId,B=(await b.register('RollbackB')).user.artistId;
 const db=new DatabaseSync(join(app.dataDir,'nebula.sqlite'));t.after(()=>db.close());
 db.exec(`CREATE TRIGGER fail_follow_notice BEFORE INSERT ON artist_notifications WHEN NEW.kind='artist.followed' BEGIN SELECT RAISE(ABORT,'Injected notification failure'); END`);
 const failed=await a.request(`/api/artists/${B}/follow`,'PUT');assert.equal(failed.status,500);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM artist_follows').get().n,0);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM artist_notifications').get().n,0);
 assert.equal((await(await b.request(`/api/artists/${B}/social`)).json()).followers,0);
 db.exec('DROP TRIGGER fail_follow_notice');
 assert.equal((await a.request(`/api/artists/${B}/follow`,'PUT')).status,200);
 assert.equal((await inbox(b)).items.length,1);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM artist_follows WHERE follower=? AND artist=?').get(A,B).n,1);
});

test('existing relationships are never backfilled and missing account/profile pairs cannot follow or link',async t=>{
 const app=await fixture(t),a=app.client(),b=app.client();
 const A=(await a.register('LegacyA')).user.artistId,B=(await b.register('LegacyB')).user.artistId;
 const db=new DatabaseSync(join(app.dataDir,'nebula.sqlite'));t.after(()=>db.close());
 db.prepare('INSERT INTO artist_follows(follower,artist,created) VALUES(?,?,?)').run(A,B,'2025-01-01T00:00:00.000Z');
 await app.restart();await a.request(`/api/artists/${B}/follow`,'PUT');assert.equal((await inbox(b)).items.length,0);
 await a.request(`/api/artists/${B}/follow`,'DELETE');await a.request(`/api/artists/${B}/follow`,'PUT');assert.equal((await inbox(b)).items.length,1);
 // A stale public Artist without its real account must never become an operational destination.
 const original=db.prepare('SELECT value FROM state WHERE id=1').get().value;
 const state=JSON.parse(original);state.accounts=state.accounts.filter(row=>row.id!==A);state.artists=state.artists.filter(row=>row.id!==A);
 db.prepare('UPDATE state SET value=? WHERE id=1').run(JSON.stringify(state));
 const historical=(await inbox(b)).items[0];assert.equal(historical.actorName,'Artist unavailable');assert.equal(historical.target.available,false);
 assert.equal((await b.request(`/api/artists/${A}/follow`,'PUT')).status,404);
 db.prepare('UPDATE state SET value=? WHERE id=1').run(original);
 state.accounts=JSON.parse(original).accounts;state.artists=state.artists.filter(row=>row.id!==A);
 db.prepare('UPDATE state SET value=? WHERE id=1').run(JSON.stringify(state));
 // The existing state validator rejects a corrupted account/profile pair before any mutation.
 assert.equal((await b.request(`/api/artists/${A}/follow`,'PUT')).status,500);
 assert.equal((await a.request(`/api/artists/${B}/follow`,'PUT')).status,500);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM artist_notifications').get().n,1);
 db.prepare('UPDATE state SET value=? WHERE id=1').run(original);
});
