import { ReturnLink } from '@/components/antiq/workspace';
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Bell, X } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest, isServerMode, type NotificationKind, type NotificationPage, type NotificationSummary } from '@nebula/local';
import { useAuth } from '@/context/AuthContext';
import './notifications.css';

const button = 'border border-border px-4 py-3 text-sm hover:border-accent disabled:opacity-40';
const labels: Record<NotificationKind, string> = {
  contact: 'Started a collaboration conversation', message: 'Sent you a message', submit: 'Submitted a proposal',
  request_changes: 'Requested changes to your work', accept: 'Accepted your proposal', reject: 'Declined your proposal',
  withdraw: 'Withdrew their proposal', deliver: 'Sent a delivery', complete: 'Marked your collaboration completed',
  offer_updated: 'Updated the collaboration offer', offer_closed: 'Closed the collaboration offer',
};
type NotificationControls = { open: boolean; locked: boolean; show: (trigger: HTMLElement) => void; close: () => void; setLocked: (value: boolean) => void; setReading: (value: boolean) => void };
const Controls = createContext<NotificationControls>({ open: false, locked: false, show: () => {}, close: () => {}, setLocked: () => {}, setReading: () => {} });
const Summary = createContext<{ count: number; error: boolean }>({ count: 0, error: false });
export function useNotificationsOpen() { return useContext(Controls).open; }
// Recording/rendering must finish or be cancelled before opening a modal over the studio.
export function useNotificationLock(locked: boolean) {
  const { setLocked } = useContext(Controls);
  useEffect(() => { setLocked(locked); return () => setLocked(false); }, [locked, setLocked]);
}
export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  return <NotificationCenter artistId={isServerMode() && user?.role === 'artist' ? user.artistId ?? undefined : undefined}>{children}</NotificationCenter>;
}
function NotificationCenter({ artistId, children }: { artistId?: number; children: ReactNode }) {
  const [location] = useLocation(), client = useQueryClient();
  const [openedFor, setOpenedFor] = useState<number>(), [locked, setLocked] = useState(false), [reading, setReading] = useState(false);
  const trigger = useRef<HTMLElement | null>(null), previousArtist = useRef(artistId);
  const open = !!artistId && openedFor === artistId;
  const summary = useQuery({ queryKey: ['notification-summary', artistId],
    queryFn: ({ signal }) => apiRequest<NotificationSummary>('/api/notifications/summary', { signal }),
    enabled: !!artistId && !reading, staleTime: 5000, refetchInterval: 10_000, refetchOnWindowFocus: true });
  useEffect(() => { setOpenedFor(undefined); }, [location]);
  useEffect(() => {
    if (previousArtist.current === artistId) return;
    const old = previousArtist.current; previousArtist.current = artistId;
    setOpenedFor(undefined); setReading(false);
    const filters = { predicate: (query: { queryKey: readonly unknown[] }) => ['notifications', 'notification-summary'].includes(String(query.queryKey[0])) && query.queryKey[1] === old };
    void client.cancelQueries(filters); client.removeQueries(filters);
  }, [artistId, client]);
  // Only this owner polls. The list refreshes when the summary changes, including other tabs.
  useEffect(() => { if (artistId && !reading) void client.invalidateQueries({ queryKey: ['notifications', artistId] }, { cancelRefetch: false }); }, [artistId, summary.data?.latestId, summary.data?.unreadCount, reading, client]);
  useEffect(() => {
    if (!open) return;
    const pause = (event: Event) => { if (event.target instanceof HTMLMediaElement) event.target.pause(); };
    document.querySelectorAll<HTMLMediaElement>('audio, video').forEach(media => media.pause());
    document.addEventListener('play', pause, true);
    return () => document.removeEventListener('play', pause, true);
  }, [open]);
  const controls = useMemo(() => ({ open, locked, setLocked, setReading,
    show: (element: HTMLElement) => { if (artistId && !locked) { trigger.current = element; setOpenedFor(artistId); } },
    close: () => setOpenedFor(undefined),
  }), [open, locked, artistId]);
  const badge = useMemo(() => ({ count: summary.data?.unreadCount ?? 0, error: !!summary.error }), [summary.data?.unreadCount, summary.error]);
  return <Controls.Provider value={controls}><Summary.Provider value={badge}>
    {children}
    <Dialog.Root open={open} onOpenChange={value => { if (!value) setOpenedFor(undefined); }}>
      <Dialog.Portal><Dialog.Overlay className="notifications-overlay" />
        <Dialog.Content className="notifications-panel" onCloseAutoFocus={event => {
          event.preventDefault();
          const fallback = [...document.querySelectorAll<HTMLElement>('[data-notification-bell]')].find(element => element.getClientRects().length);
          const target = trigger.current?.isConnected && trigger.current.getClientRects().length ? trigger.current : fallback;
          target?.focus({ preventScroll: true });
        }}>
          <header className="notifications-heading"><p className="voice text-xs text-accent">STAY IN THE LOOP</p><Dialog.Title className="text-3xl font-bold">Notifications</Dialog.Title><Dialog.Description className="text-sm text-muted">Updates from your collaborations.</Dialog.Description></header>
          <Dialog.Close className="notifications-close" aria-label="Close notifications"><X size={22} aria-hidden="true" /></Dialog.Close>
          {artistId && <NotificationList key={artistId} artistId={artistId} panel />}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  </Summary.Provider></Controls.Provider>;
}
export function NotificationBell({ navigation = false }: { navigation?: boolean }) {
  const { user } = useAuth(), { count, error } = useContext(Summary), controls = useContext(Controls);
  if (!isServerMode() || user?.role !== 'artist') return null;
  const label = error ? 'Notifications, update unavailable' : `Notifications (${count} unread)`;
  return <button type="button" data-notification-bell aria-label={label} title={controls.locked ? 'Finish or cancel the current recording or operation to open notifications.' : label}
    aria-haspopup="dialog" aria-expanded={controls.open} disabled={controls.locked} onClick={event => controls.show(event.currentTarget)}
    className={navigation ? "sidebar-link relative text-muted hover:text-ink disabled:opacity-40" : "relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border hover:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40"}>
    <span className={navigation ? "nav-icon" : ""}><Bell aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} /></span>{navigation && <span className="sidebar-label text-sm">Notifications</span>}
    {(count > 0 || error) && <span aria-hidden="true" className="absolute -right-1 -top-1 min-w-5 rounded-full bg-accent px-1 text-center text-[10px] leading-5 font-bold text-bg">{error ? '!' : count > 99 ? '99+' : count}</span>}
  </button>;
}

