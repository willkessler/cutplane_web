/**
 * Snap rounding (PLAN.md §4.1). Every committed vertex coordinate lies on a
 * fixed grid of 1/GRID room units, so coincident points are *equal* rather
 * than "within epsilon". Grid values are dyadic rationals, so they are exact
 * doubles and print exactly in a handful of decimal digits.
 */
export const GRID = 256;

export function snap(v: number): number {
  const s = Math.round(v * GRID) / GRID;
  return s === 0 ? 0 : s; // never -0
}

export function isSnapped(v: number): boolean {
  return snap(v) === v;
}
