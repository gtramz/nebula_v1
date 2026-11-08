import { expect, test, type Page } from '@playwright/test';
import { createLocalStore, SESSION_KEY, STORAGE_KEY } from '../lib/local/src/store';

async function signIn(page: Page, role: 'artist' | 'investor') {
  let raw: string | null = null;
  const store = createLocalStore({ getItem: () => raw, setItem: (_key, value) => { raw = value; } });
  await store.register({ role, name: 'Discovery Tester', email: `${role}@discovery.invalid`, password: 'preview123' });
  const state = JSON.parse(raw!);
  const accountId = state.currentAccountId;
  state.currentAccountId = null;
  await page.goto('/');
  await page.evaluate(({ raw, accountId, key, sessionKey }) => {
    localStorage.setItem(key, raw); sessionStorage.setItem(sessionKey, String(accountId));
  }, { raw: JSON.stringify(state), accountId, key: STORAGE_KEY, sessionKey: SESSION_KEY });
  await page.goto('/discovery');
}
const activePost = (page: Page) => page.locator('.discovery-post[data-active="true"]');
async function goToPost(page: Page, index: number) {
  await page.getByRole('region', { name: 'Discovery feed' }).evaluate((element, index) => {
    element.scrollTo({ top: element.clientHeight * index, behavior: 'instant' });
  }, index);
  await expect(activePost(page)).toHaveAttribute('data-index', String(index));
}
const storedData = (page: Page) => page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } }));

