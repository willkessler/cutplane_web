import { Brep, NONE } from '../topology/brep.ts';
import { mef, mev } from '../topology/euler.ts';

/** A place on a solid to draw from or to: one of its vertices, or a point on one of its edges. */
export type Spot = { vertex: number } | { edge: number; at: readonly [number, number, number] };

/** Closer than this to an edge's end, a point on the edge is that end. */
const AT_END = 1 / 64;

/**
 * Splits edge `e` at a point on it (topology.c's break_edge_at_pos, GWB's semv).
 * The edge keeps its first half; a new edge makes the second. Returns the new vertex.
 */
export function splitEdge(b: Brep, e: number, x: number, y: number, z: number): number {
  const he1 = b.edgeHe1(e);
  const he2 = b.edgeHe2(e);
  if (he2 === NONE) throw new Error('splitEdge: an open edge');
  // Only he2 (b → a) moves to the new vertex: he1 then runs a → new, the new edge new → b.
  return mev(b, he2, b.heNext(he1), x, y, z).vertex;
}

/** The faces around a vertex or along an edge. */
function facesAt(b: Brep, s: Spot): Set<number> {
  const out = new Set<number>();
  if ('vertex' in s) {
    for (const h of b.halfEdges()) if (b.heVertex(h) === s.vertex) out.add(b.heFace(h));
  } else {
    out.add(b.heFace(b.edgeHe1(s.edge)));
    const h2 = b.edgeHe2(s.edge);
    if (h2 !== NONE) out.add(b.heFace(h2));
  }
  return out;
}

/** The spot as a vertex, an edge split there if need be. */
function vertexAt(b: Brep, s: Spot): number {
  if ('vertex' in s) return s.vertex;
  const [p, q] = b.edgeVertices(s.edge);
  for (const v of [p, q]) {
    const [x, y, z] = b.vertexPos(v);
    if (Math.hypot(x - s.at[0], y - s.at[1], z - s.at[2]) < AT_END) return v;
  }
  return splitEdge(b, s.edge, ...s.at);
}

/**
 * Draws a line across a face from one spot to another (cplib.c's draw_on_surface:
 * break_edge_at_pos at each end, then make_edge_face): the face they share is split
 * in two along it. Returns the new face, or null (leaving `b` as it was only if the
 * spots share no face) when the line can't be drawn: no face in common, the same
 * edge, ends already joined by an edge, or a line that would leave the face.
 */
export function drawAcrossFace(b: Brep, from: Spot, to: Spot): number | null {
  if ('edge' in from && 'edge' in to && from.edge === to.edge) return null;
  if ('vertex' in from && 'vertex' in to && from.vertex === to.vertex) return null;
  const near = facesAt(b, to);
  const shared = [...facesAt(b, from)].filter((f) => near.has(f));
  if (shared.length === 0) return null;
  const v1 = vertexAt(b, from);
  const v2 = vertexAt(b, to);
  if (v1 === v2) return null;
  for (const f of shared) {
    for (const l of b.faceLoops(f)) {
      const ring = b.loopHalfEdges(l);
      const h1 = ring.find((h) => b.heVertex(h) === v1);
      const h2 = ring.find((h) => b.heVertex(h) === v2);
      if (h1 === undefined || h2 === undefined) continue;
      if (b.heNext(h1) === h2 || b.heNext(h2) === h1) return null; // already an edge
      if (!insideFace(b, f, v1, v2)) return null;
      const { face } = mef(b, h1, h2);
      const color = b.faceColors.get(f);
      if (color) b.faceColors.set(face, [...color]);
      const attrs = b.faceAttrs.get(f);
      if (attrs) b.faceAttrs.set(face, { ...attrs, props: [...attrs.props] });
      return face;
    }
  }
  return null;
}

/** Whether the segment v1–v2 runs inside face f: its middle inside, crossing none of its edges. */
function insideFace(b: Brep, f: number, v1: number, v2: number): boolean {
  const n = b.faceNormal(f);
  const k = [0, 1, 2].reduce((a, i) => (Math.abs(n[i]!) > Math.abs(n[a]!) ? i : a), 0);
  const [i, j] = [(k + 1) % 3, (k + 2) % 3];
  const flat = (v: number): [number, number] => {
    const p = b.vertexPos(v);
    return [p[i]!, p[j]!];
  };
  const a = flat(v1);
  const c = flat(v2);
  const cross = (o: number[], p: number[], q: number[]) =>
    (p[0]! - o[0]!) * (q[1]! - o[1]!) - (p[1]! - o[1]!) * (q[0]! - o[0]!);
  const mid = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2];
  let inside = false;
  for (const l of b.faceLoops(f)) {
    const ring = b.loopHalfEdges(l).map((h) => b.heVertex(h));
    for (let t = 0; t < ring.length; t++) {
      const u = ring[t]!;
      const w = ring[(t + 1) % ring.length]!;
      const p = flat(u);
      const q = flat(w);
      if (p[1] > mid[1]! !== q[1] > mid[1]!) {
        const x = p[0] + ((mid[1]! - p[1]) / (q[1] - p[1])) * (q[0] - p[0]);
        if (x > mid[0]!) inside = !inside;
      }
      if (u === v1 || u === v2 || w === v1 || w === v2) continue;
      const d1 = cross(p, q, a);
      const d2 = cross(p, q, c);
      const d3 = cross(a, c, p);
      const d4 = cross(a, c, q);
      if (d1 * d2 < 0 && d3 * d4 < 0) return false;
    }
  }
  return inside;
}
