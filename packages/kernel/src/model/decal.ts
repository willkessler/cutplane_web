import { transformPoint, type Mat4 } from '../math/mat4.ts';
import type { CutObject, TextDecal } from './object.ts';

/**
 * New: where a TextDecal lies in the room, and back. Kept here, not with the
 * drawing, so what places lettering by hand (the T chip) can work it out too.
 */

type V3 = [number, number, number];

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: readonly number[], b: readonly number[]) =>
  a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit = (a: V3): V3 => {
  const l = Math.hypot(...a);
  return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
};

/** A decal as the room has it: its middle, the way it reads (u), up (v) and out (n). */
export interface DecalFrame {
  at: V3;
  u: V3;
  v: V3;
  n: V3;
  /** The capitals' height, in the room. */
  height: number;
  /** As TextDecal's: the capitals lean this far (degrees) from v, towards u. */
  lean?: number;
  /** As TextDecal's: 'start', `at` is its left end, not its middle. */
  align?: 'start';
}

function applyDir(m: Mat4, d: readonly number[]): V3 {
  const o = transformPoint(m, 0, 0, 0);
  const p = transformPoint(m, d[0]!, d[1]!, d[2]!);
  return sub(p, o);
}

/** Where `d`, kept in `o`'s own coordinates, lies in the room. */
export function decalFrame(o: CutObject, d: TextDecal): DecalFrame {
  const at = transformPoint(o.xform, ...d.at);
  const n = unit(applyDir(o.xform, d.normal));
  let u = applyDir(o.xform, d.along);
  u = unit(sub(u, n.map((c) => c * dot(u, n)) as V3));
  const v = cross(n, u);
  const vl = cross(unit([...d.normal]), unit([...d.along]));
  const f: DecalFrame = { at, u, v, n, height: d.height * Math.hypot(...applyDir(o.xform, vl)) };
  if (d.lean) f.lean = d.lean;
  if (d.align) f.align = d.align;
  return f;
}

/** The other way: a decal at a frame in the room, kept in `o`'s coordinates. */
export function decalIn(
  o: CutObject,
  f: DecalFrame,
  text: string,
  color: readonly number[],
): TextDecal {
  const at = transformPoint(o.invXform, ...f.at);
  const v = applyDir(o.invXform, f.v);
  const d: TextDecal = {
    text,
    color: [color[0]!, color[1]!, color[2]!],
    height: f.height * Math.hypot(...v),
    at,
    normal: unit(applyDir(o.invXform, f.n)),
    along: unit(applyDir(o.invXform, f.u)),
  };
  if (f.lean) d.lean = f.lean;
  if (f.align) d.align = f.align;
  return d;
}

/**
 * The lean that stands a decal's capitals up straight in the room (as a row of windows
 * stepping up a slope stands): their sides along the room's up as it lies on the surface.
 * 0 where there's no such up (lying flat), or it would lean further than 60°.
 */
export function uprightLean(f: DecalFrame): number {
  const up: V3 = [0, 1, 0];
  const across = dot(up, f.u);
  const along = dot(up, f.v);
  if (along < 1e-6) return 0;
  const deg = (Math.atan2(across, along) * 180) / Math.PI;
  return Math.abs(deg) > 60 ? 0 : Math.round(deg * 100) / 100;
}
