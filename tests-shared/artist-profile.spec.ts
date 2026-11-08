import { clickProfileLogout } from '../tests-support/profile-actions';
import { test, expect, type Page } from '@playwright/test';
import { resolve } from 'node:path';
const headers = { Origin: 'http://127.0.0.1:4175', 'X-Nebula-Request': '1' };
async function rpc(page: Page, method: string, ...args: unknown[]) { const r = await page.request.post('/api/rpc', { headers, data: { method, args } }); expect(r.ok(), await r.text()).toBeTruthy(); return (await r.json()).result; }
async function signup(page: Page, role: 'artist' | 'investor' = 'artist') {
  await page.goto('/register'); await page.getByRole('button', { name: new RegExp(`^${role} `) }).click();
  await page.getByRole('textbox', { name: 'full name' }).fill('New Creative Artist'); await page.getByRole('button', { name: 'continue', exact: true }).click();
  await page.getByRole('textbox', { name: 'email address' }).fill(`${crypto.randomUUID()}@example.invalid`); await page.getByRole('button', { name: 'continue', exact: true }).click();
  await page.getByLabel('password', { exact: true }).fill('preview123'); await page.getByLabel('confirm password', { exact: true }).fill('preview123');
  await page.getByRole('button', { name: 'create account', exact: true }).click();
  await expect(page).toHaveURL(role === 'artist' ? /\/onboarding$/ : /\/explore$/);
}
async function choose(page: Page, label: string, terms: string[]) {
  await page.getByRole('button', { name: `Choose ${label.toLowerCase()}`, exact: true }).click();
  const input = page.getByRole('combobox', { name: `Search ${label.toLowerCase()}`, exact: true });
  for (const term of terms) { await input.fill(term); await input.press('Home'); await input.press('Enter'); }
  await input.press('Escape'); await expect(page.getByRole('dialog', { name: `${label} selector` })).toBeHidden();
}
async function next(page: Page, heading: string) { await page.getByRole('button', { name: 'Save & continue', exact: true }).click(); await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible(); }

