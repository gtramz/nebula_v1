import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import './following.css';
import { useEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { apiRequest, isServerMode } from '@nebula/local';
import { useAuth } from '@/context/AuthContext';
import { controlStyles } from '@/components/antiq/workspace';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Dialog, DialogPortal, DialogOverlay, DialogClose, DialogTitle, DialogDescription } from '@/components/ui/dialog';

type Summary = { followers:number; following:number; isFollowing:boolean };
type FollowPage = { items:{id:number;name:string;picture:string|null;isFollowing:boolean}[]; nextCursor:number|null };
const prefixes = ['artist-social','artist-follow-list','opportunity-projects','home-suggestions'];
export function useFollowSync() {
  const client = useQueryClient();
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel('nebula-follow-changes');
    channel.onmessage = () => { void client.invalidateQueries({ predicate:q=>prefixes.includes(String(q.queryKey[0])) }); };
    return () => channel.close();
  },[client]);
}
function useViewer() {
  const { user } = useAuth();
  return { user, identity:user ? `${user.role}:${user.artistId ?? user.investorId}` : 'guest' };
}
function FollowButton({artistId,following}:{artistId:number;following:boolean}) {
  const {user}=useViewer(), client=useQueryClient();
  const change=useMutation({mutationFn:()=>apiRequest<Summary>(`/api/artists/${artistId}/follow`,{method:following?'DELETE':'PUT'}),onSuccess:async()=>{
    if (typeof BroadcastChannel !== 'undefined') { const channel=new BroadcastChannel('nebula-follow-changes'); channel.postMessage('changed');channel.close(); }
    await client.invalidateQueries({predicate:q=>prefixes.includes(String(q.queryKey[0]))});
  }});
  if (!user) return <Link href="/login" className={controlStyles.button}>Sign in to follow</Link>;
  if (user.role !== 'artist' || user.artistId === artistId) return null;
  return <div className="space-y-1"><button className={controlStyles.button} aria-pressed={following} title={following?'Unfollow artist':'Follow artist'} disabled={change.isPending} onClick={()=>change.mutate()}>{change.isPending?'Updating…':following?'Following':'Follow'}</button>{change.error && <p role="alert" className="text-xs text-danger max-w-64">{change.error.message} Try again.</p>}</div>;
}
export function ArtistFollowControls({artistId}:{artistId:number}) {
  const {identity}=useViewer();
  return isServerMode() ? <SocialControls key={`${identity}:${artistId}`} artistId={artistId} identity={identity} /> : <p className="text-xs text-muted">Following is available in the connected environment.</p>;
}
function SocialControls({artistId,identity}:{artistId:number;identity:string}) {
  useFollowSync();
  const [direction,setDirection]=useState<'followers'|'following'|null>(null);
  const trigger=useRef<HTMLButtonElement|null>(null);
  const query=useQuery({queryKey:['artist-social',identity,artistId],queryFn:({signal})=>apiRequest<Summary>(`/api/artists/${artistId}/social`,{signal}),refetchInterval:15000,staleTime:0});
  const list=useInfiniteQuery({queryKey:['artist-follow-list',identity,artistId,direction],enabled:!!direction,initialPageParam:null as number|null,
    queryFn:({pageParam,signal})=>apiRequest<FollowPage>(`/api/artists/${artistId}/${direction}${pageParam?`?before=${pageParam}`:''}`,{signal}),
    getNextPageParam:page=>page.nextCursor??undefined,refetchInterval:15000,staleTime:0});
  if (query.isPending) return <p role="status" className="text-sm text-muted">Loading follow information…</p>;
  if (query.isError) return <div><p role="alert">Follow information unavailable.</p><button className={controlStyles.button} onClick={()=>void query.refetch()}>Retry follow information</button></div>;
  const items=[...new Map((list.data?.pages.flatMap(p=>p.items)??[]).map(a=>[a.id,a])).values()];
  return <div className="flex flex-wrap gap-3 items-center">
    {(['followers','following'] as const).map(kind=><button key={kind} className={controlStyles.button} onClick={event=>{trigger.current=event.currentTarget;setDirection(kind);}} aria-label={`${query.data[kind]} ${kind}`}><strong>{query.data[kind]}</strong> {kind}</button>)}
    <FollowButton artistId={artistId} following={query.data.isFollowing} />
    <Dialog open={!!direction} onOpenChange={open=>{if(!open)setDirection(null);}}>
      <DialogPortal><DialogOverlay className="z-[80]" /><DialogPrimitive.Content className="follow-panel" onCloseAutoFocus={event=>{event.preventDefault();if(trigger.current?.isConnected)trigger.current.focus();}}>
        <header className="space-y-2 pr-12 shrink-0"><DialogClose className="absolute top-3 right-3 min-h-11 min-w-11 flex items-center justify-center" aria-label="Close artist connections"><X size={20} aria-hidden /></DialogClose>
        <DialogTitle>{direction==='followers'?'Followers':'Following'}</DialogTitle>
        <DialogDescription>Artist connections. Following does not grant access to private work.</DialogDescription></header>
        <div className="min-h-0 overflow-y-auto space-y-4">{list.isPending?<p role="status">Loading artists…</p>:list.isError?<div><p role="alert">{list.error.message}</p><button className={controlStyles.button} onClick={()=>void list.refetch()}>Retry artists</button></div>:<>
          {!items.length && <p className="text-muted">{direction==='followers'?'No followers yet.':'Not following any artists yet.'}</p>}
          <ul className="space-y-4 min-w-0">{items.map(a=><li key={a.id} className="flex flex-wrap gap-3 items-center border-b border-border pb-3"><Link href={`/artist/${a.id}`} onClick={()=>setDirection(null)} className="flex min-h-11 gap-3 items-center flex-1 min-w-0"><Avatar aria-hidden="true"><AvatarImage src={a.picture??undefined} alt=""/><AvatarFallback>{a.name.slice(0,1)}</AvatarFallback></Avatar><span className="break-words min-w-0">{a.name}</span></Link><FollowButton artistId={a.id} following={a.isFollowing}/></li>)}</ul>
          {list.hasNextPage && <button className={controlStyles.button} disabled={list.isFetchingNextPage} onClick={()=>void list.fetchNextPage()}>{list.isFetchingNextPage?'Loading…':'Load more artists'}</button>}
        </>}</div>
      </DialogPrimitive.Content></DialogPortal>
    </Dialog>
  </div>;
}
