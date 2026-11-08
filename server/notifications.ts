import type { DatabaseSync } from 'node:sqlite';
import type { ArtistNotification, CollaborationNotificationKind, ConversationNotificationKind, NotificationKind, NotificationPage, NotificationSummary } from '../lib/local/src/notifications.js';
import type { FollowCreated } from './follows.js';
import { ensure } from './validation.js';
import { transaction } from './transaction.js';

type Row = { recipient: number; id: number; thread: number | null; actor: number; kind: NotificationKind; created: string; read_at: string | null; target_kind: 'collaboration' | 'artist' | 'conversation'; target_conversation: number | null; target_artist: number | null; terms: string | null; accessible_thread: number | null };
type PublicActor = { id: number; name: string };
const historicalColumns = 'id,recipient,actor,thread,kind,created,read_at';
const columns = `id INTEGER PRIMARY KEY AUTOINCREMENT, recipient INTEGER NOT NULL, actor INTEGER NOT NULL,
  thread INTEGER, kind TEXT NOT NULL, created TEXT NOT NULL, read_at TEXT,
  target_kind TEXT NOT NULL DEFAULT 'collaboration', target_artist INTEGER, occurrence_key TEXT, target_conversation INTEGER,
  CHECK((target_kind='collaboration' AND thread IS NOT NULL AND target_artist IS NULL AND target_conversation IS NULL AND occurrence_key IS NULL AND kind<>'artist.followed' AND kind NOT LIKE 'conversation.%')
    OR (target_kind='artist' AND thread IS NULL AND target_artist IS NOT NULL AND target_artist=actor
      AND target_conversation IS NULL AND recipient<>actor AND kind='artist.followed' AND occurrence_key IS NOT NULL)
    OR (target_kind='conversation' AND thread IS NULL AND target_artist IS NULL AND target_conversation IS NOT NULL AND occurrence_key IS NULL AND kind IN ('conversation.requested','conversation.accepted','conversation.rejected','conversation.message')))`;

function initialize(db: DatabaseSync) {
  transaction(db, () => {
    const info = db.prepare('PRAGMA table_info(artist_notifications)').all() as { name: string; notnull: number }[];
    if (!info.length) db.exec(`CREATE TABLE artist_notifications(${columns})`);
    else if (!info.some(column => column.name === 'target_conversation')) {
      const copyColumns = historicalColumns + (info.some(c=>c.name==='target_kind') ? ',target_kind,target_artist,occurrence_key' : '');
      const sequence = db.prepare("SELECT seq FROM sqlite_sequence WHERE name='artist_notifications'").get() as { seq: number } | undefined;
      const indexes = db.prepare("SELECT sql FROM sqlite_master WHERE tbl_name='artist_notifications' AND type IN ('index','trigger') AND sql IS NOT NULL").all() as { sql: string }[];
      db.exec(`CREATE TABLE artist_notifications_next(${columns});
        INSERT INTO artist_notifications_next(${copyColumns}) SELECT ${copyColumns} FROM artist_notifications;`);
      // Verify the historical columns before replacing the physical table.
      const difference = db.prepare(`SELECT ${copyColumns} FROM artist_notifications EXCEPT SELECT ${copyColumns} FROM artist_notifications_next`).get();
      ensure(!difference, 'Notification history could not be preserved.', 500);
      db.exec('DROP TABLE artist_notifications; ALTER TABLE artist_notifications_next RENAME TO artist_notifications;');
      for (const entry of indexes) db.exec(entry.sql);
      if (sequence) {
        const current = db.prepare("SELECT seq FROM sqlite_sequence WHERE name='artist_notifications'").get() as { seq: number } | undefined;
        if (current) db.prepare("UPDATE sqlite_sequence SET seq=MAX(seq,?) WHERE name='artist_notifications'").run(sequence.seq);
        else db.prepare('INSERT INTO sqlite_sequence(name,seq) VALUES(?,?)').run('artist_notifications', sequence.seq);
      } else {
        // Copying an empty table can create a zero sequence; preserve its absence too.
        db.prepare("DELETE FROM sqlite_sequence WHERE name='artist_notifications'").run();
      }
    } else {
      ensure(['target_artist','occurrence_key'].every(name => info.some(column => column.name === name)) && info.find(column => column.name === 'thread')?.notnull === 0, 'Unsupported notification schema. Existing data was not reset.', 500);
    }
    db.exec(`CREATE INDEX IF NOT EXISTS notifications_recipient ON artist_notifications(recipient,id);
      CREATE INDEX IF NOT EXISTS notifications_unread ON artist_notifications(recipient,id) WHERE read_at IS NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS notifications_occurrence ON artist_notifications(occurrence_key) WHERE occurrence_key IS NOT NULL;`);
  });
}

