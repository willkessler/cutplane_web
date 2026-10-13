import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

// M2: the section line, the plane and the room, driven through the logical-action
// hooks (pointer lock can't be driven headlessly). Set SHOTS=dir to keep screenshots.
const SHOTS = process.env['SHOTS'];

async function open(page: Page, query: string) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1024, height: 700 });
  await page.goto(`/?still=1&${query}`);
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
  return errors;
}

async function shot(page: Page, name: string, browserName: string) {
  if (!SHOTS || browserName !== 'chromium') return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

test('flies the plane through the flying hand (hand6.rsc)', async ({ page, browserName }) => {
  const errors = await open(page, 'src=original/rsc/hand6.rsc');
  // Plane in front of everything: no section.
  let stats = await page.evaluate(() => window.__cutplane!.stats());
  expect(stats.loops).toBe(0);

  const seen: number[] = [];
  let best = { z: 0, loops: -1 };
  for (let z = 120; z >= -360; z -= 20) {
    stats = await page.evaluate((zz) => {
      window.__cutplane!.set({ z: zz, yaw: 20, pitch: 15 });
      return window.__cutplane!.stats();
    }, z);
    expect(stats.openLoops).toBe(0);
    seen.push(stats.loops);
    if (stats.loops > best.loops) best = { z, loops: stats.loops };
  }
  expect(Math.max(...seen)).toBeGreaterThan(0);
  await page.evaluate(
    (z) => window.__cutplane!.set({ z, yaw: 20, pitch: 15, x: 150, y: -120 }),
    best.z,
  );
  await shot(page, 'hand6', browserName);
  expect(errors).toEqual([]);
});

test('sections the Discovery and respects the room limits', async ({ page, browserName }) => {
  const errors = await open(page, 'sample=discovery');
  const stats = await page.evaluate(() => {
    window.__cutplane!.set({ z: 0, yaw: -25, pitch: 12, x: 60, y: -40 });
    return window.__cutplane!.stats();
  });
  expect(stats.loops).toBeGreaterThan(0);
  expect(stats.openLoops).toBe(0);
  await shot(page, 'discovery', browserName);

  await page.evaluate(() => window.__cutplane!.set({ yaw: 0, pitch: 0 }));
  await page.locator('#viewport').focus();
  for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowUp');
  const s = await page.evaluate(() => window.__cutplane!.state());
  expect(s.yaw).toBe(90);
  expect(s.pitch).toBe(10);
  // Space glides the plane to the back wall over a quarter second, and back again.
  const z = async () => (await page.evaluate(() => window.__cutplane!.state())).z;
  await page.keyboard.press('Space');
  await expect.poll(z).toBeCloseTo(-499, 3);
  await page.keyboard.press('Space');
  await expect.poll(z).toBeCloseTo(0, 3);
  expect(errors).toEqual([]);
});

/** Pixels of section-line yellow (front faces and in-plane edges) in the current frame. */
async function yellowPixels(page: Page): Promise<number> {
  const data = await page.evaluate(() => window.__cutplane!.readPixels());
  const px = Buffer.from(data.slice(data.indexOf(':') + 1), 'base64');
  let n = 0;
  for (let i = 0; i < px.length; i += 4)
    if (px[i]! > 180 && px[i + 1]! > 180 && px[i + 2]! < 60) n++;
  return n;
}

test('a section that grows is drawn in full (both fans)', async ({ page, browserName }) => {
  const pose = { z: 354.4, yaw: -13, pitch: 11, x: 450, y: 300 };
  await open(page, 'sample=single-fan');
  await page.evaluate((p) => window.__cutplane!.set(p), pose);
  const fresh = await yellowPixels(page);
  expect(fresh).toBeGreaterThan(200);

  // Draw a tiny section first, then the big one: line geometry must not stay at the small size.
  await open(page, 'sample=single-fan');
  await page.evaluate(() =>
    window.__cutplane!.set({ z: 515, yaw: -13, pitch: 11, x: 450, y: 300 }),
  );
  await page.evaluate((p) => window.__cutplane!.set(p), pose);
  expect(await yellowPixels(page)).toBe(fresh);
  await shot(page, 'fans', browserName);
});

test('scroll pushes the plane and the crosshair follows the pointer', async ({ page }) => {
  await open(page, 'sample=discovery');
  const box = (await page.locator('#viewport').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  let s = await page.evaluate(() => window.__cutplane!.state());
  expect(Math.abs(s.x)).toBeLessThan(5);
  expect(Math.abs(s.y)).toBeLessThan(5);
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height / 2);
  s = await page.evaluate(() => window.__cutplane!.state());
  expect(s.x).toBeGreaterThan(100);
  const z0 = s.z;
  // A mouse wheel rolled up (away from you) pushes the plane away. Sent as a real wheel
  // reports itself, in lines: Playwright's own wheel events look like a trackpad's swipe.
  await page.evaluate(
    ([x, y]) =>
      document.getElementById('viewport')!.dispatchEvent(
        new WheelEvent('wheel', {
          deltaY: -3,
          deltaMode: 1,
          clientX: x,
          clientY: y,
          bubbles: true,
          cancelable: true,
        }),
      ),
    [box.x + box.width * 0.75, box.y + box.height / 2],
  );
  await expect
    .poll(async () => (await page.evaluate(() => window.__cutplane!.state())).z)
    .toBeLessThan(z0);
});
