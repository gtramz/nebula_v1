import type { DatabaseSync } from 'node:sqlite';
import type { Artist } from '../lib/local/src/types.js';
import { ensure } from './validation.js';

export type FollowCreated = { type: 'artist.followed'; relationshipId: number; followerId: number; artistId: number; createdAt: string };
export function follows(db: DatabaseSync, artist: (id: number) => Artist | undefined) {
  db.exec(`CREATE TABLE IF NOT EXISTS artist_follows (
    id INTEGER PRIMARY KEY AUTOINCREMENT, follower INTEGER NOT NULL, artist INTEGER NOT NULL,
    created TEXT NOT NULL, UNIQUE(follower,artist), CHECK(follower<>artist));
    CREATE INDEX IF NOT EXISTS follows_by_artist ON artist_follows(artist,id);
    CREATE INDEX IF NOT EXISTS follows_by_follower ON artist_follows(follower,id);`);
  const exists = (follower: number | null, target: number) => follower !== null && !!db.prepare('SELECT 1 FROM artist_follows WHERE follower=? AND artist=?').get(follower,target);
  const followedIds = (follower: number) => new Set((db.prepare('SELECT artist FROM artist_follows WHERE follower=?').all(follower) as {artist:number}[]).map(row=>row.artist));
  const requireArtist = (target: number) => { const value = artist(target); ensure(value, 'Artist not found.', 404); return value; };
  function summary(target: number, viewer: number | null) {
    requireArtist(target);
    return { followers: (db.prepare('SELECT COUNT(*) AS n FROM artist_follows WHERE artist=?').get(target) as {n:number}).n,
      following: (db.prepare('SELECT COUNT(*) AS n FROM artist_follows WHERE follower=?').get(target) as {n:number}).n, isFollowing: exists(viewer,target) };
  }
  function change(follower: number, target: number, follow: boolean) {
    requireArtist(follower); requireArtist(target); ensure(follower !== target, 'You cannot follow yourself.');
    let event: FollowCreated | null = null;
    if (follow) {
      const createdAt = new Date().toISOString();
      const result = db.prepare('INSERT INTO artist_follows(follower,artist,created) VALUES(?,?,?) ON CONFLICT(follower,artist) DO NOTHING').run(follower,target,createdAt);
      // Only an actual insertion yields an occurrence. The caller records its
      // notification in the same synchronous SQLite transaction.
      if (result.changes) event = { type:'artist.followed', relationshipId:Number(result.lastInsertRowid), followerId:follower, artistId:target, createdAt };
    } else db.prepare('DELETE FROM artist_follows WHERE follower=? AND artist=?').run(follower,target);
    return { summary: summary(target,follower), event };
  }
  function list(target: number, direction: 'followers' | 'following', viewer: number | null, before: number) {
    requireArtist(target);
    const incoming = direction === 'followers';
    const rows = db.prepare(`SELECT id, ${incoming ? 'follower' : 'artist'} AS account FROM artist_follows WHERE ${incoming ? 'artist' : 'follower'}=? AND id<? ORDER BY id DESC LIMIT 25`).all(target,before) as {id:number;account:number}[];
    const page = rows.slice(0,24);
    return { items: page.flatMap(row => { const a=artist(row.account); return a ? [{ id:a.id,name:a.name,picture:a.picture ?? null,isFollowing:exists(viewer,a.id) }] : []; }), nextCursor: rows.length>24 ? page.at(-1)!.id : null };
  }
  return { summary, change, list, followedIds };
}
