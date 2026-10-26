import { describe, expect, it } from 'vitest';
import { joinRegions, planRegions, type P2 } from '../src/mesh/plan.ts';

const square = (x: number, y: number, s: number): P2[] => [[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]]; // prettier-ignore
const areas = (lines: P2[][]) => planRegions(lines).regions.map((r) => Math.round(r.area));

describe('planRegions', () => {
  it('closes a square drawn as four loose lines, either way round', () => {
    const s = square(0, 0, 10);
    const lines = [0, 1, 2, 3].map((i) => (i % 2 ? [s[i + 1]!, s[i]!] : [s[i]!, s[i + 1]!]));
    const { regions } = planRegions(lines);
    expect(regions).toHaveLength(1);
    expect(regions[0]!.area).toBeCloseTo(100);
    expect(regions[0]!.outer).toHaveLength(4);
  });

  it('splits at crossings and T-junctions, and passes loose ends over', () => {
    // A square with a line across it, poking out both sides.
    const { regions, loose } = planRegions([
      square(0, 0, 10),
      [
        [5, -2],
        [5, 12],
      ],
    ]);
    expect(regions.map((r) => r.area)).toEqual([50, 50]);
    expect(loose).toBe(0); // the line across bounds both halves, though its ends are off
    // Each half is a plain rectangle: the point where the halves meet the line is gone.
    expect(regions.every((r) => r.outer.length === 4)).toBe(true);
  });

  it('makes a region inside another a hole in it, and a region of its own', () => {
    const { regions } = planRegions([square(0, 0, 10), square(3, 3, 4)]);
    expect(regions.map((r) => r.area)).toEqual([84, 16]);
    expect(regions[0]!.holes).toHaveLength(1);
  });

  it('carries an end left just short on to the line ahead of it', () => {
    // 1000 across: a line stopping 0.4 short of the far side still closes the room.
    const lines: P2[][] = [
      square(0, 0, 1000),
      [
        [0, 500],
        [999.6, 500],
      ],
    ];
    expect(areas(lines)).toEqual([500000, 500000]);
  });

  it('counts the lines given that bound nothing', () => {
    // A door's leaf and swing beside a room.
    const swing = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i): P2 => [20 + 5 * Math.cos((i * Math.PI) / 18), 5 * Math.sin((i * Math.PI) / 18)]); // prettier-ignore
    const { regions, loose } = planRegions([
      square(0, 0, 10),
      [
        [20, 0],
        [20, 5],
      ],
      swing,
    ]);
    expect(regions).toHaveLength(1);
    expect(loose).toBe(2);
  });

  it('counts a line drawn twice once, and a line into an island as nothing', () => {
    const s = square(0, 0, 10);
    const { regions } = planRegions([
      s,
      [...s].reverse(),
      square(4, 4, 2),
      [
        [0, 5],
        [4, 5],
      ],
    ]);
    expect(regions.map((r) => r.area)).toEqual([96, 4]);
  });
});

describe('joinRegions', () => {
  const box = (x0: number, y0: number, x1: number, y1: number): P2[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]; // prettier-ignore
  const part = (outer: P2[], holes: P2[][] = []) => ({ outer, holes });

  it('makes two faces side by side one, the line between them gone', () => {
    const r = joinRegions([part(box(0, 0, 10, 10)), part(box(10, 0, 20, 10))]);
    expect(r).toHaveLength(1);
    expect(r[0]!.area).toBeCloseTo(200);
    expect(r[0]!.outer).toHaveLength(4);
  });

  it('joins faces meeting along part of a side (a T), and counts overlaps once', () => {
    const t = joinRegions([part(box(0, 0, 10, 10)), part(box(10, 2, 20, 5))]);
    expect(t.map((r) => r.area)).toEqual([130]);
    expect(t[0]!.outer).toHaveLength(8);
    const over = joinRegions([part(box(0, 0, 10, 10)), part(box(5, 5, 15, 15))]);
    expect(over.map((r) => r.area)).toEqual([175]);
  });

  it('leaves faces apart that do not touch', () => {
    expect(joinRegions([part(box(0, 0, 1, 1)), part(box(5, 5, 7, 7))]).map((r) => r.area)).toEqual([4, 1]); // prettier-ignore
  });

  it('fills a hole with the face that fits it, and keeps a hole nothing fills', () => {
    const ring = part(box(0, 0, 10, 10), [[...box(3, 3, 7, 7)].reverse()]);
    const filled = joinRegions([ring, part(box(3, 3, 7, 7))]);
    expect(filled.map((r) => [r.area, r.holes.length])).toEqual([[100, 0]]);
    const walls = joinRegions([ring, part(box(10, 0, 12, 10))]);
    expect(walls.map((r) => [r.area, r.holes.length])).toEqual([[104, 1]]);
  });
});
