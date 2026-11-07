import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankPosts } from '../dist-server/server/ranking.js';

test('ranking rewards stars, decays older content and reserves discovery opportunities without duplicates', () => {
  const now = Date.parse('2026-11-06T00:00:00Z'), created = new Date(now).toISOString();
  const posts = Array.from({ length: 8 }, (_, index) => ({ id: index + 1, owner: 1, created, stars: 10 }));
  posts.push({ id: 9, owner: 2, created, stars: 0 });
  posts.push({ id: 10, owner: 3, created: '2025-01-01T00:00:00Z', stars: 1000 });
  const result = rankPosts(posts, now);
  assert.equal(result[3], 9); assert.equal(result.at(-1), 10);
  assert.equal(new Set(result).size, posts.length);
  assert.equal(rankPosts([{ id: 1, owner: 1, created, stars: 0 }, { id: 2, owner: 2, created, stars: 1 }], now)[0], 2);
});
