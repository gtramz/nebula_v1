import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fixture } from './test-fixtures.mjs';
const op=data=>({...data,operationId:randomUUID()});
const offerInput={need:'Verse',deliverable:'Dry vocals',requirements:'One revision',deadline:null,compensation:{kind:'fee',amount:200,currency:'USD'},status:'open'};
async function json(response,status=200){assert.equal(response.status,status,await response.clone().text());return response.json();}
async function setup(t){const app=await fixture(t),a=app.client(),b=app.client(),c=app.client(),investor=app.client(),guest=app.client();const A=(await a.register('ArtistA')).user,B=(await b.register('ArtistB')).user;await c.register('ArtistC');await investor.register('Investor','investor');return {app,a,b,c,investor,guest,A,B};}
async function offer(b){const project=(await json(await b.rpc('createProject',{title:'Test work',category:'EP',goalAmount:1000,status:'published'}))).result;return json(await b.request(`/api/projects/${project.id}/offers`,'POST',offerInput),201);}
async function general(a,bid,extra={}){return json(await a.request('/api/messages/requests','POST',op({recipientId:bid,text:'Hello, may we talk?',...extra})),201);}

test('general request stays one thread: read-only composition, exclusive delivery, reads, repeat sends, retry/restart, decisions and legacy isolation',async t=>{
 const {app,a,b,c,investor,guest,A,B}=await setup(t);await offer(b); // An open offer never admits an unrelated DM.
 for(const client of [guest,investor])assert.equal((await client.request('/api/messages')).status,client===guest?401:403);
 assert.equal((await a.request(`/api/messages/compose?artist=${A.artistId}`)).status,400);
 assert.equal((await a.request('/api/messages/requests','POST',op({recipientId:B.artistId,kind:'investment',text:'fake'}))).status,400);
 const compose=await json(await a.request(`/api/messages/compose?artist=${B.artistId}`));assert.equal(compose.existing,null);
 assert.equal((await json(await b.request('/api/messages?view=requests'))).items.length,0);assert.equal((await json(await b.request('/api/notifications'))).items.length,0);
 assert.equal((await a.request('/api/messages/requests','POST',op({recipientId:999999,text:'Invalid target'}))).status,404);
 const input=op({recipientId:B.artistId,text:'First introduction',senderId:B.artistId,admission:'accepted'});
 const responses=await Promise.all([a.request('/api/messages/requests','POST',input),a.request('/api/messages/requests','POST',input)]);
 const thread=await json(responses[0],201);assert.equal((await json(responses[1],201)).id,thread.id);assert.equal(thread.admission,'pending');assert.equal(thread.senderId,A.artistId);
 const path=`/api/messages/general/${thread.id}`;
 assert.equal((await general(b,A.artistId)).id,thread.id); // opposite direction returns same pair without replacing introduction.
 for(const person of [a,b])assert.equal((await person.request(`${path}/messages`,'POST',op({text:'bypass'}))).status,409);
 assert.equal((await c.request(path)).status,404);assert.equal((await guest.request(path)).status,401);
 const alerts=await json(await b.request('/api/notifications'));assert.equal(alerts.items.length,1);assert.equal(alerts.items[0].kind,'conversation.requested');assert.equal(alerts.items[0].target.id,thread.id);assert.equal('collaborationId' in alerts.items[0],false);
 assert.equal((await json(await a.request('/api/notifications'))).items.length,0);assert.equal((await json(await c.request('/api/notifications'))).items.length,0);
 await json(await b.request('/api/notifications/read','PATCH',{id:alerts.latestId}));assert.equal((await json(await b.request(path))).unreadCount,1);
 assert.equal((await c.request(`${path}/read`,'PATCH',{throughId:thread.lastActivityId})).status,404);
 assert.equal((await b.request(`${path}/read`,'PATCH',{throughId:thread.lastActivityId+100})).status,404);
 await json(await b.request(`${path}/read`,'PATCH',{throughId:thread.lastActivityId}));assert.equal((await json(await b.request(path))).unreadCount,0);
 assert.equal((await a.request(path,'PATCH',op({action:'accept',revision:1}))).status,403);
 const accept=op({action:'accept',revision:1});const decisions=await Promise.all([b.request(path,'PATCH',accept),b.request(path,'PATCH',op({action:'reject',revision:1,response:'No'}))]);
 assert.deepEqual(decisions.map(r=>r.status).sort(),[200,409]);assert.equal((await json(await b.request(path))).admission,'accepted');
 assert.equal((await json(await b.request(path,'PATCH',accept))).id,thread.id);
 const message=op({text:'Same legitimate text'});await json(await a.request(`${path}/messages`,'POST',message));await json(await a.request(`${path}/messages`,'POST',message));
 await json(await a.request(`${path}/messages`,'POST',op({text:message.text})));let detail=await json(await b.request(path));assert.equal(detail.messages.filter(m=>m.text===message.text).length,2);
 assert.equal((await a.request(`${path}/messages`,'POST',{...message,text:'Changed payload'})).status,409);
 const observed=detail.lastActivityId;await json(await a.request(`${path}/messages`,'POST',op({text:'New arrival'})));await json(await b.request(`${path}/read`,'PATCH',{throughId:observed}));assert.equal((await json(await b.request(path))).unreadCount,1);
 assert.equal((await json(await b.request('/api/messages'))).items.length,1);assert.equal((await json(await b.request('/api/messages?view=requests'))).items.length,0);
 await app.restart();await json(await a.request(`${path}/messages`,'POST',message));detail=await json(await b.request(path));assert.equal(detail.messages.filter(m=>m.text===message.text).length,2);assert.equal(detail.unreadCount,1);
 await b.rpc('logout');assert.equal((await b.request(path)).status,401);
});

