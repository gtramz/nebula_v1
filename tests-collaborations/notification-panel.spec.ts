import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const headers = { Origin: 'http://127.0.0.1:4175', 'X-Nebula-Request': '1' };
async function register(page: Page, tag: string) {
  const response = await page.request.post('/api/rpc', { headers, data: { method: 'register', args: [{ name: 'Panel Artist', role: 'artist', email: `panel-${tag}@example.invalid`, password: 'preview123' }] } });
  expect(response.ok()).toBe(true);
}
const bell = (page: Page) => page.locator('[data-notification-bell]:visible');
const panel = (page: Page) => page.getByRole('dialog', { name: 'Notifications', exact: true });

test('panel keeps search, profile and feed position; keyboard, outside click and single polling owner', async ({ page }, info) => {
  test.setTimeout(75_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await register(page, `context-${info.project.name}-${Date.now()}`);
  await page.goto('/search');
  const search = page.getByRole('searchbox'); await search.fill('something to keep');
  let summaries = 0, lists = 0, searches = 0;
  page.on('request', request => { const path = new URL(request.url()).pathname; if (path === '/api/notifications/summary') summaries++; if (path === '/api/notifications') lists++; if (path === '/api/rpc') searches++; });
  await bell(page).focus(); await page.keyboard.press('Enter');
  await expect(panel(page)).toBeVisible(); await expect(page).toHaveURL(/\/search$/);
  await expect(panel(page).getByText('You’re all caught up.')).toBeVisible();
  await page.keyboard.press('Shift+Tab');
  expect(await page.evaluate(() => !!document.activeElement?.closest('[role=dialog]'))).toBe(true);
  // Two polling periods: no second timer per bell, no list/request cascade or search rerenders.
  await page.waitForTimeout(21_000);
  expect(summaries).toBeGreaterThanOrEqual(2); expect(summaries).toBeLessThanOrEqual(3); expect(lists).toBe(1); expect(searches).toBeLessThanOrEqual(2);
  await page.keyboard.press('Escape'); await expect(panel(page)).toHaveCount(0); await expect(bell(page)).toBeFocused(); await expect(search).toHaveValue('something to keep');
  await page.goto('/profile'); await bell(page).click(); await expect(panel(page)).toBeVisible(); await expect(page).toHaveURL(/\/profile$/);
  // Profile retains the bell at both breakpoints, including while the panel is open.
  const originalViewport = page.viewportSize()!;
  await page.setViewportSize(info.project.name === 'mobile' ? { width: 1024, height: 768 } : { width: 390, height: 844 });
  await expect(panel(page)).toBeVisible(); await panel(page).getByRole('button', { name: 'Close notifications' }).click();
  await expect(bell(page)).toBeFocused(); await page.setViewportSize(originalViewport);
  await page.goto('/discovery?demo=1');
  await page.getByRole('region', { name: 'Discovery feed' }).focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('article[data-active=true]')).toHaveAttribute('data-index', '1');
  const active = page.locator('article[data-active=true]'); await expect(active).toHaveCount(1);
  const id = await active.getAttribute('aria-label');
  // Immersive mobile Discovery has no bell: its existing Profile access remains available.
  if (info.project.name === 'mobile') {
    await expect(bell(page)).toHaveCount(0);
    await page.getByRole('navigation', { name: 'Primary navigation', exact: true }).getByRole('link', { name: 'profile', exact: true }).click();
  }
  await bell(page).click(); await expect(panel(page)).toBeVisible(); await page.screenshot({ path: info.outputPath('notification-panel.png') });
  // Outside click closes both the side drawer and the mobile sheet.
  await page.locator('.notifications-overlay').click({ position: { x: 3, y: 3 } });
  await expect(panel(page)).toHaveCount(0);
  if (info.project.name === 'mobile') await page.goBack();
  await expect(active).toHaveAttribute('aria-label', id!);
  expect(await page.locator('audio,video').evaluateAll(elements => elements.every(element => (element as HTMLMediaElement).paused))).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  // An open desktop panel survives entering immersive mobile Discovery. Its former
  // trigger is hidden, so closing restores focus to the feed without moving the post.
  await page.setViewportSize({ width: 1024, height: 768 });
  await bell(page).click(); await expect(panel(page)).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(panel(page)).toBeVisible(); await page.keyboard.press('Escape');
  await expect(panel(page)).toHaveCount(0); await expect(bell(page)).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Discovery feed', exact: true })).toBeFocused();
  await expect(active).toHaveAttribute('aria-label', id!);
  expect(errors).toEqual([]);
});

