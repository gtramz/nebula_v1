import { normalizeSearch, normalizeHomeFilters, normalizeHomeSearch, homeFilterEntries, opportunityNeeds, projectTypes, type HomeSearch, type HomeCriteria } from './opportunity-search.js';
export type SearchStorage = Pick<Storage, 'getItem' | 'setItem'>;
const memory = new Map<string, HomeSearch[]>();
const pendingWrites = new Set<string>();
export const homeHistoryKey = (identity: string) => `nebula:home-search:v1:${identity}`;
export function cleanHomeSearch(value: unknown): HomeSearch | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as HomeSearch;
  if (typeof v.q !== 'string' || v.q.length > 200 || !v.criteria || typeof v.criteria !== 'object') return null;
  const criteria: HomeCriteria = {}, c = v.criteria;
  if (typeof c.genre === 'string' && c.genre.trim() && c.genre.length <= 200) criteria.genre = c.genre.trim();
  if (opportunityNeeds.includes(c.need!)) criteria.need = c.need;
  if (c.compensation === 'split' || c.compensation === 'fee') criteria.compensation = c.compensation;
  if (c.opportunity === 'funding') criteria.opportunity = c.opportunity;
  if (projectTypes.includes(c.projectType as typeof projectTypes[number])) criteria.projectType = c.projectType;
  const q = v.q.trim(), filters = v.filters ? normalizeHomeFilters(v.filters) : undefined; return q || Object.keys(criteria).length || (filters && homeFilterEntries(filters).length) ? { q, criteria, ...(filters ? { filters } : {}) } : null;
}
export function searchHistoryIdentity(value: HomeSearch) {
  const normalized = normalizeHomeSearch(value);
  return JSON.stringify([normalizeSearch(value.q), ...Object.entries(normalized.filters).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => [k,v.map(normalizeSearch).sort()])]);
}
export function readHomeHistory(identity: string, storage?: SearchStorage): HomeSearch[] {
  const key = homeHistoryKey(identity);
  if (pendingWrites.has(key)) return memory.get(key) ?? [];
  try {
    const raw = storage?.getItem(key);
    if (raw != null) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const seen = new Set<string>(), result: HomeSearch[] = [];
        for (const v of parsed.slice(0,100)) { const item = cleanHomeSearch(v); if (item && !seen.has(searchHistoryIdentity(item))) { result.push(item); seen.add(searchHistoryIdentity(item)); } }
        memory.set(key, result.slice(0,10));
      }
    }
  } catch { /* Restricted or corrupt browser storage must not block search. */ }
  return memory.get(key) ?? [];
}
export function writeHomeHistory(identity: string, items: HomeSearch[], storage?: SearchStorage) {
  const key = homeHistoryKey(identity), values = items.slice(0,10); memory.set(key, values);
  try { if (!storage) throw new Error('Storage unavailable'); storage.setItem(key, JSON.stringify(values)); pendingWrites.delete(key); } catch { pendingWrites.add(key); /* Reads must not replace newer memory with an older persisted value. */ }
  return values;
}
export function rememberHomeSearch(identity: string, value: HomeSearch, storage?: SearchStorage) {
  const clean = cleanHomeSearch(value), previous = readHomeHistory(identity, storage);
  return clean ? writeHomeHistory(identity, [clean, ...previous.filter(item => searchHistoryIdentity(item) !== searchHistoryIdentity(clean))], storage) : previous;
}
