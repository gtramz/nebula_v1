import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { OpportunityProject } from '../lib/local/src/opportunities.js';
import type { HomeMode } from '../lib/local/src/opportunity-search.js';
import { ensure } from './validation.js';
import { compareHomeAffinityScores, type HomeAffinityScore } from './home-affinity.js';

export type GeneralProjectOrder = (items: readonly OpportunityProject[]) => OpportunityProject[];
export const generalProjectOrder: GeneralProjectOrder = items => [...items].sort((a,b) => b.project.id - a.project.id);
export function orderHomeProjects(items: OpportunityProject[], mode: HomeMode, generalOrder = generalProjectOrder) {
  return mode === 'recent' ? [...items].sort((a,b) => Date.parse(b.project.createdAt) - Date.parse(a.project.createdAt) || b.project.id - a.project.id) : generalOrder(items);
}
type RankScore = HomeAffinityScore;
type RankedProject = { item: OpportunityProject; score: RankScore };
type HomeCursor = { version: 1; mode: HomeMode; id: number; created: number; signature: string; score: RankScore };
type HomeCursorCodec = { encode: (value: HomeCursor) => string; decode: (value: string) => unknown };

/** Opaque authenticated cursors belong to one server lifetime. Restarting expires
 * cursors, not data. No preferences, scores or account references are readable. */
export function createHomeCursorCodec(): HomeCursorCodec {
  const key = randomBytes(32);
  return {
    encode(value) {
      const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
      const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64url');
    },
    decode(value) {
      const data = Buffer.from(value, 'base64url');
      const decipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
      decipher.setAuthTag(data.subarray(12, 28));
      return JSON.parse(Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8')) as unknown;
    },
  };
}

export function pageHomeProjects(items: OpportunityProject[], mode: HomeMode, cursor: string | null, before: number, signature: string,
  codec: HomeCursorCodec, ranked?: readonly RankedProject[]) {
  // Rebuild eligible inventory on every request. The cursor is an ordering
  // boundary, never an eligibility snapshot or authority to return closed offers.
  let remaining: RankedProject[] = mode === 'for-you' && ranked ? [...ranked]
    : orderHomeProjects(items, mode).map(item => ({ item, score: [0,0,0,0] }));
  if (cursor) {
    let parsed: Partial<HomeCursor> | null = null;
    try { parsed = codec.decode(cursor) as Partial<HomeCursor>; } catch { /* Fail closed below. */ }
    ensure(parsed && parsed.version === 1 && parsed.mode === mode && parsed.signature === signature && Number.isSafeInteger(parsed.id) && parsed.id! > 0 && Number.isFinite(parsed.created)
      && Array.isArray(parsed.score) && parsed.score.length === 4 && parsed.score.every(value => Number.isInteger(value) && value >= 0 && value <= 2), 'Home results changed or the cursor expired. Refresh Home.');
    const boundary = parsed!;
    remaining = remaining.filter(({ item: { project: p }, score }) => mode === 'recent'
      ? Date.parse(p.createdAt) < boundary.created! || (Date.parse(p.createdAt) === boundary.created && p.id < boundary.id!)
      : mode === 'for-you' && ranked
        ? compareHomeAffinityScores(score, boundary.score!) > 0 || (compareHomeAffinityScores(score, boundary.score!) === 0 && p.id < boundary.id!)
        : p.id < boundary.id!);
  } else if (before < Number.MAX_SAFE_INTEGER) {
    if (mode === 'for-you' && ranked) {
      // Compatibility for older numeric-cursor callers. Current clients use the
      // context-bound opaque cursor. A missing legacy anchor requires a fresh page.
      const anchor = remaining.findIndex(({ item }) => item.project.id === before);
      ensure(anchor >= 0, 'Home results changed. Refresh Home.');
      remaining = remaining.slice(anchor + 1);
    } else remaining = remaining.filter(({ item }) => item.project.id < before);
  }
  const page = remaining.slice(0,24), last = page.at(-1), hasNext = remaining.length > 24;
  const nextPageCursor = hasNext && last ? codec.encode({ version: 1, mode, id: last.item.project.id, created: Date.parse(last.item.project.createdAt), signature, score: last.score }) : null;
  return { items: page.map(entry => entry.item), nextCursor: hasNext && last ? last.item.project.id : null, nextPageCursor };
}
