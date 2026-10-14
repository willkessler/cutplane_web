import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

// The camera goodie: a click opens its window, "Camera's View" (nikon.cpl's
// toggle_slide); shots kept there fly over the world. Set SHOTS=dir to keep screenshots.
const SHOTS = process.env['SHOTS'];

type P3 = [number, number, number];
const set = (page: Page, p: Partial<{ x: number; y: number; z: number }>) =>
  page.evaluate((pp) => window.__cutplane!.set(pp), p);
const press = (page: Page) => page.evaluate(() => window.__cutplane!.press());
const release = (page: Page) => page.evaluate(() => window.__cutplane!.release());
const locate = <T>(page: Page, what: string) =>
  page.evaluate((w) => window.__cutplane!.locate(w), what) as Promise<T>;
const flyover = (page: Page) => page.evaluate(() => window.__cutplane!.flyover());

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

test('the camera opens its own window; shots kept there fly over the world', async ({
  page,
  browserName,
}) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1024, height: 700 });
  await page.goto('/?still=1&sample=discovery');
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');

  // Out of the goodies box, and forward into the room.
  const box = await locate<P3>(page, 'goodies');
  await set(page, { z: -480, x: box[0], y: box[1] });
  await press(page);
  await release(page);
  await carry(page, -250, 100, 300);
  expect((await flyover(page)).open).toBe(false);

  // A click on it: its window opens.
  const c = await locate<P3>(page, 'camera');
  await set(page, { x: c[0], y: c[1], z: c[2] });
  const popup = page.waitForEvent('popup');
  await press(page);
  await release(page);
  const win = await popup;
  await expect(win).toHaveTitle("Camera's View");
  expect(await flyover(page)).toMatchObject({ open: true, inRoom: false, shots: 0 });
  await expect(win.locator('#play')).toBeDisabled();

  await win.locator('#add').click();
  expect((await flyover(page)).shots).toBe(1);
  await carry(page, 300, 60, 150);
  await win.locator('#add').click();
  await carry(page, 0, -200, 0);
  await win.locator('#add').click();
  expect((await flyover(page)).shots).toBe(3);
  await expect(win.locator('#status')).toHaveText('3 shots · 6 s fly-over');

  await win.locator('#per').fill('1');
  await win.locator('#per').dispatchEvent('change');
  await expect(win.locator('#status')).toHaveText('3 shots · 2 s fly-over');
  await win.locator('#play').click();
  expect((await flyover(page)).playing).toBe(true);
  if (SHOTS && browserName === 'chromium') {
    mkdirSync(SHOTS, { recursive: true });
    await win.waitForTimeout(900);
    await win.screenshot({ path: `${SHOTS}/camera-window.png` });
    await page.screenshot({ path: `${SHOTS}/camera-path.png` });
  }
  await expect.poll(async () => (await flyover(page)).playing, { timeout: 10_000 }).toBe(false);

  // Closing the window turns the view off; a click on the camera opens it again,
  // with the shots still there.
  await win.close();
  await expect.poll(async () => (await flyover(page)).open).toBe(false);
  const again = page.waitForEvent('popup');
  const c2 = await locate<P3>(page, 'camera');
  await set(page, { x: c2[0], y: c2[1], z: c2[2] });
  await press(page);
  await release(page);
  const win2 = await again;
  await expect(win2.locator('#status')).toHaveText('3 shots · 2 s fly-over');
  // And another click on the camera closes it.
  await press(page);
  await release(page);
  await expect.poll(async () => (await flyover(page)).open).toBe(false);
  expect(errors).toEqual([]);
});
