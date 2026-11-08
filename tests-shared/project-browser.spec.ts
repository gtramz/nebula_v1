import { test, expect, type Page } from '@playwright/test';
const headers={Origin:'http://127.0.0.1:4175','X-Nebula-Request':'1'};
async function rpc(page:Page,method:string,...args:unknown[]) {const r=await page.request.post('/api/rpc',{headers,data:{method,args}});expect(r.ok()).toBe(true);return(await r.json()).result;}
async function fixture(page:Page) {
 const tag=crypto.randomUUID().slice(0,8);
 async function artist(genre:string) {await rpc(page,'register',{name:`Browser ${genre} ${tag}`,role:'artist',email:`${crypto.randomUUID()}@example.invalid`,password:'preview123'});await rpc(page,'updateArtist',{name:`Browser ${genre} ${tag}`,genre,bio:'',basedIn:'',recordLabel:'',picture:null});}
 const create=(title:string,category:string,status='published')=>rpc(page,'createProject',{title:`${tag} ${title}`,category,status,goalAmount:2000});
 async function offer(id:number,need:string,kind:string){const r=await page.request.post(`/api/projects/${id}/offers`,{headers,data:{need,status:'open',deadline:null,requirements:'',deliverable:'A complete contribution',compensation:kind==='fee'?{kind,amount:200,currency:'USD'}:{kind,percent:10}}});expect(r.ok()).toBe(true);}
 await artist('Hip-hop');const ep=await create('Creative EP','EP'),fund=await create('Fund album','Album','funding');await offer(ep.id,'Production','fee');await offer(ep.id,'Mix','split');
 await artist('Rock');const single=await create('Creative single','Single');await offer(single.id,'Production','split');await rpc(page,'logout');return{tag,ep,fund,single};
}
const search=(page:Page)=>page.getByRole('combobox',{name:'Search Home opportunities'});
const filters=(page:Page)=>page.getByRole('button',{name:/^Filters/});
const dialog=(page:Page)=>page.getByRole('dialog',{name:'Filter projects',exact:true});
const card=(page:Page,p:{title:string})=>page.getByRole('article',{name:p.title,exact:true});
async function select(page:Page,options:string[]) {await filters(page).click();for(const option of options) await dialog(page).getByRole('checkbox',{name:option,exact:true}).check();await dialog(page).getByRole('button',{name:/^Apply filters/}).click();}

test('multidimensional filters combine with search, modes, autocomplete and saved history',async({page},info)=>{
 const {tag,ep,single,fund}=await fixture(page);await page.goto('/explore');await search(page).fill(tag);await search(page).press('Enter');
 await expect(card(page,ep)).toBeVisible();await expect(card(page,single)).toBeVisible();await expect(card(page,fund)).toBeVisible();
 await select(page,['EP','Single','Hip-hop','Rock','Production','Mix','Fixed payment (USD)','Royalty share']);
 await expect(filters(page)).toHaveAccessibleName('Filters (8 active)');await expect(card(page,ep)).toHaveCount(1);await expect(card(page,single)).toHaveCount(1);await expect(card(page,fund)).toHaveCount(0);
 await page.getByRole('button',{name:'Recently created',exact:true}).click();await expect(search(page)).toHaveValue(tag);await expect(filters(page)).toHaveAccessibleName('Filters (8 active)');await expect(page.getByText('Newest creation date first · publication dates are not recorded yet.')).toBeVisible();
 await expect(page.getByRole('button',{name:'Following',exact:true})).toBeDisabled();await expect(page.getByText('Sign in as an artist to browse Following.', { exact: false })).toBeVisible();
 await page.getByRole('button',{name:'Remove Compensation: Fixed payment (USD)',exact:true}).click();await page.getByRole('button',{name:'Remove Participation: Mix',exact:true}).click();
 await expect(card(page,ep)).toHaveCount(0);await expect(card(page,single)).toBeVisible();
 // Confirm the coherent query, then reload and restore it using the existing history UI.
 await search(page).press('Enter');await page.reload();await search(page).click();await page.getByRole('option').filter({hasText:tag}).first().click();
 await expect(filters(page)).toHaveAccessibleName('Filters (6 active)');await expect(card(page,single)).toBeVisible();await expect(card(page,ep)).toHaveCount(0);
 await page.getByRole('button',{name:'Clear Home search',exact:true}).click();await search(page).press('Escape');await expect(filters(page)).toHaveAccessibleName('Filters (6 active)');
 await search(page).fill(tag);await search(page).press('Enter');await page.getByRole('button',{name:'Clear all filters',exact:true}).click();await expect(search(page)).toHaveValue(tag);await expect(card(page,fund)).toBeVisible();
 await select(page,['Funding','Production']);await expect(card(page,fund)).toBeVisible();await expect(card(page,single)).toBeVisible();await expect(card(page,ep)).toBeVisible();
 await select(page,['Royalty share']);await expect(card(page,fund)).toHaveCount(0);await expect(card(page,ep)).toHaveCount(0);await expect(card(page,single)).toBeVisible();
 await page.getByRole('button',{name:'Clear all filters',exact:true}).click();await search(page).fill('prod');await page.getByRole('option').filter({hasText:'Production'}).click();await expect(page.getByRole('button',{name:'Remove Participation: Production'})).toBeVisible();
 await page.getByRole('button',{name:'For You',exact:true}).click();await expect(page.getByTestId('home-mode-description')).toHaveText('General project order.');
 await page.screenshot({path:info.outputPath('browser-results.png')});
});

