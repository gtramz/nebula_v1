import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const headers={Origin:'http://127.0.0.1:4175','X-Nebula-Request':'1'};
async function account(page:Page,tag:string) {
 const response=await page.request.post('/api/rpc',{headers,data:{method:'register',args:[{name:'Private Artist',role:'artist',email:`private-${tag}@example.invalid`,password:'preview123'}]}});expect(response.ok()).toBe(true);
}
async function setup(page:Page,tag:string) {
 await account(page,tag);
 const file=await page.request.post('/api/uploads',{headers:{...headers,'X-Media-Kind':'audio'},data:await readFile('artifacts/nebula/public/discovery-demo/soft-signal.wav')});expect(file.ok()).toBe(true);
 const post=await page.request.post('/api/publications',{headers,data:{title:'Workspace original',description:'Test',mediaId:(await file.json()).id,coverId:null,projectId:null,allowRemix:true,status:'published'}});expect(post.ok()).toBe(true);return post.json();
}
async function enter(page:Page,id:number) {
 await page.goto(`/discovery?post=post-${id}`);await page.locator('article[data-active=true]').getByRole('button',{name:'Remix',exact:true}).click();await expect(page).toHaveURL(/\/studio\/remix$/);await expect(page.getByLabel('Remix title',{exact:true})).toBeVisible();
}
async function save(page:Page) {
 await page.getByRole('button',{name:'Save remix draft',exact:true}).click();await expect(page.getByText('Remix draft saved',{exact:true})).toBeVisible();
}
test('unfinished tracks and settings resume privately, direct entry lists drafts, and legacy GET does not create',async({page},info)=>{
 const post=await setup(page,`resume-${info.project.name}-${Date.now()}`);
 await page.goto(`/remix/${post.id}?mode=video`);await expect(page).toHaveURL(/\/studio\/remix$/);
 await expect(page.getByRole('button',{name:'Start private remix',exact:true})).toBeVisible();expect((await(await page.request.get('/api/remix-drafts')).json()).items).toHaveLength(0);
 await page.getByRole('button',{name:'Start private remix',exact:true}).click();
 await page.getByLabel('Remix title',{exact:true}).fill('Editable unfinished draft');await page.getByLabel('Description',{exact:true}).fill('Keep my source and track.');
 await page.getByLabel('Upload file',{exact:true}).setInputFiles('artifacts/nebula/public/discovery-demo/orbit.wav');await expect(page.getByText(/Your contribution is ready/)).toBeVisible();
 await page.getByLabel('Base volume',{exact:true}).press('Home');await save(page);
 const saved=(await(await page.request.get('/api/remix-drafts')).json()).items[0];expect(saved.render).toBeNull();expect(saved.contribution.id).toBeTruthy();
 await page.reload();await expect(page.getByLabel('Remix title',{exact:true})).toHaveValue('Editable unfinished draft');await expect(page.getByLabel('Description',{exact:true})).toHaveValue('Keep my source and track.');await expect(page.getByLabel('Base volume',{exact:true})).toHaveValue('0.05');await expect(page.getByText(/Your contribution is ready/)).toBeVisible();
 await expect(page.getByRole('button',{name:'Publish remix',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Your private drafts',exact:true}).click();await expect(page.getByRole('button',{name:'Resume draft',exact:true})).toBeVisible();
 await page.reload();await expect(page.getByRole('button',{name:'Resume draft',exact:true})).toBeVisible();await page.getByRole('button',{name:'Resume draft',exact:true}).click();await expect(page.getByLabel('Remix title',{exact:true})).toHaveValue('Editable unfinished draft');
 expect((await(await page.request.get('/api/publications?mine=1')).json()).items).toHaveLength(1);
 await page.getByRole('heading',{name:'Remix studio',exact:true}).evaluate(element=>element.scrollIntoView({behavior:'instant',block:'start'}));await page.waitForTimeout(300);await page.screenshot({path:info.outputPath('private-workspace.png')});
});
test('two tabs report conflicts without overwriting local edits and can reopen the saved version',async({page,context},info)=>{
 const post=await setup(page,`conflict-${info.project.name}-${Date.now()}`);await enter(page,post.id);await save(page);
 const second=await context.newPage();await second.goto('/studio/remix');await second.getByRole('button',{name:'Resume draft',exact:true}).click();await expect(second.getByLabel('Remix title',{exact:true})).toBeVisible();
 await page.getByLabel('Remix title',{exact:true}).fill('First tab wins');await save(page);
 await second.getByLabel('Remix title',{exact:true}).fill('Second tab kept locally');await second.getByRole('button',{name:'Save remix draft',exact:true}).click();await expect(second.getByRole('alert')).toContainText('another tab');await expect(second.getByLabel('Remix title',{exact:true})).toHaveValue('Second tab kept locally');
 expect((await(await page.request.get('/api/remix-drafts')).json()).items[0].title).toBe('First tab wins');
 second.on('dialog',dialog=>dialog.accept());await second.getByRole('button',{name:'Reopen saved draft',exact:true}).click();await expect(second.getByLabel('Remix title',{exact:true})).toHaveValue('First tab wins');await second.close();
});
test('session expiry clears workspace and account switching cannot recover another artist draft',async({page},info)=>{
 const tag=`expiry-${info.project.name}-${Date.now()}`,post=await setup(page,tag);await enter(page,post.id);await page.getByLabel('Remix title',{exact:true}).fill('Private identity work');await save(page);
 const draft=(await(await page.request.get('/api/remix-drafts')).json()).items[0];
 await page.request.post('/api/rpc',{headers,data:{method:'logout',args:[]}});
 await page.getByRole('button',{name:'Save remix draft',exact:true}).click();await expect(page.getByText('Log in as an artist to open your private workspace.',{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>sessionStorage.getItem('nebula-active-remix'))).toBeNull();
 await account(page,tag+'-second');await page.reload();await expect(page.getByText('No private drafts yet. Choose an original in Discovery to start.',{exact:true})).toBeVisible();
 expect((await page.request.get(`/api/remix-drafts/${draft.id}`)).status()).toBe(404);await expect(page.getByText('Private identity work',{exact:true})).toHaveCount(0);
});
