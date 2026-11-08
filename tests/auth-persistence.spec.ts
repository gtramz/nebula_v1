import { clickProfileLogout } from '../tests-support/profile-actions';
import { expect, test, type Page } from '@playwright/test';
import { createLocalStore, STORAGE_KEY } from '../lib/local/src/store';

async function register(page: Page, role: 'artist' | 'investor', email: string) {
  await page.goto('/register');
  await page.getByRole('button', { name: new RegExp(`^${role} `) }).click();
  await page.getByRole('textbox', { name: 'full name' }).fill(role === 'artist' ? 'Saved Artist' : 'Saved Investor');
  await page.getByRole('button', { name: 'continue', exact: true }).click();
  await page.getByRole('textbox', { name: 'email address' }).fill(email);
  await page.getByRole('button', { name: 'continue', exact: true }).click();
  await page.getByLabel('password', { exact: true }).fill('preview123');
  await page.getByLabel('confirm password', { exact: true }).fill('preview123');
  await page.getByRole('button', { name: 'create account', exact: true }).click();
  if (role === 'artist') { await expect(page).toHaveURL(/\/onboarding$/); await page.getByRole('button', { name: 'Skip for now', exact: true }).click(); }
  await expect(page).toHaveURL(role === 'artist' ? /\/profile$/ : /\/explore$/);
}
async function login(page: Page, email: string, role: 'artist' | 'investor') {
  await page.goto('/login');
  await expect(page.getByRole('button', { name: /^(automatic|artist|investor)$/ })).toHaveCount(0);
  await page.getByRole('textbox', { name: 'email', exact: true }).fill(email);
  await page.getByLabel('password', { exact: true }).fill('preview123');
  await page.getByRole('button', { name: 'log in', exact: true }).click();
  await expect(page).toHaveURL(role === 'artist' ? /\/profile$/ : /\/explore$/);
}

test('real registration survives closed tabs, browser-session restoration, logout and clearing demo data', async ({ context, page, browser }, info) => {
  await register(page, 'artist', 'saved@example.invalid');
  await page.close();
  const reopened = await context.newPage();
  await login(reopened, 'saved@example.invalid', 'artist');
  await reopened.reload();
  await expect(reopened.getByText('saved@example.invalid', { exact: true })).toBeVisible();
  reopened.once('dialog', d => d.accept());
  await reopened.getByRole('button', { name: 'More', exact: true }).filter({visible:true}).click();
  await reopened.getByRole('menuitem', { name: 'clear demo data', exact: true }).click();
  await expect(reopened).toHaveURL(/\/$/);
  await reopened.goto('/profile');
  await clickProfileLogout(reopened);
  await login(reopened, 'saved@example.invalid', 'artist');
  await expect(reopened.getByRole('region', { name: 'Account activity' })).toContainText('Account created');
  await reopened.screenshot({ path: info.outputPath('saved-account.png'), fullPage: true });
  const restored = await browser.newContext({ storageState: await context.storageState(), baseURL: 'http://127.0.0.1:4173' });
  try {
    const newSession = await restored.newPage();
    await newSession.goto('/profile');
    await expect(newSession.getByRole('link', { name: 'log in', exact: true }).first()).toBeVisible();
    await login(newSession, 'saved@example.invalid', 'artist');
  } finally { await restored.close(); }
});

test('concurrent registrations preserve both accounts and activity synchronizes without sharing sessions', async ({ context, page }) => {
  const other = await context.newPage();
  await Promise.all([register(page, 'artist', 'artist@example.invalid'), register(other, 'investor', 'investor@example.invalid')]);
  const accounts = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).accounts.map((a: { role: string }) => a.role), STORAGE_KEY);
  expect(accounts.sort()).toEqual(['artist', 'investor']);
  await expect(page.getByText('artist@example.invalid', { exact: true })).toBeVisible();
  await other.goto('/profile');
  await expect(other.getByText('investor@example.invalid', { exact: true })).toBeVisible();
  await clickProfileLogout(other);
  await page.reload();
  await expect(page.getByText('artist@example.invalid', { exact: true })).toBeVisible();
  await login(other, 'artist@example.invalid', 'artist');
  await expect(page.getByRole('region', { name: 'Account activity' })).toContainText('Successful login');
});

test('legacy identity migrates to durable storage and can log in from another tab', async ({ page, context }) => {
  let raw: string | null = null;
  const store = createLocalStore({ getItem: () => raw, setItem: (_key, value) => { raw = value; } });
  await store.register({ name: 'Legacy Artist', email: 'legacy@example.invalid', password: 'preview123', role: 'artist' });
  const old = { ...JSON.parse(raw!), version: 2, projects: [{ currency: 'EUR', title: 'Discarded demo' }] };
  await page.goto('/');
  await page.evaluate(value => sessionStorage.setItem('nebula-v1-shell', value), JSON.stringify(old));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'nebula', exact: true })).toBeVisible();
  const other = await context.newPage();
  await login(other, 'legacy@example.invalid', 'artist');
  await expect(other.getByText('NO PROJECTS YET', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('nebula-v1-shell'))).toBe(JSON.stringify(old));
  const persisted = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), STORAGE_KEY);
  expect(persisted.accounts).toHaveLength(1);
  expect(persisted.projects).toEqual([]);
  await page.reload();
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).accounts.length, STORAGE_KEY)).toBe(1);
});
