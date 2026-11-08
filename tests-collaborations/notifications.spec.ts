import { legacyConversation } from './legacy-fixture';
import { test, expect, type Page } from '@playwright/test';

const headers = { Origin: 'http://127.0.0.1:4175', 'X-Nebula-Request': '1' };
async function rpc(page: Page, method: string, ...args: unknown[]) {
  const response = await page.request.post('/api/rpc', { headers, data: { method, args } });
  expect(response.ok()).toBe(true); return (await response.json()).result;
}

test('historical notifications: artist notifications reach both accounts, open the workspace, persist reads and stay private', async ({ page, browser }, info) => {
  test.setTimeout(100_000);
  const live = expect.configure({ timeout: 15_000 }), tag = `${info.project.name}-${Date.now()}`;
  const email = `notification-owner-${tag}@example.invalid`, errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await rpc(page, 'register', { name: 'Notification Owner', role: 'artist', email, password: 'preview123' });
  const project = await rpc(page, 'createProject', { title: 'Notification sessions', category: 'EP', goalAmount: 1000, status: 'published' });
  const offer = await page.request.post(`/api/projects/${project.id}/offers`, { headers, data: { need: 'Verse', deliverable: 'An original verse.', requirements: 'Dry vocals.', deadline: null, compensation: { kind: 'split', percent: 10 }, status: 'open' } });
  expect(offer.ok()).toBe(true);
  const notificationHost = info.project.name === 'mobile' ? '/profile' : '/discovery';
  await page.goto(notificationHost);
  await expect(page.getByRole('button', { name: 'Notifications (0 unread)', exact: true })).toBeVisible();
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:4175', viewport: page.viewportSize()!, isMobile: info.project.name === 'mobile', hasTouch: info.project.name === 'mobile' });
  try {
    const artist = await context.newPage(); artist.on('pageerror', error => errors.push(error.message));
    await artist.goto('/notifications');
    await expect(artist.getByText('Log in as an artist to view your notifications.', { exact: true })).toBeVisible();
    await rpc(artist, 'register', { name: 'Notification Vocalist', role: 'artist', email: `notification-artist-${tag}@example.invalid`, password: 'preview123' });
    await legacyConversation(artist,(await offer.json()).id);
    await artist.goto(`/project/${project.id}`);
    await artist.getByRole('button', { name: 'Contact artist', exact: true }).click();
    await expect(artist).toHaveURL(/\/messages\/collaboration\/\d+$/);
    const workspace = new URL(artist.url()).pathname.replace('/messages/collaboration/','/collaborations/');
    await artist.getByRole('textbox', { name: 'Message', exact: true }).fill('Can I contribute a verse?');
    await artist.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(artist.getByRole('button', { name: 'Notifications (0 unread)', exact: true })).toBeVisible();
    await page.bringToFront();
    const bell = page.getByRole('button', { name: 'Notifications (2 unread)', exact: true });
    await live(bell).toBeVisible(); await bell.focus(); await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`${notificationHost}$`));
    await expect(page.getByRole('dialog', { name: 'Notifications' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Notifications', exact: true })).toBeVisible();
    const contact = page.getByRole('article', { name: 'Started a collaboration conversation · Notification sessions · Verse', exact: true });
    const message = page.getByRole('article', { name: 'Sent you a message · Notification sessions · Verse', exact: true });
    await expect(contact).toContainText('Notification Vocalist'); await expect(message).toContainText('Unread');
    await expect(page.getByText('Can I contribute a verse?', { exact: true })).toHaveCount(0);
    await expect(message.getByRole('link', { name: 'View collaboration', exact: true })).toBeInViewport();
    await page.screenshot({ path: info.outputPath('notifications.png') });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.route('**/api/notifications/read', route => route.fulfill({ status: 503, json: { error: 'Read update unavailable. Try again.' } }), { times: 1 });
    await message.getByRole('button', { name: 'Mark as read', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Read update unavailable.'); await expect(message).toContainText('Unread');
    await message.getByRole('button', { name: 'Mark as read', exact: true }).click();
    await expect(message.getByText('Read', { exact: true })).toBeVisible();
    await expect(page.locator('[data-notification-bell]:visible')).toHaveAttribute('aria-label', 'Notifications (1 unread)');
    await page.reload(); await page.getByRole('button', { name: 'Notifications (1 unread)', exact: true }).click(); await expect(message.getByText('Read', { exact: true })).toBeVisible();
    await contact.getByRole('link', { name: 'View collaboration', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${workspace}$`));
    await expect(page.getByRole('button', { name: 'Notifications (0 unread)', exact: true })).toBeVisible();
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Yes, send your interpretation.');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await artist.bringToFront(); await live(artist.getByRole('button', { name: 'Notifications (1 unread)', exact: true })).toBeVisible();
    await artist.getByRole('button', { name: 'Notifications (1 unread)', exact: true }).click();
    await expect(artist.getByRole('article')).toHaveCount(1);
    // An arrival after the observed read-all boundary must remain unread.
    await artist.route('**/api/notifications/read', async route => {
      await page.getByRole('textbox', { name: 'Message', exact: true }).fill('A newer message during read all.');
      await page.getByRole('button', { name: 'Send message', exact: true }).click();
      await expect(page.getByText('A newer message during read all.', { exact: true })).toBeVisible();
      await route.continue();
    });
    await artist.getByRole('button', { name: 'Mark all as read', exact: true }).click();
    await expect(artist.getByRole('article')).toHaveCount(2);
    await expect(artist.locator('[data-notification-bell]:visible')).toHaveAttribute('aria-label', 'Notifications (1 unread)');
    await artist.unroute('**/api/notifications/read');
    await artist.getByRole('button', { name: 'Mark as read', exact: true }).click();
    await expect(artist.locator('[data-notification-bell]:visible')).toHaveAttribute('aria-label', 'Notifications (0 unread)');
    await artist.reload(); await artist.getByRole('button', { name: 'Notifications (0 unread)', exact: true }).click(); await expect(artist.getByRole('article').getByText('Read', { exact: true })).toHaveCount(2);
    await artist.keyboard.press('Escape');
    await artist.getByRole('textbox', { name: 'Message', exact: true }).fill('Keep this unfinished message');
    await artist.getByRole('textbox', { name: 'Your proposal', exact: true }).fill('Keep this unfinished proposal');
    await artist.getByLabel('Work files (audio, video, PDF or ZIP)', { exact: true }).setInputFiles('artifacts/nebula/public/discovery-demo/soft-signal.wav');
    await expect(artist.getByRole('button', { name: /Remove/ }).first()).toBeVisible();
    await artist.getByRole('button', { name: 'Notifications (0 unread)', exact: true }).click();
    await expect(artist.getByRole('dialog', { name: 'Notifications', exact: true })).toBeVisible();
    await artist.keyboard.press('Escape');
    await expect(artist.getByRole('dialog', { name: 'Notifications', exact: true })).toHaveCount(0);
    await expect(artist.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('Keep this unfinished message');
    await expect(artist.getByRole('textbox', { name: 'Your proposal', exact: true })).toHaveValue('Keep this unfinished proposal');
    await expect(artist.getByRole('button', { name: /Remove/ }).first()).toBeVisible();
    // Real pagination, with events generated by the other participant.
    for (let index = 0; index < 31; index++) {
      const sent = await page.request.post(`/api${workspace}/messages`, { headers, data: { text: `Pagination event ${index}` } }); expect(sent.ok()).toBe(true);
    }
    await artist.getByRole('button', { name: /^Notifications/ }).click();
    await expect(artist.getByRole('article')).toHaveCount(30);
    await artist.getByRole('button', { name: 'Load earlier notifications' }).click();
    await expect(artist.getByRole('article')).toHaveCount(33);
    await rpc(page, 'logout'); await page.goto('/notifications');
    await expect(page.getByText('Log in as an artist to view your notifications.', { exact: true })).toBeVisible();
    await rpc(page, 'register', { name: 'Notification Investor', role: 'investor', email: `notification-investor-${tag}@example.invalid`, password: 'preview123' });
    await page.reload();
    await expect(page.getByText('Notifications are available to artist accounts.', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Notifications/ })).toHaveCount(0);
    await rpc(page, 'logout'); await rpc(page, 'login', { email, password: 'preview123' }); await page.reload();
    await expect(page.getByRole('article')).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Notifications (0 unread)', exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});
