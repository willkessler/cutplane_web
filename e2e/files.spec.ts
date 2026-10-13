import { readFileSync } from 'node:fs';
import { crc32, deflateSync } from 'node:zlib';
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

test('edits are autosaved with their undo history: a reload carries on where it was left', async ({
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
  // The undo history came back too: undo takes the copy away, redo brings it back.
  await page.evaluate(() => window.__cutplane!.undo());
  await expect.poll(async () => (await edit(page)).faces).toBe(6);
  await page.evaluate(() => window.__cutplane!.redo());
  await expect.poll(async () => (await edit(page)).faces).toBe(12);
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

/** A PNG of one row of RGB pixels. */
function png(pixels: number[][]): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(pixels.length, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const row = Buffer.from([0, ...pixels.flat()]);
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(row)), chunk('IEND', Buffer.alloc(0))]); // prettier-ignore
}

/**
 * A GLB as Poly Pizza's come: two parts that aren't solids (a box with no lid,
 * a lone sheet), coloured by a texture (red on its left, blue on its right).
 */
function texturedParts(): Buffer {
  const quad = (a: number[], b: number[], c: number[], d: number[]) => [
    ...a,
    ...b,
    ...c,
    ...a,
    ...c,
    ...d,
  ];
  const P = (x: number, y: number, z: number) => [x * 0.2, y * 0.2, z * 0.2];
  const box = [
    ...quad(P(0, 0, 0), P(1, 0, 0), P(1, 0, 1), P(0, 0, 1)),
    ...quad(P(0, 0, 0), P(0, 1, 0), P(1, 1, 0), P(1, 0, 0)),
    ...quad(P(0, 0, 1), P(1, 0, 1), P(1, 1, 1), P(0, 1, 1)),
    ...quad(P(0, 0, 0), P(0, 0, 1), P(0, 1, 1), P(0, 1, 0)),
    ...quad(P(1, 0, 0), P(1, 1, 0), P(1, 1, 1), P(1, 0, 1)),
  ];
  const sheet = quad(P(2, 0, 0), P(3, 0, 0), P(3, 1, 0), P(2, 1, 0));
  const uvs = (n: number, u: number) => Array.from({ length: n / 3 }, () => [u, 0.5]).flat();
  const parts = [
    [box, uvs(box.length, 0.25)],
    [sheet, uvs(sheet.length, 0.75)],
  ] as const;
  const image = png([
    [255, 0, 0],
    [0, 0, 255],
  ]);
  const bins: Buffer[] = [];
  const views: object[] = [];
  const accessors: object[] = [];
  let offset = 0;
  const add = (data: Buffer) => {
    const pad = Buffer.alloc((4 - (data.length % 4)) % 4);
    views.push({ buffer: 0, byteOffset: offset, byteLength: data.length });
    bins.push(data, pad);
    offset += data.length + pad.length;
    return views.length - 1;
  };
  const meshes = parts.map(([pos, uv]) => {
    const p = add(Buffer.from(new Float32Array(pos).buffer));
    const min = [0, 1, 2].map((k) => Math.min(...pos.filter((_, i) => i % 3 === k)));
    const max = [0, 1, 2].map((k) => Math.max(...pos.filter((_, i) => i % 3 === k)));
    accessors.push({
      bufferView: p,
      componentType: 5126,
      count: pos.length / 3,
      type: 'VEC3',
      min,
      max,
    });
    const t = add(Buffer.from(new Float32Array(uv).buffer));
    accessors.push({ bufferView: t, componentType: 5126, count: uv.length / 2, type: 'VEC2' });
    return { primitives: [{ attributes: { POSITION: accessors.length - 2, TEXCOORD_0: accessors.length - 1 }, material: 0 }] }; // prettier-ignore
  });
  const img = add(image);
  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0, 1] }],
    nodes: [
      { name: 'tray', mesh: 0 },
      { name: 'sheet', mesh: 1 },
    ],
    meshes,
    materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
    textures: [{ source: 0 }],
    images: [{ bufferView: img, mimeType: 'image/png' }],
    buffers: [{ byteLength: offset }],
    bufferViews: views,
    accessors,
  };
  const text = Buffer.from(JSON.stringify(json));
  const jsonChunk = Buffer.concat([text, Buffer.alloc((4 - (text.length % 4)) % 4, 0x20)]);
  const bin = Buffer.concat(bins);
  const head = (len: number, type: number) => {
    const b = Buffer.alloc(8);
    b.writeUInt32LE(len, 0);
    b.writeUInt32LE(type, 4);
    return b;
  };
  const total = 12 + 8 + jsonChunk.length + 8 + bin.length;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(total, 8);
  return Buffer.concat([header, head(jsonChunk.length, 0x4e4f534a), jsonChunk, head(bin.length, 0x004e4942), bin]); // prettier-ignore
}

test('a model of open, textured parts comes in as one group of solids, coloured by its texture', async ({
  page,
}) => {
  const errors = await open(page, 'sample=cube');
  await page.locator('#file').setInputFiles({ name: 'parts.glb', mimeType: 'model/gltf-binary', buffer: texturedParts() }); // prettier-ignore
  await expect(page.locator('#notice')).toContainText('Added a group of 2 from parts.glb');
  await expect(page.locator('#notice')).toContainText('2 holes closed to make solids');
  expect((await edit(page)).objects).toBe(2); // the cube, and the group
  // The texture's red and blue (the cube is the world's own colour).
  await expect.poll(() => page.evaluate(() => window.__cutplane!.palette())).toEqual(expect.arrayContaining(['0,0,255', '255,0,0'])); // prettier-ignore
  expect(errors).toEqual([]);
});
