import type { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import type { Admission, ConversationKind } from '../lib/local/src/messages.js';
import { transaction } from './transaction.js';
import { ensure, text } from './validation.js';

export type GeneralRow = { id:number; sender:number; recipient:number; project:number|null; project_title:string|null; admission:Admission; revision:number; created:string; updated:string };
const canonical = (value: unknown): string => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a],[b]) => a.localeCompare(b))) : item);
/** Reception is separate from admission and notification. Future settings belong here. */
export function mayReceiveRequest(kind: ConversationKind) { return kind === 'general' || kind === 'collaboration'; }
export function messageStorage(db: DatabaseSync) {
  transaction(db, () => db.exec(`
    CREATE TABLE IF NOT EXISTS artist_conversations(id INTEGER PRIMARY KEY AUTOINCREMENT, sender INTEGER NOT NULL, recipient INTEGER NOT NULL,
      pair_a INTEGER NOT NULL, pair_b INTEGER NOT NULL, project INTEGER, project_title TEXT,
      admission TEXT NOT NULL DEFAULT 'pending' CHECK(admission IN ('pending','accepted','rejected')), revision INTEGER NOT NULL DEFAULT 1,
      created TEXT NOT NULL, updated TEXT NOT NULL, UNIQUE(pair_a,pair_b), CHECK(sender<>recipient AND pair_a=min(sender,recipient) AND pair_b=max(sender,recipient)));
    CREATE INDEX IF NOT EXISTS conversations_sender ON artist_conversations(sender,updated,id);
    CREATE INDEX IF NOT EXISTS conversations_recipient ON artist_conversations(recipient,updated,id);
    CREATE TABLE IF NOT EXISTS artist_messages(id INTEGER PRIMARY KEY AUTOINCREMENT, thread INTEGER NOT NULL, author INTEGER NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL, created TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS artist_messages_thread ON artist_messages(thread,id);
    CREATE TABLE IF NOT EXISTS conversation_activity(id INTEGER PRIMARY KEY AUTOINCREMENT, scope TEXT NOT NULL, thread INTEGER NOT NULL, actor INTEGER NOT NULL, kind TEXT NOT NULL, created TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS conversation_activity_thread ON conversation_activity(scope,thread,id);
    CREATE TABLE IF NOT EXISTS conversation_reads(scope TEXT NOT NULL, thread INTEGER NOT NULL, participant INTEGER NOT NULL, through_id INTEGER NOT NULL, PRIMARY KEY(scope,thread,participant));
    CREATE TABLE IF NOT EXISTS message_operations(actor INTEGER NOT NULL, operation TEXT NOT NULL, scope TEXT NOT NULL, fingerprint TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(actor,operation));
  `));
  function operation<T>(actor: number, key: unknown, scope: string, input: unknown, write: () => T): T {
    const operationId = text(key, 'Operation ID', 100, 16);
    const fingerprint = createHash('sha256').update(canonical(input)).digest('hex');
    return transaction(db, () => {
      const saved = db.prepare('SELECT scope,fingerprint,result FROM message_operations WHERE actor=? AND operation=?').get(actor,operationId) as {scope:string;fingerprint:string;result:string}|undefined;
      if(saved) { ensure(saved.scope===scope && saved.fingerprint===fingerprint,'Operation ID was already used for a different action.',409);return JSON.parse(saved.result) as T; }
      const result=write();
      db.prepare('INSERT INTO message_operations VALUES(?,?,?,?,?)').run(actor,operationId,scope,fingerprint,JSON.stringify(result));
      return result;
    });
  }
  function general(id:number, viewer:number) {
    const row=db.prepare('SELECT * FROM artist_conversations WHERE id=? AND (sender=? OR recipient=?)').get(id,viewer,viewer) as GeneralRow|undefined;
    ensure(row,'Conversation not found.',404);return row;
  }
  function activity(scope:ConversationKind,thread:number,actor:number,kind:string,created:string) {
    return Number(db.prepare('INSERT INTO conversation_activity(scope,thread,actor,kind,created) VALUES(?,?,?,?,?)').run(scope,thread,actor,kind,created).lastInsertRowid);
  }
  function reading(scope:ConversationKind,thread:number,viewer:number) {
    const row=db.prepare(`SELECT MAX(a.id) AS lastActivityId,COUNT(CASE WHEN a.actor<>? AND a.id>COALESCE(r.through_id,0) THEN 1 END) AS unreadCount
      FROM conversation_activity a LEFT JOIN conversation_reads r ON r.scope=a.scope AND r.thread=a.thread AND r.participant=? WHERE a.scope=? AND a.thread=?`).get(viewer,viewer,scope,thread) as {lastActivityId:number|null;unreadCount:number};
    return row;
  }
  // Authorization to the conversation must precede this bounded, private receipt.
  function read(scope:ConversationKind,thread:number,viewer:number,through:number) {
    ensure(db.prepare('SELECT 1 FROM conversation_activity WHERE id=? AND scope=? AND thread=?').get(through,scope,thread),'Activity not found.',404);
    db.prepare(`INSERT INTO conversation_reads VALUES(?,?,?,?) ON CONFLICT(scope,thread,participant) DO UPDATE SET through_id=MAX(through_id,excluded.through_id)`).run(scope,thread,viewer,through);
    return reading(scope,thread,viewer);
  }
  return { operation,general,activity,reading,read };
}
export type MessageStorage=ReturnType<typeof messageStorage>;
