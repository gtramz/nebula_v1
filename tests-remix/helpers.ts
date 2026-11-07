import { expect, type Page } from '@playwright/test';
export async function openLegacy(page: Page, path: string) {
  await page.goto(path);
  await expect(page).toHaveURL(/\/studio\/remix$/);
  await page.getByRole('button',{name:'Start private remix',exact:true}).click();
  await expect(page.getByLabel('Remix title',{exact:true})).toBeVisible();
}
export async function previewReady(page: Page, options: { timeout?: number } = {}) {
  await expect(page.getByRole('region',{name:'Remix preview',exact:true}).locator('audio,video')).toBeVisible(options);
  await expect(page.getByRole('button',{name:'Save remix draft',exact:true})).toBeEnabled(options);
}
export async function noPreview(page: Page) {
  await expect(page.getByRole('region',{name:'Remix preview',exact:true}).locator('audio,video')).toHaveCount(0);
}
