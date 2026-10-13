import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  Brep,
  MIN_SNAP_MOVE,
  PlaneSnapper,
  WorldGeometry,
  computeSection,
  createCube,
  createCubeHole,
  createDonut,
  createIsoscelesPrism,
  createOvalCylinder,
  createPyramid,
  createSphere,
  loopArea,
  mat4,
  type Mat4,
} from '../src/index.ts';

/** Rotation by Euler angles (radians) about x, then y, then z, then a translation; row-vector form. */
function placement(
  ax: number,
  ay: number,
  az: number,
  t: [number, number, number] = [0, 0, 0],
): Mat4 {
  const rx = mat4.fromRows([[1, 0, 0, 0], [0, Math.cos(ax), Math.sin(ax), 0], [0, -Math.sin(ax), Math.cos(ax), 0], [0, 0, 0, 1]]); // prettier-ignore
  const ry = mat4.fromRows([[Math.cos(ay), 0, -Math.sin(ay), 0], [0, 1, 0, 0], [Math.sin(ay), 0, Math.cos(ay), 0], [0, 0, 0, 1]]); // prettier-ignore
  const rz = mat4.fromRows([[Math.cos(az), Math.sin(az), 0, 0], [-Math.sin(az), Math.cos(az), 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]); // prettier-ignore
  return mat4.multiply(mat4.multiply(mat4.multiply(rx, ry), rz), mat4.translation(...t));
}

const section = (b: Brep, z: number, xf: Mat4 = mat4.identity()) =>
  computeSection(new WorldGeometry(b, xf), z);
const totalArea = (s: ReturnType<typeof section>) => s.loops.reduce((a, l) => a + loopArea(l), 0);

describe('computeSection', () => {
  const cube = createCube(200, 200, 200); // 0..200 on every axis

  it('cuts a cube in one counter-clockwise square', () => {
    const s = section(cube, 100);
    expect(s.loops).toHaveLength(1);
    const [loop] = s.loops;
    expect(loop!.closed).toBe(true);
    expect(loop!.points.length / 3).toBe(4);
    expect(loop!.segments).toHaveLength(4);
    expect(loopArea(loop!)).toBeCloseTo(40000);
    for (let i = 2; i < loop!.points.length; i += 3) expect(loop!.points[i]).toBe(100);
    expect(s.inPlaneFaces).toEqual([]);
  });

  it('misses an object entirely in front of or behind the plane', () => {
    expect(section(cube, 300).loops).toEqual([]);
    expect(section(cube, -1).loops).toEqual([]);
  });

  it('outlines a face lying in the plane when the rest is behind it', () => {
    const s = section(cube, 200);
    expect(s.loops).toHaveLength(1);
    expect(s.loops[0]!.closed).toBe(true);
    expect(loopArea(s.loops[0]!)).toBeCloseTo(40000);
    expect(s.inPlaneFaces).toHaveLength(1);
    expect(s.inPlaneEdges).toHaveLength(4);
  });

  it('reports an in-plane face with the rest in front, but draws no loop', () => {
    const s = section(cube, 0);
    expect(s.loops).toEqual([]);
    expect(s.inPlaneFaces).toHaveLength(1);
    expect(s.inPlaneEdges).toHaveLength(4);
  });

  it('takes a face a little out of flat (old files drift) as lying in the plane', () => {
    // The 1991 Discovery's faces are up to 0.09 off flat; the original's Tolerance is 0.5.
    const warped = createCube(200, 200, 200);
    const top = warped.vertices().filter((v) => warped.vz(v) === 200);
    top.forEach((v, i) => warped.setVertexPos(v, warped.vx(v), warped.vy(v), 200 + [0, 0.05, -0.04, 0.09][i]!)); // prettier-ignore
    const s = section(warped, 200);
    expect(s.inPlaneFaces).toHaveLength(1);
    expect(s.loops).toHaveLength(1);
    expect(s.loops[0]!.points.length / 3).toBe(4);
    expect(loopArea(s.loops[0]!)).toBeCloseTo(40000);
  });

  it('finds the hole: an outer loop and a clockwise inner loop', () => {
    const s = section(createCubeHole(), 0);
    expect(s.loops).toHaveLength(2);
    const areas = s.loops.map(loopArea).sort((a, b) => a - b);
    expect(areas[0]).toBeCloseTo(-10000);
    expect(areas[1]).toBeCloseTo(40000);
    expect(s.loops.every((l) => l.closed)).toBe(true);
  });

  it('cuts a donut lying flat through both sides of its tube', () => {
    const s = section(createDonut(100, 16), 0);
    expect(s.loops).toHaveLength(2);
    for (const l of s.loops) {
      expect(l.closed).toBe(true);
      expect(loopArea(l)).toBeGreaterThan(0);
    }
  });

  it('keeps the area of a cube spun about z', () => {
    for (const az of [0.1, 0.7, Math.PI / 4, 2]) {
      const s = section(cube, 50, placement(0, 0, az, [10, -20, 0]));
      expect(s.loops).toHaveLength(1);
      expect(totalArea(s)).toBeCloseTo(40000, 6);
    }
  });

  it('shrinks to a point where a corner touches the plane', () => {
    const xf = placement(Math.PI / 4, Math.atan(1 / Math.SQRT2), 0);
    const g = new WorldGeometry(cube, xf);
    const s = computeSection(g, g.zMax);
    for (const l of s.loops) {
      expect(l.closed).toBe(true);
      expect(Math.abs(loopArea(l))).toBeLessThan(1e-6);
    }
  });

  it('cuts along an in-plane edge of a rotated cube (two faces meet at the plane)', () => {
    // Rotated 45° about y: the edge x = 0, z = 0 ... becomes the front-most ridge.
    const g = new WorldGeometry(cube, placement(0, Math.PI / 4, 0));
    const s = computeSection(g, g.zMax);
    expect(s.inPlaneEdges).toHaveLength(1);
    for (const l of s.loops) expect(l.closed).toBe(true);
  });

  const solids: [string, () => Brep][] = [
    ['cube', () => createCube(120, 80, 60)],
    ['prism', () => createIsoscelesPrism(70, 90)],
    ['pyramid', () => createPyramid(100, 120, 80)],
    ['cylinder', () => createOvalCylinder(60, 40, 12, 100)],
    ['sphere', () => createSphere(80, 10)],
    ['donut', () => createDonut(50, 10)],
    ['cube with hole', () => createCubeHole()],
  ];

  it('always yields closed loops with non-negative total area (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: solids.length - 1 }),
        fc.tuple(
          fc.double({ min: -4, max: 4 }),
          fc.double({ min: -4, max: 4 }),
          fc.double({ min: -4, max: 4 }),
        ),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.boolean(),
        (k, [ax, ay, az], u, atVertex) => {
          const b = solids[k]![1]();
          const g = new WorldGeometry(b, placement(ax, ay, az, [5, -7, 3]));
          let z = g.zMin + u * (g.zMax - g.zMin);
          if (atVertex) {
            // Park the plane exactly on a vertex depth, as plane snapping does.
            const vs = b.vertices();
            z = g.z(vs[Math.floor(u * (vs.length - 1))]!);
          }
          const s = computeSection(g, z);
          for (const l of s.loops) expect(l.closed).toBe(true);
          expect(totalArea(s)).toBeGreaterThan(-1e-6);
        },
      ),
      { numRuns: 400 },
    );
  });
});

