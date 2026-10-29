import { describe, expect, it } from 'vitest';
import {
  Brep,
  createCube,
  createCubeHole,
  createDonut,
  createTorus,
  createRing,
  createIsoscelesPrism,
  createLBeam,
  createOval,
  createOvalCone,
  createOvalCylinder,
  createParaboloid,
  createPyramid,
  createSphere,
  createSquare,
  createTBeam,
  createVase,
  isSnapped,
  signedVolume,
  validate,
} from '../src/index.ts';

const solids: [string, () => Brep, number][] = [
  ['cube', () => createCube(100, 50, 20), 2],
  ['isosceles prism', () => createIsoscelesPrism(30, 40), 2],
  ['oval cylinder', () => createOvalCylinder(40, 20, 60, 16), 2],
  ['oval cone', () => createOvalCone(40, 40, 80, 12), 2],
  ['pyramid', () => createPyramid(60, 90, 60), 2],
  ['sphere', () => createSphere(50, 12), 2],
  ['donut', () => createDonut(30, 12), 0],
  ['torus (a thin ring)', () => createTorus(60, 12, 16), 0],
  ['flat ring', () => createRing(60, 40, 30, 16), 0],
  ['paraboloid', () => createParaboloid(100, 60, 10, 8), 2],
  ['vase', () => createVase(4, 4, 10), 2],
  ['L-beam', () => createLBeam(200, 180, 55, 200), 2],
  ['T-beam', () => createTBeam(200, 180, 40, 100), 2],
  ['cube with hole', () => createCubeHole(), 0],
];

describe.each(solids)('%s', (_name, make, euler) => {
  const b = make();
  const r = validate(b);

  it('is a valid closed manifold', () => {
    expect(r.issues).toEqual([]);
    expect(r.closedManifold).toBe(true);
  });

  it(`has Euler characteristic ${euler}`, () => {
    expect(r.shells.map((s) => s.euler)).toEqual([euler]);
  });

  it('faces outward (positive volume)', () => {
    expect(signedVolume(b, b.shells()[0]!)).toBeGreaterThan(0);
  });

  it('has every vertex on the snap grid', () => {
    for (const v of b.vertices()) expect(b.vertexPos(v).every(isSnapped)).toBe(true);
  });
});

describe('specific shapes', () => {
  it('cube has the right counts and volume', () => {
    const b = createCube(100, 50, 20);
    expect([b.numVertices, b.numEdges, b.numFaces]).toEqual([8, 12, 6]);
    expect(signedVolume(b, b.shells()[0]!)).toBeCloseTo(100 * 50 * 20);
  });

  it('cube with hole has a ring on each end face and volume 200³ − 100·100·200', () => {
    const b = createCubeHole();
    expect(b.faces().filter((f) => b.faceLoops(f).length === 2)).toHaveLength(2);
    expect(signedVolume(b, b.shells()[0]!)).toBeCloseTo(200 ** 3 - 100 * 100 * 200);
  });

  it('laminas are valid two-faced shells', () => {
    for (const b of [createSquare(10, 20), createOval(10, 5, 9)]) {
      const r = validate(b);
      expect(r.closedManifold).toBe(true);
      expect(b.numFaces).toBe(2);
    }
  });
});

describe('a flat ring (new)', () => {
  it('has its sides whole, each a face with a hole, and its band in quads', () => {
    const b = createRing(60, 40, 30, 16);
    expect(b.numFaces).toBe(2 + 2 * 16);
    expect(b.faces().filter((f) => b.faceLoops(f).length === 2)).toHaveLength(2);
    const zs = b.vertices().map((v) => b.vertexPos(v)[2]);
    expect([Math.min(...zs), Math.max(...zs)]).toEqual([0, 30]);
  });
});
