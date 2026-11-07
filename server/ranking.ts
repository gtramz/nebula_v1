export type RankCandidate = { id: number; owner: number; created: string; stars: number };

// Popularity decays with age. Every fourth slot discovers a recent, small creator.
export function rankPosts(posts: RankCandidate[], now = Date.now()): number[] {
  const totals = new Map<number, number>();
  posts.forEach(post => totals.set(post.owner, (totals.get(post.owner) ?? 0) + post.stars));
  const score = (post: RankCandidate) => (1 + Math.log2(1 + post.stars)) / Math.pow(1 + Math.max(0, now - Date.parse(post.created)) / 86_400_000, .8);
  const ranked = [...posts].sort((a, b) => score(b) - score(a) || b.id - a.id);
  const fresh = posts.filter(post => now - Date.parse(post.created) <= 7 * 86_400_000 && (totals.get(post.owner) ?? 0) < 10).sort((a, b) => b.id - a.id);
  const used = new Set<number>(), discovered = new Set<number>(), result: number[] = [];
  for (let index = 0; index < posts.length; index++) {
    const discovery = index % 4 === 3 ? fresh.find(post => !used.has(post.id) && !discovered.has(post.owner)) : undefined;
    const next = discovery ?? ranked.find(post => !used.has(post.id));
    if (!next) break;
    used.add(next.id); if (discovery) discovered.add(next.owner); result.push(next.id);
  }
  return result;
}
