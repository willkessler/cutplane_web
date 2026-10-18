import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

// The camera goodie: a click shows its view (nikon.cpl's toggle_slide) on a
// small screen floating in the room above it. Set SHOTS=dir to keep screenshots.
const SHOTS = process.env['SHOTS'];

type P3 = [number, number, number];
const set = (page: Page, p: Partial<{ x: number; y: number; z: number }>) =>
  page.evaluate((pp) => window.__cutplane!.set(pp), p);
const press = (page: Page) => page.evaluate(() => window.__cutplane!.press());
const release = (page: Page) => page.evaluate(() => window.__cutplane!.release());
const locate = <T>(page: Page, what: string) =>
  page.evaluate((w) => window.__cutplane!.locate(w), what) as Promise<T>;
const shown = (page: Page) => page.evaluate(() => window.__cutplane!.cameraView());

/** Presses on the camera and carries it by (dx, dy) in the plane, then forward by dz. */
async function carry(page: Page, dx: number, dy: number, dz: number) {
  const c = await locate<P3>(page, 'camera');
  await set(page, { z: c[2], x: c[0], y: c[1] });
  await press(page);
  for (let i = 1; i <= 10; i++)
    await set(page, { x: c[0] + (dx * i) / 10, y: c[1] + (dy * i) / 10 });
  for (let i = 1; i <= 10; i++) await set(page, { z: c[2] + (dz * i) / 10 });
  await release(page);
}

test('a click on the camera shows its view on a screen in the room; another puts it away', async ({
  page,
  browserName,
}) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  let popups = 0;
  page.on('popup', () => popups++);
  await page.setViewportSize({ width: 1024, height: 700 });
  await page.goto('/?still=1&sample=discovery');
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');

  // Out of the goodies box, and forward into the room.
  const box = await locate<P3>(page, 'goodies');
  await set(page, { z: -480, x: box[0], y: box[1] });
  await press(page);
  await release(page);
  await carry(page, -250, 100, 300);
  expect(await shown(page)).toBe(false);

  // A click on it: its screen comes up, with no window of its own.
  const c = await locate<P3>(page, 'camera');
  await set(page, { x: c[0], y: c[1], z: c[2] });
  await press(page);
  await release(page);
  await expect.poll(() => shown(page)).toBe(true);
  // It goes with the camera.
  await carry(page, 200, 0, 0);
  expect(await shown(page)).toBe(true);
  if (SHOTS && browserName === 'chromium') {
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/camera-screen.png` });
  }

  // Another click on the camera puts it away.
  const c2 = await locate<P3>(page, 'camera');
  await set(page, { x: c2[0], y: c2[1], z: c2[2] });
  await press(page);
  await release(page);
  await expect.poll(() => shown(page)).toBe(false);
  expect(popups).toBe(0);
  expect(errors).toEqual([]);
});
