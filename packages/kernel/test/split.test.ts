import { describe, expect, it } from 'vitest';
import { createCube, drawAcrossFace, validate, volume, type Brep } from '../src/index.ts';

/** The cube's edge from (x0,y0,z0) to (x1,y1,z1), and its vertex at a point. */
const edgeOf = (b: Brep, p: number[], q: number[]) =>
  b.edges().find((e) => {
    const ends = b.edgeVertices(e).map((v) => b.vertexPos(v).join());
    return ends.includes(p.join()) && ends.includes(q.join());
  })!;
const vertexOf = (b: Brep, p: number[]) => b.vertices().find((v) => b.vertexPos(v).join() === p.join())!; // prettier-ignore

describe('drawing across a face (draw_on_surface)', () => {
  it('edge to edge splits the face they share; the solid stays whole', () => {
    const b = createCube(100, 100, 100);
    const f = drawAcrossFace(
      b,
      { edge: edgeOf(b, [0, 100, 0], [100, 100, 0]), at: [30, 100, 0] },
      { edge: edgeOf(b, [0, 100, 100], [100, 100, 100]), at: [60, 100, 100] },
    );
    expect(f).not.toBeNull();
    expect(b.numFaces).toBe(7);
    expect(b.numVertices).toBe(10);
    const r = validate(b);
    expect(r.ok && r.closedManifold).toBe(true);
    expect(volume(b)).toBeCloseTo(1e6);
  });

  it('vertex to vertex, and vertex to edge', () => {
    const b = createCube(100, 100, 100);
    expect(drawAcrossFace(b, { vertex: vertexOf(b, [0, 100, 0]) }, { vertex: vertexOf(b, [100, 100, 100]) })).not.toBeNull(); // prettier-ignore
    expect(b.numFaces).toBe(7);
    const c = createCube(100, 100, 100);
    expect(drawAcrossFace(c, { vertex: vertexOf(c, [0, 0, 0]) }, { edge: edgeOf(c, [100, 0, 0], [100, 100, 0]), at: [100, 50, 0] })).not.toBeNull(); // prettier-ignore
    expect(c.numFaces).toBe(7);
    expect(validate(c).closedManifold).toBe(true);
  });

  it('refuses: no face in common, the same edge, ends already joined', () => {
    const b = createCube(100, 100, 100);
    const top = edgeOf(b, [0, 100, 0], [100, 100, 0]);
    const bottom = edgeOf(b, [0, 0, 100], [100, 0, 100]);
    expect(drawAcrossFace(b, { edge: top, at: [10, 100, 0] }, { edge: bottom, at: [10, 0, 100] })).toBeNull(); // prettier-ignore
    expect(drawAcrossFace(b, { edge: top, at: [10, 100, 0] }, { edge: top, at: [90, 100, 0] })).toBeNull(); // prettier-ignore
    expect(drawAcrossFace(b, { vertex: vertexOf(b, [0, 100, 0]) }, { vertex: vertexOf(b, [100, 100, 0]) })).toBeNull(); // prettier-ignore
  });
});
