import type { DatabaseSync } from 'node:sqlite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Project, SessionUser } from '../lib/local/src/types.js';
import type { Admission, ConversationKind, ConversationCard, GeneralConversation } from '../lib/local/src/messages.js';
import type { collaborations } from './collaborations.js';
import type { NotificationService } from './notifications.js';
import { mayReceiveRequest, type MessageStorage, type GeneralRow } from './message-storage.js';
import { ensure, id, text, HttpError } from './validation.js';

type Dependencies={db:DatabaseSync;store:MessageStorage;alerts:NotificationService;collaboration:ReturnType<typeof collaborations>;
 current:(req:IncomingMessage,artistOnly?:boolean)=>SessionUser;body:(req:IncomingMessage)=>Promise<Record<string,unknown>>;
 json:(res:ServerResponse,value:unknown,status?:number)=>void;rate:(req:IncomingMessage,name:string,limit:number,seconds:number,identity?:string)=>void;
 artist:(id:number)=>{id:number;name:string}|undefined;project:(id:number)=>Project|null;};
export function messages(d:Dependencies) {
 const {db,store}=d;
 const name=(id:number)=>d.artist(id)?.name ?? 'Artist unavailable';
 function context(viewer:number,recipient:number,projectId:unknown) {
  ensure(d.artist(viewer) && d.artist(recipient),'Artist not found.',404);ensure(viewer!==recipient,'You cannot message yourself.');
  ensure(mayReceiveRequest('general'),'This artist cannot receive a message request.',403);
  const project=projectId==null?null:d.project(id(projectId));
  if(projectId!=null) ensure(project && project.artistId===recipient,'Choose a visible project belonging to the recipient.',404);
  return project;
 }
 const existingPair=(a:number,b:number)=>db.prepare('SELECT * FROM artist_conversations WHERE pair_a=? AND pair_b=?').get(Math.min(a,b),Math.max(a,b)) as GeneralRow|undefined;
 function detail(row:GeneralRow,viewer:number,before=Number.MAX_SAFE_INTEGER):GeneralConversation {
  const rows=db.prepare('SELECT * FROM artist_messages WHERE thread=? AND id<? ORDER BY id DESC LIMIT 51').all(row.id,before) as {id:number;author:number;kind:string;text:string;created:string}[];
  return {id:row.id,senderId:row.sender,recipientId:row.recipient,senderName:name(row.sender),recipientName:name(row.recipient),admission:row.admission,revision:row.revision,
   projectId:row.project,projectTitle:row.project_title,projectAvailable:row.project!==null && !!d.project(row.project),updatedAt:row.updated,
   messages:rows.slice(0,50).reverse().map(m=>({id:m.id,authorId:m.author,author:name(m.author),text:m.text,kind:m.kind,createdAt:m.created})),nextMessageCursor:rows.length>50?rows[49].id:null,...store.reading('general',row.id,viewer)};
 }
 function inbox(viewer:number,url:URL) {
  const view=url.searchParams.get('view')??'conversations',direction=url.searchParams.get('direction')??'received',closed=url.searchParams.get('closed')==='1';
  ensure(['conversations','requests'].includes(view)&&['received','sent'].includes(direction),'Invalid inbox view.');
  let cursor:[string,string,number]|null=null;
  if(url.searchParams.has('cursor')) {
   try { const value=JSON.parse(Buffer.from(url.searchParams.get('cursor')!,'base64url').toString());ensure(Array.isArray(value)&&value.length===7&&value[3]===viewer&&value[4]===view&&value[5]===direction&&value[6]===closed&&typeof value[0]==='string'&&['general','collaboration'].includes(value[1]),'Invalid inbox cursor.');id(value[2]);cursor=[value[0],value[1],value[2]]; }
   catch {throw new HttpError(400,'Invalid inbox cursor.');}
  }
  const admission=view==='conversations'?"admission='accepted'":closed?"admission IN ('rejected','withdrawn')":"admission='pending'";
  const side=view==='requests'?`AND ${direction==='received'?'recipient':'sender'}=@viewer`:'';
  const rows=db.prepare(`WITH threads AS (
   SELECT 'general' AS scope,id,sender,recipient,project_title AS context,admission,0 AS legacy,NULL AS workStatus,updated FROM artist_conversations WHERE sender=@viewer OR recipient=@viewer
   UNION ALL
   SELECT 'collaboration' AS scope,id,applicant AS sender,owner AS recipient,
    CASE WHEN json_valid(terms) THEN json_extract(terms,'$.projectTitle') || CASE WHEN json_extract(terms,'$.workId') IS NOT NULL THEN ' → ' || COALESCE(json_extract(terms,'$.workTitle'),'Song') ELSE '' END || ' · ' || json_extract(terms,'$.need') ELSE 'Collaboration unavailable' END AS context,
    admission,CASE WHEN request_policy=0 THEN 1 ELSE 0 END AS legacy,status AS workStatus,updated FROM collaborations WHERE owner=@viewer OR applicant=@viewer
   ) SELECT * FROM threads WHERE ${admission} ${side}
   AND (@date IS NULL OR updated<@date OR (updated=@date AND (scope<@scope OR (scope=@scope AND id<@id))))
   ORDER BY updated DESC,scope DESC,id DESC LIMIT 31`).all({viewer,date:cursor?.[0]??null,scope:cursor?.[1]??null,id:cursor?.[2]??null}) as {scope:ConversationKind;id:number;sender:number;recipient:number;context:string|null;admission:Admission;legacy:number;workStatus:string|null;updated:string}[];
  const items:ConversationCard[]=rows.slice(0,30).map(row=>{const counterpart=row.sender===viewer?row.recipient:row.sender;return {kind:row.scope,id:row.id,counterpartId:counterpart,counterpartName:name(counterpart),context:row.context,admission:row.admission,legacy:!!row.legacy,direction:row.recipient===viewer?'received':'sent',workStatus:row.workStatus,updatedAt:row.updated,...store.reading(row.scope,row.id,viewer)};});
  const last=rows[29];return {items,nextCursor:rows.length>30?Buffer.from(JSON.stringify([last.updated,last.scope,last.id,viewer,view,direction,closed])).toString('base64url'):null};
 }
 async function handle(req:IncomingMessage,res:ServerResponse,url:URL) {
  if(!url.pathname.startsWith('/api/messages'))return false;
  const viewer=d.current(req,true).artistId!;ensure(d.artist(viewer),'Artist account unavailable.',403);
  const thread=/^\/api\/messages\/(general|collaboration)\/(\d+)(?:\/(messages|read))?$/.exec(url.pathname);
  if(url.pathname==='/api/messages'&&req.method==='GET'){d.json(res,inbox(viewer,url));return true;}
  if(url.pathname==='/api/messages/compose'&&req.method==='GET') {
   const recipient=id(Number(url.searchParams.get('artist'))),project=context(viewer,recipient,url.searchParams.has('project')?Number(url.searchParams.get('project')):null),existing=existingPair(viewer,recipient);
   d.json(res,{recipient:{id:recipient,name:name(recipient)},project:project?{id:project.id,title:project.title}:null,existing:existing?{id:existing.id,admission:existing.admission,projectTitle:existing.project_title}:null});return true;
  }
  if(thread && req.method==='GET' && thread[1]==='general' && !thread[3]) {d.json(res,detail(store.general(id(Number(thread[2])),viewer),viewer,id(Number(url.searchParams.get('before')??Number.MAX_SAFE_INTEGER))));return true;}
  const data=await d.body(req);d.rate(req,'collaborations',60,60,String(viewer));const now=new Date().toISOString();
  if(url.pathname==='/api/messages/requests'&&req.method==='POST') {
   const threadId=store.operation(viewer,data.operationId,'general:request',data,()=>{
    ensure(data.kind===undefined || data.kind==='general','Choose a general message request.');
    const recipient=id(data.recipientId),project=context(viewer,recipient,data.projectId),existing=existingPair(viewer,recipient);
    if(existing)return existing.id;
    const intro=text(data.text,'Introduction',4000,1);
    const saved=db.prepare('INSERT INTO artist_conversations(sender,recipient,pair_a,pair_b,project,project_title,created,updated) VALUES(?,?,?,?,?,?,?,?)').run(viewer,recipient,Math.min(viewer,recipient),Math.max(viewer,recipient),project?.id??null,project?.title??null,now,now);
    const threadId=Number(saved.lastInsertRowid);
    db.prepare("INSERT INTO artist_messages(thread,author,kind,text,created) VALUES(?,?,'request',?,?)").run(threadId,viewer,intro,now);
    store.activity('general',threadId,viewer,'request',now);d.alerts.recordConversation(recipient,viewer,threadId,'conversation.requested',now);return threadId;
   });d.json(res,detail(store.general(threadId,viewer),viewer),201);return true;
  }
  if(thread) {
   const scope=thread[1] as ConversationKind,threadId=id(Number(thread[2]));
   if(thread[3]==='read'&&req.method==='PATCH') {
    if(scope==='general')store.general(threadId,viewer);else d.collaboration.authorize(threadId,viewer);
    d.json(res,store.read(scope,threadId,viewer,id(data.throughId)));return true;
   }
   if(scope==='general' && (req.method==='POST'&&thread[3]==='messages' || req.method==='PATCH'&&!thread[3])) {
    store.operation(viewer,data.operationId,`general:${threadId}:${thread[3]??'decision'}`,data,()=>{
     const row=store.general(threadId,viewer);let kind:'message'|'accept'|'reject',value:string;
     if(thread[3]==='messages') {ensure(row.admission==='accepted','This request does not allow messages.',409);kind='message';value=text(data.text,'Message',4000,1);}
     else {
      ensure(row.recipient===viewer,'Only the recipient can decide this request.',403);ensure(row.admission==='pending'&&row.revision===data.revision,'This request changed or was already decided.',409);
      ensure(data.action==='accept'||data.action==='reject','Choose accept or reject.');kind=data.action;value=kind==='reject'?text(data.response??'','Decline response',4000):'';
      db.prepare('UPDATE artist_conversations SET admission=?,revision=revision+1 WHERE id=?').run(kind==='accept'?'accepted':'rejected',threadId);
     }
     db.prepare('INSERT INTO artist_messages(thread,author,kind,text,created) VALUES(?,?,?,?,?)').run(threadId,viewer,kind,value,now);
     db.prepare('UPDATE artist_conversations SET updated=? WHERE id=?').run(now,threadId);
     store.activity('general',threadId,viewer,kind,now);
     d.alerts.recordConversation(row.sender===viewer?row.recipient:row.sender,viewer,threadId,kind==='message'?'conversation.message':kind==='accept'?'conversation.accepted':'conversation.rejected',now);
     return {ok:true};
    });d.json(res,detail(store.general(threadId,viewer),viewer));return true;
   }
  }
  throw new HttpError(405,'Method not allowed.');
 }
 return {handle};
}