test('unsaved remix keeps contribution, fragment, gains, preview and scroll without restarting playback', async ({ page }, info) => {
  test.setTimeout(75_000);
  await register(page, `remix-${info.project.name}-${Date.now()}`);
  const file = await page.request.post('/api/uploads', { headers: { ...headers, 'X-Media-Kind': 'audio' }, data: await readFile('artifacts/nebula/public/discovery-demo/soft-signal.wav') }); expect(file.ok()).toBe(true);
  const response = await page.request.post('/api/publications', { headers, data: { title: 'Panel source', description: 'Test', mediaId: (await file.json()).id, coverId: null, projectId: null, allowRemix: true, status: 'published' } }); expect(response.ok()).toBe(true);
  const post = await response.json(); await page.goto(`/remix/${post.id}`); await page.getByRole('button', { name: 'Start private remix', exact: true }).click();
  await page.getByLabel('Remix title', { exact: true }).fill('Keep this unsaved title'); await page.getByLabel('Description', { exact: true }).fill('Unsaved description');
  await page.getByLabel('Upload file', { exact: true }).setInputFiles('artifacts/nebula/public/discovery-demo/orbit.wav'); await expect(page.getByText(/Your contribution is ready/)).toBeVisible();
  await page.getByLabel('Base volume', { exact: true }).press('Home');
  const start = page.getByRole('slider', { name: 'Move clip start', exact: true }); await start.press('ArrowRight'); const clip = await start.getAttribute('aria-valuenow');
  await page.getByRole('button', { name: 'Build preview', exact: true }).click();
  const preview = page.getByRole('region', { name: 'Remix preview', exact: true, includeHidden: true }).locator('audio'); await expect(preview).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save remix draft', exact: true })).toBeEnabled();
  const src = await preview.getAttribute('src');
  await preview.evaluate((element: HTMLAudioElement) => element.play());
  // Mobile header is in the normal flow; scroll to its trigger before measuring preserved position.
  await bell(page).scrollIntoViewIfNeeded(); const scroll = await page.evaluate(() => scrollY);
  let prompts = 0; page.on('dialog', async dialog => { prompts++; await dialog.dismiss(); });
  await bell(page).click(); await expect(panel(page)).toBeVisible(); await expect(page).toHaveURL(/\/studio\/remix$/);
  expect(await preview.evaluate((element: HTMLAudioElement) => element.paused)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(bell(page)).toBeFocused(); expect(await page.evaluate(() => scrollY)).toBe(scroll);
  await expect(page.getByLabel('Remix title', { exact: true })).toHaveValue('Keep this unsaved title'); await expect(page.getByLabel('Description', { exact: true })).toHaveValue('Unsaved description');
  await expect(page.getByLabel('Base volume', { exact: true })).toHaveValue('0.05'); await expect(start).toHaveAttribute('aria-valuenow', clip!); await expect(preview).toHaveAttribute('src', src!);
  await expect(page.getByText(/Your contribution is ready/)).toBeVisible(); expect(await preview.evaluate((element: HTMLAudioElement) => element.paused)).toBe(true); expect(prompts).toBe(0);
  expect((await (await page.request.get('/api/remix-drafts')).json()).items[0].render).toBeNull();
  // Cancelling explicit navigation from the panel must retain unsaved Remix work.
  let writes = 0; page.on('request', request => { if (request.url().endsWith('/api/notifications/read')) writes++; });
  await page.route('**/api/notifications', route => route.fulfill({ json: { unreadCount: 2, latestId: 2, nextCursor: null, items: [{ id: 1, collaborationId: 999, actorName: 'Another artist', projectTitle: 'Navigation fixture', need: 'Verse', kind: 'message', createdAt: new Date().toISOString(), readAt: null }, { id: 2, kind: 'artist.followed', actorId: 123, actorName: 'Following artist', target: { type: 'artist', id: 123, available: true }, createdAt: new Date().toISOString(), readAt: null }] } }));
  await bell(page).click(); await expect(panel(page).getByRole('article')).toHaveCount(2);
  await panel(page).getByRole('link', { name: 'View collaboration' }).click();
  expect(prompts).toBe(1); expect(writes).toBe(0); await expect(page).toHaveURL(/\/studio\/remix$/); await expect(panel(page)).toBeVisible();
  await panel(page).getByRole('link', { name: 'View artist', exact: true }).click();
  expect(prompts).toBe(2); expect(writes).toBe(0); await expect(page).toHaveURL(/\/studio\/remix$/); await expect(panel(page)).toBeVisible();
  await page.keyboard.press('Escape'); await expect(preview).toHaveAttribute('src', src!); await expect(page.getByLabel('Remix title', { exact: true })).toHaveValue('Keep this unsaved title');
});

test('panel recovers list failures and clears private content on session expiry', async ({ page }, info) => {
  await register(page, `retry-${info.project.name}-${Date.now()}`); await page.goto('/search');
  let fail = true;
  await page.route('**/api/notifications', async route => {
    if (fail) { fail = false; await route.fulfill({ status: 503, json: { error: 'Notifications temporarily unavailable.' } }); }
    else await route.continue();
  });
  await bell(page).click(); await expect(panel(page).getByRole('alert')).toContainText('Notifications temporarily unavailable.');
  await panel(page).getByRole('button', { name: 'Retry notifications' }).click(); await expect(panel(page).getByText('You’re all caught up.')).toBeVisible();
  await page.request.post('/api/rpc', { headers, data: { method: 'logout', args: [] } });
  await page.unroute('**/api/notifications');
  await page.keyboard.press('Escape'); await bell(page).click();
  await expect(panel(page)).toHaveCount(0); await expect(bell(page)).toHaveCount(0); await expect(page).toHaveURL(/\/search$/);
});
