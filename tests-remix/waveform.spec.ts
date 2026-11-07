import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const headers={Origin:'http://127.0.0.1:4175','X-Nebula-Request':'1'};
function wav(seconds:number) { const n=8000*seconds,b=Buffer.alloc(44+n*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(8000,24);b.writeUInt32LE(16000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(n*2,40);for(let i=0;i<n;i++)b.writeInt16LE(i<8000?0:Math.round(Math.sin(i/8000*440*Math.PI*2)*8000),44+i*2);return b; }
async function source(page:Page,tag:string,seconds=70,kind:'audio'|'video'='audio') {
 const registration=await page.request.post('/api/rpc',{headers,data:{method:'register',args:[{name:'Waveform Artist',role:'artist',email:`wave-${tag}@example.invalid`,password:'preview123'}]}});expect(registration.ok()).toBe(true);
 const media=await page.request.post('/api/uploads',{headers:{...headers,'X-Media-Kind':kind},data:kind==='audio'?wav(seconds):await readFile('artifacts/nebula/public/discovery-demo/after-hours.webm')});expect(media.ok()).toBe(true);
 const response=await page.request.post('/api/publications',{headers,data:{title:'Waveform original',description:'Test waveform',mediaId:(await media.json()).id,coverId:null,projectId:null,allowRemix:true,status:'published'}});expect(response.ok()).toBe(true);return response.json();
}
async function screenshot(page:Page,name:string,path:string){await page.getByRole('heading',{name,exact:true}).evaluate(e=>e.scrollIntoView({behavior:'instant',block:'start'}));await page.waitForTimeout(300);await page.screenshot({path});}

test('single duration control, fixed handles, zoom and overview stay consistent',async({page},info)=>{
 const post=await source(page,`presets-${info.project.name}-${Date.now()}`);await page.goto(`/remix/${post.id}`);
 await expect(page.getByRole('button',{name:/^Clip duration:/})).toContainText('30s');
 await expect(page.getByText('Loading waveform…',{exact:true})).toHaveCount(0);
 await expect(page.getByText('Waveform unavailable.',{exact:false})).toHaveCount(0);
 await expect(page.getByTestId('waveform-track').locator('svg path').first()).toHaveAttribute('d',/^M/);
 const start=page.getByRole('slider',{name:'Trim start',exact:true}),end=page.getByRole('slider',{name:'Trim end',exact:true});
 await start.focus();await start.press('Shift+ArrowRight');await expect(start).toHaveAttribute('aria-valuenow','1');await expect(end).toHaveAttribute('aria-valuenow','31');
 await end.press('End');await expect(start).toHaveAttribute('aria-valuenow','40');await expect(end).toHaveAttribute('aria-valuenow','70');
 const duration=page.getByRole('button',{name:/^Clip duration:/});
 await expect(page.getByRole('group',{name:'Clip duration',exact:true}).getByRole('button')).toHaveCount(1);
 await duration.click();await expect(duration).toContainText('60s');await expect(start).toHaveAttribute('aria-valuenow','10');await expect(end).toHaveAttribute('aria-valuenow','70');
 await duration.click();await expect(duration).toContainText('15s');await expect(start).toHaveAttribute('aria-valuenow','10');await expect(end).toHaveAttribute('aria-valuenow','25');
 await end.press('Shift+ArrowLeft');await expect(start).toHaveAttribute('aria-valuenow','9');await expect(end).toHaveAttribute('aria-valuenow','24');
 await duration.click();await expect(duration).toContainText('30s');
 await page.getByRole('button',{name:'Fit selection',exact:true}).click();await page.getByRole('button',{name:'Zoom out',exact:true}).click();
 const overview=page.getByRole('slider',{name:'Clip location in original',exact:true});await overview.press('End');await expect(start).toHaveAttribute('aria-valuenow','40');await expect(end).toHaveAttribute('aria-valuenow','70');await overview.press('Home');await expect(start).toHaveAttribute('aria-valuenow','0');await expect(end).toHaveAttribute('aria-valuenow','30');
 for(const text of ['Custom','Fine adjustment','Up to 60 seconds from an original up to 10 minutes.'])await expect(page.getByText(text,{exact:true})).toHaveCount(0);
 await expect(page.getByRole('slider',{name:'Timeline position',exact:true})).toHaveCount(0);
 await expect(page.getByLabel('Your contribution starts at (seconds)',{exact:true})).toHaveCount(0);
 await expect(page.getByText(/The original stays credited/)).toHaveCount(0);
 await screenshot(page,'1. Choose the base fragment',info.outputPath('waveform-studio.png'));
 await page.getByTestId('waveform-track').evaluate(e=>e.scrollIntoView({behavior:'instant',block:'start'}));await page.waitForTimeout(300);await page.screenshot({path:info.outputPath('waveform-controls.png')});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});

test('pointer and touch dragging move fixed clips; scrubbing preserves the preview while trimming invalidates it',async({page},info)=>{
 test.setTimeout(60000);const post=await source(page,`gesture-${info.project.name}-${Date.now()}`);await page.goto(`/remix/${post.id}`);await expect(page.getByRole('button',{name:/^Clip duration:/})).toContainText('30s');
 const selection=page.getByRole('slider',{name:'Move selected fragment',exact:true});await selection.evaluate(e=>e.scrollIntoView({behavior:'instant',block:'center'}));await page.waitForTimeout(300);
 const box=(await selection.boundingBox())!;const x=box.x+box.width/2,y=box.y+50;
 if(info.project.name==='mobile') { const cdp=await page.context().newCDPSession(page);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});for(let i=1;i<=5;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+7*i,y}]});await page.waitForTimeout(25);}await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach(); }
 else {await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+35,y,{steps:5});await page.mouse.up();}
 const start=Number(await page.getByRole('slider',{name:'Trim start',exact:true}).getAttribute('aria-valuenow')),end=Number(await page.getByRole('slider',{name:'Trim end',exact:true}).getAttribute('aria-valuenow'));expect(start).toBeGreaterThan(1);expect(end-start).toBeCloseTo(30,2);
 await page.getByRole('button',{name:/^Clip duration:/}).click();await page.getByRole('button',{name:/^Clip duration:/}).click();
 await selection.press('Home');await selection.press('Shift+ArrowRight');
 await page.getByLabel('Remix title',{exact:true}).fill('Keep this title');await page.getByLabel('Upload file',{exact:true}).setInputFiles({name:'own.wav',mimeType:'audio/wav',buffer:wav(2)});
 await expect(page.getByText(/Your contribution is ready/)).toBeVisible();await page.getByRole('button',{name:'Build preview',exact:true}).click();await expect(page.getByRole('button',{name:'Save remix draft',exact:true})).toBeEnabled();
 const scrub=page.getByRole('slider',{name:'Playback position',exact:true});await scrub.press('ArrowRight');await expect(page.getByRole('button',{name:'Save remix draft',exact:true})).toBeEnabled();
 await scrub.press('End');await scrub.press('Shift+ArrowLeft');
 await page.getByRole('button',{name:'Play selection',exact:true}).click();await expect(page.getByRole('button',{name:'Pause',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Play selection',exact:true})).toBeVisible({timeout:5000});
 expect(await page.locator('audio[aria-label="Original fragment"]').evaluate((e:HTMLAudioElement)=>e.currentTime)).toBeCloseTo(16,1);
 await page.getByRole('slider',{name:'Trim end',exact:true}).press('Shift+ArrowLeft');
 await expect(page.getByLabel('Remix title',{exact:true})).toHaveValue('Keep this title');await expect(page.getByRole('region',{name:'Remix preview',exact:true}).locator('audio,video')).toHaveCount(0);
 await page.getByRole('button',{name:'Build preview',exact:true}).click();await expect(page.getByRole('button',{name:'Save remix draft',exact:true})).toBeEnabled();
 const saved=page.waitForResponse(response=>response.url().endsWith('/api/publications')&&response.request().method()==='POST');
 await page.getByRole('button',{name:'Save remix draft',exact:true}).click();await expect(page.getByText('Remix draft saved',{exact:true})).toBeVisible();
 expect((await(await saved).json()).remix).toMatchObject({startSeconds:0,endSeconds:15,voiceOffset:0});

});

test('short originals, processor fallback and video playback use the same selector',async({page},info)=>{
 const post=await source(page,`short-${info.project.name}-${Date.now()}`,8);await page.route(`**/api/publications/${post.id}/waveform`,route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Processor unavailable'})}));await page.goto(`/remix/${post.id}`);
 await expect(page.getByRole('button',{name:/^Clip duration:/})).toContainText('8s');await expect(page.getByRole('button',{name:/^Clip duration:/})).toBeDisabled();
 await expect(page.getByText(/Waveform unavailable/)).toBeVisible();await expect(page.getByRole('button',{name:'Play selection',exact:true})).toBeEnabled();await page.unroute(`**/api/publications/${post.id}/waveform`);await page.getByRole('button',{name:'Retry waveform',exact:true}).click();await expect(page.getByText(/Waveform unavailable/)).toHaveCount(0);await expect(page.getByTestId('waveform-track').locator('svg path').first()).toHaveAttribute('d',/^M/);
 const video=await source(page,`video-${info.project.name}-${Date.now()}`,8,'video');await page.goto(`/remix/${video.id}`);await expect(page.locator('video[aria-label="Original fragment"]')).toBeVisible();expect(await page.locator('video[aria-label="Original fragment"]').evaluate((e:HTMLVideoElement)=>e.controls)).toBe(false);
 await expect(page.getByTestId('waveform-track').locator('svg path').first()).toHaveAttribute('d',/^M/);await page.getByRole('slider',{name:'Playback position',exact:true}).press('Shift+ArrowRight');expect(await page.locator('video[aria-label="Original fragment"]').evaluate((e:HTMLVideoElement)=>e.currentTime)).toBeCloseTo(1,1);
});
