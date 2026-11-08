import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {join} from 'node:path';
import {fixture} from './test-fixtures.mjs';
const op=input=>({...input,operationId:randomUUID()});
const entry=s=>({workId:s.id,revision:s.revision,title:s.title,description:s.description});
const tracks=n=>Array.from({length:n},(_,i)=>({title:`Song ${i+1}`,description:`Development ${i+1}`}));
const offer={need:'Feature',deliverable:'A verse',requirements:'Dry vocals',deadline:null,status:'open',compensation:{kind:'split',percent:10}};
async function json(response,status=200){assert.equal(response.status,status,await response.clone().text());return response.json();}
async function setup(t){const app=await fixture(t),a=app.client(),b=app.client(),guest=app.client(),investor=app.client();await a.register('SongOwner');await b.register('SongApplicant');await investor.register('SongInvestor','investor');const db=new DatabaseSync(join(app.dataDir,'nebula.sqlite'));t.after(()=>db.close());return{app,a,b,guest,investor,db};}
async function create(a,extra={}){return (await json(await a.rpc('createProject',op({title:'Five song EP',category:'EP',goalAmount:1000,status:'published',songs:tracks(5),...extra})))).result;}
async function list(a,id){return json(await a.request(`/api/projects/${id}/songs`));}
async function save(a,id,value){return a.request(`/api/projects/${id}/songs`,'PUT',op(value));}

test('songs: atomic creation, idempotent lost-response retries, stable IDs, reusable songs and independent list/project concurrency',async t=>{
 const {app,a,db}=await setup(t),input=op({title:'Atomic EP',category:'EP',goalAmount:500,status:'published',songs:tracks(5)});
 for(const operationId of [undefined,''])assert.equal((await a.rpc('createProject',{...input,operationId})).status,400);
 const result=await json(await a.rpc('createProject',input)),p=result.result;
 assert.deepEqual(await json(await a.rpc('createProject',input)),result);assert.equal(db.prepare('SELECT COUNT(*) n FROM works').get().n,5);
 assert.equal((await a.rpc('createProject',{...input,title:'Different operation'})).status,409);
 const old=await list(a,p.id),ids=old.songs.map(s=>s.id);assert.equal(new Set(ids).size,5);
 const changed=op({revision:old.revision,songs:old.songs.toReversed().map(entry)});
 const current=await json(await a.request(`/api/projects/${p.id}/songs`,'PUT',changed));assert.deepEqual(current.songs.map(s=>s.id),ids.toReversed());
 assert.deepEqual(await json(await a.request(`/api/projects/${p.id}/songs`,'PUT',changed)),current);
 assert.equal((await save(a,p.id,{revision:old.revision,songs:old.songs.map(entry)})).status,409);
 const second=await create(a,{title:'Reuse',songs:[entry(current.songs[0])]});assert.equal(db.prepare('SELECT COUNT(*) n FROM works').get().n,5);
 assert.equal((await list(a,second.id)).songs[0].id,current.songs[0].id);
 await json(await a.rpc('updateProject',p.id,{pitch:'Concurrent financing description'}));
 const renamed=await json(await save(a,second.id,{revision:1,songs:[{...entry(current.songs[0]),title:'Renamed work'}]}));assert.equal(renamed.songs[0].id,current.songs[0].id);
 assert.equal((await save(a,p.id,{revision:current.revision,songs:current.songs.map(entry)})).status,409);
 assert.equal((await json(await a.rpc('getProject',p.id))).result.project.pitch,'Concurrent financing description');
 assert.equal((await a.rpc('updateProject',p.id,{pitch:'Stale',expected:{pitch:''}})).status,409);
 const counts=()=>db.prepare('SELECT COUNT(*) n FROM works').get().n;
 const before=counts();assert.equal((await a.rpc('createProject',op({...input,operationId:randomUUID(),songs:[{title:'Good'}, {title:''}]}))).status,400);assert.equal(counts(),before);
 const projects=(await json(await a.rpc('listProjects',{}))).result;assert.ok(projects);
 await app.restart();await app.restart();assert.deepEqual((await list(a,p.id)).songs.map(s=>s.id),ids.toReversed());assert.equal((await list(a,p.id)).songs[0].title,'Renamed work');
 assert.deepEqual(await json(await a.rpc('createProject',input)),result);assert.equal(counts(),5);
});

