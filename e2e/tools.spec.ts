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

test('the rotate tool’s dial stops at 45°, its baubles drawn bigger while held (new)', async ({
  page,
  browserName,
}) => {
  const errors = await open(page, 'sample=cube');
  await set(page, { yaw: -30, pitch: 20, z: 0, x: 0, y: 0 });
  await page.keyboard.press('KeyR');
  // The horizontal bar's right bauble, dialled round toward 45°, 1° a step.
  await set(page, { x: 130, y: 0 });
  expect((await tool(page)).hover).toBe('bauble');
  await press(page);
  let a = 0;
  while (!(await tool(page)).held && a < 60) {
    a += 1;
    const r = (a * Math.PI) / 180;
    await set(page, { x: 130 * Math.cos(r), y: 130 * Math.sin(r) });
  }
  expect(a).toBeGreaterThanOrEqual(45);
  expect(a).toBeLessThan(47);
  const at = await page.evaluate(() => window.__cutplane!.state());
  expect(at.x).toBeCloseTo(130 * Math.SQRT1_2, 0); // the crosshair on the 45° stop
  expect(at.y).toBeCloseTo(130 * Math.SQRT1_2, 0);
  await shot(page, 'tool-dial-held', browserName);
  // Pushed on well past the hold, it lets go.
  for (let b = a + 2; b <= 70; b += 2) {
    const r = (b * Math.PI) / 180;
    await set(page, { x: 130 * Math.cos(r), y: 130 * Math.sin(r) });
  }
  expect((await tool(page)).held).toBe(false);
  await shot(page, 'tool-dial-on', browserName);
  await release(page);
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

test('the pencil draws on a surface: from edge to edge, splitting the face', async ({
  page,
  browserName,
}) => {
  const errors = await open(page, 'sample=cube');
  await set(page, { yaw: -30, pitch: 20, z: 0 });
  type P3 = [number, number, number];
  const click = async (at: [number, number] | P3) => {
    await set(page, { x: at[0], y: at[1] });
    await press(page);
    await release(page);
  };
  await click(await locate<P3>(page, 'toolpads'));
  const [pencil] = await locate<P3[]>(page, 'pads');
  await click(pencil!);
  // The plane cuts the cube's z edges at the section's corners.
  await click([100, 100]);
  for (let y = 96; y >= 0; y -= 4) await set(page, { x: 100, y });
  expect((await page.evaluate(() => window.__cutplane!.scribble())).line).toBe(true);
  await shot(page, 'pencil-surface-line', browserName);
  await click([100, -100]);
  expect((await page.evaluate(() => window.__cutplane!.scribble())).line).toBe(false);
  expect((await edit(page)).faces).toBe(7);
  await set(page, { yaw: -50, pitch: 25 });
  await shot(page, 'pencil-surface-split', browserName);
  await page.keyboard.press('ControlOrMeta+KeyZ');
  expect((await edit(page)).faces).toBe(6);
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

test('B unions the picked cube with an overlapping copy of it', async ({ page }) => {
  const errors = await open(page, 'sample=cube');
  await set(page, { yaw: -30, pitch: 20, z: 0, x: 0, y: 0 });
  await press(page);
  await release(page);
  await page.keyboard.press('KeyD');
  await set(page, { x: -80, y: -80 });
  await page.evaluate(() => window.__cutplane!.press(true));
  await release(page);
  await page.keyboard.press('KeyB');
  expect((await edit(page)).objects).toBe(1);
  // The two squares' outlines merge into one of 8 sides: 8 walls, a top and a bottom.
  expect((await edit(page)).faces).toBe(10);
  await page.keyboard.press('ControlOrMeta+KeyZ');
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

const doubleClick = (page: Page) => page.evaluate(() => window.__cutplane!.doubleClick());
type Falls = { mids: number[][]; spans: number[][]; lows: number[] };
const falls = (page: Page) => page.evaluate(() => window.__cutplane!.falls()) as Promise<Falls>;

test('the magnifier: a double click fits everything into the room at once; undo puts it back', async ({
  page,
  browserName,
}) => {
  const errors = await open(page, 'sample=cube');
  await set(page, { yaw: -30, pitch: 20, z: 0 });
  await page.keyboard.press('KeyZ');
  await set(page, { x: 300, y: -200 });
  await doubleClick(page);
  // The cube, 200 across, scaled to 0.9 of the room's height (765) and in its middle.
  const f = await falls(page);
  expect(f.spans[0]![1]!).toBeCloseTo(688.5, 0);
  expect(f.mids[0]![0]!).toBeCloseTo(-0.5, 0);
  expect(f.mids[0]![1]!).toBeCloseTo(0.5, 0);
  expect(f.mids[0]![2]!).toBeCloseTo(0.5, 0);
  await set(page, { z: 300 });
  await shot(page, 'magnifier-fit', browserName);
  await page.keyboard.press('ControlOrMeta+KeyZ');
  expect((await falls(page)).spans[0]![1]!).toBeCloseTo(200, 0);
  expect(errors).toEqual([]);
});

test('a double click on the colour control or the camera puts it back in its box', async ({
  page,
  browserName,
}) => {
  test.setTimeout(60_000);
  const errors = await open(page, 'sample=cube');
  await set(page, { yaw: -30, pitch: 20, z: 0, x: 0, y: 0 });
  const shown = (name: string) =>
    page.evaluate((n) => window.__cutplane!.locate(`shown:${n}`), name) as Promise<boolean>;
  await openBox(page, 'goodies');
  expect(await shown('Colorcontrol')).toBe(true);
  expect(await shown('Nikon')).toBe(true);
  await shot(page, 'goodies-out', browserName);
  const base = await locate<P3>(page, 'base');
  await set(page, { z: base[2], x: base[0], y: base[1] });
  await doubleClick(page);
  expect(await shown('Colorcontrol')).toBe(false);
  // The box closed again as it went in: open it, and the camera's next.
  await openBox(page, 'goodies');
  expect(await shown('Colorcontrol')).toBe(true);
  const camera = await locate<P3>(page, 'camera');
  await set(page, { z: camera[2], x: camera[0], y: camera[1] });
  await doubleClick(page);
  expect(await shown('Nikon')).toBe(false);
  await shot(page, 'goodies-away', browserName);
  expect(errors).toEqual([]);
});

type Ghost = { held: boolean; target: string | null; ghost: number[] | null };
const ghostOf = (page: Page) => page.evaluate(() => window.__cutplane!.magnet()) as Promise<Ghost>;

/** The cube (-100 to 100 across and up), a copy to its right (300 to 500, 0 to 200), the magnet in hand. */
async function magnetScene(page: Page) {
  const errors = await open(page, 'sample=cube');
  await set(page, { yaw: -30, pitch: 20, z: 0 });
  const click = async (at: P3 | [number, number]) => {
    await set(page, { x: at[0], y: at[1] });
    await press(page);
    await release(page);
  };
  await click([0, 0]);
  await page.keyboard.press('KeyD');
  await set(page, { x: 150, y: 150 });
  await press(page);
  for (const x of [250, 350, 450]) await set(page, { x, y: 150 });
  await release(page);
  await click([300, -250]);
  // The magnet: the arranging rail's fourth pad.
  await click(await locate<P3>(page, 'arrangepads'));
  await click((await locate<P3[]>(page, 'arrangers'))[3]!);
  /** The copy's box middle: the rightmost or leftmost object. */
  const copy = async (side: 1 | -1 = 1) =>
    (await falls(page)).mids.reduce((a, b) => (side * b[0]! > side * a[0]! ? b : a));
  return { errors, copy };
}

test('the magnet: what it drags passes through; let go with no ghost, it stays', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const { errors, copy } = await magnetScene(page);
  // By the copy's left face, into the cube: it stays on the crosshair, through the cube.
  await set(page, { x: 300, y: 50 });
  await press(page);
  for (let x = 290; x >= -50; x -= 10) await set(page, { x, y: 50 });
  expect((await copy())[0]!).toBeCloseTo(50, 0);
  // Inside the cube no face is under the crosshair: no ghost, and no snap on release.
  expect((await ghostOf(page)).ghost).toBeNull();
  await release(page);
  expect((await copy())[0]!).toBeCloseTo(50, 0);
  // Let go of, it takes it again at the first press, by its top face now.
  expect((await edit(page)).picked).toEqual([]);
  await set(page, { x: 50, y: 200 });
  await press(page);
  for (let y = 210; y <= 260; y += 10) await set(page, { x: 50, y });
  await release(page);
  expect((await copy())[1]!).toBeCloseTo(160, 0);
  expect((await ghostOf(page)).held).toBe(true);
  expect(errors).toEqual([]);
});

test('the magnet: near a face, a ghost shows the snap; let go, it goes there', async ({
  page,
  browserName,
}) => {
  test.setTimeout(60_000);
  const { errors, copy } = await magnetScene(page);
  // By the copy's top face, to just off the cube's right face.
  await set(page, { x: 400, y: 200 });
  await press(page);
  for (let x = 380; x >= 120; x -= 20) await set(page, { x, y: 200 - (400 - x) / 2 });
  await set(page, { x: 108, y: 50 });
  // The copy is on the crosshair, unturned; its ghost is turned a quarter, its top on the
  // cube's right face, and (a face like it) fitted to it edge on edge, not where the
  // crosshair has it, 50 up.
  const held = await copy();
  expect(held[0]!).toBeCloseTo(108, 0);
  expect(held[1]!).toBeCloseTo(-50, 0);
  const g = await ghostOf(page);
  expect(g.target).not.toBeNull();
  expect(g.ghost![0]!).toBeCloseTo(200, 0);
  expect(g.ghost![1]!).toBeCloseTo(0, 0);
  await shot(page, 'magnet-ghost', browserName);
  await release(page);
  const snapped = await copy();
  expect(snapped[0]!).toBeCloseTo(200, 0);
  expect(snapped[1]!).toBeCloseTo(0, 0);
  // The magnet stays in hand (the original put it away after a snap).
  expect((await ghostOf(page)).held).toBe(true);
  expect(errors).toEqual([]);
});

test('the magnet: drawn off, the ghost goes; near another face, it shows there', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const { errors, copy } = await magnetScene(page);
  await set(page, { x: 400, y: 200 });
  await press(page);
  for (let x = 380; x >= 120; x -= 20) await set(page, { x, y: 200 - (400 - x) / 2 });
  await set(page, { x: 108, y: 50 });
  expect((await ghostOf(page)).ghost).not.toBeNull();
  // Off again: no ghost.
  await set(page, { x: 140, y: 50 });
  expect((await ghostOf(page)).ghost).toBeNull();
  // Round to the cube's left face (through it: nothing stops the drag).
  for (let x = 100; x >= -100; x -= 20) await set(page, { x, y: 50 });
  await set(page, { x: -108, y: 50 });
  const g = await ghostOf(page);
  expect(g.ghost![0]!).toBeCloseTo(-200, 0);
  expect(g.ghost![1]!).toBeCloseTo(0, 0);
  await release(page);
  const snapped = await copy(-1);
  expect(snapped[0]!).toBeCloseTo(-200, 0);
  expect(snapped[1]!).toBeCloseTo(0, 0);
  expect(errors).toEqual([]);
});

test('the group tool: a click on what is picked groups it, a marquee groups what it touches; one scale box', async ({
  page,
}) => {
  const errors = await open(page, 'sample=cube');
  await set(page, { yaw: -30, pitch: 20, z: 0, x: 0, y: 0 });
  const click = async (x: number, y: number, shift = false) => {
    await set(page, { x, y });
    await page.evaluate((s) => window.__cutplane!.press(s), shift);
    await release(page);
  };
  /** Takes the group tool from its pad (the second on the arranging rail), opening the rail first. */
  const takeGroupTool = async (openRail: boolean) => {
    if (openRail) {
      const rail = await locate<P3>(page, 'arrangepads');
      await click(rail[0], rail[1]);
    }
    const pad = (await locate<P3[]>(page, 'arrangers'))[1]!;
    await click(pad[0], pad[1]);
  };
  // The cube and a copy, both picked.
  await click(0, 0);
  await page.keyboard.press('KeyD');
  await click(-80, -80, true);
  expect((await edit(page)).boxes).toBe(2);

  // A click with the group tool on one of them: one group, picked, with one scale box.
  await takeGroupTool(true);
  await click(-80, -80);
  expect((await edit(page)).objects).toBe(1);
  expect((await edit(page)).boxes).toBe(1);

  // Apart again (G), nothing picked; then a marquee with it across both.
  await page.keyboard.press('KeyG');
  expect((await edit(page)).objects).toBe(2);
  await click(350, -250);
  expect((await edit(page)).boxes).toBe(0);
  await takeGroupTool(false);
  await set(page, { x: 350, y: -250 });
  await press(page);
  for (let i = 1; i <= 10; i++) await set(page, { x: 350 - 40 * i, y: -250 + 30 * i });
  await release(page);
  expect((await edit(page)).objects).toBe(1);
  expect((await edit(page)).boxes).toBe(1);
  expect(errors).toEqual([]);
});

test('Ctrl on a scale box handle scales evenly, not locked to one axis', async ({ page }) => {
  const errors = await open(page, 'sample=cube');
  await set(page, { yaw: 0, pitch: 0, z: 0, x: 0, y: 0 });
  await press(page);
  await release(page);
  const spans = async () =>
    (await page.evaluate(() => window.__cutplane!.falls())).spans[0]!.map(Math.round);
  expect(await spans()).toEqual([200, 200, 200]);
  // The pointer on the edge handle, at (121, 121) in the plane.
  const at = async (px: number, py: number) => {
    await page.mouse.move(px, py);
    const s = await page.evaluate(() => window.__cutplane!.state());
    return [s.x, s.y];
  };
  const [x0, y0] = await at(500, 400);
  const [x1, y1] = await at(600, 300);
  const [sx, sy] = [(x1! - x0!) / 100, (y1! - y0!) / 100]; // room units per pixel right, up
  const hx = 500 + (121 - x0!) / sx;
  const hy = 400 - (121 - y0!) / sy;
  await at(hx, hy);
  expect((await edit(page)).hover).toBeNull(); // the handle, not the cube
  // (A frame or two between, as by hand: the scale box hears of Ctrl before the press.)
  const frames = () =>
    page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.keyboard.down('Control');
  await frames();
  await page.mouse.down();
  // Mostly rightwards, a little up: the crosshair alone would be locked to x.
  for (let i = 1; i <= 12; i++) await page.mouse.move(hx + 6 * i, hy - 2 * i);
  await frames();
  await page.mouse.up();
  await page.keyboard.up('Control');
  const [w, h, d] = await spans();
  expect(w).toBeGreaterThan(220);
  expect(h).toBe(w);
  expect(d).toBe(w);
  expect(errors).toEqual([]);
});

test('Esc puts the tool in hand back on its pad, at its pad size', async ({ page }) => {
  const errors = await open(page, 'sample=cube');
  const inHand = () => locate<string[]>(page, 'inHand');
  for (const key of ['KeyP', 'KeyZ', 'KeyH']) {
    await page.keyboard.press(key);
    expect((await inHand()).length).toBe(1);
    await page.keyboard.press('Escape');
    expect(await inHand()).toEqual([]);
  }
  // Nothing in hand: Esc does nothing.
  await page.keyboard.press('Escape');
  expect(await inHand()).toEqual([]);
  expect(errors).toEqual([]);
});
