import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

// M7: OBJ, STL and glTF in and out, drag and drop, autosave.
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

/** An ASCII STL tetrahedron, 300 units on a side, its corner at x0. */
function tetra(x0: number): string {
  const p = (x: number, y: number, z: number) => `${x + x0} ${y} ${z}`;
  const tri = (a: string, b: string, c: string) =>
    `facet normal 0 0 0\nouter loop\nvertex ${a}\nvertex ${b}\nvertex ${c}\nendloop\nendfacet`;
  const [o, x, y, z] = [p(0, 0, 0), p(300, 0, 0), p(0, 300, 0), p(0, 0, 300)];
  return ['solid tetra', tri(o, y, x), tri(o, x, z), tri(o, z, y), tri(x, y, z), 'endsolid tetra'].join('\n'); // prettier-ignore
}

test('an STL dropped on the page is added to the world; undo takes it out', async ({ page }) => {
  const errors = await open(page, 'sample=cube');
  expect((await edit(page)).objects).toBe(1);
  await page.evaluate((text) => {
    const dt = new DataTransfer();
    dt.items.add(new File([text], 'tetra.stl', { type: 'model/stl' }));
    window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, cancelable: true }));
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, cancelable: true }));
  }, tetra(-150));
  await expect.poll(async () => (await edit(page)).objects).toBe(2);
  await expect.poll(async () => (await edit(page)).faces).toBe(6 + 4); // drawn the next frame
  await expect(page.locator('#notice')).toContainText('Added 1 object from tetra.stl');
  await expect(page.locator('#app')).not.toHaveClass(/dropping/);
  await page.evaluate(() => window.__cutplane!.undo());
  expect((await edit(page)).objects).toBe(1);
  expect(errors).toEqual([]);
});

test('Export writes a GLB; opening it adds the same objects back', async ({ page }) => {
  const errors = await open(page, 'sample=stapler');
  const before = await edit(page);
  await page.evaluate(() => delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker);
  const download = page.waitForEvent('download');
  await page.getByLabel('Export').selectOption('glb');
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^stapler.*\.glb$/);
  const glb = readFileSync(await file.path());
  expect(glb.subarray(0, 4).toString('latin1')).toBe('glTF');
  await expect(page.getByLabel('Export')).toHaveValue('');
  // Opened again (Open… takes models too), it's added: twice the faces.
  await page.locator('#file').setInputFiles({ name: 'stapler.glb', mimeType: 'model/gltf-binary', buffer: glb }); // prettier-ignore
  await expect.poll(async () => (await edit(page)).faces).toBe(before.faces * 2);
  expect(errors).toEqual([]);
});

test('OBJ and STL exports download too', async ({ page }) => {
  const errors = await open(page, 'sample=cube');
  await page.evaluate(() => delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker);
  for (const [format, ext] of [
    ['obj', '.obj'],
    ['stl', '.stl'],
  ] as const) {
    const download = page.waitForEvent('download');
    await page.getByLabel('Export').selectOption(format);
    const file = await download;
    expect(file.suggestedFilename()).toBe(`new_cube${ext}`);
    const bytes = readFileSync(await file.path());
    if (format === 'obj') expect(bytes.toString().match(/^f /gm)).toHaveLength(6);
    else expect(bytes.length).toBe(84 + 50 * 12);
  }
  expect(errors).toEqual([]);
});

test('edits are autosaved: after a reload the world comes back as it was left', async ({
  page,
}) => {
  const errors = await open(page, 'sample=cube');
  await set(page, { yaw: 0, pitch: 0, z: 0 });
  await click(page, 0, 0);
  await page.keyboard.press('KeyD'); // two cubes
  expect((await edit(page)).faces).toBe(12);
  const menu = page.getByLabel('Model');
  await expect(menu.locator('option[value="autosave:"]')).toHaveText(/Unsaved changes: New cube/);
  // The menu still says what was opened.
  await expect(menu).toHaveValue('new:cube');
  await page.goto('/?still=1');
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
  expect((await edit(page)).faces).toBe(12);
  await expect(menu).toHaveValue('autosave:');
  // Choosing the model itself starts from the original again.
  await menu.selectOption('new:cube');
  await expect.poll(async () => (await edit(page)).faces).toBe(6);
  expect(errors).toEqual([]);
});

test('a file Cutplane cannot read says so, and changes nothing', async ({ page }) => {
  const errors = await open(page, 'sample=cube');
  await page.locator('#file').setInputFiles({ name: 'broken.glb', mimeType: 'model/gltf-binary', buffer: Buffer.from('not a glb') }); // prettier-ignore
  await expect(page.locator('#notice')).toContainText("Couldn't open broken.glb");
  await expect(page.locator('#notice')).toHaveClass(/error/);
  expect((await edit(page)).objects).toBe(1);
  expect(errors).toEqual([]);
});
