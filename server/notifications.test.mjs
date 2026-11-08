import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { notifications } from '../dist-server/server/notifications.js';
import { transaction } from '../dist-server/server/transaction.js';

const date = '2026-01-02T03:04:05.000Z', readDate = '2026-01-03T04:05:06.000Z';
const actor = id => id < 100 ? { id, name: `Artist ${id}`, picture: null } : undefined;
const oldColumns = 'id,recipient,actor,thread,kind,created,read_at';
const oldSchema = `CREATE TABLE artist_notifications(id INTEGER PRIMARY KEY AUTOINCREMENT, recipient INTEGER NOT NULL, actor INTEGER NOT NULL, thread INTEGER NOT NULL, kind TEXT NOT NULL, created TEXT NOT NULL, read_at TEXT);
 CREATE INDEX notifications_recipient ON artist_notifications(recipient,id);
 CREATE INDEX notifications_unread ON artist_notifications(recipient,id) WHERE read_at IS NULL;`;
function fixture(t, legacy = false) {
 const db = new DatabaseSync(':memory:'); t.after(() => db.close());
 db.exec(`CREATE TABLE collaborations(id INTEGER PRIMARY KEY, owner INTEGER, applicant INTEGER, terms TEXT);`);
 db.prepare('INSERT INTO collaborations VALUES(?,?,?,?)').run(7,2,1,JSON.stringify({projectTitle:'Historical project',need:'Verse'}));
 if (legacy) db.exec(oldSchema);
 return db;
}
const event = (relationshipId, followerId = 1, artistId = 2) => ({ type: 'artist.followed', relationshipId, followerId, artistId, createdAt: date });

test('stage A: legacy migration preserves all history, indexes and deleted high-water IDs across repeated startup', t => {
 const db = fixture(t,true);
 const kinds=['contact','message','submit','request_changes','accept','reject','withdraw','deliver','complete','offer_updated','offer_closed'];
 for (const [i,kind] of kinds.entries()) db.prepare('INSERT INTO artist_notifications VALUES(?,?,?,?,?,?,?)').run(i+4,2,1,7,kind,date,i%2?readDate:null);
 db.prepare('INSERT INTO artist_notifications VALUES(?,?,?,?,?,?,?)').run(900,2,1,7,'message',date,null); db.exec('DELETE FROM artist_notifications WHERE id=900');
 db.exec('CREATE INDEX extra_history_actor ON artist_notifications(actor)');
 const before=db.prepare(`SELECT ${oldColumns} FROM artist_notifications ORDER BY id`).all();
 let service=notifications(db,actor);
 assert.deepEqual(db.prepare(`SELECT ${oldColumns} FROM artist_notifications ORDER BY id`).all(),before);
 assert.equal(db.prepare("SELECT seq FROM sqlite_sequence WHERE name='artist_notifications'").get().seq,900);
 assert.ok(db.prepare('PRAGMA index_list(artist_notifications)').all().some(i=>i.name==='extra_history_actor'));
 assert.equal(service.summary(2).unreadCount,6);
 assert.deepEqual(service.list(2,Number.MAX_SAFE_INTEGER).items.map(i=>i.kind),[...kinds].reverse());
 assert.ok(service.list(2,Number.MAX_SAFE_INTEGER).items.every(i=>i.collaborationId===7 && i.target.type==='collaboration' && i.target.available && i.projectTitle==='Historical project'));
 service=notifications(db,actor); assert.deepEqual(db.prepare(`SELECT ${oldColumns} FROM artist_notifications ORDER BY id`).all(),before);
 transaction(db,()=>service.record(2,1,7,'message',date));
 assert.equal(service.summary(2).latestId,901);
 transaction(db,()=>service.record(2,1,7,'message',date)); // Distinct legitimate messages are not deduplicated.
 assert.equal(service.summary(2).latestId,902);
});

test('stage A: failed physical migration rolls back original schema, rows, indexes and sequence', t => {
 const db=fixture(t,true); db.prepare('INSERT INTO artist_notifications VALUES(?,?,?,?,?,?,?)').run(20,2,1,7,'message',date,readDate);
 const schema=db.prepare("SELECT name,sql FROM sqlite_master WHERE tbl_name='artist_notifications' ORDER BY name").all();
 const before=db.prepare(`SELECT ${oldColumns} FROM artist_notifications`).all();
 const exec=db.exec.bind(db); db.exec=sql=>{if(sql.includes('ALTER TABLE artist_notifications_next')) {exec('DROP TABLE artist_notifications');throw new Error('Injected migration failure');}return exec(sql);};
 assert.throws(()=>notifications(db,actor),/Injected migration failure/);db.exec=exec;
 assert.deepEqual(db.prepare("SELECT name,sql FROM sqlite_master WHERE tbl_name='artist_notifications' ORDER BY name").all(),schema);
 assert.deepEqual(db.prepare(`SELECT ${oldColumns} FROM artist_notifications`).all(),before);
 assert.equal(db.prepare("SELECT seq FROM sqlite_sequence WHERE name='artist_notifications'").get().seq,20);
 assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='artist_notifications_next'").get(),undefined);
 assert.equal(notifications(db,actor).summary(2).latestId,20);
});

