import { test, expect, type Page, type Browser, type TestInfo } from '@playwright/test';
const headers = { Origin: 'http://127.0.0.1:4175', 'X-Nebula-Request': '1' };
async function rpc(page: Page, method: string, ...args: unknown[]) {
  const response = await page.request.post('/api/rpc', { headers, data: { method, args } }); expect(response.ok()).toBe(true); return (await response.json()).result;
}
async function fixture(page: Page, browser: Browser, info: TestInfo) {
  const tag = `${info.project.name}-${Date.now()}`;
  await rpc(page, 'register', { name: 'Workspace Owner', role: 'artist', email: `ux-owner-${tag}@example.invalid`, password: 'preview123' });
  const project = await rpc(page, 'createProject', { title: 'Shared workspace', category: 'EP', goalAmount: 1000, status: 'published' });
  const offerResponse = await page.request.post(`/api/projects/${project.id}/offers`, { headers, data: { need: 'Verse', deliverable: 'Dry vocals', requirements: 'One revision, artist credit.', deadline: null, compensation: { kind: 'fee', amount: 200, currency: 'USD' }, status: 'open' } });
  expect(offerResponse.ok()).toBe(true); const offer = await offerResponse.json();
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:4175', viewport: page.viewportSize()!, isMobile: info.project.name === 'mobile', hasTouch: info.project.name === 'mobile' });
  const artist = await context.newPage();
  await rpc(artist, 'register', { name: 'Workspace Artist', role: 'artist', email: `ux-artist-${tag}@example.invalid`, password: 'preview123' });
  const response = await artist.request.post(`/api/offers/${offer.id}/conversations`, { headers, data: {} }); expect(response.ok()).toBe(true);
  const thread = await response.json(); const path = `/collaborations/${thread.id}`;
  await artist.goto(path);
  return { context, artist, thread, path, offer, project };
}
const pdf = { name: 'Proposal notes.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\nProposal notes\n%%EOF') };
const proposal = (page: Page) => page.getByRole('form', { name: 'Proposal form', exact: true });