test('Artist lifecycle uses one identity, resumes onboarding and keeps preferences private', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await signup(page); await expect(page.getByRole('heading', { name: 'Identity', exact: true })).toBeFocused();
  const original = (await (await page.request.get('/api/session')).json()).user;
  await page.getByLabel('artist name', { exact: true }).fill('Sonic Identity'); await page.getByLabel('bio', { exact: true }).fill('Public biography from real profile fields.');
  await page.getByLabel('PROFILE IMAGE', { exact: true }).setInputFiles(resolve('artifacts/nebula/src/assets/antiq-logo.png'));
  await expect(page.getByAltText('PROFILE IMAGE preview')).toBeVisible();
  await next(page, 'Creative identity');
  await choose(page, 'Creative roles', ['Producer', 'Vocalist']); await choose(page, 'Musical genres', ['Hip hop', 'RnB']);
  await next(page, 'Interests & preferences');
  await choose(page, 'Opportunities to discover', ['Mix']); await choose(page, 'Roles I want to perform', ['Mixing engineer']);
  await choose(page, 'Genres to explore', ['Electronic']); await choose(page, 'Compensation preferences', ['Fixed payment']);
  await choose(page, 'Collaboration interests', ['Master']);
  await page.getByRole('button', { name: 'Save and exit', exact: true }).click(); await expect(page).toHaveURL(/\/profile$/);
  await page.reload(); await page.getByRole('link', { name: 'Resume artist setup', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Interests & preferences', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove Electronic', exact: true })).toBeVisible();
  await next(page, 'Profile completion');
  await page.getByLabel('Collaboration availability', { exact: true }).selectOption('open');
  await page.getByLabel('based in', { exact: true }).fill('Mexico City'); await page.getByLabel('record label', { exact: true }).fill('Independent');
  await choose(page, 'Public professional interests', ['Feature']);
  await page.getByRole('button', { name: 'Add link', exact: true }).click();
  await page.getByLabel('Link 1 label', { exact: true }).fill('Official music'); await page.getByLabel('Link 1 URL', { exact: true }).fill('https://example.com/music');
  await expect(page.getByRole('region', { name: 'Profile review' })).toContainText('Music Producer');
  await page.screenshot({ path: info.outputPath('onboarding-review.png'), fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Finish setup', exact: true }).click(); await expect(page).toHaveURL(/\/profile$/);
  expect((await rpc(page, 'getMyArtistOnboarding')).completedAt).toBeTruthy();
  await expect(page.getByRole('link', { name: 'Resume artist setup' })).toHaveCount(0);
  await page.getByRole('link', { name: 'View public profile', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/artist/${original.artistId}$`));
  await expect(page.getByRole('heading', { name: 'Sonic Identity', exact: true })).toBeVisible();
  await expect(page.getByText('Electronic', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Follow', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Message', exact: true })).toHaveCount(0);
  await page.getByRole('tab', { name: 'About', exact: true }).click();
  const about = page.getByRole('tabpanel', { name: 'About', exact: true });
  await expect(about.getByRole('link', { name: 'Official music', exact: true })).toHaveAttribute('href', 'https://example.com/music');
  await expect(about).toContainText('Independent'); await expect(about).toContainText('Feature');
  await page.getByRole('heading', { name: 'Sonic Identity', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('public-header.png'), animations: 'disabled' });
  await about.getByRole('heading', { name: 'About', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('public-about.png'), animations: 'disabled' });
  await page.getByRole('link', { name: 'Edit Profile', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'edit artist profile' })).toBeVisible();
  await page.getByRole('button', { name: 'Remove Hip-hop', exact: true }).click(); await choose(page, 'Musical genres', ['Jazz']);
  await page.getByText('Private discovery & collaboration preferences', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove Electronic', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'save profile', exact: true }).click(); await expect(page).toHaveURL(/\/profile$/);
  await page.reload(); const current = (await (await page.request.get('/api/session')).json()).user;
  expect(current.artistId).toBe(original.artistId); expect(current.artist.genreIds).toEqual(['rnb', 'jazz']);
  expect((await rpc(page, 'getMyArtistPreferences')).discovery.genreIds).toEqual(['electronic']);
  await clickProfileLogout(page); await page.goto(`/artist/${original.artistId}`);
  await expect(page.getByRole('link', { name: 'Edit Profile', exact: true })).toHaveCount(0);
  await expect(page.getByText('Jazz', { exact: true })).toBeVisible();
  await expect(page.getByText(original.email, { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false); expect(errors).toEqual([]);
});

test('optional setup skips safely, rejects failed saves and leaves investors unchanged', async ({ page }) => {
  await signup(page); await page.getByRole('button', { name: 'Skip this step', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Creative identity', exact: true })).toBeVisible();
  await choose(page, 'Creative roles', ['Composer']);
  await page.route('**/api/rpc', async route => { if (route.request().postDataJSON()?.method === 'updateArtistIdentity') await route.fulfill({ status: 503, json: { error: 'Save failed. Try again.' } }); else await route.continue(); });
  await page.getByRole('button', { name: 'Save & continue', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Save failed. Try again.');
  await expect(page.getByRole('button', { name: 'Remove Composer', exact: true })).toBeVisible();
  expect((await rpc(page, 'getMyArtistOnboarding')).step).toBe(2);
  await page.unroute('**/api/rpc'); await next(page, 'Interests & preferences');
  await page.getByRole('button', { name: 'Skip this step', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Profile completion', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Finish setup', exact: true }).click(); await expect(page).toHaveURL(/\/profile$/);
  await clickProfileLogout(page); await signup(page, 'investor');
  await page.goto('/profile'); await expect(page.getByRole('link', { name: /My Pledges/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /artist setup|Complete your artist profile/ })).toHaveCount(0);
  await page.goto('/onboarding'); await expect(page.getByText('This setup is for artist accounts.', { exact: true })).toBeVisible();
  expect((await page.request.post('/api/rpc', { headers, data: { method: 'getMyArtistOnboarding', args: [] } })).status()).toBe(403);
});

test('public artist sections use real relationships and reuse playback without exposing drafts or collaborations', async ({ page }, info) => {
  const user = await rpc(page, 'register', { name: 'Catalog artist', email: `${crypto.randomUUID()}@example.invalid`, password: 'preview123', role: 'artist' });
  await rpc(page, 'updateArtistIdentity', { profile: { name: 'Catalog artist', creativeRoles: ['producer','songwriter'], genreIds: ['jazz'], bio: 'Artist portfolio biography.' }, preferences: { discovery: { genres: ['PRIVATE_DISCOVERY'] } } });
  const ep = await rpc(page, 'createProject', { title: 'Public EP', category: 'EP', status: 'funding', goalAmount: 1000 });
  await rpc(page, 'createProject', { title: 'SECRET DRAFT', category: 'EP', status: 'draft', goalAmount: 1000 });
  await rpc(page, 'createProject', { title: 'Closed single', category: 'Single', status: 'closed', goalAmount: 1000 });
  const { readFile } = await import('node:fs/promises');
  const upload = async (path: string, kind: string) => { const r = await page.request.post('/api/uploads', { headers: { ...headers, 'X-Media-Kind': kind, 'Content-Type': 'application/octet-stream' }, data: await readFile(resolve(path)) }); expect(r.ok()).toBeTruthy(); return r.json(); };
  const audio = await upload('artifacts/nebula/public/discovery-demo/soft-signal.wav','audio'), video = await upload('artifacts/nebula/public/discovery-demo/after-hours.webm','video');
  const post = async (title: string, mediaId: string, projectId: number | null, status = 'published') => { const r = await page.request.post('/api/publications', { headers, data: { title, description: 'Public publication text.', mediaId, projectId, status, allowRemix: false, coverId: null } }); expect(r.ok()).toBeTruthy(); return r.json(); };
  const song = await post('Project sound', audio.id, ep.id); const clip = await post('Independent video', video.id, null); await post('SECRET PUBLICATION', audio.id, null, 'draft');
  await page.goto(`/artist/${user.artistId}`);
  await expect(page.getByRole('tab', { name: 'Music', exact: true })).toHaveAttribute('aria-selected','true');
  await expect(page.getByRole('button', { name: 'Play Project sound', exact: true })).toBeVisible();
  await expect(page.getByText('SECRET DRAFT', { exact: true })).toHaveCount(0); await expect(page.getByText('PRIVATE_DISCOVERY')).toHaveCount(0);
  await page.getByRole('button', { name: 'Play Project sound', exact: true }).click();
  await expect.poll(() => page.locator('audio').evaluate((media: HTMLAudioElement) => !media.paused)).toBe(true);
  await page.getByRole('heading', { name: 'Catalog artist', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('music-header.png'), animations: 'disabled' });
  await page.getByRole('button', { name: 'Pause Project sound', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('music-profile.png'), animations: 'disabled' });
  await page.getByRole('tab', { name: 'Discovery Posts', exact: true }).click(); await expect(page.locator('audio')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Open publication: Independent video', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open publication: Project sound', exact: true })).toHaveAttribute('href', `/discovery?post=post-${song.id}`);
  await expect(page.getByText('SECRET PUBLICATION', { exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'Open publication: Independent video', exact: true }).click(); await expect(page).toHaveURL(new RegExp(`/discovery\\?post=post-${clip.id}$`));
  await page.goto(`/artist/${user.artistId}`); await page.getByRole('tab', { name: 'Projects', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Open opportunities', exact: true })).toBeVisible(); await expect(page.getByRole('heading', { name: 'Closed projects', exact: true })).toBeVisible();
  await expect(page.getByText('SECRET DRAFT', { exact: true })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Collaborations', exact: true }).click(); await expect(page.getByText('No public credits to display.', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Music', exact: true }).focus(); await page.keyboard.press('End'); await expect(page.getByRole('tab', { name: 'About', exact: true })).toBeFocused();
  await rpc(page, 'logout'); await page.goto(`/artist/${user.artistId}`);
  await expect(page.getByRole('link', { name: 'Edit Profile', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.route('**/api/publications?artistId=*', route => route.fulfill({ status: 503, json: { error: 'Unavailable test catalog' } }));
  await page.reload(); await expect(page.getByRole('alert')).toHaveText('Unavailable test catalog');
  await page.unroute('**/api/publications?artistId=*'); await page.getByRole('button', { name: 'Retry publications', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Play Project sound', exact: true })).toBeVisible();
});
