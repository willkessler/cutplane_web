import { expect, test, type Page } from '@playwright/test';

// The session (new): a first visit sees the room turned a little, the keys plate
// showing; a later one finds the room as it was left. Not with ?still=1 (tests and
// recordings start from nothing), so these load the page as a visitor does.

async function open(page: Page, url = '/?sample=cube') {
  await page.setViewportSize({ width: 1024, height: 700 });
  await page.goto(url);
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
}
const state = (page: Page) => page.evaluate(() => window.__cutplane!.state());
const keys = (page: Page) => page.evaluate(() => window.__cutplane!.keysPlate());
const locate = <T>(page: Page, what: string) =>
  page.evaluate((w) => window.__cutplane!.locate(w), what) as Promise<T>;
type Pose = Partial<{ x: number; y: number; z: number; yaw: number; pitch: number }>;
const set = (page: Page, p: Pose) => page.evaluate((pp) => window.__cutplane!.set(pp), p);
const click = async (page: Page, at: number[]) => {
  await set(page, { x: at[0]!, y: at[1]!, z: at[2]! });
  await page.evaluate(() => window.__cutplane!.press());
  await page.evaluate(() => window.__cutplane!.release());
};

test('a first visit: the room turned a little, the keys plate showing', async ({ page }) => {
  await open(page);
  const s = await state(page);
  expect([s.yaw, s.pitch]).toEqual([-20, 5]);
  expect(await keys(page)).toBe(true);
});

test('a later visit finds the room as it was left: view, plane, rails, rotate tool, goodie, menus', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await open(page);
  // The cube picked and the rotate tool brought to it; a rail opened; the keys put away.
  await click(page, [0, 0, 0]);
  await page.keyboard.press('KeyR');
  const tool = await page.evaluate(() => window.__cutplane!.tool().center);
  await click(page, await locate<number[]>(page, 'toolpads'));
  expect(await locate(page, 'rails')).toEqual(['Toolpads']);
  await page.keyboard.press('Shift+Slash');
  expect(await keys(page)).toBe(false);
  // The goodies box opened, the colour control taken out of it.
  await click(page, await locate<number[]>(page, 'goodies'));
  const base = await locate<number[]>(page, 'base');
  await set(page, { x: base[0]!, y: base[1]!, z: base[2]! });
  await page.evaluate(() => window.__cutplane!.press());
  for (let i = 1; i <= 10; i++) await set(page, { x: base[0]! - 30 * i, y: base[1]! + 15 * i });
  await page.evaluate(() => window.__cutplane!.release());
  const out = await locate<number[]>(page, 'base');
  expect(out[0]!).toBeLessThan(base[0]! - 200);
  // A menu's choice, the room turned, the plane and crosshair somewhere.
  await page.locator('#settings summary').click();
  await page.locator('#groupPick').selectOption('parts');
  await set(page, { yaw: 35, pitch: 25, z: -120, x: 40, y: -60 });
  const before = await state(page);
  expect(await page.evaluate(() => window.__cutplane!.saveSession())).toBeGreaterThan(0);

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
  const after = await state(page);
  for (const k of ['x', 'y', 'z', 'yaw', 'pitch'] as const)
    expect(after[k]).toBeCloseTo(before[k], 6);
  expect(await keys(page)).toBe(false);
  expect(await locate(page, 'rails')).toEqual(['Toolpads']);
  expect(await page.evaluate(() => window.__cutplane!.tool().center)).toEqual(tool);
  expect(await locate(page, 'shown:Colorcontrol')).toBe(true);
  expect(await locate<number[]>(page, 'base')).toEqual(out);
  await expect(page.locator('#groupPick')).toHaveValue('parts');
  // It all still works: the rail shuts.
  await click(page, await locate<number[]>(page, 'toolpads'));
  expect(await locate(page, 'rails')).toEqual([]);
  expect(errors).toEqual([]);
});

test('Reset the room puts it back as built; leaving the page keeps the room as it is', async ({
  page,
}) => {
  await open(page);
  // A rail opened, the plane pushed back, the room turned.
  await click(page, await locate<number[]>(page, 'toolpads'));
  await set(page, { z: -300, yaw: 30 });
  await page.evaluate(() => window.__cutplane!.saveSession());
  // A reload keeps it (the page keeps the room as it goes, a broken one too).
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
  expect(await locate(page, 'rails')).toEqual(['Toolpads']);
  expect((await state(page)).z).toBe(-300);

  await page.locator('#settings summary').click();
  await page.locator('#resetRoom').click();
  await page.waitForLoadState('load');
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
  const s = await state(page);
  expect([s.z, s.yaw, s.pitch]).toEqual([500, -20, 5]);
  expect(await locate(page, 'rails')).toEqual([]);
  expect(await locate<number[]>(page, 'arrangepads')).toEqual([-270, 320, 500]);
  // The world being made is still there.
  expect((await page.evaluate(() => window.__cutplane!.edit())).objects).toBe(1);
});
