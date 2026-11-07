import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
const headers = { Origin: 'http://127.0.0.1:4175', 'X-Nebula-Request': '1' };
async function register(page: Page, tag: string) {
  const response = await page.request.post('/api/rpc', { headers, data: { method: 'register', args: [{ name: 'Discovery Artist', role: 'artist', email: `${tag}-${Date.now()}@example.invalid`, password: 'preview123' }] } });
  expect(response.ok()).toBe(true);
}
async function upload(page: Page, kind: string, data: Buffer) {
  const response = await page.request.post('/api/uploads', { headers: { ...headers, 'X-Media-Kind': kind, 'Content-Type': 'application/octet-stream' }, data }); expect(response.ok()).toBe(true); return (await response.json()).id;
}
async function publish(page: Page, title: string, mediaId: string, coverId: string | null = null) {
  const response = await page.request.post('/api/publications', { headers, data: { title, description: 'Full description. '.repeat(35), mediaId, coverId, projectId: null, allowRemix: true, status: 'published' } }); expect(response.ok()).toBe(true); return response.json();
}
const active = (page: Page) => page.locator('article[data-active=true]');
async function visibleGeometry(page: Page) {
  const article = active(page), media = (await article.locator('.discovery-media').boundingBox())!, rail = (await article.locator('.discovery-actions').boundingBox())!;
  expect(rail.x).toBeGreaterThanOrEqual(media.x + media.width);
  const buttons = article.locator('.discovery-actions button');
  for (let i=0; i<5; i++) { const box=(await buttons.nth(i).boundingBox())!; expect(box.width).toBeGreaterThanOrEqual(44); expect(box.height).toBeGreaterThanOrEqual(44); if (i) expect(box.y).toBeGreaterThan((await buttons.nth(i-1).boundingBox())!.y); }
  const bottom = page.viewportSize()!.height - (page.viewportSize()!.width < 768 ? 64 : 0);
  expect(rail.y).toBeGreaterThanOrEqual(0); expect(rail.y+rail.height).toBeLessThanOrEqual(bottom);
  expect(await article.evaluate(e=>e.scrollHeight<=e.clientHeight+1)).toBe(true);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
}

test('real audio waveform seeks without resetting playback, preserves artwork and handles unavailable waveform', async({page}, info)=>{
  await register(page,`wave-${info.project.name}`);
  const mediaId = await upload(page,'audio',await readFile('artifacts/nebula/public/discovery-demo/soft-signal.wav'));
  const coverId = await upload(page,'image',await readFile('artifacts/nebula/src/assets/antiq-logo.png'));
  const post=await publish(page,'A real waveform',mediaId,coverId);
  await page.goto(`/discovery?post=post-${post.id}`);
  await expect(active(page).locator('.discovery-waveform')).toBeVisible();
  await expect(active(page).getByAltText('A real waveform cover artwork')).toHaveCSS('object-fit','contain');
  const seek=active(page).getByRole('slider',{name:'Seek A real waveform'}), audio=active(page).locator('audio');
  await seek.fill('2.9'); await seek.press('ArrowRight'); await expect.poll(()=>audio.evaluate((e:HTMLAudioElement)=>e.currentTime)).toBeCloseTo(3,1);
  await expect(active(page).locator('clipPath rect')).toHaveAttribute('width',/375/);
  await active(page).getByRole('button',{name:'Play A real waveform',exact:true}).click();
  await active(page).getByRole('button',{name:'Star',exact:true}).click();
  await expect.poll(()=>audio.evaluate((e:HTMLAudioElement)=>e.paused)).toBe(false);
  await expect.poll(()=>audio.evaluate((e:HTMLAudioElement)=>e.currentTime)).toBeGreaterThan(3);
  await active(page).getByRole('slider',{name:'Volume A real waveform'}).fill('0.35');
  await expect.poll(()=>audio.evaluate((e:HTMLAudioElement)=>e.volume)).toBeCloseTo(.35);
  await active(page).getByRole('button',{name:'Mute A real waveform',exact:true}).click(); await expect.poll(()=>audio.evaluate((e:HTMLAudioElement)=>e.muted)).toBe(true);
  await active(page).getByRole('button',{name:'Unmute A real waveform',exact:true}).click();
  await expect.poll(()=>audio.evaluate((e:HTMLAudioElement)=>e.volume)).toBeCloseTo(.35);
  await active(page).getByRole('slider',{name:'Volume A real waveform'}).fill('0');
  await active(page).getByRole('button',{name:'Unmute A real waveform',exact:true}).click();
  await expect.poll(()=>audio.evaluate((e:HTMLAudioElement)=>e.volume)).toBe(1);
  await active(page).getByRole('button',{name:'Read description of A real waveform'}).click(); await expect(page.getByRole('dialog')).toContainText('Full description.');
  await expect.poll(()=>audio.evaluate((e:HTMLAudioElement)=>e.paused)).toBe(true); await page.keyboard.press('Escape');
  for(const width of [390,767,768,1023,1024,1440]) { await page.setViewportSize({width,height:900}); await visibleGeometry(page); if([390,768,1440].includes(width)) await page.screenshot({path:info.outputPath(`audio-${width}.png`)}); }
  await page.setViewportSize({width:660,height:390}); await visibleGeometry(page);
  await page.route('**/api/publications/*/waveform',r=>r.fulfill({status:503,json:{error:'Waveform unavailable'}}));
  await page.reload(); await expect(active(page).getByText('Waveform unavailable · audio timeline')).toBeVisible(); await expect(seek).toBeEnabled();
  await seek.fill('2'); await expect.poll(()=>audio.evaluate((e:HTMLAudioElement)=>e.currentTime)).toBeCloseTo(2,1);
  await page.unroute('**/api/publications/*/waveform');
  await page.request.post('/api/rpc',{headers,data:{method:'logout',args:[]}});
  let waveformRequests=0;page.on('request',r=>{if(r.url().endsWith('/waveform'))waveformRequests++;});
  await page.reload(); await expect(active(page).getByText('Audio timeline',{exact:true})).toBeVisible(); expect(waveformRequests).toBe(0);
});

