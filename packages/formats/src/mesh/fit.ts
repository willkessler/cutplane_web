import { ROOM, preorder, snap, mat4, type CutObject } from '@cutplane/kernel';

/** The room box of objects and their descendants, or null if they have no vertices. */
export function roomBox(roots: readonly CutObject[]): { lo: number[]; hi: number[] } | null {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const o of preorder(roots))
    for (const v of o.brep.vertices()) {
      const [x, y, z] = o.brep.vertexPos(v);
      const p = mat4.transformPoint(o.xform, x, y, z);
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k]!, p[k]!);
        hi[k] = Math.max(hi[k]!, p[k]!);
      }
    }
  return lo[0]! <= hi[0]! ? { lo, hi } : null;
}

/** Imports smaller than this much of the room (a fish 160 units long) are scaled up to work on. */
const SMALL = 0.25;
/** Of the room, how much a model scaled to fit takes up. */
const FILL = 0.6;

/**
 * Makes imported objects fit the room: left as they are when they fit and
 * aren't small, else scaled (uniformly) to take up most of it, or moved into
 * its middle.
 * Vertices then go onto the grid, as every committed vertex does. Returns the scale used.
 */
export function fitToRoom(roots: readonly CutObject[]): number {
  const box = roomBox(roots);
  if (!box) return 1;
  const size = [0, 1, 2].map((k) => box.hi[k]! - box.lo[k]!);
  const room = [0, 1, 2].map((k) => ROOM.max[k]! - ROOM.min[k]!);
  const biggest = Math.max(...size);
  const inside = [0, 1, 2].every((k) => box.lo[k]! >= ROOM.min[k]! && box.hi[k]! <= ROOM.max[k]!);
  const small = biggest < SMALL * Math.min(...room);
  const fits = size.every((d, k) => d <= room[k]! * 0.95);
  const s = small || !fits ? Math.min(...size.map((d, k) => (d > 0 ? (room[k]! * FILL) / d : Infinity))) : 1; // prettier-ignore
  // Moved (and scaled) about its centre into the middle of the room, unless it was in already.
  const centre = [0, 1, 2].map((k) => (box.lo[k]! + box.hi[k]!) / 2);
  const middle = [0, 1, 2].map((k) => (ROOM.min[k]! + ROOM.max[k]!) / 2);
  const t = inside && s === 1 ? [0, 0, 0] : centre.map((c, k) => middle[k]! - c * s);
  for (const o of preorder(roots)) {
    const b = o.brep;
    for (const v of b.vertices()) {
      const [x, y, z] = b.vertexPos(v);
      b.setVertexPos(v, snap(x * s), snap(y * s), snap(z * s));
    }
    const m = o.xform.slice();
    for (let k = 0; k < 3; k++) m[12 + k] = snap(m[12 + k]! * s + t[k]!);
    o.xform = m;
    o.invXform = mat4.invert(m) ?? o.invXform;
  }
  return s;
}
