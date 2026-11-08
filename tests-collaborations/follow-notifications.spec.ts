import { clickProfileLogout } from '../tests-support/profile-actions';
import { test, expect, type Page } from '@playwright/test';
const headers = { Origin: 'http://127.0.0.1:4175', 'X-Nebula-Request': '1' };
async function register(page: Page, name: string) {
 const email = `${crypto.randomUUID()}@example.invalid`;
 const r = await page.request.post('/api/rpc', { headers, data: { method: 'register', args: [{ name, email, password: 'preview123', role: 'artist' }] } });
 expect(r.ok(), await r.text()).toBe(true); return { ...(await r.json()).user, email };
}
const bell = (page: Page) => page.locator('[data-notification-bell]:visible');
const panel = (page: Page) => page.getByRole('dialog', { name: 'Notifications', exact: true });
const notices = (page: Page) => page.request.get('/api/notifications').then(r => r.json());

test('two artists receive exclusive follow notices with durable reading, profile navigation and refollow history', async ({ page, browser }, info) => {
 test.setTimeout(65_000);
 const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
 const b = await register(page, 'Follow Recipient'); await page.goto('/explore');
 const context = await browser.newContext({ baseURL: headers.Origin, viewport: page.viewportSize()!, isMobile: info.project.name === 'mobile', hasTouch: info.project.name === 'mobile' });
 try {
  const sender = await context.newPage(); const a = await register(sender, 'Follow Actor');
  await sender.goto(`/artist/${b.artistId}`);
  // The server commits, but the client loses the response and retries.
  await sender.route(`**/api/artists/${b.artistId}/follow`, async route => { expect((await route.fetch()).ok()).toBe(true); await route.abort('failed'); }, { times: 1 });
  await sender.getByRole('button', { name: 'Follow', exact: true }).click();
  await expect(sender.getByRole('alert')).toContainText('Try again.');
  await sender.getByRole('button', { name: 'Follow', exact: true }).click();
  await expect(sender.getByRole('button', { name: '1 followers', exact: true })).toBeVisible();
  await expect(bell(sender)).toHaveAttribute('aria-label', 'Notifications (0 unread)');
  await page.bringToFront(); await expect(bell(page)).toHaveAttribute('aria-label', 'Notifications (1 unread)', { timeout: 15_000 });
  await bell(page).focus(); await page.keyboard.press('Enter');
  const article = panel(page).getByRole('article', { name: 'Follow Actor started following you', exact: true });
  await expect(article).toBeVisible(); await expect(article.getByText('Unread', { exact: true })).toBeVisible();
  await expect(article.getByRole('link', { name: 'View collaboration' })).toHaveCount(0);
  await expect(article.getByRole('link', { name: 'View artist', exact: true })).toHaveAttribute('href', `/artist/${a.artistId}`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const view = await article.getByRole('link', { name: 'View artist', exact: true }).boundingBox(); expect(view!.height).toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: info.outputPath('follow-notification.png') });
  await page.keyboard.press('Escape'); await expect(bell(page)).toBeFocused();
  await bell(page).click(); await article.getByRole('link', { name: 'View artist', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/artist/${a.artistId}$`)); await expect(panel(page)).toHaveCount(0);
  await expect(bell(page)).toHaveAttribute('aria-label', 'Notifications (0 unread)');
  const original = (await notices(page)).items[0]; expect(original.readAt).toBeTruthy();
  await sender.getByRole('button', { name: 'Following', exact: true }).click();
  await expect(sender.getByRole('button', { name: '0 followers', exact: true })).toBeVisible();
  expect((await notices(page)).items).toEqual([original]);
  await sender.getByRole('button', { name: 'Follow', exact: true }).click();
  await expect(sender.getByRole('button', { name: '1 followers', exact: true })).toBeVisible();
  await page.reload(); await expect(bell(page)).toHaveAttribute('aria-label', 'Notifications (1 unread)'); await bell(page).click();
  await expect(panel(page).getByRole('article')).toHaveCount(2); await expect(panel(page).getByText('Read', { exact: true })).toHaveCount(1);
  await panel(page).getByRole('button', { name: 'Mark all as read', exact: true }).click();
  await expect(panel(page).getByText('Read', { exact: true })).toHaveCount(2);
  await page.goto('/notifications'); await expect(page.getByRole('article')).toHaveCount(2);
  expect((await notices(sender)).items).toHaveLength(0); expect(errors).toEqual([]);
 } finally { await context.close(); }
});

test('new follow during mark-all stays unread and unavailable profiles retain their history without a link', async ({ page, browser }) => {
 const b = await register(page, 'Read Boundary Recipient'); const context = await browser.newContext({ baseURL: headers.Origin });
 try {
  const sender = await context.newPage(); const a = await register(sender, 'Read Boundary Actor');
  const path = `/api/artists/${b.artistId}/follow`; await sender.request.put(path, { headers });
  await page.goto('/notifications'); await expect(page.getByRole('article')).toHaveCount(1);
  await page.route('**/api/notifications/read', async route => {
   await sender.request.delete(path, { headers }); await sender.request.put(path, { headers }); await route.continue();
  }, { times: 1 });
  await page.getByRole('button', { name: 'Mark all as read', exact: true }).click();
  await expect(page.getByRole('article')).toHaveCount(2); await expect(page.getByText('Unread', { exact: true })).toHaveCount(1);
  const data = await notices(page);
  await page.route('**/api/notifications', route => route.fulfill({ json: { ...data, items: data.items.map((item: any) => ({ ...item, actorName: 'Artist unavailable', target: { type: 'artist', id: a.artistId, available: false } })) } }));
  await page.reload(); await expect(page.getByRole('article')).toHaveCount(2);
  await expect(page.getByRole('link', { name: 'View artist', exact: true })).toHaveCount(0);
  await expect(page.getByText('This artist profile is no longer available.', { exact: true })).toHaveCount(2);
  await page.getByRole('button', { name: 'Mark as read', exact: true }).click();
  expect((await notices(page)).unreadCount).toBe(0);
 } finally { await context.close(); }
});

for (const delayed of ['summary', 'list', 'read'] as const) test(`pending ${delayed} response cannot expose the previous account or navigate after logout/login`, async ({ page, browser }) => {
 test.setTimeout(45_000);
 const b = await register(page, 'Old Notice Owner'); const context = await browser.newContext({ baseURL: headers.Origin });
 let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
 try {
  const sender = await context.newPage(); const a = await register(sender, 'New Session Actor');
  await sender.request.put(`/api/artists/${b.artistId}/follow`, { headers });
  await page.goto('/profile'); await expect(bell(page)).toHaveAttribute('aria-label', 'Notifications (1 unread)');
  if (delayed === 'read') { await bell(page).click(); await expect(panel(page).getByRole('article')).toHaveCount(1); }
  let captured = false;
  const path = delayed === 'list' ? '**/api/notifications' : `**/api/notifications/${delayed}`;
  await page.route(path, async route => {
   if (captured) { await route.continue(); return; }
   const response = await route.fetch(); captured = true; await gate; await route.fulfill({ response }).catch(() => {});
  });
  if (delayed === 'read') await panel(page).getByRole('link', { name: 'View artist', exact: true }).click();
  if (delayed === 'list') await bell(page).click();
  await expect.poll(() => captured, { timeout: 15_000 }).toBe(true);
  if (delayed !== 'summary') await page.keyboard.press('Escape');
  await clickProfileLogout(page);
  await expect.poll(async () => (await (await page.request.get('/api/session')).json()).user).toBeNull();
  // Use the actual SPA login path; a page reload would mask stale-response bugs.
  await page.locator('a[href="/login"]:visible').first().click();
  await page.getByLabel('email', { exact: true }).fill(a.email); await page.getByLabel('password', { exact: true }).fill('preview123');
  await page.getByRole('button', { name: 'log in', exact: true }).click();
  await expect(page).toHaveURL(/\/profile$/); await expect(page.getByRole('heading', { name: 'New Session Actor', exact: true })).toBeVisible();
  release(); await page.waitForTimeout(400);
  await expect(page).toHaveURL(/\/profile$/); await expect(bell(page)).toHaveAttribute('aria-label', 'Notifications (0 unread)');
  await bell(page).click(); await expect(panel(page).getByText('You’re all caught up.')).toBeVisible(); await expect(panel(page).getByRole('article')).toHaveCount(0);
  expect((await (await page.request.get('/api/session')).json()).user.artistId).toBe(a.artistId);
 } finally { release(); await context.close(); }
});
