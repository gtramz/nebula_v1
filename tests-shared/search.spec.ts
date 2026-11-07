import { expect, test, type Page, type Route } from '@playwright/test';

const result = (name: string) => ({ id: 9876, name, projectCount: 0, totalRaised: 0, supportersCount: 0 });
async function intercept(page: Page, handle: (route: Route, search: string, method: string) => Promise<void>) {
  await page.route('**/api/rpc', async route => {
    const { method, args } = route.request().postDataJSON();
    if (method === 'listArtists' || method === 'listProjects') await handle(route, args[0].search, method);
    else await route.continue();
  });
}
async function respond(route: Route, search: string, method: string) {
  await route.fulfill({ json: { user: null, result: method === 'listArtists' && search !== 'missing' ? [result(search)] : [] } });
}

test('debounces rapid input, normalizes queries, caches repeats and handles empty results', async ({ page }) => {
  const calls: string[] = [];
  await intercept(page, async (route, search, method) => { calls.push(search); await respond(route, search, method); });
  await page.goto('/search');
  const input = page.getByRole('searchbox');
  await expect(page.getByRole('status')).toHaveText('Search artists and projects.');
  await input.fill('a'); await page.waitForTimeout(400); expect(calls).toHaveLength(0);
  await expect(page.getByRole('status')).toHaveText('Enter at least 2 characters.');
  await input.fill(''); await input.pressSequentially('  Nebula  ', { delay: 30 });
  await expect(page.getByRole('link', { name: /Nebula.*Projects/ })).toBeVisible();
  expect(calls).toEqual(['Nebula', 'Nebula']);
  await page.getByRole('button', { name: 'clear search' }).click();
  await expect(input).toBeFocused(); await expect(page.locator('#search-results a')).toHaveCount(0);
  await input.fill('Nebula'); await expect(page.getByRole('status')).toContainText('1 result');
  expect(calls).toHaveLength(2);
  await input.fill('missing'); await expect(page.getByRole('status')).toContainText('No results for “missing”');
  expect(calls).toEqual(['Nebula', 'Nebula', 'missing', 'missing']);
});

test('composition does not search until committed, and clearing cancels pending work', async ({ page }) => {
  const calls: string[] = [];
  await page.addInitScript(() => {
    const fetchOriginal = window.fetch;
    Object.assign(window, { cancelledSearches: 0 });
    window.fetch = (input, init) => {
      if (String(input) === '/api/rpc') init?.signal?.addEventListener('abort', () => {
        (window as unknown as { cancelledSearches: number }).cancelledSearches++;
      }, { once: true });
      return fetchOriginal(input, init);
    };
  });
  const delayed: Route[] = [];
  await intercept(page, async (route, search, method) => {
    calls.push(search);
    if (search === 'pending') delayed.push(route);
    else await respond(route, search, method);
  });
  await page.goto('/search'); const input = page.getByRole('searchbox');
  await input.dispatchEvent('compositionstart'); await input.fill('音楽');
  await page.waitForTimeout(450); expect(calls).toHaveLength(0);
  await expect(page.getByRole('status')).toHaveText('Finish typing to search.');
  await input.dispatchEvent('compositionend'); await expect(page.getByRole('status')).toContainText('1 result');
  expect(calls).toEqual(['音楽', '音楽']);
  await input.fill('pending'); await expect.poll(() => delayed.length).toBe(2);
  await page.getByRole('button', { name: 'clear search' }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { cancelledSearches: number }).cancelledSearches)).toBe(2);
  await input.fill('Latest'); await expect(page.getByRole('status')).toContainText('1 result for “Latest”');
  for (const route of delayed) await respond(route, 'pending', route.request().postDataJSON().method);
  await expect(page.getByRole('status')).toContainText('1 result for “Latest”');
  await expect(page.getByText('pending', { exact: true })).toHaveCount(0);
});

test('shows loading and recoverable errors without retaining results from another query', async ({ page }) => {
  let fail = true;
  let cancelledSibling = false;
  page.on('requestfailed', request => {
    if (request.url().endsWith('/api/rpc')) {
      const { method, args } = request.postDataJSON();
      if (method === 'listArtists' && args[0].search === 'broken') cancelledSibling = true;
    }
  });
  const delayed: Route[] = [];
  await intercept(page, async (route, search, method) => {
    if (search === 'slow') { delayed.push(route); return; }
    if (search === 'broken' && fail && method === 'listArtists') { delayed.push(route); return; }
    if (search === 'broken' && fail && method === 'listProjects') {
      await route.fulfill({ status: 503, json: { error: 'Search temporarily unavailable.' } });
    } else await respond(route, search, method);
  });
  await page.goto('/search'); const input = page.getByRole('searchbox');
  await input.fill('slow'); await expect.poll(() => delayed.length).toBe(2);
  await expect(page.getByRole('status')).toHaveText('Searching…');
  await expect(page.locator('#search-results')).toHaveAttribute('aria-busy', 'true');
  await input.fill('broken'); await expect(page.getByRole('alert')).toContainText('Search temporarily unavailable.');
  await expect.poll(() => cancelledSibling).toBe(true);
  await expect(page.locator('#search-results a')).toHaveCount(0);
  fail = false; await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('status')).toContainText('1 result for “broken”');
  for (const route of delayed) await respond(route, 'slow', route.request().postDataJSON().method);
  await expect(page.getByText('slow', { exact: true })).toHaveCount(0);
  await input.fill('x'); await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('#search-results a')).toHaveCount(0);
});

test('input controls stay centered with visible keyboard focus and touch-sized clear control', async ({ page }, info) => {
  await intercept(page, respond); await page.goto('/search');
  const input = page.getByRole('searchbox'); await input.fill('Alignment');
  await expect(page.getByRole('status')).toContainText('1 result');
  const before = await input.boundingBox();
  await page.keyboard.press('Tab');
  const clear = page.getByRole('button', { name: 'clear search' });
  await expect(clear).toBeFocused();
  await page.keyboard.press('Shift+Tab'); await expect(input).toBeFocused();
  expect(await input.evaluate(el => getComputedStyle(el).outlineStyle)).not.toBe('none');
  expect(await input.boundingBox()).toEqual(before);
  const icon = await page.locator('#site-search').locator('..').locator('svg').first().boundingBox();
  const button = await clear.boundingBox();
  expect(Math.abs(icon!.y + icon!.height / 2 - before!.y - before!.height / 2)).toBeLessThan(1);
  expect(Math.abs(button!.y + button!.height / 2 - before!.y - before!.height / 2)).toBeLessThan(1);
  expect(button!.height).toBeGreaterThanOrEqual(44); expect(button!.width).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('search.png'), fullPage: true });
  await page.keyboard.press('Tab'); await page.keyboard.press('Enter');
  await expect(input).toHaveValue(''); await expect(input).toBeFocused();
});