test('decline closes only its request; response and notification are atomic; valid project context never fabricates a collaboration',async t=>{
 const {app,a,b,c,A,B}=await setup(t),o=await offer(b);
 const db=new DatabaseSync(join(app.dataDir,'nebula.sqlite'));t.after(()=>db.close());
 const privateProject=(await json(await b.rpc('createProject',{title:'Hidden',category:'EP',goalAmount:1000,status:'draft'}))).result;
 assert.equal((await a.request(`/api/messages/compose?artist=${B.artistId}&project=${privateProject.id}`)).status,404);
 assert.equal((await a.request(`/api/messages/compose?artist=${A.artistId}&project=${o.projectId}`)).status,400);
 const thread=await general(a,B.artistId,{projectId:o.projectId}),path=`/api/messages/general/${thread.id}`;
 assert.equal(thread.projectTitle,'Test work');assert.equal(db.prepare('SELECT COUNT(*) n FROM collaborations').get().n,0);
 db.exec("CREATE TRIGGER fail_notice BEFORE INSERT ON artist_notifications WHEN NEW.kind='conversation.rejected' BEGIN SELECT RAISE(ABORT,'injected failure'); END");
 const decline=op({action:'reject',revision:1,response:'Thanks, but no.'});assert.equal((await b.request(path,'PATCH',decline)).status,500);
 let detail=await json(await a.request(path));assert.equal(detail.admission,'pending');assert.equal(detail.messages.length,1);
 db.exec('DROP TRIGGER fail_notice');await json(await b.request(path,'PATCH',decline));await json(await b.request(path,'PATCH',decline));
 detail=await json(await a.request(path));assert.equal(detail.admission,'rejected');assert.equal(detail.messages.filter(m=>m.text==='Thanks, but no.').length,1);
 assert.equal((await general(a,B.artistId)).id,thread.id);for(const client of [a,b])assert.equal((await client.request(`${path}/messages`,'POST',op({text:'closed bypass'}))).status,409);
 assert.equal((await json(await b.request('/api/messages?view=requests'))).items.length,0);assert.equal((await json(await b.request('/api/messages?view=requests&closed=1'))).items[0].id,thread.id);
 const other=await general(c,B.artistId);assert.equal(other.admission,'pending');assert.notEqual(other.id,thread.id);
 await b.rpc('deleteProject',o.projectId);detail=await json(await a.request(path));assert.equal(detail.projectTitle,'Test work');assert.equal(detail.projectAvailable,false);
});

