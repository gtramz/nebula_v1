import type { Page } from '@playwright/test';

/** Use the same Profile logout action through its responsive placement. */
export async function clickProfileLogout(page: Page) {
  if (await page.evaluate(() => matchMedia('(min-width: 768px)').matches)) {
    await page.getByRole('button', { name: 'LOGOUT', exact: true }).click();
  } else {
    await page.getByRole('button', { name: 'More', exact: true }).filter({ visible: true }).click();
    await page.getByRole('menuitem', { name: 'Logout', exact: true }).click();
  }
}
