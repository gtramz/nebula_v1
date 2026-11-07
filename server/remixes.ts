import type { DatabaseSync } from 'node:sqlite';
import type { PublicationInput, RemixAttribution, RemixInput } from '../lib/local/src/publications.js';
import { ensure, id, object } from './validation.js';

export type StoredRemix = Omit<RemixAttribution, 'available'> & { sourceMediaId: string };
export type StoredPublication = PublicationInput & { remix?: StoredRemix | null };
export function remixes(db: DatabaseSync, name: (id: number) => string) {
  function source(sourceId: number) { return db.prepare('SELECT * FROM posts WHERE id=?').get(sourceId) as { id: number; owner: number; data: string; revision: number } | undefined; }
  function permitted(sourceId: number) {
    const row = source(sourceId), data = row ? JSON.parse(row.data) as StoredPublication : null;
    ensure(row && data?.status === 'published' && data.allowRemix, 'The original is no longer available for remixing.', 409);
    ensure(!data.remix, 'Remixing another remix is not available yet.');
    const media = db.prepare('SELECT kind FROM media WHERE id=?').get(data.mediaId) as { kind: string } | undefined;
    ensure(media && ['audio','video'].includes(media.kind), 'Choose an audio or video original.');
    return { row, data, kind: media.kind };
  }
  function validate(raw: unknown, next: PublicationInput, existing?: StoredPublication): StoredRemix | null {
    if (existing?.remix) {
      ensure(!next.allowRemix, 'Remixes of remixes are not available yet.');
      const saved = existing.remix;
      if (raw !== undefined) {
        const supplied = object(raw);
        for (const key of ['sourceId','sourceRevision','startSeconds','endSeconds','baseGain','voiceGain','voiceOffset','contributionKind'] as const) ensure(supplied[key] === saved[key], 'Remix attribution and mix settings cannot be changed.');
      }
      ensure(next.mediaId === existing.mediaId, 'Start a new remix to change its media.');
      if (next.status === 'published' && existing.status !== 'published') {
        const original = permitted(saved.sourceId);
        ensure(original.data.mediaId === saved.sourceMediaId, 'The original media changed. Start a new remix.', 409);
      }
      return saved;
    }
    if (raw == null) return null;
    ensure(!next.allowRemix, 'Remixes of remixes are not available yet.');
    ensure(!existing, 'Start a new publication to create a remix.');
    const input = object(raw), original = permitted(id(input.sourceId));
    ensure(input.sourceRevision === original.row.revision, 'The original changed. Reload it before creating your remix.', 409);
    const finite = (key: string, min: number, max: number) => {
      const value = input[key]; ensure(typeof value === 'number' && Number.isFinite(value) && value >= min - 1e-9 && value <= max + 1e-9, `Invalid ${key}.`); return value;
    };
    ensure(input.contributionKind === 'audio' || input.contributionKind === 'video', 'Choose an audio or video contribution.');
    ensure(original.kind !== 'video' || input.contributionKind === 'video', 'A video original requires your own video.');
    const startSeconds = finite('startSeconds', 0, 600), endSeconds = finite('endSeconds', 0.1, 600);
    ensure(endSeconds - startSeconds >= .1 - 1e-9 && endSeconds - startSeconds <= 60 + 1e-9, 'Choose a fragment between 0.1 and 60 seconds.');
    const settings: RemixInput = { contributionKind: input.contributionKind, sourceId: original.row.id, sourceRevision: original.row.revision, startSeconds, endSeconds,
      baseGain: finite('baseGain', .05, 1), voiceGain: finite('voiceGain', .05, 1), voiceOffset: finite('voiceOffset', 0, endSeconds - startSeconds - .01) };
    const result = db.prepare('SELECT kind FROM media WHERE id=?').get(next.mediaId) as { kind: string };
    ensure(result.kind === (input.contributionKind === 'video' ? 'video' : 'audio'), 'The rendered format must match the contribution.');
    return { ...settings, artistId: original.row.owner, artistName: name(original.row.owner), title: original.data.title,
      projectId: original.data.projectId, grantedAt: new Date().toISOString(), sourceMediaId: original.data.mediaId };
  }
  function credit(remix?: StoredRemix | null): RemixAttribution | null {
    if (!remix) return null;
    const { sourceMediaId: _, ...publicCredit } = remix;
    const row = source(remix.sourceId);
    return { ...publicCredit, available: !!row && JSON.parse(row.data).status === 'published' };
  }
  return { validate, credit };
}
