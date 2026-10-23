import type { Rgb } from '@cutplane/kernel';
import type { Pixels } from './gltf.ts';
import type { Soup } from './polygonize.ts';

/** Colours sampled from a photo-like texture are rounded to steps of this, so flat faces still join. */
const COLOR_STEP = 8;
export const quantize = (c: number): number =>
  Math.min(255, Math.round(c / COLOR_STEP) * COLOR_STEP);

/** The texel at (u, v), (0, 0) the image's top left, wrapping round (repeat). */
export function texel(img: Pixels, u: number, v: number): Rgb {
  const x = Math.min(img.width - 1, Math.floor((u - Math.floor(u)) * img.width));
  const y = Math.min(img.height - 1, Math.floor((v - Math.floor(v)) * img.height));
  const o = (y * img.width + x) * 4;
  return [img.data[o]!, img.data[o + 1]!, img.data[o + 2]!];
}

/**
 * Soups' textures as their polygons' colours: the texel under the middle of
 * each polygon's corners, times its own colour. Done once they are simplified,
 * since a photo gives nearly every triangle a colour of its own, and colours
 * keep their borders through the simplifier (which keeps the corners it does
 * keep where they were, on the texture too).
 */
export function paintSoups(soups: readonly Soup[]): Soup[] {
  return soups.map((s) => {
    const kids = s.children && paintSoups(s.children);
    if (!s.texture || !s.uvs) return kids ? { ...s, children: kids } : s;
    const { texture, uvs, ...rest } = s;
    const colors = s.polygons.map((poly, i): Rgb | null => {
      let u = 0;
      let v = 0;
      let n = 0;
      for (const k of poly) {
        const t = uvs[k];
        if (!t) continue;
        u += t[0];
        v += t[1];
        n++;
      }
      const own = s.colors?.[i] ?? null;
      if (n === 0) return own;
      const t = texel(texture, u / n, v / n);
      return t.map((c, k) => quantize(own ? (c * own[k]!) / 255 : c)) as Rgb;
    });
    return { ...rest, colors, photo: true, ...(kids ? { children: kids } : {}) };
  });
}