test('filter drawer applies deliberately, cancels safely and adapts without remounting',async({page},info)=>{
 await fixture(page);await page.goto('/explore');await expect(page.getByRole('article').first()).toBeVisible();
 for(const width of [390,767,768,1024,1440]){
  await page.setViewportSize({width,height:900});await filters(page).scrollIntoViewIfNeeded();const inputBox=(await search(page).boundingBox())!,buttonBox=(await filters(page).boundingBox())!;
  expect(buttonBox.x).toBeGreaterThanOrEqual(inputBox.x+inputBox.width);expect(Math.abs(buttonBox.y-inputBox.y)).toBeLessThan(2);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }
 await page.setViewportSize({width:1440,height:900});await filters(page).click();await dialog(page).getByRole('checkbox',{name:'EP',exact:true}).check();
 await page.keyboard.press('Escape');await expect(dialog(page)).toHaveCount(0);await expect(filters(page)).toBeFocused();await expect(filters(page)).toHaveAccessibleName('Filters');
 await filters(page).click();await expect(dialog(page).getByRole('checkbox',{name:'EP',exact:true})).not.toBeChecked();await dialog(page).getByRole('checkbox',{name:'EP',exact:true}).check();
 await page.screenshot({path:info.outputPath('filters-desktop.png')});
 await page.setViewportSize({width:390,height:844});await expect(dialog(page).getByRole('checkbox',{name:'EP',exact:true})).toBeChecked();
 await expect(dialog(page).getByRole('button',{name:/^Apply filters/})).toBeVisible();
 const bounds=(await dialog(page).boundingBox())!,apply=(await dialog(page).getByRole('button',{name:/^Apply filters/}).boundingBox())!;
 expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(390);expect(apply.y+apply.height).toBeLessThanOrEqual(844);expect(apply.height).toBeGreaterThanOrEqual(44);
 await dialog(page).getByRole('checkbox',{name:'Royalty share',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('filters-mobile.png')});
 await dialog(page).getByRole('button',{name:/^Apply filters/}).click();await expect(filters(page)).toHaveAccessibleName('Filters (1 active)');
 await filters(page).click();await dialog(page).getByRole('button',{name:'Clear all',exact:true}).click();await page.keyboard.press('Escape');await expect(filters(page)).toHaveAccessibleName('Filters (1 active)');
 await filters(page).click();await dialog(page).getByRole('button',{name:'Clear all',exact:true}).click();await dialog(page).getByRole('button',{name:/^Apply filters/}).click();await expect(filters(page)).toHaveAccessibleName('Filters');
 await page.setViewportSize({width:1440,height:768});await page.evaluate(()=>{window.scrollTo(0,0);document.querySelector('.shell-page')?.scrollTo(0,0)});
 expect((await page.getByRole('article').first().boundingBox())!.y).toBeLessThan(500);
});
