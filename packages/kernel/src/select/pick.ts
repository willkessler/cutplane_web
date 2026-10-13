import { NONE } from '../topology/brep.ts';
import type { ObjectSection, WorldGeometry } from '../section/section.ts';

/**
 * What the crosshair can pick, after select.c's cursor_near_feature and
 * determine_selectable. Everything is found through the section, in the
 * plane, in priority order:
 *
 * 1. a vertex lying on the plane;
 * 2. an edge: one lying in the plane (anywhere along it), or one piercing the
 *    plane (at the piercing point);
 * 3. a face, through its section segment;
 * 4. a face lying in the plane, from inside it;
 * 5. the object, from inside its section.
 *
 * Tests are the original's square boxes (|dx| and |dy| within the pick size),
 * not round distances. Within a kind the nearest wins (the original took the
 * first in segment order). One deliberate fix: the original only counted a
 * vertex on the plane as a vertex when one of its edges also lay in the plane
 * (a pointer comparison in cursor_near_pt), so a pyramid's apex touching the
 * plane was picked as an edge; here any vertex on the plane is a vertex.
 */

/** user.h's Pkboxsize: the pick box half-width, in room units. */
export const PICK_SIZE = 10;
/** intersect.h's Tolerance: how near the plane a vertex must be to pick it. */
export const ON_PLANE_PICK = 0.5;

export type PickKind = 'vertex' | 'edge' | 'face' | 'inPlaneFace' | 'object';

/** Lower is picked first (select.h's selectkind order). */
export const PICK_PRIORITY: Record<PickKind, number> = {
  vertex: 1,
  edge: 2,
  face: 3,
  inPlaneFace: 4,
  object: 5,
};

export interface Pick {
  kind: PickKind;
  /** Vertex, edge or face id in the object's Brep; NONE for the object. */
  id: number;
  /** The picked point in world coordinates (select.h's nearestpos), in the plane. */
  at: [number, number, number];
  /** Box distance from the crosshair, for choosing between objects. */
  dist: number;
}

const box = (dx: number, dy: number) => Math.max(Math.abs(dx), Math.abs(dy));

/** Nearest point on segment a–b to (x, y), and its parameter. */
function foot(ax: number, ay: number, bx: number, by: number, x: number, y: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : ((x - ax) * dx + (y - ay) * dy) / l2;
  return { t, fx: ax + t * dx, fy: ay + t * dy };
}

/** Even-odd test of (x, y) against closed polygons (x y z interleaved). */
function insideAll(polys: readonly ArrayLike<number>[], x: number, y: number): boolean {
  let inside = false;
  for (const p of polys) {
    const n = p.length / 3;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = p[3 * i]!, yi = p[3 * i + 1]!, xj = p[3 * j]!, yj = p[3 * j + 1]!; // prettier-ignore
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

/**
 * The best pick on one object at crosshair (x, y) with the plane at z, given
 * the object's world geometry and its section there; undefined if nothing
 * is near.
 */
export function pickAt(
  g: WorldGeometry,
  s: ObjectSection,
  x: number,
  y: number,
  z: number,
  size = PICK_SIZE,
): Pick | undefined {
  if (g.zMin > z + ON_PLANE_PICK || g.zMax < z - ON_PLANE_PICK) return undefined;
  const b = g.brep;

  // 1. Vertices on the plane.
  let best: Pick | undefined;
  for (const v of b.vertices()) {
    if (Math.abs(g.z(v) - z) >= ON_PLANE_PICK) continue;
    const d = box(g.x(v) - x, g.y(v) - y);
    if (d <= size && (!best || d < best.dist))
      best = { kind: 'vertex', id: v, at: [g.x(v), g.y(v), z], dist: d };
  }
  if (best) return best;

  // 2. Edges: in the plane, or piercing it.
  const onPlane = (v: number) => Math.abs(g.z(v) - z) < ON_PLANE_PICK;
  for (const e of b.edges()) {
    const [p, q] = b.edgeVertices(e);
    if (!onPlane(p) || !onPlane(q)) continue;
    const { t, fx, fy } = foot(g.x(p), g.y(p), g.x(q), g.y(q), x, y);
    if (t < 0 || t > 1) continue;
    const d = box(fx - x, fy - y);
    if (d <= size && (!best || d < best.dist))
      best = { kind: 'edge', id: e, at: [fx, fy, z], dist: d };
  }
  for (const loop of s.loops) {
    const p = loop.points;
    loop.segments.forEach((seg, i) => {
      const [a, c] = b.edgeVertices(seg.startEdge);
      if (onPlane(a) || onPlane(c)) return; // that crossing is a vertex
      const px = p[3 * i]!, py = p[3 * i + 1]!; // prettier-ignore
      const d = box(px - x, py - y);
      if (d <= size && (!best || d < best.dist))
        best = { kind: 'edge', id: seg.startEdge, at: [px, py, z], dist: d };
    });
  }
  if (best) return best;

  // 3. Faces, through their section segments.
  for (const loop of s.loops) {
    const p = loop.points;
    const n = p.length / 3;
    loop.segments.forEach((seg, i) => {
      const j = (i + 1) % n;
      const { t, fx, fy } = foot(p[3 * i]!, p[3 * i + 1]!, p[3 * j]!, p[3 * j + 1]!, x, y);
      if (t < 0 || t > 1) return;
      const d = box(fx - x, fy - y);
      if (d <= size && (!best || d < best.dist))
        best = { kind: 'face', id: seg.face, at: [fx, fy, z], dist: d };
    });
  }
  if (best) return best;

  // 4. Faces lying in the plane, from inside.
  for (const f of s.inPlaneFaces) {
    const polys = b.faceLoops(f).map((l) =>
      b.loopHalfEdges(l).flatMap((h) => {
        const v = b.heVertex(h);
        return [g.x(v), g.y(v), z];
      }),
    );
    if (insideAll(polys, x, y)) return { kind: 'inPlaneFace', id: f, at: [x, y, z], dist: 0 };
  }

  // 5. Inside the section: the whole object.
  const closed = s.loops.filter((l) => l.closed).map((l) => l.points);
  if (closed.length > 0 && insideAll(closed, x, y))
    return { kind: 'object', id: NONE, at: [x, y, z], dist: 0 };
  // New here: an object that isn't a solid (a broken import) has a section that doesn't
  // close. Inside any of its loops (an open one closed straight across) is the object.
  if (s.loops.some((l) => !l.closed) && s.loops.some((l) => insideAll([l.points], x, y)))
    return { kind: 'object', id: NONE, at: [x, y, z], dist: 0 };
  return undefined;
}

/** Orders picks from different objects: higher priority first, then nearer. */
export function betterPick(a: Pick, b: Pick): boolean {
  const pa = PICK_PRIORITY[a.kind];
  const pb = PICK_PRIORITY[b.kind];
  return pa !== pb ? pa < pb : a.dist < b.dist;
}
