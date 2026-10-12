import { Brep, NONE } from '../topology/brep.ts';
import { kef, kemr, mef, mekr } from '../topology/euler.ts';

/**
 * Keeping faces flat while their vertices move: split.c's
 * planarize_affected_fves and recombine_coplanar_faces.
 *
 * Before each step of a drag, every face that has a moving vertex but does
 * not move rigidly, and that the motion would take out of its plane, is
 * split: a convex face has the triangle at each moving corner cut off (the
 * rest keeps its plane), anything else is triangulated. The pieces share a
 * surface, so they still act as one face. On release, faces of one surface
 * that are coplanar again are merged back; faces that were separate to begin
 * with never are, so no edge the user made is lost.
 */

type P2 = [number, number];

/** Motion components below this (local units) don't count as leaving a face's plane. */
const OFF_PLANE = 1e-6;
/** How much flatter than its original face (local units) a merged face must be. */
const COPLANAR = 1e-6;

const cross = (ax: number, ay: number, bx: number, by: number) => ax * by - ay * bx;

/** Projects a face's points to 2D so its outer loop runs counter-clockwise (holes clockwise). */
function projector(b: Brep, f: number): (v: number) => P2 {
  const [nx, ny, nz] = b.loopNormal(b.faceLoop(f));
  const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz); // prettier-ignore
  if (az >= ax && az >= ay) return nz >= 0 ? (v) => [b.vx(v), b.vy(v)] : (v) => [b.vy(v), b.vx(v)];
  if (ax >= ay) return nx >= 0 ? (v) => [b.vy(v), b.vz(v)] : (v) => [b.vz(v), b.vy(v)];
  return ny >= 0 ? (v) => [b.vz(v), b.vx(v)] : (v) => [b.vx(v), b.vz(v)];
}

/** Does direction d leave corner h (at its start vertex) into the face's interior? */
function inWedge(b: Brep, p2: (v: number) => P2, h: number, d: P2): boolean {
  const [ux, uy] = p2(b.heVertex(h));
  const [nx, ny] = p2(b.heVertex(b.heNext(h)));
  const [px, py] = p2(b.heVertex(b.hePrev(h)));
  const ax = nx - ux, ay = ny - uy, bx = px - ux, by = py - uy; // prettier-ignore
  const turn = cross(ax, ay, bx, by);
  const fromA = cross(ax, ay, d[0], d[1]);
  const toB = cross(d[0], d[1], bx, by);
  if (turn > 0) return fromA > 0 && toB > 0;
  if (turn < 0) return fromA > 0 || toB > 0;
  return fromA > 0;
}

function inheritFace(b: Brep, from: number, to: number, surface: number): void {
  const c = b.faceColors.get(from);
  if (c) b.faceColors.set(to, [...c]);
  const a = b.faceAttrs.get(from);
  if (a) b.faceAttrs.set(to, { ...a, props: [...a.props] });
  b.faceSurface.set(to, surface);
}

function surfaceOf(b: Brep, f: number): number {
  let s = b.faceSurface.get(f);
  if (s === undefined) {
    s = b.newSurface();
    b.faceSurface.set(f, s);
    b.surfaceSlack.set(s, flatness(b, [f]));
  }
  return s;
}

/** How far the faces' vertices lie from the plane of their combined Newell normal. */
function flatness(b: Brep, faces: readonly number[]): number {
  let nx = 0, ny = 0, nz = 0; // prettier-ignore
  const vs = new Set<number>();
  for (const f of faces) {
    const [x, y, z] = b.loopNormal(b.faceLoop(f));
    nx += x;
    ny += y;
    nz += z;
    for (const v of faceVertices(b, f)) vs.add(v);
  }
  const len = Math.hypot(nx, ny, nz);
  if (len === 0) return Infinity;
  nx /= len;
  ny /= len;
  nz /= len;
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of vs) {
    const d = b.vx(v) * nx + b.vy(v) * ny + b.vz(v) * nz;
    lo = Math.min(lo, d);
    hi = Math.max(hi, d);
  }
  return (hi - lo) / 2;
}

/** Cuts off the triangle at corner h (prev, h's vertex, next) as a new face; returns it. */
function cutEar(b: Brep, h: number): number {
  const f = b.heFace(h);
  const { face } = mef(b, b.hePrev(h), b.heNext(h));
  inheritFace(b, f, face, surfaceOf(b, f));
  return face;
}

function cornerArea(b: Brep, p2: (v: number) => P2, h: number): number {
  const [ux, uy] = p2(b.heVertex(h));
  const [nx, ny] = p2(b.heVertex(b.heNext(h)));
  const [px, py] = p2(b.heVertex(b.hePrev(h)));
  return cross(ux - px, uy - py, nx - ux, ny - uy);
}