test('visitor discovers samples, project offers and account prompts without changing stored data', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/discovery');
  const before = await storedData(page);
  if (page.viewportSize()!.width < 768) {
    await expect(page.getByRole('heading', { name: /discovery/ })).toHaveCount(0);
    const feed = await page.getByRole('region', { name: 'Discovery feed', exact: true }).boundingBox();
    const bar = await page.getByTestId('app-navigation').boundingBox();
    expect(feed!.y).toBeCloseTo(0, 0);
    expect(feed!.y + feed!.height).toBeCloseTo(bar!.y, 0);
  } else await expect(page.getByRole('heading', { name: /discovery/ })).toBeVisible();
  await expect(page.getByRole('link', { name: 'discovery', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(activePost(page)).toHaveAttribute('data-index', '0');
  await activePost(page).getByRole('button', { name: 'Star', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('link', { name: 'log in' })).toBeVisible();
  await expect(dialog.getByRole('link', { name: 'sign up' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(activePost(page).getByRole('button', { name: 'Star', exact: true })).toBeFocused();
  await activePost(page).getByRole('button', { name: /view project/ }).click();
  await expect(dialog.getByRole('heading', { name: 'After Hours EP' })).toBeVisible();
  await expect(dialog.getByText('15% royalty split offered')).toBeVisible();
  await expect(dialog.getByText('USD 400.00 fixed fee')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Contact artist · soon' }).first()).toBeDisabled();
  await page.screenshot({ path: info.outputPath('discovery-project.png') });
  await page.keyboard.press('Escape');
  await expect(activePost(page).getByRole('button', { name: /view project/ })).toBeFocused();
  await activePost(page).getByRole('button', { name: 'Comments', exact: true }).click();
  await expect(dialog.getByText('Log in to leave a comment.')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.screenshot({ path: info.outputPath('discovery-feed.png') });
  const actions = await activePost(page).locator('.discovery-actions').boundingBox();
  const navigation = await page.getByTestId('app-navigation').boundingBox();
  expect(actions!.y + actions!.height).toBeLessThanOrEqual(page.viewportSize()!.width < 768 ? navigation!.y : page.viewportSize()!.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await storedData(page)).toEqual(before);
  expect(errors).toEqual([]);
  await page.getByRole('link', { name: 'explore', exact: true }).first().click();
  await expect(page).toHaveURL(/\/explore$/);
});

test('artist reactions and comments are temporary; demo remix stays disabled', async ({ page }, info) => {
  await signIn(page, 'artist');
  const before = await storedData(page);
  const star = activePost(page).getByRole('button', { name: 'Star', exact: true });
  await star.click(); await expect(star).toHaveAttribute('aria-pressed', 'true'); await expect(star).toContainText('129');
  await star.click(); await expect(star).toHaveAttribute('aria-pressed', 'false'); await expect(star).toContainText('128');
  await star.click();
  const save = activePost(page).getByRole('button', { name: 'Save', exact: true });
  await save.click(); await expect(save).toHaveAttribute('aria-pressed', 'true');
  await save.click(); await expect(save).toHaveAttribute('aria-pressed', 'false'); await save.click();
  await activePost(page).getByRole('button', { name: 'Comments', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Post comment' })).toBeDisabled();
  await dialog.getByLabel('Add a comment').fill('   ');
  await expect(dialog.getByRole('button', { name: 'Post comment' })).toBeDisabled();
  await dialog.getByLabel('Add a comment').fill('A new idea for this verse.');
  await dialog.getByRole('button', { name: 'Post comment' }).click();
  await expect(dialog.getByText('A new idea for this verse.')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(activePost(page).getByRole('button', { name: 'Comments', exact: true })).toContainText('2');
  await expect(activePost(page).getByRole('button', { name: 'Remix is unavailable for demo publications', exact: true })).toBeDisabled();
  await expect(dialog).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('discovery-artist.png') });
  expect(await storedData(page)).toEqual(before);
  await page.reload();
  await expect(star).toHaveAttribute('aria-pressed', 'false');
  await expect(save).toHaveAttribute('aria-pressed', 'false');
  await activePost(page).getByRole('button', { name: 'Comments', exact: true }).click();
  await expect(dialog.getByText('A new idea for this verse.')).toHaveCount(0);
});

test('investor can react and share but cannot remix; shared links open the correct sample', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await signIn(page, 'investor');
  await expect(activePost(page).getByRole('button', { name: 'Remix is for artists' })).toBeDisabled();
  await activePost(page).getByRole('button', { name: 'Star', exact: true }).click();
  await expect(activePost(page).getByRole('button', { name: 'Star', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await goToPost(page, 2);
  const scrollBefore = await page.locator('.discovery-feed').evaluate(element => element.scrollTop);
  await activePost(page).getByRole('button', { name: 'Send', exact: true }).click();
  const link = await page.getByLabel('Publication link').inputValue();
  expect(link).toContain('/discovery?post=after-hours-rework');
  await page.getByRole('button', { name: 'Copy link' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Link copied.' })).toBeVisible();
  await page.keyboard.press('Escape');
  expect(await page.locator('.discovery-feed').evaluate(element => element.scrollTop)).toBe(scrollBefore);
  await page.goto(link);
  await expect(activePost(page)).toHaveAttribute('data-index', '2');
  await activePost(page).getByRole('button', { name: /Remix of after hours/ }).click();
  await expect(activePost(page)).toHaveAttribute('data-index', '0');
});

test('playback is exclusive, pauses for panels, and audio waits for user input', async ({ page }) => {
  await page.goto('/discovery');
  const video = page.locator('video');
  await expect.poll(() => video.evaluate(element => element.readyState)).toBeGreaterThanOrEqual(2);
  await expect.poll(() => video.evaluate(element => element.muted)).toBe(true);
  if (await video.evaluate(element => element.paused)) await activePost(page).getByRole('button', { name: 'Play after hours', exact: true }).click();
  await expect.poll(() => video.evaluate(element => element.paused)).toBe(false);
  await activePost(page).getByRole('button', { name: /view project/ }).click();
  await expect.poll(() => video.evaluate(element => element.paused)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(activePost(page).getByRole('button', { name: 'Play after hours', exact: true })).toBeVisible();
  await goToPost(page, 1);
  const audio = activePost(page).locator('audio');
  await expect(activePost(page).getByRole('button', { name: /Remix not permitted/ })).toBeDisabled();
  await expect(activePost(page).getByRole('button', { name: /view project/ })).toHaveCount(0);
  expect(await audio.evaluate(element => element.paused)).toBe(true);
  await activePost(page).getByRole('button', { name: 'Play soft signal', exact: true }).click();
  await expect.poll(() => audio.evaluate(element => element.currentTime)).toBeGreaterThan(0);
  expect(await video.evaluate(element => element.paused)).toBe(true);
  await goToPost(page, 2);
  expect(await page.locator('audio').first().evaluate(element => element.paused)).toBe(true);
  await expect(activePost(page).getByRole('button', { name: 'Play a different orbit', exact: true })).toBeVisible();
});

test('keyboard paging, reduced motion, and clipboard failure stay usable', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await signIn(page, 'artist');
  await expect(activePost(page).getByRole('button', { name: 'Play after hours', exact: true })).toBeVisible();
  const feed = page.getByRole('region', { name: 'Discovery feed' });
  await feed.focus(); await page.keyboard.press('ArrowDown');
  await expect(activePost(page)).toHaveAttribute('data-index', '1');
  await page.keyboard.press('ArrowUp');
  await expect(activePost(page)).toHaveAttribute('data-index', '0');
  await page.evaluate(() => { Object.defineProperty(navigator.clipboard, 'writeText', { value: () => Promise.reject(new Error('Unavailable')) }); });
  await activePost(page).getByRole('button', { name: 'Send', exact: true }).click();
  await page.getByRole('button', { name: 'Copy link' }).click();
  await expect(page.getByText('Copy is unavailable here. Select and copy the link above.')).toBeVisible();
  await page.getByRole('button', { name: 'Close panel' }).focus();
  await page.keyboard.press('Tab');
  expect(await page.getByRole('dialog').evaluate(element => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(activePost(page).getByRole('button', { name: 'Send', exact: true })).toBeFocused();
});
