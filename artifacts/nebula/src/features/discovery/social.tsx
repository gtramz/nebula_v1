import { ReturnLink } from '@/components/antiq/workspace';
import { useState } from 'react';
import { Link } from 'wouter';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest, isServerMode, type Publication } from '@nebula/local';
import { useAuth } from '@/context/AuthContext';

export async function refreshSocial(client: ReturnType<typeof useQueryClient>) {
  await Promise.all(['discovery-feed', 'publication', 'saved', 'comments'].map(key => client.invalidateQueries({ queryKey: [key] })));
}

export function LiveComments({ postId }: { postId: number }) {
  const { user } = useAuth(), client = useQueryClient();
  const [text, setText] = useState(''), [error, setError] = useState(''), [pending, setPending] = useState(false);
  const query = useInfiniteQuery({ queryKey: ['comments', postId, user?.artistId ?? user?.investorId ?? null], initialPageParam: null as number | null,
    queryFn: ({ pageParam }) => apiRequest<{ items: { id: number; author: string; text: string; canDelete: boolean }[]; nextCursor: number | null }>(`/api/publications/${postId}/comments${pageParam ? `?before=${pageParam}` : ''}`),
    getNextPageParam: page => page.nextCursor ?? undefined, refetchInterval: 15_000,
  });
  async function mutate(path: string, method: string, body?: object) {
    setPending(true); setError('');
    try { await apiRequest(path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); if (method === 'POST') setText(''); await refreshSocial(client); }
    catch (error) { setError((error as Error).message); } finally { setPending(false); }
  }
  const items = query.data?.pages.flatMap(page => page.items) ?? [];
  return <>
    {(error || query.error) && <p role="alert">{error || query.error?.message}</p>}
    {query.isLoading && <p role="status">Loading comments…</p>}
    {query.error && <button onClick={() => void query.refetch()}>Try again</button>}
    <div className="discovery-comments" aria-label="Comments">{items.map(item => <article key={item.id}><strong>{item.author}</strong><p className="whitespace-pre-wrap break-words">{item.text}</p>{item.canDelete && <button className="text-xs underline mt-2" aria-label={`Delete comment by ${item.author}`} disabled={pending} onClick={() => void mutate(`/api/publications/${postId}/comments/${item.id}`, 'DELETE')}>Delete comment</button>}</article>)}
      {!query.isLoading && !query.error && !items.length && <p>No comments yet. Start the conversation.</p>}
    </div>
    {query.hasNextPage && <button disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>Older comments</button>}
    {user ? <form className="discovery-comment-form" onSubmit={event => { event.preventDefault(); if (!pending && text.trim()) void mutate(`/api/publications/${postId}/comments`, 'POST', { text: text.trim() }); }}>
      <label htmlFor="live-comment">Add a comment</label><textarea id="live-comment" rows={3} maxLength={500} value={text} onChange={event => setText(event.target.value)} />
      <button className="discovery-primary" disabled={pending || !text.trim()}>{pending ? 'Saving…' : 'Post comment'}</button><p className="discovery-note">Comments are public. You and the publication owner can remove your comment.</p>
    </form> : <div className="discovery-auth-prompt"><p>Log in to leave a comment.</p><Link href="/login">log in</Link><Link href="/register">sign up</Link></div>}
  </>;
}

export function SavedPublications() {
  const { user } = useAuth(), client = useQueryClient();
  const [error, setError] = useState(''), [pending, setPending] = useState<number | null>(null);
  const query = useInfiniteQuery({ queryKey: ['saved', user?.artistId ?? user?.investorId ?? null], initialPageParam: null as number | null,
    queryFn: ({ pageParam }) => apiRequest<{ items: Publication[]; nextCursor: number | null }>(`/api/saved${pageParam ? `?before=${pageParam}` : ''}`),
    getNextPageParam: page => page.nextCursor ?? undefined, enabled: !!user && isServerMode(), refetchOnWindowFocus: true, refetchInterval: 15_000,
  });
  if (!user) return <div className="p-8"><p>Log in to see your private collection.</p><Link href="/login">log in</Link></div>;
  if (!isServerMode()) return <div className="p-8">Saved collections require the local server.</div>;
  const items = query.data?.pages.flatMap(page => page.items) ?? [];
  return <section className="max-w-3xl mx-auto p-6 space-y-6"><ReturnLink href="/profile">Back to profile</ReturnLink><h1 className="text-3xl font-bold">Saved publications</h1><p className="text-muted">Only you can see this collection. Withdrawn publications are hidden until their author publishes them again.</p>
    {(error || query.error) && <p role="alert">{error || query.error?.message}</p>}{query.error && <button onClick={() => void query.refetch()}>Try again</button>}
    {query.isLoading ? <p role="status">Loading saved publications…</p> : !items.length && !query.error ? <p>No saved publications yet.</p> : items.map(post => <article key={post.id} className="border border-border p-5 space-y-3"><Link className="text-xl underline" href={`/discovery?post=post-${post.id}`}>{post.title}</Link><p>{post.artistName}</p><button className="text-sm underline" disabled={pending !== null} onClick={async () => {
      setPending(post.id); setError(''); try { await apiRequest(`/api/publications/${post.id}/save`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: false }) }); await refreshSocial(client); } catch (error) { setError((error as Error).message); } finally { setPending(null); }
    }}>Remove from saved</button></article>)}
    {query.hasNextPage && <button disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>Load more</button>}
  </section>;
}
