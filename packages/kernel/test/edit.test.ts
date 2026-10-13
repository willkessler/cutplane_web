import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  Brep,
  WorldGeometry,
  buildShell,
  computeSection,
  createCube,
  createCubeHole,
  mat4,
  pickAt,
  planarizeForMotion,
  recombineSurfaces,
  validate,
} from '../src/index.ts';

type V3 = [number, number, number];

/** One drag step, as the editor does it: planarize for the motion, then move. */
function drag(b: Brep, verts: number[], d: V3): void {
  const moving = new Set(verts);
  planarizeForMotion(b, moving, d);
  for (const v of moving) {
    const [x, y, z] = b.vertexPos(v);
    b.setVertexPos(v, x + d[0], y + d[1], z + d[2]);
  }
}

const vertexAt = (b: Brep, p: V3) =>
  b.vertices().find((v) => b.vertexPos(v).every((c, i) => c === p[i]))!;

/** Valid, closed, and every face flat. */
function expectSound(b: Brep): void {
  const r = validate(b, { planarityTolerance: 1e-6 });
  expect(r.issues.filter((i) => i.severity === 'error')).toEqual([]);
  expect(r.closedManifold).toBe(true);
  expect(r.counts['nonplanar-face'] ?? 0).toBe(0);
}

describe('planarize and recombine', () => {
  it('splits the three faces at a cube corner pulled out of all of them', () => {
    const b = createCube(200, 200, 200);
    drag(b, [vertexAt(b, [200, 200, 200])], [30, 20, 10]);
    expectSound(b);
    expect(b.numFaces).toBe(9); // three quads became six triangles
    expect(new Set(b.faceSurface.values()).size).toBe(3);
  });

  it('leaves a face alone when the motion slides within its plane', () => {
    const b = createCube(200, 200, 200);
    // Along x: stays in the y = 0 and z = 0 faces, bends only the x = 0 face.
    drag(b, [vertexAt(b, [0, 0, 0])], [-25, 0, 0]);
    expectSound(b);
    expect(b.numFaces).toBe(7);
  });

  it('merges the pieces back when the corner returns', () => {
    const b = createCube(200, 200, 200);
    const v = vertexAt(b, [200, 200, 200]);
    drag(b, [v], [30, 20, 10]);
    drag(b, [v], [-10, -5, 0]);
    drag(b, [v], [-20, -15, -10]);
    expect(recombineSurfaces(b)).toBe(3);
    expect(b.numFaces).toBe(6);
    expect(b.faceSurface.size).toBe(0);
    expectSound(b);
  });

  it('merges a slightly bent legacy face back once the drag returns', () => {
    const b = createCube(200, 200, 200);
    // Bend the front face a little, as float32-era files do.
    const bent = vertexAt(b, [0, 200, 200]);
    b.setVertexPos(bent, 0, 200, 200.05);
    const v = vertexAt(b, [200, 200, 200]);
    drag(b, [v], [30, 20, 10]);
    drag(b, [v], [-30, -20, -10]);
    recombineSurfaces(b);
    expect(b.numFaces).toBe(6);
  });

  it('keeps the triangles that are no longer coplanar', () => {
    const b = createCube(200, 200, 200);
    drag(b, [vertexAt(b, [200, 200, 200])], [30, 20, 10]);
    expect(recombineSurfaces(b)).toBe(0);
    expect(b.numFaces).toBe(9);
    expectSound(b);
  });

  it('moves a face rigidly and splits its neighbours', () => {
    const b = createCube(200, 200, 200);
    const front = b.faces().find((f) => b.faceNormal(f)[2] > 0.99)!;
    const verts = b.loopHalfEdges(b.faceLoop(front)).map((h) => b.heVertex(h));
    drag(b, verts, [40, -30, 0]);
    expectSound(b);
    // The front face is untouched; the four sides become two triangles each.
    expect(b.isFace(front)).toBe(true);
    expect(b.numFaces).toBe(10);
  });

  it('moves an edge and keeps the solid sound', () => {
    const b = createCube(200, 200, 200);
    drag(b, [vertexAt(b, [200, 200, 0]), vertexAt(b, [200, 200, 200])], [25, 35, 0]);
    expectSound(b);
  });

  it('triangulates a face with a hole when one of its corners moves', () => {
    const b = createCubeHole();
    drag(b, [vertexAt(b, [100, 100, 100])], [0, 0, 30]);
    expectSound(b);
    recombineSurfaces(b);
    expectSound(b);
  });

  it('restores the hole when the corner comes back', () => {
    const b = createCubeHole();
    const faces = b.numFaces;
    const loops = b.numLoops;
    const v = vertexAt(b, [100, 100, 100]);
    drag(b, [v], [0, 0, 30]);
    drag(b, [v], [0, 0, -30]);
    recombineSurfaces(b);
    expect(b.numFaces).toBe(faces);
    expect(b.numLoops).toBe(loops);
    expectSound(b);
  });

  it('any sequence of vertex, edge and face drags leaves a sound solid', () => {
    const step = fc.tuple(
      fc.constantFrom('vertex', 'edge', 'face'),
      fc.nat(),
      fc.tuple(
        fc.integer({ min: -40, max: 40 }),
        fc.integer({ min: -40, max: 40 }),
        fc.integer({ min: -40, max: 40 }),
      ),
    );
    fc.assert(
      fc.property(fc.boolean(), fc.array(step, { minLength: 1, maxLength: 8 }), (holed, steps) => {
        const b = holed ? createCubeHole() : createCube(200, 200, 200);
        for (const [kind, n, d] of steps) {
          let verts: number[];
          if (kind === 'vertex') verts = [b.vertices()[n % b.numVertices]!];
          else if (kind === 'edge') verts = b.edgeVertices(b.edges()[n % b.numEdges]!);
          else {
            const f = b.faces()[n % b.numFaces]!;
            verts = b
              .surfaceFaces(f)
              .flatMap((g) =>
                b.faceLoops(g).flatMap((l) => b.loopHalfEdges(l).map((h) => b.heVertex(h))),
              );
          }
          drag(b, verts, d);
        }
        expectSound(b);
        recombineSurfaces(b);
        expectSound(b);
      }),
      { numRuns: Number(process.env['RUNS'] ?? 300) },
    );
  });
});