test('formal requests send complete proposals atomically, prevent old API bypass, revise and accept exact proposal, deliver and complete on the same thread',async t=>{
 const {app,a,b,c,guest,B}=await setup(t);let o=await offer(b);const composePath=`/api/offers/${o.id}/conversations`;
 const db=new DatabaseSync(join(app.dataDir,'nebula.sqlite'));t.after(()=>db.close());
 await json(await a.request(composePath));assert.equal(db.prepare('SELECT COUNT(*) n FROM collaborations').get().n,0);
 assert.equal((await a.request(composePath,'POST',{})).status,400);
 const media=await json(await a.upload(),201),extra=await json(await a.upload(),201),unsent=await json(await a.upload(),201);
 const request=op({introduction:'My introduction',text:'My complete proposal',offerRevision:o.revision,acceptTerms:true,mediaIds:[media.id,extra.id]});
 db.exec("CREATE TRIGGER fail_request BEFORE INSERT ON artist_notifications WHEN NEW.kind='submit' BEGIN SELECT RAISE(ABORT,'injected failure'); END");
 assert.equal((await a.request(composePath,'POST',request)).status,500);for(const table of ['collaborations','collaboration_messages','collaboration_submissions','collaboration_files','conversation_activity','message_operations'])assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n,0);
 db.exec('DROP TRIGGER fail_request');let item=await json(await a.request(composePath,'POST',request),201);const path=`/api/collaborations/${item.id}`;
 assert.equal((await json(await a.request(composePath,'POST',request),201)).id,item.id);assert.equal(item.requestPolicy,1);assert.equal(item.admission,'pending');
 assert.equal((await json(await b.request('/api/notifications'))).items.length,1);
 for(const client of [a,b])assert.equal((await client.request(`${path}/messages`,'POST',op({text:'not allowed yet'}))).status,409);
 assert.equal((await b.request(media.url)).status,200);assert.equal((await b.request(extra.url)).status,200);assert.equal((await b.request(unsent.url)).status,404);assert.equal((await c.request(media.url)).status,404);assert.equal((await guest.request(media.url)).status,404);
 assert.equal((await c.request(path)).status,404);
 let detail=await json(await b.request(path));assert.equal(detail.messages[0].text,request.introduction);assert.equal(detail.submissions[0].files.length,2);
 const proposal=detail.submissions[0].id;
 assert.equal((await b.request(path,'PATCH',op({action:'accept',revision:item.revision,submissionId:proposal+1,offerRevision:o.revision}))).status,409);
 o=await json(await b.request(`/api/offers/${o.id}`,'PATCH',{...o,requirements:'New terms'}));
 assert.equal((await b.request(path,'PATCH',op({action:'accept',revision:item.revision,submissionId:proposal,offerRevision:o.revision}))).status,409);
 item=await json(await b.request(path,'PATCH',op({action:'request_changes',revision:item.revision,feedback:'Please update your work.'})));assert.equal(item.admission,'pending');
 item=await json(await a.request(path,'PATCH',op({action:'submit',revision:item.revision,offerRevision:o.revision,acceptTerms:true,text:'Revised proposal',mediaIds:[media.id,extra.id]})));
 detail=await json(await b.request(path));assert.equal(detail.submissions.length,2);assert.equal(detail.messages.at(-1).kind,'revision');
 const accept=op({action:'accept',revision:item.revision,submissionId:detail.submissions[0].id,offerRevision:o.revision});item=await json(await b.request(path,'PATCH',accept));assert.equal(item.admission,'accepted');
 await json(await b.request(path,'PATCH',accept));assert.equal(db.prepare('SELECT COUNT(*) n FROM collaborations').get().n,1);assert.equal(db.prepare('SELECT COUNT(*) n FROM artist_conversations').get().n,0);
 await json(await a.request(`${path}/messages`,'POST',op({text:'Chat is now open'})),201);
 item=await json(await a.request(path,'PATCH',op({action:'deliver',revision:item.revision,text:'Final work',mediaIds:[media.id,extra.id]})));
 item=await json(await b.request(path,'PATCH',op({action:'complete',revision:item.revision})));assert.equal(item.status,'completed');assert.equal(item.admission,'accepted');
 await app.restart();assert.equal((await json(await a.request(path))).submissions.length,3);assert.equal((await b.request(extra.url)).status,200);
});

