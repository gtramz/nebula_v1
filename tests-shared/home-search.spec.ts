import { test, expect, type Page } from '@playwright/test';
const headers = { Origin: 'http://127.0.0.1:4175', 'X-Nebula-Request': '1' };
async function rpc(page: Page, method: string, ...args: unknown[]) { const r = await page.request.post('/api/rpc', { headers, data: { method, args } }); expect(r.ok()).toBeTruthy(); return (await r.json()).result; }
async function register(page: Page, name: string) { return rpc(page,'register',{name,email:`${crypto.randomUUID()}@example.invalid`,password:'preview123',role:'artist'}); }
async function fixture(page: Page) {
  const suffix=crypto.randomUUID().slice(0,8), name=`Search artist ${suffix}`;
  await register(page,name);
  await rpc(page,'updateArtist',{name,genre:'Hip-hop',basedIn:'',bio:'',recordLabel:'',picture:null});
  const create=(title:string,category:string,status='published')=>rpc(page,'createProject',{title:`${title} ${suffix}`,category,status,goalAmount:3000,pitch:'Trap sessions',story:'Analog textures'});
  const project=await create('Blue room','EP'), funding=await create('Neon funding','Album','funding');
  for (const [need,compensation] of [['Production',{kind:'fee',amount:180,currency:'USD'}],['Mix',{kind:'split',percent:15}]] as const) {
    const r=await page.request.post(`/api/projects/${project.id}/offers`,{headers,data:{need,compensation,status:'open',deadline:null,requirements:'Stems',deliverable:'Creative work'}});expect(r.ok()).toBe(true);
  }
  return {project,funding,name,suffix};
}
const input=(page:Page)=>page.getByRole('combobox',{name:'Search Home opportunities'});
const card=(page:Page,title:string)=>page.getByRole('article',{name:title,exact:true});

test('Home live search combines filters, real suggestions, same-offer criteria and preserves return context',async({page},info)=>{
  const {project,funding,name}=await fixture(page); await page.goto('/explore');
  await page.getByRole('button',{name:/^Filters/}).click();await page.getByRole('checkbox',{name:'EP',exact:true}).check();await page.getByRole('button',{name:/^Apply filters/}).click();
  await input(page).fill(project.title); await expect(card(page,project.title)).toBeVisible();await expect(card(page,funding.title)).toHaveCount(0);
  await expect(page.getByRole('option').filter({hasText:project.title})).toContainText('View project');
  await input(page).press('ArrowDown');await input(page).press('ArrowUp');await expect(input(page)).toHaveAttribute('aria-activedescendant','home-option-0');await input(page).press('Enter'); await expect(page).toHaveURL(new RegExp(`/project/${project.id}$`));
  await page.getByRole('link',{name:'Back to Home',exact:true}).click(); await expect(input(page)).toHaveValue(project.title);
  await expect(card(page,project.title).getByRole('link',{name:'View project',exact:true})).toBeFocused();
  await expect(page.getByRole('button',{name:'Remove Project type: EP',exact:true})).toBeVisible();
  await input(page).fill(name);await expect(card(page,project.title)).toBeVisible();
  await page.getByRole('option').filter({hasText:name}).click();await expect(page).toHaveURL(new RegExp(`/artist/${project.artistId}$`));
  await page.goBack();await expect(input(page)).toHaveValue(name);
  await expect(card(page,project.title).getByRole('link',{name,exact:true})).toBeFocused();
  await input(page).fill('prod');await page.getByRole('option').filter({hasText:'Production'}).click();
  await expect(page.getByRole('button',{name:'Remove Participation: Production'})).toBeVisible();await expect(card(page,project.title)).toBeVisible();
  // Other offers' royalties must not qualify this Production fee offer.
  await input(page).fill('roy');await expect(page.getByRole('status').filter({hasText:'No matching suggestions'})).toBeVisible();
  await input(page).fill('USD');await page.getByRole('option').filter({hasText:'USD payment'}).click();await expect(card(page,project.title)).toBeVisible();
  await input(page).fill('Hip');await page.getByRole('option').filter({hasText:'Artist genre'}).click();
  await expect(page.getByRole('button',{name:'Remove Artist genre: Hip-hop'})).toBeVisible();
  await input(page).fill('trap');await input(page).press('Enter');await expect(card(page,project.title)).toBeVisible();
  await page.getByRole('button',{name:'Clear Home search',exact:true}).click();await input(page).press('Escape');
  await expect(page.getByRole('button',{name:'Remove Project type: EP',exact:true})).toBeVisible();
  await input(page).fill(project.title);await input(page).press('Enter');await page.getByRole('button',{name:/^Filters/}).click();await page.getByRole('checkbox',{name:'EP',exact:true}).uncheck();await page.getByRole('checkbox',{name:'Album',exact:true}).check();await page.getByRole('button',{name:/^Apply filters/}).click();
  await expect(page.getByRole('heading',{name:'No matching projects.'})).toBeVisible();
  await page.getByRole('button',{name:'Clear all filters',exact:true}).click();await expect(input(page)).toHaveValue(project.title);await expect(card(page,project.title)).toBeVisible();
  await input(page).fill('prod');await expect(page.getByRole('option').filter({hasText:'Production'})).toBeVisible();
  await page.evaluate(()=>{document.querySelector('[data-page-scroll]')?.scrollTo(0,0);document.querySelector('.shell-page')?.scrollTo(0,0);window.scrollTo(0,0)});
  await page.screenshot({path:info.outputPath('home-search.png')});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect((await input(page).boundingBox())!.height).toBeGreaterThanOrEqual(44);
});

