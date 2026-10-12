import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

// M3: picking and dragging through the section, driven through the test hooks
// (pointer lock can't be driven headlessly). Set SHOTS=dir to keep screenshots.
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

/** Press at `from`, pass through the poses, release at the last one. */
async function drag(page: Page, from: Pose, ...path: Pose[]) {
  await set(page, from);
  await page.evaluate(() => window.__cutplane!.press());
  for (const p of path) await set(page, p);
  await page.evaluate(() => window.__cutplane!.release());
}

test('reshapes a new cube through the section, and undoes it', async ({ page, browserName }) => {
  const errors = await open(page, 'sample=cube');
  await set(page, { yaw: -30, pitch: 20 });

  // The plane at the cube's front face: a vertex, an edge, the face itself.
  await set(page, { z: 100, x: 97, y: 103 });
  expect((await edit(page)).hover).toBe('vertex');
  await shot(page, 'hover-vertex', browserName);
  await set(page, { x: 0, y: 96 });
  expect((await edit(page)).hover).toBe('edge');
  await set(page, { x: 0, y: 0 });
  expect((await edit(page)).hover).toBe('inPlaneFace');

  // Pull the corner out and carry it forward: the faces around it split and stay flat.
  await drag(page, { x: 100, y: 100, z: 100 }, { x: 140, y: 150 }, { z: 160 });
  let s = await edit(page);
  expect(s.picked).toEqual(['vertex']);
  expect(s.faces).toBe(9);

  // Through the middle the section is one closed loop, now with a new corner.
  await set(page, { z: 130, x: 300, y: 300 });
  const stats = await page.evaluate(() => window.__cutplane!.stats());
  expect(stats.loops).toBe(1);
  expect(stats.openLoops).toBe(0);
  await set(page, { x: 125, y: 110 });
  await shot(page, 'reshaped', browserName);

  // Move a side face through its section segment.
  await drag(page, { z: 0, x: -100, y: 0 }, { x: -160, y: 0 });
  s = await edit(page);
  expect(s.picked).toEqual(['face']);

  await page.evaluate(() => window.__cutplane!.undo());
  await page.evaluate(() => window.__cutplane!.undo());
  expect((await edit(page)).faces).toBe(6);
  await page.evaluate(() => window.__cutplane!.redo());
  expect((await edit(page)).faces).toBe(9);
  expect(errors).toEqual([]);
});

test('picks and moves a whole object of the Discovery', async ({ page, browserName }) => {
  const errors = await open(page, 'sample=discovery');
  await set(page, { z: 0, yaw: -25, pitch: 12 });
  // Find a point inside some section.
  const inside = await page.evaluate(() => {
    for (let x = -300; x <= 300; x += 10)
      for (let y = -200; y <= 200; y += 10) {
        window.__cutplane!.set({ x, y });
        if (window.__cutplane!.edit().hover === 'object') return { x, y };
      }
    return null;
  });
  expect(inside).not.toBeNull();
  await drag(page, inside!, { x: inside!.x + 40, y: inside!.y + 30 });
  expect((await edit(page)).picked).toEqual(['object']);
  await shot(page, 'discovery-moved', browserName);
  await page.evaluate(() => window.__cutplane!.undo());
  expect(errors).toEqual([]);
});

test('a marquee picks the objects inside it', async ({ page, browserName }) => {
  const errors = await open(page, 'sample=cube');
  await set(page, { yaw: -30, pitch: 20 });
  await set(page, { z: 0, x: -250, y: 200 });
  await page.evaluate(() => window.__cutplane!.press());
  await set(page, { x: 250, y: -200 });
  expect((await edit(page)).marquee).toBe(true);
  await set(page, { z: -40 });
  await shot(page, 'marquee', browserName);
  await page.evaluate(() => window.__cutplane!.release());
  expect((await edit(page)).picked).toEqual(['object']);
  await shot(page, 'picked-object', browserName);
  expect(errors).toEqual([]);
});
