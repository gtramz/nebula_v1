import { useState } from 'react';
import { Bell } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest, isServerMode, type NotificationKind, type NotificationPage, type NotificationSummary } from '@nebula/local';
import { useAuth } from '@/context/AuthContext';

const button = 'border border-border px-4 py-3 text-sm hover:border-accent disabled:opacity-40';
const labels: Record<NotificationKind, string> = {
  contact: 'Started a collaboration conversation', message: 'Sent you a message', submit: 'Submitted a proposal',
  request_changes: 'Requested changes to your work', accept: 'Accepted your proposal', reject: 'Declined your proposal',
  withdraw: 'Withdrew their proposal', deliver: 'Sent a delivery', complete: 'Marked your collaboration completed',
  offer_updated: 'Updated the collaboration offer', offer_closed: 'Closed the collaboration offer',
};
function useSummary() {
  const { user } = useAuth();
  return useQuery({ queryKey: ['notification-summary', user?.artistId], queryFn: () => apiRequest<NotificationSummary>('/api/notifications/summary'),
    enabled: isServerMode() && user?.role === 'artist', staleTime: 5000, refetchInterval: 10_000, refetchOnWindowFocus: true });
}

export function NotificationBell({ navigation = false }: { navigation?: boolean }) {
  const { user } = useAuth(), query = useSummary();
  const [location] = useLocation();
  if (!isServerMode() || user?.role !== 'artist') return null;
  const count = query.data?.unreadCount ?? 0;
  const label = query.error ? 'Notifications, update unavailable' : `Notifications (${count} unread)`;
  return <Link href="/notifications" aria-label={label} title={label} aria-current={location === '/notifications' ? 'page' : undefined}
    className={navigation ? "sidebar-link relative text-muted hover:text-ink" : "relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border hover:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"}>
    <span className={navigation ? "nav-icon" : ""}><Bell aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} /></span>{navigation && <span className="sidebar-label text-sm">Notifications</span>}
    {(count > 0 || query.error) && <span aria-hidden="true" className="absolute -right-1 -top-1 min-w-5 rounded-full bg-accent px-1 text-center text-[10px] leading-5 font-bold text-bg">{query.error ? '!' : count > 99 ? '99+' : count}</span>}
  </Link>;
}

export function NotificationsPage() {
  const { user } = useAuth();
  if (!isServerMode()) return <p className="p-8">Notifications require the local server.</p>;
  if (!user) return <div className="p-8 space-y-4"><h1 className="text-3xl font-bold">Notifications</h1><p>Log in as an artist to view your notifications.</p><Link className="underline" href="/login">Log in</Link></div>;
  if (user.role !== 'artist') return <p className="p-8">Collaboration notifications are available to artist accounts.</p>;
  return <NotificationList key={user.artistId} artistId={user.artistId!} />;
}

function NotificationList({ artistId }: { artistId: number }) {
  const client = useQueryClient(), [, navigate] = useLocation();
  const [pending, setPending] = useState(false), [error, setError] = useState('');
  const query = useInfiniteQuery({ queryKey: ['notifications', artistId], initialPageParam: null as number | null,
    queryFn: ({ pageParam }) => apiRequest<NotificationPage>(`/api/notifications${pageParam ? `?before=${pageParam}` : ''}`),
    getNextPageParam: page => page.nextCursor ?? undefined, refetchInterval: 10_000, refetchOnWindowFocus: true });
  const first = query.data?.pages[0];
  const items = [...new Map(query.data?.pages.flatMap(page => page.items).map(item => [item.id, item]) ?? []).values()];

  async function markRead(data: { id: number } | { throughId: number }, destination?: number) {
    if (pending) return; setPending(true); setError('');
    try {
      const summary = await apiRequest<NotificationSummary>('/api/notifications/read', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      client.setQueryData(['notification-summary', artistId], summary);
      await client.invalidateQueries({ queryKey: ['notifications', artistId] });
      if (destination) navigate(`/collaborations/${destination}`);
    } catch (error) { setError((error as Error).message); }
    finally { setPending(false); }
  }
  return <section className="mx-auto w-full max-w-3xl p-6 pb-24 space-y-6">
    <Link href="/collaborations" className="underline text-sm">Your collaborations</Link>
    <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="voice text-xs text-accent">STAY IN THE LOOP</p><h1 className="text-3xl font-bold">Notifications</h1></div>
      <button className={button} disabled={pending || !first?.unreadCount || !!query.error} onClick={() => first?.latestId && void markRead({ throughId: first.latestId })}>Mark all as read</button></div>
    <p className="text-sm text-muted">Updates from your collaborations. Reading a notification is private; it does not send a read receipt.</p>
    {first && <p role="status" className="text-sm text-accent">{first.unreadCount} unread</p>}
    {(error || query.error) && <p role="alert" className="text-sm text-danger">{error || (query.error as Error).message}</p>}
    {query.error && <button className={button} onClick={() => void query.refetch()}>Retry notifications</button>}
    {query.isLoading && <p role="status">Loading notifications…</p>}
    {!query.isLoading && !query.error && !items.length && <div className="border border-border p-6 space-y-3"><h2 className="text-xl font-semibold">You’re all caught up.</h2><p className="text-muted">New messages, proposals and work updates will appear here.</p></div>}
    <div className="space-y-3">{items.map(item => <article key={item.id} aria-label={`${labels[item.kind]} · ${item.projectTitle} · ${item.need}`} className={`border p-5 space-y-3 ${item.readAt ? 'border-border' : 'border-accent/60 bg-accent/5'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-muted"><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString()}</time></p><span className={`text-xs ${item.readAt ? 'text-muted' : 'text-accent'}`}>{item.readAt ? 'Read' : 'Unread'}</span></div>
      <h2 className="text-lg font-semibold">{labels[item.kind]}</h2><p className="break-words text-sm">{item.actorName} · {item.projectTitle} · {item.need}</p>
      <div className="flex flex-wrap gap-3"><button className={button} disabled={pending} onClick={() => item.readAt ? navigate(`/collaborations/${item.collaborationId}`) : void markRead({ id: item.id }, item.collaborationId)}>View collaboration</button>
        {!item.readAt && <button className="px-2 py-3 text-sm underline disabled:opacity-40" disabled={pending} onClick={() => void markRead({ id: item.id })}>Mark as read</button>}</div>
    </article>)}</div>
    {query.hasNextPage && <button className={button} disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>Load earlier notifications</button>}
  </section>;
}
