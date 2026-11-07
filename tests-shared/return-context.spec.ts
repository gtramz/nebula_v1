import { test, expect, type Page, type Dialog } from '@playwright/test';
const headers = { Origin: 'http://127.0.0.1:4175', 'X-Nebula-Request': '1' };
async function rpc(page: Page, method: string, ...args: unknown[]) {
  const response = await page.request.post('/api/rpc', { headers, data: { method, args } }); expect(response.ok()).toBeTruthy(); return response.json();
}
async function artist(page: Page) {
  return rpc(page, 'register', { name: 'Return artist', role: 'artist', email: `return-${crypto.randomUUID()}@example.invalid`, password: 'preview123' });
}
const nav = (page: Page, name: string) => page.getByRole('navigation', { name: 'Primary navigation', exact: true }).getByRole('link', { name, exact: true });

test('Explore category, position and focus return from a project; direct entry has a fallback', async ({ page }, info) => {
  await artist(page);
  for (let i = 0; i < 9; i++) await rpc(page, 'createProject', { title: `Return project ${i}`, category: 'EP', goalAmount: 1000, status: 'funding' });
  await page.goto('/explore'); await page.getByRole('button', { name: 'ep', exact: true }).click();
  const link = page.locator('a[href^="/project/"]').last();
  await link.scrollIntoViewIfNeeded(); await link.focus();
  const position = () => page.evaluate(() => ({ window: scrollY, shell: document.querySelector('.shell-page')!.scrollTop, page: document.querySelector('[data-page-scroll]')!.scrollTop }));
  const before = await position(), href = await link.getAttribute('href');
  await link.click(); await page.getByRole('link', { name: 'Back to Explore', exact: true }).click();
  await expect(page.getByRole('button', { name: 'ep', exact: true })).toHaveClass(/bg-cream/);
  await expect.poll(position).toEqual(before); await expect(link).toBeFocused();
  await page.goto(href!); const back = page.getByRole('link', { name: 'Back to Explore', exact: true });
  await expect(back).toHaveAttribute('href', '/explore'); await back.focus();
  expect((await back.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: info.outputPath('project-return.png') });
  await back.press('Enter'); await expect(page).toHaveURL(/\/explore$/);
});

test('Search query survives artist and project return; browser Back uses the same context', async ({ page }) => {
  await artist(page); await rpc(page, 'createProject', { title: 'Return query project', category: 'EP', goalAmount: 1000, status: 'funding' });
  await page.goto('/search'); await page.getByRole('searchbox').fill('Return query');
  await page.locator('a[href^="/project/"]').first().click();
  await page.getByRole('link', { name: 'Back to Search', exact: true }).click();
  await expect(page.getByRole('searchbox')).toHaveValue('Return query');
  await page.getByRole('searchbox').fill('Return artist'); await page.locator('a[href^="/artist/"]').first().click();
  await expect(page.getByRole('link', { name: 'Back to Search', exact: true })).toBeVisible();
  await page.goBack(); await expect(page.getByRole('searchbox')).toHaveValue('Return artist');
});

test('publication changes resist sidebar, parent return and browser Back until explicitly discarded', async ({ page }) => {
  await artist(page); await page.goto('/studio'); await page.getByRole('link', { name: 'New publication', exact: true }).click();
  await page.getByLabel('Title', { exact: true }).fill('Keep my working title');
  let dismissals = 0;
  const reject = async (dialog: Dialog) => { dismissals++; await dialog.dismiss(); }; page.on('dialog', reject);
  await page.getByRole('link', { name: 'Back to studio', exact: true }).click();
  await expect(page).toHaveURL(/\/publish$/); await nav(page, 'explore').click();
  await page.evaluate(() => history.back());
  await expect.poll(() => dismissals).toBe(3);
  await expect(page).toHaveURL(/\/publish$/); await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Keep my working title');
  page.off('dialog', reject); page.once('dialog', dialog => dialog.accept());
  await page.getByRole('link', { name: 'Back to studio', exact: true }).click(); await expect(page).toHaveURL(/\/studio$/);
});

test('Discovery resumes the active post after leaving; refresh failure does not unmount it', async ({ page }) => {
  const items = Array.from({ length: 8 }, (_, n) => ({ id: n + 1, artistId: 999, artistName: 'Feed return fixture', title: `Remember ${n}`, description: 'Return context fixture', status: 'published', allowRemix: false,
    media: { id: `media-${n}`, kind: 'audio', url: '/discovery-demo/soft-signal.wav' }, social: { stars: 0, comments: 0, starred: false, saved: false }, offers: [], project: null }));
  let fail = false;
  await page.route('**/api/feed?*', route => route.fulfill(fail ? { status: 503, json: { error: 'Temporary feed error' } } : { json: { items, nextCursor: null, snapshot: 'stable-fixture' } }));
  await page.goto('/discovery'); const feed = page.getByRole('region', { name: 'Discovery feed', exact: true });
  await feed.focus(); for (let i = 0; i < 5; i++) await feed.press('ArrowDown');
  await expect(page.locator('article[data-active=true]')).toHaveAttribute('data-index', '5');
  await nav(page, 'explore').click(); fail = true; await nav(page, 'discovery').click();
  await expect(page.getByRole('alert')).toContainText('Temporary feed error');
  await expect(page.locator('article[data-active=true]')).toHaveAttribute('data-index', '5');
  expect(await page.locator('.discovery-feed audio, .discovery-feed video').count()).toBeLessThanOrEqual(3);
  fail = false; await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0); await expect(page.locator('article[data-active=true]')).toHaveAttribute('data-index', '5');
});