export function NotificationsPage() {
  const { user } = useAuth();
  if (!isServerMode()) return <p className="p-8">Notifications require the local server.</p>;
  if (!user) return <div className="p-8 space-y-4"><h1 className="text-3xl font-bold">Notifications</h1><p>Log in as an artist to view your notifications.</p><Link className="underline" href="/login">Log in</Link></div>;
  if (user.role !== 'artist') return <p className="p-8">Collaboration notifications are available to artist accounts.</p>;
  return <NotificationList key={user.artistId} artistId={user.artistId!} />;
}

function NotificationList({ artistId, panel = false }: { artistId: number; panel?: boolean }) {
  const client = useQueryClient(), [, navigate] = useLocation(), { close, setReading } = useContext(Controls);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => { request.current?.abort(); setReading(false); }, [setReading]);
  const [pending, setPending] = useState(false), [error, setError] = useState('');
  const query = useInfiniteQuery({ queryKey: ['notifications', artistId], initialPageParam: null as number | null,
    queryFn: ({ pageParam, signal }) => apiRequest<NotificationPage>(`/api/notifications${pageParam ? `?before=${pageParam}` : ''}`, { signal }),
    getNextPageParam: page => page.nextCursor ?? undefined, enabled: !pending, refetchOnWindowFocus: false });
  const first = query.data?.pages[0];
  const items = [...new Map(query.data?.pages.flatMap(page => page.items).map(item => [item.id, item]) ?? []).values()];

  async function markRead(data: { id: number } | { throughId: number }, destination?: number) {
    if (request.current) return;
    const abort = new AbortController(); request.current = abort; setPending(true); setReading(true); setError('');
    try {
      await Promise.all([client.cancelQueries({ queryKey: ['notification-summary', artistId] }), client.cancelQueries({ queryKey: ['notifications', artistId] })]);
      const summary = await apiRequest<NotificationSummary>('/api/notifications/read', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data), signal: abort.signal });
      if (abort.signal.aborted) return;
      client.setQueryData(['notification-summary', artistId], summary);
      await client.invalidateQueries({ queryKey: ['notifications', artistId] });
      if (destination) { close(); navigate(`/collaborations/${destination}`); }
    } catch (error) { if (!abort.signal.aborted) setError((error as Error).message); }
    finally { if (!abort.signal.aborted) { request.current = null; setPending(false); setReading(false); } }
  }
  return <section className={panel ? "space-y-6" : "mx-auto w-full max-w-3xl p-6 pb-24 space-y-6"}>
    {!panel && <ReturnLink href="/collaborations" onClick={close}>Your collaborations</ReturnLink>}
    <div className="flex flex-wrap items-center justify-between gap-3">{panel ? <Link href="/collaborations" onClick={close} className="inline-flex min-h-11 items-center underline text-sm">Your collaborations</Link> : <div><p className="voice text-xs text-accent">STAY IN THE LOOP</p><h1 className="text-3xl font-bold">Notifications</h1></div>}
      <button className={button} disabled={pending || !first?.unreadCount || !!query.error} onClick={() => first?.latestId && void markRead({ throughId: first.latestId })}>Mark all as read</button></div>
    {!panel && <p className="text-sm text-muted">Updates from your collaborations. Reading a notification is private; it does not send a read receipt.</p>}
    {first && <p role="status" className="text-sm text-accent">{first.unreadCount} unread</p>}
    {(error || query.error) && <p role="alert" className="text-sm text-danger">{error || (query.error as Error).message}</p>}
    {query.error && <button className={button} onClick={() => void query.refetch()}>Retry notifications</button>}
    {query.isLoading && <p role="status">Loading notifications…</p>}
    {!query.isLoading && !query.error && !items.length && <div className="border border-border p-6 space-y-3"><h2 className="text-xl font-semibold">You’re all caught up.</h2><p className="text-muted">New messages, proposals and work updates will appear here.</p></div>}
    <div className="space-y-3">{items.map(item => <article key={item.id} aria-label={`${labels[item.kind]} · ${item.projectTitle} · ${item.need}`} className={`border p-5 space-y-3 ${item.readAt ? 'border-border' : 'border-accent/60 bg-accent/5'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-muted"><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString()}</time></p><span className={`text-xs ${item.readAt ? 'text-muted' : 'text-accent'}`}>{item.readAt ? 'Read' : 'Unread'}</span></div>
      <h2 className="text-lg font-semibold">{labels[item.kind]}</h2><p className="break-words text-sm">{item.actorName} · {item.projectTitle} · {item.need}</p>
      <div className="flex flex-wrap gap-3"><Link className={button} href={`/collaborations/${item.collaborationId}`} aria-disabled={pending} onClick={event => { if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); if (pending) return; if (item.readAt) { close(); navigate(`/collaborations/${item.collaborationId}`); } else void markRead({ id: item.id }, item.collaborationId); }}>View collaboration</Link>
        {!item.readAt && <button className="px-2 py-3 text-sm underline disabled:opacity-40" disabled={pending} onClick={() => void markRead({ id: item.id })}>Mark as read</button>}</div>
    </article>)}</div>
    {query.hasNextPage && <button className={button} disabled={pending || query.isFetching} onClick={() => void query.fetchNextPage()}>Load earlier notifications</button>}
  </section>;
}
