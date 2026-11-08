import { test, expect, type Page } from '@playwright/test';

const headers = { Origin: 'http://127.0.0.1:4175', 'X-Nebula-Request': '1' };
async function rpc(page: Page, method: string, ...args: unknown[]) {
  const response = await page.request.post('/api/rpc', { headers, data: { method, args } });
  expect(response.ok(), await response.text()).toBeTruthy(); return (await response.json()).result;
}
async function editor(page: Page) {
  const user = await rpc(page, 'register', { name: 'Taxonomy Artist', email: `${crypto.randomUUID()}@example.invalid`, password: 'preview123', role: 'artist' });
  await rpc(page, 'updateArtist', { name: user.name, genre: 'Demo projects', genres: ['Hip hop', 'RnB', 'Jazz / Soul'] });
  await page.goto('/profile');
  await page.getByRole('button', { name: 'EDIT PROFILE', exact: true }).click();
  return user;
}

test('structured profile selections persist, clear explicitly and preserve legacy data', async ({ page }) => {
  const user = await editor(page);
  const roles = page.getByRole('button', { name: 'Choose creative roles', exact: true });
  await roles.click();
  const input = page.getByRole('combobox', { name: 'Search creative roles' });
  await expect(input).toBeFocused();
  await input.fill('producer'); await input.press('Enter');
  await expect(page.getByRole('option', { name: /^Music Producer/ })).toHaveAttribute('aria-selected', 'true');
  await input.press('Enter'); // Toggling cannot create duplicates.
  await expect(page.getByRole('option', { name: /^Music Producer/ })).toHaveAttribute('aria-selected', 'false');
  await input.press('Enter');
  await input.fill(''); await input.press('Home'); await input.press('ArrowDown'); await input.press('Enter');
  await input.fill('writer'); await input.press('End'); await input.press('Enter');
  await input.press('Escape'); await expect(roles).toBeFocused();
  for (const label of ['Music Producer', 'Rapper', 'Songwriter', 'Hip-hop', 'R&B']) await expect(page.getByRole('button', { name: `Remove ${label}`, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Choose musical genres', exact: true }).click();
  const genres = page.getByRole('combobox', { name: 'Search musical genres' });
  await genres.fill('DnB'); await genres.press('Enter');
  await genres.fill('not a genre'); await expect(page.getByText('No matching options.', { exact: true })).toBeVisible();
  await genres.press('Enter'); await expect(page.getByRole('heading', { name: 'edit artist profile' })).toBeVisible();
  await genres.press('Escape');
  await page.getByText('Previous profile values', { exact: true }).click();
  await expect(page.getByText('Genres kept for review: Jazz / Soul, Demo projects', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'save profile', exact: true }).click();
  await expect(page.getByRole('button', { name: 'EDIT PROFILE', exact: true })).toBeVisible();
  await page.reload();
  let artist = (await rpc(page, 'getArtist', user.artistId)).artist;
  expect(artist).toMatchObject({ creativeRoles: ['producer', 'rapper', 'songwriter'], genreIds: ['hip-hop', 'rnb', 'drum-and-bass'], genre: 'Demo projects', genres: ['Hip hop', 'RnB', 'Jazz / Soul'] });
  await page.getByRole('button', { name: 'EDIT PROFILE', exact: true }).click();
  await page.getByRole('button', { name: 'Remove Rapper', exact: true }).click();
  await expect(roles).toBeFocused();
  await page.getByRole('button', { name: 'save profile', exact: true }).click();
  await expect(page.getByRole('button', { name: 'EDIT PROFILE', exact: true })).toBeVisible();
  expect((await rpc(page, 'getArtist', user.artistId)).artist.creativeRoles).toEqual(['producer', 'songwriter']);
  await page.getByRole('button', { name: 'EDIT PROFILE', exact: true }).click();
  await page.getByRole('button', { name: 'Clear creative roles', exact: true }).click();
  await page.getByRole('button', { name: 'Clear musical genres', exact: true }).click();
  await page.getByRole('button', { name: 'save profile', exact: true }).click();
  await expect(page.getByRole('button', { name: 'EDIT PROFILE', exact: true })).toBeVisible();
  await page.reload();
  artist = (await rpc(page, 'getArtist', user.artistId)).artist;
  expect(artist.creativeRoles).toEqual([]); expect(artist.genreIds).toEqual([]);
  expect(artist.genres).toEqual(['Hip hop', 'RnB', 'Jazz / Soul']);
  await page.getByRole('button', { name: 'EDIT PROFILE', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Remove / })).toHaveCount(0);
});

test('selectors fit the viewport, retain edits after errors and cancel without saving', async ({ page, isMobile }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const user = await editor(page);
  await page.getByRole('button', { name: 'Choose musical genres', exact: true }).click();
  const search = page.getByRole('combobox', { name: 'Search musical genres' });
  await search.fill('electrónica');
  const option = page.getByRole('option', { name: 'Electronic', exact: true });
  if (isMobile) await option.tap(); else await option.click();
  await search.fill('house');
  const subgenre = page.getByRole('option', { name: /^Deep House/ });
  await expect(subgenre).toContainText('House · subgenre');
  if (isMobile) await subgenre.tap(); else await subgenre.click();
  const popup = page.getByRole('dialog', { name: 'Musical genres selector' });
  const bounds = await popup.boundingBox(), viewport = page.viewportSize()!;
  expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
  expect(bounds!.y).toBeGreaterThanOrEqual(0); expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
  expect((await option.count())).toBe(0); // Searching actually narrows the taxonomy.
  expect((await subgenre.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: info.outputPath('genre-selector.png'), fullPage: false, animations: 'disabled' });
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(popup).toBeHidden();
  if (isMobile) {
    await page.setViewportSize({ width: 844, height: 390 });
    await page.getByRole('button', { name: 'Choose creative roles', exact: true }).click();
    const rolePopup = page.getByRole('dialog', { name: 'Creative roles selector' });
    await expect(rolePopup.getByRole('button', { name: 'Done', exact: true })).toBeInViewport();
    await page.screenshot({ path: info.outputPath('landscape-selector.png'), animations: 'disabled' });
    await rolePopup.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(rolePopup).toBeHidden();
    await page.setViewportSize(viewport);
  }
  await page.route('**/api/rpc', async route => {
    if (route.request().postDataJSON()?.method === 'updateArtistIdentity') await route.fulfill({ status: 400, json: { error: 'Choose a supported creative role.' } });
    else await route.continue();
  });
  await page.getByRole('button', { name: 'save profile', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Choose a supported creative role.');
  await expect(page.getByRole('button', { name: 'Remove Electronic', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove Deep House', exact: true })).toBeVisible();
  await page.unroute('**/api/rpc');
  await page.getByRole('button', { name: 'cancel', exact: true }).click();
  expect((await rpc(page, 'getArtist', user.artistId)).artist.genreIds).toEqual(['hip-hop', 'rnb']);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  expect(errors).toEqual([]);
});