test('working copies survive parent return, reload, notification overlay and failed refresh', async ({ page, browser }, info) => {
  test.setTimeout(60_000);
  const { context, artist, path } = await fixture(page, browser, info);
  try {
    await expect(artist.getByText('Collaborating artist', { exact: true })).toBeVisible();
    await expect(artist.getByRole('region', { name: 'Next step' })).toContainText('Ask a question');
    await artist.getByRole('textbox', { name: 'Your proposal', exact: true }).fill('Keep these proposal notes.');
    await artist.getByRole('textbox', { name: 'Message', exact: true }).fill('Keep this private message.');
    await artist.getByLabel('Work files (audio, video, PDF or ZIP)', { exact: true }).setInputFiles(pdf);
    await expect(proposal(artist).getByRole('link', { name: 'Download Proposal notes.pdf' })).toBeVisible();
    await artist.locator('[data-notification-bell]:visible').click();
    await artist.keyboard.press('Escape');
    await expect(artist.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('Keep this private message.');
    await artist.getByRole('link', { name: 'All collaborations', exact: true }).click();
    await expect(artist.getByRole('button', { name: 'Sent', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await artist.getByRole('link', { name: /Shared workspace · Verse/ }).click();
    await expect(artist.getByRole('textbox', { name: 'Your proposal', exact: true })).toHaveValue('Keep these proposal notes.');
    await artist.reload();
    await expect(artist.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('Keep this private message.');
    await expect(proposal(artist).getByRole('link', { name: 'Download Proposal notes.pdf' })).toBeVisible();
    await artist.route(`**/api${path}`, route => route.request().method() === 'GET' ? route.fulfill({ status: 503, json: { error: 'Temporary connection problem.' } }) : route.continue());
    await expect(artist.getByRole('button', { name: 'Retry collaboration' })).toBeVisible({ timeout: 15_000 });
    await expect(artist.getByRole('textbox', { name: 'Your proposal', exact: true })).toHaveValue('Keep these proposal notes.');
    await artist.unroute(`**/api${path}`); await artist.getByRole('button', { name: 'Retry collaboration' }).click();
    await expect(artist.getByRole('button', { name: 'Retry collaboration' })).toHaveCount(0);
    await artist.getByRole('link', { name: 'All collaborations', exact: true }).scrollIntoViewIfNeeded();
    await artist.screenshot({ path: info.outputPath('applicant-workspace.png') });
    await page.goto(path); await expect(page.getByText('Project owner', { exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath('owner-workspace.png') });
    expect(await artist.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const shapes = await artist.evaluate(() => ({ field: getComputedStyle(document.querySelector('textarea')!).borderRadius, panel: getComputedStyle(document.querySelector('[aria-label="Next step"]')!).borderRadius, button: getComputedStyle(document.querySelector('button[type="submit"]') ?? document.querySelector('form button:last-child')!).borderRadius }));
    expect(shapes.field).toBe('12px'); expect(shapes.panel).toBe('0px'); expect(parseFloat(shapes.button)).toBeGreaterThan(100);
    await artist.goto('/profile'); await artist.getByRole('button', { name: 'LOGOUT', exact: true }).click();
    await expect(artist).toHaveURL(/\/$/);
    await expect.poll(() => artist.evaluate(() => Object.keys(sessionStorage).filter(key => key.startsWith('nebula-collaboration-draft:')))).toEqual([]);
  } finally { await context.close(); }
});

test('stale terms retain files and text; decline and withdrawal require deliberate confirmation', async ({ page, browser }, info) => {
  const { context, artist, path, offer } = await fixture(page, browser, info);
  try {
    await artist.getByRole('textbox', { name: 'Your proposal', exact: true }).fill('A proposal to keep after conflict.');
    await artist.getByLabel('Work files (audio, video, PDF or ZIP)', { exact: true }).setInputFiles(pdf);
    await artist.getByRole('checkbox').check();
    await expect(artist.getByRole('button', { name: 'Send proposal', exact: true })).toBeEnabled();
    const updated = await page.request.patch(`/api/offers/${offer.id}`, { headers, data: { ...offer, revision: offer.revision, compensation: { kind: 'fee', amount: 350, currency: 'USD' } } }); expect(updated.ok()).toBe(true);
    await artist.getByRole('button', { name: 'Send proposal', exact: true }).click();
    await expect(proposal(artist)).toContainText('USD 350.00');
    await expect(artist.getByRole('checkbox')).not.toBeChecked();
    await expect(artist.getByRole('textbox', { name: 'Your proposal', exact: true })).toHaveValue('A proposal to keep after conflict.');
    await expect(proposal(artist).getByRole('link', { name: 'Download Proposal notes.pdf' })).toBeVisible();
    await artist.getByRole('checkbox').check(); await artist.getByRole('button', { name: 'Send proposal', exact: true }).click();
    await expect(proposal(artist)).toHaveCount(0);
    await page.goto(path);
    page.once('dialog', async dialog => { expect(dialog.message()).toContain('Submitted files and the conversation remain available'); await dialog.dismiss(); });
    await page.getByRole('button', { name: 'Decline proposal', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Accept proposal', exact: true })).toBeEnabled();
    artist.once('dialog', async dialog => { expect(dialog.message()).toContain('not be able to submit more work'); await dialog.dismiss(); });
    await artist.getByRole('button', { name: 'Withdraw proposal', exact: true }).click();
    await expect(artist.locator('header').getByText('submitted', { exact: true })).toBeVisible();
    page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: 'Decline proposal', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Next step' })).toContainText('application is closed');
    const response = await artist.request.get(`/api${path}`); const detail = await response.json();
    expect(detail.status).toBe('rejected'); expect(detail.submissions).toHaveLength(1); expect(detail.submissions[0].terms.compensation.amount).toBe(350);
  } finally { await context.close(); }
});

test('upload guard retains active work and duplicate submissions or messages produce one mutation', async ({ page, browser }, info) => {
  const { context, artist, path } = await fixture(page, browser, info);
  try {
    let releaseUpload!: () => void; const gate = new Promise<void>(resolve => { releaseUpload = resolve; });
    await artist.route('**/api/uploads', async route => { await gate; await route.continue(); });
    await artist.getByRole('textbox', { name: 'Your proposal', exact: true }).fill('One submission only.');
    await artist.getByLabel('Work files (audio, video, PDF or ZIP)', { exact: true }).setInputFiles(pdf);
    await expect(artist.getByText(/^Uploading \d+%$/)).toBeVisible();
    artist.once('dialog', dialog => dialog.dismiss()); await artist.getByRole('link', { name: 'All collaborations', exact: true }).click();
    await expect(artist).toHaveURL(new RegExp(path + '$')); await expect(artist.getByText(/^Uploading \d+%$/)).toBeVisible();
    releaseUpload(); await expect(proposal(artist).getByRole('link', { name: 'Download Proposal notes.pdf' })).toBeVisible();
    await artist.getByRole('checkbox').check();
    let writes = 0; let releaseWrite!: () => void; const writeGate = new Promise<void>(resolve => { releaseWrite = resolve; });
    await artist.route(`**/api${path}`, async route => { if (route.request().method() === 'PATCH') { writes++; await writeGate; } await route.continue(); });
    await proposal(artist).evaluate(form => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    await expect.poll(() => writes).toBe(1); await expect(artist.getByRole('textbox', { name: 'Your proposal', exact: true })).toBeDisabled();
    releaseWrite(); await expect(proposal(artist)).toHaveCount(0);
    let messages = 0;
    await artist.route(`**/api${path}/messages`, async route => { messages++; await route.continue(); });
    await artist.getByRole('textbox', { name: 'Message', exact: true }).fill('One message only.');
    await artist.getByRole('region', { name: 'Private conversation' }).locator('form').evaluate(form => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    await expect(artist.getByRole('region', { name: 'Private conversation' }).getByText('One message only.', { exact: true })).toHaveCount(1); expect(messages).toBe(1);
    expect((await (await artist.request.get(`/api${path}`)).json()).submissions).toHaveLength(1);
  } finally { await context.close(); }
});

test('list return restores scroll and sent view; offer editing resumes without stale saved defaults', async ({ page, browser }, info) => {
  const { context, artist, thread, project } = await fixture(page, browser, info);
  try {
    const rows = [...Array.from({ length: 20 }, (_, index) => ({ ...thread, id: index + 1000, projectTitle: `Earlier project ${index}` })), thread];
    await artist.route('**/api/collaborations', route => route.fulfill({ json: { items: rows, nextCursor: null } }));
    await artist.goto('/collaborations'); await artist.getByRole('button', { name: 'Sent', exact: true }).click();
    const link = artist.getByRole('link', { name: /Shared workspace · Verse/ }); await link.scrollIntoViewIfNeeded();
    const position = () => artist.evaluate(() => ({ window: scrollY, body: document.body.scrollTop, shell: document.querySelector('.shell-page')?.scrollTop ?? 0 }));
    const before = await position(); expect(before.window + before.body + before.shell).toBeGreaterThan(300);
    await link.click(); await artist.getByRole('link', { name: 'All collaborations', exact: true }).click();
    await expect(artist.getByRole('button', { name: 'Sent', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(position).toEqual(before);
    await page.goto(`/project/${project.id}`); await page.getByRole('button', { name: 'Edit offer', exact: true }).click();
    await page.getByRole('textbox', { name: 'Expected deliverable', exact: true }).fill('Preserved edit of the brief.');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    const latest = (await (await page.request.get(`/api/projects/${project.id}/offers`)).json())[0];
    const changed = await page.request.patch(`/api/offers/${latest.id}`, { headers, data: { ...latest, requirements: 'Updated terms from another edit.' } }); expect(changed.ok()).toBe(true);
    await page.reload();
    await page.getByRole('button', { name: 'Edit offer', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Updated offer' })).toContainText('Updated terms from another edit.');
    await expect(page.getByRole('button', { name: 'Save offer', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Keep my edits with this version', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Expected deliverable', exact: true })).toHaveValue('Preserved edit of the brief.');
    await page.getByRole('button', { name: 'Save offer', exact: true }).click(); await expect(page.getByRole('form', { name: 'Offer editor' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Edit offer', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Expected deliverable', exact: true })).toHaveValue('Preserved edit of the brief.');
  } finally { await context.close(); }
});
