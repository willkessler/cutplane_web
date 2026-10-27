import type { V3 } from './runtime.ts';

/** New here: a guide line, through `at` along the unit `dir`. */
export interface GuideLine {
  at: V3;
  dir: V3;
  /** The middle it was drawn through, if it has been carried into a plane (flatGuides). */
  from?: V3;
  /** Along the thing's own (turned) axis, not the world's. */
  own?: boolean;
  /** Where it's drawn, if not through `at` (a level, met by a side of the thing: levelGuides). */
  show?: V3;
}

/**
 * New here: a level: the height (`axis` 1) of a face lying flat, or the place across
 * (`axis` 0) of one standing square to the plane, and the face's middle.
 */
export interface Level {
  axis: 0 | 1;
  at: number;
  from: V3;
}

/** How near (world units) a dragged thing's middle must come to a guide to hold on it. */
export const GUIDE_REACH = 12;

const WORLD_AXES: V3[] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

/**
 * New here: the guide lines while something is dragged: through `at` (the middle of
 * what it was copied from) along the world's axes, which are the plane's too, and
 * along `own` (that thing's own axes, if it's turned), but those along a world axis.
 */
export function guideLines(at: V3, own: readonly V3[] = []): GuideLine[] {
  const dirs: V3[] = [...WORLD_AXES];
  const lines: GuideLine[] = WORLD_AXES.map((dir) => ({ at, dir }));
  for (const a of own) {
    const l = Math.hypot(...a);
    if (l < 1e-9) continue;
    const u: V3 = [a[0] / l, a[1] / l, a[2] / l];
    // Within a degree of one already there, it's that one.
    if (dirs.some((d) => Math.abs(d[0] * u[0] + d[1] * u[1] + d[2] * u[2]) > Math.cos(Math.PI / 180))) continue; // prettier-ignore
    dirs.push(u);
    lines.push({ at, dir: u, own: true });
  }
  return lines;
}

/**
 * New here: guide lines carried into the plane at depth `z`, as they're seen from in
 * front: lining up across or up and down doesn't care how deep each thing is. One along
 * the depth goes (the two across it cross where it would be seen); one turned out of
 * the plane goes as its shadow on it. Each remembers the middle it came through.
 * A thing's own axis turned out of the plane stays too, as it is: where it passes
 * through the plane, a dragged copy's middle holds on it, the two on one axis.
 */
export function flatGuides(lines: readonly GuideLine[], z: number): GuideLine[] {
  const out: GuideLine[] = [];
  for (const line of lines) {
    const { at, dir } = line;
    if (line.own && Math.abs(dir[2]) > 1e-6) out.push(line);
    const l = Math.hypot(dir[0], dir[1]);
    if (l < 1e-6) continue;
    const flat: GuideLine = { at: [at[0], at[1], z], dir: [dir[0] / l, dir[1] / l, 0], from: at };
    const same = out.some(
      (g) =>
        g.from === at &&
        Math.abs(g.dir[0] * flat.dir[0] + g.dir[1] * flat.dir[1]) > Math.cos(Math.PI / 180),
    );
    if (!same) out.push(flat);
  }
  return out;
}

/**
 * New here: where a dragged thing's middle, about to be at `p`, holds instead. It moves
 * only in the plane (z stays), so a guide crossing the plane is a point to hold on, and
 * one lying in it (at this depth) a line. The nearest point in `reach` wins (two lines
 * crossing make one); else the nearest line. The move in x and y, and the guides held on.
 */
