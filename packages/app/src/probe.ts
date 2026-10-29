import type { WorldGeometry } from '@cutplane/kernel';

/**
 * New: checks by number for an agent (?mcp), so a fault shows in what a call says and not
 * only in a look: how much room a solid takes (a boolean says what it kept), what a line
 * of sight meets (glass where it should be, or the cabin behind it), whether a point is
 * inside a solid, and how two solids sit (apart, touching, one inside the other). All in
 * room coordinates, on the world's own faces (polygons, holes and all).
 */

export type V3 = [number, number, number];

const EPS = 1e-9;
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);

/** A face as the probes use it: its loops' corners (outer first), plane and box. */
interface Face {
  id: number;
  loops: V3[][];
  /** Unit normal (Newell, outer loop), and the plane's offset (n·p). */
  n: V3;
  d: number;
  lo: V3;
  hi: V3;
}

const faceCache = new WeakMap<WorldGeometry, Face[]>();

/** A solid's faces in room coordinates (kept while its geometry is). */
export function facesOf(g: WorldGeometry): Face[] {
  let out = faceCache.get(g);
  if (out) return out;
  const b = g.brep;
  const at = (v: number): V3 => [g.x(v), g.y(v), g.z(v)];
  out = [];
  for (const f of b.faces()) {
    const loops = b.faceLoops(f).map((l) => b.loopHalfEdges(l).map((h) => at(b.heVertex(h))));
    if (!loops[0] || loops[0].length < 3) continue;
    const n = g.faceNormal(f) as V3;
    if (len(n) < 0.5) continue;
    const lo: V3 = [Infinity, Infinity, Infinity];
    const hi: V3 = [-Infinity, -Infinity, -Infinity];
    for (const p of loops[0])
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k]!, p[k]!);
        hi[k] = Math.max(hi[k]!, p[k]!);
      }
    out.push({ id: f, loops, n, d: dot(n, loops[0][0]!), lo, hi });
  }
  faceCache.set(g, out);
  return out;
}

/** The room a solid takes (its faces' signed volume; a void inside it counts against it). */
export function worldVolume(g: WorldGeometry): number {
  let vol = 0;
  for (const f of facesOf(g))
    for (const loop of f.loops) {
      // Twice the loop's vector area (Newell), dotted with a point on it.
      let nx = 0;
      let ny = 0;
      let nz = 0;
      for (let i = 0; i < loop.length; i++) {
        const a = loop[i]!;
        const c = loop[(i + 1) % loop.length]!;
        nx += (a[1] - c[1]) * (a[2] + c[2]);
        ny += (a[2] - c[2]) * (a[0] + c[0]);
        nz += (a[0] - c[0]) * (a[1] + c[1]);
      }
      const p = loop[0]!;
      vol += (p[0] * nx + p[1] * ny + p[2] * nz) / 6;
    }
  return vol;
}

/** Whether p, on the face's plane, lies within it (even-odd over all its loops). */
function within(f: Face, p: V3): boolean {
  // Drop the axis the face looks most along, and test in the other two.
  const a = Math.abs(f.n[0]);
  const b = Math.abs(f.n[1]);
  const c = Math.abs(f.n[2]);
  const [u, v] = a >= b && a >= c ? [1, 2] : b >= c ? [0, 2] : [0, 1];
  let inside = false;
  for (const loop of f.loops)
    for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
      const pi = loop[i]!;
      const pj = loop[j]!;
      if (
        pi[v]! > p[v]! !== pj[v]! > p[v]! &&
        p[u]! < ((pj[u]! - pi[u]!) * (p[v]! - pi[v]!)) / (pj[v]! - pi[v]!) + pi[u]!
      )
        // prettier-ignore
        inside = !inside;
    }
  return inside;
}

/** Whether a ray could meet a box at all (slab test), and not before `max` along it. */
function meetsBox(o: V3, d: V3, lo: V3, hi: V3, max: number): boolean {
  let t0 = 0;
  let t1 = max;
  for (let k = 0; k < 3; k++) {
    if (Math.abs(d[k]!) < EPS) {
      if (o[k]! < lo[k]! - 1e-6 || o[k]! > hi[k]! + 1e-6) return false;
      continue;
    }
    let a = (lo[k]! - o[k]!) / d[k]!;
    let b = (hi[k]! - o[k]!) / d[k]!;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a - 1e-6);
    t1 = Math.min(t1, b + 1e-6);
    if (t0 > t1) return false;
  }
  return true;
}

export interface Crossing {
  face: number;
  /** How far along the ray (d a unit long: in room units). */
  t: number;
  at: V3;
  n: V3;
  /** Going into the solid (against the face's outward normal), or out of it. */
  entering: boolean;
}

