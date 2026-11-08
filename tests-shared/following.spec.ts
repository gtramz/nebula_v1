import {test,expect,type Page} from '@playwright/test';
const headers={Origin:'http://127.0.0.1:4175','X-Nebula-Request':'1'};
async function rpc(page:Page,method:string,...args:unknown[]){const r=await page.request.post('/api/rpc',{headers,data:{method,args}});expect(r.ok(),await r.text()).toBe(true);return(await r.json()).result;}
async function account(page:Page,name:string,role='artist'){return rpc(page,'register',{name,role,email:`${crypto.randomUUID()}@example.invalid`,password:'preview123'});}
async function fixture(page:Page){
 const owner=await account(page,'Followed Artist');
 const project=await rpc(page,'createProject',{title:`Followed EP ${crypto.randomUUID().slice(0,8)}`,category:'EP',status:'funding',goalAmount:1000});
 await rpc(page,'createProject',{title:'Secret follow project',category:'EP',status:'draft',goalAmount:1000});
 const viewer=await account(page,'Follower Artist');return{owner,viewer,project};
}

test('follow lifecycle, accessible lists and Home react to real relationships',async({page,context},info)=>{
 const {owner,viewer,project}=await fixture(page);await page.goto(`/artist/${owner.artistId}`);
 await page.getByRole('button',{name:'Follow',exact:true}).click();await expect(page.getByRole('button',{name:'Following',exact:true})).toHaveAttribute('aria-pressed','true');
 await expect(page.getByRole('button',{name:'1 followers',exact:true})).toBeVisible();await page.reload();await expect(page.getByRole('button',{name:'Following',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'1 followers',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Followers',exact:true});await expect(dialog.getByRole('link',{name:'Follower Artist',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);const bounds=await dialog.boundingBox();expect(bounds!.x).toBeGreaterThanOrEqual(0);expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);await page.screenshot({path:info.outputPath('followers.png'),animations:'disabled'});
 await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'1 followers',exact:true})).toBeFocused();
 await page.getByRole('button',{name:'1 followers',exact:true}).click();await dialog.getByRole('link',{name:'Follower Artist',exact:true}).click();await expect(page).toHaveURL(new RegExp(`/artist/${viewer.artistId}$`));
 await expect(page.getByRole('link',{name:'Edit Profile',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Follow',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'1 following',exact:true}).click();await page.getByRole('dialog').getByRole('link',{name:'Followed Artist',exact:true}).click();
 await expect(page).toHaveURL(new RegExp(`/artist/${owner.artistId}$`));
 await page.goto('/explore');const search=page.getByRole('combobox',{name:'Search Home opportunities'});await search.fill('Followed');await search.press('Enter');
 await page.getByRole('button',{name:/^Filters/}).click();await page.getByRole('checkbox',{name:'EP',exact:true}).check();await page.getByRole('button',{name:/^Apply filters/}).click();
 await page.getByRole('button',{name:'Following',exact:true}).click();await expect(search).toHaveValue('Followed');await expect(page.getByRole('button',{name:'Filters (1 active)',exact:true})).toBeVisible();
 await expect(page.getByRole('article',{name:project.title,exact:true})).toHaveCount(1);await expect(page.getByText('Secret follow project',{exact:true})).toHaveCount(0);await page.screenshot({path:info.outputPath('following-home.png')});
 const other=await context.newPage();await other.goto(`/artist/${owner.artistId}`);await other.getByRole('button',{name:'Following',exact:true}).click();await expect(other.getByRole('button',{name:'0 followers',exact:true})).toBeVisible();
 await expect(page.getByRole('heading',{name:'Follow artists to discover their projects.',exact:true})).toBeVisible();await expect(page.getByRole('article')).toHaveCount(0);
 await other.close();await page.getByRole('button',{name:'For You',exact:true}).click();await expect(page.getByRole('article',{name:project.title,exact:true})).toBeVisible();
});

test('visitors and investors cannot follow; account changes do not reuse follow state',async({page})=>{
 const {owner}=await fixture(page);await page.goto(`/artist/${owner.artistId}`);await page.getByRole('button',{name:'Follow',exact:true}).click();await expect(page.getByRole('button',{name:'Following',exact:true})).toBeVisible();
 await rpc(page,'logout');await page.reload();await expect(page.getByRole('link',{name:'Sign in to follow',exact:true})).toBeVisible();
 await page.getByRole('link',{name:'Sign in to follow',exact:true}).click();await expect(page).toHaveURL(/\/login$/);
 await account(page,'New Artist');await page.goto(`/artist/${owner.artistId}`);await expect(page.getByRole('button',{name:'Follow',exact:true})).toHaveAttribute('aria-pressed','false');
 await page.goto('/explore');await page.getByRole('button',{name:'Following',exact:true}).click();await expect(page.getByRole('heading',{name:'Follow artists to discover their projects.'})).toBeVisible();
 await account(page,'Unchanged Investor','investor');await page.goto(`/artist/${owner.artistId}`);await expect(page.getByRole('button',{name:'Follow',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Following',exact:true})).toHaveCount(0);
 expect((await page.request.put(`/api/artists/${owner.artistId}/follow`,{headers})).status()).toBe(403);
 await page.goto('/explore');await expect(page.getByRole('heading',{name:'Find your next project.',exact:true})).toHaveCount(0);
});

test('follow errors preserve state and list loading can be retried',async({page})=>{
 const {owner}=await fixture(page);await page.goto(`/artist/${owner.artistId}`);
 await page.route(`**/api/artists/${owner.artistId}/follow`,r=>r.fulfill({status:503,json:{error:'Temporary test failure'}}));
 await page.getByRole('button',{name:'Follow',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Temporary test failure');await expect(page.getByRole('button',{name:'0 followers',exact:true})).toBeVisible();
 await page.unroute(`**/api/artists/${owner.artistId}/follow`);await page.getByRole('button',{name:'Follow',exact:true}).click();await expect(page.getByRole('button',{name:'1 followers',exact:true})).toBeVisible();
 await page.route(`**/api/artists/${owner.artistId}/followers`,r=>r.fulfill({status:503,json:{error:'List unavailable'}}));
 await page.getByRole('button',{name:'1 followers',exact:true}).click();await expect(page.getByRole('dialog').getByRole('alert')).toContainText('List unavailable');
 await page.unroute(`**/api/artists/${owner.artistId}/followers`);await page.getByRole('button',{name:'Retry artists',exact:true}).click();await expect(page.getByRole('dialog').getByRole('link',{name:'Follower Artist',exact:true})).toBeVisible();
});
