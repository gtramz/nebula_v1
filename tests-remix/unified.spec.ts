import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const headers = { Origin: 'http://127.0.0.1:4175', 'X-Nebula-Request': '1' };
async function rpc(page: Page, method: string, ...args: unknown[]) { const response = await page.request.post('/api/rpc', { headers, data: { method, args } }); expect(response.ok()).toBe(true); return (await response.json()).result; }
async function original(page: Page, tag: string, large = false) {
  await rpc(page, 'register', { name: 'Unified Artist', role: 'artist', email: `unified-${tag}@example.invalid`, password: 'preview123' });
  let bytes = await readFile('artifacts/nebula/public/discovery-demo/soft-signal.wav');
  if (large) { // Real valid PCM above the old 25 MB audio-mixing limit, below ten minutes.
    const count = 27 * 1024 * 1024; bytes = Buffer.alloc(44 + count); bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length-8,4); bytes.write('WAVEfmt ',8); bytes.writeUInt32LE(16,16); bytes.writeUInt16LE(1,20); bytes.writeUInt16LE(1,22); bytes.writeUInt32LE(44100,24); bytes.writeUInt32LE(88200,28); bytes.writeUInt16LE(2,32); bytes.writeUInt16LE(16,34); bytes.write('data',36); bytes.writeUInt32LE(count,40);
  }
  const uploaded = await page.request.post('/api/uploads', { headers: { ...headers, 'X-Media-Kind': 'audio' }, data: bytes }); expect(uploaded.ok()).toBe(true);
  const response = await page.request.post('/api/publications', { headers, data: { title: 'Unified original', description: 'Test', mediaId: (await uploaded.json()).id, coverId: null, projectId: null, allowRemix: true, status: 'published' } }); expect(response.ok()).toBe(true); return response.json();
}