/** Where a ray from o along unit d crosses a solid's faces, nearest first (up to max). */
export function crossings(g: WorldGeometry, o: V3, d: V3, max = Infinity): Crossing[] {
  const out: Crossing[] = [];
  for (const f of facesOf(g)) {
    if (!meetsBox(o, d, f.lo, f.hi, max)) continue;
    const den = dot(f.n, d);
    if (Math.abs(den) < EPS) continue;
    const t = (f.d - dot(f.n, o)) / den;
    if (t < 1e-7 || t > max) continue;
    const at: V3 = [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
    if (!within(f, at)) continue;
    out.push({ face: f.id, t, at, n: f.n, entering: den < 0 });
  }
  return out.sort((a, b) => a.t - b.t);
}

/** Whether p lies inside a solid: crossings along a slanted line, counted (odd: inside). */
export function insideSolid(g: WorldGeometry, p: V3): boolean {
  // (An odd direction, so the line misses edges and corners a straight one would graze.)
  const d: V3 = [0.5773, 0.5774, 0.5776];
  const l = len(d);
  return crossings(g, p, [d[0] / l, d[1] / l, d[2] / l]).length % 2 === 1;
}

/** The closest point of a face to p, and how far it is. */
function nearestOnFace(f: Face, p: V3): number {
  const h = dot(f.n, p) - f.d;
  const q: V3 = [p[0] - f.n[0] * h, p[1] - f.n[1] * h, p[2] - f.n[2] * h];
  if (within(f, q)) return Math.abs(h);
  let best = Infinity;
  for (const loop of f.loops)
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i]!;
      const ab = sub(loop[(i + 1) % loop.length]!, a);
      const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / Math.max(dot(ab, ab), EPS)));
      best = Math.min(best, len(sub(p, [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t])));
    }
  return best;
}

/** How far a box is from p (0 inside it). */
function boxDistance(lo: V3, hi: V3, p: V3): number {
  let s = 0;
  for (let k = 0; k < 3; k++) {
    const e = Math.max(lo[k]! - p[k]!, 0, p[k]! - hi[k]!);
    s += e * e;
  }
  return Math.sqrt(s);
}

/** How near a solid's surface p comes, if nearer than `within` (else Infinity). */
function surfaceDistance(g: WorldGeometry, p: V3, within: number): number {
  let best = Infinity;
  for (const f of facesOf(g))
    if (boxDistance(f.lo, f.hi, p) <= within) best = Math.min(best, nearestOnFace(f, p));
  return best <= within ? best : Infinity;
}

/** Nearer a surface than this counts as on it (touching, not inside). */
const ON = 1e-4;

/** Where p lies against a solid: inside it, on its surface, or out. */
function where(g: WorldGeometry, p: V3): 'in' | 'on' | 'out' {
  if (surfaceDistance(g, p, ON) <= ON) return 'on';
  return insideSolid(g, p) ? 'in' : 'out';
}

/** The corners of a solid (each once). */
function corners(g: WorldGeometry): V3[] {
  return g.brep.vertices().map((v): V3 => [g.x(v), g.y(v), g.z(v)]);
}

/** Whether a solid's edges cross the other's faces (the two cut into each other). */
function edgesCross(a: WorldGeometry, b: WorldGeometry): boolean {
  for (const e of a.brep.edges()) {
    const [u, v] = a.brep.edgeVertices(e);
    const p: V3 = [a.x(u), a.y(u), a.z(u)];
    const q: V3 = [a.x(v), a.y(v), a.z(v)];
    const pq = sub(q, p);
    const l = len(pq);
    if (l < EPS) continue;
    // Cut at its crossings, does a piece of it run inside? (Not one along a face or past an
    // edge of it: touching is not cutting in.)
    const d: V3 = [pq[0] / l, pq[1] / l, pq[2] / l];
    const ts = [0, ...crossings(b, p, d, l).map((h) => h.t), l];
    for (let i = 1; i < ts.length; i++) {
      if (ts[i]! - ts[i - 1]! < ON) continue;
      const t = (ts[i]! + ts[i - 1]!) / 2;
      if (where(b, [p[0] + d[0] * t, p[1] + d[1] * t, p[2] + d[2] * t]) === 'in') return true;
    }
  }
  return false;
}

export interface Clearance {
  /** They share some room (one cuts into the other, or holds it). */
  overlap: boolean;
  /** Every corner of the first lies inside the second (and the other way). */
  aInB: boolean;
  bInA: boolean;
  /** How close their surfaces come (0 when they overlap or touch). */
  gap: number;
}

/** How two solids sit: apart (and how far), touching, cutting into each other, one inside. */
export function clearance(a: WorldGeometry, b: WorldGeometry): Clearance {
  // (A corner lying on the other's surface touches it; it is not inside it. Counted as inside,
  // a pane resting on a window floor, or a block on another, read as cutting in.)
  const ca = corners(a);
  const cb = corners(b);
  const wa = ca.map((p) => where(b, p));
  const wb = cb.map((p) => where(a, p));
  const aInB = wa.length > 0 && wa.every((w) => w !== 'out') && wa.includes('in');
  const bInA = wb.length > 0 && wb.every((w) => w !== 'out') && wb.includes('in');
  const overlap =
    aInB || bInA || wa.includes('in') || wb.includes('in') || edgesCross(a, b) || edgesCross(b, a);
  let gap = Infinity;
  const fa = facesOf(a);
  const fb = facesOf(b);
  for (const [ps, fs] of [
    [ca, fb],
    [cb, fa],
  ] as const)
    for (const p of ps)
      for (const f of fs)
        if (boxDistance(f.lo, f.hi, p) < gap) gap = Math.min(gap, nearestOnFace(f, p));
  return { overlap, aInB, bInA, gap: overlap ? 0 : gap };
}
