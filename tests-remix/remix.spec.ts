import { openLegacy, previewReady, noPreview } from './helpers';
import { test, expect, type Page } from '@playwright/test';

const headers = { Origin: 'http://127.0.0.1:4175', 'X-Nebula-Request': '1' };
function wave(seconds: number, amplitude: number) {
  const rate = 44100, count = Math.round(rate * seconds), bytes = Buffer.alloc(44 + count * 2);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(count * 2, 40);
  for (let i = 0; i < count; i++) bytes.writeInt16LE(Math.round(amplitude * 32767), 44 + i * 2);
  return bytes;
}
async function rpc(page: Page, method: string, ...args: unknown[]) {
  const response = await page.request.post('/api/rpc', { headers, data: { method, args } }); expect(response.ok()).toBe(true); return (await response.json()).result;
}
async function source(page: Page, tag: string, seconds = 8) {
  await rpc(page, 'register', { name: 'Original Artist', role: 'artist', email: `original-${tag}@example.invalid`, password: 'preview123' });
  const project = await rpc(page, 'createProject', { title: 'Remix EP', category: 'EP', goalAmount: 1000, status: 'published' });
  const offer = await page.request.post(`/api/projects/${project.id}/offers`, { headers, data: { need: 'Verse', deliverable: 'An original verse over this base.', requirements: 'One revision.', deadline: null, compensation: { kind: 'split', percent: 15 }, status: 'open' } }); expect(offer.ok()).toBe(true);
  const mediaResponse = await page.request.post('/api/uploads', { headers: { ...headers, 'X-Media-Kind': 'audio', 'Content-Type': 'application/octet-stream' }, data: wave(seconds, .2) }); expect(mediaResponse.ok()).toBe(true);
  const media = await mediaResponse.json();
  const response = await page.request.post('/api/publications', { headers, data: { title: 'Open original', description: 'A base for your voice.', mediaId: media.id, coverId: null, projectId: project.id, allowRemix: true, status: 'published' } }); expect(response.ok()).toBe(true); return response.json();
}

