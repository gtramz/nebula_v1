import type { DatabaseSync } from 'node:sqlite';
import type { ArtistNotification, NotificationKind, NotificationPage, NotificationSummary } from '../lib/local/src/notifications.js';
import { ensure } from './validation.js';

type Row = { id: number; thread: number; actor: number; kind: NotificationKind; created: string; read_at: string | null; terms: string };

export function notifications(db: DatabaseSync, name: (id: number) => string) {
  db.exec(`CREATE TABLE IF NOT EXISTS artist_notifications(
    id INTEGER PRIMARY KEY AUTOINCREMENT, recipient INTEGER NOT NULL, actor INTEGER NOT NULL,
    thread INTEGER NOT NULL, kind TEXT NOT NULL, created TEXT NOT NULL, read_at TEXT);
    CREATE INDEX IF NOT EXISTS notifications_recipient ON artist_notifications(recipient,id);
    CREATE INDEX IF NOT EXISTS notifications_unread ON artist_notifications(recipient,id) WHERE read_at IS NULL;`);

  // Call within the transaction that records the action: neither can outlive the other.
  function record(recipient: number, actor: number, thread: number, kind: NotificationKind, created: string) {
    if (recipient === actor) return;
    db.prepare('INSERT INTO artist_notifications(recipient,actor,thread,kind,created) VALUES(?,?,?,?,?)').run(recipient, actor, thread, kind, created);
  }
  function summary(recipient: number): NotificationSummary {
    const unread = db.prepare('SELECT COUNT(*) n FROM artist_notifications WHERE recipient=? AND read_at IS NULL').get(recipient) as { n: number };
    const latest = db.prepare('SELECT MAX(id) id FROM artist_notifications WHERE recipient=?').get(recipient) as { id: number | null };
    return { unreadCount: unread.n, latestId: latest.id };
  }
  function list(recipient: number, before: number): NotificationPage {
    const rows = db.prepare(`SELECT n.*,c.terms FROM artist_notifications n JOIN collaborations c ON c.id=n.thread
      WHERE n.recipient=? AND n.id<? ORDER BY n.id DESC LIMIT 31`).all(recipient, before) as Row[];
    return { ...summary(recipient), nextCursor: rows.length > 30 ? rows[29].id : null,
      items: rows.slice(0,30).map((row): ArtistNotification => {
        const terms = JSON.parse(row.terms) as { projectTitle: string; need: string };
        return { id: row.id, collaborationId: row.thread, actorName: name(row.actor), projectTitle: terms.projectTitle,
          need: terms.need, kind: row.kind, createdAt: row.created, readAt: row.read_at };
      }) };
  }
  function read(recipient: number, notificationId: number, now: string) {
    ensure(db.prepare('SELECT 1 FROM artist_notifications WHERE id=? AND recipient=?').get(notificationId, recipient), 'Notification not found.', 404);
    db.prepare('UPDATE artist_notifications SET read_at=COALESCE(read_at,?) WHERE id=? AND recipient=?').run(now, notificationId, recipient);
  }
  function readThrough(recipient: number, throughId: number, now: string) {
    // The client sends the last observed ID; newer arrivals must stay unread.
    ensure(db.prepare('SELECT 1 FROM artist_notifications WHERE id=? AND recipient=?').get(throughId, recipient), 'Notification not found.', 404);
    db.prepare('UPDATE artist_notifications SET read_at=? WHERE recipient=? AND id<=? AND read_at IS NULL').run(now, recipient, throughId);
  }
  return { record, summary, list, read, readThrough };
}
