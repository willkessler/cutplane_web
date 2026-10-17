import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

// The globe on the arranging rail drops what it's clicked on to the floor; the
// group-pick menu picks a group whole from any of its parts. Set SHOTS=dir to keep
// screenshots.
const SHOTS = process.env['SHOTS'];

async function open(page: Page, query: string) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1024, height: 700 });
  await page.goto(`/?still=1&${query}`);
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
  return errors;
}

type P3 = [number, number, number];
type Pose = Partial<{ x: number; y: number; z: number; yaw: number; pitch: number }>;
const set = (page: Page, p: Pose) => page.evaluate((pp) => window.__cutplane!.set(pp), p);
const edit = (page: Page) => page.evaluate(() => window.__cutplane!.edit());
const falls = (page: Page) => page.evaluate(() => window.__cutplane!.falls());
const locate = <T>(page: Page, what: string) =>
  page.evaluate((w) => window.__cutplane!.locate(w), what) as Promise<T>;
/** Each object's lowest point above the floor, to the nearest unit, lowest first. */
const lows = async (page: Page) =>
  (await falls(page)).lows.map((y) => Math.round(y) + 0).sort((a, b) => a - b);
const click = async (page: Page, at: [number, number]) => {
  await set(page, { x: at[0], y: at[1] });
  await page.evaluate(() => window.__cutplane!.press());
  await page.evaluate(() => window.__cutplane!.release());
};