test('songs: scoped offers, immutable proposal terms, retained histories, one Home card and no propagation to reused project',async t=>{
 const {a,b,guest,db}=await setup(t),p=await create(a),track=await list(a,p.id),song=track.songs[1];
 const other=await create(a,{title:'Other context',songs:[entry(song)]});
 let scoped=await json(await a.request(`/api/projects/${p.id}/offers`,'POST',{...offer,workId:song.id}),201);
 const general=await json(await a.request(`/api/projects/${p.id}/offers`,'POST',{...offer,need:'Mix',compensation:{kind:'fee',amount:200,currency:'USD'}}),201);
 const home=await json(await guest.request('/api/opportunities/projects'));
 assert.equal(home.items.filter(i=>i.project.id===p.id).length,1);assert.equal(home.items.find(i=>i.project.id===p.id).offers.length,2);assert.ok(!home.items.some(i=>i.project.id===other.id));assert.equal(general.workId,undefined);
 assert.equal((await json(await guest.request('/api/opportunities/projects?need=Feature&compensation=fee'))).items.length,0);
 assert.deepEqual((await json(await guest.request('/api/opportunities/projects?need=Feature&compensation=split'))).items.map(i=>i.project.id),[p.id]);
 const media=await json(await b.upload(),201),privateMedia=await json(await b.upload(),201);
 const thread=await json(await b.request(`/api/offers/${scoped.id}/conversations`,'POST',op({introduction:'Hello',text:'Song proposal',offerRevision:scoped.revision,acceptTerms:true,mediaId:media.id})),201);
 const before=await json(await a.request(`/api/collaborations/${thread.id}`));assert.equal(before.terms.workId,song.id);assert.equal(before.terms.workTitle,'Song 2');assert.equal(before.submissions[0].terms.workTitle,'Song 2');
 await json(await save(a,p.id,{revision:track.revision,songs:track.songs.map(s=>({...entry(s),title:s.id===song.id?'New title':s.title}))}));
 scoped=(await json(await a.request(`/api/projects/${p.id}/offers`))).find(o=>o.id===scoped.id);assert.equal(scoped.workTitle,'New title');
 assert.equal((await a.request(`/api/offers/${scoped.id}`,'PATCH',{...scoped,workId:track.songs[2].id})).status,409);
 const after=await json(await b.request(`/api/collaborations/${thread.id}`));assert.deepEqual(after.terms,before.terms);assert.deepEqual(after.submissions[0].terms,before.submissions[0].terms);
 assert.ok((await json(await a.request('/api/messages?view=requests'))).items[0].context.includes('Song 2'));
 let accepted=await json(await a.request(`/api/collaborations/${thread.id}`,'PATCH',op({action:'accept',revision:after.revision,submissionId:after.submissions[0].id,offerRevision:scoped.revision})));
 assert.equal(accepted.id,thread.id);assert.deepEqual(accepted.terms,before.terms);
 await json(await b.request(`/api/collaborations/${thread.id}/messages`,'POST',op({text:'Same song thread'})),201);
 accepted=await json(await b.request(`/api/collaborations/${thread.id}`,'PATCH',op({action:'deliver',revision:accepted.revision,text:'Final verse',mediaId:media.id})));
 accepted=await json(await a.request(`/api/collaborations/${thread.id}`,'PATCH',op({action:'complete',revision:accepted.revision})));assert.deepEqual(accepted.terms,before.terms);

 const latest=await list(a,p.id);assert.equal((await save(a,p.id,{revision:latest.revision,songs:latest.songs.filter(s=>s.id!==song.id).map(entry)})).status,409);
 assert.equal((await a.request(`/api/works/${song.id}`,'DELETE',op({revision:2}))).status,409);
 assert.equal((await a.request(privateMedia.url)).status,404);assert.equal((await guest.request(media.url)).status,404);
 await json(await a.rpc('deleteProject',p.id));assert.equal((await guest.request(`/api/projects/${p.id}/songs`)).status,404);assert.equal((await b.request(`/api/collaborations/${thread.id}`)).status,200);assert.equal((await a.request(media.url)).status,200);assert.equal(db.prepare('SELECT COUNT(*) n FROM works').get().n,5);
});

