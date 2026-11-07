import { test, expect, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { createLocalStore, STORAGE_KEY } from '../lib/local/src/store';

async function signup(page: Page, email: string) {
  await page.goto('/register');
  await page.getByRole('button', { name: /^artist / }).click();
  await page.getByRole('textbox', { name: 'full name' }).fill('Shared Artist');
  await page.getByRole('button', { name: 'continue', exact: true }).click();
  await page.getByRole('textbox', { name: 'email address' }).fill(email);
  await page.getByRole('button', { name: 'continue', exact: true }).click();
  await page.getByLabel('password', { exact: true }).fill('preview123');
  await page.getByLabel('confirm password', { exact: true }).fill('preview123');
  await page.getByRole('button', { name: 'create account', exact: true }).click();
  await expect(page).toHaveURL(/\/profile$/);
}

test('artist publishes, edits and withdraws real media; another browser sees only public posts', async ({ page, browser }, info) => {
  const email = `shared-${info.project.name}-${Date.now()}@example.invalid`;
  await signup(page, email);
  await page.getByRole('link', { name: /Your publications Upload/ }).click();
  await page.getByRole('link', { name: 'New publication' }).click();
  await page.getByLabel('Audio or video').setInputFiles(resolve('artifacts/nebula/public/discovery-demo/soft-signal.wav'));
  await page.getByLabel('Title', { exact: true }).fill('My first sound');
  await page.getByLabel('Description', { exact: true }).fill('A real uploaded audio publication.');
  await page.getByLabel('Allow other artists to remix this publication').check();
  await expect(page.getByRole('button', { name: 'Publish', exact: true })).toBeEnabled();
  await page.getByRole('heading', { name: 'Share your sound' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('publication-editor.png') });
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page).toHaveURL(/\/studio$/);
  const entry = page.getByRole('article', { name: 'My first sound publication' });
  await expect(entry).toContainText('draft');
  const otherContext = await browser.newContext({ baseURL: 'http://127.0.0.1:4175' });
  try {
    const other = await otherContext.newPage();
    await other.goto('/discovery');
    await expect(other.getByRole('heading', { name: 'My first sound', exact: true })).toHaveCount(0);
    await entry.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(entry).toContainText('published');
    const link = await entry.getByRole('link', { name: 'View in Discovery' }).getAttribute('href');
    await other.goto(link!);
    await expect(other.getByRole('heading', { name: 'My first sound', exact: true })).toBeVisible();
    await other.getByRole('button', { name: 'Play My first sound', exact: true }).click();
    await expect.poll(() => other.locator('article[data-active=true] audio').evaluate((element: HTMLAudioElement) => element.currentTime)).toBeGreaterThan(0);
    await other.screenshot({ path: info.outputPath('published-discovery.png') });
    await entry.getByRole('link', { name: 'Edit publication' }).click();
    await page.getByLabel('Title', { exact: true }).fill('An edited sound');
    await page.getByLabel('Allow other artists to remix this publication').uncheck();
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(page).toHaveURL(/\/studio$/);
    await other.reload();
    await expect(other.getByRole('heading', { name: 'An edited sound' })).toBeVisible();
    await expect(other.locator('article[data-active=true]').getByRole('button', { name: 'Remix not permitted by author' })).toBeDisabled();
    await page.getByRole('article', { name: 'An edited sound publication' }).getByRole('button', { name: 'Withdraw' }).click();
    await expect(page.getByRole('article', { name: 'An edited sound publication' })).toContainText('withdrawn');
    await other.reload();
    await expect(other.getByRole('alert')).toContainText('Publication not found');
    await other.goto('/login');
    await other.getByLabel('email', { exact: true }).fill(email); await other.getByLabel('password', { exact: true }).fill('preview123');
    await other.getByRole('button', { name: 'log in', exact: true }).click();
    await expect(other).toHaveURL(/\/profile$/);
    await other.goto('/studio');
    await expect(other.getByRole('article', { name: 'An edited sound publication' })).toContainText('withdrawn');
    expect(await page.evaluate(() => localStorage.getItem('nebula-usd-preview'))).toBeNull();
  } finally { await otherContext.close(); }
});

