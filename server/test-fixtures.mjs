import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createNebulaServer } from '../dist-server/server/app.js';

const audio = await readFile(new URL('../artifacts/nebula/public/discovery-demo/soft-signal.wav', import.meta.url));
export async function fixture(t, options = {}) {
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
      async legacyConversation(offerId) {
        const session = await (await this.request('/api/session')).json();
        const db = new DatabaseSync(join(dataDir,'nebula.sqlite'));
        try {
          const offer = db.prepare('SELECT * FROM collaboration_offers WHERE id=?').get(offerId);
          let row = db.prepare('SELECT * FROM collaborations WHERE offer=? AND applicant=?').get(offerId,session.user.artistId);
          if(!row) {
            const terms = {...JSON.parse(offer.data),id:offer.id,projectId:offer.project,ownerId:offer.owner,projectTitle:offer.title,revision:offer.revision,createdAt:offer.created,available:true};
            const result=db.prepare('INSERT INTO collaborations(offer,owner,applicant,terms,updated) VALUES(?,?,?,?,?)').run(offer.id,offer.owner,session.user.artistId,JSON.stringify(terms),new Date().toISOString());
            db.prepare("INSERT INTO artist_notifications(recipient,actor,thread,kind,created) VALUES(?,?,?,'contact',?)").run(offer.owner,session.user.artistId,result.lastInsertRowid,new Date().toISOString());
            row={id:Number(result.lastInsertRowid)};
          }
          return await this.request(`/api/collaborations/${row.id}`);
        } finally {db.close();}
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