export function notifications(db: DatabaseSync, artist: (id: number) => PublicActor | undefined, conversationAvailable: (id: number, recipient: number) => boolean = () => false) {
  initialize(db);
  // Call within the transaction recording the action. Collaboration events remain independent.
  function record(recipient: number, actor: number, thread: number, kind: CollaborationNotificationKind, created: string) {
    if (recipient === actor) return;
    db.prepare('INSERT INTO artist_notifications(recipient,actor,thread,kind,created) VALUES(?,?,?,?,?)').run(recipient, actor, thread, kind, created);
  }
  function recordFollow(event: FollowCreated) {
    const key = `artist.followed:${event.relationshipId}`;
    db.prepare(`INSERT INTO artist_notifications(recipient,actor,kind,created,target_kind,target_artist,occurrence_key)
      VALUES(?,?,'artist.followed',?,'artist',?,?) ON CONFLICT(occurrence_key) WHERE occurrence_key IS NOT NULL DO NOTHING`)
      .run(event.artistId, event.followerId, event.createdAt, event.followerId, key);
    const stored = db.prepare('SELECT recipient,actor FROM artist_notifications WHERE occurrence_key=?').get(key) as { recipient: number; actor: number };
    ensure(stored.recipient === event.artistId && stored.actor === event.followerId, 'Notification occurrence does not match its relationship.', 500);
  }
  function recordConversation(recipient: number, actor: number, conversation: number, kind: ConversationNotificationKind, created: string) {
    if(recipient===actor)return;
    db.prepare("INSERT INTO artist_notifications(recipient,actor,kind,created,target_kind,target_conversation) VALUES(?,?,?,?,'conversation',?)").run(recipient,actor,kind,created,conversation);
  }
  function summary(recipient: number): NotificationSummary {
    const unread = db.prepare('SELECT COUNT(*) n FROM artist_notifications WHERE recipient=? AND read_at IS NULL').get(recipient) as { n: number };
    const latest = db.prepare('SELECT MAX(id) id FROM artist_notifications WHERE recipient=?').get(recipient) as { id: number | null };
    return { unreadCount: unread.n, latestId: latest.id };
  }
  function list(recipient: number, before: number): NotificationPage {
    const rows = db.prepare(`SELECT n.*,c.terms,c.id AS accessible_thread FROM artist_notifications n
      LEFT JOIN collaborations c ON n.target_kind='collaboration' AND c.id=n.thread AND (c.owner=n.recipient OR c.applicant=n.recipient)
      WHERE n.recipient=? AND n.id<? ORDER BY n.id DESC LIMIT 31`).all(recipient, before) as Row[];
    return { ...summary(recipient), nextCursor: rows.length > 30 ? rows[29].id : null,
      items: rows.slice(0,30).map((row): ArtistNotification => {
        const actor = artist(row.actor);
        const common = { id: row.id, actorId: row.actor, actorName: actor?.name ?? 'Artist unavailable', createdAt: row.created, readAt: row.read_at };
        if (row.target_kind==='conversation') return { ...common, kind: row.kind as ConversationNotificationKind, conversationId: row.target_conversation!, target:{type:'conversation',id:row.target_conversation!,available:conversationAvailable(row.target_conversation!,row.recipient)} };
        if (row.kind === 'artist.followed') return { ...common, kind: row.kind, target: { type: 'artist', id: row.target_artist!, available: !!actor && actor.id === row.target_artist } };
        let terms: { projectTitle: string; need: string } | null = null;
        try {
          const value: unknown = row.terms ? JSON.parse(row.terms) : null;
          if (value && typeof value === 'object' && 'projectTitle' in value && typeof value.projectTitle === 'string' && 'need' in value && typeof value.need === 'string') terms = { projectTitle: value.projectTitle, need: value.need };
        } catch { /* One missing/corrupt historical context must not break the inbox. */ }
        return { ...common, kind: row.kind as CollaborationNotificationKind, collaborationId: row.thread!, projectTitle: terms?.projectTitle ?? 'Collaboration unavailable', need: terms?.need ?? '',
          target: { type: 'collaboration', id: row.thread!, available: row.accessible_thread !== null && terms !== null } };
      }) };
  }
  function read(recipient: number, notificationId: number, now: string) {
    ensure(db.prepare('SELECT 1 FROM artist_notifications WHERE id=? AND recipient=?').get(notificationId, recipient), 'Notification not found.', 404);
    db.prepare('UPDATE artist_notifications SET read_at=COALESCE(read_at,?) WHERE id=? AND recipient=?').run(now, notificationId, recipient);
  }
  function readThrough(recipient: number, throughId: number, now: string) {
    ensure(db.prepare('SELECT 1 FROM artist_notifications WHERE id=? AND recipient=?').get(throughId, recipient), 'Notification not found.', 404);
    db.prepare('UPDATE artist_notifications SET read_at=? WHERE recipient=? AND id<=? AND read_at IS NULL').run(now, recipient, throughId);
  }
  return { record, recordConversation, recordFollow, summary, list, read, readThrough };
}
export type NotificationService = ReturnType<typeof notifications>;
