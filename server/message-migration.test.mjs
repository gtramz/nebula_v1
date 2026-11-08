import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {collaborations} from '../dist-server/server/collaborations.js';
import {messageStorage} from '../dist-server/server/message-storage.js';
const schema=`CREATE TABLE collaborations(id INTEGER PRIMARY KEY AUTOINCREMENT,offer INTEGER NOT NULL,owner INTEGER NOT NULL,applicant INTEGER NOT NULL,terms TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'discussion',revision INTEGER NOT NULL DEFAULT 1,updated TEXT NOT NULL,UNIQUE(offer,applicant));
CREATE TABLE collaboration_messages(id INTEGER PRIMARY KEY AUTOINCREMENT,thread INTEGER NOT NULL,author INTEGER NOT NULL,text TEXT NOT NULL,created TEXT NOT NULL);`;
function fixture(t){const db=new DatabaseSync(':memory:');t.after(()=>db.close());db.exec(schema);for(const [i,status] of ['discussion','submitted','accepted','rejected','withdrawn','completed'].entries())db.prepare('INSERT INTO collaborations VALUES(?,?,?,?,?,?,?,?)').run(i+1,i+10,2,1,'{"projectTitle":"Original terms","revision":7}',status,3,'2025-03-02T01:00:00.000Z');db.prepare('INSERT INTO collaboration_messages VALUES(?,?,?,?,?)').run(19,4,1,'Historical rejected chat','2025-03-01T01:00:00.000Z');db.prepare('INSERT INTO collaboration_messages VALUES(?,?,?,?,?)').run(900,1,2,'Deleted high-water row','2025-03-01T01:00:00.000Z');db.exec('DELETE FROM collaboration_messages WHERE id=900');return db;}
const snapshot=db=>({rows:db.prepare('SELECT id,offer,owner,applicant,terms,status,revision,updated FROM collaborations ORDER BY id').all(),messages:db.prepare('SELECT id,thread,author,text,created FROM collaboration_messages ORDER BY id').all(),sequence:db.prepare("SELECT seq FROM sqlite_sequence WHERE name='collaboration_messages'").get().seq});
function initialize(db){return collaborations({db,messages:messageStorage(db),alerts:{record(){throw new Error('Migration must not send notices');}}});}
test('explicit legacy policy migration preserves every old work state, field, transcript and sequence on repeated startup',t=>{
 const db=fixture(t),before=snapshot(db);initialize(db);assert.deepEqual(snapshot(db),before);
 assert.ok(db.prepare('SELECT request_policy,admission FROM collaborations').all().every(r=>r.request_policy===0&&r.admission==='accepted'));
 assert.equal(db.prepare('SELECT kind FROM collaboration_messages').get().kind,'message');assert.equal(db.prepare('SELECT COUNT(*) n FROM conversation_activity').get().n,0);
 initialize(db);assert.deepEqual(snapshot(db),before);
 db.prepare('INSERT INTO collaboration_messages(thread,author,text,created) VALUES(?,?,?,?)').run(4,2,'Continuation','2026-01-01');assert.equal(db.prepare('SELECT MAX(id) id FROM collaboration_messages').get().id,901);
});
test('failed admission column migration rolls back its first ALTER and preserves historical rows',t=>{
 const db=fixture(t),before=snapshot(db),exec=db.exec.bind(db);db.exec=sql=>{if(sql.includes('ADD COLUMN admission'))throw new Error('Injected admission migration failure');return exec(sql);};
 assert.throws(()=>initialize(db),/Injected admission/);db.exec=exec;assert.deepEqual(snapshot(db),before);assert.equal(db.prepare('PRAGMA table_info(collaborations)').all().some(c=>c.name==='request_policy'),false);
 initialize(db);assert.deepEqual(snapshot(db),before);
});
