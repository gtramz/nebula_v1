import { test, expect, type Page } from '@playwright/test';
const headers = { Origin: 'http://127.0.0.1:4175', 'X-Nebula-Request': '1' };
async function rpc(page: Page, method: string, ...args: unknown[]) { const r = await page.request.post('/api/rpc', { headers, data: { method, args } }); expect(r.ok()).toBeTruthy(); return (await r.json()).result; }
async function register(page: Page, role = 'artist') { return rpc(page, 'register', { name: 'Home tester', email: `${crypto.randomUUID()}@example.invalid`, password: 'preview123', role }); }
async function fixture(page: Page) {
  await register(page);
  const suffix = crypto.randomUUID().slice(0, 8);
  const create = (title: string, status: string, category = 'EP') => rpc(page, 'createProject', { title: `${title} ${suffix}`, category, goalAmount: 3000, status });
  const project = await create('Home creative EP', 'published'), funding = await create('Home funding album', 'funding', 'Album');
  const catalog = await create('Home catalog only', 'published');
  const offers = [];
  for (const need of ['Feature', 'Mix']) {
    const r = await page.request.post(`/api/projects/${project.id}/offers`, { headers, data: { need, deliverable: `A ${need} for this project`, requirements: '', deadline: null, status: 'open', compensation: need === 'Feature' ? { kind: 'split', percent: 12 } : { kind: 'fee', amount: 250, currency: 'USD' } } });
    expect(r.ok()).toBeTruthy(); offers.push(await r.json());
  }
  return { project, funding, catalog, offers };
}
const nav = (page: Page) => page.getByRole('navigation', { name: 'Primary navigation', exact: true });

test('Home groups real opportunities, retains filters and layout while investor catalog remains intact', async ({ page }, info) => {
  const { project, catalog } = await fixture(page);
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/explore');
  await expect(nav(page).getByRole('link', { name: 'home', exact: true })).toHaveAttribute('aria-current', 'page');
  const card = page.getByRole('article', { name: project.title, exact: true });
  await expect(card).toHaveCount(1); await expect(card).toContainText('2 open opportunities');
  await expect(card).toContainText('12% royalty split offered'); await expect(card).toContainText('USD 250.00 fixed fee');
  await expect(page.getByRole('article', { name: catalog.title, exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: /^Filters/ }).click(); await page.getByRole('checkbox', { name: 'EP', exact: true }).check(); await page.getByRole('button', { name: /^Apply filters/ }).click();
  await card.getByRole('link', { name: 'View project', exact: true }).click();
  await expect(page.getByRole('article', { name: 'Feature offer', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Back to Home', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove Project type: EP', exact: true })).toBeVisible();
  for (const width of [390, 767, 768, 1023, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(nav(page)).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await card.getByRole('link', { name: 'View project', exact: true }).scrollIntoViewIfNeeded();
    const box = (await card.getByRole('link', { name: 'View project', exact: true }).boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44); expect(box.y + box.height).toBeLessThanOrEqual(width < 768 ? 836 : 900);
    if ([390, 1440].includes(width)) await page.screenshot({ path: info.outputPath(`home-${width}.png`), fullPage: true });
  }
  await rpc(page, 'logout'); await page.goto('/explore'); await expect(card).toBeVisible();
  await register(page, 'investor'); await page.goto('/explore');
  await expect(nav(page).getByRole('link', { name: 'explore', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { name: catalog.title, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'album', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Filters/ })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('closing offers removes only opportunity visibility and keeps project links, Search and Discovery context', async ({ page }) => {
  const { project, offers } = await fixture(page);
  const upload = await page.request.post('/api/uploads', { headers: { ...headers, 'X-Media-Kind': 'audio', 'Content-Type': 'application/octet-stream' }, data: await (await import('node:fs/promises')).readFile('artifacts/nebula/public/discovery-demo/soft-signal.wav') });
  const media = await upload.json();
  const post = await (await page.request.post('/api/publications', { headers, data: { title: 'Home linked music', description: 'Project context stays available', mediaId: media.id, coverId: null, projectId: project.id, allowRemix: true, status: 'published' } })).json();
  for (const offer of offers) expect((await page.request.patch(`/api/offers/${offer.id}`, { headers, data: { action: 'close', revision: offer.revision } })).ok()).toBe(true);
  await page.goto('/explore'); await expect(page.getByRole('article', { name: project.title, exact: true })).toHaveCount(0);
  await page.goto('/search'); await page.getByRole('searchbox').fill(project.title);
  await page.locator(`a[href="/project/${project.id}"]`).click(); await expect(page.getByRole('heading', { name: project.title, exact: true })).toBeVisible();
  await page.goto(`/discovery?post=post-${post.id}`);
  await page.locator('article[data-active=true]').getByRole('button', { name: /view project/ }).click();
  await page.getByRole('link', { name: 'Open full project', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/project/${project.id}$`));
  await page.getByRole('link', { name: 'Back to Discovery', exact: true }).click();
  await expect(page.locator('article[data-active=true]')).toContainText('Home linked music');
});

test('Home exposes empty and retry states without substituting demo data', async ({ page }) => {
  let failed = true;
  await page.route('**/api/opportunities/projects?*', route => route.fulfill(failed ? { status: 503, json: { error: 'Home temporarily unavailable' } } : { json: { items: [], nextCursor: null } }));
  await page.goto('/explore'); await expect(page.getByRole('alert')).toContainText('Home temporarily unavailable');
  await expect(page.getByRole('article')).toHaveCount(0);
  failed = false; await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No open opportunities yet.', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^Filters/ }).click(); await page.getByRole('checkbox', { name: 'Tour', exact: true }).check(); await page.getByRole('button', { name: /^Apply filters/ }).click();
  await expect(page.getByRole('heading', { name: 'No matching projects.', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Clear all filters', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Filters', exact: true })).toBeVisible();
});
