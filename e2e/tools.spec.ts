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

type P3 = [number, number, number];
const locate = <T>(page: Page, what: string) =>
  page.evaluate((w) => window.__cutplane!.locate(w), what) as Promise<T>;

/** The plane through the toolboxes by the back wall. */
const BOXES_Z = -480;

/** Clicks a toolbox open (tools.c puts them by the back wall). */
async function openBox(page: Page, which: 'prims' | 'goodies') {
  const at = await locate<P3>(page, which);
  await set(page, { z: BOXES_Z, x: at[0], y: at[1] });
  await press(page);
  await release(page);
}

test('the primitives box: picking a primitive stamps a copy into the world, picked', async ({
  page,
  browserName,
}) => {
  const errors = await open(page, 'sample=cube');
  await set(page, { yaw: -30, pitch: 20 });
  await openBox(page, 'prims');
  await shot(page, 'prims-open', browserName);
  const [cube] = await locate<P3[]>(page, 'stamps');
  await set(page, { x: cube![0], y: cube![1] });
  const before = (await edit(page)).faces;
  await press(page);
  await release(page);
  const s = await edit(page);
  expect(s.picked).toEqual(['object']);
  expect(s.faces).toBe(before + 6);
  await shot(page, 'stamped', browserName);
  expect(errors).toEqual([]);
});

