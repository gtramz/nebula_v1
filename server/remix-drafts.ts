import type { IncomingMessage, ServerResponse } from 'node:http';
import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import type { SessionUser } from '../lib/local/src/types.js';
import type { RemixInput, UploadedMedia } from '../lib/local/src/publications.js';
import type { RemixDraft } from '../lib/local/src/remix-drafts.js';
import { ensure, HttpError, id, object, text } from './validation.js';

type Media = UploadedMedia & { owner: number };
type Saved = { title: string; description: string; settings: RemixInput; attribution: RemixDraft['attribution']; sourceMediaId: string; contributionId: string | null; contributionDuration: number | null; renderId: string | null; renderRevision: number | null };
type Row = { id: string; owner: number; revision: number; data: string; created: string; updated: string };
export function remixDrafts(d: { db: DatabaseSync; current(req: IncomingMessage, artistOnly?: boolean): SessionUser; body(req: IncomingMessage): Promise<Record<string, unknown>>; json(res: ServerResponse, value: unknown, status?: number): void; media(id: string): Media | undefined; name(id: number): string }) {
  const { db } = d;
  db.exec(`CREATE TABLE IF NOT EXISTS remix_drafts(id TEXT PRIMARY KEY, owner INTEGER NOT NULL, request_key TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, data TEXT NOT NULL, created TEXT NOT NULL, updated TEXT NOT NULL, UNIQUE(owner,request_key));
    CREATE INDEX IF NOT EXISTS remix_drafts_owner ON remix_drafts(owner,updated);
    CREATE TABLE IF NOT EXISTS remix_private_media(media TEXT PRIMARY KEY, draft TEXT NOT NULL, owner INTEGER NOT NULL);`);
  function owned(draftId: string, owner: number) {
    const row = db.prepare('SELECT * FROM remix_drafts WHERE id=? AND owner=?').get(draftId, owner) as Row | undefined;
    ensure(row, 'Remix draft not found.', 404); return row;
  }
  function source(sourceId: number, revision: number) {
    const row = db.prepare('SELECT * FROM posts WHERE id=?').get(sourceId) as { owner: number; data: string; revision: number } | undefined;
    const value = row && JSON.parse(row.data);
    ensure(row && value.status === 'published' && value.allowRemix && !value.remix, 'The original is no longer available for remixing.', 409);
    ensure(row.revision === revision, 'The original changed. Start a new draft from Discovery; your saved draft is preserved.', 409);
    const media = d.media(value.mediaId); ensure(media && ['audio','video'].includes(media.kind), 'Original unavailable.', 409);
    return { row, value, media };
  }
  function permitted(row: Row) { const saved: Saved = JSON.parse(row.data), original = source(saved.settings.sourceId, saved.settings.sourceRevision); ensure(original.media.id === saved.sourceMediaId, 'The original media changed.', 409); return original; }
  function dto(row: Row): RemixDraft {
    const saved: Saved = JSON.parse(row.data);
    const media = (key: string | null) => { if (!key) return null; const value = d.media(key); ensure(value, 'A saved file is unavailable.', 409); const { owner: _, ...result } = value; return result; };
    return { id: row.id, ownerId: row.owner, revision: row.revision, createdAt: row.created, updatedAt: row.updated,
      title: saved.title, description: saved.description, settings: saved.settings, attribution: saved.attribution,
      contribution: saved.contributionId ? { ...media(saved.contributionId)!, duration: saved.contributionDuration! } : null,
      render: media(saved.renderId), renderRevision: saved.renderRevision };
  }
  function isPrivate(media: string) { return !!db.prepare('SELECT 1 FROM remix_private_media WHERE media=?').get(media); }
  function used(media: string) { return !!db.prepare("SELECT 1 FROM remix_drafts WHERE json_extract(data,'$.contributionId')=? OR json_extract(data,'$.renderId')=?").get(media, media); }
  function authorizeUpload(draftId: string, owner: number) { const row = owned(draftId, owner); permitted(row); return row; }
  function bind(media: string, draftId: string, owner: number) { authorizeUpload(draftId, owner); db.prepare('INSERT INTO remix_private_media(media,draft,owner) VALUES(?,?,?)').run(media, draftId, owner); }
  function privateFile(media: unknown, row: Row) {
    const mediaId = text(media, 'Media', 36, 36), value = d.media(mediaId);
    ensure(value && value.owner === row.owner && db.prepare('SELECT 1 FROM remix_private_media WHERE media=? AND draft=? AND owner=?').get(mediaId, row.id, row.owner), 'Choose a private file uploaded to this draft.');
    return value;
  }
  function proposal(draftId: string, owner: number, mediaId: string, projectId: number) {
    const row = owned(draftId, owner), value: Saved = JSON.parse(row.data); permitted(row);
    ensure(value.renderId === mediaId && value.renderRevision !== null && value.attribution.projectId === projectId, 'Save a current preview of your remix for this project.', 409);
    return { draftId: row.id, draftRevision: row.revision, title: value.title, originalTitle: value.attribution.title, originalArtist: value.attribution.artistName };
  }
  async function handle(req: IncomingMessage, res: ServerResponse, url: URL) {
    const match = /^\/api\/remix-drafts\/([a-f0-9-]{36})$/.exec(url.pathname);
    if (!match && url.pathname !== '/api/remix-drafts') return false;
    const owner = d.current(req, true).artistId!;
    if (req.method === 'GET') {
      d.json(res, match ? dto(owned(match[1], owner)) : { items: (db.prepare('SELECT * FROM remix_drafts WHERE owner=? ORDER BY updated DESC').all(owner) as Row[]).map(dto) }); return true;
    }
    const input = await d.body(req), now = new Date().toISOString();
    ensure(d.current(req, true).artistId === owner, 'Session expired.', 401);
    if (!match && req.method === 'POST') {
      const requestKey = text(input.requestKey, 'Request key', 80, 16), sourceId = id(input.sourceId), sourceRevision = id(input.sourceRevision);
      const original = source(sourceId, sourceRevision);
      const existing = db.prepare('SELECT * FROM remix_drafts WHERE owner=? AND request_key=?').get(owner, requestKey) as Row | undefined;
      if (existing) { const settings = JSON.parse(existing.data).settings; ensure(settings.sourceId === sourceId && settings.sourceRevision === sourceRevision, 'Request key already used for a different original.', 409); d.json(res, dto(existing)); return true; }
      const draftId = randomUUID(), settings: RemixInput = { sourceId, sourceRevision, startSeconds: 0, endSeconds: .1, baseGain: .65, voiceGain: .8, voiceOffset: 0 };
      const saved: Saved = { title: `${original.value.title} — remix`.slice(0,160), description: '', settings,
        attribution: { sourceId, sourceRevision, artistId: original.row.owner, artistName: d.name(original.row.owner), title: original.value.title, projectId: original.value.projectId, grantedAt: now },
        sourceMediaId: original.media.id, contributionId: null, contributionDuration: null, renderId: null, renderRevision: null };
      db.prepare('INSERT INTO remix_drafts(id,owner,request_key,data,created,updated) VALUES(?,?,?,?,?,?)').run(draftId, owner, requestKey, JSON.stringify(saved), now, now);
      d.json(res, dto(owned(draftId, owner)), 201); return true;
    }
    if (match && req.method === 'PATCH') {
      const row = owned(match[1], owner), saved: Saved = JSON.parse(row.data), original = permitted(row);
      ensure(input.revision === row.revision, 'This draft changed in another tab. Reopen the saved draft before saving again; your current edit has not been overwritten.', 409);
      if (input.action === 'prepare-render') { d.json(res, dto(row)); return true; }
      const raw = object(input.settings);
      ensure(raw.sourceId === saved.settings.sourceId && raw.sourceRevision === saved.settings.sourceRevision, 'The source and its attribution cannot be changed.');
      const number = (key: string, min: number, max: number) => { const value = raw[key]; ensure(typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max, `Invalid ${key}.`); return value; };
      const startSeconds = number('startSeconds',0,600), endSeconds = number('endSeconds',.1,600), duration = endSeconds-startSeconds;
      ensure(duration >= .1-1e-9 && duration <= 60+1e-9, 'Choose a fragment between 0.1 and 60 seconds.');
      const contribution = input.contributionId == null ? null : privateFile(input.contributionId, row);
      ensure(!contribution || ['audio','video'].includes(contribution.kind), 'Choose audio or video.');
      ensure(!contribution || original.media.kind !== 'video' || contribution.kind === 'video', 'A video original requires your own video.');
      ensure(!contribution || contribution.kind !== 'audio' || contribution.size <= 25*1024*1024, 'Audio contributions must be up to 25 MB.');
      if (contribution) ensure(typeof input.contributionDuration === 'number' && input.contributionDuration > 0 && input.contributionDuration <= 120, 'Contribution must be up to 120 seconds.');
      const settings: RemixInput = { sourceId: saved.settings.sourceId, sourceRevision: saved.settings.sourceRevision, startSeconds, endSeconds, baseGain: number('baseGain',.05,1), voiceGain: number('voiceGain',.05,1), voiceOffset: number('voiceOffset',0,duration-.01), ...(contribution ? { contributionKind: contribution.kind as 'audio'|'video' } : {}) };
      const render = input.renderId == null ? null : privateFile(input.renderId, row);
      ensure(!render || (contribution && render.kind === contribution.kind && render.id !== contribution.id), 'The rendered format must match the contribution.');
      const changed = JSON.stringify(settings) !== JSON.stringify(saved.settings) || contribution?.id !== (saved.contributionId ?? undefined);
      ensure(!render || !changed || render.id !== saved.renderId, 'Rebuild the preview after changing the fragment, gains or contribution.', 409);
      const next: Saved = { ...saved, title: text(input.title,'Title',160,1), description: text(input.description,'Description',2000), settings, contributionId: contribution?.id ?? null, contributionDuration: contribution ? input.contributionDuration as number : null, renderId: render?.id ?? null, renderRevision: render ? row.revision+1 : null };
      db.prepare('UPDATE remix_drafts SET data=?,revision=revision+1,updated=? WHERE id=? AND revision=?').run(JSON.stringify(next),now,row.id,row.revision);
      d.json(res, dto(owned(row.id,owner))); return true;
    }
    throw new HttpError(405,'Method not allowed.');
  }
  return { handle, isPrivate, used, authorizeUpload, bind, proposal };
}