test('portrait, landscape and square video stay contained with exclusive playback and responsive rails',async({page},info)=>{
  await register(page,`formats-${info.project.name}`);
  const ffmpeg=process.env.NEBULA_FFMPEG_PATH || (existsSync('.data/tools/ffmpeg') ? resolve('.data/tools/ffmpeg') : 'ffmpeg');
  const posts=[];
  for(const size of ['180x320','320x180','240x240']) {
    const video=execFileSync(ffmpeg,['-v','error','-f','lavfi','-i',`testsrc2=size=${size}:rate=12`,'-t','4','-c:v','libvpx','-f','webm','pipe:1']);
    posts.push(await publish(page,`Video ${size}`,await upload(page,'video',video)));
  }
  for(const post of posts) {
    await page.goto(`/discovery?post=post-${post.id}`);
    const video=active(page).locator('video');await expect.poll(()=>video.evaluate((e:HTMLVideoElement)=>e.readyState)).toBeGreaterThanOrEqual(2);
    await expect(video).toHaveCSS('object-fit','contain');
    for(const width of [390,768,1440]) {
      await page.setViewportSize({width,height:900});await visibleGeometry(page);
      expect(await video.evaluate(e=>{const r=e.getBoundingClientRect(),p=e.parentElement!.getBoundingClientRect();return r.width<=p.width+1&&r.height<=p.height+1&&r.height>80;})).toBe(true);
      if(width!==768)await page.screenshot({path:info.outputPath(`${post.title.replace(' ','-')}-${width}.png`)});
    }
    await active(page).getByRole('button',{name:'Comments',exact:true}).click();await expect.poll(()=>video.evaluate((e:HTMLVideoElement)=>e.paused)).toBe(true);await page.keyboard.press('Escape');
    await expect.poll(()=>video.evaluate((e:HTMLVideoElement)=>e.paused)).toBe(true);
    const feed=page.getByRole('region',{name:'Discovery feed'});await feed.focus();await page.keyboard.press('ArrowDown');
    await expect.poll(()=>page.locator('video,audio').evaluateAll(es=>es.filter(e=>!(e as HTMLMediaElement).paused).length)).toBeLessThanOrEqual(1);
  }
});

test('media errors can retry and wheel or touch advances the same feed without nested scroll',async({page},info)=>{
  await page.route('**/discovery-demo/after-hours.webm',route=>route.abort());
  await page.goto('/discovery?demo=1');
  await expect(active(page).getByText('Media unavailable.',{exact:true})).toBeVisible();
  await expect(active(page).getByRole('button',{name:'Star',exact:true})).toBeEnabled();
  await page.unroute('**/discovery-demo/after-hours.webm');
  await active(page).getByRole('button',{name:'Retry playback'}).click();
  await expect.poll(()=>active(page).locator('video').evaluate((e:HTMLVideoElement)=>e.readyState)).toBeGreaterThanOrEqual(2);
  await active(page).getByRole('button',{name:'Play after hours',exact:true}).click();
  const feed=page.getByRole('region',{name:'Discovery feed'}),box=(await feed.boundingBox())!;
  if(info.project.name==='mobile') {
    const cdp=await page.context().newCDPSession(page),x=box.x+box.width*.4,y=box.y+box.height*.7;
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
    for(let i=1;i<=6;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-i*box.height*.08}]});await page.waitForTimeout(25);}
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();
  } else { await page.mouse.move(box.x+box.width*.4,box.y+box.height*.5); await page.mouse.wheel(0,box.height*.75); }
  await expect(active(page)).not.toHaveAttribute('aria-label','after hours by Luna Vale');
  await expect.poll(()=>page.locator('video,audio').evaluateAll(es=>es.filter(e=>!(e as HTMLMediaElement).paused).length)).toBe(0);
  await expect.poll(()=>feed.evaluate(e=>Math.abs(e.scrollTop-(e.querySelector('[data-active=true]') as HTMLElement).offsetTop))).toBeLessThan(1);
  await visibleGeometry(page);
});
