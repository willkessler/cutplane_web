import { describe, expect, it } from 'vitest';
import { ROOM, mat4 } from '@cutplane/kernel';

const { transformPoint } = mat4;
import { poseAt, simulate } from './gravity.ts';

const FLOOR = ROOM.min[1];

/** A box's corners (x y z …), turned by `m`. */
function box(lo: number[], hi: number[], m = mat4.identity()): Float32Array {
  const out: number[] = [];
  for (const x of [lo[0]!, hi[0]!])
    for (const y of [lo[1]!, hi[1]!])
      for (const z of [lo[2]!, hi[2]!]) out.push(...transformPoint(m, x, y, z));
  return Float32Array.from(out);
}

/** Points moved by a pose (row vectors). */
function placed(points: Float32Array, pose: Float64Array): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < points.length; i += 3)
    out.push(transformPoint(pose, points[i]!, points[i + 1]!, points[i + 2]!));
  return out;
}

const lowest = (pts: number[][]) => Math.min(...pts.map((p) => p[1]!));

describe('gravity: things fall to the floor and rest there', () => {
  it('a box held up at a slant lands flat on a face', async () => {
    const tilt = mat4.rotationAbout([0, 200, 0], [0, 0, 1], (30 * Math.PI) / 180);
    const pts = box([-50, 150, -40], [50, 250, 40], tilt);
    const fall = await simulate([{ parts: [pts] }]);
    expect(fall.frames).toBeGreaterThan(20); // it took a while: it fell
    const end = placed(pts, poseAt(fall, 0, fall.frames - 1));
    // Four corners on the floor, the other four a box's height up.
    const ys = end.map((p) => p[1]! - FLOOR).sort((a, b) => a - b);
    for (const y of ys.slice(0, 4)) expect(Math.abs(y)).toBeLessThan(1.5);
    for (const y of ys.slice(4)) expect(Math.abs(y - 100)).toBeLessThan(1.5);
  });

  it('a body on four legs, tilted, comes to rest on all four feet', async () => {
    const tilt = mat4.rotationAbout(
      [0, 100, 0],
      [1 / Math.hypot(1, 0.4), 0, 0.4 / Math.hypot(1, 0.4)],
      (25 * Math.PI) / 180,
    );
    const body = box([-100, 80, -60], [100, 120, 60], tilt);
    const legs = [
      [-95, -55],
      [85, -55],
      [-95, 45],
      [85, 45],
    ].map(([x, z]) => box([x!, 0, z!], [x! + 10, 80, z! + 10], tilt));
    const fall = await simulate([{ parts: [body, ...legs] }]);
    const pose = poseAt(fall, 0, fall.frames - 1);
    // Each foot is on the floor; the body stands clear of it.
    for (const leg of legs) expect(Math.abs(lowest(placed(leg, pose)) - FLOOR)).toBeLessThan(2);
    expect(lowest(placed(body, pose)) - FLOOR).toBeGreaterThan(70);
  });

  it('one through the floor is brought up into the room, and two dropped together stack', async () => {
    const sunk = box([-30, FLOOR - 20, -30], [30, FLOOR + 40, 30]);
    const above = box([-30, 0, -30], [30, 60, 30]);
    const fall = await simulate([{ parts: [sunk] }, { parts: [above] }]);
    const a = lowest(placed(sunk, poseAt(fall, 0, fall.frames - 1)));
    const b = lowest(placed(above, poseAt(fall, 1, fall.frames - 1)));
    expect(Math.abs(a - FLOOR)).toBeLessThan(1.5);
    expect(Math.abs(b - (FLOOR + 60))).toBeLessThan(2); // on top of the first
  });
});
