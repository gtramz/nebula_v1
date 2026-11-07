import { test, expect, type Page } from '@playwright/test';
const headers = { Origin: 'http://127.0.0.1:4175', 'X-Nebula-Request': '1' };
async function register(page: Page, role: 'artist' | 'investor', tag: string) {
  const result = await page.request.post('/api/rpc', { headers, data: { method: 'register', args: [{ name: 'Navigation tester', email: `${tag}@example.invalid`, password: 'preview123', role }] } });
  expect(result.ok()).toBe(true);
}
const nav = (page: Page) => page.getByRole('navigation', { name: 'Primary navigation', exact: true });
const more = (page: Page) => page.getByRole('button', { name: 'More', exact: true }).filter({ visible: true });
async function geometry(page: Page, width: number, expanded: boolean) {
  await page.setViewportSize({ width, height: 900 });
  await expect(nav(page)).toHaveCount(1);
  const expectedWidth = width < 768 ? 0 : width < 1024 || !expanded ? 72 : 240;
  await expect.poll(() => page.locator('.shell-content').evaluate(e => e.getBoundingClientRect().left)).toBe(expectedWidth);
  const rect = (await page.getByTestId('app-navigation').boundingBox())!;
  if (width < 768) {
    expect(rect.y + rect.height).toBe(900); expect(rect.height).toBeGreaterThanOrEqual(64);
    expect(await page.locator('.shell-content').evaluate(e => parseFloat(getComputedStyle(e).paddingBottom))).toBe(rect.height);
    await expect(page.locator('.mobile-navigation-header')).toBeVisible();
  } else { expect(rect.x).toBe(0); expect(rect.width).toBe(expectedWidth); expect(rect.y).toBe(0); await expect(page.locator('.mobile-navigation-header')).toBeHidden(); }
  await expect(page.getByRole('button', { name: /^(Expand|Collapse) sidebar$/ })).toHaveCount(width >= 1024 ? 1 : 0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test('responsive navigation has one landmark, persistent desktop preference and accessible More', async ({page}, info) => {
  await page.goto('/explore');
  await expect(nav(page).getByRole('link')).toHaveCount(3);
  await expect(nav(page).getByRole('link',{name:'explore',exact:true})).toHaveAttribute('aria-current','page');
  for (const width of [390,767,768,1023,1024,1440]) {
    await geometry(page,width,true);
    if ([390,768,1440].includes(width)) await page.screenshot({path:info.outputPath(`navigation-${width}.png`)});
  }
  await page.getByRole('button',{name:'Collapse sidebar',exact:true}).click();await geometry(page,1440,false);
  await page.reload();await geometry(page,1440,false);
  const explore=nav(page).getByRole('link',{name:'explore',exact:true});await explore.focus();await expect(page.getByRole('tooltip',{name:'explore',exact:true})).toBeVisible();await page.keyboard.press('Escape');
  await geometry(page,768,false);await geometry(page,390,false);await geometry(page,1024,false);
  await page.getByRole('button',{name:'Expand sidebar',exact:true}).click();await geometry(page,1440,true);
  await more(page).click();await expect(page.getByRole('menu')).toContainText('local server · persistent storage');
  await expect(page.getByRole('menuitem',{name:'clear demo data',exact:true})).toHaveCount(0);
  const home = page.getByRole('menuitem',{name:'home',exact:true}); await home.focus();
  await expect(home).toHaveCSS('color','rgb(0, 0, 0)');
  await page.screenshot({path:info.outputPath('more-menu.png')});

  await page.keyboard.press('Escape');await expect(more(page)).toBeFocused();
  await geometry(page,390,true);await more(page).click();await page.getByRole('menuitem',{name:'home',exact:true}).click();
  await expect(page).toHaveURL(/\/$/);await expect(nav(page)).toHaveCount(0);await expect(more(page)).toBeVisible();
  for(const path of ['/login','/register']) { await page.goto(path);await expect(nav(page)).toHaveCount(0);await expect(more(page)).toBeVisible(); }
  expect(await page.locator('meta[name=viewport]').getAttribute('content')).toContain('viewport-fit=cover');
});

test('artist and investor destinations keep the same active states at every breakpoint',async({page},info)=>{
  for (const role of ['artist','investor'] as const) {
    await register(page,role,`nav-${role}-${info.project.name}-${Date.now()}`);
    const label=role==='artist'?'received':'pledges';await page.goto(`/${label}`);
    for(const width of [390,768,1024]) {
      await geometry(page,width,true);await expect(nav(page).getByRole('link')).toHaveCount(5);
      await expect(nav(page).getByRole('link',{name:label,exact:true})).toHaveAttribute('href',`/${label}`);
      await expect(nav(page).getByRole('link',{name:label,exact:true})).toHaveAttribute('aria-current','page');
      await expect(page.getByRole('link',{name:/^Notifications/})).toHaveCount(role==='artist'?1:0);
    }
    await nav(page).getByRole('link',{name:'profile',exact:true}).click();await expect(nav(page).getByRole('link',{name:'profile',exact:true})).toHaveAttribute('aria-current','page');
  }
});

test('Discovery retains its current post and reachable actions through resizing and collapse',async({page},info)=>{
  await page.setViewportSize({width:1440,height:900});await page.goto('/discovery?demo=1');
  await page.getByRole('button',{name:'Next post',exact:true}).click();
  await expect(page.locator('article[data-active=true]')).toContainText('soft signal');
  const id=await page.locator('article[data-active=true]').getAttribute('aria-label');
  for(const width of [1024,768,390,767,1023,1440]) {
    await geometry(page,width,true);await expect(page.locator('article[data-active=true]')).toHaveAttribute('aria-label',id!);
    const actions=(await page.locator('article[data-active=true] .discovery-actions').boundingBox())!;
    expect(actions.y+actions.height).toBeLessThanOrEqual(width<768?836:900);
  }
  await page.getByRole('button',{name:'Collapse sidebar',exact:true}).click();await expect(page.locator('article[data-active=true]')).toHaveAttribute('aria-label',id!);
  await page.setViewportSize({width:660,height:390});
  const actions=page.locator('article[data-active=true] .discovery-actions');await actions.scrollIntoViewIfNeeded();
  expect((await actions.boundingBox())!.y+(await actions.boundingBox())!.height).toBeLessThanOrEqual(326);
  await page.screenshot({path:info.outputPath('discovery-landscape.png')});
});

test('sidebar preference falls back to memory if its storage key is unavailable',async({page})=>{
  await page.addInitScript(()=>{const get=Storage.prototype.getItem,set=Storage.prototype.setItem;Storage.prototype.getItem=function(key){if(key==='nebula-navigation-expanded')throw new Error('Storage unavailable');return get.call(this,key);};Storage.prototype.setItem=function(key,value){if(key==='nebula-navigation-expanded')throw new Error('Storage unavailable');return set.call(this,key,value);};});
  await page.setViewportSize({width:1440,height:900});await page.goto('/explore');await page.getByRole('button',{name:'Collapse sidebar',exact:true}).click();await geometry(page,1440,false);
  await nav(page).getByRole('link',{name:'search',exact:true}).click();await geometry(page,1440,false);await page.reload();await geometry(page,1440,true);
});
