import { expect, test } from '@playwright/test';

// Held keys and buttons, through real pointer and key events (windowed mode).
// WebKit gives no movementX/Y without pointer lock, so the motion must come from positions.
test('⌘ + move turns the room, ⌥ + move pushes the plane, with no setting to choose', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 700 });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
  const state = () => page.evaluate(() => window.__cutplane!.state());
  await page.mouse.move(500, 350);
  await page.mouse.move(510, 355);
  const start = await state();

  await page.keyboard.down('Meta');
  for (let i = 0; i < 10; i++) await page.mouse.move(520 + i * 10, 360 + i * 3);
  await page.keyboard.up('Meta');
  const turned = await state();
  expect(turned.yaw).not.toBe(start.yaw);
  expect(turned.pitch).not.toBe(start.pitch);
  expect(turned.x).toBe(start.x); // the crosshair stays put

  await page.keyboard.down('Alt');
  for (let i = 0; i < 10; i++) await page.mouse.move(620, 380 - i * 10);
  await page.keyboard.up('Alt');
  const pushed = await state();
  expect(pushed.z).toBeLessThan(turned.z);
  expect(pushed.yaw).toBe(turned.yaw);
});

test('a mouse: right-drag turns the room, middle-drag pushes the plane', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 700 });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
  const state = () => page.evaluate(() => window.__cutplane!.state());
  await page.mouse.move(500, 350);
  await page.mouse.move(510, 355);
  const start = await state();

  await page.mouse.down({ button: 'right' });
  for (let i = 0; i < 10; i++) await page.mouse.move(520 + i * 10, 360 + i * 3);
  await page.mouse.up({ button: 'right' });
  const turned = await state();
  expect(turned.yaw).not.toBe(start.yaw);

  await page.mouse.down({ button: 'middle' });
  for (let i = 0; i < 10; i++) await page.mouse.move(620, 380 - i * 10);
  await page.mouse.up({ button: 'middle' });
  const pushed = await state();
  expect(pushed.z).toBeLessThan(turned.z);
  expect(pushed.yaw).toBe(turned.yaw);
});
