import { expect, test } from '@playwright/test';

test('serves the app and renders a WebGL canvas', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/');
  await expect(page).toHaveTitle('Cutplane');
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');

  const hasWebGL = await page
    .locator('#viewport')
    .evaluate((c: HTMLCanvasElement) => c.getContext('webgl2') !== null);
  expect(hasWebGL).toBe(true);
  expect(errors).toEqual([]);
});
