import { beforeAll, describe, expect, it } from 'vitest';
import {
  createCube,
  createOvalCone,
  createOvalCylinder,
  createSphere,
  createTorus,
  mat4,
  validate,
  volume,
  type Brep,
  type Mat4,
} from '@cutplane/kernel';
import {
  booleanSolids,
  initBooleans,
  shellsToBrep,
  sliceSolid,
  solidsOf,
  type ResultShell,
} from '../src/index.ts';

beforeAll(() => initBooleans());

const cube = (w: number, h: number, d: number, at: Mat4 = mat4.identity()) => ({
  brep: createCube(w, h, d),
  xform: at,
});
const T = (x: number, y: number, z: number) => mat4.translation(x, y, z);

function sound(b: Brep): void {
  const r = validate(b);
  expect(r.issues.filter((i) => i.severity === 'error')).toEqual([]);
  expect(r.closedManifold).toBe(true);
}

const brepOf = (shells: ResultShell[]) => shellsToBrep(shells).brep;

describe('booleans through manifold-3d, back to polygon faces', () => {
  it('a cube less an overlapping cube is an L-shaped block, its faces whole polygons', () => {
    const r = booleanSolids(cube(100, 100, 100), cube(100, 100, 100, T(50, 50, 0)), 'subtract')!;
    expect(r).toHaveLength(1);
    const b = brepOf(r);
    sound(b);
    expect(volume(b)).toBeCloseTo(100 ** 3 - 50 * 50 * 100, 6);
    // An L-prism: two L faces and six rectangles; no triangles left over.
    expect(b.faces()).toHaveLength(8);
    expect(b.vertices()).toHaveLength(12);
    // Every vertex lands on the grid exactly, as the inputs were.
    for (const v of b.vertices()) for (const c of b.vertexPos(v)) expect(c % 50).toBe(0);
  });

  it('a hole through a cube leaves two faces with holes in them (genus 1)', () => {
    const r = booleanSolids(cube(100, 100, 100), cube(20, 20, 140, T(40, 40, -20)), 'subtract')!;
    const b = brepOf(r);
    sound(b);
    expect(volume(b)).toBeCloseTo(100 ** 3 - 20 * 20 * 100, 6);
    expect(b.faces()).toHaveLength(10);
    const withHoles = b.faces().filter((f) => b.faceLoops(f).length === 2);
    expect(withHoles).toHaveLength(2);
    // V - E + F = 2 - 2g, counting loops: V - E + F - (L - F) = 2(S - G).
    const V = b.vertices().length;
    const E = b.edges().length;
    const F = b.faces().length;
    const L = b.loops().length;
    expect(V - E + F - (L - F)).toBe(0);
  });

  it('union and intersection', () => {
    const a = cube(100, 100, 100);
    const c = cube(100, 100, 100, T(50, 0, 0));
    const u = brepOf(booleanSolids(a, c, 'union')!);
    sound(u);
    expect(volume(u)).toBeCloseTo(150 * 100 * 100, 6);
    expect(u.faces()).toHaveLength(6); // coplanar faces merge back into one
    const i = brepOf(booleanSolids(a, c, 'intersect')!);
    sound(i);
    expect(volume(i)).toBeCloseTo(50 * 100 * 100, 6);
  });

  it('points closer than a grid step become one (a fine sphere on a cone, cutplane_web)', () => {
    // Stacked with an overlap of a thousandth: corners that far apart snap together.
    const a = cube(100, 100, 100);
    const c = cube(100, 100, 100, T(50, 99.999, 50));
    for (const op of ['union', 'subtract'] as const) {
      const r = booleanSolids(a, c, op);
      expect(r).not.toBeNull();
      sound(brepOf(r!));
    }
    // The thousandth snaps away: two cubes' worth, near enough.
    expect(volume(brepOf(booleanSolids(a, c, 'union')!))).toBeCloseTo(2 * 100 ** 3, -1);
  });

  it('a long ellipsoid grazing a cone joins it (slivers finer than the grid go)', () => {
    // The Orion III's nose (a cone, its point drawn down) and the flat ellipsoid that curves
    // its top: they meet at a shallow angle, and the union chained a face out to a vertex
    // and back, and left a triangle whose corners fell in a line on the grid.
    const nose = createOvalCone(42.5, 42.5, 50, 72);
    const tip = nose.vertices().find((v) => nose.vertexPos(v)[2] === 50)!;
    nose.setVertexPos(tip, -1.2890625, -35.703125, 49.99609375);
    const r = booleanSolids(
      {
        brep: nose,
        xform: new Float64Array([
          1.06352, 0, 0, 0, 0, 1.053169896468035, 0.1480133763330488, 0, 0, -0.7237001249923404,
          5.149393957456167, 0, -1.2587942564569303, -27.89564016921352, 208.76789464185978, 1,
        ]),
      },
      {
        brep: createSphere(42.5, 72),
        xform: new Float64Array([
          0.4832, 0, 0, 0, 0, 0.47264663583642347, 0.22807936695920575, 0, 0, -1.108616032867996,
          2.297374134956713, 0, -1.2587942564569303, -34.32846617747509, 281.7884005450943, 1,
        ]),
      },
      'union',
    );
    expect(r).not.toBeNull();
    expect(r).toHaveLength(1);
    sound(brepOf(r!));
  });

  it('a ring less a bigger copy on its axis (a tyre trimmed): slivers that fold flat go', () => {
    // The primitives box's ring, hollowed by a cylinder, then cut by a copy of itself made
    // larger, on the one axis (as a person placed them, turned and scaled by hand): the
    // output repeats a vertex, a sliver's corners merged, and its edges hid a neighbour's
    // from the face's boundary, so a face went and the cut was refused.
    const up = mat4.rotationAbout([0, 0, 0], [1, 0, 0], -Math.PI / 2);
    const hole = { brep: createOvalCylinder(20, 20, 40, 72), xform: mat4.multiply(T(0, 0, -20), up) }; // prettier-ignore
    const hollow = booleanSolids({ brep: createTorus(23.8, 10.2, 72), xform: mat4.identity() }, hole, 'subtract'); // prettier-ignore
    expect(hollow).toHaveLength(1);
    const tyre = brepOf(hollow!);
    const placed = (s: number, e: number) =>
      new Float64Array([s, 3.5e-17, 7.8e-15, 0, 1.4e-15, e, s, 0, 8.3e-32, -s, 2.3e-16, 0, -249.91852054238825, 60.306118320636074, -495.25, 1]); // prettier-ignore
    const r = booleanSolids({ brep: tyre, xform: placed(3.67989606336737, 9.5e-16) }, { brep: tyre, xform: placed(5.256538621543959, 7e-16) }, 'subtract'); // prettier-ignore
    expect(r).toHaveLength(1);
    sound(brepOf(r!));
  });

  it('keeps where each face came from', () => {
    const a = cube(100, 100, 100);
    const r = booleanSolids(a, cube(100, 100, 100, T(50, 50, 0)), 'subtract')!;
    const { brep, sources } = shellsToBrep(r);
    const ops = [...sources.values()].map((s) => s?.operand);
    expect(ops.filter((o) => o === 0)).toHaveLength(6);
    expect(ops.filter((o) => o === 1)).toHaveLength(2); // the notch's two walls
    for (const s of sources.values())
      if (s?.operand === 0) expect(a.brep.isFace(s.face)).toBe(true);
    expect(brep.faces()).toHaveLength(8);
  });

  it("works in the first operand's frame, whatever the second is placed at", () => {
    const at = mat4.multiply(
      mat4.rotationAbout([0, 0, 0], [0, 0, 1], Math.PI / 6),
      T(300, -40, 25),
    );
    const cutter = mat4.multiply(at, T(30, 30, -50));
    const r = booleanSolids(cube(100, 100, 100, at), cube(40, 40, 200, cutter), 'subtract')!;
    const b = brepOf(r);
    sound(b);
    expect(volume(b)).toBeCloseTo(100 ** 3 - 40 * 40 * 100, 3);
    // Local coordinates stay exact for the first cube's own corners.
    const corners = b.vertices().map((v) => b.vertexPos(v));
    expect(corners).toContainEqual([100, 100, 100]);
  });

  it('a cutter that misses changes nothing; one that swallows leaves nothing', () => {
    const a = cube(10, 10, 10);
    const miss = brepOf(booleanSolids(a, cube(10, 10, 10, T(50, 0, 0)), 'subtract')!);
    expect(volume(miss)).toBeCloseTo(1000, 6);
    expect(miss.faces()).toHaveLength(6);
    const all = booleanSolids(a, cube(30, 30, 30, T(-10, -10, -10)), 'subtract')!;
    expect(all).toEqual([]);
  });

  it('a subtraction that cuts a bar in two gives two solids', () => {
    const r = booleanSolids(cube(300, 50, 50), cube(20, 100, 100, T(140, -20, -20)), 'subtract')!;
    const solids = solidsOf(r);
    expect(solids).toHaveLength(2);
    for (const s of solids) {
      const b = brepOf(s);
      sound(b);
      expect(volume(b)).toBeCloseTo(140 * 50 * 50, 6);
    }
  });

  it('a cutter inside leaves a void, kept with the solid around it', () => {
    const r = booleanSolids(cube(100, 100, 100), cube(20, 20, 20, T(40, 40, 40)), 'subtract')!;
    expect(r).toHaveLength(2);
    const solids = solidsOf(r);
    expect(solids).toHaveLength(1);
    const b = brepOf(solids[0]!);
    sound(b);
    expect(volume(b)).toBeCloseTo(100 ** 3 - 20 ** 3, 6);
  });
});

