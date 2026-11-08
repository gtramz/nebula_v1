import { clickProfileLogout } from '../tests-support/profile-actions';
import { test, expect, type Page } from '@playwright/test';

const headers = { Origin: 'http://127.0.0.1:4175', 'X-Nebula-Request': '1' };
async function rpc(page: Page, method: string, ...args: unknown[]) {
  const response = await page.request.post('/api/rpc', { headers, data: { method, args } });
  expect(response.ok()).toBeTruthy(); return (await response.json()).result;
}

test('existing artist editor preserves professional identity and preferences across logout and account changes', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const email = `identity-${crypto.randomUUID()}@example.invalid`;
  const user = await rpc(page, 'register', { name: 'Identity Browser Artist', email, password: 'preview123', role: 'artist' });
  await rpc(page, 'updateArtist', { name: user.name, genre: 'Legacy genre', creativeRoles: ['producer','vocalist'], genres: ['Jazz','Soul'], collaborationAvailability: 'open' });
  await rpc(page, 'updateMyArtistPreferences', { discovery: { genres: ['PRIVATE_BROWSER_MARKER'], projectTypes: ['ep'] } });
  await page.goto('/profile');
  await page.getByRole('button', { name: 'EDIT PROFILE', exact: true }).click();
  await page.getByLabel('artist name', { exact: true }).fill('Identity Browser Edited');
  await expect(page.getByLabel('genre', { exact: true })).toHaveCount(0);
  await page.getByLabel('bio', { exact: true }).fill('Existing editor still works.');
  await page.getByRole('button', { name: 'save profile', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Identity Browser Edited', exact: true })).toBeVisible();
  const profile = (await rpc(page, 'getArtist', user.artistId)).artist;
  expect(profile).toMatchObject({ genre: 'Legacy genre', genres: ['Jazz','Soul'], genreIds: ['jazz','soul'], creativeRoles: ['producer','vocalist'], collaborationAvailability: 'open' });
  expect((await rpc(page, 'getMyArtistPreferences')).discovery.genres).toEqual(['PRIVATE_BROWSER_MARKER']);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Identity Browser Edited', exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('existing-profile.png') });
  await clickProfileLogout(page);
  await page.goto(`/artist/${user.artistId}`);
  await expect(page.getByRole('heading', { name: 'Identity Browser Edited', exact: true })).toBeVisible();
  await expect(page.getByText('Jazz', { exact: true })).toBeVisible();
  await expect(page.getByText('Soul', { exact: true })).toBeVisible();
  await expect(page.getByText('PRIVATE_BROWSER_MARKER')).toHaveCount(0);
  expect((await page.request.post('/api/rpc', { headers, data: { method: 'getMyArtistPreferences', args: [] } })).status()).toBe(401);
  await rpc(page, 'register', { name: 'Unchanged Investor', email: `${crypto.randomUUID()}@example.invalid`, password: 'preview123', role: 'investor' });
  await page.goto('/profile');
  await expect(page.getByRole('link', { name: /My Pledges/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'EDIT PROFILE', exact: true })).toHaveCount(0);
  expect((await page.request.post('/api/rpc', { headers, data: { method: 'getMyArtistPreferences', args: [] } })).status()).toBe(403);
  await clickProfileLogout(page);
  await page.goto('/login');
  await page.getByLabel('email', { exact: true }).fill(email); await page.getByLabel('password', { exact: true }).fill('preview123');
  await page.getByRole('button', { name: 'log in', exact: true }).click();
  await expect(page).toHaveURL(/\/profile$/);
  expect((await rpc(page, 'getMyArtistPreferences')).discovery.genres).toEqual(['PRIVATE_BROWSER_MARKER']);
  expect(errors).toEqual([]);
});
