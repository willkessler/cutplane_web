import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';

// A file that takes a while to read: a ring turns in the room, filling as the read goes,
// and goes when the model is in. Set SHOTS=dir to keep a screenshot of it.
const SHOTS = process.env['SHOTS'];

/** An Inventor terrain of n × n points: big enough to take a moment. */
function terrain(n: number): string {
  const pts: string[] = [];
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++)
      pts.push(`${i} ${(Math.sin(i * 0.37) * Math.cos(j * 0.23) * 4).toFixed(3)} ${j},`);
  const idx: string[] = [];
  for (let i = 0; i + 1 < n; i++)
    for (let j = 0; j + 1 < n; j++) {
      const a = i * n + j;
      idx.push(`${a} ${a + n} ${a + n + 1} ${a + 1} -1`);
    }
  return `#Inventor V2.1 ascii\nSeparator { Coordinate3 { point [ ${pts.join('\n')} ] }\nIndexedFaceSet { coordIndex [ ${idx.join('\n')} ] } }\n`;
}

test('a long read shows a turning ring in the room, then the model comes in', async ({
  page,
  browserName,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1024, height: 700 });
  await page.goto('/?sample=cube');
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
  const loading = () => page.evaluate(() => window.__cutplane!.loading());
  expect(await loading()).toMatchObject({ shown: false });
  await page
    .locator('#file')
    .setInputFiles({ name: 'terrain.iv', mimeType: 'text/plain', buffer: Buffer.from(terrain(400)) }); // prettier-ignore
  // (Software rendering, as in CI's containers, can take seconds a frame while the worker reads.)
  await expect.poll(async () => (await loading()).shown, { timeout: 30_000 }).toBe(true);
  const turned = (await loading()).turn;
  await expect.poll(async () => (await loading()).turn, { timeout: 30_000 }).not.toBe(turned); // it turns
  if (SHOTS && browserName === 'chromium') {
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/loading.png` });
  }
  await expect(page.locator('#notice')).toContainText('from terrain.iv', { timeout: 60_000 });
  await expect.poll(async () => (await loading()).shown, { timeout: 30_000 }).toBe(false);
  expect(errors).toEqual([]);
});

test('Esc stops a read: nothing comes in', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1024, height: 700 });
  await page.goto('/?sample=cube');
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
  await page
    .locator('#file')
    .setInputFiles({ name: 'terrain.iv', mimeType: 'text/plain', buffer: Buffer.from(terrain(400)) }); // prettier-ignore
  await expect
    .poll(() => page.evaluate(() => window.__cutplane!.loading().shown), { timeout: 30_000 })
    .toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.locator('#notice')).toHaveText('Stopped reading');
  expect(await page.evaluate(() => window.__cutplane!.loading().shown)).toBe(false);
  expect((await page.evaluate(() => window.__cutplane!.edit())).objects).toBe(1);
});
