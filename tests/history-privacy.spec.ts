import { clickProfileLogout } from '../tests-support/profile-actions';
import { expect, test, type Page } from '@playwright/test';
import { createLocalStore, STORAGE_KEY } from '../lib/local/src/store';

async function fixture() {
  let raw: string | null = null;
  const store = createLocalStore({ getItem: () => raw, setItem: (_key, value) => { raw = value; } });
  await store.register({ name: 'Private Artist', email: 'artist@example.invalid', password: 'preview123', role: 'artist' });
  const project = store.createProject({ title: 'One Project', category: 'Album', goalAmount: 5000, status: 'funding' });
  await store.register({ name: 'Visible Investor', email: 'investor@example.invalid', password: 'preview123', role: 'investor' });
  return { raw: raw!, project };
}

async function login(page: Page, role: 'artist' | 'investor') {
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'email', exact: true }).fill(`${role}@example.invalid`);
  await page.getByLabel('password', { exact: true }).fill('preview123');
  await page.getByRole('button', { name: 'log in', exact: true }).click();
  await expect(page).toHaveURL(role === 'artist' ? /\/profile$/ : /\/explore$/);
}

test('combines public contributions and independently hides name and total from history', async ({ page }, info) => {
  const { raw, project } = await fixture();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.evaluate(({ key, raw }) => sessionStorage.setItem(key, raw), { key: STORAGE_KEY, raw });
  await page.goto(`/project/${project.id}`);
  for (const [index, amount] of ['100.10', '200.20'].entries()) {
    await page.getByRole('button', { name: 'BACK THIS PROJECT', exact: true }).click();
    await page.getByLabel('CUSTOM AMOUNT (USD)').fill(amount);
    const name = page.getByRole('checkbox', { name: 'Show my name publicly' });
    const total = page.getByRole('checkbox', { name: 'Show my total amount publicly' });
    if (index === 0) {
      await expect(name).not.toBeChecked();
      await expect(total).not.toBeChecked();
      await name.check();
      await total.check();
    } else {
      await expect(name).toBeChecked();
      await expect(total).toBeChecked();
    }
    await page.getByRole('button', { name: /^PREVIEW / }).click();
    await expect(page.getByRole('heading', { name: 'pledge preview saved' })).toBeVisible();
    await page.getByRole('link', { name: 'Back to project' }).click();
  }
  const community = page.getByRole('region', { name: 'Project community' });
  await expect(community.getByText('Visible Investor', { exact: true })).toHaveCount(1);
  await expect(community.getByText('USD 300.30', { exact: true })).toBeVisible();
  await page.goto('/pledges');
  const history = page.getByRole('article', { name: 'One Project history' });
  await expect(history.getByText('USD 300.30', { exact: true })).toBeVisible();
  await history.locator('summary').click();
  await expect(history.getByRole('link', { name: 'View receipt' })).toHaveCount(2);
  await page.screenshot({ path: info.outputPath('investor-history.png'), fullPage: true });
  for (const [showName, showAmount] of [[false, true], [true, false], [false, false]]) {
    await history.getByRole('button', { name: 'Public visibility', exact: true }).click();
    await history.getByRole('checkbox', { name: 'Show my name publicly' }).setChecked(showName);
    await history.getByRole('checkbox', { name: 'Show my total amount publicly' }).setChecked(showAmount);
    await history.getByRole('button', { name: 'Save visibility' }).click();
    await expect(history.getByRole('status')).toContainText('Visibility updated');
    await history.getByRole('link', { name: 'View project' }).click();
    await expect(community.getByText(showName ? 'Visible Investor' : 'Anonymous supporter', { exact: true })).toHaveCount(1);
    await expect(community.getByText(showAmount ? 'USD 300.30' : 'Amount private', { exact: true })).toBeVisible();
    if (!showName) await expect(community.getByText('Visible Investor', { exact: true })).toHaveCount(0);
    if (!showAmount) await expect(community.getByText('USD 300.30', { exact: true })).toHaveCount(0);
    await page.goto('/pledges');
  }
  await page.reload();
  await expect(history.getByText('Public name: anonymous · Public amount: hidden')).toBeVisible();
  await login(page, 'artist');
  await page.getByRole('link', { name: /Contributions received Private history/ }).click();
  await expect(page.getByRole('heading', { name: 'contributions received' })).toBeVisible();
  await expect(history.getByText('USD 300.30', { exact: true })).toBeVisible();
  await history.locator('summary').click();
  await expect(history.getByText('Visible Investor', { exact: true })).toHaveCount(2);
  await expect(history.getByRole('button', { name: 'Public visibility', exact: true })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('artist-history.png'), fullPage: true });
  await page.getByRole('combobox', { name: 'Project', exact: true }).selectOption(String(project.id));
  await page.getByRole('combobox', { name: 'Project availability', exact: true }).selectOption('current');
  await page.getByLabel('From date', { exact: true }).fill('2000-01-01');
  await page.getByLabel('To date', { exact: true }).fill('2100-12-31');
  for (const width of [390,578,767,768,1024,1440]) {
    await page.setViewportSize({width,height:900});
    await expect(page.getByRole('combobox', { name: 'Project', exact: true })).toHaveValue(String(project.id));
    await expect(page.getByRole('combobox', { name: 'Project availability', exact: true })).toHaveValue('current');
    await expect(page.getByLabel('From date', { exact: true })).toHaveValue('2000-01-01');
    await expect(page.getByLabel('To date', { exact: true })).toHaveValue('2100-12-31');
    await expect(history.getByText('USD 300.30', { exact: true })).toBeVisible();
    await expect(page.getByRole('navigation',{name:'Primary navigation'}).getByRole('link',{name:width<768?'profile':'received',exact:true})).toHaveAttribute('aria-current','page');
  }
  await page.setViewportSize({width:390,height:900});
  await page.getByRole('navigation',{name:'Primary navigation'}).getByRole('link',{name:'profile',exact:true}).click();
  await expect(page).toHaveURL(/\/profile$/);
  const receivedCard=page.getByRole('link',{name:/Contributions received Private history/});await expect(receivedCard).toHaveCount(1);await receivedCard.click();
  await expect(page).toHaveURL(/\/received$/);await expect(history.getByText('USD 300.30',{exact:true})).toBeVisible();
  await page.getByLabel('To date', { exact: true }).fill('2000-01-01');
  await expect(page.getByText('No contributions match these filters.')).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(history).toBeVisible();
  await page.goto('/profile');
  await clickProfileLogout(page);
  await expect(page).toHaveURL(/\/$/);
  await page.goto('/received');
  await expect(page.getByText('Log in to view your private history.')).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(0);
  await page.goto(`/project/${project.id}`);
  await expect(community.getByText('Anonymous supporter', { exact: true })).toHaveCount(1);
  await expect(community.getByText('Amount private', { exact: true })).toBeVisible();
  await community.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('public-community.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('keeps an unreadable obsolete demo for recovery', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => sessionStorage.setItem('nebula-v1-shell', '{obsolete demo}'));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Your saved accounts need attention' })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('nebula-v1-shell'))).toBe('{obsolete demo}');
});

