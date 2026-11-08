import { test, expect, type Page } from '@playwright/test';
import { clickProfileLogout } from '../tests-support/profile-actions';

const headers = { Origin: 'http://127.0.0.1:4175', 'X-Nebula-Request': '1' };
async function rpc(page: Page, method: string, ...args: unknown[]) {
  const response = await page.request.post('/api/rpc', { headers, data: { method, args } });
  expect(response.ok(), await response.text()).toBe(true); return (await response.json()).result;
}
async function register(page: Page, name: string) {
  const email = `${crypto.randomUUID()}@example.invalid`, password = 'preview123';
  const user = await rpc(page, 'register', { name, email, password, role: 'artist' });
  return { ...user, email, password };
}
async function project(page: Page, title: string, need: string, category = 'EP') {
  const value = await rpc(page, 'createProject', { title, category, goalAmount: 1000, status: 'published' });
  const response = await page.request.post(`/api/projects/${value.id}/offers`, { headers, data: {
    need, deliverable: 'An original contribution.', requirements: '', deadline: null,
    status: 'open', compensation: { kind: 'fee', amount: 200, currency: 'USD' },
  } });
  expect(response.ok()).toBe(true); return value;
}
const search = (page: Page) => page.getByRole('combobox', { name: 'Search Home opportunities' });
const cards = (page: Page) => page.getByRole('article');
const navigation = (page: Page, name: string) => page.getByRole('navigation', { name: 'Primary navigation', exact: true }).getByRole('link', { name, exact: true });
async function query(page: Page, value: string) { await search(page).fill(value); await search(page).press('Enter'); }
async function epFilter(page: Page) {
  await page.getByRole('button', { name: /^Filters/ }).click();
  const panel = page.getByRole('dialog', { name: 'Filter projects', exact: true });
  await panel.getByRole('checkbox', { name: 'EP', exact: true }).check();
  await panel.getByRole('button', { name: /^Apply filters/ }).click();
}
async function openPrivateEditor(page: Page) {
  await page.getByRole('button', { name: 'EDIT PROFILE', exact: true }).click();
  await page.getByText('Private discovery & collaboration preferences', { exact: true }).click();
}
async function chooseOpportunity(page: Page, need: string) {
  const group = page.getByRole('group', { name: 'Opportunities to discover', exact: true });
  const clear = group.getByRole('button', { name: 'Clear opportunities to discover', exact: true });
  if (await clear.count()) await clear.click();
  await group.getByRole('button', { name: 'Choose opportunities to discover', exact: true }).click();
  const input = page.getByRole('combobox', { name: 'Search opportunities to discover', exact: true });
  await input.fill(need); await input.press('Home'); await input.press('Enter'); await input.press('Escape');
}
async function saveProfile(page: Page) {
  await page.getByRole('button', { name: 'save profile', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'edit artist profile', exact: true })).toHaveCount(0);
}
async function login(page: Page, account: { email: string; password: string }) {
  await page.goto('/login');
  await page.getByLabel('email', { exact: true }).fill(account.email);
  await page.getByLabel('password', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'log in', exact: true }).click();
  await expect(page).toHaveURL(/\/profile$/);
}

