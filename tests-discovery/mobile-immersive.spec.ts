import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const headers = { Origin: 'http://127.0.0.1:4175', 'X-Nebula-Request': '1' };
const active = (page: Page) => page.locator('article[data-active=true]');
async function rpc(page: Page, method: string, ...args: unknown[]) {
  const response = await page.request.post('/api/rpc', { headers, data: { method, args } });
  expect(response.ok()).toBe(true); return (await response.json()).result;
}
async function upload(page: Page, kind: string, data: Buffer) {
  const response = await page.request.post('/api/uploads', { headers: { ...headers, 'X-Media-Kind': kind, 'Content-Type': 'application/octet-stream' }, data });
  expect(response.ok()).toBe(true); return (await response.json()).id as string;
}
async function publish(page: Page, title: string, mediaId: string, projectId: number | null, coverId: string | null = null) {
  const response = await page.request.post('/api/publications', { headers, data: { title, description: 'Mobile artwork and return fixture.', mediaId, coverId, projectId, allowRemix: true, status: 'published' } });
  expect(response.ok()).toBe(true); return response.json();
}
async function mobileNavigationGeometry(page: Page, width: number, height: number) {
  // ResizeObserver restores the feed on its next animation frame; wait through
  // the following paint before checking fixed navigation or taking screenshots.
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
  const navigation = page.getByRole('navigation', { name: 'Primary navigation', exact: true });
  await expect(navigation).toBeVisible();
  const bounds = (await page.getByTestId('app-navigation').boundingBox())!;
  expect(bounds.y).toBe(height - 64); expect(bounds.height).toBe(64);
  const links = navigation.getByRole('link');
  await expect(links).toHaveCount(5);
  for (const link of await links.all()) {
    await expect(link).toBeVisible();
    const box = (await link.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(box.y).toBeGreaterThanOrEqual(height - 64); expect(box.y + box.height).toBeLessThanOrEqual(height + 1);
    // The existing container has a 1px top border; its 64px inner nav extends
    // one pixel past the viewport. The complete 44px icon/touch area must fit.
    expect(Math.min(height, box.y + box.height) - Math.max(height - 64, box.y)).toBeGreaterThanOrEqual(44);
    const icon = (await link.locator('.nav-icon').boundingBox())!;
    expect(icon.y).toBeGreaterThanOrEqual(height - 64); expect(icon.y + icon.height).toBeLessThanOrEqual(height);
    expect(icon.width).toBe(44); expect(icon.height).toBe(44);
    expect(box.width).toBeGreaterThanOrEqual(44); expect(box.height).toBeGreaterThanOrEqual(44);
    expect(await link.evaluate(element => {
      const box = element.getBoundingClientRect();
      return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
    })).toBe(true);
  }
}

test('mobile project artworks navigate and return, fall back safely, and never link to inaccessible projects', async ({ page }, info) => {
  await rpc(page, 'register', { name: 'Immersive artist', role: 'artist', email: `immersive-${crypto.randomUUID()}@example.invalid`, password: 'preview123' });
  const image = await readFile('artifacts/nebula/src/assets/antiq-logo.png');
  const projectCover = `data:image/png;base64,${image.toString('base64')}`;
  const project = await rpc(page, 'createProject', { title: 'Immersive project', category: 'EP', goalAmount: 1000, status: 'published', coverUrl: projectCover });
  expect(project.id).toBeGreaterThan(0);
  const imageId = await upload(page, 'image', image);
  const audioId = await upload(page, 'audio', await readFile('artifacts/nebula/public/discovery-demo/soft-signal.wav'));
  const videoId = await upload(page, 'video', await readFile('artifacts/nebula/public/discovery-demo/after-hours.webm'));
  const videoPost = await publish(page, 'Linked video', videoId, project.id, imageId);
  const audioPost = await publish(page, 'Linked audio', audioId, project.id);
  expect(videoPost.project.id).toBe(project.id); expect(audioPost.project.id).toBe(project.id);
  for (const post of [videoPost, audioPost]) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/discovery?post=post-${post.id}`);
    const projectLink = active(page).getByRole('link', { name: 'View project: Immersive project', exact: true });
    for (const viewport of [{ width: 390, height: 900 }, { width: 578, height: 900 }, { width: 767, height: 900 }, { width: 568, height: 320 }, { width: 768, height: 900 }, { width: 1440, height: 900 }]) {
      const { width, height } = viewport;
      await page.setViewportSize(viewport);
      if (width >= 768) {
        await expect(projectLink).toHaveCount(0);
        await expect(active(page).getByRole('button', { name: /view project/i })).toBeVisible();
        continue;
      }
      await expect(projectLink).toBeVisible();
      await mobileNavigationGeometry(page, width, height);
      const box = (await projectLink.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44); expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.width).toBeCloseTo(box.height, 0);
      expect(box.y).toBeGreaterThanOrEqual(0); expect(box.y + box.height).toBeLessThanOrEqual(height - 64);
      for (const button of await active(page).locator('.discovery-actions button').all()) {
        const action = (await button.boundingBox())!;
        expect(action.width).toBeGreaterThanOrEqual(44); expect(action.height).toBeGreaterThanOrEqual(44);
        expect(action.x).toBeGreaterThanOrEqual(0); expect(action.x + action.width).toBeLessThanOrEqual(width);
        expect(action.y).toBeGreaterThanOrEqual(0); expect(action.y + action.height).toBeLessThanOrEqual(height - 64);
      }
      if (post.id === videoPost.id) {
        expect(box.width).toBe(48);
        const actions = (await active(page).locator('.discovery-actions').boundingBox())!;
        expect(box.y).toBeGreaterThanOrEqual(actions.y + actions.height);
        await expect(projectLink.locator('img')).toHaveAttribute('src', videoPost.coverUrl);
      } else {
        if (height > 360) expect(box.width).toBeGreaterThan(100);
        await expect(active(page).locator('.discovery-project-artwork')).toHaveCount(0);
        expect(await projectLink.locator('img').getAttribute('src')).toBe(projectCover);
        await expect(active(page).locator('audio')).toHaveJSProperty('paused', true);
      }
      await page.screenshot({ path: info.outputPath(`linked-${post.id === videoPost.id ? 'video' : 'audio'}-${width}.png`) });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await projectLink.focus(); await projectLink.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/project/${project.id}$`));
    await expect(page.getByRole('heading', { name: 'Immersive project', exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Back to Discovery', exact: true }).click();
    await expect(active(page)).toHaveAttribute('aria-label', `${post.title} by Immersive artist`);
    await expect.poll(() => page.locator('.discovery-feed').evaluate(element => Math.abs(element.scrollTop - (element.querySelector('[data-active=true]') as HTMLElement).offsetTop))).toBeLessThan(1);
    await active(page).getByRole('button', { name: /view project/i }).click();
    await expect(page.getByRole('dialog')).toContainText('Immersive project');
    await page.keyboard.press('Escape');
    await expect(active(page).getByRole('button', { name: /view project/i })).toBeFocused();
  }

  // Returning must remember a swiped-to publication, not reset to the initial URL's post.
  await page.route('**/api/feed?*', route => route.fulfill({ json: { items: [videoPost, audioPost], nextCursor: null, snapshot: 'artwork-return-fixture' } }));
  await page.goto(`/discovery?post=post-${videoPost.id}`);
  const feed = page.getByRole('region', { name: 'Discovery feed', exact: true });
  await feed.focus(); await feed.press('ArrowDown');
  await expect(active(page)).toHaveAttribute('aria-label', 'Linked audio by Immersive artist');
  await active(page).getByRole('link', { name: 'View project: Immersive project', exact: true }).click();
  await page.getByRole('link', { name: 'Back to Discovery', exact: true }).click();
  await expect(active(page)).toHaveAttribute('aria-label', 'Linked audio by Immersive artist');
  await expect.poll(() => feed.evaluate(element => Math.abs(element.scrollTop - (element.querySelector('[data-active=true]') as HTMLElement).offsetTop))).toBeLessThan(1);
  await page.unroute('**/api/feed?*');

  // A broken publication image falls through to the existing project artwork.
  await page.route(new URL(videoPost.coverUrl, 'http://127.0.0.1:4175').href, route => route.abort());
  await page.goto(`/discovery?post=post-${videoPost.id}`);
  await expect.poll(() => active(page).getByRole('link', { name: 'View project: Immersive project', exact: true }).locator('img').getAttribute('src')).toBe(projectCover);
  const noCoverProject = await rpc(page, 'createProject', { title: 'No cover project', category: 'Single', goalAmount: 500, status: 'published' });
  const noCoverPost = await publish(page, 'No cover audio', audioId, noCoverProject.id);
  await page.goto(`/discovery?post=post-${noCoverPost.id}`);
  await expect(active(page).getByRole('link', { name: 'View project: No cover project', exact: true }).getByLabel('No cover artwork')).toBeVisible();
  const independent = await publish(page, 'Independent video', videoId, null);
  await page.goto(`/discovery?post=post-${independent.id}`);
  await expect(active(page).getByRole('link', { name: /^View project:/ })).toHaveCount(0);
  await expect(active(page).locator('.discovery-project-artwork')).toHaveCount(0);

  // Only temporary test records are changed. The server must omit private destinations for a visitor.
  await rpc(page, 'updateProject', project.id, { status: 'draft' });
  await rpc(page, 'logout');
  const unavailable = await page.request.get(`/api/publications/${videoPost.id}`);
  expect(unavailable.ok()).toBe(true); expect((await unavailable.json()).project).toBeNull();
  await page.goto(`/discovery?post=post-${videoPost.id}`);
  await expect(active(page).getByRole('link', { name: /^View project:/ })).toHaveCount(0);
  await expect(active(page).getByRole('button', { name: /view project/i })).toHaveCount(0);
});

test('mobile pagination loads once, keeps the active post on failure and retries without duplicate cards', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const items = Array.from({ length: 5 }, (_, index) => ({
    id: 800000 + index, artistId: 999999, artistName: 'Pagination fixture', title: `Page fixture ${index}`, description: 'Temporary read-only feed fixture',
    status: 'published', allowRemix: false, media: { id: `fixture-media-${index}`, kind: 'audio', url: '/discovery-demo/soft-signal.wav' },
    social: { stars: 0, comments: 0, starred: false, saved: false }, offers: [], project: null,
  }));
  let nextCalls = 0, failNext = true;
  let release: (() => void) | undefined;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/feed?*', async route => {
    const offset = Number(new URL(route.request().url()).searchParams.get('offset'));
    if (offset === 0) return route.fulfill({ json: { items: items.slice(0, 3), nextCursor: 3, snapshot: 'immersive-pages' } });
    nextCalls++;
    if (failNext) { await pending; return route.fulfill({ status: 503, json: { error: 'Next page unavailable' } }); }
    return route.fulfill({ json: { items: items.slice(3), nextCursor: null, snapshot: 'immersive-pages' } });
  });
  await page.goto('/discovery');
  const feed = page.getByRole('region', { name: 'Discovery feed', exact: true });
  await feed.focus(); await feed.press('ArrowDown');
  await expect.poll(() => nextCalls).toBe(1);
  await feed.press('ArrowDown'); await feed.press('ArrowUp'); await feed.press('ArrowDown');
  expect(nextCalls).toBe(1);
  release!();
  const retry = page.getByRole('button', { name: 'Retry loading', exact: true });
  await expect(retry).toBeVisible();
  await expect(active(page)).toHaveAttribute('data-index', '2');
  await page.waitForTimeout(300); expect(nextCalls).toBe(1);
  failNext = false;
  await retry.click();
  await expect(page.locator('.discovery-post')).toHaveCount(5);
  expect(nextCalls).toBe(2);
  await expect(active(page)).toHaveAttribute('data-index', '2');
  const labels = await page.locator('.discovery-post').evaluateAll(elements => elements.map(element => element.getAttribute('aria-label')));
  expect(new Set(labels).size).toBe(5);
  await feed.focus(); await feed.press('ArrowDown'); await feed.press('ArrowDown');
  await expect(active(page)).toHaveAttribute('data-index', '4');
  await expect(page.getByRole('link', { name: 'Refresh feed', exact: true })).toBeVisible();
  expect((await feed.boundingBox())!.height).toBe(780);
  await page.setViewportSize({ width: 767, height: 900 });
  await expect(active(page)).toHaveAttribute('data-index', '4');
  expect((await feed.boundingBox())!.height).toBe(836);
  await page.setViewportSize({ width: 768, height: 900 });
  await expect(active(page)).toHaveAttribute('data-index', '4');
  await expect(page.locator('.discovery-heading')).toBeVisible();
});
