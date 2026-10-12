import { Brep, NONE } from '../topology/brep.ts';
import { EulerError, kef, kev, mef } from '../topology/euler.ts';
import { flattenFace, recombineSurfaces } from './planarize.ts';

/**
 * Deleting features of a solid: topology.c's delete_vertex, delete_edge and
 * delete_face, run by update.c's remove_killed_features.
 *
 * - A vertex goes with all its edges; the faces around it become one face
 *   spanning its neighbours (cutting a cube's corner off).
 * - An edge between two coplanar faces just merges them; any other edge
 *   goes with both its ends.
 * - A face goes with all its vertices.
 *
 * A face left bent is triangulated, then coplanar pieces are recombined.
 * These can leave a solid degenerate (a tetrahedron without a corner is
 * flat); callers check the result and undo it if they want.
 */

/** delete_edge's coplanarity test on unit normals. */
const COPLANAR_NORMALS = 1e-4;

/** The half-edges leaving vertex v, in fan order. */
function outgoing(b: Brep, v: number): number[] {
  const start = b.vertexHe(v);
  if (start === NONE || b.heEdge(start) === NONE) return [];
  const out: number[] = [];
  let h = start;
  do {
    out.push(h);
    const m = b.heMate(h);
    if (m === NONE) throw new Error('deleteVertex: the vertex is on an open boundary');
    h = b.heNext(m);
  } while (h !== start && out.length <= b.numHalfEdges);
  return out;
}

/**
 * Deletes vertex v and its edges (delete_vertex): first every face around it is cut so
 * only a triangle touches it, then the triangles merge into one face spanning v's
 * neighbours, which is triangulated if it is bent. Returns that face, or NONE.
 */
export function deleteVertex(b: Brep, v: number): number {
  const fan = outgoing(b, v);
  // Only a simple corner: one fan of distinct faces (earlier deletes can leave a vertex
  // where two fans meet, or a face touching it twice).
  let starts = 0;
  for (const h of b.halfEdges()) if (b.heVertex(h) === v && b.heEdge(h) !== NONE) starts++;
  if (starts !== fan.length || new Set(fan.map((h) => b.heFace(h))).size !== fan.length)
    throw new EulerError('deleteVertex: not a simple corner');
  for (const h of fan) {
    if (b.loopHalfEdges(b.heLoop(h)).length <= 3) continue;
    const f = b.heFace(h);
    const { face } = mef(b, b.hePrev(h), b.heNext(h));
    const c = b.faceColors.get(f);
    if (c) b.faceColors.set(face, [...c]);
    const a = b.faceAttrs.get(f);
    if (a) b.faceAttrs.set(face, { ...a, props: [...a.props] });
  }
  const hs = outgoing(b, v);
  if (hs.length === 0) return NONE;
  for (const h of hs.slice(0, -1)) kef(b, b.heEdge(h));
  const last = hs.at(-1)!;
  const face = b.heFace(last);
  kev(b, b.heEdge(last), v);
  if (b.isFace(face)) {
    flattenFace(b, face);
    recombineSurfaces(b);
  }
  return face;
}

/** Deletes edge e: merges its faces if they are coplanar, else deletes both ends. */
export function deleteEdge(b: Brep, e: number): void {
  const h2 = b.edgeHe2(e);
  const f1 = b.heFace(b.edgeHe1(e));
  const f2 = h2 === NONE ? NONE : b.heFace(h2);
  if (f2 !== NONE && f1 !== f2) {
    const n1 = b.faceNormal(f1);
    const n2 = b.faceNormal(f2);
    if (n1.every((c, i) => Math.abs(c - n2[i]!) < COPLANAR_NORMALS)) {
      kef(b, e);
      return;
    }
  }
  const [p, q] = b.edgeVertices(e);
  deleteVertex(b, p);
  if (b.isVertex(q)) deleteVertex(b, q);
}

/** Deletes face f by deleting all its vertices. */
export function deleteFace(b: Brep, f: number): void {
  const vs = new Set<number>();
  for (const l of b.faceLoops(f)) for (const h of b.loopHalfEdges(l)) vs.add(b.heVertex(h));
  for (const v of vs) if (b.isVertex(v)) deleteVertex(b, v);
}

/** Signed volume enclosed by the Brep's faces (positive for an outward-facing solid). */
export function volume(b: Brep): number {
  let vol = 0;
  for (const f of b.faces())
    for (const l of b.faceLoops(f)) {
      const [nx, ny, nz] = b.loopNormal(l); // twice the loop's vector area
      const p = b.heVertex(b.loopHe(l));
      vol += (b.vx(p) * nx + b.vy(p) * ny + b.vz(p) * nz) / 6;
    }
  return vol;
}
