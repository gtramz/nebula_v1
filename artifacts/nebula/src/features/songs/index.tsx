import { useEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearch } from 'wouter';
import { apiRequest, isServerMode, musicalProject, type Song, type SongEntry, type Tracklist } from '@nebula/local';
import { useAuth } from '@/context/AuthContext';
import { useLeaveGuard } from '@/components/shell/navigation-guard';
import { controlStyles } from '@/components/antiq/workspace';
const {button,field,primary}=controlStyles;
export function useSongs(projectId?:number|null) {
  const {user}=useAuth();
  return useQuery({queryKey:['project-songs',projectId,user?`${user.role}:${user.artistId??user.investorId}`:'guest'],queryFn:({signal})=>apiRequest<Tracklist>(`/api/projects/${projectId}/songs`,{signal}),enabled:isServerMode()&&!!projectId});
}
export function SongSelector({projectId,value,onChange}: {projectId:number;value?:number|null;onChange:(id:number|null)=>void}) {
  const query=useSongs(projectId);
  return <div className="space-y-2"><label className="block">Song (optional)<select className={field} value={value??''} onChange={e=>onChange(e.target.value?Number(e.target.value):null)} disabled={query.isPending||!!query.error}><option value="">Project-wide</option>{query.data?.songs.map(s=><option key={s.id} value={s.id}>{s.title}</option>)}</select></label>{query.error&&<p role="alert">{query.error.message} <button type="button" className={button} onClick={()=>void query.refetch()}>Retry songs</button></p>}</div>;
}
export function SongFields({value,onChange,disabled=false,references={}}:{value:SongEntry[];onChange:(value:SongEntry[])=>void;disabled?:boolean;references?:Record<number,string[]>}) {
  const {user}=useAuth();
  const library=useQuery({queryKey:['my-songs',user?.artistId],queryFn:({signal})=>apiRequest<Song[]>('/api/works',{signal}),enabled:isServerMode()&&user?.role==='artist'});
  function move(index:number,delta:number){const rows=[...value];[rows[index],rows[index+delta]]=[rows[index+delta],rows[index]];onChange(rows);}
  return <fieldset disabled={disabled} className="space-y-4 min-w-0"><legend className="text-xl font-bold">Songs</legend><p className="text-sm text-muted">Register songs in development without uploading a recording. List order is independent of each song’s identity.</p>
    {value.map((song,index)=><div key={song.workId??`new-${index}`} className="border border-border p-4 space-y-3" role="group" aria-label={`Song ${index+1}`}>
      <label className="block">Song {index+1} title<input className={field} required maxLength={160} value={song.title} onChange={e=>onChange(value.map((s,i)=>i===index?{...s,title:e.target.value}:s))}/></label>
      <label className="block">Song {index+1} description<textarea className={field} maxLength={4000} value={song.description} onChange={e=>onChange(value.map((s,i)=>i===index?{...s,description:e.target.value}:s))}/></label>
      <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={!index} onClick={()=>move(index,-1)} aria-label={`Move song ${index+1} up`}>Move up</button><button type="button" className={button} disabled={index===value.length-1} onClick={()=>move(index,1)} aria-label={`Move song ${index+1} down`}>Move down</button><button type="button" className={button} disabled={!!references[song.workId??0]?.length} onClick={()=>onChange(value.filter((_,i)=>i!==index))}>Remove from list</button></div>
      {!!references[song.workId??0]?.length&&<p className="text-sm text-muted">Cannot remove: referenced by {references[song.workId!].join(', ')}.</p>}
      {song.workId&&<p className="text-xs text-muted">Edits affect this song in every project where you included it. Historical proposal terms remain unchanged.</p>}
    </div>)}
    <button type="button" className={button} disabled={value.length>=100} onClick={()=>onChange([...value,{title:'',description:''}])}>Add song</button>
    <label className="block">Use an existing song<select className={field} value="" disabled={library.isPending||!!library.error||value.length>=100} onChange={e=>{const song=library.data?.find(s=>s.id===Number(e.target.value));if(song)onChange([...value,{workId:song.id,revision:song.revision,title:song.title,description:song.description}]);}}><option value="">Choose your song</option>{library.data?.filter(s=>!value.some(v=>v.workId===s.id)).map(s=><option key={s.id} value={s.id}>{s.title} · #{s.id}</option>)}</select></label>
    {library.error&&<p role="alert">{library.error.message} <button type="button" onClick={()=>void library.refetch()}>Retry song library</button></p>}
  </fieldset>;
}
export function SongManager({projectId,status,onStateChange}:{projectId:number;status:string;onStateChange?:(state:{dirty:boolean;busy:boolean})=>void}) {
  const query=useSongs(projectId),client=useQueryClient();
  const [draft,setDraft]=useState<{revision:number;songs:SongEntry[]}|null>(null),[error,setError]=useState(''),[pending,setPending]=useState(false);
  const operation=useRef({key:'',id:''});
  useLeaveGuard(draft?'Leave without saving your song list?':null);
  useEffect(()=>{onStateChange?.({dirty:!!draft,busy:pending});},[draft,pending,onStateChange]);
  if(query.isPending)return <p role="status">Loading songs…</p>;
  if(query.error)return <p role="alert">{query.error.message} <button type="button" onClick={()=>void query.refetch()}>Retry songs</button></p>;
  const current=query.data!,rows=draft?.songs??current.songs.map(s=>({workId:s.id,revision:s.revision,title:s.title,description:s.description}));
  return <form className="space-y-4 border-t border-border pt-6" aria-label="Song list editor" onSubmit={async e=>{
    e.preventDefault();if(!draft||pending)return;setPending(true);setError('');
    const key=JSON.stringify(draft);if(operation.current.key!==key)operation.current={key,id:crypto.randomUUID()};
    try {await apiRequest(`/api/projects/${projectId}/songs`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({...draft,operationId:operation.current.id})});setDraft(null);await Promise.all(['project-songs','my-songs','offers','publication','publications','discovery-feed','opportunity-projects'].map(key=>client.invalidateQueries({queryKey:[key]})));}catch(e){setError((e as Error).message);}finally{setPending(false);}
  }}>
    <p className="text-sm text-muted">{status==='draft'?'These songs are private while the project is a draft.':'Song titles and descriptions saved here are visible with this public project.'} Song-list changes save separately from project details.</p>
    <SongFields value={rows} disabled={pending} references={Object.fromEntries(current.songs.map(s=>[s.id,s.references]))} onChange={songs=>setDraft({revision:draft?.revision??current.revision,songs})}/>
    {error&&<p role="alert">{error}</p>}
    <div className="flex flex-wrap gap-2"><button type="submit" className={primary} disabled={pending||!draft}>{pending?'Saving songs…':'Save songs'}</button><button type="button" className={button} disabled={pending} onClick={()=>{if(!draft||confirm('Discard your song-list draft and reload current songs?')){setDraft(null);setError('');void query.refetch();}}}>Reload songs</button></div>
  </form>;
}
export function ProjectSongs({projectId,category,status,renderOffers}:{projectId:number;category:string;status:string;renderOffers:(id:number)=>React.ReactNode}) {
  const query=useSongs(projectId),search=useSearch();
  const selected=Number(new URLSearchParams(search).get('song'));const selectedRef=useRef<HTMLDivElement>(null);
  useEffect(()=>{if(query.data?.songs.some(s=>s.id===selected))selectedRef.current?.scrollIntoView({block:'start'});},[query.data,selected]);
  if(!isServerMode()||!musicalProject(category))return null;
  return <section aria-label="Project songs" className="space-y-4"><h2 className="text-2xl font-bold">Songs</h2>{query.isPending&&<p role="status">Loading songs…</p>}{query.error&&<p role="alert">{query.error.message}<button className={button} onClick={()=>void query.refetch()}>Retry songs</button></p>}
    {query.data&&selected>0&&!query.data.songs.some(s=>s.id===selected)&&<p role="status">This song is not available in this project.</p>}
    {query.data&&!query.data.songs.length&&<p className="text-sm text-muted">No structured songs added yet.</p>}
    {query.data?.songs.map((song,index)=><div key={song.id} id={`song-${song.id}`} role="group" ref={selected===song.id?selectedRef:undefined} aria-label={`Song: ${song.title}`} className={`scroll-mt-4 p-5 border space-y-3 ${selected===song.id?'border-accent':'border-border'}`}>
      <h3 className="text-xl font-semibold">{index+1}. {song.title}</h3>{selected===song.id&&<p className="text-accent text-sm">Selected song</p>}<p className="whitespace-pre-wrap break-words">{song.description}</p>
      <p className="text-sm text-muted">Song in this project · this record does not imply a finished release.</p>
      {renderOffers(song.id)}
      {status==='draft'?<p className="text-sm text-muted">No public recording shared for this private project.</p>:<RelatedPublications projectId={projectId} workId={song.id}/>}
    </div>)}
  </section>;
}
function RelatedPublications({projectId,workId}:{projectId:number;workId:number}) {
  const query=useInfiniteQuery({queryKey:['song-publications',projectId,workId],initialPageParam:null as number|null,queryFn:({signal,pageParam})=>apiRequest<{items:{id:number;title:string}[];nextCursor:number|null}>(`/api/publications?project=${projectId}&song=${workId}${pageParam?`&before=${pageParam}`:''}`,{signal}),getNextPageParam:page=>page.nextCursor??undefined});
  const items=query.data?.pages.flatMap(page=>page.items)??[];
  return <div>{items.length>0&&<ul>{items.map(post=><li key={post.id}><Link className="underline min-h-11 inline-flex items-center" href={`/discovery?post=post-${post.id}`}>View publication: {post.title}</Link></li>)}</ul>}{query.error?<p role="alert">Publications could not load. <button className={button} onClick={()=>void(query.isFetchNextPageError?query.fetchNextPage():query.refetch())}>Retry publications</button></p>:query.isPending?<p role="status">Loading publications…</p>:!items.length&&<p className="text-sm text-muted">No public recording shared for this song.</p>}{query.hasNextPage&&<button className={button} disabled={query.isFetching} onClick={()=>void query.fetchNextPage()}>More publications</button>}</div>;
}