test('audio mix contains both tracks, survives editable draft reload, credits the original and becomes a proposal', async ({ page, browser }, info) => {
  test.setTimeout(100_000);
  const original = await source(page, `mix-${info.project.name}-${Date.now()}`, 20);
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:4175', viewport: page.viewportSize()!, isMobile: info.project.name === 'mobile', hasTouch: info.project.name === 'mobile' });
  try {
    const artist = await context.newPage(), errors: string[] = []; artist.on('pageerror', error => errors.push(error.message));
    await rpc(artist, 'register', { name: 'Remix Vocalist', role: 'artist', email: `mix-${info.project.name}-${Date.now()}@example.invalid`, password: 'preview123' });
    await artist.goto(`/discovery?post=post-${original.id}`);
    await artist.locator('article[data-active=true]').getByRole('button', { name: 'Remix', exact: true }).click();
    await expect(artist).toHaveURL(/\/studio\/remix$/); await expect(artist.getByRole('dialog')).toHaveCount(0);
    await expect(artist.getByText(/Original duration: 20.00 seconds/)).toBeVisible();
    const fragment = artist.getByRole('slider', { name: 'Move clip start', exact: true });
    await fragment.press('Shift+ArrowRight'); await fragment.press('Shift+ArrowRight');
    await expect(fragment).toHaveAttribute('aria-valuenow','2');
    await expect(artist.getByRole('slider',{name:'Move clip end',exact:true})).toHaveAttribute('aria-valuenow','17');
    await artist.getByLabel('Upload file', { exact: true }).setInputFiles({ name: 'vocal.wav', mimeType: 'audio/wav', buffer: wave(3, .4) });
    await expect(artist.getByText(/Your contribution is ready/)).toBeVisible();
    for (const label of ['Base volume','Your contribution volume']) { const slider = artist.getByLabel(label, { exact: true }); await slider.focus(); await slider.press('Home'); for (let i=0;i<9;i++) await slider.press('ArrowRight'); }
    await artist.getByRole('button', { name: 'Build preview', exact: true }).click();
    await previewReady(artist);
    await artist.getByLabel('Remix title', { exact: true }).fill('My real remix');
    const initialViewport = artist.viewportSize()!;
    const previewSource = await artist.getByRole('region',{name:'Remix preview',exact:true}).locator('audio').getAttribute('src');
    for (const width of [390,768,1024,1440]) {
      await artist.setViewportSize({width,height:900});
      await expect(artist.getByRole('navigation',{name:'Primary navigation',exact:true})).toHaveCount(1);
      await expect(artist.getByRole('region',{name:'Remix preview',exact:true}).locator('audio')).toHaveAttribute('src',previewSource!);
      await expect(artist.getByLabel('Remix title',{exact:true})).toHaveValue('My real remix');
      await expect(fragment).toHaveAttribute('aria-valuenow','2');
      await expect(artist.getByRole('button',{name:'Save remix draft',exact:true})).toBeEnabled();
    }
    await artist.setViewportSize(initialViewport);

    await artist.getByRole('heading', { name: '3. Preview your mix', exact: true }).scrollIntoViewIfNeeded();
    await artist.screenshot({ path: info.outputPath('remix-studio.png') });
    expect(await artist.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    const savedResponse = artist.waitForResponse(response => response.url().includes('/api/remix-drafts/') && response.request().method() === 'PATCH');
    await artist.getByRole('button', { name: 'Save remix draft', exact: true }).click();
    expect((await (await savedResponse).json()).settings).toMatchObject({startSeconds:2,endSeconds:17,voiceOffset:0});
    await expect(artist.getByText('Remix draft saved', { exact: true })).toBeVisible();
    await artist.reload(); await previewReady(artist);
    const samples = await artist.getByRole('region',{name:'Remix preview',exact:true}).locator('audio').evaluate(async (element: HTMLAudioElement) => {
      const context = new AudioContext(); try { const buffer = await context.decodeAudioData(await (await fetch(element.src)).arrayBuffer()); const data = buffer.getChannelData(0); return { duration: buffer.duration, base: data[Math.round(4.5*buffer.sampleRate)], mixed: data[Math.round(.5*buffer.sampleRate)] }; } finally { await context.close(); }
    });
    expect(samples.duration).toBeCloseTo(15,2); expect(samples.base).toBeCloseTo(.1,2); expect(samples.mixed).toBeCloseTo(.3,2);
    await artist.reload();
    await expect(artist.getByLabel('Remix title',{exact:true})).toHaveValue('My real remix');
    await expect(fragment).toHaveAttribute('aria-valuenow','2');
    await expect(artist.getByText(/Your contribution is ready/)).toBeVisible();
    await artist.getByRole('button',{name:'Build preview',exact:true}).click(); await previewReady(artist);
    await artist.getByRole('button',{name:'Save remix draft',exact:true}).click();
    await expect(artist.getByText('Remix draft saved',{exact:true})).toBeVisible();
    await expect(artist.getByRole('button',{name:'Publish remix',exact:true})).toHaveCount(0);
    await artist.getByRole('link',{name:'Propose to original project',exact:true}).click();
    await artist.getByRole('button',{name:'Submit proposal',exact:true}).click();
    await expect(artist).toHaveURL(/\/collaborations\/\d+\?draft=[a-f0-9-]+$/);
    const workspace = new URL(artist.url()).pathname;
    await artist.getByRole('button', { name: 'Use saved remix', exact: true }).click();
    await artist.getByLabel('Your proposal', { exact: true }).fill('My new interpretation for this project.');
    await artist.getByRole('checkbox', { name: 'I reviewed the current deliverable, compensation and terms.', exact: true }).check();
    await expect(artist.getByRole('button', { name: 'Send proposal', exact: true })).toBeEnabled(); await artist.getByRole('button', { name: 'Send proposal', exact: true }).click();
    await expect(artist.getByRole('form', { name: 'Proposal form', exact: true })).toHaveCount(0);
    await page.goto(workspace);
    await expect(page.getByText('My real remix · Remix of Open original by Original Artist', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Accept proposal', exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});

test('microphone permission is requested on demand, recording stops, and changed settings require a new preview', async ({ page }, info) => {
  test.setTimeout(60_000);
  const original = await source(page, `record-${info.project.name}-${Date.now()}`, 2);
  await openLegacy(page,`/remix/${original.id}`);
  await expect(page.getByText(/Original duration: 2.00 seconds/)).toBeVisible();
  await page.evaluate(() => {
    const devices = navigator.mediaDevices, actual = devices.getUserMedia.bind(devices);
    const state = window as typeof window & { calls: number; tracks: MediaStreamTrack[] };
    state.calls = 0; state.tracks = [];
    devices.getUserMedia = async constraints => { state.calls++; if (state.calls === 1) throw new DOMException('Microphone permission denied for this test.', 'NotAllowedError'); const stream = await actual(constraints); state.tracks = stream.getTracks(); return stream; };
  });
  expect(await page.evaluate(() => (window as any).calls)).toBe(0);
  await page.getByRole('button', { name: 'Record audio', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Microphone permission denied');
  await page.getByRole('button', { name: 'Record audio', exact: true }).click();
  await expect(page.getByText('Recording your microphone…', { exact: true })).toBeVisible();
  await expect(page.locator('[data-notification-bell]:visible')).toBeDisabled();
  await expect(page.getByText(/Your contribution is ready/)).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-notification-bell]:visible')).toBeEnabled();
  expect(await page.evaluate(() => (window as any).tracks.every((track: MediaStreamTrack) => track.readyState === 'ended'))).toBe(true);
  await page.getByRole('button', { name: 'Build preview', exact: true }).click(); await previewReady(page);
  await page.getByLabel('Base volume', { exact: true }).press('ArrowLeft');
  await noPreview(page); await expect(page.getByRole('region', { name: 'Remix preview', exact: true }).locator('audio')).toHaveCount(0);
  await page.getByRole('button', { name: 'Build preview', exact: true }).click(); await previewReady(page);
  await page.getByRole('button', { name: 'Save remix draft', exact: true }).click(); await expect(page.getByText('Remix draft saved', { exact: true })).toBeVisible();
  await page.reload(); await expect(page.getByText(/Your contribution is ready/)).toBeVisible();
  await page.getByRole('button',{name:'Build preview',exact:true}).click(); await previewReady(page);
});

async function cameraClip(page: Page) {
  return Buffer.from(await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 240; canvas.height = 320;
    const painter = canvas.getContext('2d')!, context = new AudioContext(); await context.resume();
    const destination = context.createMediaStreamDestination(), oscillator = context.createOscillator(), gain = context.createGain();
    oscillator.frequency.value = 440; gain.gain.value = .2; oscillator.connect(gain).connect(destination); oscillator.start();
    const stream = canvas.captureStream(24); destination.stream.getAudioTracks().forEach(track => stream.addTrack(track));
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8,opus' }), chunks: Blob[] = [];
    recorder.ondataavailable = e => chunks.push(e.data);
    const done = new Promise<number[]>(resolve => { recorder.onstop = async () => resolve(Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()))); });
    const draw = () => { painter.fillStyle = '#ed2010'; painter.fillRect(0,0,240,320); }; draw();
    const timer = setInterval(draw, 40); recorder.start(); await new Promise(resolve => setTimeout(resolve, 3200)); recorder.stop();
    const bytes = await done; clearInterval(timer); stream.getTracks().forEach(track => track.stop()); await context.close(); return bytes;
  }));
}

test('video original composes real frames and sound, preserves draft credit and submits the video with extra files', async ({ page, browser }, info) => {
  test.setTimeout(120_000);
  const { readFile } = await import('node:fs/promises');
  const original = await source(page, `video-${info.project.name}-${Date.now()}`);
  const upload = await page.request.post('/api/uploads',{headers:{...headers,'X-Media-Kind':'video'},data:await readFile('artifacts/nebula/public/discovery-demo/after-hours.webm')}); expect(upload.ok()).toBe(true);
  const media = await upload.json();
  const changed = await page.request.patch(`/api/publications/${original.id}`,{headers,data:{...original,mediaId:media.id}}); expect(changed.ok()).toBe(true);
  const context = await browser.newContext({baseURL:'http://127.0.0.1:4175',viewport:page.viewportSize()!,isMobile:info.project.name==='mobile',hasTouch:info.project.name==='mobile'});
  try {
    const artist = await context.newPage(), errors: string[] = []; artist.on('pageerror',error=>errors.push(error.message));
    await rpc(artist,'register',{name:'Video Artist',role:'artist',email:`video-artist-${info.project.name}-${Date.now()}@example.invalid`,password:'preview123'});
    await artist.goto(`/discovery?post=post-${original.id}`);
    const contribution = await cameraClip(artist);
    await artist.locator('article[data-active=true]').getByRole('button',{name:'Remix',exact:true}).click();
    await expect(artist).toHaveURL(/\/studio\/remix$/); await expect(artist.getByRole('dialog')).toHaveCount(0);
    await expect(artist.getByText(/Original duration:/)).toBeVisible({timeout:20000});
    await artist.getByLabel('Upload video',{exact:true}).setInputFiles({name:'red-performance.webm',mimeType:'video/webm',buffer:contribution});
    await expect(artist.getByText(/Your contribution is ready/)).toBeVisible({timeout:20000});
    await artist.getByRole('button',{name:'Build preview',exact:true}).click();
    await previewReady(artist,{timeout:20000});
    const video = artist.getByRole('region',{name:'Remix preview',exact:true}).locator('video');
    const pixels = await video.evaluate(async (element: HTMLVideoElement) => {
      element.muted = true; await element.play(); await new Promise(resolve => setTimeout(resolve,700)); element.pause();
      const canvas = document.createElement('canvas'); canvas.width=element.videoWidth; canvas.height=element.videoHeight; const painter=canvas.getContext('2d')!; painter.drawImage(element,0,0);
      return { width:canvas.width,height:canvas.height,top:Array.from(painter.getImageData(360,320,1,1).data),bottom:Array.from(painter.getImageData(360,960,1,1).data) };
    });
    expect(pixels.width).toBe(720);expect(pixels.height).toBe(1280);expect(pixels.bottom[0]).toBeGreaterThan(190);expect(pixels.bottom[1]).toBeLessThan(70);expect(pixels.top[1]).toBeGreaterThan(pixels.top[0]);
    await artist.getByRole('heading',{name:'3. Preview your mix',exact:true}).scrollIntoViewIfNeeded(); await artist.screenshot({path:info.outputPath('video-studio.png')});
    expect(await artist.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    await artist.getByLabel('Remix title',{exact:true}).fill('My video remix');
    await artist.getByRole('button',{name:'Save remix draft',exact:true}).click(); await expect(artist.getByText('Remix draft saved',{exact:true})).toBeVisible();
    await artist.reload(); await previewReady(artist);
    const sound = await artist.getByRole('region',{name:'Remix preview',exact:true}).locator('video').evaluate(async (element: HTMLVideoElement) => {
      const context = new AudioContext(); try { const buffer=await context.decodeAudioData(await(await fetch(element.src)).arrayBuffer()), data=buffer.getChannelData(0);
        const strength=(frequency:number)=>{let real=0,imaginary=0;const from=Math.round(.4*buffer.sampleRate),count=Math.min(Math.round(buffer.sampleRate),data.length-from);for(let i=0;i<count;i++){const phase=2*Math.PI*frequency*i/buffer.sampleRate;real+=data[from+i]*Math.cos(phase);imaginary+=data[from+i]*Math.sin(phase);}return Math.hypot(real,imaginary)/count;};
        return {duration:buffer.duration,own:strength(440),base:strength(130.81)};
      } finally {await context.close();}
    });
    expect(sound.duration).toBeGreaterThan(7.8);expect(sound.duration).toBeLessThan(8.5);expect(sound.own).toBeGreaterThan(.02);expect(sound.base).toBeGreaterThan(.002);
    await artist.reload(); await expect(artist.getByLabel('Remix title',{exact:true})).toHaveValue('My video remix');
    await previewReady(artist);
    await artist.getByRole('button',{name:'Save remix draft',exact:true}).click();await expect(artist.getByText('Remix draft saved',{exact:true})).toBeVisible();
    await artist.getByRole('link',{name:'Propose to original project',exact:true}).click();await artist.getByRole('button',{name:'Submit proposal',exact:true}).click();
    await expect(artist).toHaveURL(/\/collaborations\/\d+\?draft=[a-f0-9-]+$/);
    const workspace=new URL(artist.url()).pathname;
    await artist.getByLabel('Work files (audio, video, PDF or ZIP)',{exact:true}).setInputFiles({name:'Credits.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.7\nTest credits document\n%%EOF')});
    await expect(artist.getByRole('link',{name:'Download Credits.pdf',exact:true})).toBeVisible();
    await artist.getByRole('button',{name:'Use saved remix',exact:true}).click();
    await expect(artist.getByRole('link',{name:'Download Credits.pdf',exact:true})).toBeVisible();
    await artist.getByLabel('Your proposal',{exact:true}).fill('Video performance and credits');await artist.getByRole('checkbox',{name:'I reviewed the current deliverable, compensation and terms.',exact:true}).check();
    await artist.getByRole('button',{name:'Send proposal',exact:true}).click();await expect(artist.getByRole('form',{name:'Proposal form',exact:true})).toHaveCount(0);
    await page.goto(workspace);await expect(page.getByText('My video remix · Remix of Open original by Original Artist',{exact:true})).toBeVisible();await expect(page.getByRole('link',{name:'Download Credits.pdf',exact:true})).toBeVisible();
    expect(errors).toEqual([]);
  } finally {await context.close();}
});

test('audio original supports camera remix, permission retry, cancellation and rebuild', async ({page}, info)=>{
  test.setTimeout(90000);
  const original=await source(page,`camera-${info.project.name}-${Date.now()}`, 2);
  await openLegacy(page,`/remix/${original.id}?mode=video`);
  await expect(page.getByRole('heading',{name:'Remix studio',exact:true})).toBeVisible();await expect(page.getByText(/Original duration:/)).toBeVisible();
  await page.evaluate(()=>{const devices=navigator.mediaDevices,actual=devices.getUserMedia.bind(devices),state=window as any;state.cameraCalls=0;state.cameraTracks=[];devices.getUserMedia=async constraints=>{state.cameraCalls++;if(state.cameraCalls===1)throw new DOMException('Camera permission denied for test.','NotAllowedError');const stream=await actual(constraints);state.cameraTracks=stream.getTracks();return stream;};});
  expect(await page.evaluate(()=>(window as any).cameraCalls)).toBe(0);
  await page.getByRole('button',{name:'Record video',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Camera permission denied');
  await page.getByRole('button',{name:'Record video',exact:true}).click();await expect(page.getByText('Recording your camera…',{exact:true})).toBeVisible();await expect(page.getByText(/Your contribution is ready/)).toBeVisible({timeout:15000});
  expect(await page.evaluate(()=>(window as any).cameraTracks.every((track:MediaStreamTrack)=>track.readyState==='ended'))).toBe(true);
  await page.getByRole('button',{name:'Build preview',exact:true}).click();await page.getByRole('button',{name:'Cancel operation',exact:true}).click();await expect(page.getByRole('alert')).toContainText('cancelled');
  await noPreview(page);
  await page.getByRole('button',{name:'Build preview',exact:true}).click();await previewReady(page,{timeout:15000});
  await page.getByLabel('Base volume',{exact:true}).press('ArrowLeft');await noPreview(page);
  await page.getByRole('button',{name:'Build preview',exact:true}).click();await previewReady(page,{timeout:15000});
  await page.getByRole('button',{name:'Save remix draft',exact:true}).click();await expect(page.getByText('Remix draft saved',{exact:true})).toBeVisible();await expect(page.getByRole('region',{name:'Remix preview',exact:true}).locator('video')).toHaveCount(1);
});

test('a video original rejects audio contributions and revoked permission blocks saving a valid video', async ({page},info)=>{
  test.setTimeout(60000);
  const {readFile}=await import('node:fs/promises');
  let original=await source(page,`overlay-${info.project.name}-${Date.now()}`);
  const uploaded=await page.request.post('/api/uploads',{headers:{...headers,'X-Media-Kind':'video'},data:await readFile('artifacts/nebula/public/discovery-demo/after-hours.webm')});
  const media=await uploaded.json();const changed=await page.request.patch(`/api/publications/${original.id}`,{headers,data:{...original,mediaId:media.id}});original=await changed.json();
  await openLegacy(page,`/remix/${original.id}`);await expect(page.getByText(/Original duration:/)).toBeVisible({timeout:20000});
  await page.getByLabel('Upload video',{exact:true}).setInputFiles({name:'voice.wav',mimeType:'audio/wav',buffer:wave(2,.15)});
  await expect(page.getByRole('alert')).toContainText('A video original requires your own video');
  await expect(page.getByRole('button',{name:'Record audio',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Build preview',exact:true})).toBeDisabled();
  await page.getByLabel('Upload video',{exact:true}).setInputFiles({name:'own.webm',mimeType:'video/webm',buffer:await readFile('artifacts/nebula/public/discovery-demo/after-hours.webm')});
  await expect(page.getByText(/Your contribution is ready/)).toBeVisible();await page.getByRole('button',{name:'Build preview',exact:true}).click();
  await previewReady(page,{timeout:15000});
  const video=page.getByRole('region',{name:'Remix preview',exact:true}).locator('video');expect(await video.evaluate((element:HTMLVideoElement)=>element.videoWidth)).toBe(720);
  const revoked=await page.request.patch(`/api/publications/${original.id}`,{headers,data:{...original,allowRemix:false}});expect(revoked.ok()).toBe(true);
  await page.getByRole('button',{name:'Save remix draft',exact:true}).click();await expect(page.getByRole('alert')).toContainText('no longer available for remixing');
  await expect(page.getByText('Remix draft saved',{exact:true})).toHaveCount(0);
  const posts=await(await page.request.get('/api/publications?mine=1')).json();expect(posts.items).toHaveLength(1);
});