test('limits the public list and keeps repeated supporters consolidated when showing more', async ({ page }) => {
  let raw: string | null = null;
  const store = createLocalStore({ getItem: () => raw, setItem: (_key, value) => { raw = value; } });
  await store.register({ name: 'Artist', email: 'artist@example.invalid', password: 'preview123', role: 'artist' });
  const project = store.createProject({ title: 'Many supporters', category: 'Album', goalAmount: 5000, status: 'funding' });
  for (let i = 1; i <= 12; i++) {
    await store.register({ name: `Supporter ${i}`, email: `investor${i}@example.invalid`, password: 'preview123', role: 'investor' });
    store.createInvestment({ projectId: project.id, amount: 100, publicVisibility: { showName: true, showAmount: true } });
    store.createInvestment({ projectId: project.id, amount: 150 });
  }
  store.logout();
  await page.goto('/');
  await page.evaluate(({ key, raw }) => sessionStorage.setItem(key, raw!), { key: STORAGE_KEY, raw });
  await page.goto(`/project/${project.id}`);
  const community = page.getByRole('region', { name: 'Project community' });
  await expect(community.getByText(/^Supporter \d+$/)).toHaveCount(10);
  await expect(community.getByText('USD 250.00', { exact: true })).toHaveCount(10);
  await community.getByRole('button', { name: 'Show more supporters' }).click();
  await expect(community.getByText(/^Supporter \d+$/)).toHaveCount(12);
  await expect(community.getByText('Supporter 1', { exact: true })).toHaveCount(1);
  await expect(community.getByRole('button', { name: 'Show more supporters' })).toHaveCount(0);
});
