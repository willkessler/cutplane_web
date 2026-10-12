import { expect, test, type Page } from '@playwright/test';

// M5: plates with Hershey text and typed input (dialog.cpl, textinput.cpl, save.cpl,
// load.cpl). Save to: keeps the world in the browser; Load from: brings it back.
async function open(page: Page, query: string) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1024, height: 700 });
  await page.goto(`/?still=1&${query}`);
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
  return errors;
}

type Pose = Partial<{ x: number; y: number; z: number; yaw: number; pitch: number }>;
const set = (page: Page, p: Pose) => page.evaluate((pp) => window.__cutplane!.set(pp), p);
const click = async (page: Page, x: number, y: number) => {
  await set(page, { x, y });
  await page.evaluate(() => window.__cutplane!.press());
  await page.evaluate(() => window.__cutplane!.release());
};
const edit = (page: Page) => page.evaluate(() => window.__cutplane!.edit());

/** The storage pad (bottom left, in the plane) and its plate's two fields. */
const PAD = [-451, -322] as const;
const LOAD = [-280, -180] as const;
const SAVE = [-280, -270] as const;

test('typing a name into Save to: keeps the world; Load from: brings it back after a reload', async ({
  page,
}) => {
  const errors = await open(page, 'sample=cube');
  await set(page, { yaw: 0, pitch: 0, z: 0 });
  await page.keyboard.press('KeyD'); // nothing picked: nothing to duplicate
  await click(page, 0, 0);
  await page.keyboard.press('KeyD'); // now two cubes
  expect((await edit(page)).faces).toBe(12);
  await click(page, PAD[0], PAD[1]);
  await click(page, SAVE[0], SAVE[1]);
  for (let i = 0; i < 8; i++) await page.keyboard.press('Backspace');
  await page.keyboard.type('twocubes');
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => localStorage.getItem('cutplane.world.twocubes'))).toContain(
    'Total Number of Objects In World:2',
  );

  // A fresh session with a new cube: load the saved world into it.
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
  await set(page, { yaw: 0, pitch: 0, z: 0 });
  expect((await edit(page)).faces).toBe(6);
  await click(page, PAD[0], PAD[1]);
  await click(page, LOAD[0], LOAD[1]);
  for (let i = 0; i < 5; i++) await page.keyboard.press('Backspace');
  await page.keyboard.type('twocubes');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await edit(page)).faces).toBe(18);
  expect(errors).toEqual([]);
});