function isConvex(b: Brep, p2: (v: number) => P2, loop: number): boolean {
  for (const h of b.loopHalfEdges(loop)) if (cornerArea(b, p2, h) < 0) return false;
  return true;
}

function pointInTriangle(p: P2, a: P2, bb: P2, c: P2): boolean {
  const d1 = cross(bb[0] - a[0], bb[1] - a[1], p[0] - a[0], p[1] - a[1]);
  const d2 = cross(c[0] - bb[0], c[1] - bb[1], p[0] - bb[0], p[1] - bb[1]);
  const d3 = cross(a[0] - c[0], a[1] - c[1], p[0] - c[0], p[1] - c[1]);
  return d1 >= 0 && d2 >= 0 && d3 >= 0;
}

const same = (a: P2, c: P2) => a[0] === c[0] && a[1] === c[1];

function isEar(b: Brep, p2: (v: number) => P2, h: number, loop: number[]): boolean {
  if (cornerArea(b, p2, h) <= 0) return false;
  const a = p2(b.heVertex(b.hePrev(h)));
  const u = p2(b.heVertex(h));
  const c = p2(b.heVertex(b.heNext(h)));
  for (const o of loop) {
    const w = p2(b.heVertex(o));
    if (same(w, a) || same(w, u) || same(w, c)) continue;
    if (pointInTriangle(w, a, u, c)) return false;
  }
  return true;
}

/** Do segments pq and rs cross anywhere other than at a shared endpoint? */
function segmentsMeet(p: P2, q: P2, r: P2, s: P2): boolean {
  if (same(p, r) || same(p, s) || same(q, r) || same(q, s)) return false;
  const d1 = cross(q[0] - p[0], q[1] - p[1], r[0] - p[0], r[1] - p[1]);
  const d2 = cross(q[0] - p[0], q[1] - p[1], s[0] - p[0], s[1] - p[1]);
  const d3 = cross(s[0] - r[0], s[1] - r[1], p[0] - r[0], p[1] - r[1]);
  const d4 = cross(s[0] - r[0], s[1] - r[1], q[0] - r[0], q[1] - r[1]);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0)))
    return true;
  const on = (a: P2, c: P2, x: P2, d: number) =>
    d === 0 &&
    Math.min(a[0], c[0]) <= x[0] &&
    x[0] <= Math.max(a[0], c[0]) &&
    Math.min(a[1], c[1]) <= x[1] &&
    x[1] <= Math.max(a[1], c[1]);
  return on(p, q, r, d1) || on(p, q, s, d2) || on(r, s, p, d3) || on(r, s, q, d4);
}

/** Joins every hole of f to its outer loop with a bridge edge (mekr), leaving one loop. */
function bridgeHoles(b: Brep, f: number, p2: (v: number) => P2): boolean {
  for (;;) {
    const loops = b.faceLoops(f);
    if (loops.length === 1) return true;
    const hole = loops[1]!;
    const outer = loops[0]!;
    const all = loops.flatMap((l) => b.loopHalfEdges(l));
    let best: { hh: number; ho: number; d: number } | undefined;
    for (const hh of b.loopHalfEdges(hole)) {
      const a = p2(b.heVertex(hh));
      for (const ho of b.loopHalfEdges(outer)) {
        const o = p2(b.heVertex(ho));
        const d = Math.hypot(o[0] - a[0], o[1] - a[1]);
        if (d === 0 || (best && d >= best.d)) continue;
        if (!inWedge(b, p2, hh, [o[0] - a[0], o[1] - a[1]])) continue;
        if (!inWedge(b, p2, ho, [a[0] - o[0], a[1] - o[1]])) continue;
        let clear = true;
        for (const e of all) {
          if (segmentsMeet(a, o, p2(b.heVertex(e)), p2(b.heVertex(b.heNext(e))))) {
            clear = false;
            break;
          }
        }
        if (clear) best = { hh, ho, d };
      }
    }
    if (!best) return false;
    mekr(b, best.ho, best.hh);
  }
}

/** Ear-clips face f (one loop, after bridging) into triangles, all in f's surface. */
function triangulate(b: Brep, f: number, p2: (v: number) => P2): void {
  for (;;) {
    const loop = b.loopHalfEdges(b.faceLoop(f));
    if (loop.length <= 3) return;
    const ear = loop.find((h) => isEar(b, p2, h, loop));
    if (ear === undefined) return; // degenerate; leave the rest as it is
    cutEar(b, ear);
  }
}

function faceVertices(b: Brep, f: number): number[] {
  return b.faceLoops(f).flatMap((l) => b.loopHalfEdges(l).map((h) => b.heVertex(h)));
}

/**
 * Splits face f so that moving the vertices in `moving` keeps every piece
 * planar (split.c's planarize_face). Returns the number of new faces.
 */