test('the colour control in the goodies box: a bar recolours the picked cube, the chip paints', async ({
  page,
  browserName,
}) => {
  test.setTimeout(60_000);
  const errors = await open(page, 'sample=cube');
  await set(page, { yaw: -30, pitch: 20, z: 0, x: 0, y: 0 });
  await press(page);
  await release(page);
  const color = () => page.evaluate(() => window.__cutplane!.color());

  await openBox(page, 'goodies');
  const bars = await locate<{ center: P3; top: number }[]>(page, 'bars');
  const red = bars[0]!;
  await set(page, { x: red.center[0], y: red.top - 5 });
  expect((await color()).hover).toBe('bar');
  await shot(page, 'color-hover', browserName);
  const before = (await color()).rgb;
  await press(page);
  for (let d = 5; d <= 50; d += 5) await set(page, { x: red.center[0], y: red.top - 5 - d });
  await release(page);
  const after = (await color()).rgb;
  expect(after[0]).toBeLessThan(before[0]!);
  expect((await edit(page)).colors[0]).toEqual(after); // the picked cube took it as it went
  await shot(page, 'color-bar', browserName);

  // Turn the blue right down, then carry the chip to the cube and drop it there.
  const blue = bars[2]!;
  await set(page, { x: blue.center[0], y: blue.top - 5 });
  await press(page);
  for (let d = 5; d <= 70; d += 5) await set(page, { x: blue.center[0], y: blue.top - 5 - d });
  await release(page);
  await page.evaluate(() => window.__cutplane!.undo()); // takes the cube's colour back...
  const mix = (await color()).rgb; // ...but the control keeps its setting
  const chip = await locate<P3>(page, 'chip');
  await set(page, { z: chip[2], x: chip[0], y: chip[1] });
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

test('the colour control comes out of its box when its base is dragged', async ({
  page,
  browserName,
}) => {
  test.setTimeout(60_000);
  const errors = await open(page, 'sample=cube');
  await set(page, { yaw: -30, pitch: 20, z: 0, x: 0, y: 0 });
  const color = () => page.evaluate(() => window.__cutplane!.color());
  await openBox(page, 'goodies');
  const base = await locate<P3>(page, 'base');
  await set(page, { x: base[0], y: base[1] });
  expect((await color()).hover).toBe('base');
  const from = (await color()).base;
  await press(page);
  for (let i = 1; i <= 10; i++) await set(page, { x: base[0] - 15 * i, y: base[1] + 10 * i });
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

test('the saw cuts the cube in two at the plane; undo puts it back', async ({
  page,
  browserName,
}) => {
  const errors = await open(page, 'sample=cube');
  await set(page, { yaw: -30, pitch: 20, z: 0 });
  type P3 = [number, number, number];
  const click = async (at: P3) => {
    await set(page, { x: at[0], y: at[1] });
    await press(page);
    await release(page);
  };
  await click(await locate<P3>(page, 'toolpads'));
  const [, saw] = await locate<P3[]>(page, 'pads');
  await click(saw!);
  await set(page, { x: 30, y: 20 });
  await shot(page, 'saw-ready', browserName);
  await click([30, 20, 0]);
  // Two closed blocks now, pulled 10 apart either side of the plane.
  expect((await edit(page)).faces).toBe(12);
  await set(page, { yaw: -60, pitch: 15 });
  await shot(page, 'saw-cut', browserName);
  await page.keyboard.press('ControlOrMeta+KeyZ');
  expect((await edit(page)).faces).toBe(6);
  expect(errors).toEqual([]);
});

test('the pencil draws a closed shape in the plane, which becomes a solid', async ({
  page,
  browserName,
}) => {
  const errors = await open(page, 'sample=cube');
  await set(page, { yaw: -30, pitch: 20, z: 0 });
  type P3 = [number, number, number];
  const click = async (at: P3) => {
    await set(page, { x: at[0], y: at[1] });
    await press(page);
    await release(page);
  };
  await click(await locate<P3>(page, 'toolpads'));
  const [pencil] = await locate<P3[]>(page, 'pads');
  await click(pencil!);
  // A triangle beside the cube, drawn in steps as a hand would.
  await set(page, { x: -300, y: -150 });
  await press(page);
  const corners: [number, number][] = [[-180, -150], [-240, -50], [-300, -150]]; // prettier-ignore
  let [x, y] = [-300, -150];
  for (const [cx, cy] of corners) {
    for (let i = 1; i <= 20; i++)
      await set(page, { x: x + ((cx - x) * i) / 20, y: y + ((cy - y) * i) / 20 });
    [x, y] = [cx, cy];
  }
  // The stroke shows while it's drawn (draw_scribble_technique).
  const sc = await page.evaluate(() => window.__cutplane!.scribble());
  expect(sc.segments).toBeGreaterThan(20);
  await shot(page, 'pencil-drawing', browserName);
  await release(page);
  expect((await edit(page)).faces).toBe(6 + 5);
  await set(page, { yaw: -50, pitch: 25 });
  await shot(page, 'pencil-solid', browserName);
  expect(errors).toEqual([]);
});

test('backslash slices the picked cube; G groups a duplicate with it and ungroups', async ({
  page,
}) => {
  const errors = await open(page, 'sample=cube');
  await set(page, { yaw: -30, pitch: 20, z: 0, x: 0, y: 0 });
  await press(page);
  await release(page);
  await page.keyboard.press('Backslash');
  expect((await edit(page)).faces).toBe(12);
  await page.keyboard.press('ControlOrMeta+KeyZ');
  expect((await edit(page)).faces).toBe(6);

  // Duplicate (both picked), then G: the two go under one grouper; G again parts them.
  await set(page, { x: 0, y: 0 });
  await press(page);
  await release(page);
  await page.keyboard.press('KeyD');
  expect((await edit(page)).objects).toBe(2);
  // The copy is picked; shift-click the original (where the copy doesn't cover it) too.
  await set(page, { x: -80, y: -80 });
  await page.evaluate(() => window.__cutplane!.press(true));
  await release(page);
  await page.keyboard.press('KeyG');
  expect((await edit(page)).objects).toBe(1);
  expect((await edit(page)).faces).toBe(12);
  await page.keyboard.press('KeyG');
  expect((await edit(page)).objects).toBe(2);
  expect(errors).toEqual([]);
});

test('the drill: a red cutter made from a copy of the cube cuts a corner out of it', async ({
  page,
  browserName,
}) => {
  const errors = await open(page, 'sample=cube');
  await set(page, { yaw: -30, pitch: 20, z: 0, x: 0, y: 0 });
  type P3 = [number, number, number];
  const click = async (at: P3) => {
    await set(page, { x: at[0], y: at[1] });
    await press(page);
    await release(page);
  };
  // A copy of the cube, up and to the right (D), to make the cutter from.
  await click([0, 0, 0]);
  await page.keyboard.press('KeyD');
  await click([300, -250, 0]); // nothing picked
  await click(await locate<P3>(page, 'toolpads'));
  const [, , drill] = await locate<P3[]>(page, 'pads');
  await click(drill!);
  // Press on the copy where it stands clear of the cube: a red cutter comes with the drill.
  await set(page, { x: 160, y: 160 });
  await press(page);
  for (let i = 1; i <= 10; i++) await set(page, { x: 160 - 5 * i, y: 160 - 5 * i });
  await shot(page, 'drill-cutter', browserName);
  await release(page);
  // The cube is now an L-shaped block (8 faces); the copy is untouched; the cutter is gone.
  const s = await edit(page);
  expect(s.objects).toBe(2);
  expect(s.faces).toBe(8 + 6);
  await set(page, { yaw: -45, pitch: 30 });
  await shot(page, 'drill-cut', browserName);
  await page.keyboard.press('ControlOrMeta+KeyZ');
  expect((await edit(page)).faces).toBe(12);
  expect(errors).toEqual([]);
});
