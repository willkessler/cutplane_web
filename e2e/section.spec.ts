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
  let s = await page.evaluate(() => window.__cutplane!.state());
  expect(s.yaw).toBe(90);
  expect(s.pitch).toBe(10);
  await page.keyboard.press('Space');
  s = await page.evaluate(() => window.__cutplane!.state());
  expect(s.z).toBe(-499);
  await page.keyboard.press('Space');
  s = await page.evaluate(() => window.__cutplane!.state());
  expect(s.z).toBe(0);
  expect(errors).toEqual([]);
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
  await page.mouse.wheel(0, 200);
  await expect
    .poll(async () => (await page.evaluate(() => window.__cutplane!.state())).z)
    .toBeLessThan(z0);
});