test('stage A: fresh and empty legacy databases initialize repeatedly without backfill', t => {
 for(const legacy of [false,true]) {
  const db=fixture(t,legacy);const service=notifications(db,actor);
  assert.equal(db.prepare("SELECT seq FROM sqlite_sequence WHERE name='artist_notifications'").get(),undefined);
  assert.deepEqual(service.summary(2),{unreadCount:0,latestId:null});notifications(db,actor);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM artist_notifications').get().n,0);
  assert.equal(db.prepare('PRAGMA table_info(artist_notifications)').all().find(c=>c.name==='thread').notnull,0);
 }
});

test('stage A: mixed destinations paginate once, keep reads private/idempotent, and preserve newer arrivals', t => {
 const db=fixture(t),service=notifications(db,actor);
 for(let i=0;i<35;i++) transaction(db,()=> i%2 ? service.recordFollow(event(i+1)) : service.record(2,1,7,'message',date));
 const first=service.list(2,Number.MAX_SAFE_INTEGER),second=service.list(2,first.nextCursor);
 assert.equal(first.items.length,30);assert.equal(second.items.length,5);assert.equal(second.nextCursor,null);
 assert.equal(new Set([...first.items,...second.items].map(i=>i.id)).size,35);
 const follow=first.items.find(i=>i.kind==='artist.followed');assert.deepEqual(follow.target,{type:'artist',id:1,available:true});
 for(const key of ['collaborationId','projectTitle','need'])assert.equal(key in follow,false);
 assert.equal(service.summary(1).unreadCount,0);assert.equal(service.list(3,Number.MAX_SAFE_INTEGER).items.length,0);
 assert.throws(()=>service.read(3,follow.id,readDate));assert.throws(()=>service.readThrough(3,follow.id,readDate));
 service.read(2,follow.id,readDate);service.read(2,follow.id,'2026-03-04T00:00:00.000Z');assert.equal(service.list(2,Number.MAX_SAFE_INTEGER).items.find(i=>i.id===follow.id).readAt,readDate);
 service.recordFollow(event(100));service.readThrough(2,first.latestId,readDate);
 assert.equal(service.summary(2).unreadCount,1);assert.equal(service.list(2,Number.MAX_SAFE_INTEGER).items[0].readAt,null);
 const before=db.prepare('SELECT * FROM artist_notifications WHERE occurrence_key=?').get('artist.followed:100');
 service.recordFollow({...event(100),createdAt:'2027-01-01T00:00:00.000Z'});
 assert.deepEqual(db.prepare('SELECT * FROM artist_notifications WHERE occurrence_key=?').get('artist.followed:100'),before);
 assert.throws(()=>service.recordFollow(event(100,3)),/does not match/);
 assert.throws(()=>db.prepare(`INSERT INTO artist_notifications(recipient,actor,kind,created,target_kind,target_artist,occurrence_key) VALUES(2,1,'artist.followed',?,'artist',1,'artist.followed:100')`).run(date),/UNIQUE/);
});

test('stage A: unavailable actors, missing/foreign/corrupt workspaces remain readable without leaking context', t => {
 const db=fixture(t),service=notifications(db,actor);
 service.recordFollow(event(1,100));service.record(2,1,999,'message',date);service.record(3,1,7,'message',date);
 db.prepare('INSERT INTO collaborations VALUES(?,?,?,?)').run(8,2,1,'broken-json'); service.record(2,1,8,'submit',date);
 const page=service.list(2,Number.MAX_SAFE_INTEGER);assert.equal(page.items.length,3);assert.equal(page.unreadCount,3);
 assert.ok(page.items.every(i=>i.target.available===false));assert.equal(page.items.find(i=>i.kind==='artist.followed').actorName,'Artist unavailable');
 const foreign=service.list(3,Number.MAX_SAFE_INTEGER).items[0];assert.equal(foreign.target.available,false);assert.equal(foreign.projectTitle,'Collaboration unavailable');assert.equal(JSON.stringify(foreign).includes('Historical project'),false);
 service.readThrough(2,page.latestId,readDate);assert.equal(service.summary(2).unreadCount,0);
});


