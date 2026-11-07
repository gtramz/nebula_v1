import { test, expect, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
const headers = { Origin:'http://127.0.0.1:4175','X-Nebula-Request':'1' };
async function rpc(page: Page,method:string,...args:unknown[]) {const response=await page.request.post('/api/rpc',{headers,data:{method,args}}); expect(response.ok()).toBe(true); return (await response.json()).result;}
async function upload(page: Page) {const result=await page.request.post('/api/uploads',{headers:{...headers,'X-Media-Kind':'audio','Content-Type':'application/octet-stream'},data:await readFile('artifacts/nebula/public/discovery-demo/soft-signal.wav')});expect(result.ok()).toBe(true);return result.json();}
async function work(page: Page, delivery=false) {
  await page.getByLabel(delivery?'Delivery notes':'Your proposal',{exact:true}).fill(delivery?'Final dry vocals.':'Here is my verse for your project.');
  await page.getByLabel('Work files (audio, video, PDF or ZIP)',{exact:true}).setInputFiles(resolve('artifacts/nebula/public/discovery-demo/soft-signal.wav'));
  if (delivery) {
    const files = page.getByLabel('Work files (audio, video, PDF or ZIP)',{exact:true});
    await expect(page.getByRole('form',{name:'Delivery form'}).locator('audio')).toHaveCount(1);
    await files.setInputFiles([
      {name:'Final credits.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.7\nDelivery credits document\n%%EOF')},
      {name:'Final stems.zip',mimeType:'application/zip',buffer:Buffer.concat([Buffer.from([80,75,5,6]),Buffer.alloc(18)])}
    ]);
    await expect(page.getByRole('link',{name:'Download Final stems.zip',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Remove Final stems.zip',exact:true}).click();
    await expect(page.getByRole('link',{name:'Download Final stems.zip',exact:true})).toHaveCount(0);
    await files.setInputFiles({name:'Final stems.zip',mimeType:'application/zip',buffer:Buffer.concat([Buffer.from([80,75,5,6]),Buffer.alloc(18)])});
    await expect(page.getByRole('link',{name:'Download Final stems.zip',exact:true})).toBeVisible();
  }

  if (!delivery) await page.getByRole('checkbox',{name:'I reviewed the current deliverable, compensation and terms.'}).check();
  const submit=page.getByRole('button',{name:delivery?'Send delivery':'Send proposal',exact:true});await expect(submit).toBeEnabled();await submit.click();
  await expect(page.getByRole('form',{name:delivery?'Delivery form':'Proposal form'})).toHaveCount(0);
}

test('artists create offers in Discovery, discuss, submit, revise, accept, deliver and finish privately',async ({page,browser},info)=>{
  test.setTimeout(150_000);
  const live = expect.configure({ timeout: 15_000 });
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  const tag=`${info.project.name}-${Date.now()}`;
  await rpc(page,'register',{name:'Project Owner',role:'artist',email:`owner-${tag}@example.invalid`,password:'preview123'});
  const project=await rpc(page,'createProject',{title:'Midnight sessions',category:'EP',goalAmount:3000,status:'published'});
  const media=await upload(page);
  const result=await page.request.post('/api/publications',{headers,data:{title:'Midnight invitation',description:'Looking for another voice.',mediaId:media.id,coverId:null,projectId:project.id,allowRemix:true,status:'published'}});
  const post=await result.json();
  await page.goto(`/project/${project.id}`);
  await page.getByRole('button',{name:'New offer',exact:true}).click();
  await page.getByRole('combobox',{name:'Looking for',exact:true}).selectOption('Verse');
  await page.getByLabel('Expected deliverable',{exact:true}).fill('One original 16-bar verse with dry vocals.');
  await page.getByLabel('Requirements and terms',{exact:true}).fill('English or Spanish. One revision. Artist credit included.');
  await page.getByLabel('Royalty percentage',{exact:true}).fill('15');await page.getByRole('button',{name:'Save offer',exact:true}).click();
  await expect(page.getByRole('article',{name:'Verse offer'})).toContainText('15% royalty split offered');
  await page.getByRole('button',{name:'New offer',exact:true}).click();await page.getByRole('combobox',{name:'Looking for',exact:true}).selectOption('Master');
  await page.getByLabel('Expected deliverable',{exact:true}).fill('Digital WAV master with one revision.');await page.getByRole('combobox',{name:'Compensation',exact:true}).selectOption('fee');
  await page.getByLabel('Fee in USD',{exact:true}).fill('250.25');await page.getByRole('button',{name:'Save offer',exact:true}).click();
  await expect(page.getByRole('article',{name:'Master offer'})).toContainText('USD 250.25');
  await page.getByRole('region',{name:'Collaboration offers'}).scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('project-offers.png')});
  const applicantContext=await browser.newContext({baseURL:'http://127.0.0.1:4175',viewport:page.viewportSize()!,isMobile:info.project.name==='mobile',hasTouch:info.project.name==='mobile'});
  try {
    const artist=await applicantContext.newPage();artist.on('pageerror',error=>errors.push(error.message));
    await artist.goto(`/discovery?post=post-${post.id}`);
    await expect(artist.locator('article[data-active=true]').getByText('seeking collaborators',{exact:true})).toBeVisible();
    await artist.locator('article[data-active=true]').getByRole('button',{name:/view project/}).click();
    await expect(artist.getByRole('dialog').getByRole('article',{name:'Verse offer'})).toContainText('15%');
    await expect(artist.getByRole('dialog').getByRole('link',{name:'Log in to collaborate'})).toHaveCount(2);
    await artist.screenshot({path:info.outputPath('discovery-offers.png')});
    await rpc(artist,'register',{name:'Guest Vocalist',role:'artist',email:`vocalist-${tag}@example.invalid`,password:'preview123'});
    await artist.goto(`/project/${project.id}`);await artist.getByRole('article',{name:'Verse offer'}).getByRole('button',{name:'Contact artist'}).click();
    await expect(artist).toHaveURL(/\/collaborations\/\d+$/);const workspace=new URL(artist.url()).pathname;
    await artist.getByLabel('Message',{exact:true}).fill('May I send Spanish vocals?');await artist.getByRole('button',{name:'Send message'}).click();
    await expect(artist.getByRole('region',{name:'Private conversation'})).toContainText('May I send Spanish vocals?');
    await page.goto('/profile');await page.getByRole('link',{name:/Collaborations Review proposals/}).click();await page.getByRole('link',{name:/Midnight sessions · Verse/}).click();
    await expect(page.getByRole('region',{name:'Private conversation'})).toContainText('May I send Spanish vocals?');
    await page.getByLabel('Message',{exact:true}).fill('Yes, send your interpretation.');await page.getByRole('button',{name:'Send message'}).click();
    await work(artist);await page.bringToFront();await live(page.getByText('Here is my verse for your project.',{exact:true})).toBeVisible();
    await expect.poll(() => page.locator('audio').first().evaluate((audio: HTMLAudioElement) => audio.readyState)).toBeGreaterThanOrEqual(2);
    await page.getByLabel('Revision feedback',{exact:true}).fill('Please add a harmony.');await page.getByRole('button',{name:'Request changes'}).click();
    await artist.bringToFront();await live(artist.getByText('Please add a harmony.',{exact:true})).toBeVisible();await work(artist);
    await page.bringToFront();await live(page.getByRole('button',{name:'Accept proposal',exact:true})).toBeEnabled();await page.getByRole('button',{name:'Accept proposal',exact:true}).click();await expect(page.getByText('Waiting for the artist’s delivery.',{exact:true})).toBeVisible();
    await artist.bringToFront();await live(artist.getByRole('form',{name:'Delivery form'})).toBeVisible();await work(artist,true);await page.bringToFront();await live(page.getByRole('button',{name:'Mark completed',exact:true})).toBeVisible();
    await expect(page.getByRole('link',{name:'Download Final credits.pdf',exact:true})).toBeVisible();
    await expect(page.getByRole('link',{name:'Download Final stems.zip',exact:true})).toBeVisible();
    const downloadPromise=page.waitForEvent('download');await page.getByRole('link',{name:'Download Final credits.pdf',exact:true}).click();expect((await downloadPromise).suggestedFilename()).toBe('Final credits.pdf');
    await page.reload();await expect(page.getByRole('link',{name:'Download Final stems.zip',exact:true})).toBeVisible();
    await page.getByRole('heading',{name:'Review work',exact:true}).scrollIntoViewIfNeeded();
    await page.screenshot({path:info.outputPath('delivery-workspace.png')});
    await page.getByRole('button',{name:'Mark completed',exact:true}).click();await expect(page.getByText('This collaboration is completed.',{exact:true})).toBeVisible();
    await artist.bringToFront();await artist.getByLabel('Message',{exact:true}).fill('Thank you for the collaboration!');await artist.getByRole('button',{name:'Send message'}).click();
    await page.bringToFront();await live(page.getByRole('region',{name:'Private conversation'})).toContainText('Thank you for the collaboration!');
    await artist.goto('/collaborations');await artist.getByRole('button',{name:'Sent',exact:true}).click();await expect(artist.getByRole('link',{name:/Midnight sessions · Verse/})).toContainText('completed');
    await rpc(artist,'logout');await artist.goto(workspace);await expect(artist.getByText('Log in as an artist to view your collaborations.',{exact:true})).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
    expect(errors).toEqual([]);
  } finally {await applicantContext.close();}
});

test('both sides can use direct applications, withdrawal, decline and closure without losing their conversation', async ({ page, browser }, info) => {
  test.setTimeout(90_000);
  const live = expect.configure({ timeout: 15_000 }), tag = `${info.project.name}-${Date.now()}`;
  await rpc(page, 'register', { name: 'Review Owner', role: 'artist', email: `review-${tag}@example.invalid`, password: 'preview123' });
  const project = await rpc(page, 'createProject', { title: 'Review paths', category: 'EP', goalAmount: 1000, status: 'published' });
  for (const need of ['Mix', 'Master']) {
    const response = await page.request.post(`/api/projects/${project.id}/offers`, { headers, data: { need, deliverable: `One ${need.toLowerCase()} with a revision.`, requirements: 'WAV delivery.', deadline: null, compensation: { kind: 'fee', amount: 200, currency: 'USD' }, status: 'open' } });
    expect(response.ok()).toBe(true);
  }
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:4175', viewport: page.viewportSize()!, isMobile: info.project.name === 'mobile', hasTouch: info.project.name === 'mobile' });
  try {
    const artist = await context.newPage();
    await rpc(artist, 'register', { name: 'Review Applicant', role: 'artist', email: `review-applicant-${tag}@example.invalid`, password: 'preview123' });
    await artist.goto(`/project/${project.id}`);
    await artist.getByRole('article', { name: 'Mix offer' }).getByRole('button', { name: 'Submit proposal', exact: true }).click();
    await expect(artist.getByRole('form', { name: 'Proposal form' })).toBeVisible();
    const first = new URL(artist.url()).pathname;
    artist.once('dialog', dialog => dialog.accept()); await artist.getByRole('button', { name: 'Withdraw proposal', exact: true }).click();
    await expect(artist.locator('header').getByText('withdrawn', { exact: true })).toBeVisible();
    await expect(artist.getByRole('form', { name: 'Proposal form' })).toHaveCount(0);
    await page.goto(first); await expect(page.getByText('This collaboration is withdrawn.', { exact: true })).toBeVisible();
    await artist.goto(`/project/${project.id}`);
    await artist.getByRole('article', { name: 'Master offer' }).getByRole('button', { name: 'Submit proposal', exact: true }).click();
    await expect(artist).toHaveURL(/\/collaborations\/\d+$/);
    const second = new URL(artist.url()).pathname;
    await work(artist);
    await page.goto(second); page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: 'Decline proposal', exact: true }).click();
    await artist.bringToFront(); await live(artist.locator('header').getByText('rejected', { exact: true })).toBeVisible();
    await expect(artist.getByRole('button', { name: 'Accept proposal', exact: true })).toHaveCount(0);
    await expect(artist.getByRole('button', { name: 'Send delivery', exact: true })).toHaveCount(0);
    await artist.getByLabel('Message', { exact: true }).fill('Thanks for reviewing my proposal.');
    await artist.getByRole('button', { name: 'Send message', exact: true }).click();
    await page.bringToFront(); await live(page.getByRole('region', { name: 'Private conversation' })).toContainText('Thanks for reviewing my proposal.');
    await page.goto(`/project/${project.id}`);
    await page.getByRole('article', { name: 'Mix offer' }).getByRole('button', { name: 'Close offer', exact: true }).click();
    await expect(page.getByRole('article', { name: 'Mix offer' }).getByText('closed', { exact: true })).toBeVisible();
    await artist.goto(`/project/${project.id}`); await expect(artist.getByRole('article', { name: 'Mix offer' })).toHaveCount(0);
    await artist.goto(first); await expect(artist.getByRole('region', { name: 'Private conversation' })).toBeVisible();
    await artist.goto('/collaborations'); await artist.getByRole('button', { name: 'Sent', exact: true }).click();
    await expect(artist.getByRole('link', { name: /Review paths · Mix/ })).toContainText('withdrawn');
    await expect(artist.getByRole('link', { name: /Review paths · Master/ })).toContainText('rejected');
    await page.goto('/collaborations');
    await expect(page.getByRole('link', { name: /Review paths · Mix/ })).toContainText('withdrawn');
    await expect(page.getByRole('link', { name: /Review paths · Master/ })).toContainText('rejected');
  } finally { await context.close(); }
});