test('closed, withdrawn, expired requests cannot reopen while historical rejected chats preserve their behavior',async t=>{
 const {app,a,b,c}=await setup(t),o=await offer(b),media=await json(await a.upload(),201);
 let request=await json(await a.request(`/api/offers/${o.id}/conversations`,'POST',op({introduction:'Intro',text:'Proposal',offerRevision:1,acceptTerms:true,mediaId:media.id})),201);const path=`/api/collaborations/${request.id}`;
 request=await json(await b.request(path,'PATCH',op({action:'reject',revision:request.revision,response:'Not this time'})));
 assert.equal(request.admission,'rejected');assert.equal((await a.request(`${path}/messages`,'POST',op({text:'bypass old route'}))).status,409);
 const same=await json(await a.request(`/api/offers/${o.id}/conversations`,'POST',op({})),201);assert.equal(same.id,request.id);assert.equal(same.admission,'rejected');
 const historical=await json(await c.legacyConversation(o.id));await json(await b.request(`/api/collaborations/${historical.id}`,'PATCH',{action:'reject',revision:historical.revision}));
 await json(await c.request(`/api/collaborations/${historical.id}/messages`,'POST',{text:'Historical chat remains available'}),201);
 const legacy=await json(await c.request(`/api/collaborations/${historical.id}`));assert.equal(legacy.requestPolicy,0);assert.equal(legacy.admission,'accepted');assert.equal(legacy.status,'rejected');
 assert.equal((await json(await b.request('/api/messages'))).items[0].id,legacy.id);
});

test('offer closure, withdrawal, expiry and pending competitor rejection obey admission independently',async t=>{
 const {app,a,b,c}=await setup(t),media=await json(await a.upload(),201),otherMedia=await json(await c.upload(),201);
 async function apply(who,o,file){return json(await who.request(`/api/offers/${o.id}/conversations`,'POST',op({introduction:'Intro',text:'Work',offerRevision:o.revision,acceptTerms:true,mediaId:file.id})),201);}
 const closed=await offer(b),r=await apply(a,closed,media);
 await json(await b.request(`/api/offers/${closed.id}`,'PATCH',{revision:closed.revision,action:'close'}));
 const detail=await json(await b.request(`/api/collaborations/${r.id}`));
 assert.equal((await b.request(`/api/collaborations/${r.id}`,'PATCH',op({action:'accept',revision:r.revision,submissionId:detail.submissions[0].id,offerRevision:2}))).status,409);
 const withdrawn=await json(await a.request(`/api/collaborations/${r.id}`,'PATCH',op({action:'withdraw',revision:r.revision})));assert.equal(withdrawn.admission,'withdrawn');
 assert.equal((await b.request(`/api/collaborations/${r.id}/messages`,'POST',op({text:'No chat'}))).status,409);
 const o=await offer(b),first=await apply(a,o,media),second=await apply(c,o,otherMedia),latest=await json(await b.request(`/api/collaborations/${first.id}`));
 await json(await b.request(`/api/collaborations/${first.id}`,'PATCH',op({action:'accept',revision:first.revision,submissionId:latest.submissions[0].id,offerRevision:o.revision})));
 assert.equal((await json(await c.request(`/api/collaborations/${second.id}`))).admission,'rejected');
 assert.equal((await c.request(`/api/collaborations/${second.id}/messages`,'POST',op({text:'No chat'}))).status,409);
 const expired=await offer(b),db=new DatabaseSync(join(app.dataDir,'nebula.sqlite'));t.after(()=>db.close());db.prepare('UPDATE collaboration_offers SET data=? WHERE id=?').run(JSON.stringify({...offerInput,deadline:'2020-01-01'}),expired.id);
 assert.equal((await a.request(`/api/offers/${expired.id}/conversations`)).status,409);
 assert.equal((await a.request(`/api/offers/${expired.id}/conversations`,'POST',op({introduction:'Intro',text:'Work',offerRevision:1,acceptTerms:true,mediaId:media.id}))).status,409);
});

