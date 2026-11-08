import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

// Compare the same empty inbox + Search journey against a compiled baseline.
// Hook counts React commits, not render duration or physical screen frames.
test('notification entry preserves Search and has one polling owner', async ({ page, browser }, info) => {
  const baseline = process.env.NEBULA_PERF_BUILD === 'aecbd000';
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const metrics = { commits: 0 };
    (window as any).__notificationMetrics = metrics;
    (window as any).__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      supportsFiber: true, inject: () => 1, checkDCE: () => {},
      onCommitFiberRoot: () => { metrics.commits++; },
      onCommitFiberUnmount: () => {}, onPostCommitFiberRoot: () => {},
    };
  });
  const response = await page.request.post('/api/rpc', {
    headers: { Origin: 'http://127.0.0.1:4175', 'X-Nebula-Request': '1' },
    data: { method: 'register', args: [{ name: 'Notification benchmark', role: 'artist', email: `${crypto.randomUUID()}@example.invalid`, password: 'preview123' }] },
  });
  expect(response.ok()).toBe(true);
  await page.goto('/search');
  const search = page.locator('input').first();
  await search.fill('kept query');
  await page.waitForTimeout(700);
  await search.evaluate(element => { (window as any).__sourceSearchNode = element; });
  const commitsAtStart = await page.evaluate(() => (window as any).__notificationMetrics.commits);
  expect(commitsAtStart).toBeGreaterThan(0);
  const requests: Record<string, number> = {};
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/api/')) requests[path] = (requests[path] ?? 0) + 1;
  });
  await page.locator(baseline ? 'a[href="/notifications"]:visible' : '[data-notification-bell]:visible').first().click();
  await expect(page.getByText('You’re all caught up.', { exact: true })).toBeVisible();
  const routeDuring = new URL(page.url()).pathname;
  await page.waitForTimeout(21_000);
  const commitsDuring = await page.evaluate(() => (window as any).__notificationMetrics.commits) - commitsAtStart;
  const sourceStayedMounted = await page.evaluate(() => (window as any).__sourceSearchNode.isConnected);
  if (baseline) await page.goBack();
  else await page.keyboard.press('Escape');
  const restoredQuery = await search.inputValue();
  await writeFile(info.outputPath('notifications-metrics.json'), JSON.stringify({
    build: process.env.NEBULA_PERF_BUILD, profile: info.project.name, browser: browser.version(),
    durationSeconds: 21, requests, rootCommits: commitsDuring, routeDuring, sourceStayedMounted, restoredQuery, errors,
    interpretation: 'React root commits, not component render durations. One deterministic empty-inbox run per build/profile; no statistical claim.',
  }, null, 2));
  expect(errors).toEqual([]);
  if (!baseline) {
    expect(sourceStayedMounted).toBe(true); expect(routeDuring).toBe('/search'); expect(restoredQuery).toBe('kept query');
    expect(requests['/api/notifications']).toBe(1);
    expect(requests['/api/notifications/summary']).toBeGreaterThanOrEqual(2);
    expect(requests['/api/notifications/summary']).toBeLessThanOrEqual(3);
  }
});
