import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

// The 1 key: what isn't picked is drawn as wire, then put out of sight, then back;
// with nothing picked, everything as wire (front faces' edges), then every edge,
// then back. Set SHOTS=dir to keep screenshots.
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
const display = (page: Page) => page.evaluate(() => window.__cutplane!.display());
const click = async (page: Page, at: [number, number]) => {
  await set(page, { x: at[0], y: at[1] });
  await page.evaluate(() => window.__cutplane!.press());
  await page.evaluate(() => window.__cutplane!.release());
};

test('1 with something picked: the rest as wire, then out of sight (and out of reach), then back', async ({
  page,
  browserName,
}) => {
  const errors = await open(page, 'sample=cube');
  await set(page, { yaw: -30, pitch: 20, z: 0 });
  // A copy beside the cube, picked.
  await click(page, [0, 0]);
  await page.keyboard.press('KeyD');
  await set(page, { x: 150, y: 150 });
  await page.evaluate(() => window.__cutplane!.press());
  await set(page, { x: 300, y: 150 });
  await set(page, { x: 400, y: 50 });
  await page.evaluate(() => window.__cutplane!.release());
  expect((await edit(page)).picked).toEqual(['object']);
  const solid = { solid: 2, frontWire: 0, wire: 0, hidden: 0, unseen: 0 };
  expect(await display(page)).toEqual(solid);

  await page.keyboard.press('Digit1');
  expect(await display(page)).toEqual({ ...solid, solid: 1, frontWire: 1 });
  await shot(page, 'display-wire', browserName);
  // Still cut by the plane, and pickable.
  expect((await page.evaluate(() => window.__cutplane!.stats())).objects).toBe(2);

  await page.keyboard.press('Digit1');
  expect(await display(page)).toEqual({ ...solid, solid: 1, hidden: 1, unseen: 1 });
  await shot(page, 'display-hidden', browserName);
  // Out of sight: not cut, nor hovered.
  expect((await page.evaluate(() => window.__cutplane!.stats())).objects).toBe(1);
  await set(page, { x: 0, y: 0 });
  expect((await edit(page)).hover).toBeNull();

  await page.keyboard.press('Digit1');
  expect(await display(page)).toEqual(solid);
  expect((await edit(page)).hover).toBe('object');
  expect(errors).toEqual([]);
});

test('1 with nothing picked: all as wire, front faces only, then every edge, then solid', async ({
  page,
  browserName,
}) => {
  const errors = await open(page, 'sample=cube');
  await set(page, { yaw: -30, pitch: 20, z: 300 });
  const solid = { solid: 1, frontWire: 0, wire: 0, hidden: 0, unseen: 0 };
  const pixels = () => page.evaluate(() => window.__cutplane!.readPixels());
  const before = await pixels();
  await page.keyboard.press('Digit1');
  expect(await display(page)).toEqual({ ...solid, solid: 0, frontWire: 1 });
  const front = await pixels();
  await shot(page, 'display-all-front', browserName);
  await page.keyboard.press('Digit1');
  expect(await display(page)).toEqual({ ...solid, solid: 0, wire: 1 });
  const all = await pixels();
  await shot(page, 'display-all-wire', browserName);
  // Each looks different: solid, the front edges, and every edge (the back ones too).
  expect(front).not.toEqual(before);
  expect(all).not.toEqual(front);
  await page.keyboard.press('Digit1');
  expect(await display(page)).toEqual(solid);
  expect(await pixels()).toEqual(before);
  expect(errors).toEqual([]);
});

test("the keys plate on the plane's side: not shown windowed (the help line is), drawn when it is", async ({
  page,
  browserName,
}) => {
  const errors = await open(page, 'sample=cube');
  await page.setViewportSize({ width: 1440, height: 900 }); // (a full screen's shape: room beside the room)
  await set(page, { yaw: 0, pitch: 0, z: 0 });
  const keys = (show?: boolean | null) => page.evaluate((s) => window.__cutplane!.keysPlate(s), show); // prettier-ignore
  expect(await keys(null)).toBe(false);
  const pixels = () => page.evaluate(() => window.__cutplane!.readPixels());
  // (WebKit takes a while to resize the canvas.)
  const dpr = await page.evaluate(() => devicePixelRatio);
  await expect
    .poll(async () => (await keys(null), (await pixels()).split(':')[0]))
    .toBe(`${1440 * dpr}x${900 * dpr}`);
  const before = await pixels();
  expect(await keys(true)).toBe(true);
  expect(await pixels()).not.toEqual(before);
  await shot(page, 'keys-plate', browserName);
  // Left to full screen again: windowed, it goes.
  expect(await keys(null)).toBe(false);
  expect(await pixels()).toEqual(before);
  expect(errors).toEqual([]);
});