describe('PlaneSnapper', () => {
  it('lands slow moves on a vertex depth, then carries on', () => {
    const p = new PlaneSnapper(60);
    p.setDepths([0, 50, 50.2, -200, 9999]);
    expect([...p.stops]).toEqual([-200, 0, 50]);
    expect(p.move(-6)).toBe(54);
    expect(p.move(-6)).toBe(50); // would have passed 50
    expect(p.isSnapped).toBe(true);
    expect(p.move(-1)).toBe(49); // no holding: the next move leaves at once
    expect(p.isSnapped).toBe(false);
    expect(p.move(-6, true)).toBe(43); // constrain: no stops
  });

  it('flies through stops on fast moves', () => {
    const p = new PlaneSnapper(100);
    p.setDepths([0, 50, 95]);
    expect(p.move(-(MIN_SNAP_MOVE + 1))).toBe(100 - MIN_SNAP_MOVE - 1);
    expect(p.move(-60)).toBe(100 - MIN_SNAP_MOVE - 61);
  });

  it('snaps moving forward too, and clamps to the room', () => {
    const p = new PlaneSnapper(-305);
    p.setDepths([-300]);
    expect(p.move(7)).toBe(-300);
    p.set(400);
    expect(p.move(1000)).toBe(500);
  });
});