test('legacy disk migration survives close/reopen with read state, sequence and both destination types intact', t => {
 const directory=mkdtempSync(join(tmpdir(),'nebula-notifications-migration-'));
 t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const path=join(directory,'nebula.sqlite'); let db=new DatabaseSync(path);
 db.exec(oldSchema);db.exec('CREATE TABLE collaborations(id INTEGER PRIMARY KEY, owner INTEGER, applicant INTEGER, terms TEXT)');
 db.prepare('INSERT INTO collaborations VALUES(?,?,?,?)').run(7,2,1,JSON.stringify({projectTitle:'Persistent context',need:'Mix'}));
 db.prepare('INSERT INTO artist_notifications VALUES(?,?,?,?,?,?,?)').run(12,2,1,7,'message',date,readDate);
 db.prepare('INSERT INTO artist_notifications VALUES(?,?,?,?,?,?,?)').run(100,2,1,7,'submit',date,null);
 db.exec('DELETE FROM artist_notifications WHERE id=100');db.close();
 db=new DatabaseSync(path);let service=notifications(db,actor);
 assert.equal(service.list(2,Number.MAX_SAFE_INTEGER).items[0].readAt,readDate);
 transaction(db,()=>service.recordFollow(event(4)));assert.equal(service.summary(2).latestId,101);db.close();
 db=new DatabaseSync(path);t.after(()=>db.close());service=notifications(db,actor);
 const page=service.list(2,Number.MAX_SAFE_INTEGER);assert.equal(page.items.length,2);assert.equal(page.unreadCount,1);
 assert.deepEqual(page.items.map(i=>i.id),[101,12]);assert.equal(page.items[1].readAt,readDate);
 assert.equal(page.items[1].projectTitle,'Persistent context');assert.equal(page.items[0].target.type,'artist');
 assert.equal(db.prepare("SELECT seq FROM sqlite_sequence WHERE name='artist_notifications'").get().seq,101);
});


test('stage A: index creation failure rolls back the completed table copy too', t=>{
 const db=fixture(t,true);db.prepare('INSERT INTO artist_notifications VALUES(?,?,?,?,?,?,?)').run(8,2,1,7,'message',date,null);
 const schema=db.prepare("SELECT name,sql FROM sqlite_master WHERE tbl_name='artist_notifications' ORDER BY name").all();
 const exec=db.exec.bind(db);db.exec=sql=>{if(sql.includes('notifications_occurrence'))throw new Error('Injected index failure');return exec(sql);};
 assert.throws(()=>notifications(db,actor),/Injected index failure/);db.exec=exec;
 assert.deepEqual(db.prepare("SELECT name,sql FROM sqlite_master WHERE tbl_name='artist_notifications' ORDER BY name").all(),schema);
 assert.equal(db.prepare('SELECT id FROM artist_notifications').get().id,8);
 assert.equal(db.prepare("SELECT seq FROM sqlite_sequence WHERE name='artist_notifications'").get().seq,8);
 assert.equal(notifications(db,actor).summary(2).unreadCount,1);
});

test('messages migration preserves prior Follow schema, read state, unique occurrences and deleted sequence, with mixed destination history',t=>{
 const db=fixture(t);
 db.exec(`CREATE TABLE artist_notifications(id INTEGER PRIMARY KEY AUTOINCREMENT,recipient INTEGER NOT NULL,actor INTEGER NOT NULL,thread INTEGER,kind TEXT NOT NULL,created TEXT NOT NULL,read_at TEXT,target_kind TEXT NOT NULL DEFAULT 'collaboration',target_artist INTEGER,occurrence_key TEXT);
 CREATE UNIQUE INDEX notifications_occurrence ON artist_notifications(occurrence_key) WHERE occurrence_key IS NOT NULL;`);
 db.prepare('INSERT INTO artist_notifications VALUES(?,?,?,?,?,?,?,?,?,?)').run(5,2,1,7,'message',date,readDate,'collaboration',null,null);
 db.prepare('INSERT INTO artist_notifications VALUES(?,?,?,?,?,?,?,?,?,?)').run(8,2,1,null,'artist.followed',date,null,'artist',1,'artist.followed:88');
 db.prepare('INSERT INTO artist_notifications VALUES(?,?,?,?,?,?,?,?,?,?)').run(300,2,1,7,'message',date,null,'collaboration',null,null);db.exec('DELETE FROM artist_notifications WHERE id=300');
 const original=db.prepare('SELECT * FROM artist_notifications ORDER BY id').all();
 const service=notifications(db,actor,(thread,viewer)=>thread===12&&viewer===2);
 assert.deepEqual(db.prepare('SELECT id,recipient,actor,thread,kind,created,read_at,target_kind,target_artist,occurrence_key FROM artist_notifications ORDER BY id').all(),original);
 assert.equal(db.prepare("SELECT seq FROM sqlite_sequence WHERE name='artist_notifications'").get().seq,300);
 service.recordFollow(event(88));assert.equal(service.summary(2).latestId,8); // SQLite consumes an ID for ON CONFLICT DO NOTHING.
 service.recordConversation(2,1,12,'conversation.requested',date);assert.equal(service.summary(2).latestId,302);
 service.recordConversation(3,1,12,'conversation.message',date);
 assert.deepEqual(service.list(2,Number.MAX_SAFE_INTEGER).items.map(i=>i.target.type),['conversation','artist','collaboration']);
 assert.deepEqual(service.list(2,Number.MAX_SAFE_INTEGER).items[0].target,{type:'conversation',id:12,available:true});
 assert.equal(service.list(3,Number.MAX_SAFE_INTEGER).items[0].target.available,false);
 notifications(db,actor);assert.equal(db.prepare('SELECT COUNT(*) n FROM artist_notifications').get().n,4);
});
