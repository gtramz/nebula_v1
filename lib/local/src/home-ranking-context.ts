// UI sequence identity only. Preferences remain in the canonical account store;
// no preference values, cursors or project records are copied into this cache.
const generations = new Map<number, number>();
const listeners = new Set<() => void>();

export function getHomeRankingGeneration(artistId?: number | null): number {
  return artistId ? generations.get(artistId) ?? 0 : 0;
}
export function subscribeHomeRanking(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function invalidateHomeRanking(artistId: number) {
  if (!Number.isSafeInteger(artistId) || artistId < 1) return;
  generations.set(artistId, getHomeRankingGeneration(artistId) + 1);
  listeners.forEach(listener => listener());
}
