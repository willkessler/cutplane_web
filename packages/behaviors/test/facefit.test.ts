import { describe, expect, it } from 'vitest';
import { mat4, type Mat4 } from '@cutplane/kernel';
import { faceFit, type V3 } from '../src/index.ts';

// Outlines in the plane z = 0, facing +z; turned and moved about it.
const N: V3 = [0, 0, 1];
const square = (x: number, y: number, s: number): V3[] => [
  [x, y, 0],
  [x + s, y, 0],
  [x + s, y + s, 0],
  [x, y + s, 0],
];
const turned = (ps: V3[], deg: number, about: V3 = [0, 0, 0]): V3[] => {
  const m = mat4.rotationAbout(about, N, (deg * Math.PI) / 180);
  return ps.map((p) => mat4.transformPoint(m, p[0], p[1], p[2]) as V3);
};
const moved = (ps: V3[], m: Mat4 | null) =>
  m ? ps.map((p) => mat4.transformPoint(m, p[0], p[1], p[2]) as V3) : ps;
/** The same points, in any order. */
const sameSet = (a: V3[], b: V3[]) => {
  expect(a.length).toBe(b.length);
  for (const p of a) {
    const d = Math.min(...b.map((q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])));
    expect(d).toBeLessThan(1e-6);
  }
};

describe('faceFit (new here: the magnet settles a face in the plane)', () => {
  it('a face like the other fits it corner on corner, wherever it was let go', () => {
    const t = square(0, 0, 200);
    // Turned 7° (beyond the twist stop) and 60 off: still fits.
    const s = turned(square(60, -40, 200), 7, [100, 100, 0]);
    sameSet(moved(s, faceFit(s, t, N, [100, 100, 0], 20)), t);
  });

  it('a mirrored face fits too (its corners run the other way)', () => {
    // A face like a keystone, and the same face flipped over, as a turned copy meets it.
    const t: V3[] = [[0, 0, 0], [200, 0, 0], [150, 120, 0], [50, 120, 0]]; // prettier-ignore
    const s = turned(
      t.map(([x, y]) => [200 - x + 15, y + 9, 0] as V3),
      4,
      [100, 60, 0],
    );
    sameSet(moved(s, faceFit(s, t, N, [100, 60, 0], 20)), t);
  });

  it('of the fits a square has, the one turning it least', () => {
    const t = square(0, 0, 200);
    const s = turned(t, 30, [100, 100, 0]);
    const m = faceFit(s, t, N, [100, 100, 0], 20)!;
    // Turned back 30°, not on by 60°.
    const p = mat4.transformPoint(m, s[0]![0], s[0]![1], 0);
    expect(p[0]).toBeCloseTo(0, 6);
    expect(p[1]).toBeCloseTo(0, 6);
  });

  it('a face not like it squares up and meets its centre, if that is in reach', () => {
    const t = square(0, 0, 200);
    const s = turned(square(56, 44, 100), 3, [106, 94, 0]); // centre 6 off
    const out = moved(s, faceFit(s, t, N, [106, 94, 0], 20));
    sameSet(out, square(50, 50, 100));
  });

  it('or puts an edge in line with one of the other’s', () => {
    const t = square(0, 0, 200);
    const s = square(5, 70, 50); // its left edge 5 in; nothing else near
    const out = moved(s, faceFit(s, t, N, [30, 95, 0], 20));
    sameSet(out, square(0, 70, 50));
  });

  it('or two edges, so a corner meets a corner', () => {
    const t = square(0, 0, 200);
    const s = square(144, 6, 50); // 6 in from the right edge, 6 up from the bottom
    const out = moved(s, faceFit(s, t, N, [170, 30, 0], 20));
    sameSet(out, square(150, 0, 50));
  });

  it('out of reach of any stop, and not near square, it stays', () => {
    const t = square(0, 0, 200);
    const s = turned(square(40, 60, 60), 20, [70, 90, 0]);
    expect(faceFit(s, t, N, [70, 90, 0], 20)).toBeNull();
  });
});
