import { expect, test, type Page } from '@playwright/test';
import { createLocalStore, STORAGE_KEY } from '../lib/local/src/store';

async function seed() {
  let raw: string | null = null;
  const store = createLocalStore({ getItem: () => raw, setItem: (_key, value) => { raw = value; } });
  await store.register({ name: 'History Artist', email: 'artist@example.invalid', password: 'preview123', role: 'artist' });
  const project = store.createProject({ title: 'USD Release', category: 'Album', currency: 'USD', goalAmount: 1000.25, status: 'funding' });
  await store.register({ name: 'History Investor', email: 'investor@example.invalid', password: 'preview123', role: 'investor' });
  return { raw: raw!, project };
}

async function login(page: Page, role: 'artist' | 'investor') {
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'email', exact: true }).fill(`${role}@example.invalid`);
  await page.getByLabel('password', { exact: true }).fill('preview123');
  await page.getByRole('button', { name: 'log in', exact: true }).click();
  await expect(page).toHaveURL(role === 'artist' ? /\/profile$/ : /\/explore$/);
}

test('backs up damaged data and recovers without developer tools', async ({ page }) => {
    const raw = '{broken json';
    await page.goto('/');
    await page.evaluate(({ key, raw }) => localStorage.setItem(key, raw), { key: STORAGE_KEY, raw });
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Recover your preview' })).toBeVisible();
    expect(await page.evaluate(key => localStorage.getItem(key), STORAGE_KEY)).toBe(raw);
    const downloaded = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download backup' }).click();
    const stream = await (await downloaded).createReadStream();
    const chunks = [];
    for await (const chunk of stream!) chunks.push(chunk);
    expect(Buffer.concat(chunks).toString()).toBe(raw);
    page.once('dialog', dialog => dialog.dismiss());
    await page.getByRole('button', { name: 'Start new USD preview' }).click();
    expect(await page.evaluate(key => localStorage.getItem(key), STORAGE_KEY)).toBe(raw);
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Start new USD preview' }).click();
    await expect(page.getByRole('heading', { name: 'nebula', exact: true })).toBeVisible();
    const fresh = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), STORAGE_KEY);
    expect(fresh).toMatchObject({ version: 3, accounts: [], projects: [], investments: [] });
});

test('keeps a USD receipt and cents after its artist removes the project', async ({ page }) => {
  const { raw, project } = await seed();
  await page.goto('/');
  await page.evaluate(({ key, raw }) => sessionStorage.setItem(key, raw), { key: STORAGE_KEY, raw });
  await login(page, 'artist');
  await page.getByRole('button', { name: 'edit USD Release', exact: true }).click();
  await expect(page.getByLabel('GOAL (USD)', { exact: true })).toHaveValue('1000.25');
  await page.getByLabel('GOAL (USD)', { exact: true }).fill('1200.75');
  await page.getByRole('button', { name: 'SAVE PROJECT', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'USD Release', exact: true })).toBeVisible();
  await login(page, 'investor');
  await page.goto(`/project/${project.id}`);
  await page.getByRole('button', { name: 'BACK THIS PROJECT', exact: true }).click();
  await page.getByLabel('CUSTOM AMOUNT (USD)').fill('200.75');
  await page.getByRole('button', { name: /^PREVIEW / }).click();
  await expect(page.getByRole('heading', { name: 'pledge preview saved' })).toBeVisible();
  await expect(page.getByText('USD 200.75', { exact: true }).first()).toBeVisible();
  const receiptUrl = page.url();
  await login(page, 'artist');
  await page.getByRole('button', { name: 'edit USD Release', exact: true }).click();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'DELETE', exact: true }).click();
  await expect(page.getByText('NO PROJECTS YET', { exact: true })).toBeVisible();
  await login(page, 'investor');
  await page.goto(receiptUrl);
  await expect(page.getByText('USD 200.75', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('This project has been removed. Your pledge and receipt are preserved.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to project' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Back to pledges' }).click();
  await expect(page.getByRole('heading', { name: 'USD Release', exact: true })).toBeVisible();
  await expect(page.getByText('USD 200.75', { exact: true }).first()).toBeVisible();
  await page.reload();
  await expect(page.getByText('USD 200.75', { exact: true }).first()).toBeVisible();
});
