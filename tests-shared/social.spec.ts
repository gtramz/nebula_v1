import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const headers = { Origin: 'http://127.0.0.1:4175', 'X-Nebula-Request': '1' };
async function rpc(page: Page, method: string, ...args: unknown[]) {
  const response = await page.request.post('/api/rpc', { headers, data: { method, args } });
  expect(response.ok()).toBe(true); return (await response.json()).result;
}
async function register(page: Page, name: string, role: 'artist' | 'investor', email: string) {
  await rpc(page, 'register', { name, role, email, password: 'preview123' });
}
async function login(page: Page, email: string, role = 'investor') {
  await page.goto('/login');
  await page.getByLabel('email', { exact: true }).fill(email); await page.getByLabel('password', { exact: true }).fill('preview123');
  await page.getByRole('button', { name: 'log in', exact: true }).click();
  await expect(page).toHaveURL(role === 'artist' ? /\/profile$/ : /\/explore$/);
}

test('persistent interactions across accounts, public comments, private collection and keyboard/media behavior', async ({ page, browser }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const suffix = `${info.project.name}-${Date.now()}`, artistEmail = `artist-${suffix}@example.invalid`, investorEmail = `investor-${suffix}@example.invalid`;
  await register(page, 'Interaction Artist', 'artist', artistEmail);
  const upload = await page.request.post('/api/uploads', { headers: { ...headers, 'X-Media-Kind': 'audio', 'Content-Type': 'application/octet-stream' }, data: await readFile('artifacts/nebula/public/discovery-demo/soft-signal.wav') });
  expect(upload.ok()).toBe(true);
  const result = await page.request.post('/api/publications', { headers, data: { title: `Interactive ${suffix}`, description: 'A shared publication.', mediaId: (await upload.json()).id, coverId: null, projectId: null, allowRemix: true, status: 'published' } });
  const post = await result.json(), link = `/discovery?post=post-${post.id}`;
  await rpc(page, 'logout'); await page.goto(link);
  let active = page.locator('article[data-active=true]');
  await active.getByRole('button', { name: 'Star', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('link', { name: 'log in', exact: true })).toBeVisible();
  await page.keyboard.press('Escape'); await expect(active.getByRole('button', { name: 'Star', exact: true })).toBeFocused();
  await register(page, 'Social Investor', 'investor', investorEmail); await page.goto(link);
  await expect(active.getByRole('button', { name: 'Remix is for artists' })).toBeDisabled();
  const star = active.getByRole('button', { name: 'Star', exact: true }), save = active.getByRole('button', { name: 'Save', exact: true });
  await star.click(); await expect(star).toHaveAttribute('aria-pressed', 'true'); await expect(star).toHaveText('1');
  await save.click(); await expect(save).toHaveAttribute('aria-pressed', 'true');
  await page.reload(); await expect(star).toHaveAttribute('aria-pressed', 'true'); await expect(save).toHaveAttribute('aria-pressed', 'true');
  await active.getByRole('button', { name: `Play ${post.title}`, exact: true }).click();
  await expect.poll(() => active.locator('audio').evaluate((element: HTMLAudioElement) => element.paused)).toBe(false);
  const feed = page.getByRole('region', { name: 'Discovery feed' });
  const before = await feed.evaluate(element => element.scrollTop);
  await active.getByRole('button', { name: 'Comments', exact: true }).click();
  await expect.poll(() => active.locator('audio').evaluate((element: HTMLAudioElement) => element.paused)).toBe(true);
  await page.getByLabel('Add a comment', { exact: true }).fill('<b>Love this sound</b>');
  await page.getByRole('button', { name: 'Post comment', exact: true }).click();
  await expect(page.getByRole('dialog').getByText('<b>Love this sound</b>', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog').locator('b')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('comments.png') });
  await page.keyboard.press('Escape'); await expect(active.getByRole('button', { name: 'Comments', exact: true })).toBeFocused();
  expect(await feed.evaluate(element => element.scrollTop)).toBe(before);
  for (const label of ['Star', 'Comments', 'Save', 'Send']) {
    const box = await active.getByRole('button', { name: label, exact: true }).boundingBox();
    expect(box).not.toBeNull(); expect(box!.y).toBeGreaterThanOrEqual(0); expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  }
  await active.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByLabel('Publication link')).toHaveValue(new RegExp(`post-${post.id}`)); await page.keyboard.press('Escape');
  await page.goto('/profile'); await page.getByRole('link', { name: /Saved publications Your private/ }).click();
  await expect(page.getByRole('link', { name: post.title, exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('private-saves.png') });
  const guestContext = await browser.newContext({ baseURL: 'http://127.0.0.1:4175' });
  try {
    const guest = await guestContext.newPage(); await guest.goto('/saved');
    await expect(guest.getByText('Log in to see your private collection.')).toBeVisible();
    await guest.goto(link); await guest.locator('article[data-active=true]').getByRole('button', { name: 'Comments', exact: true }).click();
    await expect(guest.getByText('<b>Love this sound</b>', { exact: true })).toBeVisible();
    await expect(guest.getByRole('button', { name: /Delete comment/ })).toHaveCount(0);
  } finally { await guestContext.close(); }
  await page.getByRole('button', { name: 'Remove from saved' }).click(); await expect(page.getByText('No saved publications yet.')).toBeVisible();
  await page.goto(link); await star.click(); await expect(star).toHaveAttribute('aria-pressed', 'false');
  await rpc(page, 'logout'); await register(page, 'Another Investor', 'investor', `other-${suffix}@example.invalid`); await page.goto(link);
  await expect(star).toHaveAttribute('aria-pressed', 'false'); await expect(save).toHaveAttribute('aria-pressed', 'false');
  await active.getByRole('button', { name: 'Comments', exact: true }).click(); await expect(page.getByRole('button', { name: /Delete comment/ })).toHaveCount(0);
  await login(page, artistEmail, 'artist'); await page.goto(link); await active.getByRole('button', { name: 'Comments', exact: true }).click();
  await page.getByRole('button', { name: 'Delete comment by Social Investor' }).click(); await expect(page.getByText('No comments yet. Start the conversation.')).toBeVisible();
  await page.keyboard.press('Escape'); await active.getByRole('button', { name: 'Remix', exact: true }).click(); await expect(page).toHaveURL(/\/studio\/remix$/); await expect(page.getByRole('heading', { name: 'Remix studio', exact: true })).toBeVisible(); await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.keyboard.press('Escape'); await page.screenshot({ path: info.outputPath('interactive-feed.png') });
  expect(errors).toEqual([]);
});

test('server-backed funding UI: USD, repeated contributions, visibility, receipt and artist history', async ({ page }, info) => {
  const suffix = `${info.project.name}-${Date.now()}`, artistEmail = `history-artist-${suffix}@example.invalid`;
  await register(page, 'Funding Artist', 'artist', artistEmail);
  const project = await rpc(page, 'createProject', { title: `Funding ${suffix}`, category: 'EP', goalAmount: 5000, status: 'funding' });
  await register(page, 'Funding Investor', 'investor', `history-investor-${suffix}@example.invalid`);
  await page.goto(`/project/${project.id}`);
  for (const amount of ['100.10', '200.20']) {
    await page.getByRole('button', { name: 'BACK THIS PROJECT', exact: true }).click();
    await page.getByLabel('CUSTOM AMOUNT (USD)').fill(amount);
    await page.getByRole('checkbox', { name: 'Show my name publicly' }).check(); await page.getByRole('checkbox', { name: 'Show my total amount publicly' }).check();
    await page.getByRole('button', { name: /^PREVIEW / }).click();
    await expect(page.getByRole('heading', { name: 'pledge preview saved' })).toBeVisible();
    await page.getByRole('link', { name: 'RETURN TO PROJECT' }).click();
  }
  const community = page.getByRole('region', { name: 'Project community' });
  await expect(community.getByText('Funding Investor', { exact: true })).toHaveCount(1); await expect(community.getByText('USD 300.30', { exact: true })).toBeVisible();
  await page.goto('/pledges'); const history = page.getByRole('article', { name: `${project.title} history` });
  await expect(history.getByText('USD 300.30', { exact: true })).toBeVisible(); await history.locator('summary').click();
  await expect(history.getByRole('link', { name: 'View receipt' })).toHaveCount(2);
  await history.getByRole('button', { name: 'Public visibility', exact: true }).click();
  await history.getByRole('checkbox', { name: 'Show my name publicly' }).uncheck(); await history.getByRole('checkbox', { name: 'Show my total amount publicly' }).uncheck();
  await history.getByRole('button', { name: 'Save visibility' }).click(); await expect(history.getByRole('status')).toContainText('Visibility updated');
  await history.getByRole('link', { name: 'View project' }).click(); await expect(community.getByText('Anonymous supporter', { exact: true })).toHaveCount(1);
  await expect(community.getByText('Amount private', { exact: true })).toBeVisible();
  await login(page, artistEmail, 'artist'); await page.getByRole('link', { name: /Contributions received Private history/ }).click();
  await expect(history.getByText('USD 300.30', { exact: true })).toBeVisible();
  await history.locator('summary').click(); await expect(history.getByText('Funding Investor', { exact: true })).toHaveCount(2);
  await page.goto('/profile'); await page.getByRole('button', { name: 'LOGOUT', exact: true }).click();
  await page.goto('/received'); await expect(page.getByText('Log in to view your private history.')).toBeVisible();
});

test('artist profile and project editor, catalog, search, symbolic support, archive and network recovery', async ({ page }, info) => {
  const suffix = `${info.project.name}-${Date.now()}`, email = `editor-${suffix}@example.invalid`, title = `Release ${suffix}`;
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await register(page, `Editor ${suffix}`, 'artist', email); await page.goto('/profile');
  await page.getByRole('button', { name: 'EDIT PROFILE', exact: true }).click();
  await page.getByRole('textbox', { name: 'genre', exact: true }).fill('Electronic');
  await page.getByRole('textbox', { name: 'bio', exact: true }).fill('A persistent artist profile.');
  await page.getByRole('button', { name: 'save profile', exact: true }).click(); await expect(page.getByText('Electronic', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'NEW PROJECT', exact: true }).click();
  await page.getByLabel('TITLE', { exact: true }).fill(title); await page.getByLabel('STATUS', { exact: true }).selectOption('funding');
  await page.getByLabel('GOAL (USD)', { exact: true }).fill('2500.25');
  await page.getByRole('button', { name: 'SAVE PROJECT', exact: true }).click(); await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await page.getByRole('button', { name: `edit ${title}`, exact: true }).click(); await page.getByLabel('PITCH (Short description)', { exact: true }).fill('Edited pitch.');
  await page.getByRole('button', { name: 'SAVE PROJECT', exact: true }).click();
  await rpc(page, 'logout'); await register(page, 'Supporting Artist', 'artist', `supporting-${suffix}@example.invalid`); await page.goto('/explore');
  await page.getByRole('button', { name: 'album', exact: true }).click(); await page.locator('a[href^="/project/"]').filter({ hasText: title }).first().click();
  await expect(page.getByText('Edited pitch.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'SUPPORT SYMBOLICALLY', exact: true }).click(); await expect(page.getByRole('button', { name: 'SUPPORTED', exact: true })).toBeVisible();
  await page.goto('/search'); await page.getByRole('searchbox').fill(`Editor ${suffix}`);
  await page.locator('a[href^="/artist/"]').filter({ hasText: `Editor ${suffix}` }).click(); await expect(page.getByText('A persistent artist profile.', { exact: true })).toBeVisible();
  await page.route('**/api/rpc', route => route.abort()); await page.goto('/explore'); await expect(page.getByRole('alert')).toContainText('Cannot reach the server');
  await page.unroute('**/api/rpc'); await page.getByRole('button', { name: 'Try again', exact: true }).click(); await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await page.route('**/api/rpc', route => route.abort()); await page.goto('/search'); await page.getByRole('searchbox').fill('Editor'); await expect(page.getByRole('alert')).toContainText('Cannot reach the server');
  await page.unroute('**/api/rpc'); await page.getByRole('button', { name: 'Try again', exact: true }).click(); await expect(page.getByRole('alert')).toHaveCount(0);
  await login(page, email, 'artist'); await page.getByRole('button', { name: `edit ${title}`, exact: true }).click();
  page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: 'DELETE', exact: true }).click(); await expect(page.getByText('NO PROJECTS YET', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