describe('pickAt', () => {
  const cube = createCube(200, 200, 200);
  const g = new WorldGeometry(cube, mat4.identity());
  const at = (x: number, y: number, z: number) => pickAt(g, computeSection(g, z), x, y, z);

  it('picks a piercing edge at its piercing point, then a face, then the object', () => {
    const e = at(4, 6, 100)!;
    expect(e.kind).toBe('edge');
    const [p, q] = cube.edgeVertices(e.id);
    expect([cube.vertexPos(p).slice(0, 2), cube.vertexPos(q).slice(0, 2)]).toEqual([
      [0, 0],
      [0, 0],
    ]);
    expect(e.at).toEqual([0, 0, 100]);
    const f = at(3, 100, 100)!;
    expect(f.kind).toBe('face');
    expect(cube.faceNormal(f.id)[0]).toBeCloseTo(-1);
    expect(f.at).toEqual([0, 100, 100]);
    expect(at(100, 100, 100)?.kind).toBe('object');
    expect(at(300, 100, 100)).toBeUndefined();
  });

  it('an object that is not a solid (a box missing a side) is picked from inside its open section', () => {
    // The cube's faces less the one at x = 200: its section at z = 100 is three sides of a square.
    const box = new Brep();
    const pts: V3[] = [[0, 0, 0], [200, 0, 0], [200, 200, 0], [0, 200, 0], [0, 0, 200], [200, 0, 200], [200, 200, 200], [0, 200, 200]]; // prettier-ignore
    buildShell(box, { positions: pts, faces: [[[0, 3, 2, 1]], [[4, 5, 6, 7]], [[0, 1, 5, 4]], [[2, 3, 7, 6]], [[0, 4, 7, 3]]] }); // prettier-ignore
    const og = new WorldGeometry(box, mat4.identity());
    const s = computeSection(og, 100);
    expect(s.loops.some((l) => !l.closed)).toBe(true);
    expect(pickAt(og, s, 100, 100, 100)?.kind).toBe('object');
    expect(pickAt(og, s, 300, 100, 100)).toBeUndefined();
  });

  it('uses a square pick box of 10 units', () => {
    expect(at(-10, 100, 100)?.kind).toBe('face');
    expect(at(-10.5, 100, 100)).toBeUndefined();
    expect(at(10, 10, 100)?.kind).toBe('edge'); // a round 10 would miss the corner of the box
  });

  it('with a face in the plane: vertices, then its edges, then its inside', () => {
    expect(at(2, 3, 200)).toMatchObject({ kind: 'vertex', at: [0, 0, 200] });
    expect(at(100, 5, 200)).toMatchObject({ kind: 'edge', at: [100, 0, 200] });
    const f = at(100, 100, 200)!;
    expect(f.kind).toBe('inPlaneFace');
    expect(cube.faceNormal(f.id)[2]).toBeCloseTo(1);
  });

  it('counts any vertex touching the plane as a vertex', () => {
    const b = createCube(200, 200, 200);
    drag(b, [vertexAt(b, [200, 200, 200])], [0, 0, 50]); // the corner now sticks out to z = 250
    const gg = new WorldGeometry(b, mat4.identity());
    const p = pickAt(gg, computeSection(gg, 250), 203, 198, 250);
    expect(p).toMatchObject({ kind: 'vertex', at: [200, 200, 250] });
  });
});