export function planarizeFace(b: Brep, f: number, moving: ReadonlySet<number>): number {
  const before = b.numFaces;
  const p2 = projector(b, f);
  surfaceOf(b, f);
  if (b.faceLoops(f).length > 1) {
    if (bridgeHoles(b, f, p2)) triangulate(b, f, p2);
    return b.numFaces - before;
  }
  if (isConvex(b, p2, b.faceLoop(f))) {
    // simple_face_split: cut off the triangle at each moving corner; the rest keeps its plane.
    for (let cut = true; cut;) {
      cut = false;
      const loop = b.loopHalfEdges(b.faceLoop(f));
      if (loop.length <= 3) break;
      if (loop.every((h) => moving.has(b.heVertex(h)))) break;
      for (const h of loop) {
        if (moving.has(b.heVertex(h)) && cornerArea(b, p2, h) > 0) {
          cutEar(b, h);
          cut = true;
          break;
        }
      }
    }
    const rest = b.loopHalfEdges(b.faceLoop(f));
    const stillMoving = rest.some((h) => moving.has(b.heVertex(h)));
    const allMoving = rest.every((h) => moving.has(b.heVertex(h)));
    if (rest.length > 3 && stillMoving && !allMoving) triangulate(b, f, p2);
  } else triangulate(b, f, p2);
  return b.numFaces - before;
}

/**
 * planarize_affected_fves: before moving `moving` by `delta` (local units),
 * splits every face the motion would bend. Faces that move rigidly (all
 * their vertices move) or that the motion slides within their own plane are
 * left alone. Returns the number of new faces.
 */
export function planarizeForMotion(
  b: Brep,
  moving: ReadonlySet<number>,
  delta: readonly [number, number, number],
): number {
  if (moving.size === 0) return 0;
  let made = 0;
  for (const f of b.faces()) {
    const vs = faceVertices(b, f);
    if (vs.length <= 3 && b.faceLoops(f).length === 1) continue;
    const n = vs.filter((v) => moving.has(v)).length;
    if (n === 0 || n === vs.length) continue;
    const [nx, ny, nz] = b.faceNormal(f);
    if (Math.abs(nx * delta[0] + ny * delta[1] + nz * delta[2]) <= OFF_PLANE) continue;
    made += planarizeFace(b, f, moving);
  }
  return made;
}

/**
 * Would f1 and f2 together be flat? As flat as the face they were split from is enough
 * (exactly flat, up to the snap grid, for anything made here).
 */
function coplanar(b: Brep, f1: number, f2: number, surface: number): boolean {
  const n1 = b.faceNormal(f1);
  const n2 = b.faceNormal(f2);
  if (n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2] <= 0) return false;
  return flatness(b, [f1, f2]) <= (b.surfaceSlack.get(surface) ?? 0) + COPLANAR;
}

/**
 * recombine_coplanar_faces: merges faces of one surface that are coplanar
 * again, and restores holes whose bridge edges are left with the same face
 * on both sides. Faces in `keep` survive a merge where they can (so a picked
 * face stays picked). Surfaces left with one face are dissolved. Returns the
 * number of faces removed.
 */
export function recombineSurfaces(b: Brep, keep: ReadonlySet<number> = new Set()): number {
  const before = b.numFaces;
  for (let changed = true; changed;) {
    changed = false;
    for (const e of b.edges()) {
      const h1 = b.edgeHe1(e);
      const h2 = b.edgeHe2(e);
      if (h2 === NONE) continue;
      const f1 = b.heFace(h1);
      const f2 = b.heFace(h2);
      const s = b.faceSurface.get(f1);
      if (s === undefined || b.faceSurface.get(f2) !== s) continue;
      if (f1 !== f2) {
        if (!coplanar(b, f1, f2, s)) continue;
        kef(b, e, keep.has(f2) && !keep.has(f1) ? f1 : f2);
        changed = true;
      } else if (b.heLoop(h1) === b.heLoop(h2) && b.heNext(h1) !== h2 && b.heNext(h2) !== h1) {
        // A bridge to a hole: take it out, and keep the bigger loop as the outer one.
        const ring = kemr(b, e);
        const area = (l: number) => Math.hypot(...b.loopNormal(l));
        if (area(ring) > area(b.faceLoop(f1))) b.makeOuterLoop(ring);
        changed = true;
      }
      if (changed) break;
    }
  }
  const sizes = new Map<number, number>();
  for (const s of b.faceSurface.values()) sizes.set(s, (sizes.get(s) ?? 0) + 1);
  for (const [f, s] of b.faceSurface)
    if (sizes.get(s) === 1) {
      b.faceSurface.delete(f);
      b.surfaceSlack.delete(s);
    }
  return before - b.numFaces;
}