test('password-verified transfer keeps browser originals and excludes old projects', async ({ page }, info) => {
  const email = `legacy-${info.project.name}-${Date.now()}@example.invalid`;
  let raw: string | null = null;
  const local = createLocalStore({ getItem: () => raw, setItem: (_key, value) => { raw = value; } });
  await local.register({ email, password: 'preview123', role: 'artist', name: 'Transferred Artist' });
  local.createProject({ title: 'Old demo project', category: 'EP', goalAmount: 1000 });
  await page.goto('/login');
  await page.evaluate(({ key, raw }) => localStorage.setItem(key, raw), { key: STORAGE_KEY, raw: raw! });
  await page.getByLabel('email', { exact: true }).fill(email); await page.getByLabel('password', { exact: true }).fill('wrong-password');
  await page.getByRole('button', { name: 'Transfer my browser-only account' }).click();
  await expect(page.getByRole('alert')).toContainText('Incorrect password');
  await page.getByLabel('password', { exact: true }).fill('preview123');
  await page.getByRole('button', { name: 'Transfer my browser-only account' }).click();
  await expect(page).toHaveURL(/\/profile$/);
  await expect(page.getByRole('heading', { name: 'Transferred Artist' })).toBeVisible();
  await expect(page.getByText('NO PROJECTS YET', { exact: true })).toBeVisible();
  expect(await page.evaluate(key => localStorage.getItem(key), STORAGE_KEY)).toBe(raw);
});

test('video, cover and a linked project survive publishing and editing', async ({ page }, info) => {
  await signup(page, `video-${info.project.name}-${Date.now()}@example.invalid`);
  const result = await page.request.post('/api/rpc', { headers: { Origin: 'http://127.0.0.1:4175', 'X-Nebula-Request': '1' }, data: { method: 'createProject', args: [{ title: 'Shared EP', category: 'EP', goalAmount: 2500, status: 'published', story: 'A project connected to a real publication.' }] } });
  expect(result.ok()).toBe(true);
  const project = (await result.json()).result;
  await page.goto('/publish');
  await page.getByLabel('Audio or video').setInputFiles(resolve('artifacts/nebula/public/discovery-demo/after-hours.webm'));
  await page.getByLabel('Title', { exact: true }).fill('Video and project');
  await page.getByLabel('Cover image (optional)').setInputFiles(resolve('artifacts/nebula/src/assets/antiq-logo.png'));
  await expect(page.getByAltText('Publication cover preview')).toBeVisible();
  await page.getByLabel('Link a project (optional)').selectOption(String(project.id));
  await expect(page.getByRole('button', { name: 'Publish', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page).toHaveURL(/\/studio$/);
  const post = page.getByRole('article', { name: 'Video and project publication' });
  await post.getByRole('link', { name: 'View in Discovery' }).click();
  const active = page.locator('article[data-active=true]');
  await expect(active.getByRole('heading', { name: 'Video and project' })).toBeVisible();
  await expect.poll(() => active.locator('video').evaluate((element: HTMLVideoElement) => element.readyState)).toBeGreaterThanOrEqual(2);
  await active.getByRole('button', { name: /view project/ }).click();
  await expect(page.getByRole('dialog').getByText('USD 2,500.00', { exact: false })).toBeVisible();
  await page.getByRole('link', { name: 'Open full project' }).click();
  await expect(page).toHaveURL(new RegExp(`/project/${project.id}$`));
  await page.goto('/studio');
  await post.getByRole('link', { name: 'Edit publication' }).click();
  await expect(page.getByAltText('Publication cover preview')).toBeVisible();
  await expect(page.getByLabel('Link a project (optional)')).toHaveValue(String(project.id));
});
