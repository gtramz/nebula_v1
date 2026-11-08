import { clickProfileLogout } from '../tests-support/profile-actions';
import { test, expect, type Page } from '@playwright/test';
const headers = { Origin: 'http://127.0.0.1:4175', 'X-Nebula-Request': '1' };
async function rpc(page: Page, method: string, ...args: unknown[]) {
  const response = await page.request.post('/api/rpc', { headers, data: { method, args } });
  expect(response.ok(), await response.text()).toBeTruthy(); return (await response.json()).result;
}
const homeInput = (page: Page) => page.getByRole('combobox', { name: 'Search Home opportunities' });
const card = (page: Page, title: string) => page.getByRole('article', { name: title, exact: true });
async function edit(page: Page) {
  await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name: 'profile', exact: true }).click();
  await page.getByRole('button', { name: 'EDIT PROFILE', exact: true }).click();
}
async function save(page: Page) {
  await page.getByRole('button', { name: 'save profile', exact: true }).click();
  await expect(page.getByRole('button', { name: 'EDIT PROFILE', exact: true })).toBeVisible();
}
async function navigate(page: Page, label: string) {
  await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name: label.toLowerCase(), exact: true }).click();
}

test('saved structured genres update Home facets, autocomplete, retained history and Global Search across edits and reloads', async ({ page }, info) => {
  test.setTimeout(90000);
  const name = `Neutral ${crypto.randomUUID().slice(0, 8)}`;
  const user = await rpc(page, 'register', { name, email: `${crypto.randomUUID()}@example.invalid`, password: 'preview123', role: 'artist' });
  await rpc(page, 'updateArtist', { name, genre: 'Reggae' });
  await rpc(page, 'updateMyArtistPreferences', { discovery: { genreIds: ['classical'] } });
  const project = await rpc(page, 'createProject', { title: `Neutral work ${user.artistId}`, category: 'EP', status: 'funding', goalAmount: 1000 });
  await page.goto('/profile');
  await page.getByRole('button', { name: 'EDIT PROFILE', exact: true }).click();
  await page.getByRole('button', { name: 'Clear musical genres', exact: true }).click();
  await page.getByRole('button', { name: 'Choose musical genres', exact: true }).click();
  const genres = page.getByRole('combobox', { name: 'Search musical genres' });
  for (const term of ['DnB', 'Electrónica']) { await genres.fill(term); await genres.press('Home'); await genres.press('Enter'); }
  await genres.press('Escape'); await save(page);
  // SPA navigation preserves the query client, exercising profile-save invalidation.
  await navigate(page, 'Home');
  for (const term of ['DnB', 'Electrónica']) {
    await homeInput(page).fill(term); await expect(card(page, project.title)).toBeVisible();
  }
  await page.getByRole('option').filter({ hasText: 'Artist genre' }).filter({ hasText: 'Electronic' }).click();
  await expect(page.getByRole('button', { name: 'Remove Artist genre: Electronic', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^Filters/ }).click();
  const panel = page.getByRole('dialog', { name: 'Filter projects' });
  await expect(panel.getByRole('checkbox', { name: 'Electronic', exact: true })).toBeChecked();
  await panel.getByRole('checkbox', { name: 'Drum and Bass', exact: true }).check();
  await panel.getByRole('checkbox', { name: 'EP', exact: true }).check();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('genre-filters.png'), animations: 'disabled' });
  await panel.getByRole('button', { name: /^Apply filters/ }).click();
  await expect(card(page, project.title)).toHaveCount(1);
  await card(page, project.title).getByRole('link', { name: 'View project', exact: true }).click();
  await page.getByRole('link', { name: 'Back to Home', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove Artist genre: Electronic', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Remove Artist genre: Drum and Bass', exact: true }).click();
  await navigate(page, 'Search');
  for (const query of ['DnB', 'Electrónica']) {
    await page.getByRole('searchbox').fill(query);
    await expect(page.locator('#search-results').getByRole('link').filter({ hasText: name })).toBeVisible();
  }
  await expect(page.locator('#search-results')).toContainText('Drum and Bass, Electronic');
  await edit(page); await page.getByRole('button', { name: 'Remove Electronic', exact: true }).click(); await save(page);
  await navigate(page, 'Search');
  await expect(page.getByRole('searchbox')).toHaveValue('Electrónica');
  await expect(page.locator('#search-results').getByRole('link').filter({ hasText: name })).toHaveCount(0);
  await expect(page.getByRole('status')).not.toHaveText('Searching…');
  await page.getByRole('searchbox').fill('DnB');
  await expect(page.locator('#search-results').getByRole('link').filter({ hasText: name })).toBeVisible();
  await navigate(page, 'Home');
  await expect(page.getByRole('button', { name: 'Remove Artist genre: Electronic', exact: true })).toBeVisible();
  await expect(card(page, project.title)).toHaveCount(0);
  await page.getByRole('button', { name: 'Remove Artist genre: Electronic', exact: true }).click();
  await homeInput(page).fill('DnB'); await expect(card(page, project.title)).toBeVisible();
  await homeInput(page).press('Enter');
  await page.screenshot({ path: info.outputPath('genre-home.png'), animations: 'disabled' });
  await page.reload(); await homeInput(page).click();
  await expect(page.getByRole('option', { name: 'DnB · Project type: EP', exact: true })).toBeVisible();
  await homeInput(page).press('Escape');
  await edit(page); await page.getByRole('button', { name: 'Clear musical genres', exact: true }).click(); await save(page);
  await page.reload();
  const identity = (await rpc(page, 'getArtist', user.artistId)).artist;
  expect(identity).toMatchObject({ genreIds: [], genreSource: 'structured', genre: 'Reggae' });
  expect((await rpc(page, 'getMyArtistPreferences')).discovery.genreIds).toEqual(['classical']);
  await navigate(page, 'Search');
  for (const query of ['DnB', 'Reggae']) {
    await page.getByRole('searchbox').fill(query);
    await expect(page.getByRole('status')).toContainText(query);
    await expect(page.locator('#search-results').getByRole('link').filter({ hasText: name })).toHaveCount(0);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await navigate(page, 'Profile'); await clickProfileLogout(page);
  await page.goto('/explore'); await homeInput(page).click();
  await expect(page.getByRole('option', { name: 'DnB · Project type: EP', exact: true })).toHaveCount(0);
});
