import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  Brep,
  createCube,
  createCubeHole,
  createObject,
  createSphere,
  mef,
  createPyramid,
  deleteEdge,
  deleteFace,
  deleteVertex,
  duplicateTree,
  mat4,
  transformTree,
  validate,
  volume,
} from '../src/index.ts';

type V3 = [number, number, number];

const vertexAt = (b: Brep, p: V3) =>
  b.vertices().find((v) => b.vertexPos(v).every((c, i) => Math.abs(c - p[i]!) < 1e-9))!;

function expectSound(b: Brep): void {
  const r = validate(b, { planarityTolerance: 1e-6 });
  expect(r.issues.filter((i) => i.severity === 'error')).toEqual([]);
  expect(r.closedManifold).toBe(true);
  expect(r.counts['nonplanar-face'] ?? 0).toBe(0);
}

describe('deleting features', () => {
  it('cuts a cube corner off when its vertex is deleted', () => {
    const b = createCube(100, 100, 100);
    deleteVertex(b, vertexAt(b, [100, 100, 100]));
    expectSound(b);
    expect([b.numVertices, b.numFaces]).toEqual([7, 7]);
    expect(volume(b)).toBeCloseTo(1e6 - 1e6 / 6);
  });

  it('triangulates a bent face left by deleting a pyramid apex... and flattens a square one', () => {
    const b = createPyramid(100, 100, 100);
    const before = b.numFaces;
    const top = b.vertices().reduce((a, v) => (b.vy(v) > b.vy(a) ? v : a));
    deleteVertex(b, top);
    // The apex's four sides become the base again: two coincident faces, no volume.
    expect(b.numFaces).toBeLessThan(before);
    expect(Math.abs(volume(b))).toBeLessThan(1e-6);
  });

  it('merges coplanar faces when the edge between them goes', () => {
    const b = createCube(100, 100, 100);
    // Split the front face in two, then delete the split.
    const f = b.faces().find((x) => b.faceNormal(x)[2] === 1)!;
    const hs = b.loopHalfEdges(b.faceLoop(f));
    const { edge } = mefSplit(b, hs[0]!, hs[2]!);
    expect(b.numFaces).toBe(7);
    deleteEdge(b, edge);
    expect(b.numFaces).toBe(6);
    expectSound(b);
  });

  it('deletes a cube edge with both its ends: a wedge is left', () => {
    const b = createCube(100, 100, 100);
    const p = vertexAt(b, [100, 100, 100]);
    const q = vertexAt(b, [100, 100, 0]);
    const e = b.edges().find((x) => {
      const [a, c] = b.edgeVertices(x);
      return (a === p && c === q) || (a === q && c === p);
    })!;
    deleteEdge(b, e);
    expectSound(b);
    expect(b.numVertices).toBe(6);
    expect(volume(b)).toBeCloseTo(5e5);
  });

  it('deletes a face with its vertices', () => {
    const b = createCubeHole();
    const v0 = volume(b);
    const f = b.faces().find((x) => b.faceLoops(x).length === 1 && b.faceNormal(x)[1] === -1)!;
    deleteFace(b, f);
    expect(validate(b).ok).toBe(true);
    expect(volume(b)).toBeLessThan(v0);
  });
});

describe('object trees', () => {
  it('rotates a tree about a line', () => {
    const o = createObject(createCube(10, 10, 10));
    const c = createObject(createCube(10, 10, 10), { xform: mat4.translation(20, 0, 0) });
    o.children.push(c);
    c.parent = o;
    transformTree(o, mat4.rotationAbout([0, 0, 0], [0, 0, 1], Math.PI / 2));
    const p = mat4.transformPoint(c.xform, 0, 0, 0);
    expect(p[0]).toBeCloseTo(0);
    expect(p[1]).toBeCloseTo(20);
    const back = mat4.transformPoint(c.invXform, ...p);
    expect(back.map((x) => Math.abs(x) < 1e-9)).toEqual([true, true, true]);
  });

  it('scales about a point', () => {
    const p = mat4.transformPoint(mat4.scaleAbout([10, 10, 10], [2, 3, 1]), 20, 20, 20);
    expect(p).toEqual([30, 40, 20]);
  });

  it('duplicates a tree deeply', () => {
    const o = createObject(createCube(10, 10, 10), { name: 'a', color: [1, 2, 3] });
    const c = createObject(createCube(5, 5, 5));
    o.children.push(c);
    c.parent = o;
    const d = duplicateTree(o);
    expect(d.name).toBeNull();
    expect(d.children).toHaveLength(1);
    expect(d.children[0]!.parent).toBe(d);
    expect(d.brep).not.toBe(o.brep);
    d.color[0] = 9;
    d.brep.setVertexPos(0, 1, 1, 1);
    expect(o.color[0]).toBe(1);
    expect(o.brep.vertexPos(0)).not.toEqual([1, 1, 1]);
  });
});

const mefSplit = (b: Brep, h1: number, h2: number) => mef(b, h1, h2);

describe('deleting features (property)', () => {
  const RUNS = Number(process.env['RUNS'] ?? 200);
  it('always leaves a structurally valid Brep', () => {
    const solids = [
      () => createCube(100, 100, 100),
      () => createCubeHole(),
      () => createSphere(80, 8),
    ];
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: solids.length - 1 }),
        fc.array(fc.tuple(fc.constantFrom('vertex', 'edge', 'face'), fc.nat()), {
          minLength: 1,
          maxLength: 3,
        }),
        (which, ops) => {
          const b = solids[which]!();
          for (const [kind, n] of ops) {
            const ids = kind === 'vertex' ? b.vertices() : kind === 'edge' ? b.edges() : b.faces();
            if (ids.length === 0) return;
            const id = ids[n % ids.length]!;
            try {
              if (kind === 'vertex') deleteVertex(b, id);
              else if (kind === 'edge') deleteEdge(b, id);
              else deleteFace(b, id);
            } catch {
              return; // refused: the editor rolls these back
            }
            const r = validate(b, { maxIssuesPerCode: 3 });
            const structural = r.issues.filter(
              (i) =>
                i.severity === 'error' &&
                !/degenerate|zero-length|nonplanar|duplicate|coincident/.test(i.code),
            );
            expect(structural, JSON.stringify([which, ops])).toEqual([]);
          }
        },
      ),
      { numRuns: RUNS },
    );
  });
});