test('the globe drops the cube to the floor; undo lifts it back', async ({ page, browserName }) => {
  test.setTimeout(60_000);
  const errors = await open(page, 'sample=cube');
  await set(page, { yaw: -30, pitch: 15, z: 0 });
  await click(page, [0, 0]); // picked first: it falls out of its scale box
  expect((await edit(page)).picked).toEqual(['object']);
  expect((await edit(page)).boxes).toBe(1);
  // The cube is 200 across, about the middle of the room: 282 above the floor.
  expect((await falls(page)).aboveFloor).toBeCloseTo(282, 0);
  const rail = await locate<P3>(page, 'arrangepads');
  await click(page, [rail[0], rail[1]]);
  const pads = await locate<P3[]>(page, 'arrangers');
  expect(pads).toHaveLength(7);
  const globe = pads[6]!;
  await click(page, [globe[0], globe[1]]);
  await set(page, { x: 0, y: 0 });
  if (SHOTS && browserName === 'chromium') {
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/globe-held.png` });
  }
  await click(page, [0, 0]);
  // Falling, it isn't hovered where it was, nor picked: its scale box is gone.
  expect((await edit(page)).hover).toBeNull();
  expect((await edit(page)).boxes).toBe(0);
  // Nor is that kept with it: saved now, it's as pickable as ever.
  expect(await page.evaluate(() => window.__cutplane!.saveText())).not.toContain('Nonselectable');
  // Each frame while it falls, it's cut where it has got to (one loop through the cube).
  const cuts = await page.evaluate(
    () =>
      new Promise<number[]>((done) => {
        const seen: number[] = [];
        let began = false;
        const look = () => {
          const c = window.__cutplane!;
          const active = c.falls().active;
          if (active) {
            began = true;
            seen.push(c.stats().loops);
          }
          if (began && !active) done(seen);
          else requestAnimationFrame(look);
        };
        look();
      }),
  );
  expect(cuts.length).toBeGreaterThan(0);
  expect(cuts.every((n) => n === 1)).toBe(true);
  // (Software rendering, as in CI's containers, can take a while a frame.)
  // (A fall can be over between two looks, so wait for where it ends.)
  await expect
    .poll(async () => (await falls(page)).aboveFloor, { timeout: 30_000 })
    .toBeLessThan(1.5);
  await expect.poll(async () => (await falls(page)).active, { timeout: 30_000 }).toBe(false);
  if (SHOTS && browserName === 'chromium')
    await page.screenshot({ path: `${SHOTS}/globe-dropped.png` });
  // Straight down: it stays where it was across the room.
  const [mid] = (await falls(page)).mids;
  expect(Math.abs(mid![0]!)).toBeLessThan(1);
  expect(Math.abs(mid![2]!)).toBeLessThan(1);
  // Landed, it can be picked again.
  await set(page, { x: 0, y: mid![1]! });
  expect((await edit(page)).hover).not.toBeNull();
  // The first click picks it (in a scale box of its own, not one left from before).
  await click(page, [0, mid![1]!]);
  expect((await edit(page)).picked).toEqual(['object']);
  expect((await edit(page)).boxes).toBe(1);
  // One edit: one undo puts it back up.
  await page.keyboard.press('ControlOrMeta+KeyZ');
  await expect.poll(async () => Math.round((await falls(page)).aboveFloor)).toBe(282);
  expect(errors).toEqual([]);
});

test('dropped on another, it lands on top of it', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = await open(page, 'sample=cube');
  await set(page, { yaw: 0, pitch: 0, z: 0 });
  const rail = await locate<P3>(page, 'arrangepads');
  await click(page, [rail[0], rail[1]]);
  const globe = () => locate<P3[]>(page, 'arrangers').then((p) => p[6]!);
  const drop = async (at: [number, number]) => {
    const g = await globe();
    await click(page, [g[0], g[1]]);
    await click(page, at);
    await expect.poll(async () => (await falls(page)).active, { timeout: 30_000 }).toBe(false);
  };
  // The cube to the floor (its middle comes down from 0 to 282 lower).
  await drop([0, 0]);
  await expect.poll(async () => (await falls(page)).aboveFloor, { timeout: 30_000 }).toBeLessThan(1.5); // prettier-ignore
  // A copy (100 across and up), taken over it and up clear of it.
  await click(page, [0, -282]);
  await page.keyboard.press('KeyD');
  await set(page, { x: 150, y: -132 });
  await page.evaluate(() => window.__cutplane!.press());
  await set(page, { x: 100, y: -132 });
  await set(page, { x: 50, y: 68 });
  await page.evaluate(() => window.__cutplane!.release());
  expect(await lows(page)).toEqual([0, 300]);
  // Dropped (the globe by its key this time), it comes to rest on the cube's top, not the floor.
  await page.keyboard.press('Shift+Period'); // >
  await click(page, [50, 68]);
  await expect.poll(async () => (await falls(page)).active, { timeout: 30_000 }).toBe(false);
  await expect.poll(() => lows(page), { timeout: 30_000 }).toEqual([0, 200]);
  expect(errors).toEqual([]);
});

test('"Groups pick whole" (the first choice): a click by a part\'s face picks its group', async ({
  page,
}) => {
  const errors = await open(page, 'sample=cube');
  await set(page, { yaw: -30, pitch: 20, z: 0 });
  // A copy grouped with the cube (as tools.spec does it).
  await click(page, [0, 0]);
  await page.keyboard.press('KeyD');
  await set(page, { x: -80, y: -80 });
  await page.evaluate(() => window.__cutplane!.press(true));
  await page.evaluate(() => window.__cutplane!.release());
  await page.keyboard.press('KeyG');
  expect((await edit(page)).objects).toBe(1);
  await click(page, [300, -150]); // nothing there: nothing picked
  // By the cube's right face: the group.
  await expect(page.locator('#groupPick')).toHaveValue('whole');
  await set(page, { x: 95, y: 0 });
  expect((await edit(page)).hover).toBe('object');
  await click(page, [95, 0]);
  expect((await edit(page)).picked).toEqual(['object']);
  await click(page, [300, -150]);
  // By part: its face, as the original picks.
  await page.locator('#groupPick').selectOption('parts');
  await set(page, { x: 96, y: 0 });
  expect((await edit(page)).hover).toBe('face');
  // The choice is kept.
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('#groupPick')).toHaveValue('parts');
  expect(errors).toEqual([]);
});
