import { clickProfileLogout } from '../tests-support/profile-actions';
import { test, expect, type Page } from '@playwright/test';
const headers={Origin:'http://127.0.0.1:4175','X-Nebula-Request':'1'};
async function rpc(page:Page,method:string,...args:unknown[]) {const r=await page.request.post('/api/rpc',{headers,data:{method,args}});expect(r.ok(),await r.text()).toBe(true);return (await r.json()).result;}
async function artist(page:Page,name:string){return rpc(page,'register',{name,email:`${crypto.randomUUID()}@example.invalid`,password:'preview123',role:'artist'});}

test('delayed private RPC cannot restore the visible signed-out identity',async({page},info)=>{
 const a=await artist(page,'Delayed Identity');await page.goto('/profile');
 let release!:()=>void;const gate=new Promise<void>(r=>release=r);let captured=false;
 await page.route('**/api/rpc',async route=>{if(route.request().postDataJSON()?.method==='getMyArtistPreferences'&&!captured){captured=true;const response=await route.fetch();await gate;await route.fulfill({response}).catch(()=>{});}else await route.continue();});
 await page.getByRole('button',{name:'EDIT PROFILE',exact:true}).click();await expect.poll(()=>captured).toBe(true);
 await clickProfileLogout(page);await expect(page).toHaveURL(/\/$/);
 expect((await (await page.request.get('/api/session')).json()).user).toBeNull();
 await page.evaluate(()=>{(window as any).__auditIdentityEvents=[];window.addEventListener('nebula-session-identity',(event:any)=>(window as any).__auditIdentityEvents.push(event.detail));});
 release();await page.waitForTimeout(600);
 const events=await page.evaluate(()=>(window as any).__auditIdentityEvents);
 await page.screenshot({path:info.outputPath('stale-identity-after-logout.png')});
 const denied=await page.request.post('/api/rpc',{headers,data:{method:'getMyArtistPreferences',args:[]}});expect(denied.status()).toBe(401);
 await info.attach('delayed-identity.json',{body:JSON.stringify({artistId:a.artistId,events,serverUser:(await (await page.request.get('/api/session')).json()).user}),contentType:'application/json'});
 expect(events).not.toContain(a.artistId);
});

test('parallel editors preserve changes to unrelated identity fields',async({page,context},info)=>{
 await artist(page,'Concurrent Artist');await page.goto('/profile?edit=1');
 await expect(page.getByLabel('bio',{exact:true})).toBeVisible();
 const other=await context.newPage();await other.goto('/profile?edit=1');await expect(other.getByLabel('bio',{exact:true})).toBeVisible();
 await other.getByLabel('bio',{exact:true}).fill('Saved in second tab');await other.getByRole('button',{name:'save profile',exact:true}).click();
 await expect(other.getByRole('heading',{name:'edit artist profile'})).toHaveCount(0);
 await page.getByLabel('artist name',{exact:true}).fill('Renamed in first tab');await page.getByRole('button',{name:'save profile',exact:true}).click();
 await expect(page.getByRole('heading',{name:'edit artist profile'})).toHaveCount(0);
 const user=(await (await page.request.get('/api/session')).json()).user;
 await info.attach('concurrent-identity.json',{body:JSON.stringify({name:user.artist.name,bio:user.artist.bio}),contentType:'application/json'});
 expect(user.artist.bio).toBe('Saved in second tab');await other.close();
});


test('same-field conflict preserves the newer profile and keeps the draft visible', async ({ page, context }) => {
 await artist(page, 'Conflict Artist'); await page.goto('/profile?edit=1');
 await expect(page.getByLabel('bio', { exact: true })).toBeVisible();
 const other = await context.newPage(); await other.goto('/profile?edit=1');
 await other.getByLabel('bio', { exact: true }).fill('Newer biography');
 await other.getByRole('button', { name: 'save profile', exact: true }).click();
 await expect(other.getByRole('heading', { name: 'edit artist profile' })).toHaveCount(0);
 await page.getByLabel('bio', { exact: true }).fill('Stale biography');
 await page.getByRole('button', { name: 'save profile', exact: true }).click();
 await expect(page.getByRole('alert')).toContainText('changed in another tab');
 await expect(page.getByRole('textbox', { name: 'bio', exact: true })).toHaveValue('Stale biography');
 expect((await (await page.request.get('/api/session')).json()).user.artist.bio).toBe('Newer biography');
 await other.close();
});

test('login waits for delayed logout cookies and keeps the new server session', async ({ page }) => {
 const email = `${crypto.randomUUID()}@example.invalid`;
 const account = await rpc(page, 'register', { name: 'Race Artist', email, password: 'preview123', role: 'artist' });
 await page.goto('/profile');
 let release!: () => void;
 const gate = new Promise<void>(resolve => { release = resolve; });
 let captured = false, loginRequests = 0;
 await page.route('**/api/rpc', async route => {
   const method = route.request().postDataJSON()?.method;
   if (method === 'login') loginRequests++;
   if (method === 'logout' && !captured) {
     const response = await route.fetch(); captured = true;
     await gate; await route.fulfill({ response });
   } else await route.continue();
 });
 await clickProfileLogout(page);
 await expect.poll(() => captured).toBe(true);
 await page.locator('.shell-page').getByRole('link', { name: 'log in', exact: true }).click();
 await page.getByLabel('email', { exact: true }).fill(email);
 await page.getByLabel('password', { exact: true }).fill('preview123');
 await page.getByRole('button', { name: 'log in', exact: true }).click();
 await page.waitForTimeout(200); expect(loginRequests).toBe(0);
 release();
 await expect(page).toHaveURL(/\/profile$/);
 expect((await (await page.request.get('/api/session')).json()).user.artistId).toBe(account.artistId);
 await page.reload(); await expect(page.getByRole('heading', { name: 'Race Artist', exact: true })).toBeVisible();
});

test('concurrent private preferences merge safely, persist and stay private', async ({ page, context }) => {
 const account = await artist(page, 'Private Preferences Artist');
 const baseline = { profile: account.artist, preferences: await rpc(page, 'getMyArtistPreferences') };
 await rpc(page, 'updateArtistIdentity', { preferences: { discovery: { projectTypes: ['ep'] } } });
 await rpc(page, 'updateArtistIdentity', { preferences: { discovery: { opportunityTypes: ['Funding'] } }, expected: baseline });
 const conflict = await page.request.post('/api/rpc', { headers, data: { method: 'updateArtistIdentity', args: [{ profile: { name: 'Must not save' }, preferences: { discovery: { projectTypes: ['single'] } }, expected: baseline }] } });
 expect(conflict.status()).toBe(400); expect((await conflict.json()).error).toContain('changed in another tab');
 await page.goto('/profile'); await page.reload();
 expect((await rpc(page, 'getMyArtistPreferences')).discovery).toMatchObject({ projectTypes: ['ep'], opportunityTypes: ['Funding'] });
 expect((await (await page.request.get('/api/session')).json()).user.name).toBe('Private Preferences Artist');
 const visitor = await context.browser()!.newContext({ baseURL: 'http://127.0.0.1:4175' }); const other = await visitor.newPage();
 const publicProfile = await rpc(other, 'getPublicArtist', account.artistId);
 expect(JSON.stringify(publicProfile)).not.toContain('opportunityTypes');
 const denied = await other.request.post('/api/rpc', { headers, data: { method: 'getMyArtistPreferences', args: [] } });
 expect(denied.status()).toBe(401); await visitor.close();
});