export function guideStop(
  p: V3,
  lines: readonly GuideLine[],
  reach = GUIDE_REACH,
): { move: [number, number]; on: GuideLine[] } | null {
  const points: { move: [number, number]; on: GuideLine[] }[] = [];
  const flat: { line: GuideLine; move: [number, number]; d: number }[] = [];
  for (const line of lines) {
    const { at, dir } = line;
    if (Math.abs(dir[2]) > 1e-6) {
      const t = (p[2] - at[2]) / dir[2];
      points.push({ move: [at[0] + dir[0] * t - p[0], at[1] + dir[1] * t - p[1]], on: [line] });
    } else if (Math.abs(at[2] - p[2]) < 1e-6) {
      // The nearest point of the line, in the plane.
      const l = Math.hypot(dir[0], dir[1]);
      const ux = dir[0] / l;
      const uy = dir[1] / l;
      const t = (p[0] - at[0]) * ux + (p[1] - at[1]) * uy;
      const move: [number, number] = [at[0] + ux * t - p[0], at[1] + uy * t - p[1]];
      flat.push({ line, move, d: Math.hypot(...move) });
    }
  }
  const near = flat.filter((f) => f.d < reach).sort((a, b) => a.d - b.d);
  // Two lines in the plane, not parallel, cross at a point.
  for (let i = 0; i < near.length; i++)
    for (let j = i + 1; j < near.length; j++) {
      const a = near[i]!.line;
      const b = near[j]!.line;
      const det = a.dir[0] * b.dir[1] - a.dir[1] * b.dir[0];
      if (Math.abs(det) < 1e-6) continue;
      const t = ((b.at[0] - a.at[0]) * b.dir[1] - (b.at[1] - a.at[1]) * b.dir[0]) / det;
      points.push({
        move: [a.at[0] + a.dir[0] * t - p[0], a.at[1] + a.dir[1] * t - p[1]],
        on: [a, b],
      });
    }
  const point = points
    .filter((q) => Math.hypot(...q.move) < reach)
    .sort((a, b) => Math.hypot(...a.move) - Math.hypot(...b.move))[0];
  if (point) return point;
  const line = near[0];
  return line ? { move: line.move, on: [line.line] } : null;
}

/**
 * New here: guide lines for a dragged thing to meet levels with a side: its middle about to
 * be at `p`, its box `half` as wide and high each way. For each level, the line its middle
 * holds on for its bottom (or left) side to lie on the level, and the one for its top (or
 * right); drawn at the level itself. A face or an edge dragged (no height) has the one.
 */
export function levelGuides(levels: readonly Level[], p: V3, half: [number, number]): GuideLine[] {
  const out: GuideLine[] = [];
  for (const { axis, at, from } of levels) {
    const sides = half[axis] > 1e-6 ? [-half[axis], half[axis]] : [0];
    const dir: V3 = axis === 1 ? [1, 0, 0] : [0, 1, 0];
    const show: V3 = [p[0], p[1], p[2]];
    show[axis] = at;
    for (const s of sides) {
      const line: V3 = [p[0], p[1], p[2]];
      line[axis] = at - s;
      out.push({ at: line, dir, from, show });
    }
  }
  return out;
}

/** New here: a thing near what is carried in depth: its back, middle and front depths, and its middle. */
export interface DepthMark {
  depths: readonly [number, number, number];
  at: V3;
}

/**
 * New here: where a thing carried in depth, its back, middle and front at `own`, holds:
 * the nearest of its middle, back or front coming within `reach` of another's middle,
 * back or front, or its back of another's front or its front of another's back (touching;
 * the nearest, middles first). How far it moves to hold,
 * the depth it holds at, and the thing it holds by.
 */
export function depthStop(
  own: readonly [number, number, number],
  marks: readonly DepthMark[],
  reach = GUIDE_REACH,
): { dz: number; z: number; mark: DepthMark } | null {
  let best: { dz: number; z: number; mark: DepthMark } | null = null;
  // Middles first (two the same size, all three lined up, hold by them); then back on
  // back, front on front, and the two ways of touching. (A face at a middle held so
  // often, between the others, that the one wanted was hard to find.)
  const pairs = [
    [1, 1],
    [0, 0],
    [2, 2],
    [0, 2],
    [2, 0],
  ] as const;
  for (const mark of marks)
    for (const [i, j] of pairs) {
      const t = mark.depths[i];
      const dz = t - own[j];
      if (Math.abs(dz) < reach && (!best || Math.abs(dz) < Math.abs(best.dz)))
        best = { dz, z: t, mark };
    }
  return best;
}

/**
 * New here: the guide drawn for a depth hold: at depth `z`, through the middle of the
 * thing held by (`by`) and the carried one's (`p`), as seen from in front; across if
 * one is straight behind the other.
 */
export function depthGuide(by: V3, p: V3, z: number): GuideLine {
  const dx = p[0] - by[0];
  const dy = p[1] - by[1];
  const l = Math.hypot(dx, dy);
  return { at: [by[0], by[1], z], dir: l > 1e-6 ? [dx / l, dy / l, 0] : [1, 0, 0], from: by };
}
