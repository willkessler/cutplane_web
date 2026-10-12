import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import gifenc from 'gifenc';

// Records docs/images/demo.gif, the animation at the top of the README.
// Run with: docker compose run --rm -e RECORD=1 e2e   (see docs/README.md)
const { GIFEncoder, applyPalette, quantize } = gifenc;

test.skip(!process.env['RECORD'], 'set RECORD=1 to record the README animation');

const W = 800;
const H = 600;
const FPS = 8;

test('record README demo', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'record once, in Chromium');
  test.setTimeout(10 * 60_000);
  await page.setViewportSize({ width: W, height: H });
  await page.goto('/?sample=discovery&demo=1&still=1');
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');

  // The scripted session in packages/app/src/demo.ts: one action at a time, looping.
  const seconds = await page.evaluate(() => window.__cutplane!.demoSeconds);
  const gif = GIFEncoder();
  for (let i = 0; i < Math.round(FPS * seconds); i++) {
    const t = i / FPS;
    const data = await page.evaluate((time) => {
      window.__cutplane!.renderFrame(time);
      return window.__cutplane!.readPixels();
    }, t);
    const [size, b64] = data.split(':') as [string, string];
    const [w, h] = size.split('x').map(Number) as [number, number];
    const raw = Buffer.from(b64, 'base64');
    // WebGL rows are bottom-up.
    const rgba = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++)
      rgba.set(raw.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
    const palette = quantize(rgba, 128);
    gif.writeFrame(applyPalette(rgba, palette), w, h, { palette, delay: 1000 / FPS });
  }
  gif.finish();
  mkdirSync('docs/images', { recursive: true });
  writeFileSync('docs/images/demo.gif', gif.bytes());
});