test('saving private interests reorders Home while preserving query, filters and mode', async ({ page }, info) => {
  const tag = `FY${crypto.randomUUID().slice(0, 8)}`;
  await register(page, 'For You editor');
  const production = await project(page, `${tag} Production project`, 'Production');
  const feature = await project(page, `${tag} Feature project`, 'Feature');
  await project(page, `${tag} Excluded Single`, 'Feature', 'Single');
  await rpc(page, 'updateMyArtistPreferences', { discovery: { opportunityTypes: ['Production'] } });
  await page.goto('/explore'); await query(page, tag); await epFilter(page);
  await expect(cards(page)).toHaveCount(2); await expect(cards(page).first()).toHaveAttribute('aria-label', production.title);
  await expect(page.getByTestId('home-mode-description')).toHaveText('Ordered using your private preferences.');
  await navigation(page, 'profile').click(); await openPrivateEditor(page); await chooseOpportunity(page, 'Feature'); await saveProfile(page);
  const requests: string[] = []; page.on('request', request => { if (request.url().includes('/api/opportunities/projects?')) requests.push(request.url()); });
  await navigation(page, 'home').click();
  await expect(search(page)).toHaveValue(tag);
  await expect(page.getByRole('button', { name: 'Filters (1 active)', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'For You', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(cards(page)).toHaveCount(2); await expect(cards(page).first()).toHaveAttribute('aria-label', feature.title);
  expect(new URL(requests.at(-1)!).searchParams.has('cursor')).toBe(false);
  expect((await rpc(page, 'getMyArtistPreferences')).discovery.opportunityTypes).toEqual(['Feature']);
  await page.getByRole('heading', { name: 'Find your next project.', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('home-for-you-preferences.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  // A real preference without a matching opportunity keeps all eligible cards.
  await navigation(page, 'profile').click(); await openPrivateEditor(page); await chooseOpportunity(page, 'Master'); await saveProfile(page);
  await navigation(page, 'home').click();
  await expect(page.getByTestId('home-mode-description')).toHaveText('General project order · no affinity matches in these results.');
  await expect(cards(page)).toHaveCount(2); await expect(search(page)).toHaveValue(tag);
  await page.getByRole('button', { name: 'Recently created', exact: true }).click();
  await expect(cards(page).first()).toHaveAttribute('aria-label', feature.title);
  await expect(page.getByTestId('home-mode-description')).toContainText('Newest creation date first');
  // A failed personalized request must remain an error, never a successful general/demo fallback.
  await page.getByRole('button', { name: 'For You', exact: true }).click();
  let fail = true;
  await page.route('**/api/opportunities/projects?*', async route => {
    if (fail) await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Temporary ranking failure' }) });
    else await route.continue();
  });
  await query(page, `${tag} project`);
  await expect(page.getByRole('alert')).toContainText('Temporary ranking failure');
  await expect(page.getByTestId('home-mode-description')).toHaveText('For You could not refresh. Try again.');
  await expect(cards(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Filters (1 active)', exact: true })).toBeVisible();
  fail = false; await page.getByRole('alert').getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(cards(page)).toHaveCount(2);
  await expect(search(page)).toHaveValue(`${tag} project`);
  await expect(page.getByRole('button', { name: 'For You', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('home-mode-description')).toHaveText('General project order · no affinity matches in these results.');
});

test('cross-tab preference commit cancels a delayed old page and restarts the sequence', async ({ page, context }) => {
  const tag = `FYP${crypto.randomUUID().slice(0, 8)}`;
  await register(page, 'For You pagination');
  const production = await project(page, `${tag} Production priority`, 'Production');
  for (let i = 0; i < 26; i++) await project(page, `${tag} Mix ${i}`, 'Mix');
  await rpc(page, 'updateMyArtistPreferences', { discovery: { opportunityTypes: ['Mix'] } });
  await page.goto('/explore'); await query(page, tag); await epFilter(page);
  await expect(cards(page)).toHaveCount(24);
  let releasePage!: () => void, finishPage!: () => void, captured = false, aborted = false;
  const pageGate = new Promise<void>(resolve => { releasePage = resolve; });
  const pageFinished = new Promise<void>(resolve => { finishPage = resolve; });
  page.on('requestfailed', request => { if (request.url().includes('/api/opportunities/projects?') && new URL(request.url()).searchParams.has('cursor')) aborted = true; });
  await page.route('**/api/opportunities/projects?*', async route => {
    if (new URL(route.request().url()).searchParams.has('cursor') && !captured) {
      captured = true; const response = await route.fetch(); await pageGate;
      try { await route.fulfill({ response }); } catch { /* Expected when the old query is cancelled. */ }
      finally { finishPage(); }
    } else await route.continue();
  });
  await page.getByRole('button', { name: 'Load more projects', exact: true }).click();
  await expect.poll(() => captured).toBe(true);
  const editor = await context.newPage(); await editor.goto('/profile'); await openPrivateEditor(editor); await chooseOpportunity(editor, 'Production');
  let releaseSave!: () => void, savedOnServer = false;
  const saveGate = new Promise<void>(resolve => { releaseSave = resolve; });
  await editor.route('**/api/rpc', async route => {
    if (route.request().postDataJSON()?.method === 'updateArtistIdentity') {
      const response = await route.fetch(); savedOnServer = true; await saveGate; await route.fulfill({ response });
    } else await route.continue();
  });
  await editor.getByRole('button', { name: 'save profile', exact: true }).click();
  await expect.poll(() => savedOnServer).toBe(true);
  await expect(editor.getByRole('button', { name: 'saving...', exact: true })).toBeDisabled();
  releaseSave(); await expect(editor.getByRole('heading', { name: 'edit artist profile', exact: true })).toHaveCount(0);
  await expect(cards(page).first()).toHaveAttribute('aria-label', production.title);
  await expect(cards(page)).toHaveCount(24);
  await expect.poll(() => aborted).toBe(true);
  releasePage(); await pageFinished;
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(cards(page).first()).toHaveAttribute('aria-label', production.title);
  await expect(cards(page)).toHaveCount(24);
  const names = await cards(page).evaluateAll(elements => elements.map(element => element.getAttribute('aria-label')));
  expect(new Set(names).size).toBe(24);
  await expect(search(page)).toHaveValue(tag);
  await expect(page.getByRole('button', { name: 'Filters (1 active)', exact: true })).toBeVisible();
  await editor.close();
});

test('account rotation and a delayed prior response cannot reuse another artist ranking', async ({ page }) => {
  const tag = `FYA${crypto.randomUUID().slice(0, 8)}`;
  const first = await register(page, 'Production viewer');
  const production = await project(page, `${tag} Production`, 'Production');
  const mix = await project(page, `${tag} Mix`, 'Mix');
  await rpc(page, 'updateMyArtistPreferences', { discovery: { opportunityTypes: ['Production'] } });
  const second = await register(page, 'Mix viewer');
  await rpc(page, 'updateMyArtistPreferences', { discovery: { opportunityTypes: ['Mix'] } });
  await rpc(page, 'logout');
  await login(page, first); await navigation(page, 'home').click(); await query(page, tag);
  await expect(cards(page).first()).toHaveAttribute('aria-label', production.title);
  let release!: () => void, finish!: () => void, captured = false;
  const gate = new Promise<void>(resolve => { release = resolve; }), finished = new Promise<void>(resolve => { finish = resolve; });
  await page.route('**/api/opportunities/projects?*', async route => {
    if (!captured) { captured = true; const response = await route.fetch(); await gate; try { await route.fulfill({ response }); } catch {} finally { finish(); } }
    else await route.continue();
  });
  // A new search owns a cancellable request while the old account is still signed in.
  await query(page, `${tag} Production`); await expect.poll(() => captured).toBe(true);
  await navigation(page, 'profile').click(); await clickProfileLogout(page);
  await login(page, second); await navigation(page, 'home').click();
  await expect(search(page)).toHaveValue(''); await query(page, tag);
  await expect(cards(page).first()).toHaveAttribute('aria-label', mix.title);
  release(); await finished;
  await expect(cards(page).first()).toHaveAttribute('aria-label', mix.title);
  await expect(page.getByTestId('home-mode-description')).toHaveText('Ordered using your private preferences.');
  await navigation(page, 'profile').click(); await clickProfileLogout(page);
  await page.goto('/explore'); await query(page, tag);
  await expect(page.getByTestId('home-mode-description')).toHaveText('General project order.');
  await expect(cards(page)).toHaveCount(2); await expect(cards(page).first()).toHaveAttribute('aria-label', mix.title);
  expect((await (await page.request.get('/api/session')).json()).user).toBeNull();
});
