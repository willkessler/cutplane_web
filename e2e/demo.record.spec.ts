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
  const frames = Math.round(FPS * seconds);
  /** Plays the session through from the start, handing each frame's pixels (top row first). */
  const play = async (each: (rgba: Uint8Array, w: number, h: number, i: number) => void) => {
    await page.goto('/?sample=discovery&demo=1&still=1');
    await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
    for (let i = 0; i < frames; i++) {
      const data = await page.evaluate((time) => {
        window.__cutplane!.renderFrame(time);
        return window.__cutplane!.readPixels();
      }, i / FPS);
      const [size, b64] = data.split(':') as [string, string];
      const [w, h] = size.split('x').map(Number) as [number, number];
      const raw = Buffer.from(b64, 'base64');
      // WebGL rows are bottom-up.
      const rgba = new Uint8Array(w * h * 4);
      for (let y = 0; y < h; y++)
        rgba.set(raw.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
      each(rgba, w, h, i);
    }
  };

  // One palette for the whole animation, from a sample of its frames, with one slot
  // left over for "unchanged": each frame then only carries the pixels that changed.
  const samples: Uint8Array[] = [];
  await play((rgba, _w, _h, i) => {
    if (i % 24 === 0) samples.push(rgba);
  });
  const all = new Uint8Array(samples.reduce((n, s) => n + s.length, 0));
  samples.reduce((at, s) => (all.set(s, at), at + s.length), 0);
  const palette = quantize(all, 255);
  const CLEAR = palette.length;
  palette.push([0, 0, 0]);

  const gif = GIFEncoder();
  let last: Uint8Array | undefined;
  await play((rgba, w, h) => {
    const index = applyPalette(rgba, palette.slice(0, CLEAR));
    const out = Uint8Array.from(index);
    if (last) for (let k = 0; k < out.length; k++) if (index[k] === last[k]) out[k] = CLEAR;
    gif.writeFrame(out, w, h, {
      palette: last ? undefined : palette,
      delay: 1000 / FPS,
      transparent: !!last,
      transparentIndex: CLEAR,
      dispose: 1,
    });
    last = index;
  });
  gif.finish();
  mkdirSync('docs/images', { recursive: true });
  writeFileSync('docs/images/demo.gif', gif.bytes());
});
