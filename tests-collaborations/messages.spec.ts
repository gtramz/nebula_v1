import {test,expect,type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';
const headers={Origin:'http://127.0.0.1:4175','X-Nebula-Request':'1'};
const pdf={name:'Request proposal.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.7\nProposal evidence\n%%EOF')};
async function rpc(page:Page,method:string,...args:unknown[]){const r=await page.request.post('/api/rpc',{headers,data:{method,args}});expect(r.ok()).toBe(true);return (await r.json()).result;}
async function session(page:Page){return (await(await page.request.get('/api/session')).json()).user;}
async function register(page:Page,name:string,tag:string){await rpc(page,'register',{name,role:'artist',email:`${name}-${tag}@example.invalid`,password:'preview123'});return session(page);}

test('unified messages: separate artists review proposal, revise, accept, converse and deliver in the same thread',async({page,browser},info)=>{
 test.setTimeout(120_000);const tag=`${info.project.name}-${Date.now()}`;const owner=await register(page,'Publisher',tag);
 const context=await browser.newContext({baseURL:'http://127.0.0.1:4175',viewport:page.viewportSize()!,isMobile:info.project.name==='mobile',hasTouch:info.project.name==='mobile'}),outsiderContext=await browser.newContext({baseURL:'http://127.0.0.1:4175'});
 try{const a=await context.newPage(),c=await outsiderContext.newPage();await register(a,'Applicant',tag);await register(c,'Outsider',tag);
 const project=await rpc(page,'createProject',{title:'Unified project',category:'EP',goalAmount:1000,status:'published'});
 const response=await page.request.post(`/api/projects/${project.id}/offers`,{headers,data:{need:'Verse',deliverable:'Vocals and notes',requirements:'One revision',deadline:null,status:'open',compensation:{kind:'split',percent:10}}});expect(response.ok()).toBe(true);const offer=await response.json();
 await a.goto(`/project/${project.id}`);await a.getByRole('button',{name:'Contact artist',exact:true}).click();await expect(a).toHaveURL(new RegExp(`/messages/offer/${offer.id}$`));
 expect((await(await page.request.get('/api/messages?view=requests')).json()).items).toHaveLength(0);
 await a.getByLabel('Introduction',{exact:true}).fill('I would love to contribute.');await a.getByLabel('Your proposal',{exact:true}).fill('Complete first proposal.');await a.getByLabel('Work files (audio, video, PDF or ZIP)',{exact:true}).setInputFiles(pdf);await a.getByRole('checkbox').check();
 await a.getByRole('button',{name:'Send request',exact:true}).click();await expect(a).toHaveURL(/\/messages\/collaboration\/\d+$/);const route=new URL(a.url()).pathname,api=route.replace('/messages/collaboration/','/api/collaborations/');
 await expect(a.getByLabel('Message',{exact:true})).toHaveCount(0);expect((await c.request.get(api)).status()).toBe(404);
 await page.goto('/messages');await page.getByRole('button',{name:'Requests',exact:true}).click();await expect(page.getByRole('link',{name:/Unified project/})).toContainText('1 unread');await page.getByRole('link',{name:/Unified project/}).click();
 await expect(page).toHaveURL(new RegExp(`${route}$`));await expect(page.getByRole('link',{name:'Download Request proposal.pdf',exact:true})).toBeVisible();await expect(page.getByText('I would love to contribute.',{exact:true})).toBeVisible();
 await expect(page.getByLabel('Message',{exact:true})).toHaveCount(0);const detail=await(await page.request.get(api)).json();expect((await c.request.get(detail.submissions[0].files[0].url)).status()).toBe(404);
 const updated=await page.request.patch(`/api/offers/${offer.id}`,{headers,data:{...offer,requirements:'Updated brief'}});expect(updated.ok()).toBe(true);await page.reload();await expect(page.getByRole('button',{name:'Accept proposal',exact:true})).toBeDisabled();await expect(page.getByText('The offer terms changed. Request a revised proposal before accepting.',{exact:true})).toBeVisible();
 await page.getByLabel('Revision feedback',{exact:true}).fill('Please revise the final line.');await page.getByRole('button',{name:'Request changes',exact:true}).click();
 await a.reload();await a.getByLabel('Your proposal',{exact:true}).fill('Updated proposal.');await a.getByLabel('Work files (audio, video, PDF or ZIP)',{exact:true}).setInputFiles(pdf);await a.getByRole('checkbox').check();await a.getByRole('button',{name:'Send proposal',exact:true}).click();
 await expect(a.getByRole('form',{name:'Proposal form'})).toHaveCount(0);await page.reload();await page.getByRole('button',{name:'Accept proposal',exact:true}).click();await expect(page.getByLabel('Message',{exact:true})).toBeVisible();await expect(page).toHaveURL(new RegExp(`${route}$`));
 await a.reload();await a.getByLabel('Message',{exact:true}).fill('Thanks for accepting.');await a.getByRole('button',{name:'Send message',exact:true}).click();await expect(a.getByText('Thanks for accepting.',{exact:true})).toBeVisible();
 await a.getByLabel('Delivery notes',{exact:true}).fill('Final delivery.');await a.getByLabel('Work files (audio, video, PDF or ZIP)',{exact:true}).setInputFiles(pdf);await a.getByRole('button',{name:'Send delivery',exact:true}).click();await expect(a.getByRole('form',{name:'Delivery form'})).toHaveCount(0);
 await page.reload();await page.getByRole('button',{name:'Mark completed',exact:true}).click();await expect(page.getByText('This collaboration is completed.',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:/Mark viewed activity as read/}).click();await expect(page.getByRole('button',{name:/Mark viewed activity as read/})).toHaveCount(0);
 await page.getByRole('link',{name:'All messages',exact:true}).click();await page.getByRole('button',{name:'Conversations',exact:true}).click();await expect(page.getByRole('link',{name:/Unified project/})).toContainText('completed');
 await page.screenshot({path:info.outputPath('unified-inbox.png'),fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await a.goto(`/collaborations/${detail.id}`);await expect(a.getByText('Thanks for accepting.',{exact:true})).toBeVisible();
 }finally{await context.close();await outsiderContext.close();}
});

test('general requests use public profile, preserve rejection and retries, separate accounts and keep mobile access',async({page,browser},info)=>{
 test.setTimeout(90_000);const tag=`${info.project.name}-${Date.now()}`,owner=await register(page,'MessageOwner',tag);
 const context=await browser.newContext({baseURL:'http://127.0.0.1:4175',viewport:page.viewportSize()!,isMobile:info.project.name==='mobile',hasTouch:info.project.name==='mobile'});
 try{const a=await context.newPage(),applicant=await register(a,'MessageApplicant',tag);
 await a.goto(`/artist/${owner.artistId}`);await a.getByRole('link',{name:'Message',exact:true}).click();await expect(a.getByRole('heading',{name:'Message request',exact:true})).toBeVisible();
 await a.getByLabel('Introduction',{exact:true}).fill('A standalone request.');
 let first=true;await a.route('**/api/messages/requests',async route=>{if(first){first=false;await route.fetch();await route.fulfill({status:503,json:{error:'Response lost. Try again.'}});}else await route.continue();});
 await a.getByRole('button',{name:'Send request',exact:true}).click();await expect(a.getByRole('alert')).toContainText('Response lost');await a.reload();await expect(a.getByRole('link',{name:'Open existing conversation',exact:true})).toBeVisible();await a.getByRole('link',{name:'Open existing conversation',exact:true}).click();
 const path=new URL(a.url()).pathname;await expect(a.getByLabel('Message',{exact:true})).toHaveCount(0);
 expect((await(await page.request.get('/api/notifications')).json()).items).toHaveLength(1);
 await page.goto('/notifications');await page.getByRole('link',{name:'View conversation',exact:true}).click();await expect(page).toHaveURL(new RegExp(`${path}$`));
 await page.getByLabel('Decline response (optional)',{exact:true}).fill('Thank you, I am unavailable.');await page.getByRole('button',{name:'Decline request',exact:true}).click();await expect(page.getByText('This request is closed. The history remains available.',{exact:true})).toBeVisible();
 await a.reload();await expect(a.getByText('Thank you, I am unavailable.',{exact:true})).toBeVisible();await expect(a.getByLabel('Message',{exact:true})).toHaveCount(0);
 await page.goto('/messages');await page.getByRole('button',{name:'Requests',exact:true}).click();await expect(page.getByText('No requests here yet.',{exact:true})).toBeVisible();await page.getByLabel('Closed requests',{exact:true}).check();await expect(page.getByRole('link',{name:/MessageApplicant/})).toContainText('rejected');
 const nav=page.getByRole('navigation',{name:'Primary navigation'});await expect(nav.getByRole('link',{name:'messages',exact:true})).toBeVisible();expect(await nav.getByRole('link',{name:'messages',exact:true}).boundingBox()).toMatchObject({});
 await page.screenshot({path:info.outputPath('closed-requests.png'),fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 // In-flight list response cannot reappear after an identity switch.
 let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});await page.route('**/api/messages?*',async route=>{const response=await route.fetch();await gate;await route.fulfill({response}).catch(()=>{});});
 await page.reload({waitUntil:'domcontentloaded'});await rpc(page,'logout');await register(page,'FreshArtist',tag);await page.goto('/messages',{waitUntil:'domcontentloaded'});release();await page.unroute('**/api/messages?*');await page.reload();await expect(page.getByText('No conversations yet.',{exact:true})).toBeVisible();await expect(page.getByRole('link',{name:/MessageApplicant/})).toHaveCount(0);
 expect((await page.request.get(`/api${path}`)).status()).toBe(404);
 await rpc(page,'logout');await rpc(page,'register',{name:'Message Investor',role:'investor',email:`investor-${tag}@example.invalid`,password:'preview123'});await page.goto('/messages');await expect(page.getByText('Messages are available to artist accounts.',{exact:true})).toBeVisible();await expect(page.getByRole('navigation',{name:'Primary navigation'}).getByRole('link',{name:'messages',exact:true})).toHaveCount(0);
 }finally{await context.close();}
});

test('accepted general chat retries one message and discards delayed responses after logout',async({page,browser},info)=>{
 test.setTimeout(90_000);const tag=`accepted-${info.project.name}-${Date.now()}`,owner=await register(page,'ChatOwner',tag),context=await browser.newContext({baseURL:'http://127.0.0.1:4175'});
 try{const a=await context.newPage();await register(a,'ChatApplicant',tag);await a.goto(`/messages/new/${owner.artistId}`);await a.getByLabel('Introduction',{exact:true}).fill('Start our conversation');await a.getByRole('button',{name:'Send request',exact:true}).click();await expect(a).toHaveURL(/\/messages\/general\/\d+$/);const path=new URL(a.url()).pathname;
 await page.goto(path);await page.getByRole('button',{name:'Accept request',exact:true}).click();await expect(page.getByLabel('Message',{exact:true})).toBeVisible();await a.reload();await expect(a.getByLabel('Message',{exact:true})).toBeVisible();
 let lose=true;await a.route(`**/api${path}/messages`,async route=>{if(lose){lose=false;await route.fetch();await route.fulfill({status:503,json:{error:'Message response lost'}});}else await route.continue();});
 await a.getByLabel('Message',{exact:true}).fill('Retry this once.');await a.getByRole('button',{name:'Send message',exact:true}).click();await expect(a.getByRole('alert')).toContainText('Message response lost');await a.getByRole('button',{name:'Send message',exact:true}).click();await expect(a.getByText('Retry this once.',{exact:true})).toHaveCount(1);
 const detail=await(await page.request.get(`/api${path}`)).json();expect(detail.messages.filter((m:{text:string})=>m.text==='Retry this once.')).toHaveLength(1);
 await a.unroute(`**/api${path}/messages`);let release!:()=>void,captured=false;const gate=new Promise<void>(resolve=>{release=resolve;});await a.route(`**/api${path}/messages`,async route=>{const response=await route.fetch();captured=true;await gate;await route.fulfill({response}).catch(()=>{});});
 await a.getByLabel('Message',{exact:true}).fill('Saved before logout.');await a.getByRole('button',{name:'Send message',exact:true}).click();await expect.poll(()=>captured).toBe(true);await rpc(a,'logout');a.once('dialog',dialog=>dialog.accept());await a.goto('/messages',{waitUntil:'domcontentloaded'});release();await expect(a.getByText('Log in as an artist to send and review requests.',{exact:true})).toBeVisible();await expect(a.getByText('Saved before logout.',{exact:true})).toHaveCount(0);
 expect((await a.request.get(`/api${path}`)).status()).toBe(401);expect((await(await page.request.get(`/api${path}`)).json()).messages.filter((m:{text:string})=>m.text==='Saved before logout.')).toHaveLength(1);
 }finally{await context.close();}
});
