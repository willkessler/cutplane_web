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

test('Save keeps a copy in the browser; the model menu brings it back after a reload', async ({
  page,
}) => {
  const errors = await open(page, 'sample=cube');
  await set(page, { yaw: 0, pitch: 0, z: 0 });
  await click(page, 0, 0);
  await page.keyboard.press('KeyD'); // two cubes
  // No file dialog in a test: Save falls back to a download.
  await page.evaluate(() => delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save' }).click();
  expect((await download).suggestedFilename()).toBe('new_cube.cut');
  const menu = page.getByLabel('Model');
  await expect(menu).toHaveValue('saved:new_cube.cut');

  await page.goto('/?still=1&sample=cube');
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
  expect((await edit(page)).faces).toBe(6);
  await menu.selectOption('saved:new_cube.cut');
  await expect.poll(async () => (await edit(page)).faces).toBe(12);
  expect(errors).toEqual([]);
});

test('the ? pad opens a help plate in the plane, and closes it', async ({ page, browserName }) => {
  const errors = await open(page, 'sample=discovery');
  await set(page, { yaw: 0, pitch: 0, z: 0 });
  const help = () =>
    page.evaluate(() => window.__cutplane!.locate('help') as { pad: number[]; open: boolean });
  const { pad, open: shown } = await help();
  expect(shown).toBe(false);
  const before = (await edit(page)).objects;
  await click(page, pad[0]!, pad[1]!);
  expect((await help()).open).toBe(true);
  if (process.env['SHOTS'] && browserName === 'chromium')
    await page.screenshot({ path: `${process.env['SHOTS']}/help-plate.png` });
  await click(page, pad[0]!, pad[1]!);
  expect((await help()).open).toBe(false);
  const after = await edit(page);
  expect(after.objects).toBe(before);
  expect(after.picked).toEqual([]);
  expect(errors).toEqual([]);
});

test('the measure pad shows the size of what is picked; typing a height resizes it', async ({
  page,
  browserName,
}) => {
  const errors = await open(page, 'sample=cube');
  await set(page, { yaw: -20, pitch: 15, z: 0 });
  type Measure = { pad: number[]; shown: string[]; fields: Record<string, string | null> };
  const measure = () =>
    page.evaluate(() => {
      window.__cutplane!.renderFrame(0); // the fields hear by message, a frame on
      return window.__cutplane!.locate('measure') as Measure;
    });
  expect((await measure()).shown).toEqual([]);
  await page.keyboard.press('KeyM'); // the ruler, and its measure pad
  await click(page, 0, 0);
  expect((await measure()).shown).toContain('Cube_Plate');
  await expect.poll(async () => (await measure()).fields['Cube_height']).toBe('20.00');
  if (process.env['SHOTS'] && browserName === 'chromium')
    await page.screenshot({ path: `${process.env['SHOTS']}/measure-cube.png` });
  // The height field, cleared, 35 and Return: the cube is 350 tall.
  const at = await page.evaluate(() => {
    const f = window.__cutplane!.locate('measurefield:Cube_height');
    return f as number[] | null;
  });
  expect(at).not.toBeNull();
  await click(page, at![0]!, at![1]!);
  await page.keyboard.type('35'); // the first key replaces what it said
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await measure()).fields['Cube_height']).toBe('35.00');
  if (process.env['SHOTS'] && browserName === 'chromium')
    await page.screenshot({ path: `${process.env['SHOTS']}/measure-resized.png` });
  await page.keyboard.press('ControlOrMeta+KeyZ');
  expect(errors).toEqual([]);
});