test('one studio switches contribution formats without losing fields and returns to the original', async ({ page }, info) => {
  test.setTimeout(60000);
  const post = await original(page, `replace-${info.project.name}-${Date.now()}`);
  await page.goto(`/remix/${post.id}?mode=video`);
  await expect(page.getByRole('heading', { name: 'Remix studio', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /Switch to|Create a video remix/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Record audio', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Record video', exact: true })).toBeEnabled();
  await page.getByLabel('Remix title', { exact: true }).fill('Kept title'); await page.getByLabel('Description', { exact: true }).fill('Kept description');
  await page.getByLabel('Base volume', { exact: true }).press('Home'); await page.getByLabel('Your contribution volume', { exact: true }).press('End');
  const input = page.getByLabel('Upload file', { exact: true }), preview = page.getByRole('region', { name: 'Remix preview', exact: true });
  await input.setInputFiles('artifacts/nebula/public/discovery-demo/soft-signal.wav');
  await expect(page.getByText('Result: the original audio mixed with your sound.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Build preview', exact: true }).click(); await expect(page.getByRole('button', { name: 'Publish remix', exact: true })).toBeEnabled();
  await expect(preview.locator('audio')).toHaveCount(1);
  await input.setInputFiles('artifacts/nebula/public/discovery-demo/after-hours.webm');
  await expect(page.getByText('Result: your video with the original audio and your sound.', { exact: true })).toBeVisible();
  await expect(preview.locator('audio, video')).toHaveCount(0); await expect(page.getByRole('button', { name: 'Publish remix', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Build preview', exact: true }).click(); await expect(page.getByRole('button', { name: 'Publish remix', exact: true })).toBeEnabled({ timeout: 15000 });
  await expect(preview.locator('video')).toHaveCount(1);
  await input.setInputFiles('artifacts/nebula/public/discovery-demo/orbit.wav'); await expect(page.getByText('Result: the original audio mixed with your sound.', { exact: true })).toBeVisible();
  await expect(preview.locator('audio, video')).toHaveCount(0);
  for (const [label, value] of [['Remix title','Kept title'],['Description','Kept description'],['Base volume','0.05'],['Your contribution volume','1']]) await expect(label === 'Description' ? page.getByRole('textbox',{name:label,exact:true}) : page.getByLabel(label,{exact:true})).toHaveValue(value);
  await expect(page.getByRole('slider',{name:'Trim start',exact:true})).toHaveAttribute('aria-valuenow','0');
  await expect(page.getByRole('slider',{name:'Trim end',exact:true})).toHaveAttribute('aria-valuenow','8');
  for (const [name, file] of [['Remix studio', 'unified-studio'], ['2. Add your contribution', 'unified-contribution'], ['3. Preview your mix', 'unified-preview']]) {
    await page.getByRole('heading', { name, exact: true }).evaluate(element => element.scrollIntoView({ behavior: 'instant', block: 'start' }));
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300); // Allow the scrolled layer to paint before visual capture.
    await page.screenshot({ path: info.outputPath(`${file}.png`) });
  }
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  page.once('dialog', dialog=>dialog.accept()); await page.getByRole('link',{name:'Back to Discovery',exact:true}).click();
  await expect(page).toHaveURL(new RegExp(`/discovery\\?post=post-${post.id}$`));await expect(page.locator('article[data-active=true]').getByRole('heading',{name:'Unified original',exact:true})).toBeVisible();
});

test('large audio original keeps video remix available while audio mixing is disabled', async ({page},info)=>{
  test.setTimeout(60000);
  const post=await original(page,`large-${info.project.name}-${Date.now()}`,true);await page.goto(`/remix/${post.id}`);
  await expect(page.getByText(/This original exceeds the 25 MB audio mixing limit/)).toBeVisible();
  await expect(page.getByRole('button',{name:'Record audio',exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'Record video',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:/^Clip duration:/}).click(); await page.getByRole('button',{name:/^Clip duration:/}).click();
  await expect(page.getByRole('button',{name:/^Clip duration:/})).toContainText('15s');
  await page.getByLabel('Upload file',{exact:true}).setInputFiles('artifacts/nebula/public/discovery-demo/after-hours.webm');
  await expect(page.getByText(/Your contribution is ready/)).toBeVisible();await page.getByRole('button',{name:'Build preview',exact:true}).click();
  await expect(page.getByRole('button',{name:'Publish remix',exact:true})).toBeEnabled({timeout:20000});
  await page.getByRole('button',{name:'Save remix draft',exact:true}).click();await expect(page.getByText('Remix draft saved',{exact:true})).toBeVisible();
  await expect(page.locator('video')).toHaveCount(1);
});

test('direct entry respects visitor, investor, revoked and derived-publication restrictions',async({page,browser},info)=>{
  test.setTimeout(60000);
  const post=await original(page,`access-${info.project.name}-${Date.now()}`);
  const context=await browser.newContext({baseURL:'http://127.0.0.1:4175',viewport:page.viewportSize()!});
  try {
    const visitor=await context.newPage();await visitor.goto(`/discovery?post=post-${post.id}`);
    await visitor.locator('article[data-active=true]').getByRole('button',{name:'Remix',exact:true}).click();
    await expect(visitor.getByRole('dialog').getByRole('link',{name:'log in',exact:true})).toBeVisible();
    await visitor.goto(`/remix/${post.id}`);await expect(visitor.getByText('Log in as an artist on the local server to create a remix.',{exact:true})).toBeVisible();
    await rpc(visitor,'register',{name:'Unified Investor',role:'investor',email:`investor-${info.project.name}-${Date.now()}@example.invalid`,password:'preview123'});
    await visitor.goto(`/discovery?post=post-${post.id}`);await expect(visitor.locator('article[data-active=true]').getByRole('button',{name:'Remix is for artists',exact:true})).toBeDisabled();
    const upload=await page.request.post('/api/uploads',{headers:{...headers,'X-Media-Kind':'audio'},data:await readFile('artifacts/nebula/public/discovery-demo/orbit.wav')});
    const response=await page.request.post('/api/publications',{headers,data:{title:'Derived original',description:'Test',mediaId:(await upload.json()).id,coverId:null,projectId:null,allowRemix:false,status:'published',remix:{sourceId:post.id,sourceRevision:post.revision,contributionKind:'audio',startSeconds:0,endSeconds:2,baseGain:.5,voiceGain:.5,voiceOffset:0}}});expect(response.ok()).toBe(true);const remix=await response.json();
    await page.goto(`/discovery?post=post-${remix.id}`);await expect(page.locator('article[data-active=true]').getByRole('button',{name:'Remixes of remixes are unavailable',exact:true})).toBeDisabled();
    await page.goto(`/remix/${remix.id}`);await expect(page.getByRole('heading',{name:'Remix unavailable',exact:true})).toBeVisible();
    await page.request.patch(`/api/publications/${post.id}`,{headers,data:{...post,allowRemix:false}});
    await page.goto(`/remix/${post.id}`);await expect(page.getByRole('heading',{name:'Remix unavailable',exact:true})).toBeVisible();
  }finally{await context.close();}
});
