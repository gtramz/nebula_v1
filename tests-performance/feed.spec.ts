import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

// Identical deterministic publications/media in both builds. No production data.
const items = Array.from({ length: 30 }, (_, n) => ({ id: n + 1, artistId: 999, artistName: 'Performance fixture',
  title: `Fixture ${n + 1}`, description: 'A repeatable feed performance fixture.', status: 'published', allowRemix: false,
  media: { id: `fixture-${n}`, kind: n % 2 ? 'audio' : 'video', url: n % 2 ? '/discovery-demo/soft-signal.wav' : '/discovery-demo/after-hours.webm' },
  social: { stars: 0, comments: 0, starred: false, saved: false }, offers: [], project: null, coverUrl: null,
}));

test('50 transitions, exclusive playback, resize and panel stability', async ({ page, browserName, browser }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/feed?*', route => route.fulfill({ json: { items, snapshot: 'fixed', nextCursor: null } }));
  await page.addInitScript(() => {
    const stats = { frames: [] as number[], longTasks: [] as number[], overlap: 0, maxMedia: 0 };
    (window as any).__feedMetrics = stats;
    let last = 0;
    const tick = (now: number) => {
      if (last) stats.frames.push(now - last); last = now;
      const media = [...document.querySelectorAll<HTMLMediaElement>('.discovery-feed audio, .discovery-feed video')];
      stats.maxMedia = Math.max(stats.maxMedia, media.length);
      if (media.filter(m => !m.paused && !m.ended).length > 1) stats.overlap++;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    if (PerformanceObserver.supportedEntryTypes.includes('longtask')) new PerformanceObserver(list => {
      stats.longTasks.push(...list.getEntries().map(entry => entry.duration));
    }).observe({ type: 'longtask', buffered: true });
  });
  const cdp = browserName === 'chromium' ? await page.context().newCDPSession(page) : null;
  if (cdp && info.project.name.includes('mobile')) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.goto('/discovery');
  const feed = page.getByRole('region', { name: 'Discovery feed', exact: true });
  await expect(page.locator('article[data-active=true]')).toHaveAttribute('data-index', '0');
  await expect(page.locator('article[data-active=true] video')).toHaveJSProperty('readyState', 4);
  await page.evaluate(() => { const m = (window as any).__feedMetrics; m.frames = []; m.longTasks = []; m.maxMedia = 0; m.overlap = 0; });
  const latencies: number[] = [];
  // Measure inside the page: dispatch -> active card aligned on a paint opportunity,
  // excluding Playwright polling/actionability delays. Sweep down and back up.
  for (let step = 0; step < 50; step++) {
    const index = step < 29 ? step + 1 : 57 - step;
    const elapsed = await feed.evaluate(async (element, target) => {
      const began = performance.now();
      element.dispatchEvent(new KeyboardEvent('keydown', { key: Number(element.querySelector('[data-active=true]')?.getAttribute('data-index')) < target ? 'ArrowDown' : 'ArrowUp', bubbles: true }));
      return new Promise<number>((resolve, reject) => {
        const poll = () => {
          const card = element.querySelector<HTMLElement>(`article[data-index="${target}"]`);
          if (card?.dataset.active === 'true' && Math.abs(card.offsetTop - element.scrollTop) < 2) resolve(performance.now() - began);
          else if (performance.now() - began > 2000) reject(new Error('Transition did not settle'));
          else requestAnimationFrame(poll);
        }; requestAnimationFrame(poll);
      });
    }, index);
    latencies.push(elapsed);
    // Allow decode/playback, not just React state updates, on each publication.
    await page.waitForTimeout(100);
    await expect(page.locator('article[data-active=true]')).toHaveCount(1);
    expect(await page.locator('article[data-active=true]').evaluate(e => e.getBoundingClientRect().height)).toBeGreaterThan(200);
  }
  const selected = await page.locator('article[data-active=true]').getAttribute('aria-label');
  await page.locator('article[data-active=true]').getByRole('button', { name: /^Read description/ }).click();
  await expect.poll(() => page.locator('audio,video').evaluateAll(nodes => nodes.filter(n => !(n as HTMLMediaElement).paused).length)).toBe(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('article[data-active=true]')).toHaveAttribute('aria-label', selected!);
  for (const width of [768, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator('article[data-active=true]')).toHaveAttribute('aria-label', selected!);
    await expect.poll(() => feed.evaluate(e => Math.abs(e.scrollTop - (e.querySelector<HTMLElement>('[data-active=true]')?.offsetTop ?? 0)))).toBeLessThan(2);
    if (width === 390) await page.screenshot({ path: info.outputPath('feed-mobile.png') });
  }
  const metrics = await page.evaluate(() => (window as any).__feedMetrics);
  const sorted = [...latencies].sort((a,b) => a-b);
  const frames = [...metrics.frames].sort((a:number,b:number) => a-b);
  const frameInterval = frames[Math.floor(frames.length / 2)] || 16.67;
  const droppedFrameEstimate = metrics.frames.reduce((sum:number, ms:number) => sum + Math.max(0, Math.round(ms / frameInterval) - 1), 0);
  await writeFile(info.outputPath('metrics.json'), JSON.stringify({ build: process.env.NEBULA_PERF_BUILD, profile: info.project.name,
    browser: browser.version(), physicalDevice: false, cpuSlowdown: cdp && info.project.name.includes('mobile') ? 4 : 1,
    network: 'loopback, browser default cache, 30 fixed posts sharing two 8-second media fixtures',
    transitions: 50, p50: sorted[25], p95: sorted[47], max: sorted[49], latencies,
    frameInterval, estimatedRefreshHz: 1000/frameInterval, droppedFrameEstimate, longTaskSupported: browserName === 'chromium', ...metrics, errors }, null, 2));
  await page.screenshot({ path: info.outputPath('feed.png') });
  expect(errors).toEqual([]); expect(metrics.overlap).toBe(0);
});
