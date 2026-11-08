import { clickProfileLogout } from '../tests-support/profile-actions';
import { expect, test, type Page } from '@playwright/test';

async function go(page: Page, path: string) {
  await page.locator(`a[href="${path}"]:visible`).first().click();
}

async function register(page: Page, role: 'artist' | 'investor', name: string, email: string) {
  await go(page, '/login');
  await page.getByRole('link', { name: 'sign up', exact: true }).click();
  await page.getByRole('button', { name: new RegExp(`^${role} `) }).click();
  await page.getByRole('textbox', { name: 'full name' }).fill(name);
  await page.getByRole('button', { name: 'continue', exact: true }).click();
  await page.getByRole('textbox', { name: 'email address' }).fill(email);
  await page.getByRole('button', { name: 'continue', exact: true }).click();
  await page.getByLabel('password', { exact: true }).fill('preview123');
  await page.getByLabel('confirm password', { exact: true }).fill('preview123');
  await page.getByRole('button', { name: 'create account', exact: true }).click();
  if (role === 'artist') { await expect(page).toHaveURL(/\/onboarding$/); await page.getByRole('button', { name: 'Skip for now', exact: true }).click(); }
  await expect(page).toHaveURL(role === 'artist' ? /\/profile$/ : /\/explore$/);
}

async function logout(page: Page) {
  await go(page, '/profile');
  await clickProfileLogout(page);
  await expect(page).toHaveURL(/\/$/);
}

test('all interface flows run with no network after the first page load', async ({ page, context }, testInfo) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  const unexpectedRequests: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('websocket', (socket) => unexpectedRequests.push(socket.url()));
  page.on('request', (request) => {
    if (/^(data|blob):/.test(request.url())) return;
    if (new URL(request.url()).origin !== 'http://127.0.0.1:4173'
      || ['fetch', 'xhr', 'eventsource'].includes(request.resourceType())) unexpectedRequests.push(request.url());
  });
  await page.addInitScript(() => {
    const attempts: string[] = [];
    Object.assign(window, { networkAttempts: attempts });
    window.fetch = () => { attempts.push('fetch'); throw new Error('Network disabled in this preview check'); };
    for (const name of ['XMLHttpRequest', 'WebSocket', 'EventSource'] as const) {
      Object.defineProperty(window, name, { value: class { constructor() { attempts.push(name); throw new Error('Network disabled'); } } });
    }
    navigator.sendBeacon = () => { attempts.push('beacon'); return false; };
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'nebula', exact: true })).toBeVisible();
  await page.waitForLoadState('load');
  await page.screenshot({ path: testInfo.outputPath('home.png'), fullPage: true });
  await context.setOffline(true);
  await go(page, '/explore');
  await expect(page.getByText('no projects found', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'album', exact: true }).click();
  await page.getByRole('button', { name: 'all', exact: true }).click();

  await register(page, 'artist', 'Artist Preview', 'artist@example.invalid');
  await page.getByRole('button', { name: 'EDIT PROFILE', exact: true }).click();
  await page.getByRole('button', { name: 'Choose musical genres', exact: true }).click();
  await page.getByRole('combobox', { name: 'Search musical genres' }).fill('Electronic');
  await page.getByRole('option', { name: 'Electronic', exact: true }).click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Musical genres selector' })).toBeHidden();
  await page.getByRole('textbox', { name: 'bio', exact: true }).fill('An artist profile created in this tab.');
  await page.getByRole('button', { name: 'save profile', exact: true }).click();
  await expect(page.getByText('Electronic', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'NEW PROJECT', exact: true }).click();
  await page.getByLabel('TITLE', { exact: true }).fill('Preview Release');
  await page.getByLabel('STATUS', { exact: true }).selectOption('funding');
  await page.getByLabel('PITCH (Short description)', { exact: true }).fill('Music from a local preview.');
  await page.getByLabel('COVER IMAGE', { exact: true }).setInputFiles({
    name: 'cover.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6f0EAAAAASUVORK5CYII=', 'base64'),
  });
  await page.getByRole('button', { name: 'SAVE PROJECT', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Preview Release', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'edit Preview Release', exact: true }).click();
  await page.getByLabel('TITLE', { exact: true }).fill('Preview Album');
  await page.getByRole('button', { name: 'SAVE PROJECT', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Preview Album', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('artist-dashboard.png'), fullPage: true });
  await logout(page);

  await register(page, 'artist', 'Supporting Artist', 'supporter@example.invalid');
  await go(page, '/explore');
  await page.locator('a[href^="/project/"]').filter({ hasText: 'Preview Album' }).first().click();
  await page.getByRole('button', { name: 'SUPPORT SYMBOLICALLY', exact: true }).click();
  await expect(page.getByRole('button', { name: 'SUPPORTED', exact: true })).toBeVisible();
  await logout(page);

  await register(page, 'investor', 'Investor Preview', 'investor@example.invalid');
  await go(page, '/search');
  await page.getByRole('searchbox').fill('Preview');
  await page.locator('a[href^="/artist/"]').filter({ hasText: 'Artist Preview' }).first().click();
  await expect(page.getByRole('heading', { name: 'Artist Preview', exact: true })).toBeVisible();
  await expect(page.getByText('An artist profile created in this tab.', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Projects', exact: true }).click();
  await page.locator('a[href^="/project/"]').filter({ hasText: 'Preview Album' }).first().click();
  await page.getByRole('button', { name: 'BACK THIS PROJECT', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('No money moves.');
  await page.getByRole('button', { name: /^PREVIEW / }).click();
  await expect(page.getByRole('heading', { name: 'pledge preview saved', exact: true })).toBeVisible();
  await expect(page.getByText('This is a preview. No payment was made.', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('receipt.png'), fullPage: true });
  await go(page, '/pledges');
  await expect(page.getByRole('heading', { name: 'Preview Album', exact: true })).toBeVisible();
  await logout(page);

  await go(page, '/login');
  await page.getByRole('textbox', { name: 'email', exact: true }).fill('artist@example.invalid');
  await page.getByLabel('password', { exact: true }).fill('preview123');
  await page.getByRole('button', { name: 'log in', exact: true }).click();
  await expect(page).toHaveURL(/\/profile$/);
  await page.getByRole('button', { name: 'edit Preview Album', exact: true }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'DELETE', exact: true }).click();
  await expect(page.getByText('NO PROJECTS YET', { exact: true })).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'More', exact: true }).filter({visible:true}).click();
  await page.getByRole('menuitem', { name: 'clear demo data', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await go(page, '/explore');
  await expect(page.getByText('no projects found', { exact: true })).toBeVisible();

  expect(await page.evaluate(() => (window as unknown as { networkAttempts: string[] }).networkAttempts)).toEqual([]);
  expect(unexpectedRequests).toEqual([]);
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});
