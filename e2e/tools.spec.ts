import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

// M4: the rotate tool, duplicate and delete, driven through the test hooks.
// Set SHOTS=dir to keep screenshots.
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

type Pose = Partial<{ x: number; y: number; z: number; yaw: number; pitch: number }>;
const set = (page: Page, p: Pose) => page.evaluate((pp) => window.__cutplane!.set(pp), p);
const edit = (page: Page) => page.evaluate(() => window.__cutplane!.edit());
const tool = (page: Page) => page.evaluate(() => window.__cutplane!.tool());
const press = (page: Page) => page.evaluate(() => window.__cutplane!.press());
const release = (page: Page) => page.evaluate(() => window.__cutplane!.release());

test('the rotate tool: docked, brought to the cube with R, rolling it', async ({
  page,
  browserName,
}) => {
  const errors = await open(page, 'sample=cube');
  await set(page, { yaw: -30, pitch: 20, z: 0, x: 0, y: 0 });
  expect((await tool(page)).center).toEqual([347.5, 220.5]);
  await shot(page, 'tool-docked', browserName);

  await page.keyboard.press('KeyR');
  expect((await tool(page)).center).toEqual([0, 0]);
  expect((await edit(page)).picked).toEqual(['object']);

  // Grab the horizontal bar and slide right: the cube rolls about the vertical axis.
  await set(page, { x: 60, y: 4 });
  expect((await tool(page)).hover).toBe('bar');
  await shot(page, 'tool-hover-bar', browserName);
  await press(page);
  for (let x = 62; x <= 100; x += 2) await set(page, { x, y: 4 + (x % 7) });
  expect((await tool(page)).rotating).toBe(true);
  const at = await page.evaluate(() => window.__cutplane!.state());
  expect(at.y).toBe(4); // held parallel to the bar (create_xbar_rotrec keeps the offset)
  await shot(page, 'tool-rolled', browserName);
  await release(page);

  // The section through the turned cube is still one closed loop.
  const stats = await page.evaluate(() => window.__cutplane!.stats());
  expect(stats.loops).toBe(1);
  await page.evaluate(() => window.__cutplane!.undo());

  // R on the tool's centre puts it away.
  await set(page, { x: 0, y: 0 });
  await page.keyboard.press('KeyR');
  expect((await tool(page)).center).toEqual([347.5, 220.5]);
  expect(errors).toEqual([]);
});

test('D duplicates the picked cube; Backspace deletes; undo brings it back', async ({
  page,
  browserName,
}) => {
  const errors = await open(page, 'sample=cube');
  await set(page, { yaw: -30, pitch: 20, z: 0, x: 0, y: 0 });
  await press(page);
  await release(page);
  await page.keyboard.press('KeyD');
  let s = await edit(page);
  expect(s.faces).toBe(12);
  expect(s.picked).toEqual(['object']);
  await shot(page, 'duplicated', browserName);
  await page.keyboard.press('Backspace');
  expect((await edit(page)).faces).toBe(6);
  await page.keyboard.press('ControlOrMeta+KeyZ');
  expect((await edit(page)).faces).toBe(12);

  // A corner vertex goes: the corner is cut off.
  await page.keyboard.press('ControlOrMeta+KeyZ');
  await set(page, { z: 100, x: 100, y: 100 });
  await press(page);
  await release(page);
  expect((await edit(page)).picked).toEqual(['vertex']);
  await page.keyboard.press('Backspace');
  s = await edit(page);
  expect([s.vertices, s.faces]).toEqual([7, 7]);
  await set(page, { z: 60 });
  await shot(page, 'corner-deleted', browserName);
  expect(errors).toEqual([]);
});

test('a picked cube gets a scale box; its edge handle stretches it', async ({
  page,
  browserName,
}) => {
  const errors = await open(page, 'sample=cube');
  await set(page, { yaw: -30, pitch: 20, z: 0, x: 0, y: 0 });
  await press(page);
  await release(page);
  await set(page, { x: 121, y: 121 });
  expect((await edit(page)).hover).toBeNull(); // the handle, not the cube, has the crosshair
  await shot(page, 'scalebox-hover', browserName);
  await press(page);
  for (let i = 1; i <= 10; i++) await set(page, { x: 121 + 8 * i, y: 121 + 4 * i });
  await shot(page, 'scalebox-stretch', browserName);
  await release(page);
  const stats = await page.evaluate(() => window.__cutplane!.stats());
  expect(stats.loops).toBe(1);
  await page.evaluate(() => window.__cutplane!.undo());
  expect(errors).toEqual([]);
});

test('the colour control by the back wall: a bar recolours the picked cube, the chip paints', async ({
  page,
  browserName,
}) => {
  test.setTimeout(60_000);
  const errors = await open(page, 'sample=cube');
  await set(page, { yaw: -30, pitch: 20, z: 0, x: 0, y: 0 });
  await press(page);
  await release(page);
  const color = () => page.evaluate(() => window.__cutplane!.color());

  // Space: the plane jumps to the back wall, where the control stands.
  await page.keyboard.press('Space');
  await set(page, { x: 312, y: -230 });
  expect((await color()).hover).toBe('bar');
  await shot(page, 'color-hover', browserName);
  const before = (await color()).rgb;
  await press(page);
  for (let y = -235; y >= -290; y -= 5) await set(page, { x: 312, y });
  await release(page);
  const after = (await color()).rgb;
  expect(after[0]).toBeLessThan(before[0]!);
  expect((await edit(page)).colors[0]).toEqual(after); // the picked cube took it as it went
  await shot(page, 'color-bar', browserName);

  // Turn the blue right down, then carry the chip to the cube and drop it there.
  await set(page, { x: 392, y: -230 });
  await press(page);
  for (let y = -235; y >= -310; y -= 5) await set(page, { x: 392, y });
  await release(page);
  await page.evaluate(() => window.__cutplane!.undo()); // takes the cube's colour back...
  const mix = (await color()).rgb; // ...but the control keeps its setting
  await set(page, { z: -470, x: 442, y: -322 });
  expect((await color()).hover).toBe('chip');
  await press(page);
  await set(page, { z: -300 });
  await set(page, { z: 0, x: 200, y: 0 });
  await set(page, { x: 0, y: 0 });
  await shot(page, 'color-chip', browserName);
  await release(page);
  expect((await edit(page)).colors[0]).toEqual(mix);
  expect(errors).toEqual([]);
});

test('the colour control comes along when its base is dragged', async ({ page, browserName }) => {
  test.setTimeout(60_000);
  const errors = await open(page, 'sample=cube');
  await set(page, { yaw: -30, pitch: 20, z: 0, x: 0, y: 0 });
  const color = () => page.evaluate(() => window.__cutplane!.color());
  await page.keyboard.press('Space');
  await set(page, { x: 300, y: -340 });
  expect((await color()).hover).toBe('base');
  const from = (await color()).base;
  await press(page);
  for (let i = 1; i <= 10; i++) await set(page, { x: 300 - 15 * i, y: -340 + 10 * i });
  await set(page, { z: -300 }); // the plane carries it forward too
  await release(page);
  const to = (await color()).base;
  expect(to[0]! - from[0]!).toBeCloseTo(-150);
  expect(to[1]! - from[1]!).toBeCloseTo(100);
  expect(to[2]! - from[2]!).toBeGreaterThan(150);
  expect((await color()).hover).toBe('base'); // still under the crosshair
  await shot(page, 'color-moved', browserName);
  expect(errors).toEqual([]);
});
