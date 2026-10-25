import type { V3 } from './runtime.ts';

/** New here: a guide line, through `at` along the unit `dir`. */
export interface GuideLine {
  at: V3;
  dir: V3;
  /** The middle it was drawn through, if it has been carried into a plane (flatGuides). */
  from?: V3;
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
  for (const a of own) {
    const l = Math.hypot(...a);
    if (l < 1e-9) continue;
    const u: V3 = [a[0] / l, a[1] / l, a[2] / l];
    // Within a degree of one already there, it's that one.
    if (dirs.some((d) => Math.abs(d[0] * u[0] + d[1] * u[1] + d[2] * u[2]) > Math.cos(Math.PI / 180))) continue; // prettier-ignore
    dirs.push(u);
  }
  return dirs.map((dir) => ({ at, dir }));
}

/**
 * New here: guide lines carried into the plane at depth `z`, as they're seen from in
 * front: lining up across or up and down doesn't care how deep each thing is. One along
 * the depth goes (the two across it cross where it would be seen); one turned out of
 * the plane goes as its shadow on it. Each remembers the middle it came through.
 */
export function flatGuides(lines: readonly GuideLine[], z: number): GuideLine[] {
  const out: GuideLine[] = [];
  for (const { at, dir } of lines) {
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