test('songs: public/draft publication context, compatibility, revisions, media privacy and cross-project rejection',async t=>{
 const {a,b,guest,investor}=await setup(t),p=await create(a),privateProject=await create(a,{status:'draft'}),song=(await list(a,p.id)).songs[1],hidden=(await list(a,privateProject.id)).songs[0];
 for(const c of [b,guest,investor])assert.equal((await c.request(`/api/projects/${privateProject.id}/songs`)).status,404);
 assert.equal((await guest.request('/api/works')).status,401);assert.equal((await investor.request('/api/works')).status,403);assert.deepEqual(await json(await b.request('/api/works')),[]);
 for(const c of [b,investor]){assert.ok([403,404].includes((await save(c,p.id,{revision:1,songs:[]})).status));assert.ok([400,403,404].includes((await c.request(`/api/projects/${p.id}/offers`,'POST',{...offer,workId:song.id})).status));}
 assert.equal((await a.request(`/api/projects/${p.id}/offers`,'POST',{...offer,workId:hidden.id})).status,400);
 const file=await json(await a.upload(),201),base={title:'Song demo',description:'Work in development',mediaId:file.id,coverId:null,allowRemix:false,status:'draft',projectId:p.id,workId:song.id};
 const draft=await json(await a.request('/api/publications','POST',base),201);assert.equal((await guest.request(file.url)).status,404);
 assert.equal((await a.request(`/api/publications/${draft.id}`,'PATCH',{...base,revision:draft.revision,projectId:privateProject.id})).status,400);
 const changed=await json(await a.request(`/api/publications/${draft.id}`,'PATCH',{...base,revision:draft.revision,description:'Updated'}));assert.equal(changed.status,'draft');assert.equal(changed.allowRemix,false);assert.equal(changed.media.id,file.id);assert.equal(changed.song.id,song.id);
 const compatible=await json(await a.request(`/api/publications/${draft.id}`,'PATCH',{...base,workId:undefined,revision:changed.revision}));assert.equal(compatible.song.id,song.id);changed.revision=compatible.revision;
 assert.equal((await a.request(`/api/publications/${draft.id}`,'PATCH',{...base,revision:draft.revision})).status,409);
 assert.equal((await a.request('/api/publications','POST',{...base,projectId:privateProject.id,workId:hidden.id,status:'published'})).status,400);
 const pub=await json(await a.request(`/api/publications/${draft.id}`,'PATCH',{...base,revision:changed.revision,status:'published'}));
 await json(await a.request('/api/publications','POST',{...base,status:'published'}),201);
 const standalone=await json(await a.request('/api/publications','POST',{...base,projectId:null,workId:null,status:'published'}),201);assert.equal(standalone.song,undefined);
 const legacy=await json(await a.request('/api/publications','POST',{...base,workId:undefined,status:'published'}),201);assert.equal(legacy.projectId,p.id);assert.equal(legacy.song,undefined);
 const related=await json(await guest.request(`/api/publications?project=${p.id}&song=${song.id}`));assert.equal(related.items.length,2);assert.ok(related.items.every(i=>i.song.id===song.id));
 assert.equal((await guest.request(`/api/publications?project=${p.id}&song=${hidden.id}`)).status,404);
 assert.equal((await guest.request(`/api/publications?project=${privateProject.id}&song=${hidden.id}`)).status,404);
 const listNow=await list(a,p.id);assert.equal((await save(a,p.id,{revision:listNow.revision,songs:listNow.songs.filter(s=>s.id!==song.id).map(entry)})).status,409);
 await json(await a.rpc('deleteProject',p.id));const independent=await json(await guest.request(`/api/publications/${pub.id}`));assert.equal(independent.project,null);assert.equal(independent.song,null);assert.equal((await guest.request(file.url)).status,200);
});

test('songs: safe removal, duplicate membership, owner permissions and transaction rollback',async t=>{
 const {a,b,db}=await setup(t),p=await create(a),track=await list(a,p.id),song=track.songs[0];
 assert.equal((await save(a,p.id,{revision:1,songs:[entry(song),entry(song)]})).status,400);
 assert.equal((await save(b,p.id,{revision:1,songs:[]})).status,404);
 db.exec("CREATE TRIGGER fail_membership BEFORE INSERT ON project_works BEGIN SELECT RAISE(ABORT,'forced failure'); END");
 const payload=op({revision:1,songs:[...track.songs.map(entry),{title:'Atomic new',description:''}]});
 assert.equal((await a.request(`/api/projects/${p.id}/songs`,'PUT',payload)).status,500);assert.deepEqual(await list(a,p.id),track);assert.equal(db.prepare('SELECT COUNT(*) n FROM works').get().n,5);
 db.exec('DROP TRIGGER fail_membership');await json(await a.request(`/api/projects/${p.id}/songs`,'PUT',payload));await json(await a.request(`/api/projects/${p.id}/songs`,'PUT',payload));assert.equal(db.prepare('SELECT COUNT(*) n FROM works').get().n,6);
 const latest=await list(a,p.id);await json(await save(a,p.id,{revision:latest.revision,songs:latest.songs.filter(s=>s.id!==song.id).map(entry)}));
 assert.equal((await b.request(`/api/works/${song.id}`,'DELETE',op({revision:1}))).status,404);
 const removal=op({revision:1});assert.deepEqual(await json(await a.request(`/api/works/${song.id}`,'DELETE',removal)),{deleted:true});assert.deepEqual(await json(await a.request(`/api/works/${song.id}`,'DELETE',removal)),{deleted:true});
 const sameNames=await create(a,{songs:[{title:'Same title',description:''},{title:'Same title',description:''}]});const names=await list(a,sameNames.id);assert.notEqual(names.songs[0].id,names.songs[1].id);
});

test('songs: additive upgrade preserves historical records, supports repeated startup and does not invent works',async t=>{
 const {app,a,db}=await setup(t),p=await create(a,{songs:undefined});await json(await a.request(`/api/projects/${p.id}/offers`,'POST',offer),201);
 const snapshots={};for(const name of ['state','collaboration_offers'])snapshots[name]=db.prepare(`SELECT * FROM ${name}`).all();
 db.exec('DROP TABLE project_works; DROP TABLE project_tracklists; DROP TABLE works; DROP TABLE work_operations;');
 await app.restart();await app.restart();for(const [name,rows] of Object.entries(snapshots))assert.deepEqual(db.prepare(`SELECT * FROM ${name}`).all(),rows);
 assert.deepEqual(await list(a,p.id),{revision:0,songs:[]});await json(await save(a,p.id,{revision:0,songs:tracks(1)}));assert.equal((await list(a,p.id)).songs.length,1);
});
