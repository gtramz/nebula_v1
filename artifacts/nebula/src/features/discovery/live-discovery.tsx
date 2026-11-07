import { useMemo } from 'react';
import { ReturnLink } from '@/components/antiq/workspace';
import { useSearch, Link } from 'wouter';
import { isServerMode, type Publication } from '@nebula/local';
import Discovery from '@/pages/discovery';
import { usePublication, useDiscoveryFeed } from './publication-api';
import type { DemoPost } from './demo-posts';
import { useAuth } from '@/context/AuthContext';

const presentationCache = new WeakMap<Publication, DemoPost>();
function asFeedPost(post: Publication): DemoPost {
  const cached = presentationCache.get(post); if (cached) return cached;
  const result = toFeedPost(post); presentationCache.set(post, result); return result;
}
function toFeedPost(post: Publication): DemoPost {
  return {
    id: `post-${post.id}`, title: post.title, author: post.artistName, artistId: post.artistId,
    initials: post.artistName.split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase(),
    genre: post.project?.category ?? 'independent release', description: post.description,
    media: { kind: post.media.kind as 'audio' | 'video', src: post.media.url, durationSeconds: 0 },
    coverUrl: post.coverUrl, tone: post.media.kind === 'video' ? 'cyan' : 'amber', stars: post.social.stars, social: post.social, remixAllowed: post.allowRemix, comments: [],
    projectId: post.project?.id,
    original: post.remix ? { postId: `post-${post.remix.sourceId}`, title: post.remix.title, author: post.remix.artistName, available: post.remix.available } : undefined,
    project: post.project ? { title: post.project.title, artist: post.project.artistName, stage: post.project.status,
      description: post.project.story ?? post.project.pitch ?? '', goal: post.project.goalAmount, raised: post.project.raisedAmount,
      useOfFunds: (post.project.useOfFunds ?? []).map(item => ({ label: item.label, percent: item.percentage })), offers: post.offers.filter(offer => offer.available).map(offer => ({ id: String(offer.id), need: offer.need, deliverable: offer.deliverable, compensation: offer.compensation })) } : undefined,
  };
}

export default function DiscoveryPage() {
  const search = useSearch();
  const params = new URLSearchParams(search);
  if (!isServerMode()) return <Discovery />;
  if (params.get('demo') === '1') return <><div className="text-center text-xs py-2 border-b border-border"><ReturnLink href="/discovery">Back to artist publications</ReturnLink></div><Discovery /></>;
  return <LiveDiscovery selected={/^post-\d+$/.test(params.get('post') ?? '') ? Number(params.get('post')!.slice(5)) : undefined} />;
}

function LiveDiscovery({ selected }: { selected?: number }) {
  const { user } = useAuth();
  const query = useDiscoveryFeed(), single = usePublication(selected, true);
  const items = useMemo(() => query.data?.pages.flatMap(page => page.items) ?? [], [query.data]);
  const selectedPost = single.data?.status === 'published' ? single.data : undefined;
  const posts = useMemo(() => (selectedPost ? [selectedPost, ...items.filter(post => post.id !== selected)] : items).map(asFeedPost), [selectedPost, items, selected]);
  const error = single.error ?? query.error;
  if (query.isLoading || (selected && single.isLoading)) return <div className="m-auto p-10" role="status">Loading Discovery…</div>;
  if (error && (!posts.length || [401,403,404].includes((error as Error & { status?: number }).status ?? 0))) return <div className="m-auto p-10 space-y-4"><p role="alert">{error.message}</p><button className="underline" onClick={() => { void query.refetch(); if (selected) void single.refetch(); }}>Try again</button><p><a href="/discovery">All publications</a></p></div>;
  if (!posts.length) return <div className="m-auto p-8 max-w-lg space-y-6"><p className="voice text-xs text-muted">discovery</p><h1 className="text-4xl font-bold">The next sound could be yours.</h1><p className="text-muted">No publications yet. Share an audio or video to start the conversation.</p><div className="flex flex-wrap gap-4">{user?.role === 'artist' ? <Link className="bg-cream text-bg px-6 py-3" href="/publish">Create publication</Link> : <Link className="border border-border px-6 py-3" href="/login">Log in</Link>}<a className="border border-border px-6 py-3" href="/discovery?demo=1">View the demo</a></div></div>;
  return <>{error && <div role="alert" className="px-4 py-2 text-sm">{error.message} <button className="underline min-h-11" onClick={() => { void query.refetch(); if (selected) void single.refetch(); }}>Try again</button></div>}<Discovery key={selected ?? 'feed'} posts={posts} live onLoadMore={query.hasNextPage ? () => { void query.fetchNextPage(); } : undefined} loadingMore={query.isFetchingNextPage} /></>;
}
