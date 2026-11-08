import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { apiRequest, isServerMode, type ConversationKind, type ConversationMessage } from '@nebula/local';
import { useAuth } from '@/context/AuthContext';
import { useWorkspaceDraft } from '@/features/collaborations/drafts';
import { Panel, controlStyles } from '@/components/antiq/workspace';

export const { field, button, primary } = controlStyles;
export function ArtistMessagesAccess({children}:{children:ReactNode}) {
 const {user}=useAuth();
 if(!isServerMode()) return <p className="p-8">Messages require the local server.</p>;
 if(!user) return <section className="p-8 space-y-4"><h1 className="text-3xl font-bold">Messages</h1><p>Log in as an artist to send and review requests.</p><Link className={button} href="/login">Log in</Link><Link className={button} href="/register">Create account</Link></section>;
 if(user.role!=='artist')return <p className="p-8">Messages are available to artist accounts.</p>;
 return children;
}
export function Failure({error}:{error:unknown}) {return error?<p role="alert" className="text-sm text-danger">{error instanceof Error?error.message:String(error)}</p>:null;}
/** One verified key per pending payload; successful sends retire it, including equal-text messages. */
export function useMessageOperation(key:string) {
 const [saved,setSaved]=useWorkspaceDraft<Record<string,string>>(`operations-${key}`,{}), keys=useRef(saved), alive=useRef(true), abort=useRef<AbortController|null>(null);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;abort.current?.abort();};},[]);
 async function run<T>(path:string,method:string,data:object):Promise<T> {
  if(!alive.current)throw new DOMException('Account changed.','AbortError');
  if(abort.current)throw new Error('An operation is already being sent.');
  const fingerprint=JSON.stringify([path,method,data]);
  const operationId=keys.current[fingerprint]??crypto.randomUUID();
  keys.current={...keys.current,[fingerprint]:operationId};setSaved(keys.current);
  const controller=new AbortController();abort.current=controller;
  try {
   const result=await apiRequest<T>(path,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify({...data,operationId}),signal:controller.signal});
   if(controller.signal.aborted||!alive.current)throw new DOMException('Account changed.','AbortError');
   const next={...keys.current};delete next[fingerprint];keys.current=next;setSaved(next);return result;
  }finally{abort.current=null;}
 };
 return Object.assign(run,{isActive:()=>alive.current});
}
export async function refreshMessages(client:ReturnType<typeof useQueryClient>) {
 await Promise.all(['messages','message','collaboration','collaborations','notification-summary','notifications'].map(key=>client.invalidateQueries({queryKey:[key]})));
}
/** Explicit receipt acknowledges only the activity ID rendered with this view, never a newer poll. */
export function ViewedActivity({kind,id,throughId,unread}:{kind:ConversationKind;id:number;throughId:number|null;unread:number}) {
 const client=useQueryClient(),run=useMessageOperation(`read-${kind}-${id}`),[pending,setPending]=useState(false),[error,setError]=useState('');
 return <div className="space-y-2"><p className="text-xs text-muted">Read status is private. Mark only the activity you have reviewed.</p>{!!unread&&throughId!==null&&<button className={button} disabled={pending} onClick={async()=>{setPending(true);setError('');const observed=throughId;try{await run(`/api/messages/${kind}/${id}/read`,'PATCH',{throughId:observed});await refreshMessages(client);}catch(e){setError((e as Error).message);}finally{setPending(false);}}}>Mark viewed activity as read ({unread})</button>}<Failure error={error}/></div>;
}
export function Transcript({messages,artistId,children}:{messages:ConversationMessage[];artistId:number;children?:ReactNode}) {
 return <Panel aria-label="Private conversation"><h2 className="text-xl font-bold">Conversation</h2><p className="text-xs text-muted">Only the participants can read this conversation.</p>
 <div className="space-y-4" aria-label="Messages">{!messages.length&&<p className="text-sm text-muted">No messages yet.</p>}{messages.map(m=><article key={m.id} className={`border-l-2 pl-3 ${m.authorId===artistId?'border-accent':'border-border'}`}><p className="text-sm font-bold">{m.author}</p>{m.kind&&m.kind!=='message'&&<p className="text-xs text-accent">{({request:'Introduction',revision:'Revision requested',reject:'Request declined',accept:'Request accepted'} as Record<string,string>)[m.kind]??m.kind}</p>}<p className="text-sm whitespace-pre-wrap break-words">{m.text}</p><time className="text-xs text-muted" dateTime={m.createdAt}>{new Date(m.createdAt).toLocaleString()}</time></article>)}</div>{children}</Panel>;
}