test('inbox and transcript pagination stay bounded, scope reads, and do not expose other participants receipts',async t=>{
 const {app,a,b,c,A,B}=await setup(t),generalThread=await general(a,B.artistId),path=`/api/messages/general/${generalThread.id}`;
 await json(await b.request(path,'PATCH',op({action:'accept',revision:1})));
 for(let i=0;i<52;i++)await json(await a.request(`${path}/messages`,'POST',op({text:`Message ${i}`})));
 const first=await json(await b.request(path)),older=await json(await b.request(`${path}?before=${first.nextMessageCursor}`));assert.equal(first.messages.length,50);assert.equal(older.messages.length,4);assert.equal(new Set([...older.messages,...first.messages].map(m=>m.id)).size,54);
 const db=new DatabaseSync(join(app.dataDir,'nebula.sqlite'));t.after(()=>db.close());
 const o=await offer(b),terms={...o};for(let i=0;i<32;i++)db.prepare('INSERT INTO collaborations(offer,owner,applicant,terms,status,updated) VALUES(?,?,?,?,?,?)').run(o.id+i+1000,B.artistId,A.artistId,JSON.stringify(terms),'rejected',new Date(Date.now()+i).toISOString());
 const inbox=await json(await b.request('/api/messages')),next=await json(await b.request(`/api/messages?cursor=${inbox.nextCursor}`));assert.equal(inbox.items.length,30);assert.equal(next.items.length,3);assert.equal(new Set([...inbox.items,...next.items].map(x=>x.kind+':'+x.id)).size,33);
 assert.equal((await c.request(`/api/messages?cursor=${inbox.nextCursor}`)).status,400);
 const other=await general(c,B.artistId);assert.equal((await b.request(`${path}/read`,'PATCH',{throughId:other.lastActivityId})).status,404);
 await json(await b.request(`${path}/read`,'PATCH',{throughId:first.lastActivityId}));assert.equal((await json(await b.request(path))).unreadCount,0);assert.equal((await json(await a.request(path))).unreadCount,1); // Acceptance remains unread by sender.
 assert.equal('readAt' in (await json(await a.request(path))).messages[0],false);
});

test('general request, acceptance and chat writes roll back together with failed notifications',async t=>{
 const {app,a,b,B}=await setup(t),db=new DatabaseSync(join(app.dataDir,'nebula.sqlite'));t.after(()=>db.close());
 const fail=kind=>db.exec(`CREATE TRIGGER fail_atomic BEFORE INSERT ON artist_notifications WHEN NEW.kind='${kind}' BEGIN SELECT RAISE(ABORT,'injected failure'); END`);
 fail('conversation.requested');const send=op({recipientId:B.artistId,text:'Intro'});assert.equal((await a.request('/api/messages/requests','POST',send)).status,500);
 for(const table of ['artist_conversations','artist_messages','conversation_activity','message_operations'])assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n,0);
 db.exec('DROP TRIGGER fail_atomic');const request=await json(await a.request('/api/messages/requests','POST',send),201),path=`/api/messages/general/${request.id}`;
 fail('conversation.accepted');const accept=op({action:'accept',revision:1});assert.equal((await b.request(path,'PATCH',accept)).status,500);assert.equal((await json(await a.request(path))).admission,'pending');
 db.exec('DROP TRIGGER fail_atomic');await json(await b.request(path,'PATCH',accept));
 fail('conversation.message');const message=op({text:'All or nothing'});assert.equal((await a.request(`${path}/messages`,'POST',message)).status,500);assert.equal((await json(await b.request(path))).messages.length,2);
 db.exec('DROP TRIGGER fail_atomic');await json(await a.request(`${path}/messages`,'POST',message));assert.equal((await json(await b.request(path))).messages.length,3);
});
