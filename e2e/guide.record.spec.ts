import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

// Takes the user guide's screenshots (docs/GUIDE.md) into docs/images/guide-*.png.
// Run with: docker compose run --rm -e GUIDE=1 e2e
test.skip(!process.env['GUIDE'], 'set GUIDE=1 to take the user guide screenshots');

type Pose = Partial<{ x: number; y: number; z: number; yaw: number; pitch: number }>;
const set = (page: Page, p: Pose) => page.evaluate((pp) => window.__cutplane!.set(pp), p);
const press = (page: Page) => page.evaluate(() => window.__cutplane!.press());
const release = (page: Page) => page.evaluate(() => window.__cutplane!.release());
const click = async (page: Page, x: number, y: number) => {
  await set(page, { x, y });
  await press(page);
  await release(page);
};
async function open(page: Page, query: string, hud = false) {
  await page.setViewportSize({ width: 1024, height: 700 });
  await page.goto(`/?still=1&${query}`);
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
  if (!hud) await page.addStyleTag({ content: '.panel { display: none !important; }' });
}
async function shot(page: Page, name: string) {
  mkdirSync('docs/images', { recursive: true });
  for (let i = 0; i < 3; i++) await page.evaluate(() => window.__cutplane!.renderFrame(0));
  await page.screenshot({ path: `docs/images/guide-${name}.png` });
}
/** Drags from where the crosshair is to (x, y), in small steps as a hand would. */
async function drag(page: Page, from: [number, number], to: [number, number]) {
  await set(page, { x: from[0], y: from[1] });
  await press(page);
  for (let i = 1; i <= 20; i++)
    await set(page, {
      x: from[0] + ((to[0] - from[0]) * i) / 20,
      y: from[1] + ((to[1] - from[1]) * i) / 20,
    });
  await release(page);
}

test('user guide screenshots', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'once, in Chromium');
  test.setTimeout(5 * 60_000);

  // The screen, as you first see it.
  await open(page, 'sample=discovery', true);
  await set(page, { yaw: -18, pitch: 12, z: 60, x: 40, y: -10 });
  await shot(page, 'screen');

  // A face of a new cube pulled out (Faces extrude), seen from the side.
  await open(page, 'sample=cube');
  await page.addStyleTag({ content: '.panel { display: none !important; }' });
  await page.evaluate(() => {
    const s = document.querySelector<HTMLSelectElement>('#faceDrag')!;
    s.value = 'extrude';
    s.dispatchEvent(new Event('change'));
  });
  await set(page, { yaw: -30, pitch: 20, z: 0 });
  await drag(page, [100, 0], [190, 0]);
  await set(page, { x: 300, y: -200 });
  await shot(page, 'extrude');

  // The measure pad: the cube picked, its sizes on the plate.
  await open(page, 'sample=cube');
  await set(page, { yaw: -20, pitch: 15, z: 0 });
  await page.keyboard.press('KeyM');
  await click(page, 0, 0);
  const w = (await page.evaluate(() => window.__cutplane!.locate('measurefield:Cube_width'))) as number[]; // prettier-ignore
  await click(page, w[0]!, w[1]!);
  await set(page, { x: 250, y: -60 });
  await shot(page, 'measure');

  // The pencil drawing across a face: from one corner of the section to the next.
  await open(page, 'sample=cube');
  await set(page, { yaw: -30, pitch: 20, z: 0 });
  const toolpads = (await page.evaluate(() => window.__cutplane!.locate('toolpads'))) as number[];
  await click(page, toolpads[0]!, toolpads[1]!);
  const [pencil] = (await page.evaluate(() => window.__cutplane!.locate('pads'))) as number[][];
  await click(page, pencil![0]!, pencil![1]!);
  await click(page, 100, 100);
  for (let y = 96; y >= -40; y -= 4) await set(page, { x: 100, y });
  await shot(page, 'pencil-line');
  await click(page, 100, -100);
  await set(page, { yaw: -55, pitch: 25, x: 300, y: -200 });
  await shot(page, 'pencil-split');

  // The help plate, opened from the ? pad.
  await open(page, 'sample=cube');
  await set(page, { yaw: 0, pitch: 0, z: 0 });
  const help = (await page.evaluate(() => window.__cutplane!.locate('help'))) as { pad: number[] };
  await click(page, help.pad[0]!, help.pad[1]!);
  await set(page, { x: 380, y: -250 });
  await shot(page, 'help');
});