test('Home recent searches persist only on confirmation, delete individually and isolate visitor and accounts',async({page})=>{
  await page.goto('/explore');await input(page).fill('never confirmed'); await expect(page.getByRole('heading',{name:/No matching projects|No open opportunities/})).toBeVisible();
  await page.getByRole('button',{name:'Clear Home search',exact:true}).click();await expect(page.getByText('No recent searches.',{exact:true})).toBeVisible();
  await input(page).fill('Guest search');await input(page).press('Enter');await page.reload();
  await input(page).click();await expect(page.getByRole('option',{name:'Guest search',exact:true})).toBeVisible();
  await page.getByRole('option',{name:'Guest search',exact:true}).click();await expect(input(page)).toHaveValue('Guest search');
  await input(page).fill('guest SEARCH');await input(page).press('Enter');
  await page.getByRole('button',{name:'Clear Home search',exact:true}).click();await expect(page.getByRole('option')).toHaveCount(1);
  await page.getByRole('button',{name:'Remove recent search: guest SEARCH',exact:true}).click();await expect(page.getByText('No recent searches.',{exact:true})).toBeVisible();
  await page.reload();await input(page).click();await expect(page.getByText('No recent searches.',{exact:true})).toBeVisible();
  await input(page).fill('Guest saved');await input(page).press('Enter');
  await register(page,'History owner');await page.goto('/explore');await input(page).click();await expect(page.getByText('No recent searches.',{exact:true})).toBeVisible();
  await input(page).fill('Artist saved');await input(page).press('Enter');
  await rpc(page,'logout');await page.goto('/explore');await input(page).click();await expect(page.getByRole('option',{name:'Guest saved',exact:true})).toBeVisible();await expect(page.getByRole('option',{name:'Artist saved',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Clear all',exact:true}).click();await page.reload();await input(page).click();await expect(page.getByText('No recent searches.',{exact:true})).toBeVisible();
});

test('Home search cancels stale work, respects composition and offers independent retries',async({page})=>{
  const requested:string[]=[];let failure=false;
  await page.route('**/api/opportunities/projects?*',async route=>{
    const q=new URL(route.request().url()).searchParams.get('q')??'';requested.push(q);
    if(q==='old query') await new Promise(resolve=>setTimeout(resolve,1000));
    await route.fulfill(failure?{status:503,json:{error:'Search unavailable'}}:{json:{items:[],nextCursor:null,eligibleCount:1}}).catch(()=>{});
  });
  await page.route('**/api/opportunities/suggestions?*',route=>route.fulfill({status:503,json:{error:'Suggestion unavailable'}}));
  await page.goto('/explore');await input(page).fill('old query');await expect.poll(()=>requested.includes('old query')).toBe(true);
  await input(page).fill('new query');await expect.poll(()=>requested.includes('new query')).toBe(true);
  await expect(page.getByRole('heading',{name:'No matching projects.'})).toBeVisible();await expect(input(page)).toHaveValue('new query');
  await expect(page.getByRole('button',{name:'Retry suggestions'})).toBeVisible();
  await input(page).press('Escape');await expect(page.getByRole('listbox')).toHaveCount(0);await expect(input(page)).toBeFocused();
  await input(page).dispatchEvent('compositionstart');await input(page).fill('composing query');await page.waitForTimeout(400);expect(requested).not.toContain('composing query');
  await input(page).dispatchEvent('compositionend');await expect.poll(()=>requested.includes('composing query')).toBe(true);
  failure=true;await input(page).fill('failure');await input(page).press('Enter');await expect(page.getByRole('alert')).toContainText('Search unavailable');
  failure=false;await page.getByRole('button',{name:'Try again',exact:true}).click();await expect(page.getByRole('heading',{name:'No matching projects.'})).toBeVisible();
});

test('Home history remains usable when browser storage is blocked',async({page})=>{
  await page.addInitScript(()=>{ const get=Storage.prototype.getItem,set=Storage.prototype.setItem;Storage.prototype.getItem=function(k){if(k.startsWith('nebula:home-search:'))throw new DOMException('blocked');return get.call(this,k)};Storage.prototype.setItem=function(k,v){if(k.startsWith('nebula:home-search:'))throw new DOMException('blocked');return set.call(this,k,v)}; });
  await page.goto('/explore');await input(page).fill('Memory search');await input(page).press('Enter');
  await page.getByRole('button',{name:'Clear Home search',exact:true}).click();await expect(page.getByRole('option',{name:'Memory search',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Clear all',exact:true}).click();await expect(page.getByText('No recent searches.',{exact:true})).toBeVisible();
});