describe('slicing at the plane', () => {
  it('cuts a cube in two along z, each piece closed with a cap face', () => {
    const r = sliceSolid(cube(100, 100, 100, T(0, 0, -30)), 0)!;
    expect(r.back).toHaveLength(1);
    expect(r.front).toHaveLength(1);
    const back = brepOf(r.back);
    const front = brepOf(r.front);
    sound(back);
    sound(front);
    expect(volume(back)).toBeCloseTo(100 * 100 * 30, 6);
    expect(volume(front)).toBeCloseTo(100 * 100 * 70, 6);
    expect(back.faces()).toHaveLength(6);
    // In the cube's frame, the cut lies at z = 30.
    expect(
      front
        .vertices()
        .map((v) => front.vertexPos(v)[2])
        .sort(),
    ).toContain(30);
    const { sources } = shellsToBrep(r.front);
    expect([...sources.values()].filter((s) => s === null)).toHaveLength(1);
  });

  it('a plane that misses leaves one side empty', () => {
    const r = sliceSolid(cube(10, 10, 10), 50)!;
    expect(r.front).toEqual([]);
    expect(r.back).toHaveLength(1);
  });

  it('a slice through a rotated solid is exact on the plane', () => {
    const at = mat4.multiply(mat4.rotationAbout([0, 0, 0], [1, 1, 0], 0.7), T(10, 20, -40));
    const r = sliceSolid(cube(80, 60, 50, at), -5)!;
    const pieces = [...r.back, ...r.front];
    expect(pieces).toHaveLength(2);
    let total = 0;
    for (const s of pieces) {
      const b = brepOf([s]);
      sound(b);
      total += volume(b);
      // The cap's vertices are on the plane in the room, to well under the grid.
      const cap = s.faces.find((f) => f.source === null)!;
      for (const i of cap.loops.flat()) {
        const p = s.positions[i]!;
        const w = mat4.transformPoint(at, p[0], p[1], p[2]);
        expect(Math.abs(w[2] + 5)).toBeLessThan(1e-9);
      }
    }
    // This plane passes 0.0005 from a corner (under the grid), which manifold takes as on it.
    expect(total).toBeCloseTo(80 * 60 * 50, 0);
  });
});
