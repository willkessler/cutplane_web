import { groupRoot, type CutObject } from '@cutplane/kernel';
import { isObject, isSub } from './features.ts';
import type { Runtime, V3 } from './runtime.ts';

/** A thing's box in the world: its lowest and highest corners. */
export type Box = [V3, V3];

/** Within this of the world's axes (the plane's), the line things are put on is squared to it. */
export const ALIGN_SQUARE = (10 * Math.PI) / 180;

const mid = (b: Box): V3 => [
  (b[0][0] + b[1][0]) / 2,
  (b[0][1] + b[1][1]) / 2,
  (b[0][2] + b[1][2]) / 2,
];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * The line the things in `boxes` (picked first, first) are put on: through the middles
 * of the two farthest apart, the ends. Within ALIGN_SQUARE of a world axis, it's
 * squared to it, through the end picked first: that end stays put, the rest come to it.
 */
function lineOf(boxes: readonly Box[]): { at: V3; dir: V3 } | null {
  const mids = boxes.map(mid);
  let far = 0;
  let ends: [number, number] = [0, 0];
  for (let i = 0; i < mids.length; i++)
    for (let j = i + 1; j < mids.length; j++) {
      const a = mids[i]!;
      const b = mids[j]!;
      const d = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      if (d > far) [far, ends] = [d, [i, j]];
    }
  if (far < 1e-6) return null;
  const a = mids[ends[0]]!;
  const b = mids[ends[1]]!;
  const dir: V3 = [(b[0] - a[0]) / far, (b[1] - a[1]) / far, (b[2] - a[2]) / far];
  for (let k = 0; k < 3; k++)
    if (Math.abs(dir[k]!) > Math.cos(ALIGN_SQUARE)) {
      const axis: V3 = [0, 0, 0];
      axis[k] = Math.sign(dir[k]!);
      return { at: a, dir: axis };
    }
  return { at: a, dir };
}

/**
 * New here (A): how far each thing moves to line up: its middle onto the line through
 * the two farthest apart (lineOf). Null if there's no line (fewer than two, or all at one place).
 */
export function alignMoves(boxes: readonly Box[]): V3[] | null {
  if (boxes.length < 2) return null;
  const line = lineOf(boxes);
  if (!line) return null;
  const { at, dir } = line;
  return boxes.map((b) => {
    const m = mid(b);
    const t = dot([m[0] - at[0], m[1] - at[1], m[2] - at[2]], dir);
    return [at[0] + dir[0] * t - m[0], at[1] + dir[1] * t - m[1], at[2] + dir[2] * t - m[2]];
  });
}

/**
 * New here (Shift-A): how far each thing moves along the line through the two farthest
 * apart (lineOf) for even gaps between them: the two at the ends stay, the rest are
 * spaced out between, in the order they're in along it, each by its own size along it.
 * Only along the line: what's off it stays off it (A first puts them on it).
 */
export function distributeMoves(boxes: readonly Box[]): V3[] | null {
  if (boxes.length < 3) return null;
  const line = lineOf(boxes);
  if (!line) return null;
  const { at, dir } = line;
  const along = boxes.map((b, i) => {
    const m = mid(b);
    const t = dot([m[0] - at[0], m[1] - at[1], m[2] - at[2]], dir);
    // Half its size along the line.
    const h = [0, 1, 2].reduce((s, k) => s + (Math.abs(dir[k]!) * (b[1][k]! - b[0][k]!)) / 2, 0);
    return { i, t, h };
  });
  const order = [...along].sort((a, b) => a.t - b.t);
  const first = order[0]!;
  const last = order[order.length - 1]!;
  const span = last.t + last.h - (first.t - first.h);
  const sizes = order.reduce((s, x) => s + 2 * x.h, 0);
  const gap = (span - sizes) / (order.length - 1);
  const moves: V3[] = boxes.map(() => [0, 0, 0]);
  let next = first.t - first.h;
  for (const x of order) {
    const t = next + x.h;
    next = t + x.h + gap;
    const d = x === first || x === last ? 0 : t - x.t;
    moves[x.i] = [dir[0] * d, dir[1] * d, dir[2] * d];
  }
  return moves;
}

/**
 * What is picked, each whole: an object on its own or a group's root (not the scale box
 * it sits in while picked), in the world being edited, picked first, first.
 */
function pickedThings(rt: Runtime): CutObject[] {
  const out = new Set<CutObject>();
  // The picked list has the newest first.
  for (const f of [...rt.picked()].reverse()) {
    const o = isObject(f) ? f : isSub(f) ? f.object : null;
    if (!o || rt.worldOf(o) !== rt.primary || rt.hasProp(o, 'Scalebbox')) continue;
    let r = o;
    while (r.parent && !(r.linked ?? false) && !rt.hasProp(r.parent, 'Scalebbox')) r = r.parent;
    out.add(r);
  }
  return [...out];
}

function arrangePicked(rt: Runtime, moves: (boxes: readonly Box[]) => V3[] | null): boolean {
  const things = pickedThings(rt).flatMap((o) => {
    const box = rt.branchBox(o);
    return box ? [{ o, box }] : [];
  });
  const m = moves(things.map((t) => t.box));
  if (!m) return false;
  things.forEach(({ o }, i) => {
    const d = m[i]!;
    // With the scale box it sits in, if it's picked.
    if (Math.hypot(...d) > 1e-9) rt.moveBranch(groupRoot(o), d);
  });
  return true;
}

/** A: what is picked lines up (alignMoves). */
export const alignPicked = (rt: Runtime): boolean => arrangePicked(rt, alignMoves);

/** Shift-A: what is picked is spaced out evenly (distributeMoves). */
export const distributePicked = (rt: Runtime): boolean => arrangePicked(rt, distributeMoves);
